/**
 * POS Sales Service Layer
 * Handles creating sales from POS transactions and persisting to PocketBase
 * 
 * Flow:
 * 1. Create sale record in 'sales' collection
 * 2. Create sale_items for each cart item
 * 3. Create stock movements (decrement inventory)
 * 4. Update shift totals
 * 5. Generate invoice from sale
 */

import { pb, getCurrentTenantEmail, sanitizeFilter } from './pocketbase';
import { createInvoiceFromSale } from './invoice';
import { enqueueTask } from './concurrency';
import { adjustLocationStock } from './multi-location';
import { applyChannelStock, toStockDb } from './channel-stock';
import { resolveUnitCostMap } from './item-cost';
import type { Sale } from '../types/database';

// ============================================
// TYPES
// ============================================

export interface POSCartItem {
    id: string;           // Cart item ID (temporary)
    sku: string;
    name: string;
    variant: string;
    price: number;
    quantity: number;
    remarks?: string;
    productId?: string;   // PocketBase product ID
    variantId?: string;   // PocketBase variant ID
    /** GST rate captured from the product at add-to-cart time. */
    gst_rate?: number;
    // Jewelry Specifications (Vyapar / BIS Aligned)
    gross_weight?: number;
    net_weight?: number;
    stone_weight?: number;
    stone_amount?: number;
    purity_karat?: string;
    making_charges?: number;
    making_charges_type?: 'per_gram' | 'fixed' | 'percent';
    wastage_percent?: number;
    huid_code?: string;
}

export interface POSSaleData {
    channel?: import('../types/database').SalesChannel;
    items: POSCartItem[];
    subtotal: number;
    discountPercent: number;
    discountAmount: number;
    loyaltyDiscount: number;
    total: number;
    paymentMethod: 'cash' | 'card' | 'upi' | 'phonepe';
    cashTendered?: number;
    changeGiven?: number;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    shiftId: string;
    userId: string;
    locationId?: string;
    notes?: string;
    pointsRedeemed?: number;
    pointsEarned?: number;
    /** Stable client id for retries; reused so a replay cannot duplicate (P7). */
    transactionId?: string;
}

export interface POSSaleResult {
    saleId: string;
    invoiceId: string;
    invoiceNumber: string;
    transactionId: string;
    warnings?: string[];
}

// ============================================
// MAIN FUNCTION: Create POS Sale
// ============================================

/**
 * Pure guard for cart quantities: a negative line would shrink the bill while
 * increasing stock. Returns an error message, or null when the cart is sound.
 */
export function validateSaleQuantities(
    items: Array<{ name?: string; productId?: string; quantity: number }>
): string | null {
    for (const item of items) {
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return `Invalid quantity for ${item.name || item.productId || 'an item'}: ${item.quantity}`;
        }
    }
    return null;
}

function toPaise(value: number): number {
    return Math.round(Number(value) * 100);
}

function round2(value: number): number {
    return toPaise(value) / 100;
}

/**
 * P1: the client used to persist its own subtotal/discount/total verbatim, so a
 * tampered request could bill a full cart for ₹1. Recompute every figure from
 * the line prices and reject a bill whose numbers do not add up.
 *
 * Line prices themselves stay negotiable (manager override is a POS feature);
 * what is enforced is that the header is consistent with the lines.
 */
