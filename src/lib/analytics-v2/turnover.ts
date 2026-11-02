/**
 * Inventory turnover engine (Analytics Deep-Insights).
 *
 * FORMULAS (all documented for review):
 *   COGS (window)        = Σ line qty × unit_cost           (snapshot; a
 *                          missing snapshot falls back to current product
 *                          cost in load.ts — costUnknownSharePct flags how
 *                          much of COGS rests on estimates)
 *   Gross margin ₹       = Σ line net revenue − COGS
 *   Stock value (now)    = Σ variant stock_level × unit_cost (landed basis
 *                          from the stock report, purchase fallback)
 *   Stock value (start)  = current − Σ movements(qty × unit_cost) inside
 *                          the window (movement rows carry no cost, so the
 *                          current unit cost prices history — documented
 *                          approximation)
 *   Avg inventory        = (start + current) / 2
 *   Inventory turnover   = COGS / avg inventory          (window rate)
 *   Annualised turnover  = window rate × 365 / window days
 *   Days of inventory    = window days / turnover
 *   GMROI                = gross margin ₹ / avg inventory cost ₹
 *   Weeks of cover       = stock units / avg weekly units sold
 *   Sell-through %       = units sold / (start units + receipts units)
 *   Aging                = days since the variant's last 'sale' movement,
 *                          bucketed 0-30 / 31-60 / 61-90 / 91-180 / 180+ /
 *                          never-sold, ₹ locked per bucket
 *
 * Zero-division convention: turnover/GMROI are null (not 0) when average
 * inventory is 0 — "undefined" ≠ "zero", and the UI must render them as —.
 */

import { pb } from '../pocketbase';
import { tenantEmail, loadUnifiedLines, type AnalyticsDb } from './load';
import { resolveRange, type AnalyticsRange } from './range';
import { getStockReport } from '../reports';
import type { StockMovement } from '@/types/database';

/** Server routes pass their session client + resolved tenant email. */
export interface TurnoverOpts {
    db?: AnalyticsDb;
    tenant?: string;
}

export interface StockReportRowWithVariant {
    productId: string;
    productName: string;
    sku: string;
    category: string; // relation id
    currentStock: number;
    reorderLevel: number;
    unitCost: number;
    stockValue: number;
}

export interface TurnoverSuite {
    stockValueCurrent: number;
    stockValueStart: number;
    avgInventoryValue: number;
    cogs: number;
    grossMargin: number;
    marginPct: number | null;
    turnoverRate: number | null;
    annualizedTurnover: number | null;
    daysOfInventory: number | null;
    gmroi: number | null;
    /** share of sold lines whose unit_cost was unknown (0-cost fallback) */
    costUnknownSharePct: number;
    lengthDays: number;
}

export interface CategoryTurnoverRow {
    categoryId: string;
    categoryName: string;
    revenue: number;
    cogs: number;
    margin: number;
    marginPct: number | null;
    unitsSold: number;
    avgStockValue: number;
    turnover: number | null;
    gmroi: number | null;
    weeksCover: number | null;
    [key: string]: string | number | null;
}

export type Velocity = 'fast' | 'medium' | 'slow' | 'dead';

export interface ProductTurnoverRow {
    productId: string;
    productName: string;
    sku: string;
    categoryName: string;
    unitsSold: number;
    revenue: number;
    cogs: number;
    margin: number;
    marginPct: number | null;
    currentStock: number;
    stockValue: number;
    turnover: number | null;
    gmroi: number | null;
    weeksCover: number | null;
    sellThroughPct: number | null;
    lastSaleDaysAgo: number | null;
    velocity: Velocity;
    [key: string]: string | number | null;
}

export interface AgingBucket {
    label: string;
    products: number;
    stockValue: number;
    [key: string]: string | number;
}

export interface OverstockRow {
    productId: string;
    productName: string;
    sku: string;
    currentStock: number;
    weeklyVelocity: number;
    weeksCover: number;
    stockValue: number;
    lastSaleDaysAgo: number | null;
    /** DataTable renders arbitrary columns by key, so the row stays indexable. */
    [key: string]: unknown;
}

export interface QuadrantPoint {
    productId: string;
    name: string;
    weeksCover: number;
    marginPct: number;
    stockValue: number;
    velocity: Velocity;
    [key: string]: string | number;
}

