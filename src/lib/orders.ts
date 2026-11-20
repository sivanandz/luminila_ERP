/**
 * B2B Sales & Estimates Service Layer
 * CRUD operations for sales orders using PocketBase
 */

import { accountScopeEmail, pb, sanitizeFilter } from '@/lib/pocketbase';
import { toast } from 'sonner';
import type { Customer } from '@/lib/customers';
import { resolveUnitCostMap } from '@/lib/item-cost';
// Aliased: this file's local SalesOrder/SalesOrderItem are narrower order-creation
// payloads, while the database types describe the persisted sales_orders records.
import type {
    ProductVariant,
    SalesOrder as SalesOrderRecord,
    SalesOrderItem as SalesOrderItemRow,
} from '@/types/database';
import { createInvoice, getStoreSettings } from '@/lib/invoice';
import { calculateGST, getStateCode, getGSTRateForHSN } from '@/lib/gst';
import { getNextSequenceNumber, createWithUniqueRetry } from '@/lib/sequence-generator';
import { restoreChannelStockForReference, applyChannelStock, toStockDb, type StockRestoreResult } from '@/lib/channel-stock';
import { allocateDiscountPaise, splitInclusiveLine, toPaise, toRupees } from '@/lib/invoice-math';
import {
    aggregatesWereCounted,
    applyPurchaseReversal,
} from '@/lib/channel-orders';
import { adjustPoints, calculatePointsToEarn } from '@/lib/loyalty';
import { dayKey } from '@/lib/analytics-v2/range';

export type OrderStatus = 'draft' | 'sent' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'invoiced';
export type OrderType = 'estimate' | 'sales_order';

export interface OrderItemInput {
    product_id: string; // Product ID
    variant_id: string; // Variant ID
    description: string;
    quantity: number;
    unit_price: number;
    tax_rate?: number;
    discount_amount?: number;
    total: number;
}

export interface OrderInput {
    order_number?: string;
    order_type: OrderType;
    customer_id?: string;
    customer_name: string;
    customer_phone?: string;
    customer_email?: string;
    billing_address?: string;
    shipping_address?: string;
    order_date?: string;
    valid_until?: string; // For estimates
    expected_delivery_date?: string;
    status: OrderStatus;
    notes?: string;
    internal_notes?: string;
    items: OrderItemInput[];
    // Financials computed from items
    subtotal: number;
    tax_total: number;
    discount_total: number;
    shipping_charges: number;
    total: number;
}

export interface SalesOrder {
    id: string;
    order_number?: string;
    order_type: OrderType;
    customer?: string;
    customer_name: string;
    status: OrderStatus;
    created: string;
    items?: SalesOrderItem[];
}

export interface SalesOrderItem {
    id: string;
    order: string;
    product: string;
    variant: string;
    quantity: number;
    unit_price: number;
    total: number;
}

/** sales_order_items record as written/created and read back for invoicing */
interface SalesOrderItemRecord {
    order: string;
    description: string;
    quantity: number;
    unit_price: number;
    unit_cost?: number | null;
    tax_rate?: number;
    discount_amount?: number;
    total: number;
    product?: string;
    variant?: string;
    expand?: {
        product?: { name?: string; hsn_code?: string; gst_rate?: number; gst_exempt?: boolean };
    };
}

/**
 * Generate sequential order number (SO/YYMM/00001 or EST/YYMM/00001)
 * Resolves WPA-12
 */
export async function generateOrderNumber(orderType: OrderType = 'sales_order'): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const prefix = orderType === 'estimate' ? 'EST' : 'SO';
    const seqName = `${prefix.toLowerCase()}_${yymm}`;

    return getNextSequenceNumber({
        seqName,
        prefix,
        padding: 5,
        formatFn: (nextValue) => `${prefix}/${yymm}/${nextValue.toString().padStart(5, '0')}`,
    });
}

/**
 * Create a new Estimate or Sales Order
 */
