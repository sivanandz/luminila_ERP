/**
 * Profitability engine (Analytics Deep-Insights).
 *
 * Margin conventions:
 *   - Line margin = net revenue (qty × price − line discount) − qty × unit_cost
 *   - ORDER-LEVEL discounts (sales_orders.discount_total, POS bill discount)
 *     are allocated pro-rata across the transaction's lines by net revenue so
 *     per-product margins stay honest. Lines of transactions with unknown
 *     order discounts are left untouched.
 *   - COGS rests on unit_cost snapshots; where the snapshot is missing,
 *     load.ts substituted the current product cost — marginUnknownCostUnits
 *     reports how many units that affects so no one mistakes an estimate for
 *     a measurement.
 *   - Margin excludes taxes and shipping (documented simplification).
 *
 * Expenses overlay reuses getExpenseStats (src/lib/expenses.ts) for the same
 * window so operating expenses can be shown next to gross margin.
 */

import { tenantEmail, loadUnifiedLines, loadTxWindow, type UnifiedLine } from './load';
import { resolveRange, compare, type AnalyticsRange, type ComparedMetric } from './range';
import { adjustedLineRevenues } from './discount-allocation';
import { getExpenseStats } from '../expenses';

export interface MarginRow {
    key: string;
    label: string;
    revenue: number;
    cogs: number;
    margin: number;
    marginPct: number | null;
    units: number;
    [key: string]: string | number | null;
}

export interface MarginPoint {
    period: string;
    label: string;
    revenue: number;
    margin: number;
    marginPct: number | null;
    previousMargin: number | null;
    [key: string]: string | number | null;
}

export interface DiscountErosion {
    grossRevenue: number;
    totalDiscounts: number;
    erosionPct: number;
    previousErosionPct: number;
    deltaPct: number;
}

export interface ExpensesOverlay {
    total: number;
    byCategory: Array<{ category: string; amount: number }>;
    /** gross margin − expenses (a negative number is a real warning) */
    operatingResult: number;
}

