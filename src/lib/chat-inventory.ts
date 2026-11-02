/**
 * Chat inventory service.
 *
 * The WhatsApp page listed products, de-duplicated new products by image hash
 * and created a product plus its default variant directly through PocketBase.
 * Those are inventory operations, so they live in the product layer's companion
 * for the chat surface (D-23).
 *
 * Every read/write is tenant-scoped (WA-05): the chat picker previously listed
 * the first 100 products across all accounts and created products without an
 * owner, so a second tenant's catalog appeared in the concierge and the new
 * rows were invisible to their own tenant.
 */

import { pb, sanitizeFilter } from './pocketbase';
import { withTenantFilter, tenantScopeEmail } from './whatsapp-crm';

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

function belongsToTenant(record: unknown): boolean {
    const tenant = tenantScopeEmail();
    const stored = String((record as { account_email?: unknown })?.account_email || '').trim().toLowerCase();
    return !stored || !tenant || stored === tenant;
}

/** First page of products offered in the chat cart picker. */
export async function listChatProducts(limit: number = 100): Promise<ChatProduct[]> {
    const data = await pb.collection('products').getList(1, limit, {
        filter: withTenantFilter(),
        sort: 'name',
    });
    return data.items.filter(belongsToTenant).map(toChatProduct);
}

/** All active products, used to refresh the picker after a new product. */
export async function listActiveChatProducts(): Promise<ChatProduct[]> {
    const records = await pb.collection('products').getFullList({
        filter: withTenantFilter('is_active=true'),
        sort: 'name',
    });
    return records.filter(belongsToTenant).map(toChatProduct);
}

/** Duplicate guard: find a product previously created from the same image. */
export async function findProductByImageHash(
    imageHash: string
): Promise<{ id: string; name: string; sku: string } | null> {
    const hash = sanitizeFilter((imageHash || '').trim());
    if (!hash) return null;

    const existing = await pb.collection('products').getList(1, 1, {
        filter: withTenantFilter(`image_hash="${hash}"`),
    });
    const product = existing.items[0];
    if (!product || !belongsToTenant(product)) return null;
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

/** Base64 / data-URI media belongs in `image_data`, not `image_url`. */
function splitImagePayload(image?: string): { imageUrl: string; imageData: string } {
    const value = (image || '').trim();
    if (!value) return { imageUrl: '', imageData: '' };
    if (value.startsWith('data:') || (!value.startsWith('http://') && !value.startsWith('https://') && value.length > 200)) {
        return { imageUrl: '', imageData: value };
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return { imageUrl: value, imageData: '' };
    }
    return { imageUrl: '', imageData: '' };
}

/** Create a product from a chat image or the Add Product modal. */
export async function createChatProduct(input: ChatProductInput): Promise<ChatProduct> {
    const { imageUrl, imageData } = splitImagePayload(input.imageUrl);
    const tenant = tenantScopeEmail();
    if (!tenant) {
        throw new Error('No tenant session: sign in before creating a product.');
    }

    const product = await pb.collection('products').create({
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
        base_price: input.basePrice || 0,
        cost_price: input.costPrice || null,
        image_url: imageUrl || null,
        // WA-05: the picker saved every base64 upload into image_url, which the
        // product card and WhatsApp sync then treated as a URL.
        image_data: imageData || null,
        image_hash: input.imageHash?.trim() || null,
        parent_sku: input.parentSku || null,
        is_active: true,
        account_email: tenant,
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
            account_email: tenant,
        });
    }

    return toChatProduct(product);
}
