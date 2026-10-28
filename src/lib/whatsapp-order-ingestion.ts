/**
 * WhatsApp order ingestion.
 *
 * Inbound catalog orders and parsed chat orders used to be written by a second,
 * divergent implementation: it created a draft `sales_orders` header, then wrote
 * `whatsapp_order_id`/`payment_method` (columns that did not exist), empty
 * `product`/`variant` relations (required — every item insert was rejected and
 * swallowed), and its own customer lookup that bypassed the shared upsert.
 *
 * The ingestion path now delegates to `createSaleFromChat`, so an inbound order
 * gets exactly the same capture contract as an operator-built chat order:
 * server-recomputed prices and tax, variant-persisted items, channel stock, a
 * payment trail, aggregates/loyalty, idempotency and compensation (CO-11).
 */

import { pb } from './pocketbase';
import { createSaleFromChat } from './chat-sales';
import type { WPPMessage } from './whatsapp';

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
 * Ingest an incoming WhatsApp catalog order into a real sales order.
 *
 * `unitPrice`/`totalPrice` on the parsed items are intentionally ignored: the
 * order service re-reads pricing from the database.
 */
export async function ingestWhatsAppCatalogOrder(
    message: WPPMessage,
    customerInfo: {
        name: string;
        phone: string;
        address?: string;
        city?: string;
        state?: string;
        pincode?: string;
    },
    items: IngestedOrderItem[]
): Promise<IngestionResult> {
    try {
        if (!Array.isArray(items) || items.length === 0) {
            return { success: false, error: 'No items provided for order ingestion' };
        }

        // Resolve every parsed line to a real product. The conversation may only
        // give a SKU, so match on it before failing the whole ingestion.
        const cart: { id: string; variantId?: string; quantity: number; name?: string }[] = [];
        for (const item of items) {
            let productId = item.productId || '';
            if (!productId && item.sku) {
                const product = await pb
                    .collection('products')
                    .getFirstListItem<{ id: string }>(
                        pb.filter('sku = {:sku}', { sku: item.sku })
                    )
                    .catch(() => null);
                productId = product?.id || '';
            }
            if (!productId) {
                return {
                    success: false,
                    error: `Could not match a product for "${item.name}"${item.sku ? ` (SKU ${item.sku})` : ''}`,
                };
            }
            cart.push({
                id: productId,
                variantId: item.variantId,
                quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
                name: item.name,
            });
        }

        const sale = await createSaleFromChat({
            customerName: customerInfo.name,
            customerPhone: customerInfo.phone,
            cart,
            chatId: message.from || '',
            messageId: message.id || '',
            shippingAddress: customerInfo.address,
            city: customerInfo.city,
            state: customerInfo.state,
            pincode: customerInfo.pincode,
            // One message is one order: a retried ingestion of the same message
            // resolves to the same order instead of duplicating it (CO-12).
            idempotencyKey: `CATALOG-${String(message.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`,
        });

        return {
            success: true,
            orderId: sale.orderId,
            orderNumber: sale.orderNumber,
            customerId: sale.customerId,
            customerName: customerInfo.name,
            totalAmount: sale.total,
            itemCount: cart.length,
        };
    } catch (err) {
        console.error('Failed to ingest WhatsApp catalog order:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