export interface ProfitabilityAnalytics {
    overallMargin: ComparedMetric;
    marginPct: number | null;
    previousMarginPct: number | null;
    trend: MarginPoint[];
    byCategory: MarginRow[];
    byChannel: MarginRow[];
    topByProfit: MarginRow[];
    topByRevenue: MarginRow[];
    discountErosion: DiscountErosion;
    expenses: ExpensesOverlay;
    marginUnknownCostUnits: number;
    /** units whose cost was estimated from the product's CURRENT cost (no sale-time snapshot) — audit AN-12 */
    costEstimatedUnits: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function aggregate(
    lines: UnifiedLine[],
    adjustedRevenue: Map<UnifiedLine, number>,
    keyOf: (l: UnifiedLine) => string,
    labelOf: (l: UnifiedLine) => string
): MarginRow[] {
    const agg = new Map<string, { label: string; revenue: number; cogs: number; units: number }>();
    for (const l of lines) {
        const key = keyOf(l);
        const a = agg.get(key) || { label: labelOf(l), revenue: 0, cogs: 0, units: 0 };
        a.revenue += adjustedRevenue.get(l) ?? l.netRevenue;
        a.cogs += l.quantity * l.unitCost;
        a.units += l.quantity;
        agg.set(key, a);
    }
    return [...agg.entries()]
        .map(([key, a]) => {
            const margin = a.revenue - a.cogs;
            return {
                key,
                label: a.label,
                revenue: Math.round(a.revenue),
                cogs: Math.round(a.cogs),
                margin: Math.round(margin),
                marginPct: a.revenue > 0 ? Math.round((margin / a.revenue) * 1000) / 10 : null,
                units: a.units,
            };
        })
        .sort((a, b) => b.margin - a.margin);
}

export async function getProfitabilityAnalytics(range: AnalyticsRange): Promise<ProfitabilityAnalytics> {
    const tenant = tenantEmail();
    const zero: ComparedMetric = { current: 0, previous: 0, deltaPct: 0 };
    const empty: ProfitabilityAnalytics = {
        overallMargin: zero, marginPct: null, previousMarginPct: null,
        trend: [], byCategory: [], byChannel: [], topByProfit: [], topByRevenue: [],
        discountErosion: { grossRevenue: 0, totalDiscounts: 0, erosionPct: 0, previousErosionPct: 0, deltaPct: 0 },
        expenses: { total: 0, byCategory: [], operatingResult: 0 },
        marginUnknownCostUnits: 0,
        costEstimatedUnits: 0,
    };
    if (!tenant) return empty;

    const win = resolveRange(range);
    // Previous-window transactions are loaded too so the same discount
    // allocation applies there — otherwise previousMarginPct / trend overlay /
    // erosion deltas stay on raw revenue while current is adjusted (AN-04).
    const [lines, txs, prevLines, prevTxs] = await Promise.all([
        loadUnifiedLines(tenant, win.current),
        loadTxWindow(tenant, win.current),
        loadUnifiedLines(tenant, win.previous),
        loadTxWindow(tenant, win.previous),
    ]);

    const adjusted = adjustedLineRevenues(lines, txs);
    const adjustedPrev = adjustedLineRevenues(prevLines, prevTxs);

    const revenue = lines.reduce((s, l) => s + (adjusted.get(l) ?? l.netRevenue), 0);
    const cogs = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const margin = revenue - cogs;

    const prevRevenue = prevLines.reduce((s, l) => s + (adjustedPrev.get(l) ?? l.netRevenue), 0);
    const prevCogs = prevLines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const prevMargin = prevRevenue - prevCogs;

    const marginUnknownCostUnits = lines.filter((l) => l.unitCost === 0).reduce((s, l) => s + l.quantity, 0);
    const costEstimatedUnits = lines.filter((l) => l.costFallback).reduce((s, l) => s + l.quantity, 0);

    // ---- monthly margin trend with previous overlay (aligned by index) ----
    const monthly = new Map<string, { revenue: number; margin: number }>();
    for (const l of lines) {
        const m = l.day.slice(0, 7);
        const a = monthly.get(m) || { revenue: 0, margin: 0 };
        a.revenue += adjusted.get(l) ?? l.netRevenue;
        a.margin += (adjusted.get(l) ?? l.netRevenue) - l.quantity * l.unitCost;
        monthly.set(m, a);
    }
    const prevMonthly = new Map<string, number>();
    for (const l of prevLines) {
        const m = l.day.slice(0, 7);
        prevMonthly.set(m, (prevMonthly.get(m) || 0) + ((adjustedPrev.get(l) ?? l.netRevenue) - l.quantity * l.unitCost));
    }
    // Align previous months onto the current axis by order.
    const currentMonths = [...monthly.keys()].sort();
    const prevMonths = [...prevMonthly.keys()].sort();
    const prevAligned = new Map<string, number>();
    prevMonths.forEach((m, i) => {
        if (i < currentMonths.length) prevAligned.set(currentMonths[i], prevMonthly.get(m)!);
    });

    const trend: MarginPoint[] = currentMonths.map((m) => {
        const a = monthly.get(m)!;
        const prev = prevAligned.get(m);
        return {
            period: m,
            label: `${MONTH_LABELS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`,
            revenue: Math.round(a.revenue),
            margin: Math.round(a.margin),
            marginPct: a.revenue > 0 ? Math.round((a.margin / a.revenue) * 1000) / 10 : null,
            previousMargin: prev !== undefined ? Math.round(prev) : null,
        };
    });

    const byCategory = aggregate(lines, adjusted, (l) => l.categoryId || 'uncategorized', (l) => l.categoryName);
    // Channel label needs the tx — aggregate by the tx's channel label.
    const channelByTx = new Map(txs.map((t) => [t.id, t.channel]));
    const byChannel = aggregate(lines, adjusted, (l) => channelByTx.get(l.txId) || 'Other', (l) => channelByTx.get(l.txId) || 'Other');

    const byProductAll = aggregate(lines, adjusted, (l) => l.productId || 'unknown', (l) => l.productName);
    const topByProfit = [...byProductAll].sort((a, b) => b.margin - a.margin).slice(0, 10);
    const topByRevenue = [...byProductAll].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    // ---- discount erosion (share of gross given away) ----
    const grossCurrent = lines.reduce((s, l) => s + l.gross, 0);
    const discountsCurrent = grossCurrent - lines.reduce((s, l) => s + (adjusted.get(l) ?? l.netRevenue), 0);
    const grossPrev = prevLines.reduce((s, l) => s + l.gross, 0);
    const discountsPrev = grossPrev - prevLines.reduce((s, l) => s + (adjustedPrev.get(l) ?? l.netRevenue), 0);
    const erosionPct = grossCurrent > 0 ? Math.round((discountsCurrent / grossCurrent) * 1000) / 10 : 0;
    const prevErosionPct = grossPrev > 0 ? Math.round((discountsPrev / grossPrev) * 1000) / 10 : 0;

    // ---- expenses overlay (same window) ----
    let expenses: ExpensesOverlay = { total: 0, byCategory: [], operatingResult: margin };
    try {
        const stats = await getExpenseStats(win.current.startISO, win.current.endISO);
        const total = Number(stats?.totalAmount || 0);
        const byCategory = (Array.isArray(stats?.byCategory) ? stats.byCategory : [])
            .map((c: { name?: string; amount?: number }) => ({ category: String(c.name || 'Uncategorized'), amount: Number(c.amount || 0) }))
            .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount);
        expenses = { total, byCategory, operatingResult: Math.round(margin - total) };
    } catch (e) {
        console.warn('[profitability] expense overlay unavailable:', e);
    }

    return {
        overallMargin: compare(Math.round(margin), Math.round(prevMargin)),
        marginPct: revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null,
        previousMarginPct: prevRevenue > 0 ? Math.round((prevMargin / prevRevenue) * 1000) / 10 : null,
        trend,
        byCategory,
        byChannel,
        topByProfit,
        topByRevenue,
        discountErosion: {
            grossRevenue: Math.round(grossCurrent),
            totalDiscounts: Math.round(discountsCurrent),
            erosionPct,
            previousErosionPct: prevErosionPct,
            deltaPct: Math.round((erosionPct - prevErosionPct) * 10) / 10,
        },
        expenses,
        marginUnknownCostUnits,
        costEstimatedUnits,
    };
}
