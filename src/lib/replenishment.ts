/**
 * Smart Replenishment & Reorder Service (Phase 5).
 *
 * Automatically detects low-stock pieces and fast-selling items with critical cover,
 * attributes them to primary vendors, groups them by supplier, and provides:
 * 1. 1-Click Create Draft Purchase Order.
 * 2. Editable WhatsApp Vendor Reorder Message with line items.
 */

import { pb, accountScopeEmail, sanitizeFilter } from "./pocketbase";
import { getVendors, type Vendor } from "./vendors";
import { getOpenPurchaseOrderItems } from "./purchase";
import { getProductDisplayImage } from "./products";

export interface RestockItem {
    productId: string;
    variantId: string;
    sku: string;
    name: string;
    currentStock: number;
    pendingPOQuantity: number;
    lowStockThreshold: number;
    suggestedQuantity: number;
    unitCost: number;
    vendorId?: string;
    vendorName: string;
    vendorPhone?: string;
    image_url?: string | null;
}

export interface VendorRestockGroup {
    vendorId?: string;
    vendorName: string;
    vendorPhone?: string;
    items: RestockItem[];
    estimatedTotalCost: number;
}

// ===========================================
// PURE GROUPING (IO-FREE)
// ===========================================

export function groupRestockItemsByVendor(items: RestockItem[]): VendorRestockGroup[] {
    const map = new Map<string, VendorRestockGroup>();

    for (const item of items) {
        const key = item.vendorId || "unassigned";
        const existing = map.get(key);
        const lineCost = item.suggestedQuantity * item.unitCost;

        if (existing) {
            existing.items.push(item);
            existing.estimatedTotalCost += lineCost;
        } else {
            map.set(key, {
                vendorId: item.vendorId,
                vendorName: item.vendorName || "Unassigned Supplier",
                vendorPhone: item.vendorPhone,
                items: [item],
                estimatedTotalCost: lineCost,
            });
        }
    }

    return Array.from(map.values()).sort((a, b) => b.estimatedTotalCost - a.estimatedTotalCost);
}

/** Formats an editable WhatsApp order message for the vendor */
export function formatVendorWhatsAppMessage(group: VendorRestockGroup, storeName: string = "Luminila Jewellery"): string {
    const lines = group.items.map(
        (it, idx) => `${idx + 1}. SKU: ${it.sku} — ${it.name} | Qty: ${it.suggestedQuantity} pcs (Est: ₹${it.unitCost}/pc)`
    );

    return `Hello ${group.vendorName}, this is ${storeName}. We would like to place a restock order for the following jewellery items:

${lines.join("\n")}

Total Pieces: ${group.items.reduce((sum, it) => sum + it.suggestedQuantity, 0)} pcs
Estimated Total: ₹${group.estimatedTotalCost.toLocaleString("en-IN")}

Please confirm availability, current batch rates, and estimated dispatch date. Thank you!`;
}

// ===========================================
// IO SERVICE
// ===========================================

/**
 * Scan all inventory to detect items needing replenishment.
 */
export async function loadReplenishmentQueue(): Promise<VendorRestockGroup[]> {
    try {
        const tenant = accountScopeEmail();
        const tenantFilter = tenant ? `account_email = "${sanitizeFilter(tenant)}"` : "";

        // 1. Fetch vendors
        const vendors = await getVendors();
        const vendorMap = new Map<string, Vendor>();
        for (const v of vendors) vendorMap.set(v.id, v);

        // 2. Fetch open PO incoming quantities
        const openPOItems = await getOpenPurchaseOrderItems();
        const pendingQtyByVariant = new Map<string, number>();
        for (const poItem of openPOItems) {
            const variantId = poItem.variant;
            if (variantId) {
                const ordered = poItem.quantity_ordered ?? poItem.quantity ?? 0;
                const rec = poItem.quantity_received || 0;
                const pending = Math.max(0, ordered - rec);
                pendingQtyByVariant.set(
                    variantId,
                    (pendingQtyByVariant.get(variantId) || 0) + pending
                );
            }
        }

        // 3. Fetch vendor_products mapping
        const vendorProducts = await pb.collection("vendor_products").getFullList<{
            vendor: string;
            variant: string;
            vendor_price?: number;
        }>({
            filter: tenantFilter ? tenantFilter : undefined,
        }).catch(() => []);

        const variantToVendorMap = new Map<string, { vendorId: string; vendorPrice?: number }>();
        for (const vp of vendorProducts) {
            if (vp.variant && vp.vendor) {
                variantToVendorMap.set(vp.variant, {
                    vendorId: vp.vendor,
                    vendorPrice: vp.vendor_price ? Number(vp.vendor_price) : undefined,
                });
            }
        }

        // 4. Fetch variants and parent products
        const variants = await pb.collection("product_variants").getFullList<{
            id: string;
            product: string;
            variant_name: string;
            sku_suffix?: string;
            stock_level?: number;
            low_stock_threshold?: number;
            expand?: {
                product?: {
                    id: string;
                    sku: string;
                    name: string;
                    cost_price?: number;
                    image_url?: string;
                    image_data?: string;
                    is_active?: boolean;
                };
            };
        }>({
            filter: tenantFilter ? `product.is_active = true && ${tenantFilter}` : "product.is_active = true",
            expand: "product",
        });

        const restockItems: RestockItem[] = [];

        for (const v of variants) {
            const prod = v.expand?.product;
            if (!prod) continue;

            const stock = Number(v.stock_level) || 0;
            const pendingPO = pendingQtyByVariant.get(v.id) || 0;
            const threshold = Number(v.low_stock_threshold) || 5;

            // Effective available stock accounting for pending POs
            const effectiveStock = stock + pendingPO;

            if (effectiveStock <= threshold) {
                const sku = prod.sku && v.sku_suffix ? `${prod.sku}-${v.sku_suffix}` : prod.sku || v.id;
                const vpInfo = variantToVendorMap.get(v.id);
                const vendor = vpInfo ? vendorMap.get(vpInfo.vendorId) : undefined;
                const unitCost = vpInfo?.vendorPrice || Number(prod.cost_price) || 0;

                // Suggested reorder: bring stock up to at least 3x threshold
                const targetStock = Math.max(15, threshold * 3);
                const suggestedQty = Math.max(5, targetStock - effectiveStock);

                restockItems.push({
                    productId: prod.id,
                    variantId: v.id,
                    sku,
                    name: prod.name || v.variant_name || "Jewellery Piece",
                    currentStock: stock,
                    pendingPOQuantity: pendingPO,
                    lowStockThreshold: threshold,
                    suggestedQuantity: suggestedQty,
                    unitCost,
                    vendorId: vendor?.id,
                    vendorName: vendor?.name || "Unassigned Supplier",
                    vendorPhone: vendor?.phone || undefined,
                    image_url: getProductDisplayImage(prod),
                });
            }
        }

        return groupRestockItemsByVendor(restockItems);
    } catch (err) {
        console.error("Failed to load replenishment queue:", err);
        return [];
    }
}
