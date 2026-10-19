/**
 * WhatsApp Business Catalog Sync Engine
 * Syncs Luminila jewelry inventory (products & variants) to native WhatsApp Catalog via WPPConnect.
 */

import { pb } from './pocketbase';
import { createCatalogProduct, deleteCatalogProduct, getCatalogProducts } from './whatsapp';
import { Product } from '../types/database';
import { getChannelPrice } from './channel-pricing';

const DEFAULT_SESSION_ID = 'luminila';

/** `products` collection row as read during catalog sync, including the WhatsApp sync columns. */
type CatalogProductRecord = Product & {
    whatsapp_catalog_id?: string;
    whatsapp_last_synced?: string;
};

export interface CatalogSyncResult {
    total: number;
    synced: number;
    failed: number;
    errors: { id: string; name: string; error: string }[];
}

export interface WhatsAppProductItem {
    id: string;
    sku: string;
    name: string;
    price: number;
    description: string;
    imageUrl?: string;
    inStock: boolean;
    whatsappProductId?: string;
    lastSynced?: string;
}

/**
 * Fetch all publishable products from PocketBase for WhatsApp catalog sync
 */
export async function getPublishableProducts(): Promise<WhatsAppProductItem[]> {
    try {
        const products = await pb.collection('products').getFullList<CatalogProductRecord>({
            filter: 'is_active = true',
            sort: '-created',
        });

        return products.map((p) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            price: getChannelPrice(p, 'whatsapp'),
            description: p.description || `${p.category || 'Jewelry'} - SKU: ${p.sku}`,
            imageUrl: p.image_url,
            inStock: true,
            whatsappProductId: p.whatsapp_catalog_id,
            lastSynced: p.whatsapp_last_synced,
        }));
    } catch (err) {
        console.error('Failed to fetch publishable products for WhatsApp:', err);
        return [];
    }
}

/**
 * Sync a single product to WhatsApp Business Catalog
 */
export async function syncProductToWhatsApp(
    product: WhatsAppProductItem,
    sessionId: string = DEFAULT_SESSION_ID
): Promise<{ success: boolean; whatsappProductId?: string; error?: string }> {
    try {
        // Price in WhatsApp catalog is formatted in INR units
        const response = await createCatalogProduct(sessionId, {
            name: product.name,
            description: `${product.description}\n\nSKU: ${product.sku}\nAuthentic Craftsmanship by Luminila Jewels`,
            price: product.price,
            currency: 'INR',
            url: `https://luminila.com/product/${product.sku}`,
        });

        if (response.success && response.productId) {
            // Update product in PocketBase with the synced catalog ID
            try {
                await pb.collection('products').update(product.id, {
                    whatsapp_catalog_id: response.productId,
                    whatsapp_last_synced: new Date().toISOString(),
                });
            } catch (updateErr) {
                console.warn('Could not save whatsapp_catalog_id in products table (column may be optional):', updateErr);
            }

            return { success: true, whatsappProductId: response.productId };
        }

        return { success: false, error: 'WPPConnect catalog product creation failed' };
    } catch (err) {
        console.error(`Error syncing product ${product.name} to WhatsApp:`, err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Batch sync all active products to WhatsApp Catalog with real-time progress callbacks
 */
export async function batchSyncCatalog(
    products: WhatsAppProductItem[],
    sessionId: string = DEFAULT_SESSION_ID,
    onProgress?: (current: number, total: number) => void
): Promise<CatalogSyncResult> {
    const result: CatalogSyncResult = {
        total: products.length,
        synced: 0,
        failed: 0,
        errors: [],
    };

    for (let i = 0; i < products.length; i++) {
        const item = products[i];
        if (onProgress) {
            onProgress(i + 1, products.length);
        }

        const res = await syncProductToWhatsApp(item, sessionId);
        if (res.success) {
            result.synced++;
        } else {
            result.failed++;
            result.errors.push({
                id: item.id,
                name: item.name,
                error: res.error || 'Unknown error',
            });
        }

        // 300ms throttle to prevent WhatsApp catalog rate-limiting
        await new Promise((r) => setTimeout(r, 300));
    }

    return result;
}

/**
 * Remove a product from WhatsApp Catalog
 */
export async function removeProductFromWhatsApp(
    whatsappProductId: string,
    sessionId: string = DEFAULT_SESSION_ID
): Promise<boolean> {
    return deleteCatalogProduct(sessionId, whatsappProductId);
}

/**
 * Fetch active products currently published in WhatsApp Business Catalog
 */
export async function fetchLiveWhatsAppCatalog(
    sessionId: string = DEFAULT_SESSION_ID
) {
    return getCatalogProducts(sessionId);
}