export interface TurnoverAnalytics {
    suite: TurnoverSuite;
    byCategory: CategoryTurnoverRow[];
    byProduct: ProductTurnoverRow[];
    aging: AgingBucket[];
    overstock: OverstockRow[];
    zeroStockFastMovers: OverstockRow[];
    quadrants: QuadrantPoint[];
    receiptsUnits: number;
}

function safeDiv(n: number, d: number): number | null {
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
}

/** All stock movements inside the window (tenant-scoped, explicit filter). */
async function loadWindowMovements(db: AnalyticsDb, tenant: string, startISO: string, endISO: string): Promise<StockMovement[]> {
    try {
        return await db.collection('stock_movements').getFullList({
            filter: `account_email="${tenant}" && created>="${startISO}" && created<"${endISO}"`,
        }) as unknown as StockMovement[];
    } catch (e) {
        console.error('[turnover] movement window fetch failed:', e);
        return [];
    }
}

/**
 * Days since each variant's last 'sale' movement, across the whole ledger.
 * Reversal rows ([reversal-of:…] notes) are excluded so a cancelled sale
 * doesn't refresh freshness. `fields` keeps the payload small.
 */
async function loadLastSaleDays(db: AnalyticsDb, tenant: string, now: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
        const rows = await db.collection('stock_movements').getFullList({
            filter: `account_email="${tenant}" && movement_type="sale"`,
            fields: 'id,variant,created,notes',
            sort: '-created',
        });
        for (const row of rows) {
            const variantId = String((row as Record<string, unknown>).variant || '');
            const notes = String((row as Record<string, unknown>).notes || '');
            if (!variantId || out.has(variantId)) continue;
            if (notes.includes('[reversal-of:')) continue;
            const created = new Date(String((row as Record<string, unknown>).created || ''));
            if (Number.isNaN(created.getTime())) continue;
            out.set(variantId, Math.floor((now.getTime() - created.getTime()) / 86_400_000));
        }
    } catch (e) {
        console.error('[turnover] last-sale fetch failed:', e);
    }
    return out;
}

const AGING_BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
    { label: '0-30 days', min: 0, max: 30 },
    { label: '31-60 days', min: 31, max: 60 },
    { label: '61-90 days', min: 61, max: 90 },
    { label: '91-180 days', min: 91, max: 180 },
    { label: '180+ days', min: 181, max: null },
    { label: 'Never sold', min: -1, max: -1 },
];

function bucketFor(days: number | null): string {
    if (days === null) return 'Never sold';
    for (const b of AGING_BUCKETS) {
        if (b.min === -1) continue;
        if (days >= b.min && (b.max === null || days <= b.max)) return b.label;
    }
    return '180+ days';
}

function velocityFor(weeklyUnits: number, unitsSold: number): Velocity {
    if (unitsSold <= 0) return 'dead';
    if (weeklyUnits >= 1) return 'fast';
    if (weeklyUnits >= 0.2) return 'medium';
    return 'slow';
}

