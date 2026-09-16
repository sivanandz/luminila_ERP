/**
 * WhatsApp Order Ingestion & Auto-Drafting Engine
 * Transforms incoming WhatsApp catalog orders and chat carts into official Draft Sales Orders in Luminila ERP.
 */

import { pb } from './pocketbase';
import { findCustomerByPhone, normalizePhone } from './customer-lookup';
import { WPPMessage } from './whatsapp';

export interface IngestedOrderItem {
    sku?: string;
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    variantId?: string;
    productId?: string;
}

export interface IngestionResult {
    success: boolean;
    orderId?: string;
    orderNumber?: string;
    customerId?: string;
    customerName?: string;
    totalAmount?: number;
    itemCount?: number;
    error?: string;
}

/**
 * Generate unique order serial number
 */
function generateOrderNumber(): string {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `WA-${dateStr}-${rand}`;
}

/**
 * Ingest an incoming WhatsApp Catalog Order into Luminila Sales Orders
 */
export async function ingestWhatsAppCatalogOrder(
    message: WPPMessage,
    customerInfo: {
        name: string;
        phone: string;
        address?: string;
        city?: string;
        pincode?: string;
    },
    items: IngestedOrderItem[]
): Promise<IngestionResult> {
    try {
        if (!items || items.length === 0) {
            return { success: false, error: 'No items provided for order ingestion' };
        }

        const normalized = normalizePhone(customerInfo.phone);

        // 1. Resolve or auto-create customer
        let customer = await findCustomerByPhone(normalized);

        if (!customer) {
            try {
                const createdCustomer = await pb.collection('customers').create({
                    name: customerInfo.name || `WhatsApp Buyer (${normalized.slice(-4)})`,
                    phone: normalized,
                    address: customerInfo.address || '',
                    city: customerInfo.city || '',
                    pincode: customerInfo.pincode || '',
                    customer_type: 'retail',
                    source: 'whatsapp_catalog',
                    lead_status: 'awaiting_payment',
                    loyalty_points: 0,
                    total_spent: 0,
                    total_orders: 0,
                    preferred_contact: 'whatsapp',
                });

                customer = {
                    id: createdCustomer.id,
                    name: createdCustomer.name,
                    phone: createdCustomer.phone,
                    email: createdCustomer.email,
                    address: createdCustomer.address,
                    city: createdCustomer.city,
                    state: createdCustomer.state,
                    pincode: createdCustomer.pincode,
                    company_name: createdCustomer.company_name,
                    gstin: createdCustomer.gstin,
                    customer_type: 'retail',
                    loyalty_points: 0,
                    total_spent: 0,
                    total_orders: 0,
                    preferred_contact: 'whatsapp',
                    notes: null,
                    tags: ['WhatsApp Catalog Order'],
                    source: 'whatsapp_catalog',
                    created_at: createdCustomer.created,
                    updated_at: createdCustomer.updated,
                };
            } catch (custErr: any) {
                console.warn('Customer auto-creation warning:', custErr);
            }
        } else {
            // Update customer lead status to awaiting_payment
            try {
                await pb.collection('customers').update(customer.id, {
                    lead_status: 'awaiting_payment',
                });
            } catch (statusErr) {
                console.warn('Could not update lead status:', statusErr);
            }
        }

        // 2. Compute order totals
        let subtotal = 0;
        for (const item of items) {
            subtotal += (item.unitPrice || 0) * (item.quantity || 1);
        }

        const orderNumber = generateOrderNumber();
        const total = subtotal; // Tax can be included or adjusted in ERP

        // 3. Create Draft Sales Order
        const orderRecord = await pb.collection('sales_orders').create({
            order_number: orderNumber,
            order_type: 'sales_order',
            customer: customer?.id || '',
            customer_name: customer?.name || customerInfo.name,
            customer_phone: normalized,
            shipping_address: customerInfo.address || customer?.address || '',
            order_date: new Date().toISOString(),
            status: 'draft',
            subtotal,
            tax_total: 0,
            discount_total: 0,
            shipping_charges: 0,
            total,
            payment_status: 'PENDING',
            payment_method: 'razorpay',
            whatsapp_order_id: message.id,
            notes: `Auto-drafted from WhatsApp Catalog order by ${customerInfo.name} (${normalized})`,
        });

        // 4. Create Order Line Items
        for (const item of items) {
            try {
                await pb.collection('sales_order_items').create({
                    order: orderRecord.id,
                    product: item.productId || '',
                    variant: item.variantId || '',
                    description: `${item.name}${item.sku ? ` (${item.sku})` : ''}`,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    tax_rate: 0,
                    discount_amount: 0,
                    total: item.totalPrice || item.unitPrice * item.quantity,
                });
            } catch (itemErr) {
                console.error('Failed to create sales order item:', itemErr);
            }
        }

        return {
            success: true,
            orderId: orderRecord.id,
            orderNumber: orderRecord.order_number,
            customerId: customer?.id,
            customerName: customer?.name || customerInfo.name,
            totalAmount: total,
            itemCount: items.length,
        };
    } catch (err: any) {
        console.error('Failed to ingest WhatsApp catalog order:', err);
        return { success: false, error: err.message };
    }
}
