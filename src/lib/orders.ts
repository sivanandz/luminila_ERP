/**
 * B2B Sales & Estimates Service Layer
 * CRUD operations for sales orders using PocketBase
 */

import { pb } from '@/lib/pocketbase';
import { toast } from 'sonner';
import { createInvoice, getStoreSettings } from '@/lib/invoice';

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

/**
 * Create a new Estimate or Sales Order
 */
export async function createOrder(data: OrderInput) {
    try {
        // 1. Create Order Header
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
            // order_number: generated on client side logic or ignored for now? 
            // Previous logic didn't show generation. Assuming PB ID is enough or future auto-increment hook.
        };

        const order = await pb.collection('sales_orders').create(orderData);

        // 2. Create Order Items
        const promises = data.items.map(item => {
            return pb.collection('sales_order_items').create({
                order: order.id,
                product: item.product_id,
                variant: item.variant_id,
                description: item.description,
                quantity: item.quantity,
                unit_price: item.unit_price,
                tax_rate: item.tax_rate || 0,
                discount_amount: item.discount_amount || 0,
                total: item.total
            });
        });

        await Promise.all(promises);

        return { success: true, orderId: order.id, orderNumber: order.id }; // Use ID as number for now
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
        const orderItems = await pb.collection('sales_order_items').getFullList({
            filter: `order="${orderId}"`
        });

        const store = await getStoreSettings();

        const invoiceItems = orderItems.map((item: any, idx: number) => {
            const taxable = (item.unit_price || 0) * (item.quantity || 1);
            const gstRate = 3; // Standard jewelry GST rate
            const cgst = taxable * 0.015;
            const sgst = taxable * 0.015;
            return {
                sr_no: idx + 1,
                variant_id: item.variant || '',
                description: item.description || 'Jewelry Item',
                hsn_code: '7117',
                quantity: item.quantity || 1,
                unit: 'PCS',
                unit_price: item.unit_price || 0,
                discount_percent: 0,
                discount_amount: 0,
                taxable_amount: taxable,
                gst_rate: gstRate,
                cgst_rate: 1.5,
                cgst_amount: cgst,
                sgst_rate: 1.5,
                sgst_amount: sgst,
                igst_rate: 0,
                igst_amount: 0,
                cess_rate: 0,
                cess_amount: 0,
                total_amount: item.total || (taxable + cgst + sgst)
            };
        });

        const subtotal = order.subtotal || invoiceItems.reduce((acc, it) => acc + it.taxable_amount, 0);
        const totalTax = order.tax_total || invoiceItems.reduce((acc, it) => acc + it.cgst_amount + it.sgst_amount, 0);
        const grandTotal = order.total || (subtotal + totalTax);

        const invoice = await createInvoice({
            invoice_date: new Date().toISOString().split('T')[0],
            invoice_type: 'regular',
            order_id: orderId,
            customer_id: order.customer || '',
            status: 'pending',
            seller_gstin: store.store_gstin || '',
            seller_name: store.store_name || 'Luminila Jewelry',
            seller_address: `${store.store_address || ''} ${store.store_city || ''}`.trim(),
            seller_state_code: store.store_state_code || '27',
            buyer_name: order.customer_name || 'Walk-in Customer',
            buyer_gstin: '',
            buyer_phone: order.customer_phone || '',
            buyer_email: order.customer_email || '',
            buyer_address: order.billing_address || order.shipping_address || '',
            buyer_state_code: store.store_state_code || '27',
            place_of_supply: store.store_state_code || '27',
            subtotal: subtotal,
            tax: totalTax,
            discount: order.discount_total || 0,
            total: grandTotal,
            taxable_value: subtotal,
            cgst_amount: totalTax / 2,
            sgst_amount: totalTax / 2,
            igst_amount: 0,
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
        let filterParts: string[] = [];
        if (type) filterParts.push(`order_type="${type}"`);
        if (status) filterParts.push(`status="${status}"`);

        const records = await pb.collection('sales_orders').getFullList({
            filter: filterParts.join(' && '),
            sort: '-order_date'
        });
        return records;
    } catch (error: any) {
        console.error('Error fetching orders:', error);
        return [];
    }
}

/**
 * Get single order details
 */
export async function getOrderDetails(id: string) {
    try {
        const order = await pb.collection('sales_orders').getOne(id);

        // Fetch items separately as reverse expand is tricky in getOne sometimes if not configured
        const items = await pb.collection('sales_order_items').getFullList({
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