export async function getTurnoverAnalytics(range: AnalyticsRange, opts: TurnoverOpts = {}): Promise<TurnoverAnalytics> {
    const db = (opts.db || pb) as unknown as AnalyticsDb;
    const tenant = opts.tenant || tenantEmail();
    const emptySuite: TurnoverSuite = {
        stockValueCurrent: 0, stockValueStart: 0, avgInventoryValue: 0,
        cogs: 0, grossMargin: 0, marginPct: null,
        turnoverRate: null, annualizedTurnover: null, daysOfInventory: null, gmroi: null,
        costUnknownSharePct: 0, lengthDays: 0,
    };
    if (!tenant) {
        return { suite: emptySuite, byCategory: [], byProduct: [], aging: [], overstock: [], zeroStockFastMovers: [], quadrants: [], receiptsUnits: 0 };
    }

    const win = resolveRange(range);
    const now = new Date();

    const [lines, stockReport, movements, categoryMeta, lastSaleDays] = await Promise.all([
        loadUnifiedLines(tenant, win.current, db),
        getStockReport(db as unknown as typeof pb, tenant).catch(() => ({ rows: [], summary: { totalProducts: 0, lowStock: 0, totalValue: 0, landedCount: 0 } })),
        loadWindowMovements(db, tenant, win.current.startISO, win.current.endISO),
        (async () => {
            const meta = new Map<string, string>();
            try {
                const cats = await db.collection('categories').getFullList({});
                for (const c of cats as Array<Record<string, unknown>>) meta.set(String(c.id), String(c.name || 'Unclassified'));
            } catch { /* categories unavailable → Unclassified */ }
            return meta;
        })(),
        loadLastSaleDays(db, tenant, now),
    ]);

    // Variant-level stock rows (the stock report is per-variant but exposes no
    // variant id today — see reports.ts fix in this build; fall back to a
    // fresh minimal query keyed by id when unavailable).
    type StockRow = { variantId: string; productId: string; productName: string; sku: string; categoryId: string; stock: number; unitCost: number; stockValue: number };
    let stockRows: StockRow[] = (stockReport.rows as Array<Record<string, unknown>>).map((r) => ({
        variantId: String(r.variantId || ''),
        productId: String(r.productId || ''),
        productName: String(r.productName || ''),
        sku: String(r.sku || ''),
        categoryId: String(r.category || ''),
        stock: Number(r.currentStock || 0),
        unitCost: Number(r.unitCost || 0),
        stockValue: Number(r.stockValue || 0),
    }));

    const catNameById = categoryMeta;

    // ---- overall suite ----
    const stockValueCurrent = stockRows.reduce((s, r) => s + r.stockValue, 0);
    const currentUnitsByVariant = new Map(stockRows.map((r) => [r.variantId, r]));
    const unitCostByVariant = new Map(stockRows.map((r) => [r.variantId, r.unitCost]));

    let movementValueInWindow = 0;
    let receiptsUnits = 0;
    const netUnitsByVariant = new Map<string, number>();
    const receiptsByProduct = new Map<string, number>();
    for (const m of movements) {
        const qty = Number(m.quantity || 0);
        const variantId = String(m.variant || '');
        const row = currentUnitsByVariant.get(variantId);
        const unitCost = unitCostByVariant.get(variantId) ?? row?.unitCost ?? 0;
        movementValueInWindow += qty * unitCost;
        netUnitsByVariant.set(variantId, (netUnitsByVariant.get(variantId) || 0) + qty);
        if (qty > 0) {
            receiptsUnits += qty;
            const productId = row?.productId || '';
            if (productId) receiptsByProduct.set(productId, (receiptsByProduct.get(productId) || 0) + qty);
        }
    }

    const stockValueStart = stockValueCurrent - movementValueInWindow;
    const avgInventoryValue = (stockValueStart + stockValueCurrent) / 2;

    const cogs = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const revenue = lines.reduce((s, l) => s + l.netRevenue, 0);
    const grossMargin = revenue - cogs;
    const soldUnits = lines.reduce((s, l) => s + l.quantity, 0);
    const unknownCostLines = lines.filter((l) => l.unitCost === 0);
    const costUnknownSharePct = lines.length > 0
        ? Math.round((unknownCostLines.reduce((s, l) => s + l.quantity, 0) / Math.max(soldUnits, 1)) * 1000) / 10
        : 0;

    const windowTurnover = safeDiv(cogs, avgInventoryValue);
    const annualized = windowTurnover !== null ? windowTurnover * (365 / win.lengthDays) : null;
    const gmroi = safeDiv(grossMargin, avgInventoryValue);

    const suite: TurnoverSuite = {
        stockValueCurrent: Math.round(stockValueCurrent),
        stockValueStart: Math.round(stockValueStart),
        avgInventoryValue: Math.round(avgInventoryValue),
        cogs: Math.round(cogs),
        grossMargin: Math.round(grossMargin),
        marginPct: revenue > 0 ? Math.round((grossMargin / revenue) * 1000) / 10 : null,
        turnoverRate: windowTurnover !== null ? Math.round(windowTurnover * 100) / 100 : null,
        annualizedTurnover: annualized !== null ? Math.round(annualized * 100) / 100 : null,
        daysOfInventory: windowTurnover !== null && windowTurnover > 0 ? Math.round(win.lengthDays / windowTurnover) : null,
        gmroi: gmroi !== null ? Math.round(gmroi * 100) / 100 : null,
        costUnknownSharePct,
        lengthDays: win.lengthDays,
    };

    // ---- product-level aggregation ----
    interface ProductAgg { units: number; revenue: number; cogs: number; }
    const byProduct = new Map<string, ProductAgg>();
    for (const l of lines) {
        if (!l.productId) continue;
        const a = byProduct.get(l.productId) || { units: 0, revenue: 0, cogs: 0 };
        a.units += l.quantity;
        a.revenue += l.netRevenue;
        a.cogs += l.quantity * l.unitCost;
        byProduct.set(l.productId, a);
    }

    // stock per product (variants summed)
    interface ProductStock { name: string; sku: string; categoryId: string; stock: number; stockValue: number; startUnits: number; receipts: number; bestLastSale: number | null; }
    const stockByProduct = new Map<string, ProductStock>();
    for (const r of stockRows) {
        const s = stockByProduct.get(r.productId) || {
            name: r.productName, sku: r.sku, categoryId: r.categoryId, stock: 0, stockValue: 0, startUnits: 0, receipts: 0, bestLastSale: null as number | null,
        };
        s.stock += r.stock;
        s.stockValue += r.stockValue;
        const net = netUnitsByVariant.get(r.variantId) || 0;
        s.startUnits += r.stock - net;
        const rc = receiptsByProduct.get(r.productId) || 0;
        s.receipts = rc;
        const age = lastSaleDays.get(r.variantId);
        if (age !== undefined && (s.bestLastSale === null || age < s.bestLastSale)) s.bestLastSale = age;
        stockByProduct.set(r.productId, s);
    }

    const weeks = win.lengthDays / 7;

    const productRows: ProductTurnoverRow[] = [];
    const productIds = new Set([...byProduct.keys(), ...stockByProduct.keys()]);
    for (const productId of productIds) {
        const agg = byProduct.get(productId) || { units: 0, revenue: 0, cogs: 0 };
        const stock = stockByProduct.get(productId) || {
            name: 'Unknown', sku: '', categoryId: '', stock: 0, stockValue: 0, startUnits: 0, receipts: 0, bestLastSale: null,
        };
        const margin = agg.revenue - agg.cogs;
        const weeklyUnits = agg.units / weeks;
        const avgUnits = (stock.startUnits + stock.stock) / 2;
        const turnover = safeDiv(agg.cogs, avgUnits > 0 ? avgUnits * (stock.stockValue / Math.max(stock.stock, 1)) : 0);
        const gmroi = stock.stockValue > 0 ? margin / ((stock.stockValue + (stock.stockValue * stock.startUnits) / Math.max(stock.stock, 1)) / 2) : null;
        const startPlusReceipts = stock.startUnits + stock.receipts;
        const sellThrough = startPlusReceipts > 0 ? (agg.units / startPlusReceipts) * 100 : null;

        productRows.push({
            productId,
            productName: stock.name,
            sku: stock.sku,
            categoryName: catNameById.get(stock.categoryId) || 'Unclassified',
            unitsSold: agg.units,
            revenue: Math.round(agg.revenue),
            cogs: Math.round(agg.cogs),
            margin: Math.round(margin),
            marginPct: agg.revenue > 0 ? Math.round((margin / agg.revenue) * 1000) / 10 : null,
            currentStock: stock.stock,
            stockValue: Math.round(stock.stockValue),
            turnover: turnover !== null ? Math.round(turnover * 100) / 100 : null,
            gmroi: gmroi !== null ? Math.round(gmroi * 100) / 100 : null,
            weeksCover: weeklyUnits > 0 ? Math.round((stock.stock / weeklyUnits) * 10) / 10 : null,
            sellThroughPct: sellThrough !== null ? Math.round(sellThrough * 10) / 10 : null,
            lastSaleDaysAgo: stock.bestLastSale,
            velocity: velocityFor(weeklyUnits, agg.units),
        });
    }
    productRows.sort((a, b) => b.revenue - a.revenue);

    // ---- category-level aggregation ----
    interface CatAgg { revenue: number; cogs: number; units: number; stockValue: number; startStockValue: number; stock: number; startUnits: number; }
    const byCat = new Map<string, CatAgg>();
    const ensureCat = (id: string) => {
        let a = byCat.get(id);
        if (!a) {
            a = { revenue: 0, cogs: 0, units: 0, stockValue: 0, startStockValue: 0, stock: 0, startUnits: 0 };
            byCat.set(id, a);
        }
        return a;
    };

    for (const l of lines) {
        const a = ensureCat(l.categoryId || '');
        a.revenue += l.netRevenue;
        a.cogs += l.quantity * l.unitCost;
        a.units += l.quantity;
    }
    for (const [, s] of stockByProduct) {
        const a = ensureCat(s.categoryId || '');
        a.stockValue += s.stockValue;
        a.stock += s.stock;
        a.startUnits += s.startUnits;
    }
    // start stock value per category: current − movement value of its variants
    const catMovementValue = new Map<string, number>();
    for (const r of stockRows) {
        const net = netUnitsByVariant.get(r.variantId) || 0;
        if (net === 0) continue;
        const catId = stockByProduct.get(r.productId)?.categoryId || '';
        catMovementValue.set(catId, (catMovementValue.get(catId) || 0) + net * r.unitCost);
    }
    for (const [catId, mv] of catMovementValue) {
        const a = byCat.get(catId);
        if (a) a.startStockValue = a.stockValue - mv;
    }

    const catRows: CategoryTurnoverRow[] = [];
    for (const [categoryId, a] of byCat) {
        const margin = a.revenue - a.cogs;
        const avg = (a.startStockValue + a.stockValue) / 2;
        const turnover = safeDiv(a.cogs, avg);
        const weeklyUnits = a.units / weeks;
        catRows.push({
            categoryId,
            categoryName: catNameById.get(categoryId) || 'Unclassified',
            revenue: Math.round(a.revenue),
            cogs: Math.round(a.cogs),
            margin: Math.round(margin),
            marginPct: a.revenue > 0 ? Math.round((margin / a.revenue) * 1000) / 10 : null,
            unitsSold: a.units,
            avgStockValue: Math.round(avg),
            turnover: turnover !== null ? Math.round(turnover * 100) / 100 : null,
            gmroi: safeDiv(margin, avg) !== null ? Math.round((safeDiv(margin, avg) as number) * 100) / 100 : null,
            weeksCover: weeklyUnits > 0 && a.stock > 0 ? Math.round((a.stock / weeklyUnits) * 10) / 10 : null,
        });
    }
    catRows.sort((a, b) => (b.revenue as number) - (a.revenue as number));

    // ---- aging buckets (stocked variants only, ₹ locked per bucket) ----
    const buckets = new Map<string, { products: number; stockValue: number }>();
    for (const r of stockRows) {
        if (r.stock <= 0) continue;
        const age = lastSaleDays.get(r.variantId) ?? null;
        const label = bucketFor(age);
        const b = buckets.get(label) || { products: 0, stockValue: 0 };
        b.products += 1;
        b.stockValue += r.stockValue;
        buckets.set(label, b);
    }
    const aging: AgingBucket[] = AGING_BUCKETS.map((b) => {
        const v = buckets.get(b.label) || { products: 0, stockValue: 0 };
        return { label: b.label, products: v.products, stockValue: Math.round(v.stockValue) };
    });

    // ---- overstock (cover > 12 weeks) and zero-stock fast movers ----
    const overstock: OverstockRow[] = [];
    const zeroStockFastMovers: OverstockRow[] = [];
    for (const p of productRows) {
        if (p.currentStock > 0 && p.weeksCover !== null && p.weeksCover > 12) {
            overstock.push({
                productId: p.productId,
                productName: p.productName,
                sku: p.sku,
                currentStock: p.currentStock,
                weeklyVelocity: Math.round((p.unitsSold / weeks) * 100) / 100,
                weeksCover: p.weeksCover,
                stockValue: p.stockValue,
                lastSaleDaysAgo: p.lastSaleDaysAgo,
            });
        }
        if (p.currentStock <= 0 && (p.velocity === 'fast' || p.velocity === 'medium')) {
            zeroStockFastMovers.push({
                productId: p.productId,
                productName: p.productName,
                sku: p.sku,
                currentStock: 0,
                weeklyVelocity: Math.round((p.unitsSold / weeks) * 100) / 100,
                weeksCover: 0,
                stockValue: 0,
                lastSaleDaysAgo: p.lastSaleDaysAgo,
            });
        }
    }
    overstock.sort((a, b) => b.stockValue - a.stockValue);
    zeroStockFastMovers.sort((a, b) => b.weeklyVelocity - a.weeklyVelocity);

    // ---- fast-vs-slow quadrant scatter (x = weeks cover, y = margin %) ----
    const quadrants: QuadrantPoint[] = productRows
        .filter((p) => p.unitsSold > 0 && p.stockValue > 0 && p.weeksCover !== null && p.marginPct !== null)
        .map((p) => ({
            productId: p.productId,
            name: p.productName,
            weeksCover: p.weeksCover as number,
            marginPct: p.marginPct as number,
            stockValue: p.stockValue,
            velocity: p.velocity,
        }));

    return { suite, byCategory: catRows, byProduct: productRows, aging, overstock, zeroStockFastMovers, quadrants, receiptsUnits };
}
