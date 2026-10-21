/**
 * WhatsApp Business Catalog Sync Engine
 * Syncs Luminila jewelry inventory (products & variants) to native WhatsApp Catalog via WPPConnect.
 */

import { pb, getCurrentTenantEmail, sanitizeFilter } from './pocketbase';
import {
    createCatalogProduct,
    editCatalogProduct,
    deleteCatalogProduct,
    getCatalogProducts,
    getTenantWhatsAppSessionId,
} from './whatsapp';
import { Product, ProductVariant } from '../types/database';
import { getChannelPrice } from './channel-pricing';
import { getProductDisplayImage } from './products';

const DEFAULT_SESSION_ID = 'luminila';

/** `products` collection row as read during catalog sync, including the WhatsApp sync columns. */
type CatalogProductRecord = Product & {
    whatsapp_catalog_id?: string;
    whatsapp_last_synced?: string;
    image_data?: string;
    account_email?: string;
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
 * Resolve a product's best image payload (base64 data URI or accessible URL) for sidecar catalog sync
 */
export function resolveProductCatalogImage(p: {
    id: string;
    image_data?: string | null;
    image_url?: string | null;
}): string {
    const displayImg = getProductDisplayImage(p);
    if (displayImg) {
        if (displayImg.startsWith('data:') || displayImg.startsWith('http://') || displayImg.startsWith('https://')) {
            return displayImg;
        }
        if (typeof window !== 'undefined' && displayImg.startsWith('/')) {
            return `${window.location.origin}${displayImg}`;
        }
    }
    if (typeof window !== 'undefined' && p.id) {
        return `${window.location.origin}/api/catalog/image?id=${encodeURIComponent(p.id)}`;
    }
    return '';
}

/**
 * Fetch all publishable products from PocketBase for WhatsApp catalog sync (Dual-Layer Tenant Scoped)
 */
export async function getPublishableProducts(): Promise<WhatsAppProductItem[]> {
    try {
        const tenantEmail = getCurrentTenantEmail();
        const filterStr = tenantEmail
            ? `is_active = true && account_email = "${sanitizeFilter(tenantEmail)}"`
            : 'is_active = true';

        const [rawProducts, rawVariants] = await Promise.all([
            pb.collection('products').getFullList<CatalogProductRecord>({
                filter: filterStr,
                sort: '-created',
            }),
            pb.collection('product_variants').getFullList<ProductVariant & { account_email?: string }>({
                filter: tenantEmail ? `account_email = "${sanitizeFilter(tenantEmail)}"` : undefined,
            }).catch(() => [] as (ProductVariant & { account_email?: string })[]),
        ]);

        // Layer 2 in-memory tenant ownership guard
        const products = tenantEmail
            ? rawProducts.filter((p) => !p.account_email || p.account_email.toLowerCase() === tenantEmail.toLowerCase())
            : rawProducts;

        const stockByProduct = new Map<string, number>();
        for (const v of rawVariants) {
            if (!v.product) continue;
            if (tenantEmail && v.account_email && v.account_email.toLowerCase() !== tenantEmail.toLowerCase()) continue;
            stockByProduct.set(v.product, (stockByProduct.get(v.product) || 0) + (v.stock_level || 0));
        }

        return products.map((p) => {
            const hasVariants = stockByProduct.has(p.id);
            const totalStock = hasVariants ? (stockByProduct.get(p.id) || 0) : 1;
            return {
                id: p.id,
                sku: p.sku,
                name: p.name,
                price: getChannelPrice(p, 'whatsapp'),
                description: p.description || `${p.category || 'Jewelry'} - SKU: ${p.sku}`,
                imageUrl: resolveProductCatalogImage(p),
                inStock: totalStock > 0,
                whatsappProductId: p.whatsapp_catalog_id,
                lastSynced: p.whatsapp_last_synced,
            };
        });
    } catch (err) {
        console.error('Failed to fetch publishable products for WhatsApp:', err);
        return [];
    }
}

/**
 * Sync a single product to WhatsApp Business Catalog via Sidecar (update if existing, create if new)
 */
export async function syncProductToWhatsApp(
    product: WhatsAppProductItem,
    sessionId?: string
): Promise<{ success: boolean; whatsappProductId?: string; error?: string }> {
    try {
        const resolvedSession = sessionId || getTenantWhatsAppSessionId(getCurrentTenantEmail()) || DEFAULT_SESSION_ID;
        const formattedDescription = `${product.description}\n\nSKU: ${product.sku}\nAuthentic Craftsmanship by Luminila Jewels`;
        const productUrl = `https://luminila.com/product/${product.sku}`;

        let targetWaId = product.whatsappProductId;
        if (!targetWaId && product.sku) {
            const liveCatalog = await getCatalogProducts(resolvedSession);
            const matched = liveCatalog.find(
                (item) => item.retailerId && item.retailerId.toLowerCase() === product.sku.toLowerCase()
            );
            if (matched?.id) {
                targetWaId = String(matched.id);
            }
        }

        if (targetWaId) {
            const editRes = await editCatalogProduct(resolvedSession, targetWaId, {
                name: product.name,
                description: formattedDescription,
                price: product.price,
                currency: 'INR',
                url: productUrl,
                retailerId: product.sku,
                isHidden: !product.inStock,
                image: product.imageUrl,
            });

            if (editRes.success) {
                await pb.collection('products').update(product.id, {
                    whatsapp_catalog_id: targetWaId,
                    whatsapp_last_synced: new Date().toISOString(),
                }).catch(() => {});
                return { success: true, whatsappProductId: targetWaId };
            }
        }

        const response = await createCatalogProduct(resolvedSession, {
            name: product.name,
            description: formattedDescription,
            price: product.price,
            currency: 'INR',
            url: productUrl,
            retailerId: product.sku,
            image: product.imageUrl,
            isHidden: !product.inStock,
        });

        if (response.success && response.productId) {
            try {
                await pb.collection('products').update(product.id, {
                    whatsapp_catalog_id: response.productId,
                    whatsapp_last_synced: new Date().toISOString(),
                });
            } catch (updateErr) {
                console.warn('Could not save whatsapp_catalog_id in products table:', updateErr);
            }

            return { success: true, whatsappProductId: response.productId };
        }

        return { success: false, error: response.error || 'WPPConnect catalog product sync failed' };
    } catch (err) {
        console.error(`Error syncing product ${product.name} to WhatsApp:`, err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Human-like randomized delay helper (anti-bot pacing)
 */
function getHumanJitterDelayMs(minMs = 3500, maxMs = 7500): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const triangular = (u1 + u2) / 2; // Clusters naturally around the midpoint
    return Math.round(minMs + triangular * (maxMs - minMs));
}

/**
 * Batch sync active products to WhatsApp Catalog with human-paced anti-bot delays
 */
export async function batchSyncCatalog(
    products: WhatsAppProductItem[],
    sessionId?: string,
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

        // Human-paced randomized delay between items to avoid WhatsApp bot detection
        if (i < products.length - 1) {
            await new Promise((r) => setTimeout(r, getHumanJitterDelayMs(3500, 7500)));
        }
    }

    return result;
}

/**
 * Remove a product from WhatsApp Catalog
 */
export async function removeProductFromWhatsApp(
    whatsappProductId: string,
    sessionId?: string
): Promise<boolean> {
    const resolvedSession = sessionId || getTenantWhatsAppSessionId(getCurrentTenantEmail()) || DEFAULT_SESSION_ID;
    return deleteCatalogProduct(resolvedSession, whatsappProductId);
}

/**
 * Fetch active products currently published in WhatsApp Business Catalog
 */
export async function fetchLiveWhatsAppCatalog(
    sessionId?: string
) {
    const resolvedSession = sessionId || getTenantWhatsAppSessionId(getCurrentTenantEmail()) || DEFAULT_SESSION_ID;
    return getCatalogProducts(resolvedSession);
}
