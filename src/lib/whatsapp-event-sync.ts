/**
 * WhatsApp Event-Driven Catalog Sync Engine
 * Automatically keeps WhatsApp Business Catalog synchronized with PocketBase inventory in real-time.
 * 
 * Triggers on:
 * - Product creation, updates (prices, names, channel overrides, active status)
 * - Variant stock updates (POS checkouts, manual stock adjustments)
 * 
 * Features:
 * - Computes channel price using `getChannelPrice(product, 'whatsapp')`
 * - Debounces rapid successive mutations (e.g. multi-item POS sales)
 * - Updates existing catalog items or creates new ones with SKU retailerId
 * - Hides products from WhatsApp catalog when out-of-stock (0 inventory)
 */

import { pb } from './pocketbase';
import { Product, ProductVariant } from '../types/database';
import { getChannelPrice } from './channel-pricing';
import {
    checkWhatsAppStatus,
    createCatalogProduct,
    editCatalogProduct,
    deleteCatalogProduct,
    getCatalogProducts,
    whatsappManager,
} from './whatsapp';
import { toast } from 'sonner';

const DEBOUNCE_MS = 1500;
const AUTO_SYNC_STORAGE_KEY = 'whatsapp_catalog_auto_sync';

// Track pending debounce timers per product ID
const pendingSyncQueue = new Map<string, { timer: NodeJS.Timeout; action: string }>();

let isSubscribed = false;
let unsubscribeProducts: (() => void) | null = null;
let unsubscribeVariants: (() => void) | null = null;

/**
 * Check if event-driven auto-sync is enabled in client preferences
 */
export function isAutoSyncEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    const val = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    return val === null ? true : val === 'true'; // Default true
}

/**
 * Toggle event-driven auto-sync
 */
export function setAutoSyncEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(AUTO_SYNC_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(
        new CustomEvent('whatsapp:auto-sync-status', {
            detail: { enabled },
        })
    );
}

/**
 * Queue a product for debounced catalog sync
 */
export function queueProductCatalogSync(productId: string, action: 'create' | 'update' | 'delete' = 'update') {
    if (!isAutoSyncEnabled()) return;
    if (!productId) return;

    const existing = pendingSyncQueue.get(productId);
    if (existing) {
        clearTimeout(existing.timer);
    }

    const timer = setTimeout(async () => {
        pendingSyncQueue.delete(productId);
        await executeProductCatalogSync(productId, action);
    }, DEBOUNCE_MS);

    pendingSyncQueue.set(productId, { timer, action });
}

/**
 * Synchronize a specific product to WhatsApp Business Catalog immediately
 */
