/**
 * B2B Sales & Estimates Service Layer
 * CRUD operations for sales orders using PocketBase
 */

import { pb } from '@/lib/pocketbase';
import { toast } from 'sonner';
import type { Customer } from '@/lib/customers';
// Aliased: this file's local SalesOrder/SalesOrderItem are narrower order-creation
// payloads, while the database types describe the persisted sales_orders records.
import type {
    ProductVariant,
    SalesOrder as SalesOrderRecord,
    SalesOrderItem as SalesOrderItemRow,
} from '@/types/database';
import { createInvoice, getStoreSettings } from '@/lib/invoice';
import { calculateGST, getStateCode, GST_RATES } from '@/lib/gst';
import { getNextSequenceNumber, createWithUniqueRetry } from '@/lib/sequence-generator';

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
    tax_rate?: number;
    discount_amount?: number;
    total: number;
    product?: string;
    variant?: string;
    expand?: {
        product?: { name?: string; hsn_code?: string; gst_rate?: number };
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
        // 1. Create Order Header with Unique Retry (WPA-12)
        const orderData = {
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
            subtotal: data.subtotal,
            tax_total: data.tax_total,
            discount_total: data.discount_total,
            shipping_charges: data.shipping_charges,
            total: data.total,
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

        // 2. Create Order Items
        const promises = data.items.map(item => {
            const itemData: SalesOrderItemRecord = {
                order: order.id,
                description: item.description,
                quantity: item.quantity,
                unit_price: item.unit_price,
                tax_rate: item.tax_rate || 0,
                discount_amount: item.discount_amount || 0,
                total: item.total
            };
            if (item.product_id) itemData.product = item.product_id;
            if (item.variant_id) itemData.variant = item.variant_id;
            return pb.collection('sales_order_items').create(itemData);
        });

        await Promise.all(promises);

        // Hybrid WhatsApp Campaign Attribution (7-day window / promo code)
        try {
            const { attributeOrderToCampaign } = await import('@/lib/campaign-attribution');
            await attributeOrderToCampaign({
                id: order.id,
                customerPhone: data.customer_phone,
                total: data.total,
                promoCode: (data.notes || '').match(/([A-Z0-9]{4,15})/)?.[1],
                created: (order as any).created || new Date().toISOString(),
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

/**
 * Convert an Estimate to a Confirmed Sales Order
 */
export async function convertEstimateToOrder(estimateId: string) {
    try {
        await pb.collection('sales_orders').update(estimateId, {
            order_type: 'sales_order',
            status: 'confirmed',
            order_date: new Date().toISOString() // Reset date to confirmation date
        });

        toast.success("Estimate converted to Sales Order");
        return true;
    } catch (error) {
        console.error('Error converting estimate:', error);
        toast.error('Failed to convert estimate');
        return false;
    }
}

/**
 * Generate an Invoice from a Sales Order
 */
export async function generateInvoiceFromOrder(orderId: string) {
    try {
        const order = await pb.collection('sales_orders').getOne(orderId);

        // Idempotency: a retry after the order status update failed must reuse
        // the invoice that already exists rather than raising a second one for
        // the same order.
        const existingInvoices = await pb
            .collection('invoices')
            .getFullList<{ id: string; invoice_number?: string }>({
                filter: `order="${orderId}"`,
                sort: '-created',
            })
            .catch(() => []);
        if (existingInvoices.length > 0) {
            if (order.status !== 'invoiced') {
                await pb.collection('sales_orders').update(orderId, { status: 'invoiced' }).catch(() => {});
            }
            return { success: true, order, invoice: existingInvoices[0], alreadyInvoiced: true };
        }

        const orderItems = await pb.collection('sales_order_items').getFullList<SalesOrderItemRecord>({
            filter: `order="${orderId}"`,
            expand: 'product',
        });

        const store = await getStoreSettings();
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
        let buyerStateCode = sellerStateCode;
        let buyerGstin = '';
        if (order.customer) {
            try {
                const customer = await pb.collection('customers').getOne<Customer>(order.customer);
                buyerGstin = String(customer.gstin || '').trim();
                const gstinStateCode = buyerGstin.substring(0, 2);
                buyerStateCode =
                    customer.state_code ||
                    getStateCode(customer.state || '') ||
                    (/^\d{2}$/.test(gstinStateCode) ? gstinStateCode : '') ||
                    sellerStateCode;
            } catch {
                // Customer lookup failed — fall back to the seller state (intra-state).
            }
        }

        const invoiceItems = orderItems.map((item, idx: number) => {
            // Taxable value is net of the line discount (sales_order_items stores
            // discount_amount alongside a post-discount total); GST applies to
            // the post-discount base so taxable + tax == line total.
            const gross = (item.unit_price || 0) * (item.quantity || 1);
            const taxable = Math.max(0, gross - (item.discount_amount || 0));
            // Nullish, not ||: an explicitly exempt line stays at 0%, while a
            // missing rate falls back to the product rate instead of silently
            // producing a 0% GST invoice.
            const product = item.expand?.product;
            const configuredRate = item.tax_rate ?? product?.gst_rate ?? GST_RATES.JEWELRY;
            const gstRate = isGstRegistered ? configuredRate : 0;
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
            invoice_date: new Date().toISOString().split('T')[0],
            invoice_type: 'regular',
            order_id: orderId,
            customer_id: order.customer || '',
            status: 'pending',
            seller_gstin: isGstRegistered ? (store.store_gstin || '') : '',
            seller_name: store.store_name || 'Luminila Jewelry',
            seller_address: `${store.store_address || ''} ${store.store_city || ''}`.trim(),
            seller_state_code: store.store_state_code || '27',
            buyer_name: order.customer_name || 'Walk-in Customer',
            buyer_gstin: buyerGstin,
            buyer_phone: order.customer_phone || '',
            buyer_email: order.customer_email || '',
            buyer_address: order.billing_address || order.shipping_address || '',
            buyer_state_code: buyerStateCode,
            place_of_supply: buyerStateCode,
            subtotal: subtotal,
            tax: totalTax,
            discount: order.discount_total || 0,
            total: grandTotal,
            taxable_value: subtotal,
            cgst_amount: invoiceItems.reduce((acc, it) => acc + it.cgst_amount, 0),
            sgst_amount: invoiceItems.reduce((acc, it) => acc + it.sgst_amount, 0),
            igst_amount: invoiceItems.reduce((acc, it) => acc + it.igst_amount, 0),
            cess_amount: 0,
            total_tax: totalTax,
            discount_amount: order.discount_total || 0,
            shipping_charges: order.shipping_charges || 0,
            grand_total: grandTotal,
            amount_in_words: '',
            is_reverse_charge: false,
            is_paid: false,
            paid_amount: 0,
            notes: order.notes || `Generated from Sales Order #${order.order_number || orderId}`,
            items: invoiceItems
        });

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
        const filterParts: string[] = [];
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

        // Fetch items separately as reverse expand is tricky in getOne sometimes if not configured
        const items = await pb.collection('sales_order_items').getFullList<OrderDetailItem>({
            filter: `order="${id}"`,
            expand: 'product,variant'
        });

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
    const records = await pb.collection('sales_orders').getList(1, 30, {
        filter: 'status != "delivered" && status != "cancelled"',
        sort: '-created',
    });
    return records.items;
}

export async function markSalesOrderShipped(orderId: string): Promise<void> {
    await pb.collection('sales_orders').update(orderId, { status: 'shipped' });
}