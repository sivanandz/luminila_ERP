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

import { pb, getCurrentTenantEmail } from './pocketbase';
import { createInvoiceFromSale } from './invoice';
import { enqueueTask } from './concurrency';
import { adjustLocationStock } from './multi-location';
import { applyChannelStock, toStockDb } from './channel-stock';
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

export async function createPOSSale(data: POSSaleData): Promise<POSSaleResult> {
    const quantityError = validateSaleQuantities(data.items);
    if (quantityError) throw new Error(quantityError);

    const transactionId = `TXN-${Date.now().toString(36).toUpperCase()}`;

    let createdSaleId: string | null = null;
    let createdInvoiceId: string | null = null;
    let shiftTotalsApplied = false;
    const createdSaleItemIds: string[] = [];
    const createdMovementIds: string[] = [];
    const stockDeductions: { kind: 'variant' | 'product'; id: string; quantity: number }[] = [];
    const warnings: string[] = [];

    try {
        // 1. Create sale record
        const sale = await pb.collection('sales').create({
            channel: data.channel || 'pos',
            channel_order_id: transactionId,
            customer: data.customerId || null,
            customer_name: data.customerName || 'Walk-in Customer',
            customer_phone: data.customerPhone || '',
            customer_address: '',
            subtotal: data.subtotal,
            discount: data.discountAmount + data.loyaltyDiscount,
            total: data.total,
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
        for (const item of data.items) {
            const saleItem = await pb.collection('sale_items').create({
                sale: sale.id,
                product: item.productId || null,
                variant: item.variantId || null,
                quantity: item.quantity,
                unit_price: item.price,
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
                oversell: 'clamp',
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
                        await adjustLocationStock(
                            target.id,
                            data.locationId,
                            -appliedQuantity,
                            `POS Sale [${transactionId}]`
                        ).catch(() => {});
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
        shiftTotalsApplied = await updateShiftTotals(data.shiftId, data.total, data.paymentMethod);
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

        // Rollback stock deductions atomically
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
                .getFullList<{ id: string }>({ filter: `invoice="${createdInvoiceId}"` })
                .catch(() => []);
            for (const orphan of orphanItems) {
                await pb.collection('invoice_items').delete(orphan.id).catch(() => {});
            }
            await pb.collection('invoices').delete(createdInvoiceId).catch((err) =>
                console.error(`Rollback error: unable to delete invoice ${createdInvoiceId}:`, err)
            );
        }
        if (shiftTotalsApplied) {
            await updateShiftTotals(data.shiftId, -Math.abs(data.total), data.paymentMethod);
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
        try {
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

            await pb.collection('cash_register_shifts').update(shiftId, updates);
            return true;
        } catch (error) {
            console.error('Error updating shift totals:', error);
            // Don't throw - shift update failure shouldn't fail the sale
            return false;
        }
    });
}

// ============================================
// HELPER: Get Sales by Shift
// ============================================

export async function getSalesByShift(shiftId: string): Promise<Sale[]> {
    try {
        const sales = await pb.collection('sales').getFullList<Sale>({
            filter: `register_shift_id="${shiftId}"`,
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
            filter: `channel="pos" && created>="${today.toISOString()}"`,
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