export async function createOrder(data: OrderInput) {
    try {
        const tenantEmail = accountScopeEmail();
        // Totals are recomputed from the lines instead of trusting the payload
        // (ORD-3): the client-supplied header/item totals fed invoice discounts,
        // COD settlement and loyalty, so a tampered or stale payload could
        // change what the store charged. Same arithmetic the order create page
        // shows: GST applies to the post-discount base.
        const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
        const lines = data.items.map((item) => {
            const quantity = Number(item.quantity);
            const unitPrice = Number(item.unit_price);
            if (!Number.isFinite(quantity) || quantity < 0) {
                throw new Error(`Invalid quantity for "${item.description || item.product_id}"`);
            }
            if (!Number.isFinite(unitPrice) || unitPrice < 0) {
                throw new Error(`Invalid unit price for "${item.description || item.product_id}"`);
            }
            const taxRate = Math.max(0, Number(item.tax_rate) || 0);
            const gross = round2(quantity * unitPrice);
            const requestedDiscount = Math.max(0, Number(item.discount_amount) || 0);
            const discount = Math.min(requestedDiscount, gross);
            const taxable = round2(gross - discount);
            const tax = round2((taxable * taxRate) / 100);
            return {
                ...item,
                quantity,
                unit_price: unitPrice,
                tax_rate: taxRate,
                discount_amount: discount,
                total: round2(taxable + tax),
                gross,
                taxable,
                tax,
            };
        });
        const subtotal = round2(lines.reduce((sum, line) => sum + line.gross, 0));
        const taxTotal = round2(lines.reduce((sum, line) => sum + line.tax, 0));
        const discountTotal = round2(lines.reduce((sum, line) => sum + line.discount_amount, 0));
        const shippingCharges = round2(Math.max(0, Number(data.shipping_charges) || 0));
        const grandTotal = round2(subtotal - discountTotal + taxTotal + shippingCharges);

        // 1. Create Order Header with Unique Retry (WPA-12)
        const orderData = {
            // Without the tenant stamp the order is invisible to the scoped
            // reads and shipment/COD helpers reject it as "not this store" (ORD-03).
            account_email: tenantEmail,
            order_type: data.order_type,
            customer: data.customer_id, // Relation
            customer_name: data.customer_name,
            customer_phone: data.customer_phone,
            customer_email: data.customer_email,
            billing_address: data.billing_address,
            shipping_address: data.shipping_address,
            order_date: data.order_date || new Date().toISOString(),
            valid_until: data.valid_until,
            expected_delivery_date: data.expected_delivery_date,
            status: data.status,
            notes: data.notes,
            internal_notes: data.internal_notes,
            subtotal,
            tax_total: taxTotal,
            discount_total: discountTotal,
            shipping_charges: shippingCharges,
            total: grandTotal,
        };

        let allocatedOrderNumber = '';
        const order = await createWithUniqueRetry(
            () => generateOrderNumber(data.order_type),
            async (allocatedNumber) => {
                allocatedOrderNumber = data.order_number || allocatedNumber;
                return pb.collection('sales_orders').create({
                    ...orderData,
                    order_number: allocatedOrderNumber,
                });
            }
        );

        // 2. Create Order Items (with cost snapshot for analytics COGS)
        const unitCosts = await resolveUnitCostMap(
            pb,
            (() => {
                const model = pb.authStore.model as { email?: string; account_email?: string } | null;
                return String(model?.account_email || model?.email || '').trim().toLowerCase();
            })(),
            data.items.map((item) => ({ variantId: item.variant_id, productId: item.product_id }))
        ).catch((e) => {
            console.warn('unit-cost resolution failed; order items will omit unit_cost:', e);
            return new Map<string, number>();
        });

        const createdItemIds: string[] = [];
        try {
            for (const item of lines) {
                const itemData: SalesOrderItemRecord & { account_email?: string } = {
                    order: order.id,
                    account_email: tenantEmail,
                    description: item.description,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    unit_cost: unitCosts.get(item.variant_id || item.product_id || '') ?? null,
                    tax_rate: item.tax_rate || 0,
                    discount_amount: item.discount_amount || 0,
                    total: item.total
                };
                if (item.product_id) itemData.product = item.product_id;
                if (item.variant_id) itemData.variant = item.variant_id;
                const rec = await pb.collection('sales_order_items').create(itemData);
                createdItemIds.push(rec.id);
            }
        } catch (itemErr) {
            for (const itemId of createdItemIds) {
                await pb.collection('sales_order_items').delete(itemId).catch(() => {});
            }
            await pb.collection('sales_orders').delete(order.id).catch(() => {});
            throw itemErr;
        }

        // B2B sales orders consume stock when they are confirmed (or already
        // beyond). Estimates and drafts do not. Oversell is rejected and the
        // header/items are removed, so an order can never claim goods the
        // ledger does not have (ORD-02).
        const stockLines = lines
            .filter((item) => Boolean(item.product_id))
            .map((item) => ({
                productId: item.product_id as string,
                variantId: item.variant_id,
                quantity: Number(item.quantity) || 0,
                name: item.description,
            }))
            .filter((line) => line.quantity > 0);
        const consumesStock = data.order_type === 'sales_order'
            && ['confirmed', 'shipped', 'delivered', 'invoiced'].includes(data.status);
        if (consumesStock && stockLines.length > 0) {
            try {
                await applyChannelStock(toStockDb(pb), stockLines, {
                    accountEmail: tenantEmail,
                    channel: 'pos',
                    referenceId: order.id,
                    notes: `B2B Sales Order ${allocatedOrderNumber}`,
                    oversell: 'reject',
                });
            } catch (stockErr) {
                const rows = await pb.collection('sales_order_items')
                    .getFullList({ filter: `order="${sanitizeFilter(order.id)}"` })
                    .catch(() => []);
                for (const row of rows) {
                    await pb.collection('sales_order_items').delete(row.id).catch(() => {});
                }
                await pb.collection('sales_orders').delete(order.id).catch(() => {});
                throw stockErr;
            }
        }

        // Hybrid WhatsApp Campaign Attribution (7-day window / promo code)
        try {
            const { attributeOrderToCampaign } = await import('@/lib/campaign-attribution');
            await attributeOrderToCampaign({
                id: order.id,
                customerPhone: data.customer_phone,
                total: grandTotal,
                promoCode: (data.notes || '').match(/([A-Z0-9]{4,15})/)?.[1],
                created: (order as { created?: string }).created || new Date().toISOString(),
            });
        } catch {
            // Non-blocking attribution check
        }

        return { success: true, orderId: order.id, orderNumber: allocatedOrderNumber };
    } catch (error) {
        console.error('Error creating order:', error);
        toast.error('Failed to create order');
        return { success: false, error };
    }
}

/** Stable 15-char id for an idempotency claim on an order's stock side effects. */
function stockClaimId(orderId: string, action: 'deduct' | 'restore'): string {
    const hash = (input: string, seed: number) => {
        let value = seed >>> 0;
        for (let index = 0; index < input.length; index += 1) {
            value ^= input.charCodeAt(index);
            value = Math.imul(value, 16777619) >>> 0;
        }
        return value >>> 0;
    };
    const key = `${action}:${orderId}`;
    const first = hash(key, 2166136261).toString(36);
    const second = hash(key, 3339675911).toString(36);
    return `stk${`${first}${second}`.padStart(12, '0').slice(0, 12)}`;
}