export async function executeProductCatalogSync(
    productId: string,
    action: string = 'update',
    showNotification = true
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionId = whatsappManager.getSessionIdSafe() || 'luminila';

        // 1. Check if WhatsApp server is reachable
        const status = await checkWhatsAppStatus();
        if (!status.ok) {
            console.log('[wa-catalog-sync] WhatsApp sidecar unreachable, skipping sync for:', productId);
            return { success: false, error: 'WhatsApp sidecar unreachable' };
        }

        // 2. Fetch the target product
        let product: (Product & { whatsapp_catalog_id?: string }) | null = null;
        try {
            product = await pb.collection('products').getOne<Product & { whatsapp_catalog_id?: string }>(productId);
        } catch {
            // Product might have been deleted
            product = null;
        }

        // If action is delete or product not found
        if (action === 'delete' || !product) {
            console.log('[wa-catalog-sync] Deleting product from catalog:', productId);
            return { success: true };
        }

        // 3. Fetch product variants to calculate real-time inventory level
        let totalStock = 1;
        try {
            const variants = await pb.collection('product_variants').getFullList<ProductVariant>({
                filter: `product = "${productId}"`,
            });
            if (variants.length > 0) {
                totalStock = variants.reduce((sum, v) => sum + (v.stock_level || 0), 0);
            }
        } catch (variantErr) {
            console.warn('[wa-catalog-sync] Failed to fetch variants:', variantErr);
        }

        // 4. Calculate WhatsApp Channel Price
        const targetPrice = getChannelPrice(product, 'whatsapp');
        const isHidden = !product.is_active || totalStock <= 0;

        // 5. Check if product already exists in WhatsApp catalog
        let waCatalogId = product.whatsapp_catalog_id;

        if (!waCatalogId) {
            // Check live catalog to see if an item with this SKU already exists
            const liveCatalog = await getCatalogProducts(sessionId);
            const matched = liveCatalog.find(
                (p) => (p as unknown as { retailerId?: string }).retailerId === product!.sku
            );
            if (matched) {
                waCatalogId = matched.id;
            }
        }

        if (waCatalogId) {
            // Edit existing catalog product
            const editRes = await editCatalogProduct(sessionId, waCatalogId, {
                name: product.name,
                price: targetPrice,
                description: `${product.description || product.category || 'Jewelry'}\n\nSKU: ${product.sku}\nLuminila Jewels`,
                isHidden,
            });

            if (editRes.success) {
                await pb.collection('products').update(product.id, {
                    whatsapp_catalog_id: waCatalogId,
                    whatsapp_last_synced: new Date().toISOString(),
                }).catch(() => {});

                if (showNotification) {
                    toast.success(`WhatsApp Catalog Synced: ${product.name}`, {
                        description: `Price: ₹${targetPrice.toLocaleString('en-IN')} • ${isHidden ? 'Hidden (Out of Stock)' : `Active (${totalStock} in stock)`}`,
                    });
                }
                return { success: true };
            } else {
                console.warn('[wa-catalog-sync] Failed to edit product in catalog:', editRes.error);
                return { success: false, error: editRes.error };
            }
        } else {
            // If inactive or out-of-stock and not yet in catalog, don't create it
            if (isHidden) {
                return { success: true };
            }

            // Create new catalog product
            const createRes = await createCatalogProduct(sessionId, {
                name: product.name,
                price: targetPrice,
                description: `${product.description || product.category || 'Jewelry'}\n\nSKU: ${product.sku}\nLuminila Jewels`,
                currency: 'INR',
                retailerId: product.sku,
                image: product.image_url || '',
                url: `https://luminila.com/product/${product.sku}`,
                isHidden: false,
            });

            if (createRes.success && createRes.productId) {
                await pb.collection('products').update(product.id, {
                    whatsapp_catalog_id: createRes.productId,
                    whatsapp_last_synced: new Date().toISOString(),
                }).catch(() => {});

                if (showNotification) {
                    toast.success(`WhatsApp Catalog Added: ${product.name}`, {
                        description: `Published at ₹${targetPrice.toLocaleString('en-IN')} (WhatsApp Price)`,
                    });
                }
                return { success: true };
            } else {
                return { success: false, error: 'Could not create catalog product' };
            }
        }
    } catch (err) {
        console.error('[wa-catalog-sync] Unexpected error during sync:', err);
        return { success: false, error: (err as Error)?.message || String(err) };
    }
}

/**
 * Initialize PocketBase real-time event listeners for automatic WhatsApp catalog sync
 */
export function initWhatsAppEventSync(): () => void {
    if (typeof window === 'undefined') {
        return () => {};
    }

    if (isSubscribed) {
        return () => {};
    }

    isSubscribed = true;
    console.log('[wa-catalog-sync] Initializing real-time WhatsApp catalog sync listener...');

    // 1. Subscribe to Product changes (Price, Name, WhatsApp Channel overrides, Active state)
    pb.collection('products')
        .subscribe('*', (e) => {
            if (!isAutoSyncEnabled()) return;
            const record = e.record as Product;
            if (!record?.id) return;
            queueProductCatalogSync(record.id, e.action as 'create' | 'update' | 'delete');
        })
        .then(() => {
            unsubscribeProducts = () => {
                pb.collection('products').unsubscribe('*').catch(() => {});
            };
        })
        .catch((err) => {
            console.error('[wa-catalog-sync] Failed to subscribe to products:', err);
        });

    // 2. Subscribe to Variant changes (POS stock decrements, stock additions)
    pb.collection('product_variants')
        .subscribe('*', (e) => {
            if (!isAutoSyncEnabled()) return;
            const record = e.record as ProductVariant;
            if (!record?.product) return;
            queueProductCatalogSync(record.product, 'update');
        })
        .then(() => {
            unsubscribeVariants = () => {
                pb.collection('product_variants').unsubscribe('*').catch(() => {});
            };
        })
        .catch((err) => {
            console.error('[wa-catalog-sync] Failed to subscribe to product_variants:', err);
        });

    return () => {
        isSubscribed = false;
        if (unsubscribeProducts) unsubscribeProducts();
        if (unsubscribeVariants) unsubscribeVariants();
    };
}