export function validateSaleTotals(input: {
    items: Array<{ price: number; quantity: number; name?: string }>;
    subtotal: number;
    discountPercent: number;
    discountAmount: number;
    loyaltyDiscount: number;
    total: number;
}): string | null {
    let lineSubtotal = 0;
    for (const item of input.items) {
        const price = Number(item.price);
        const quantity = Number(item.quantity);
        if (!Number.isFinite(price) || price < 0) {
            return `Invalid price for ${item.name || 'an item'}: ${item.price}`;
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return `Invalid quantity for ${item.name || 'an item'}: ${item.quantity}`;
        }
        lineSubtotal += price * quantity;
    }
    // Round once at the end, exactly like the POS page, so a line-level paise
    // rounding cannot make an honest cart fail the check.
    const lineSubtotalPaise = toPaise(lineSubtotal);

    const discountPercent = Number(input.discountPercent);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        return `Invalid discount percentage: ${input.discountPercent}`;
    }

    const subtotalPaise = toPaise(input.subtotal);
    if (!Number.isFinite(input.subtotal)) {
        return 'Sale subtotal is not a valid number.';
    }
    if (Math.abs(subtotalPaise - lineSubtotalPaise) > 1) {
        return 'Sale subtotal does not match the cart lines.';
    }

    const discountPaise = toPaise(input.discountAmount);
    if (!Number.isFinite(input.discountAmount) || discountPaise < 0 || discountPaise > lineSubtotalPaise + 1) {
        return 'Discount amount is outside the bill subtotal.';
    }

    const loyaltyPaise = toPaise(input.loyaltyDiscount);
    const maxLoyaltyPaise = lineSubtotalPaise - discountPaise;
    if (!Number.isFinite(input.loyaltyDiscount) || loyaltyPaise < 0 || loyaltyPaise > maxLoyaltyPaise + 1) {
        return 'Loyalty discount exceeds the discounted subtotal.';
    }

    const expectedTotalPaise = lineSubtotalPaise - discountPaise - loyaltyPaise;
    if (expectedTotalPaise < 0) {
        return 'Sale total cannot be negative.';
    }
    if (!Number.isFinite(input.total)) {
        return 'Sale total is not a valid number.';
    }
    if (Math.abs(toPaise(input.total) - expectedTotalPaise) > 1) {
        return 'Sale total does not match subtotal less discounts.';
    }

    return null;
}

