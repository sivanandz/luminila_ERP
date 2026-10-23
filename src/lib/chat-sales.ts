/**
 * Chat sales service.
 *
 * "Create order" from a WhatsApp conversation used to build a sale, look up a
 * variant per cart line and create sale items inline in the page. The numbers
 * and the records should be created the same way any other channel sale is, so
 * the operation lives in the service layer (D-23).
 */

import { pb } from './pocketbase';

export interface ChatCartLine {
    id: string;
    base_price: number;
    quantity?: number;
}

export interface ChatSaleInput {
    customerName: string;
    customerPhone: string;
    customerId?: string;
    cart: ChatCartLine[];
    total: number;
}

export async function createSaleFromChat(input: ChatSaleInput): Promise<{ id: string }> {
    if (input.cart.length === 0) {
        throw new Error('Cannot create a sale from an empty cart');
    }

    const sale = await pb.collection('sales').create({
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        customer: input.customerId || '',
        status: 'pending',
        total: input.total,
        subtotal: input.total,
        discount: 0,
        channel: 'whatsapp',
        payment_method: 'upi',
    });

    for (const item of input.cart) {
        const quantity = Number(item.quantity) || 1;
        const variants = await pb.collection('product_variants').getList(1, 1, {
            filter: `product="${item.id}"`,
        });
        const variantId = variants.items[0]?.id || '';

        await pb.collection('sale_items').create({
            sale: sale.id,
            product: item.id,
            variant: variantId,
            quantity,
            unit_price: item.base_price,
            total: item.base_price * quantity,
            total_price: item.base_price * quantity,
            discount: 0,
        });
    }

    return { id: sale.id };
}
