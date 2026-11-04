/**
 * Shipments, expected delivery and COD settlement (C2/C3/D2).
 *
 * Dispatch used to be a status change with no carrier/AWB record, and a COD
 * order had no way to record that cash was actually collected. This module owns
 * the `shipments` writes, the order's expected-delivery date, and the one COD
 * settlement transition (which is also where a legacy COD order that was never
 * counted gets its aggregates/loyalty, exactly once).
 *
 * Callers pass the per-tenant client (CO-08).
 */

import { accountScopeEmail, pb, getCurrentTenantEmail, canActOnTenant } from './pocketbase';
import { sendShippingTracking } from './whatsapp-notifications';
import { AGGREGATES_MARKER, aggregatesWereCounted, applyPurchaseAggregates } from './channel-orders';
import { calculatePointsToEarn, earnPoints } from './loyalty';

export type ShippingStatus = 'pending' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';

/**
 * Original dispatch API (kept for `BarcodeScanDispatchModal`): a plain shipment
 * insert. The richer flow below adds order state, expected delivery, customer
 * notification and COD settlement.
 */
export interface ShipmentInput {
    orderId: string;
    carrier: string;
    awbNumber: string;
    shippingStatus?: string;
    trackingUrl?: string;
    codAmount?: number;
    weightGrams?: number;
}

export interface CreateShipmentInput extends ShipmentInput {
    expectedDeliveryDate?: string;
    notifyCustomer?: boolean;
}

/** PAID, or an explicitly cash-on-delivery order (the dispatch gate). */
function isPaidOrCod(order: { payment_status?: unknown; payment_method?: unknown }): boolean {
    const method = String(order.payment_method || '').toLowerCase();
    const isCashOnDelivery = ['cash', 'cod', 'cash_on_delivery'].includes(method);
    return String(order.payment_status || '').toUpperCase() === 'PAID' || isCashOnDelivery;
}

const SHIPMENT_TRANSITIONS: Record<ShippingStatus, ShippingStatus[]> = {
    pending: ['in_transit', 'cancelled'],
    in_transit: ['delivered', 'returned', 'cancelled'],
    delivered: ['returned'],
    returned: [],
    cancelled: [],
};

export async function createShipment(input: ShipmentInput): Promise<{ id: string }> {
    // The legacy entry point skipped the guards the dispatch flow enforces:
    // it stamped no tenant on some rows, checked no ownership and dispatched
    // unpaid orders (ORD-5). Mirror createShipmentForOrder's preconditions.
    const tenantEmail = getCurrentTenantEmail();
    const order = await pb.collection('sales_orders').getOne<{
        account_email?: string;
        status?: string;
        payment_status?: string;
        payment_method?: string;
    }>(input.orderId);
    if (!canActOnTenant(order.account_email)) {
        throw new Error('Order does not belong to this store.');
    }
    if (['cancelled', 'refunded'].includes(String(order.status || ''))) {
        throw new Error('A cancelled/refunded order cannot be shipped.');
    }
    if (!isPaidOrCod(order)) {
        throw new Error('Only paid orders (or COD) can be dispatched.');
    }

    const record = await pb.collection('shipments').create({
        account_email: tenantEmail,
        order_id: input.orderId,
        carrier: input.carrier,
        awb_number: input.awbNumber,
        shipping_status: input.shippingStatus || 'manifested',
        tracking_url: input.trackingUrl || '',
        cod_amount: input.codAmount ?? 0,
        weight_grams: input.weightGrams ?? 0,
    });
    return { id: record.id };
}

export interface ShipmentResult {
    success: boolean;
    shipmentId?: string;
    error?: string;
}

export interface ShipmentRow {
    id: string;
    order_id?: string;
    carrier?: string;
    awb_number?: string;
    shipping_status?: string;
    tracking_url?: string;
    cod_amount?: number;
    weight_grams?: number;
}

/** All shipments recorded for an order, newest first. */
export async function listShipmentsForOrder(db: typeof pb, orderId: string): Promise<ShipmentRow[]> {
    try {
        return await db.collection('shipments').getFullList<ShipmentRow>({
            filter: pb.filter('order_id = {:order}', { order: orderId }),
            // The shipments collection has no system `created` field, so sorting
            // by it fails the whole query; the fixture returns oldest→newest.
            requestKey: null,
        });
    } catch {
        return [];
    }
}

