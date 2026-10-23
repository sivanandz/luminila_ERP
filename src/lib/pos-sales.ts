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

import { pb } from './pocketbase';
import { createInvoiceFromSale } from './invoice';
import { enqueueTask } from './concurrency';
import { ClientResponseError } from 'pocketbase';
import { adjustLocationStock } from './multi-location';
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
    const stockDeductions: { variantId: string; quantity: number }[] = [];
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

            // 3. Create stock movement (decrement stock)
            if (item.variantId) {
                const movement = await pb.collection('stock_movements').create({
                    variant: item.variantId,
                    movement_type: 'sale',
                    quantity: -item.quantity, // Negative for stock reduction
                    reference_id: sale.id,
                    source: 'pos',
                    notes: `POS Sale: ${transactionId}`,
                });
                createdMovementIds.push(movement.id);

                // Update variant stock level atomically
                try {
                    await pb.collection('product_variants').update(item.variantId, {
                        'stock_level-': item.quantity,
                    });
                    stockDeductions.push({ variantId: item.variantId, quantity: item.quantity });

                    // Deduct from specific physical POS facility/store
                    if (data.locationId) {
                        await adjustLocationStock(
                            item.variantId || item.productId || item.id,
                            data.locationId,
                            -item.quantity,
                            `POS Sale [${transactionId}]`
                        ).catch(() => {});
                    }
                } catch (stockErr) {
                    const pbErr = stockErr instanceof ClientResponseError ? stockErr : null;
                    const errorText = String(stockErr instanceof Error ? stockErr.message : stockErr);
                    // Only the database min-constraint means "not enough stock".
                    // A permissions or validation 400 used to be treated the same
                    // way, which wrote stock_level 0 and destroyed the count.
                    const isMinConstraint =
                        pbErr?.data?.data?.stock_level?.code === 'validation_min_number_constraint' ||
                        errorText.includes('validation_min_number_constraint');

                    if (!isMinConstraint) throw stockErr;

                    // Sell what is actually there, and keep the movement ledger in
                    // agreement with the variant row instead of recording the full
                    // requested quantity against a clamped count.
                    const latest = await pb.collection('product_variants').getOne<{ stock_level?: number }>(item.variantId);
                    const available = Math.max(0, latest.stock_level ?? 0);

                    await pb.collection('product_variants').update(item.variantId, { stock_level: 0 });
                    stockDeductions.push({ variantId: item.variantId, quantity: available });

                    if (movement?.id) {
                        await pb.collection('stock_movements').update(movement.id, {
                            quantity: -available,
                            notes: `POS Sale: ${transactionId} [OVERSELL: requested ${item.quantity}, only ${available} in stock]`,
                        }).catch(() => {});
                    }

                    await pb.collection('activity_logs').create({
                        action: 'INVENTORY_OVERSELL_WARNING',
                        entity_type: 'product_variants',
                        entity_id: item.variantId,
                        description: `POS sale ${transactionId} requested ${item.quantity} units for variant ${item.variantId}; only ${available} were available. Stock and movement reconciled to ${available}.`,
                        metadata: JSON.stringify({
                            variant_id: item.variantId,
                            sale_id: sale.id,
                            transaction_id: transactionId,
                            requested_quantity: item.quantity,
                            available_quantity: available,
                        }),
                    }).catch((err) => console.error('Failed to log oversell audit:', err));

                    warnings.push(`Insufficient stock for "${item.name}" (requested ${item.quantity}, available ${available}). Sale recorded for ${available}.`);
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
                await pb.collection('product_variants').update(deduction.variantId, {
                    'stock_level+': deduction.quantity,
                });
            } catch (err) {
                console.error(`Rollback error: unable to restore stock for variant ${deduction.variantId}:`, err);
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