/** PocketBase reports a client-supplied id clash as a 400 (same rule as COD claims). */
function isDuplicateIdError(error: unknown): boolean {
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

/**
 * Atomically claim one stock side effect per order (O-09). The deterministic
 * id makes two concurrent confirm/convert (or cancel) calls contend on the same
 * row: exactly one creates it; the loser sees a duplicate-id conflict and skips
 * the write. A real fault is rethrown — a stock write is never skipped on a
 * transient error (fail closed).
 */
async function claimStockAction(orderId: string, action: 'deduct' | 'restore', tenantEmail: string): Promise<boolean> {
    try {
        await pb.collection('activity_logs').create({
            id: stockClaimId(orderId, action),
            account_email: tenantEmail,
            entity_type: 'order_stock_claim',
            entity_id: orderId,
            action,
            description: `Idempotency claim: stock ${action} for order ${orderId}`,
            metadata: { orderId, action },
        });
        return true;
    } catch (err) {
        if (isDuplicateIdError(err)) return false;
        throw err;
    }
}

/** Release a claim so a retry can run after a failed stock write. */
async function releaseStockClaim(orderId: string, action: 'deduct' | 'restore'): Promise<void> {
    await pb.collection('activity_logs').delete(stockClaimId(orderId, action)).catch((err) =>
        console.error(`[orders] Could not release ${action} stock claim for ${orderId}:`, err)
    );
}

/**
 * Deduct stock for an order that has just become a confirmed sales order.
 * Reads its persisted lines so estimates converted later take the same path as
 * directly-created orders (ORD-02).
 */
async function deductStockForConfirmedOrder(orderId: string, orderNumber: string, tenantEmail: string): Promise<void> {
    const items = await pb.collection('sales_order_items').getFullList<SalesOrderItemRecord>({
        filter: `order="${sanitizeFilter(orderId)}"`,
    });
    const lines = items
        .filter((item) => Boolean(item.product) && Number(item.quantity) > 0)
        .map((item) => ({
            productId: String(item.product),
            variantId: item.variant || undefined,
            quantity: Number(item.quantity),
            name: item.description,
        }));
    if (lines.length === 0) return;
    if (!(await claimStockAction(orderId, 'deduct', tenantEmail))) return; // already deducted (O-09)
    try {
        await applyChannelStock(toStockDb(pb), lines, {
            accountEmail: tenantEmail,
            channel: 'pos',
            referenceId: orderId,
            notes: `B2B Sales Order ${orderNumber}`,
            oversell: 'reject',
        });
    } catch (err) {
        await releaseStockClaim(orderId, 'deduct');
        throw err;
    }
}

/**
 * Confirm a draft Sales Order and deduct stock
 */
export async function confirmSalesOrder(orderId: string): Promise<boolean> {
    try {
        const order = await pb.collection('sales_orders').getOne(orderId);
        const tenantEmail = accountScopeEmail();
        if (tenantEmail && order.account_email && order.account_email !== tenantEmail) {
            throw new Error('Order does not belong to this store.');
        }
        if (order.status !== 'draft') {
            toast.info(`Order is already ${order.status}`);
            return true;
        }

        await pb.collection('sales_orders').update(orderId, {
            status: 'confirmed',
        });

        try {
            await deductStockForConfirmedOrder(orderId, order.order_number || orderId, tenantEmail);
        } catch (stockErr) {
            await pb.collection('sales_orders').update(orderId, {
                status: 'draft',
            }).catch(() => {});
            throw stockErr;
        }

        toast.success("Sales Order confirmed and stock reserved");
        return true;
    } catch (error) {
        console.error('Error confirming order:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to confirm order');
        return false;
    }
}

/**
 * Convert an Estimate to a Confirmed Sales Order
 */
export async function convertEstimateToOrder(estimateId: string) {
    try {
        const estimate = await pb.collection('sales_orders').getOne(estimateId);
        const tenantEmail = accountScopeEmail();
        if (tenantEmail && estimate.account_email && estimate.account_email !== tenantEmail) {
            throw new Error('Order does not belong to this store.');
        }

        await pb.collection('sales_orders').update(estimateId, {
            order_type: 'sales_order',
            status: 'confirmed',
            order_date: new Date().toISOString() // Reset date to confirmation date
        });

        try {
            await deductStockForConfirmedOrder(estimateId, estimate.order_number || estimateId, tenantEmail);
        } catch (stockErr) {
            // Put the estimate back exactly as it was: a conversion that cannot
            // reserve stock must not leave a confirmed order behind.
            await pb.collection('sales_orders').update(estimateId, {
                order_type: estimate.order_type || 'estimate',
                status: estimate.status || 'draft',
                order_date: estimate.order_date || new Date().toISOString(),
            }).catch(() => {});
            throw stockErr;
        }

        toast.success("Estimate converted to Sales Order");
        return true;
    } catch (error) {
        console.error('Error converting estimate:', error);
        toast.error('Failed to convert estimate');
        return false;
    }
}

/** True only when a PocketBase read failed because nothing matched. */
function isNotFoundError(err: unknown): boolean {
    return (err as { status?: number })?.status === 404;
}

/**
 * Generate an Invoice from a Sales Order
 */
export async function generateInvoiceFromOrder(orderId: string, db: typeof pb = pb) {
    const pb = db;
    try {
        const order = await pb.collection('sales_orders').getOne(orderId);
        const tenantEmailForRead = accountScopeEmail();
        if (tenantEmailForRead && order.account_email && order.account_email !== tenantEmailForRead) {
            throw new Error('Order does not belong to this store.');
        }

        if (order.status === 'cancelled') {
            throw new Error('Cannot generate an invoice for a cancelled order.');
        }

        // If the order is draft, deduct stock before raising invoice
        if (order.status === 'draft' && order.order_type === 'sales_order') {
            await deductStockForConfirmedOrder(orderId, order.order_number || orderId, tenantEmailForRead);
        }

        // Idempotency: a retry after the order status update failed must reuse
        // the invoice that already exists rather than raising a second one for
        // the same order.
        const invoiceTenantClause = tenantEmailForRead
            ? ` && account_email="${sanitizeFilter(tenantEmailForRead)}"`
            : '';
        const listInvoicesForOrder = async (): Promise<{ id: string; invoice_number?: string }[]> => {
            try {
                return await pb.collection('invoices').getFullList<{ id: string; invoice_number?: string }>({
                    filter: `order="${sanitizeFilter(orderId)}"${invoiceTenantClause}`,
                    sort: 'created,id',
                });
            } catch (err) {
                // Only a genuine "nothing matched" may be read as "no invoice
                // exists"; a transient error was silently treated as such and
                // let a retry raise a duplicate invoice (ORD-2).
                if (isNotFoundError(err)) return [];
                throw err;
            }
        };
        const existingInvoices = await listInvoicesForOrder();
        if (existingInvoices.length > 0) {
            if (order.status !== 'invoiced') {
                await pb.collection('sales_orders').update(orderId, { status: 'invoiced' }).catch(() => {});
            }
            return { success: true, order, invoice: existingInvoices[0], alreadyInvoiced: true };
        }

        const orderItems = await pb.collection('sales_order_items').getFullList<SalesOrderItemRecord>({
            filter: `order="${sanitizeFilter(orderId)}"${tenantEmailForRead ? ` && account_email="${sanitizeFilter(tenantEmailForRead)}"` : ''}`,
            expand: 'product',
        });

        const store = await getStoreSettings(db);
        const isGstRegistered = store.is_gst_registered !== false && Boolean(store.store_gstin);

        // WPA-13 fix: sales_orders has no buyer_state_code/place_of_supply field
        // (and createOrder never writes one), so derive the CGST/SGST vs IGST
        // split from the order's customer record instead of silently falling
        // back to the seller state, which forced every invoice intra-state.
        // Derive the seller state from configuration, then from the GSTIN, before
        // any last resort: the old hardcoded '27' filed Maharashtra invoices for
        // stores that had never configured a state at all.
        const gstinState = String(store.store_gstin || '').trim().substring(0, 2);
        const sellerStateCode =
            store.store_state_code ||
            (/^\d{2}$/.test(gstinState) ? gstinState : '') ||
            '27';
        // Place of supply: prefer the buyer state captured on the order itself
        // (CO-14 — the web channel writes buyer_state_code/place_of_supply).
        // Fall back to the customer profile for orders created before the field
        // existed, then to the seller state only as a last resort.
        const orderPlace = order as {
            buyer_state_code?: string;
            place_of_supply?: string;
            buyer_gstin?: string;
            buyer_company?: string;
        };
        let buyerStateCode = String(
            orderPlace.buyer_state_code || orderPlace.place_of_supply || ''
        ).trim();
        // The order's own GSTIN wins: the customer profile can change later.
        let buyerGstin = String(orderPlace.buyer_gstin || '').trim();
        if (order.customer) {
            try {
                const customer = await pb.collection('customers').getOne<Customer>(order.customer);
                if (!buyerGstin) buyerGstin = String(customer.gstin || '').trim();
                if (!buyerStateCode) {
                    const gstinStateCode = buyerGstin.substring(0, 2);
                    buyerStateCode =
                        customer.state_code ||
                        getStateCode(customer.state || '') ||
                        (/^\d{2}$/.test(gstinStateCode) ? gstinStateCode : '') ||
                        sellerStateCode;
                }
            } catch {
                // Customer lookup failed — keep the order's own code, else seller.
            }
        }
        if (!buyerStateCode) buyerStateCode = sellerStateCode;

        // Storefront prices are what the buyer was quoted and already include
        // GST; treating them as tax-exclusive added 3% on top a second time
        // (ORD-05). B2B/POS-order prices are quoted before tax.
        const orderSource = String(
            (order as unknown as { capture_source?: string }).capture_source || ''
        ).trim().toLowerCase();
        const pricesIncludeGst = orderSource === 'storefront';

        // Storefront coupons live only on the order header (no per-line
        // discount_amount). Allocate that discount across the lines before tax
        // is back-computed, else the invoice overstates taxable value, GST and
        // the grand total on every couponed web order (C-05).
        const headerDiscountShares = allocateDiscountPaise(
            orderItems.map((item) => toPaise((item.unit_price || 0) * (item.quantity || 1))),
            pricesIncludeGst ? toPaise(order.discount_total || 0) : 0
        );

        const invoiceItems = orderItems.map((item, idx: number) => {
            // Taxable value is net of the line discount (sales_order_items stores
            // discount_amount alongside a post-discount total); GST applies to
            // the post-discount base so taxable + tax == line total.
            const gross = (item.unit_price || 0) * (item.quantity || 1);
            const taxable = Math.max(0, gross - (item.discount_amount || 0) - toRupees(headerDiscountShares[idx]));
            // Nullish, not ||: an explicitly exempt line stays at 0%, while a
            // missing rate falls back to the product rate instead of silently
            // producing a 0% GST invoice.
            const product = item.expand?.product;
            // Zero is "not configured", not a rate (C-01 / migration 1793003401):
            // stored tax_rate/gst_rate default to 0 and `??` treated them as
            // configured, leaving the HSN fallback unreachable — unconfigured
            // products billed 0% GST on this path while POS billed correctly.
            const configuredRate = product?.gst_exempt
                ? 0
                : item.tax_rate && item.tax_rate > 0
                  ? item.tax_rate
                  : product?.gst_rate && product.gst_rate > 0
                    ? product.gst_rate
                    : getGSTRateForHSN(product?.hsn_code || '');
            const gstRate = isGstRegistered ? configuredRate : 0;

            if (pricesIncludeGst) {
                const split = splitInclusiveLine(
                    toPaise(taxable),
                    gstRate,
                    sellerStateCode,
                    buyerStateCode
                );
                return {
                    sr_no: idx + 1,
                    variant_id: item.variant || '',
                    description: item.description || 'Jewelry Item',
                    hsn_code: product?.hsn_code || '7113',
                    quantity: item.quantity || 1,
                    unit: 'PCS',
                    unit_price: item.unit_price || 0,
                    discount_percent: 0,
                    discount_amount: item.discount_amount || 0,
                    taxable_amount: toRupees(split.taxablePaise),
                    gst_rate: gstRate,
                    cgst_rate: split.cgstRate,
                    cgst_amount: toRupees(split.cgstPaise),
                    sgst_rate: split.sgstRate,
                    sgst_amount: toRupees(split.sgstPaise),
                    igst_rate: split.igstRate,
                    igst_amount: toRupees(split.igstPaise),
                    cess_rate: split.cessRate,
                    cess_amount: toRupees(split.cessPaise),
                    total_amount: toRupees(split.totalPaise),
                };
            }

            const gst = calculateGST(taxable, sellerStateCode, buyerStateCode, gstRate);
            return {
                sr_no: idx + 1,
                variant_id: item.variant || '',
                description: item.description || 'Jewelry Item',
                hsn_code: product?.hsn_code || '7113',
                quantity: item.quantity || 1,
                unit: 'PCS',
                unit_price: item.unit_price || 0,
                discount_percent: 0,
                discount_amount: item.discount_amount || 0,
                taxable_amount: gst.taxableAmount,
                gst_rate: gstRate,
                cgst_rate: gst.cgstRate,
                cgst_amount: gst.cgstAmount,
                sgst_rate: gst.sgstRate,
                sgst_amount: gst.sgstAmount,
                igst_rate: gst.igstRate,
                igst_amount: gst.igstAmount,
                cess_rate: 0,
                cess_amount: 0,
                total_amount: gst.grandTotal
            };
        });

        // Header totals are summed from the (post-discount, per-item-rate) lines
        // so the invoice is arithmetically self-consistent; the order header's
        // subtotal/tax_total were computed on the pre-discount base and can
        // disagree with the lines (invoice.ts does the same for POS sales).
        const subtotal = invoiceItems.reduce((acc, it) => acc + it.taxable_amount, 0);
        const totalTax = isGstRegistered
            ? invoiceItems.reduce((acc, it) => acc + it.cgst_amount + it.sgst_amount + it.igst_amount, 0)
            : 0;
        const shippingCharges = order.shipping_charges || 0;
        const grandTotal = subtotal + totalTax + shippingCharges;

        const invoice = await createInvoice({
            // P-11: the invoice date is the business-local calendar day, not the
            // UTC day — GSTR-1 files by this date (H-22 local-day windows), and
            // toISOString() back-dated every invoice raised between 00:00 and
            // 05:29 IST into the previous month (or financial year).
            invoice_date: dayKey(new Date()),
            invoice_type: 'regular',
            order_id: orderId,
            customer_id: order.customer || '',
            status: 'pending',
            seller_gstin: isGstRegistered ? (store.store_gstin || '') : '',
            seller_name: store.store_name || 'Luminila Jewelry',
            seller_address: `${store.store_address || ''} ${store.store_city || ''}`.trim(),
            seller_state_code: store.store_state_code || '27',
            buyer_name: orderPlace.buyer_company || order.customer_name || 'Walk-in Customer',
            buyer_gstin: buyerGstin,
            buyer_phone: order.customer_phone || '',
            buyer_email: order.customer_email || '',
            buyer_address: order.billing_address || order.shipping_address || '',
            buyer_state_code: buyerStateCode,
            place_of_supply: buyerStateCode,
            subtotal: subtotal,
            tax: totalTax,
            // Header discount is already netted into the lines (per-line
            // discount_amount on B2B, allocated coupon on storefront), so
            // repeating it here makes the printed total wrong (O-15).
            discount: 0,
            total: grandTotal,
            taxable_value: subtotal,
            cgst_amount: invoiceItems.reduce((acc, it) => acc + it.cgst_amount, 0),
            sgst_amount: invoiceItems.reduce((acc, it) => acc + it.sgst_amount, 0),
            igst_amount: invoiceItems.reduce((acc, it) => acc + it.igst_amount, 0),
            cess_amount: 0,
            total_tax: totalTax,
            discount_amount: 0,
            shipping_charges: order.shipping_charges || 0,
            grand_total: grandTotal,
            amount_in_words: '',
            is_reverse_charge: false,
            is_paid: false,
            paid_amount: 0,
            notes: order.notes || `Generated from Sales Order #${order.order_number || orderId}`,
            items: invoiceItems
        }, db);

        // Two concurrent calls can both pass the pre-check because the
        // collection has no unique constraint on `order`. Re-read after the
        // create and converge on the oldest invoice: the loser removes its own
        // header and lines, so the order is never double-invoiced (ORD-2).
        const invoicesAfterCreate = await listInvoicesForOrder();
        const canonical = invoicesAfterCreate[0];
        if (canonical && invoice.id && canonical.id !== invoice.id) {
            const createdItems = await pb
                .collection('invoice_items')
                .getFullList<{ id: string }>({
                    filter: `invoice="${sanitizeFilter(invoice.id)}"${invoiceTenantClause}`,
                })
                .catch((err) => {
                    if (isNotFoundError(err)) return [];
                    throw err;
                });
            for (const item of createdItems) {
                await pb.collection('invoice_items').delete(item.id).catch(() => {});
            }
            await pb.collection('invoices').delete(invoice.id).catch(() => {});
            if (order.status !== 'invoiced') {
                await pb.collection('sales_orders').update(orderId, { status: 'invoiced' }).catch(() => {});
            }
            return { success: true, order, invoice: canonical, alreadyInvoiced: true };
        }

        // Mark order as invoiced
        await pb.collection('sales_orders').update(orderId, { status: 'invoiced' });

        return { success: true, order, invoice };
    } catch (error) {
        console.error('Error generating invoice:', error);
        toast.error('Failed to generate invoice');
        return { success: false };
    }
}

/**
 * Fetch all orders with optional filters
 */
export async function getOrders(type?: OrderType, status?: OrderStatus) {
    try {
        const tenant = accountScopeEmail();
        // No resolved tenant means no tenant's register may be listed; the old
        // `id != ""` placeholder returned every tenant's orders (ORD-15).
        if (!tenant) return [];
        const filterParts: string[] = [`account_email="${sanitizeFilter(tenant)}"`];
        if (type) filterParts.push(`order_type="${type}"`);
        if (status) filterParts.push(`status="${status}"`);

        const records = await pb.collection('sales_orders').getFullList({
            filter: filterParts.join(' && '),
            sort: '-order_date'
        });
        return records;
    } catch (error) {
        console.error('Error fetching orders:', error);
        return [];
    }
}

/**
 * Get single order details
 */
/**
 * sales_order_items row as consumed by the order detail page: the variant
 * relation id is resolved to the expanded ProductVariant record.
 */
export interface OrderDetailItem extends Omit<SalesOrderItemRow, 'variant'> {
    variant?: ProductVariant;
}

export type OrderDetail = SalesOrderRecord & {
    created_at?: string; // legacy timestamp fallback for order.created
    items?: OrderDetailItem[];
};

export async function getOrderDetails(id: string): Promise<OrderDetail | null> {
    try {
        const order = await pb.collection('sales_orders').getOne<SalesOrderRecord>(id);
        const tenant = accountScopeEmail();
        const owner = (order as unknown as { account_email?: string }).account_email;
        if (tenant && owner && owner !== tenant) return null;

        // Fetch items separately as reverse expand is tricky in getOne sometimes if not configured
        const rawItems = await pb.collection('sales_order_items').getFullList<
            Omit<OrderDetailItem, 'variant'> & {
                variant?: string | ProductVariant;
                expand?: { variant?: ProductVariant; product?: { id?: string; sku?: string } };
            }
        >({
            filter: `order="${sanitizeFilter(id)}"${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
            expand: 'product,variant'
        });

        // PocketBase keeps relation fields as record-id strings and puts the
        // expanded records under `expand`. The OrderDetailItem contract (and
        // every consumer, e.g. the variant attribute line on the detail page)
        // expects `variant` to be the object, so normalise it here once.
        const items: OrderDetailItem[] = rawItems.map((item) => ({
            ...item,
            variant:
                item.expand?.variant ??
                (item.variant && typeof item.variant === 'object' ? item.variant : undefined),
        }));

        return {
            ...order,
            items
        };
    } catch (error) {
        console.error('Error fetching order details:', error);
        return null;
    }
}

export interface DispatchableOrder {
    id: string;
    order_number?: string;
    customer_name?: string;
    customer_phone?: string | null;
    status?: string;
    total?: number;
    shipping_address?: string;
    created?: string;
}

/** Sales orders that can still be dispatched. */
export async function getDispatchableOrders(): Promise<DispatchableOrder[]> {
    const tenant = accountScopeEmail();
    // Same tenant rule as getOrders: no scope, no list (ORD-15).
    if (!tenant) return [];
    const records = await pb.collection('sales_orders').getList(1, 30, {
        // Only real sales orders that reached a fulfilable state and are either
        // paid or cash-on-delivery. Estimates, drafts and unpaid online orders
        // were previously returned and could be marked shipped (ORD-08/ORD-10).
        filter:
            `order_type = "sales_order" && (status = "confirmed" || status = "invoiced")` +
            ` && (payment_status = "PAID" || payment_method = "cash" || payment_method = "cod" || payment_method = "cash_on_delivery")` +
            ` && account_email="${sanitizeFilter(tenant)}"`,
        sort: '-created',
    });
    return records.items;
}

export async function markSalesOrderShipped(orderId: string): Promise<void> {
    const order = await pb.collection('sales_orders').getOne<{
        status?: string;
        account_email?: string;
        payment_status?: string;
        payment_method?: string;
    }>(orderId);
    const tenant = accountScopeEmail();
    if (tenant && order.account_email && order.account_email !== tenant) {
        throw new Error('Order does not belong to this store.');
    }
    const status = String(order.status || '');
    if (status !== 'confirmed' && status !== 'invoiced') {
        throw new Error(
            `Only confirmed or invoiced orders can be marked shipped (order is "${status || 'unknown'}").`
        );
    }
    // Same dispatch gate as getDispatchableOrders: paid, or explicitly COD.
    // Flipping the status directly let unpaid online orders ship (ORD-12).
    const method = String(order.payment_method || '').toLowerCase();
    const isCashOnDelivery = ['cash', 'cod', 'cash_on_delivery'].includes(method);
    if (String(order.payment_status || '').toUpperCase() !== 'PAID' && !isCashOnDelivery) {
        throw new Error('Only paid orders (or COD) can be marked shipped.');
    }
    // Dispatch needs a carrier record; without an AWB there is no shipment
    // trail to track or reconcile.
    let shipment: { id: string } | null = null;
    try {
        shipment = await pb.collection('shipments').getFirstListItem<{ id: string }>(
            `order_id="${sanitizeFilter(orderId)}" && awb_number != ""${
                tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''
            }`
        );
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }
    if (!shipment) {
        throw new Error('Create a shipment with an AWB number before marking the order shipped.');
    }
    await pb.collection('sales_orders').update(orderId, { status: 'shipped' });
}
/**
 * Orders that may still be cancelled. Draft/sent/confirmed orders and pre-dispatch
 * invoiced orders may be cancelled (invoiced cancellation voids linked invoices &
 * packing rows once verified not in transit/delivered); shipped/delivered orders
 * must go through the returns/credit-note flow.
 */
export function canCancelSalesOrder(status: OrderStatus): boolean {
    return status === 'draft' || status === 'sent' || status === 'confirmed' || status === 'invoiced';
}

export interface CancelOrderResult {
    success: boolean;
    orderId: string;
    restored: number;
    alreadyRestored: boolean;
    alreadyCancelled: boolean;
    /** True when the cancellation carried a refund reference (paid order). */
    paymentReversed?: boolean;
}

/**
 * Cancel a sales order and put its channel stock back.
 *
 * The restore is ledger-driven and idempotent: it reverses whichever channel
 * deducted the stock (WhatsApp, storefront, POS) for this order reference.
 * Cancelling is refused for shipped/invoiced orders, whose reversal must go
 * through returns with a credit note.
 *
 * CO-15: a PAID order may only be cancelled together with a refund reference.
 * Cancelling it otherwise restores stock while the CRM still reports paid
 * revenue for an order that no longer exists. Open payment links and the POS
 * `sales` mirror are closed in the same operation.
 */
export async function cancelSalesOrder(
    orderId: string,
    options: { reason?: string; cancelledBy?: string; refundReference?: string } = {}
): Promise<CancelOrderResult> {
    const order = await pb.collection('sales_orders').getOne<{
        status?: OrderStatus;
        internal_notes?: string;
        order_type?: OrderType;
        payment_status?: string;
        order_number?: string;
        total?: number;
        customer?: string;
        account_email?: string;
    }>(orderId);

    // Cancelling restored stock and reversed counters by bare id, so any tenant
    // holding an order id could cancel another store's order (ORD-1).
    const tenant = accountScopeEmail();
    if (tenant && order.account_email && order.account_email !== tenant) {
        throw new Error('Order does not belong to this store.');
    }

    if (order.status === 'cancelled') {
        return { success: true, orderId, restored: 0, alreadyRestored: true, alreadyCancelled: true };
    }
    if (order.status && !canCancelSalesOrder(order.status)) {
        throw new Error(
            `Cannot cancel an order with status "${order.status}". Dispatched orders are reversed through returns.`
        );
    }

    if (order.status === 'invoiced') {
        // H-18: a failed shipment read must not read as "nothing dispatched" —
        // that let a dispatched order be cancelled. Only not-found degrades.
        let activeShipments: { id: string; shipping_status?: string }[] = [];
        try {
            activeShipments = await pb
                .collection('shipments')
                .getFullList<{ id: string; shipping_status?: string }>({
                    filter: pb.filter('order_id = {:order}', { order: orderId }),
                    requestKey: null,
                });
        } catch (err) {
            if (!isNotFoundError(err)) throw err;
        }
        const dispatched = activeShipments.find(
            (s) => s.shipping_status === 'in_transit' || s.shipping_status === 'delivered'
        );
        if (dispatched) {
            throw new Error(
                `Cannot cancel invoiced order #${order.order_number || orderId} because shipment is already ${dispatched.shipping_status}. Reversal must go through returns with a credit note.`
            );
        }
    }

    const paymentStatus = String(order.payment_status || '').toUpperCase();
    const refundReference = (options.refundReference || '').trim();
    if (paymentStatus === 'PAID' && !refundReference) {
        throw new Error(
            'This order is marked PAID. Refund the payment first, then retry with the refund reference so the cancellation stays auditable.'
        );
    }

    // Two concurrent cancels both read a non-cancelled status; the atomic claim
    // lets exactly one restore stock (O-09).
    const restoreTenant = order.account_email || tenant || '';
    if (!(await claimStockAction(orderId, 'restore', restoreTenant))) {
        // The claim holder may have finished cancelling since this invocation
        // read the order — re-read before deciding (the local `order.status`
        // was narrowed non-cancellable by the guards above).
        const fresh = await pb.collection('sales_orders').getOne<{ status?: string }>(orderId);
        if (String(fresh.status || '') === 'cancelled') {
            return { success: true, orderId, restored: 0, alreadyRestored: true, alreadyCancelled: true };
        }
        // B2: the restore claim is held but the order never reached
        // `cancelled` — a previous attempt restored stock and then failed
        // partway. Reporting success here left a live order the UI believed
        // was cancelled, its invoice and payment links still open. Surface
        // it; the claim is never released automatically.
        throw new Error(
            `A previous cancellation attempt for order #${order.order_number || orderId} restored its stock but did not finish cancelling. Resolve the stuck attempt before retrying.`
        );
    }
    let restore: StockRestoreResult;
    try {
        restore = await restoreChannelStockForReference(toStockDb(pb), {
            referenceId: orderId,
            // The order's own owner is the only tenant whose variants may be restored.
            accountEmail: order.account_email || tenant,
            notes: options.reason ? `Cancelled: ${options.reason}` : undefined,
        });
    } catch (err) {
        await releaseStockClaim(orderId, 'restore');
        throw err;
    }

    // CO-15 residual: reverse lifetime counters and loyalty points when the
    // order actually counted them. The marker is written by the counting site
    // (web intake for COD/concierge, paid webhook for online orders), so an
    // online draft that never settled is not decremented.
    if (aggregatesWereCounted(order.internal_notes)) {
        const amount = Number(order.total) || 0;
        await applyPurchaseReversal(pb, order.customer || '', amount);
        if (order.customer) {
            try {
                const points = await calculatePointsToEarn(amount);
                if (points > 0) {
                    await adjustPoints(
                        order.customer,
                        -points,
                        `Order ${order.order_number || orderId} cancelled`
                    );
                }
            } catch (loyaltyErr) {
                // A legacy order may not have a loyalty account or enough
                // balance; that must not block the cancellation.
                console.warn('[orders] loyalty reversal skipped:', loyaltyErr);
            }
        }
    }

    // Close any still-open payment links for this order (CO-15). Scoped to the
    // tenant: an unscoped, unsanitized `order` filter let a cancel touch
    // another store's links (ORD-1).
    const openLinks = await pb
        .collection('payment_links')
        .getFullList<{ id: string; status?: string }>({
            filter:
                `order="${sanitizeFilter(orderId)}" && status != "cancelled" && status != "paid"` +
                `${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
        })
        .catch(() => []);
    for (const link of openLinks) {
        await pb.collection('payment_links').update(link.id, { status: 'cancelled' }).catch(() => {});
    }

    // Keep the POS revenue mirror in step with the order lifecycle (CO-15).
    if (order.order_number) {
        const mirrors = await pb
            .collection('sales')
            .getFullList<{ id: string }>({
                filter:
                    `channel_order_id="${sanitizeFilter(order.order_number)}"` +
                    `${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
            })
            .catch(() => []);
        for (const mirror of mirrors) {
            await pb.collection('sales').update(mirror.id, { status: 'cancelled' }).catch(() => {});
        }
    }

    // Void any linked non-cancelled invoices and packing sessions when
    // pre-dispatch cancelling. H-19: the lookup, not the order's status field,
    // decides — generateInvoiceFromOrder can leave a live invoice on an order
    // whose invoiced-status update was swallowed, and gating on
    // `status === 'invoiced'` let that invoice survive cancellation.
    const linkedInvoices = await pb
        .collection('invoices')
        .getFullList<{ id: string; status?: string }>({
            filter: `order="${sanitizeFilter(orderId)}"${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
            requestKey: null,
        })
        .catch(() => []);
    for (const inv of linkedInvoices) {
        if (inv.status !== 'cancelled') {
            await pb.collection('invoices').update(inv.id, { status: 'cancelled' }).catch(() => {});
        }
    }

    const packingSessions = await pb
        .collection('order_packing')
        .getFullList<{ id: string; status?: string }>({
            filter: `order_id="${sanitizeFilter(orderId)}"${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
            requestKey: null,
        })
        .catch(() => []);
    for (const pack of packingSessions) {
        if (pack.status !== 'cancelled') {
            await pb.collection('order_packing').update(pack.id, { status: 'cancelled' }).catch(() => {});
        }
    }

    const stamp = new Date().toISOString();
    const auditLine = `[cancelled ${stamp}${options.cancelledBy ? ` by ${options.cancelledBy}` : ''}${
        options.reason ? ` — ${options.reason}` : ''
    }${refundReference ? ` | refund ${refundReference}` : ''}]`;
    const update: Record<string, unknown> = {
        status: 'cancelled',
        internal_notes: [order.internal_notes, auditLine].filter(Boolean).join('\n'),
    };
    if (refundReference) update.payment_status = 'REFUNDED';

    await pb.collection('sales_orders').update(orderId, update);

    return {
        success: true,
        orderId,
        restored: restore.restored,
        alreadyRestored: restore.alreadyRestored,
        alreadyCancelled: false,
        paymentReversed: Boolean(refundReference),
    };
}

/** Split selected quantities from an open sales order into a linked backorder record. */
export async function splitOrderForBackorder(
    orderId: string,
    backorderItems: Array<{ orderItemId: string; splitQuantity: number }>,
    reason?: string
): Promise<{ parentOrderId: string; backorderId: string; backorderNumber: string }> {
    const tenant = accountScopeEmail();
    const order = await pb.collection('sales_orders').getOne<SalesOrderRecord>(orderId);
    if (tenant && order.account_email && order.account_email !== tenant) {
        throw new Error('Order does not belong to this store.');
    }
    if (!['draft', 'sent', 'confirmed'].includes(order.status)) {
        throw new Error(`Cannot split order in "${order.status}" status.`);
    }

    const items = await pb.collection('sales_order_items').getFullList<
        SalesOrderItemRecord & { id: string; account_email?: string; variant?: string }
    >({
        filter: `order="${sanitizeFilter(orderId)}"${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
    });
    if (items.length === 0) {
        throw new Error('Order has no line items to split.');
    }

    const requestedMap = new Map<string, number>();
    for (const entry of backorderItems) {
        const qty = Math.floor(Number(entry.splitQuantity) || 0);
        if (qty > 0) {
            requestedMap.set(entry.orderItemId, (requestedMap.get(entry.orderItemId) || 0) + qty);
        }
    }
    if (requestedMap.size === 0) {
        throw new Error('Select at least one item quantity to split into the backorder.');
    }

    let remainingTotalQty = 0;
    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

    type SplitPlan = {
        row: SalesOrderItemRecord & { id: string; account_email?: string; variant?: string };
        splitQty: number;
        remainQty: number;
        childDiscount: number;
        remainDiscount: number;
        childTotal: number;
        remainTotal: number;
        childTax: number;
        remainTax: number;
        childGross: number;
        remainGross: number;
    };

    const plans: SplitPlan[] = items.map((row) => {
        const splitQty = requestedMap.get(row.id) || 0;
        if (splitQty < 0 || splitQty > row.quantity) {
            throw new Error(`Invalid split quantity (${splitQty}) for "${row.description}".`);
        }
        const remainQty = row.quantity - splitQty;
        remainingTotalQty += remainQty;
        const unitPrice = Number(row.unit_price) || 0;
        const taxRate = Math.max(0, Number(row.tax_rate) || 0);
        const origDiscount = Math.max(0, Number(row.discount_amount) || 0);
        const childGross = round2(splitQty * unitPrice);
        const remainGross = round2(remainQty * unitPrice);
        const childDiscount = row.quantity > 0 ? round2((origDiscount * splitQty) / row.quantity) : 0;
        const remainDiscount = round2(Math.max(0, origDiscount - childDiscount));
        const childTaxable = round2(Math.max(0, childGross - childDiscount));
        const remainTaxable = round2(Math.max(0, remainGross - remainDiscount));
        const childTax = round2((childTaxable * taxRate) / 100);
        const remainTax = round2((remainTaxable * taxRate) / 100);
        return {
            row,
            splitQty,
            remainQty,
            childDiscount,
            remainDiscount,
            childTotal: round2(childTaxable + childTax),
            remainTotal: round2(remainTaxable + remainTax),
            childTax,
            remainTax,
            childGross,
            remainGross,
        };
    });

    if (remainingTotalQty <= 0) {
        throw new Error('At least one unit must remain on the parent order when creating a backorder.');
    }

    const childLines = plans.filter((p) => p.splitQty > 0);
    const childSubtotal = round2(childLines.reduce((s, p) => s + p.childGross, 0));
    const childTaxTotal = round2(childLines.reduce((s, p) => s + p.childTax, 0));
    const childDiscountTotal = round2(childLines.reduce((s, p) => s + p.childDiscount, 0));
    const childGrandTotal = round2(childSubtotal - childDiscountTotal + childTaxTotal);

    const remainSubtotal = round2(plans.reduce((s, p) => s + p.remainGross, 0));
    const remainTaxTotal = round2(plans.reduce((s, p) => s + p.remainTax, 0));
    const remainDiscountTotal = round2(plans.reduce((s, p) => s + p.remainDiscount, 0));
    const parentShipping = round2(Math.max(0, Number(order.shipping_charges) || 0));
    const remainGrandTotal = round2(remainSubtotal - remainDiscountTotal + remainTaxTotal + parentShipping);

    // derive the next suffix from existing children so repeated splits of the
    // same order never regenerate an already-used -BO number (O-14).
    const parentNumber = order.order_number || order.id;
    const siblings = await pb.collection('sales_orders').getFullList<{ order_number?: string }>({
        filter: `order_number ~ "${sanitizeFilter(parentNumber)}-BO"${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
        fields: 'order_number',
    });
    const nextSeq = siblings.reduce((max, s) => {
        const match = String(s.order_number || '').match(/-BO(\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    let allocatedBoNumber = '';
    const backorderStatus: OrderStatus = order.status === 'confirmed' ? 'confirmed' : 'draft';
    const childOrder = await createWithUniqueRetry(
        () => Promise.resolve(`${parentNumber}-BO${nextSeq}`),
        async (allocated) => {
            allocatedBoNumber = allocated;
            return pb.collection('sales_orders').create<SalesOrderRecord>({
                account_email: tenant || order.account_email,
                order_type: order.order_type || 'sales_order',
                order_number: allocated,
                customer: order.customer,
                customer_name: order.customer_name,
                customer_phone: order.customer_phone,
                customer_email: order.customer_email,
                billing_address: order.billing_address,
                shipping_address: order.shipping_address,
                order_date: new Date().toISOString(),
                expected_delivery_date: order.expected_delivery_date,
                status: backorderStatus,
                notes: `Backorder split from #${order.order_number || order.id}${reason ? ` (${reason})` : ''}`,
                internal_notes: `Split from parent order ${order.id}${reason ? `: ${reason}` : ''}`,
                subtotal: childSubtotal,
                tax_total: childTaxTotal,
                discount_total: childDiscountTotal,
                shipping_charges: 0,
                total: childGrandTotal,
            });
        }
    );

    try {
        for (const p of childLines) {
            await pb.collection('sales_order_items').create({
                order: childOrder.id,
                account_email: tenant || order.account_email,
                description: p.row.description,
                quantity: p.splitQty,
                unit_price: p.row.unit_price,
                unit_cost: p.row.unit_cost ?? null,
                tax_rate: p.row.tax_rate || 0,
                discount_amount: p.childDiscount,
                total: p.childTotal,
                ...(p.row.product ? { product: p.row.product } : {}),
                ...(p.row.variant ? { variant: p.row.variant } : {}),
            });
        }

        // Update or remove parent order line items & rebalance stock_movements if confirmed
        const movements = order.status === 'confirmed'
            ? await pb
                .collection('stock_movements')
                .getFullList<{ id: string; variant?: string; quantity: number; source?: string; notes?: string }>({
                    filter: `reference_id="${sanitizeFilter(orderId)}"${tenant ? ` && account_email="${sanitizeFilter(tenant)}"` : ''}`,
                })
            : [];

        for (const p of childLines) {
            if (p.remainQty <= 0) {
                await pb.collection('sales_order_items').delete(p.row.id);
            } else {
                await pb.collection('sales_order_items').update(p.row.id, {
                    quantity: p.remainQty,
                    discount_amount: p.remainDiscount,
                    total: p.remainTotal,
                });
            }

            if (p.row.variant && movements.length > 0) {
                const mv = movements.find((m) => m.variant === p.row.variant && Number(m.quantity) < 0);
                if (mv) {
                    const origSigned = Number(mv.quantity);
                    const movedOut = -Math.min(p.splitQty, Math.abs(origSigned));
                    const remainSigned = origSigned - movedOut;
                    if (movedOut !== 0) {
                        if (remainSigned === 0) {
                            await pb.collection('stock_movements').update(mv.id, {
                                reference_id: childOrder.id,
                                notes: `Reassigned to backorder ${allocatedBoNumber}`,
                            });
                        } else {
                            await pb.collection('stock_movements').update(mv.id, {
                                quantity: remainSigned,
                            });
                            await pb.collection('stock_movements').create({
                                variant: p.row.variant,
                                movement_type: 'sale',
                                quantity: movedOut,
                                reference_id: childOrder.id,
                                source: mv.source || 'pos',
                                account_email: tenant || order.account_email || '',
                                notes: `Split from order ${order.order_number || orderId} to backorder ${allocatedBoNumber}`,
                            });
                        }
                    }
                }
            }
        }

        const parentNote = `[${new Date().toISOString()}] Split backorder #${allocatedBoNumber} (${childOrder.id})${reason ? ` — ${reason}` : ''}`;
        await pb.collection('sales_orders').update(orderId, {
            subtotal: remainSubtotal,
            tax_total: remainTaxTotal,
            discount_total: remainDiscountTotal,
            total: remainGrandTotal,
            internal_notes: [order.internal_notes, parentNote].filter(Boolean).join('\n'),
        });

        return {
            parentOrderId: orderId,
            backorderId: childOrder.id,
            backorderNumber: allocatedBoNumber,
        };
    } catch (err) {
        // Best-effort cleanup of incomplete child order if line writes fail
        const childRows = await pb.collection('sales_order_items')
            .getFullList<{ id: string }>({ filter: `order="${sanitizeFilter(childOrder.id)}"` })
            .catch(() => []);
        for (const r of childRows) {
            await pb.collection('sales_order_items').delete(r.id).catch(() => {});
        }
        await pb.collection('sales_orders').delete(childOrder.id).catch(() => {});
        throw err;
    }
}
