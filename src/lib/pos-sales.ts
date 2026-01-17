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
import { createInvoiceFromSale, type Invoice } from './invoice';

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
}

export interface POSSaleData {
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
    notes?: string;
    pointsRedeemed?: number;
    pointsEarned?: number;
}

export interface POSSaleResult {
    saleId: string;
    invoiceId: string;
    invoiceNumber: string;
    transactionId: string;
}

// ============================================
// MAIN FUNCTION: Create POS Sale
// ============================================

export async function createPOSSale(data: POSSaleData): Promise<POSSaleResult> {
    const transactionId = `TXN-${Date.now().toString(36).toUpperCase()}`;

    try {
        // 1. Create sale record
        const sale = await pb.collection('sales').create({
            channel: 'pos',
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

        console.log('Sale created:', sale.id);

        // 2. Create sale items
        for (const item of data.items) {
            await pb.collection('sale_items').create({
                sale: sale.id,
                product: item.productId || null,
                variant: item.variantId || null,
                quantity: item.quantity,
                unit_price: item.price,
                total_price: item.price * item.quantity,
                remarks: item.remarks || '',
                discount: 0,
                total: item.price * item.quantity,
            });

            // 3. Create stock movement (decrement stock)
            if (item.variantId) {
                await pb.collection('stock_movements').create({
                    variant: item.variantId,
                    movement_type: 'sale',
                    quantity: -item.quantity, // Negative for stock reduction
                    reference_id: sale.id,
                    source: 'pos',
                    notes: `POS Sale: ${transactionId}`,
                });

                // Update variant stock level
                try {
                    const variant = await pb.collection('product_variants').getOne(item.variantId);
                    await pb.collection('product_variants').update(item.variantId, {
                        stock_level: Math.max(0, (variant as any).stock_level - item.quantity),
                    });
                } catch (stockErr) {
                    console.warn('Could not update stock level for variant:', item.variantId, stockErr);
                }
            }
        }

        console.log('Sale items created');

        // 4. Update shift totals
        await updateShiftTotals(data.shiftId, data.total, data.paymentMethod);
        console.log('Shift totals updated');

        // 5. Create invoice from sale
        const invoice = await createInvoiceFromSale(sale.id);
        console.log('Invoice created:', invoice.invoice_number);

        return {
            saleId: sale.id,
            invoiceId: invoice.id!,
            invoiceNumber: invoice.invoice_number!,
            transactionId,
        };

    } catch (error) {
        console.error('Error creating POS sale:', error);
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
): Promise<void> {
    try {
        const shift = await pb.collection('cash_register_shifts').getOne(shiftId);

        const updates: Record<string, number> = {};

        switch (paymentMethod) {
            case 'cash':
                updates.total_cash_sales = ((shift as any).total_cash_sales || 0) + amount;
                break;
            case 'card':
                updates.total_card_sales = ((shift as any).total_card_sales || 0) + amount;
                break;
            case 'upi':
            case 'phonepe':
                updates.total_upi_sales = ((shift as any).total_upi_sales || 0) + amount;
                break;
        }

        // Update expected balance (opening + cash sales - refunds)
        if (paymentMethod === 'cash') {
            updates.expected_balance =
                ((shift as any).opening_balance || 0) +
                updates.total_cash_sales -
                ((shift as any).total_cash_refunds || 0) +
                ((shift as any).cash_added || 0) -
                ((shift as any).cash_removed || 0);
        }

        await pb.collection('cash_register_shifts').update(shiftId, updates);
    } catch (error) {
        console.error('Error updating shift totals:', error);
        // Don't throw - shift update failure shouldn't fail the sale
    }
}

// ============================================
// HELPER: Get Sales by Shift
// ============================================

export async function getSalesByShift(shiftId: string): Promise<any[]> {
    try {
        const sales = await pb.collection('sales').getFullList({
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

        const sales = await pb.collection('sales').getFullList({
            filter: `channel="pos" && created>="${today.toISOString()}"`,
        });

        return {
            totalSales: sales.length,
            totalAmount: sales.reduce((sum, s) => sum + ((s as any).total || 0), 0),
            cashAmount: sales.filter(s => (s as any).payment_method === 'cash')
                .reduce((sum, s) => sum + ((s as any).total || 0), 0),
            cardAmount: sales.filter(s => (s as any).payment_method === 'card')
                .reduce((sum, s) => sum + ((s as any).total || 0), 0),
            upiAmount: sales.filter(s => ['upi', 'phonepe'].includes((s as any).payment_method))
                .reduce((sum, s) => sum + ((s as any).total || 0), 0),
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