/** Persist the expected delivery date shown to the customer. */
export async function setExpectedDelivery(
    db: typeof pb,
    orderId: string,
    expectedDeliveryDate: string
): Promise<{ success: boolean; error?: string }> {
    try {
        await db.collection('sales_orders').update(orderId, { expected_delivery_date: expectedDeliveryDate });
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Create the dispatch record and move the order to `shipped`. The AWB is stored
 * before the customer is notified so a notification failure cannot lose it.
 */
export async function createShipmentForOrder(
    db: typeof pb,
    tenantEmail: string,
    input: CreateShipmentInput
): Promise<ShipmentResult> {
    const carrier = (input.carrier || '').trim();
    const awbNumber = (input.awbNumber || '').trim();
    if (!input.orderId || !carrier || !awbNumber) {
        return { success: false, error: 'Carrier and AWB number are required.' };
    }

    try {
        const order = await db.collection('sales_orders').getOne(input.orderId);
        if (!canActOnTenant(order.account_email, db)) {
            return { success: false, error: 'Order does not belong to this store.' };
        }
        if (['cancelled', 'refunded'].includes(String(order.status || ''))) {
            return { success: false, error: 'A cancelled/refunded order cannot be shipped.' };
        }
        const method = String(order.payment_method || '').toLowerCase();
        const isCashOnDelivery = ['cash', 'cod', 'cash_on_delivery'].includes(method);
        if (String(order.payment_status || '').toUpperCase() !== 'PAID' && !isCashOnDelivery) {
            return { success: false, error: 'Only paid orders (or COD) can be dispatched.' };
        }

        const shipment = await db.collection('shipments').create({
            account_email: tenantEmail,
            order_id: input.orderId,
            carrier,
            awb_number: awbNumber,
            tracking_url: input.trackingUrl || '',
            cod_amount: Number(input.codAmount) || 0,
            weight_grams: Number(input.weightGrams) || 0,
            shipping_status: 'in_transit',
        });

        const orderUpdate: Record<string, unknown> = { status: 'shipped' };
        if (input.expectedDeliveryDate) orderUpdate.expected_delivery_date = input.expectedDeliveryDate;
        try {
            await db.collection('sales_orders').update(input.orderId, orderUpdate);
        } catch (orderErr) {
            // The order did not move to `shipped`; keep the shipment row from
            // outliving the failed attempt, otherwise a retry adds a duplicate
            // AWB for the same dispatch (ORD-9).
            await db.collection('shipments').delete(shipment.id).catch((deleteErr) =>
                console.error('[shipments] Could not roll back shipment after order update failure:', deleteErr)
            );
            throw orderErr;
        }

        if (input.notifyCustomer !== false) {
            await sendShippingTracking(input.orderId, carrier, awbNumber, input.trackingUrl, db).catch(
                (err) => console.warn('[shipments] Tracking notification failed:', err)
            );
        }

        return { success: true, shipmentId: shipment.id };
    } catch (err) {
        console.error('[shipments] Could not create shipment:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/** Update a shipment's status (and the order when it was delivered). */
export async function updateShipmentStatus(
    db: typeof pb,
    shipmentId: string,
    status: ShippingStatus
): Promise<{ success: boolean; error?: string }> {
    try {
        const shipment = await db.collection('shipments').getOne<ShipmentRow & { account_email?: string }>(
            shipmentId
        );

        // getOne has no filter, so ownership is verified in memory before any
        // write. Superuser/admin sessions may act on any tenant.
        if (!canActOnTenant(shipment.account_email, db)) {
            return { success: false, error: 'Shipment does not belong to this store.' };
        }

        // Validate the transition instead of accepting any status value (ORD-10).
        const previousStatus = String(shipment.shipping_status || 'pending');
        // Legacy rows (the old `createShipment` wrote "manifested") are treated
        // as in transit so they can still be delivered.
        const current: ShippingStatus =
            previousStatus in SHIPMENT_TRANSITIONS ? (previousStatus as ShippingStatus) : 'in_transit';
        if (current === status) return { success: true };
        const allowed = SHIPMENT_TRANSITIONS[current];
        if (!allowed || !allowed.includes(status)) {
            return {
                success: false,
                error: `Cannot move a shipment from "${previousStatus}" to "${status}".`,
            };
        }

        await db.collection('shipments').update(shipmentId, { shipping_status: status });

        if (status === 'delivered' && shipment.order_id) {
            // A swallowed failure left the shipment delivered while the order
            // stayed confirmed, blocking invoicing (ORD-10). Surface it, and put
            // the shipment back so the two records agree.
            try {
                await db.collection('sales_orders').update(shipment.order_id, { status: 'delivered' });
            } catch (orderErr) {
                await db
                    .collection('shipments')
                    .update(shipmentId, { shipping_status: previousStatus })
                    .catch((revertErr) =>
                        console.error('[shipments] Could not revert shipment status:', revertErr)
                    );
                return {
                    success: false,
                    error: `Shipment update rolled back: ${
                        orderErr instanceof Error ? orderErr.message : String(orderErr)
                    }`,
                };
            }
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Record COD cash collection (D2).
 *
 * Guards: the order must be a COD order, not already paid/refunded/cancelled.
 * The order is marked PAID + delivered and a `cod` payment-link row records the
 * collection. COD orders bump aggregates at intake, so settlement only bumps when
 * the intake marker is missing (legacy rows), keeping the counter exact.
 */
/**
 * Stable 15-char record id for the COD settlement claim row (ORD-4). A second
 * concurrent settle derives the same id, so PocketBase's create rejects it as a
 * duplicate instead of letting both sessions transition the order.
 */
function codClaimRecordId(orderId: string): string {
    const hash = (input: string, seed: number) => {
        let value = seed >>> 0;
        for (let index = 0; index < input.length; index += 1) {
            value ^= input.charCodeAt(index);
            value = Math.imul(value, 16777619) >>> 0;
        }
        return value >>> 0;
    };
    const first = hash(orderId, 2166136261).toString(36);
    const second = hash(orderId, 3339675911).toString(36);
    return `cod${`${first}${second}`.padStart(12, '0').slice(0, 12)}`;
}

/** PocketBase reports a client-supplied id clash as a 400 (ORD-4). */
function isDuplicateRecordError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as {
        status?: number;
        message?: string;
        data?: { data?: Record<string, { code?: string }> };
    };
    if (candidate.status !== 400) return false;
    const idError = candidate.data?.data?.id?.code;
    if (idError === 'validation_not_unique' || idError === 'validation_invalid_id') return true;
    return typeof candidate.message === 'string' && /already (in use|exists)/i.test(candidate.message);
}

export async function settleCodOrder(
    db: typeof pb,
    tenantEmail: string,
    orderId: string,
    opts: { collectedBy?: string; reference?: string } = {}
): Promise<{ success: boolean; error?: string }> {
    try {
        const order = await db.collection('sales_orders').getOne(orderId);
        if (!canActOnTenant(order.account_email, db)) {
            return { success: false, error: 'Order does not belong to this store.' };
        }
        const method = String(order.payment_method || '').toLowerCase();
        const isCod = method === 'cash' || method === 'cod' || method === 'cash_on_delivery';
        if (!isCod) {
            return { success: false, error: 'This order is not a Cash-on-Delivery order.' };
        }
        const paymentStatus = String(order.payment_status || '').toUpperCase();
        if (paymentStatus === 'PAID') return { success: true };
        if (paymentStatus === 'REFUNDED') {
            return { success: false, error: 'A refunded order cannot be settled as COD.' };
        }
        if (String(order.status || '') === 'cancelled') {
            return { success: false, error: 'A cancelled order cannot be settled as COD.' };
        }

        const now = new Date().toISOString();

        // Atomic claim (ORD-4): the ledger row is created first under a
        // deterministic id. Exactly one concurrent settle can create it; the
        // loser sees a duplicate-id conflict and exits as already settled, so
        // the PAID transition, the ledger row and the aggregate/loyalty bump
        // can never be applied twice.
        try {
            await db.collection('payment_links').create({
                id: codClaimRecordId(orderId),
                provider: 'cod',
                link_id: `COD-${orderId.slice(-8)}-${Date.now().toString(36).toUpperCase()}`,
                amount: Number(order.total || 0),
                currency: 'INR',
                customer: order.customer || '',
                order: orderId,
                status: 'pending',
                notes: { source: 'cod_settlement', collected_by: opts.collectedBy || '', reference: opts.reference || '' },
                account_email: tenantEmail,
            });
        } catch (claimErr) {
            if (isDuplicateRecordError(claimErr)) {
                console.warn('[shipments] COD settlement already claimed for this order:', orderId);
                return { success: true };
            }
            // A real ledger failure must not mark the order paid.
            throw claimErr;
        }

        try {
            await db.collection('sales_orders').update(orderId, {
                payment_status: 'PAID',
                status: 'delivered',
                cod_settled_at: now,
                cod_reference: (opts.reference || '').trim().slice(0, 120),
                internal_notes: [
                    order.internal_notes,
                    `[COD settled ${now}] collected_by=${opts.collectedBy || 'unrecorded'} reference=${opts.reference || 'none'}`,
                ]
                    .filter(Boolean)
                    .join('\n'),
            });
        } catch (orderErr) {
            // Undo the claim so a retry can settle the order.
            await db
                .collection('payment_links')
                .delete(codClaimRecordId(orderId))
                .catch((deleteErr) =>
                    console.error('[shipments] Could not release the COD settlement claim:', deleteErr)
                );
            throw orderErr;
        }

        // The claim is only final once the ledger row says the cash was paid.
        // A failure here is surfaced instead of being swallowed: the order is
        // PAID, so the pending claim row is the reconciliation evidence.
        await db.collection('payment_links').update(codClaimRecordId(orderId), {
            status: 'paid',
            paid_at: now,
        });

        // Legacy COD rows created before the aggregate marker existed.
        if (order.customer && !aggregatesWereCounted(order.internal_notes)) {
            const totalAmount = Number(order.total || order.subtotal || 0);
            await applyPurchaseAggregates(db, order.customer, totalAmount).catch((err) =>
                console.warn('[shipments] COD aggregate bump failed:', err)
            );
            try {
                const points = await calculatePointsToEarn(totalAmount, undefined, db);
                if (points > 0) {
                    await earnPoints(order.customer, totalAmount, 'sales_order', orderId, db);
                }
                const fresh = await db.collection('sales_orders').getOne(orderId);
                await db.collection('sales_orders').update(orderId, {
                    internal_notes: [fresh.internal_notes, AGGREGATES_MARKER].filter(Boolean).join('\n'),
                });
            } catch (err) {
                console.warn('[shipments] COD loyalty/marker failed:', err);
            }
        }

        return { success: true };
    } catch (err) {
        console.error('[shipments] COD settlement failed:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}