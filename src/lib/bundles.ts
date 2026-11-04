/**
 * Virtual Combo & Bridal Set Bundles Service (Phase 5).
 *
 * Allows merchants to sell bridal sets, gift combos, and multi-piece sets
 * backed by individual component variants in stock.
 *
 * Key behaviors:
 * 1. Bundle availability is calculated dynamically:
 *    available = min(floor(component.stock / component.required_qty))
 * 2. Sales deduct component variants directly via channel-stock.ts.
 * 3. Packing Station 2.0 explodes bundle lines into individual scannable lines
 *    so packers verify every single item in the set.
 */

import { pb, accountScopeEmail, sanitizeFilter } from "./pocketbase";

export interface BundleComponent {
    variant_id: string;
    product_id: string;
    sku: string;
    name: string;
    quantity: number; // units of this component required per 1 bundle
}

export interface BundleProduct {
    id: string;
    sku: string;
    name: string;
    price: number;
    is_bundle: boolean;
    bundle_items: BundleComponent[];
    computed_stock: number;
}

// ===========================================
// PURE LOGIC (IO-FREE)
// ===========================================

/**
 * Calculates the maximum complete bundles that can be assembled
 * from currently available component variant stocks.
 */
export function computeBundleAvailability(
    bundleItems: BundleComponent[],
    componentStockMap: Map<string, number>
): number {
    if (!bundleItems || bundleItems.length === 0) return 0;

    let maxBundles = Infinity;

    for (const comp of bundleItems) {
        const required = Math.max(1, Number(comp.quantity) || 1);
        const available = Math.max(0, componentStockMap.get(comp.variant_id) ?? 0);
        const possible = Math.floor(available / required);
        if (possible < maxBundles) {
            maxBundles = possible;
        }
    }

    return Number.isFinite(maxBundles) ? Math.max(0, maxBundles) : 0;
}

/**
 * Explode a bundle sale or packing line into individual component lines.
 */
export function explodeBundle(
    bundleSku: string,
    bundleQty: number,
    bundleItems: BundleComponent[]
): Array<{ variant_id: string; product_id: string; sku: string; name: string; quantity: number }> {
    return (bundleItems || []).map((comp) => ({
        variant_id: comp.variant_id,
        product_id: comp.product_id,
        sku: comp.sku,
        name: comp.name || `Component of ${bundleSku}`,
        quantity: Math.max(1, Number(comp.quantity) || 1) * bundleQty,
    }));
}
