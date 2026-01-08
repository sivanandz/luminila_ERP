/**
 * Unified Sync Engine
 * Orchestrates synchronization across all channels using PocketBase
 */

import { pb } from "./pocketbase";
import {
    isShopifyConfigured,
    fetchAllShopifyProducts,
    fetchShopifyOrders,
    pushInventoryToShopify
} from "./sync/shopify";
import {
    isWooCommerceConfigured,
    fetchAllWooProducts,
    fetchWooOrders,
    pushInventoryToWoo
} from "./sync/woocommerce";

export interface SyncResult {
    success: boolean;
    channel: string;
    operation: "pull" | "push";
    itemsProcessed: number;
    errors: string[];
    timestamp: Date;
}

export interface SyncStatus {
    lastSync: Date | null;
    isRunning: boolean;
    channels: {
        shopify: { connected: boolean; lastSync: Date | null };
        woocommerce: { connected: boolean; lastSync: Date | null };
        pos: { connected: boolean; lastSync: Date | null };
        whatsapp: { connected: boolean; lastSync: Date | null };
    };
}

/**
 * Get current sync status
 */
export function getSyncStatus(): SyncStatus {
    const stored = typeof window !== "undefined"
        ? localStorage.getItem("luminila_sync_status")
        : null;

    const defaults: SyncStatus = {
        lastSync: null,
        isRunning: false,
        channels: {
            shopify: { connected: isShopifyConfigured(), lastSync: null },
            woocommerce: { connected: isWooCommerceConfigured(), lastSync: null },
            pos: { connected: true, lastSync: null },
            whatsapp: { connected: false, lastSync: null },
        },
    };

    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            return { ...defaults, ...parsed };
        } catch {
            return defaults;
        }
    }

    return defaults;
}

/**
 * Save sync status
 */
function saveSyncStatus(status: Partial<SyncStatus>): void {
    if (typeof window === "undefined") return;

    const current = getSyncStatus();
    const updated = { ...current, ...status };
    localStorage.setItem("luminila_sync_status", JSON.stringify(updated));
}

/**
 * Pull products from all connected channels
 */
export async function pullAllProducts(
    onProgress?: (channel: string, progress: number) => void
): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    saveSyncStatus({ isRunning: true });

    // Shopify
    if (isShopifyConfigured()) {
        try {
            onProgress?.("shopify", 0);
            const products = await fetchAllShopifyProducts();

            let processed = 0;
            for (const product of products) {
                try {
                    const existing = await pb.collection('products').getFirstListItem(`sku="${product.handle}"`).catch(() => null);

                    if (existing) {
                        await pb.collection('products').update(existing.id, {
                            name: product.title,
                        });
                    } else {
                        await pb.collection('products').create({
                            sku: product.handle,
                            name: product.title,
                            is_active: true,
                        });
                    }
                } catch (e) {
                    console.error(`Failed to upsert product ${product.handle}:`, e);
                }

                processed++;
                onProgress?.("shopify", (processed / products.length) * 100);
            }

            results.push({
                success: true,
                channel: "shopify",
                operation: "pull",
                itemsProcessed: products.length,
                errors: [],
                timestamp: new Date(),
            });

            saveSyncStatus({
                channels: {
                    ...getSyncStatus().channels,
                    shopify: { connected: true, lastSync: new Date() }
                }
            });
        } catch (err) {
            results.push({
                success: false,
                channel: "shopify",
                operation: "pull",
                itemsProcessed: 0,
                errors: [err instanceof Error ? err.message : "Unknown error"],
                timestamp: new Date(),
            });
        }
    }

    // WooCommerce
    if (isWooCommerceConfigured()) {
        try {
            onProgress?.("woocommerce", 0);
            const products = await fetchAllWooProducts();

            let processed = 0;
            for (const product of products) {
                try {
                    const existing = await pb.collection('products').getFirstListItem(`sku="${product.sku}"`).catch(() => null);

                    if (existing) {
                        await pb.collection('products').update(existing.id, {
                            name: product.name,
                        });
                    } else {
                        await pb.collection('products').create({
                            sku: product.sku,
                            name: product.name,
                            base_price: parseFloat(product.price),
                            is_active: true,
                        });
                    }
                } catch (e) {
                    console.error(`Failed to upsert product ${product.sku}:`, e);
                }

                processed++;
                onProgress?.("woocommerce", (processed / products.length) * 100);
            }

            results.push({
                success: true,
                channel: "woocommerce",
                operation: "pull",
                itemsProcessed: products.length,
                errors: [],
                timestamp: new Date(),
            });

            saveSyncStatus({
                channels: {
                    ...getSyncStatus().channels,
                    woocommerce: { connected: true, lastSync: new Date() }
                }
            });
        } catch (err) {
            results.push({
                success: false,
                channel: "woocommerce",
                operation: "pull",
                itemsProcessed: 0,
                errors: [err instanceof Error ? err.message : "Unknown error"],
                timestamp: new Date(),
            });
        }
    }

    saveSyncStatus({ isRunning: false, lastSync: new Date() });
    return results;
}