function newTransactionId(): string {
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createPOSSale(data: POSSaleData): Promise<POSSaleResult> {
    const quantityError = validateSaleQuantities(data.items);
    if (quantityError) throw new Error(quantityError);

    // P4: a line without a product reference used to skip stock silently.
    const missingProduct = data.items.find((item) => !item.productId);
    if (missingProduct) {
        throw new Error(`Cannot sell "${missingProduct.name || missingProduct.sku}": it has no product reference, so stock cannot be deducted.`);
    }

    // P1: recompute the header from the lines and reject a tampered bill.
    const totalsError = validateSaleTotals(data);
    if (totalsError) throw new Error(totalsError);
    const subtotal = round2(data.items.reduce((sum, item) => sum + item.price * item.quantity, 0));
    const discountAmount = round2(data.discountAmount);
    const loyaltyDiscount = round2(data.loyaltyDiscount);
    const total = round2(subtotal - discountAmount - loyaltyDiscount);

    // P7: a stable id makes retries idempotent instead of inserting a second sale.
    const transactionId = data.transactionId?.trim() || `TXN-${newTransactionId()}`;
    const existing = await pb
        .collection('sales')
        .getFirstListItem<{ id: string }>(
            `channel_order_id="${sanitizeFilter(transactionId)}" && account_email="${sanitizeFilter(getCurrentTenantEmail())}"`
        )
        .catch((error: unknown) => {
            // Only "not found" means this is a fresh sale; a failed lookup must
            // not fall through to creating a duplicate.
            if ((error as { status?: number })?.status === 404) return null;
            throw error;
        });
    if (existing) {
        const invoice = await pb
            .collection('invoices')
            .getFirstListItem<{ id: string; invoice_number?: string }>(
                `sale="${sanitizeFilter(existing.id)}" && account_email="${sanitizeFilter(getCurrentTenantEmail())}"`
            )
            .catch(() => null);
        return {
            saleId: existing.id,
            invoiceId: invoice?.id || '',
            invoiceNumber: invoice?.invoice_number || '',
            transactionId,
            warnings: ['This transaction was already recorded; the retry was deduplicated.'],
        };
    }

    let createdSaleId: string | null = null;
    let createdInvoiceId: string | null = null;
    let shiftTotalsApplied = false;
    const createdSaleItemIds: string[] = [];
    const createdMovementIds: string[] = [];
    const stockDeductions: { kind: 'variant' | 'product'; id: string; quantity: number }[] = [];
    const locationAdjustments: { variantId: string; quantity: number }[] = [];
    const warnings: string[] = [];

    try {
        // 1. Create sale record
        const sale = await pb.collection('sales').create({
            account_email: getCurrentTenantEmail(),
            channel: data.channel || 'pos',
            channel_order_id: transactionId,
            customer: data.customerId || null,
            customer_name: data.customerName || 'Walk-in Customer',
            customer_phone: data.customerPhone || '',
            customer_address: '',
            subtotal,
            discount: round2(discountAmount + loyaltyDiscount),
            total,
            payment_method: data.paymentMethod,
            status: 'delivered', // POS sales are immediate
            notes: data.notes || '',
            register_shift_id: data.shiftId,
            cash_tendered: data.cashTendered || null,
            change_given: data.changeGiven || null,
        });

        createdSaleId = sale.id;
        console.log('Sale created:', sale.id);

        // 2. Create sale items & decrement stock
        // Cost snapshot (analytics): resolve each line's unit cost at sale
        // time so COGS/margin analytics don't revalue history later.
        const unitCosts = await resolveUnitCostMap(
            pb,
            getCurrentTenantEmail(),
            data.items.map((item) => ({ variantId: item.variantId, productId: item.productId }))
        ).catch((e) => {
            console.warn('unit-cost resolution failed; sale items will omit unit_cost:', e);
            return new Map<string, number>();
        });

        for (const item of data.items) {
            const saleItem = await pb.collection('sale_items').create({
                account_email: getCurrentTenantEmail(),
                sale: sale.id,
                product: item.productId || null,
                variant: item.variantId || null,
                quantity: item.quantity,
                unit_price: item.price,
                unit_cost: unitCosts.get(item.variantId || item.productId || '') ?? null,
                total_price: item.price * item.quantity,
                gst_rate: item.gst_rate ?? null,
                remarks: item.remarks || '',
                discount: 0,
                total: item.price * item.quantity,
                gross_weight: item.gross_weight ?? null,
                net_weight: item.net_weight ?? null,
                stone_weight: item.stone_weight ?? null,
                stone_amount: item.stone_amount ?? null,
                purity_karat: item.purity_karat || '',
                making_charges: item.making_charges ?? 0,
                making_charges_type: item.making_charges_type || 'per_gram',
                wastage_percent: item.wastage_percent ?? 0,
                huid_code: item.huid_code || '',
            });
            createdSaleItemIds.push(saleItem.id);

        }

        // 3. Unified channel stock: one atomic pass for the whole sale with the
        // POS oversell policy (settle at what exists and audit the shortfall).
        // This replaced the per-line movement/decline/clamp block, which was the
        // last channel-specific copy of the stock logic.
        const stockLines = data.items
            .filter((item) => Boolean(item.productId))
            .map((item) => ({
                productId: item.productId as string,
                variantId: item.variantId,
                quantity: item.quantity,
                name: item.name,
            }));
        if (stockLines.length > 0) {
            const stockResult = await applyChannelStock(toStockDb(pb), stockLines, {
                accountEmail: getCurrentTenantEmail(),
                channel: 'pos',
                referenceId: sale.id,
                notes: `POS Sale: ${transactionId}`,
                // P2: abort on shortage instead of clamping. A clamped sale
                // charged for units that never left stock. applyChannelStock
                // rolls its own partial writes back, then the outer rollback
                // removes the sale/invoice rows.
                oversell: 'reject',
            });
            for (const movementId of stockResult.movementIds) {
                if (movementId) createdMovementIds.push(movementId);
            }
            const shortageByKey = new Map(
                stockResult.shortages.map((shortage) => [shortage.variantId || shortage.productId, shortage])
            );
            for (const target of stockResult.targets) {
                const key = target.kind === 'variant' ? target.id : target.productId;
                const shortage = shortageByKey.get(key);
                const appliedQuantity = shortage ? shortage.available : target.quantity;
                if (appliedQuantity > 0) {
                    stockDeductions.push({ kind: target.kind, id: target.id, quantity: appliedQuantity });
                    if (data.locationId) {
                        // P6: surface the failure and remember the adjustment so
                        // the rollback below can reverse it. Swallowing it left
                        // location stock permanently short.
                        await adjustLocationStock(
                            target.id,
                            data.locationId,
                            -appliedQuantity,
                            `POS Sale [${transactionId}]`
                        );
                        locationAdjustments.push({ variantId: target.id, quantity: appliedQuantity });
                    }
                }
                if (shortage) {
                    warnings.push(
                        `Insufficient stock for "${target.name}" (requested ${shortage.requested}, available ${shortage.available}). Sale recorded for ${shortage.available}.`
                    );
                    await pb.collection('activity_logs').create({
                        action: 'INVENTORY_OVERSELL_WARNING',
                        entity_type: target.kind === 'variant' ? 'product_variants' : 'products',
                        entity_id: target.id,
                        description: `POS sale ${transactionId} requested ${shortage.requested} units for ${target.name}; only ${shortage.available} were available. Stock and ledger reconciled to ${shortage.available}.`,
                        metadata: JSON.stringify({
                            variant_id: target.kind === 'variant' ? target.id : null,
                            product_id: target.productId,
                            sale_id: sale.id,
                            transaction_id: transactionId,
                            requested_quantity: shortage.requested,
                            available_quantity: shortage.available,
                        }),
                    }).catch((err) => console.error('Failed to log oversell audit:', err));
                }
            }
        }

        console.log('Sale items created');

        // 4. Update shift totals
        // P5: a failed shift update must fail the sale. Otherwise the drawer's
        // expected balance silently drifts away from the transactions.
        shiftTotalsApplied = await updateShiftTotals(data.shiftId, total, data.paymentMethod);
        console.log('Shift totals updated');

        // 5. Create invoice from sale
        const invoice = await createInvoiceFromSale(sale.id);
        createdInvoiceId = invoice.id || null;
        console.log('Invoice created:', invoice.invoice_number);

        return {
            saleId: sale.id,
            invoiceId: invoice.id!,
            invoiceNumber: invoice.invoice_number!,
            transactionId,
            warnings: warnings.length > 0 ? warnings : undefined,
        };

    } catch (error) {
        console.error('Error creating POS sale, initiating compensating rollback:', error);

        // Rollback stock deductions atomically, including the per-location copy.
        for (const adjustment of locationAdjustments) {
            try {
                await adjustLocationStock(
                    adjustment.variantId,
                    data.locationId as string,
                    adjustment.quantity,
                    `POS Sale Rollback [${transactionId}]`
                );
            } catch (err) {
                console.error(`Rollback error: unable to restore location stock for ${adjustment.variantId}:`, err);
            }
        }
        for (const deduction of stockDeductions) {
            try {
                const collection = deduction.kind === 'variant' ? 'product_variants' : 'products';
                await pb.collection(collection).update(deduction.id, {
                    'stock_level+': deduction.quantity,
                });
            } catch (err) {
                console.error(`Rollback error: unable to restore stock for ${deduction.kind} ${deduction.id}:`, err);
            }
        }

        // Delete created stock movements
        for (const movementId of createdMovementIds) {
            await pb.collection('stock_movements').delete(movementId).catch((err) =>
                console.error(`Rollback error: unable to delete stock movement ${movementId}:`, err)
            );
        }

        // Delete created sale items
        for (const itemId of createdSaleItemIds) {
            await pb.collection('sale_items').delete(itemId).catch((err) =>
                console.error(`Rollback error: unable to delete sale item ${itemId}:`, err)
            );
        }

        // Delete created sale record
        if (createdSaleId) {
            await pb.collection('sales').delete(createdSaleId).catch((err) =>
                console.error(`Rollback error: unable to delete sale ${createdSaleId}:`, err)
            );
        }

        // Compensate writes that happen after the stock decrement: the invoice
        // and the shift totals were previously left behind on failure.
        if (createdInvoiceId) {
            const orphanItems = await pb
                .collection('invoice_items')
                .getFullList<{ id: string }>({
                    filter: `invoice="${sanitizeFilter(createdInvoiceId)}" && account_email="${sanitizeFilter(getCurrentTenantEmail())}"`,
                })
                .catch(() => []);
            for (const orphan of orphanItems) {
                await pb.collection('invoice_items').delete(orphan.id).catch(() => {});
            }
            await pb.collection('invoices').delete(createdInvoiceId).catch((err) =>
                console.error(`Rollback error: unable to delete invoice ${createdInvoiceId}:`, err)
            );
        }
        if (shiftTotalsApplied) {
            await updateShiftTotals(data.shiftId, -Math.abs(total), data.paymentMethod).catch((err) =>
                console.error(`Rollback error: unable to reverse shift totals for ${data.shiftId}:`, err)
            );
        }

        throw error;
    }
}

// ============================================
// HELPER: Update Shift Totals
// ============================================

async function updateShiftTotals(
    shiftId: string,
    amount: number,
    paymentMethod: string
): Promise<boolean> {
    return enqueueTask(`shift_${shiftId}`, async () => {
        const updates: Record<string, number> = {};

        switch (paymentMethod) {
            case 'cash':
                updates['total_cash_sales+'] = amount;
                updates['expected_balance+'] = amount;
                break;
            case 'card':
                updates['total_card_sales+'] = amount;
                break;
            case 'upi':
            case 'phonepe':
                updates['total_upi_sales+'] = amount;
                break;
        }

        // P5: let the error propagate so createPOSSale rolls the sale back
        // instead of leaving the drawer totals short.
        await pb.collection('cash_register_shifts').update(shiftId, updates);
        return true;
    });
}

// ============================================
// HELPER: Get Sales by Shift
// ============================================

export async function getSalesByShift(shiftId: string): Promise<Sale[]> {
    try {
        const sales = await pb.collection('sales').getFullList<Sale>({
            filter: `register_shift_id="${sanitizeFilter(shiftId)}" && account_email="${sanitizeFilter(getCurrentTenantEmail())}"`,
            sort: '-created',
            expand: 'customer',
        });
        return sales;
    } catch (error) {
        console.error('Error fetching sales by shift:', error);
        return [];
    }
}

// ============================================
// HELPER: Get Today's Sales Summary
// ============================================

export async function getTodaysSalesSummary(): Promise<{
    totalSales: number;
    totalAmount: number;
    cashAmount: number;
    cardAmount: number;
    upiAmount: number;
}> {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sales = await pb.collection('sales').getFullList<Sale>({
            filter: `channel="pos" && created>="${today.toISOString()}" && account_email="${sanitizeFilter(getCurrentTenantEmail())}"`,
        });

        return {
            totalSales: sales.length,
            totalAmount: sales.reduce((sum, s) => sum + (s.total || 0), 0),
            cashAmount: sales.filter(s => s.payment_method === 'cash')
                .reduce((sum, s) => sum + (s.total || 0), 0),
            cardAmount: sales.filter(s => s.payment_method === 'card')
                .reduce((sum, s) => sum + (s.total || 0), 0),
            upiAmount: sales.filter(s => ['upi', 'phonepe'].includes(s.payment_method ?? ''))
                .reduce((sum, s) => sum + (s.total || 0), 0),
        };
    } catch (error) {
        console.error('Error fetching today\'s sales summary:', error);
        return {
            totalSales: 0,
            totalAmount: 0,
            cashAmount: 0,
            cardAmount: 0,
            upiAmount: 0,
        };
    }
}
