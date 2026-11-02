/**
 * Unit-cost resolution at sale time (Analytics Deep-Insights, 2026-11-02).
 *
 * Every sale item must snapshot the cost it was actually carried at, otherwise
 * COGS/margin/GMROI silently revalue history whenever products.cost_price
 * changes. Resolution order per variant:
 *
 *   1. weighted-average LANDED unit cost from received purchase receipts
 *      (same basis as the stock report: allocate PO overhead = shipping −
 *      discount across the PO's lines by value, then average by quantity)
 *   2. products.cost_price (current bare purchase cost)
 *   3. unknown → unit_cost 0 with basis 'unknown' (analytics must surface
 *      this as "cost basis missing", never silently as zero-margin)
 *
 * Unlike reports.ts buildLandedCostMap() this resolves ONLY the variants a
 * transaction touches (two small queries), so it is cheap enough to call per
 * sale. Works with both the client PB client and a server tenant client.
 */

import { allocateLandedCosts, weightedAverageCost } from './valuation';

export type CostBasis = 'landed' | 'purchase' | 'unknown';

export interface ResolvedUnitCost {
    unitCost: number;
    basis: CostBasis;
}

export interface CostRef {
    variantId?: string | null;
    productId?: string | null;
}

/** Minimal shape of a PB-like client (works for pb and tenant clients). */
type Db = {
    collection: (name: string) => {
        getFullList: (opts: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
    };
};

const CHUNK = 20;

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/**
 * Resolve unit costs for the given refs.
 * Map key = variantId when present, else productId.
 */
export async function resolveUnitCosts(
    db: Db,
    tenantEmail: string,
    refs: CostRef[]
): Promise<Map<string, ResolvedUnitCost>> {
    const result = new Map<string, ResolvedUnitCost>();
    if (!tenantEmail || refs.length === 0) return result;

    const variantIds = [...new Set(refs.map((r) => r.variantId).filter((v): v is string => Boolean(v)))];
    const productIds = [...new Set(refs.map((r) => r.productId).filter((p): p is string => Boolean(p)))];

    // ---- products: current purchase cost fallback (explicit tenant scope) ----
    const productCost = new Map<string, number>();
    try {
        const products = await db.collection('products').getFullList({
            filter: `account_email="${tenantEmail}"`,
        });
        for (const p of products) {
            const cost = Number(p.cost_price || 0);
            if (cost > 0) productCost.set(String(p.id), cost);
        }
    } catch (e) {
        console.warn('[item-cost] product cost lookup failed:', e);
    }

    // ---- landed receipts for the involved variants only ----
    const receiptsByVariant = new Map<string, Array<{ quantity: number; landedUnitCost: number }>>();
    try {
        // Which POs received these variants? (chunked filter to stay under URL limits)
        const poItemRows: Array<Record<string, any>> = [];
        for (const ids of chunk(variantIds, CHUNK)) {
            if (ids.length === 0) continue;
            const filter = `account_email="${tenantEmail}" && (${ids.map((id) => `variant="${id}"`).join(' || ')})`;
            const rows = await db.collection('purchase_order_items').getFullList({ filter }).catch(() => []);
            poItemRows.push(...rows);
        }

        const poIds = [...new Set(poItemRows.map((r) => String(r.purchase_order || '')))].filter(Boolean);
        const receivedPos: Array<Record<string, any>> = [];
        for (const ids of chunk(poIds, CHUNK)) {
            if (ids.length === 0) continue;
            const filter = `account_email="${tenantEmail}" && (status="received" || status="partial") && (${ids
                .map((id) => `id="${id}"`)
                .join(' || ')})`;
            const rows = await db.collection('purchase_orders').getFullList({ filter }).catch(() => []);
            receivedPos.push(...rows);
        }
        const receivedById = new Map(receivedPos.map((po) => [String(po.id), po]));
        if (receivedById.size > 0) {
            // All lines of each received PO — overhead allocation must see the
            // whole PO, not just our variants, or it over-charges them.
            const allLinesByPo = new Map<string, Array<Record<string, any>>>();
            for (const ids of chunk([...receivedById.keys()], CHUNK)) {
                const filter = `account_email="${tenantEmail}" && (${ids.map((id) => `purchase_order="${id}"`).join(' || ')})`;
                const rows = await db.collection('purchase_order_items').getFullList({ filter }).catch(() => []);
                for (const row of rows) {
                    const poId = String(row.purchase_order || '');
                    const list = allLinesByPo.get(poId) || [];
                    list.push(row);
                    allLinesByPo.set(poId, list);
                }
            }

            for (const po of receivedById.values()) {
                const lines = (allLinesByPo.get(String(po.id)) || [])
                    .filter((item) => item.variant && Number(item.quantity_received || item.quantity_ordered || 0) > 0)
                    .map((item) => ({
                        key: String(item.variant),
                        quantity: Number(item.quantity_received || item.quantity_ordered || 0),
                        unitCost: Number(item.unit_price || 0),
                    }));
                if (lines.length === 0) continue;

                const overhead = Number(po.shipping_cost || 0) - Number(po.discount_amount || 0);
                for (const line of allocateLandedCosts(lines, overhead)) {
                    const receipts = receiptsByVariant.get(line.key) || [];
                    receipts.push({ quantity: line.quantity, landedUnitCost: line.landedUnitCost });
                    receiptsByVariant.set(line.key, receipts);
                }
            }
        }
    } catch (e) {
        console.warn('[item-cost] landed-cost lookup failed, falling back to purchase cost:', e);
    }

    // ---- resolve ----
    for (const ref of refs) {
        const key = ref.variantId || ref.productId;
        if (!key || result.has(key)) continue;

        const landedReceipts = ref.variantId ? receiptsByVariant.get(ref.variantId) : undefined;
        if (landedReceipts && landedReceipts.length > 0) {
            const avg = weightedAverageCost(landedReceipts);
            if (avg > 0) {
                result.set(key, { unitCost: avg, basis: 'landed' });
                continue;
            }
        }
        const purchase = ref.productId ? productCost.get(ref.productId) : undefined;
        if (purchase && purchase > 0) {
            result.set(key, { unitCost: purchase, basis: 'purchase' });
        } else {
            result.set(key, { unitCost: 0, basis: 'unknown' });
        }
    }

    return result;
}

/** Convenience: plain unit-cost map (key = variantId || productId). */
export async function resolveUnitCostMap(
    db: Db,
    tenantEmail: string,
    refs: CostRef[]
): Promise<Map<string, number>> {
    const resolved = await resolveUnitCosts(db, tenantEmail, refs);
    const plain = new Map<string, number>();
    resolved.forEach((v, k) => plain.set(k, v.unitCost));
    return plain;
}
