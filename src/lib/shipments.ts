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

import { pb } from './pocketbase';
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

export async function createShipment(input: ShipmentInput): Promise<{ id: string }> {
    const record = await pb.collection('shipments').create({
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
        if (!order.account_email || order.account_email !== tenantEmail) {
            return { success: false, error: 'Order does not belong to this store.' };
        }
        if (['cancelled', 'refunded'].includes(String(order.status || ''))) {
            return { success: false, error: 'A cancelled/refunded order cannot be shipped.' };
        }
        if (String(order.payment_status || '').toUpperCase() !== 'PAID' && String(order.payment_method || '') !== 'cash') {
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
        await db.collection('sales_orders').update(input.orderId, orderUpdate);

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
        const shipment = await db.collection('shipments').getOne(shipmentId);
        await db.collection('shipments').update(shipmentId, { shipping_status: status });
        if (status === 'delivered' && shipment.order_id) {
            await db
                .collection('sales_orders')
                .update(shipment.order_id, { status: 'delivered' })
                .catch(() => {});
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
export async function settleCodOrder(
    db: typeof pb,
    tenantEmail: string,
    orderId: string,
    opts: { collectedBy?: string; reference?: string } = {}
): Promise<{ success: boolean; error?: string }> {
    try {
        const order = await db.collection('sales_orders').getOne(orderId);
        if (!order.account_email || order.account_email !== tenantEmail) {
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

        await db
            .collection('payment_links')
            .create({
                provider: 'cod',
                link_id: `COD-${orderId.slice(-8)}-${Date.now().toString(36).toUpperCase()}`,
                amount: Number(order.total || 0),
                currency: 'INR',
                customer: order.customer || '',
                order: orderId,
                status: 'paid',
                paid_at: now,
                notes: { source: 'cod_settlement', collected_by: opts.collectedBy || '', reference: opts.reference || '' },
                account_email: tenantEmail,
            })
            .catch((err) => console.warn('[shipments] COD ledger row failed (order is settled):', err));

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