/**
 * Push inventory levels to all connected channels
 */
export async function pushInventoryToAll(
    variantId: string,
    sku: string,
    newQuantity: number
): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    // Get variant info for channel mappings
    let variant: any = null;
    try {
        variant = await pb.collection('product_variants').getOne(variantId);
    } catch (e) { }

    // Push to Shopify
    if (isShopifyConfigured()) {
        const success = await pushInventoryToShopify(sku, newQuantity);
        results.push({
            success,
            channel: "shopify",
            operation: "push",
            itemsProcessed: success ? 1 : 0,
            errors: success ? [] : ["Failed to push to Shopify"],
            timestamp: new Date(),
        });
    }

    // Push to WooCommerce
    if (isWooCommerceConfigured() && variant?.woocommerce_product_id) {
        const success = await pushInventoryToWoo(
            variant.woocommerce_product_id,
            null,
            newQuantity
        );
        results.push({
            success,
            channel: "woocommerce",
            operation: "push",
            itemsProcessed: success ? 1 : 0,
            errors: success ? [] : ["Failed to push to WooCommerce"],
            timestamp: new Date(),
        });
    }

    return results;
}

/**
 * Pull orders from all channels
 */
export async function pullAllOrders(
    since?: Date
): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    // Shopify orders
    if (isShopifyConfigured()) {
        try {
            const orders = await fetchShopifyOrders(since);

            for (const order of orders) {
                try {
                    const existing = await pb.collection('sales').getFirstListItem(
                        `channel_order_id="${order.id}" && channel="shopify"`
                    ).catch(() => null);

                    if (!existing) {
                        await pb.collection('sales').create({
                            channel: "shopify",
                            channel_order_id: order.id,
                            customer_name: order.customer?.displayName || '',
                            customer_phone: order.customer?.phone || '',
                            total: parseFloat(order.totalPriceSet.shopMoney.amount),
                            subtotal: parseFloat(order.totalPriceSet.shopMoney.amount),
                            discount: 0,
                            status: mapShopifyStatus(order.fulfillmentStatus),
                        });
                    }
                } catch (e) {
                    console.error(`Failed to upsert order ${order.id}:`, e);
                }
            }

            results.push({
                success: true,
                channel: "shopify",
                operation: "pull",
                itemsProcessed: orders.length,
                errors: [],
                timestamp: new Date(),
            });
        } catch (err) {
            results.push({
                success: false,
                channel: "shopify",
                operation: "pull",
                itemsProcessed: 0,
                errors: [err instanceof Error ? err.message : "Unknown error"],
                timestamp: new Date(),
            });
        }
    }

    // WooCommerce orders
    if (isWooCommerceConfigured()) {
        try {
            const orders = await fetchWooOrders(since);

            for (const order of orders) {
                try {
                    const existing = await pb.collection('sales').getFirstListItem(
                        `channel_order_id="${order.id}" && channel="woocommerce"`
                    ).catch(() => null);

                    if (!existing) {
                        await pb.collection('sales').create({
                            channel: "woocommerce",
                            channel_order_id: order.id.toString(),
                            customer_name: `${order.billing.first_name} ${order.billing.last_name}`,
                            customer_phone: order.billing.phone || '',
                            customer_address: `${order.billing.address_1}, ${order.billing.city}`,
                            total: parseFloat(order.total),
                            subtotal: parseFloat(order.total),
                            discount: 0,
                            status: mapWooStatus(order.status),
                        });
                    }
                } catch (e) {
                    console.error(`Failed to upsert order ${order.id}:`, e);
                }
            }

            results.push({
                success: true,
                channel: "woocommerce",
                operation: "pull",
                itemsProcessed: orders.length,
                errors: [],
                timestamp: new Date(),
            });
        } catch (err) {
            results.push({
                success: false,
                channel: "woocommerce",
                operation: "pull",
                itemsProcessed: 0,
                errors: [err instanceof Error ? err.message : "Unknown error"],
                timestamp: new Date(),
            });
        }
    }

    return results;
}

function mapShopifyStatus(status: string): "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" {
    switch (status?.toLowerCase()) {
        case "fulfilled": return "shipped";
        case "partial": return "confirmed";
        case "unfulfilled": return "pending";
        default: return "pending";
    }
}

function mapWooStatus(status: string): "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" {
    switch (status) {
        case "completed": return "delivered";
        case "processing": return "confirmed";
        case "on-hold": return "pending";
        case "cancelled": return "cancelled";
        case "refunded": return "cancelled";
        default: return "pending";
    }
}

/**
 * Full sync across all channels
 */
export async function fullSync(
    onProgress?: (phase: string, progress: number) => void
): Promise<SyncResult[]> {
    const allResults: SyncResult[] = [];

    onProgress?.("products", 0);
    const productResults = await pullAllProducts((channel, progress) => {
        onProgress?.(`products:${channel}`, progress);
    });
    allResults.push(...productResults);

    onProgress?.("orders", 0);
    const orderResults = await pullAllOrders();
    allResults.push(...orderResults);

    onProgress?.("complete", 100);
    return allResults;
}
