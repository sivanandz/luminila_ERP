/**
 * Chat inventory service.
 *
 * The WhatsApp page listed products, de-duplicated new products by image hash
 * and created a product plus its default variant directly through PocketBase.
 * Those are inventory operations, so they live in the product layer's companion
 * for the chat surface (D-23).
 */

import { pb, sanitizeFilter } from './pocketbase';

export interface ChatProduct {
    id: string;
    name: string;
    sku: string;
    base_price: number;
    image_url?: string | null;
}

function toChatProduct(record: {
    id: string;
    name?: string;
    sku?: string;
    base_price?: number;
    image_url?: string | null;
}): ChatProduct {
    return {
        id: record.id,
        name: record.name || '',
        sku: record.sku || '',
        base_price: Number(record.base_price) || 0,
        image_url: record.image_url || null,
    };
}

/** First page of products offered in the chat cart picker. */
export async function listChatProducts(limit: number = 100): Promise<ChatProduct[]> {
    const data = await pb.collection('products').getList(1, limit);
    return data.items.map(toChatProduct);
}

/** All active products, used to refresh the picker after a new product. */
export async function listActiveChatProducts(): Promise<ChatProduct[]> {
    const records = await pb.collection('products').getFullList({
        filter: 'is_active=true',
        sort: 'name',
    });
    return records.map(toChatProduct);
}

/** Duplicate guard: find a product previously created from the same image. */
export async function findProductByImageHash(
    imageHash: string
): Promise<{ id: string; name: string; sku: string } | null> {
    const hash = sanitizeFilter((imageHash || '').trim());
    if (!hash) return null;

    const existing = await pb.collection('products').getList(1, 1, {
        filter: `image_hash="${hash}"`,
    });
    const product = existing.items[0];
    if (!product) return null;
    return { id: product.id, name: product.name, sku: product.sku };
}

export interface ChatProductInput {
    sku: string;
    name: string;
    description?: string;
    category?: string;
    basePrice?: number;
    costPrice?: number;
    imageUrl?: string;
    imageHash?: string;
    parentSku?: string;
    initialStock?: number;
}

/** Create a product from a chat image or the Add Product modal. */
export async function createChatProduct(input: ChatProductInput): Promise<ChatProduct> {
    const product = await pb.collection('products').create({
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
        base_price: input.basePrice || 0,
        cost_price: input.costPrice || null,
        image_url: input.imageUrl || null,
        image_hash: input.imageHash?.trim() || null,
        parent_sku: input.parentSku || null,
        is_active: true,
    });

    const initialStock = Number(input.initialStock) || 0;
    if (initialStock > 0) {
        await pb.collection('product_variants').create({
            product: product.id,
            sku_suffix: 'DEFAULT',
            variant_name: 'Default',
            price_adjustment: 0,
            stock_level: initialStock,
            low_stock_threshold: 5,
        });
    }

    return toChatProduct(product);
}
