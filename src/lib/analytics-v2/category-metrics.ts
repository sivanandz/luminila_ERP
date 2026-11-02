/**
 * Category deep-dive metrics (Analytics Deep-Insights).
 *
 * All splits derive from the same canonical line set as the other engines:
 *   - price-band performance (units/revenue/margin per ₹ band)
 *   - purity split (22K/18K/silver/imitation… via purity_karat)
 *   - making-charge share (Σ making charges / Σ net revenue — how much of the
 *     ticket is labour, per category and per purity)
 *   - monthly revenue mix by top-level category (mix-shift stacked area)
 *
 * Turnover/GMROI per category live in turnover.ts (single source of truth).
 */

import { tenantEmail, loadUnifiedLines } from './load';
import { resolveRange, type AnalyticsRange } from './range';

export interface PriceBandRow {
    band: string;
    units: number;
    revenue: number;
    margin: number;
    marginPct: number | null;
    [key: string]: string | number | null;
}

export interface PurityRow {
    purity: string;
    units: number;
    revenue: number;
    revenueSharePct: number;
    marginPct: number | null;
    makingChargeSharePct: number;
    [key: string]: string | number | null;
}

export interface MakingChargeRow {
    categoryName: string;
    makingCharges: number;
    revenue: number;
    sharePct: number;
    [key: string]: string | number;
}

export interface MixPoint {
    month: string;
    label: string;
    [categoryName: string]: string | number;
}

export interface CategoryDeepDive {
    priceBands: PriceBandRow[];
    purity: PurityRow[];
    makingCharges: MakingChargeRow[];
    mixShift: MixPoint[];
    topCategories: string[];
}

const PRICE_BANDS: Array<{ label: string; min: number; max: number }> = [
    { label: '< ₹2k', min: 0, max: 2000 },
    { label: '₹2k–10k', min: 2000, max: 10000 },
    { label: '₹10k–50k', min: 10000, max: 50000 },
    { label: '₹50k–2L', min: 50000, max: 200000 },
    { label: '₹2L+', min: 200000, max: Infinity },
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function getCategoryDeepDive(range: AnalyticsRange): Promise<CategoryDeepDive> {
    const tenant = tenantEmail();
    const empty: CategoryDeepDive = { priceBands: [], purity: [], makingCharges: [], mixShift: [], topCategories: [] };
    if (!tenant) return empty;

    const win = resolveRange(range);
    const lines = await loadUnifiedLines(tenant, win.current);
    if (lines.length === 0) return empty;

    // ---- price bands ----
    const bands = PRICE_BANDS.map((b) => ({ ...b, units: 0, revenue: 0, cogs: 0 }));
    for (const l of lines) {
        const price = l.quantity > 0 ? l.gross / l.quantity : 0;
        const band = bands.find((b) => price >= b.min && price < b.max) || bands[bands.length - 1];
        band.units += l.quantity;
        band.revenue += l.netRevenue;
        band.cogs += l.quantity * l.unitCost;
    }
    const priceBands: PriceBandRow[] = bands.map((b) => {
        const margin = b.revenue - b.cogs;
        return {
            band: b.label,
            units: b.units,
            revenue: Math.round(b.revenue),
            margin: Math.round(margin),
            marginPct: b.revenue > 0 ? Math.round((margin / b.revenue) * 1000) / 10 : null,
        };
    });

    // ---- purity split ----
    const purityAgg = new Map<string, { units: number; revenue: number; cogs: number; making: number }>();
    for (const l of lines) {
        const purity = l.purityKarat || 'Unspecified';
        const a = purityAgg.get(purity) || { units: 0, revenue: 0, cogs: 0, making: 0 };
        a.units += l.quantity;
        a.revenue += l.netRevenue;
        a.cogs += l.quantity * l.unitCost;
        a.making += l.makingCharges * l.quantity;
        purityAgg.set(purity, a);
    }
    const totalRevenue = lines.reduce((s, l) => s + l.netRevenue, 0);
    const purity: PurityRow[] = [...purityAgg.entries()]
        .map(([p, a]) => {
            const margin = a.revenue - a.cogs;
            return {
                purity: p,
                units: a.units,
                revenue: Math.round(a.revenue),
                revenueSharePct: totalRevenue > 0 ? Math.round((a.revenue / totalRevenue) * 1000) / 10 : 0,
                marginPct: a.revenue > 0 ? Math.round((margin / a.revenue) * 1000) / 10 : null,
                makingChargeSharePct: a.revenue > 0 ? Math.round((a.making / a.revenue) * 1000) / 10 : 0,
            };
        })
        .sort((a, b) => (b.revenue as number) - (a.revenue as number));

    // ---- making-charge share by category ----
    const catAgg = new Map<string, { making: number; revenue: number }>();
    for (const l of lines) {
        const name = l.parentCategoryName || l.categoryName;
        const a = catAgg.get(name) || { making: 0, revenue: 0 };
        a.making += l.makingCharges * l.quantity;
        a.revenue += l.netRevenue;
        catAgg.set(name, a);
    }
    const makingCharges: MakingChargeRow[] = [...catAgg.entries()]
        .map(([categoryName, a]) => ({
            categoryName,
            makingCharges: Math.round(a.making),
            revenue: Math.round(a.revenue),
            sharePct: a.revenue > 0 ? Math.round((a.making / a.revenue) * 1000) / 10 : 0,
        }))
        .filter((r) => (r.revenue as number) > 0)
        .sort((a, b) => (b.makingCharges as number) - (a.makingCharges as number))
        .slice(0, 10);

    // ---- monthly mix by top-level category ----
    const monthlyCats = new Map<string, Map<string, number>>(); // month → cat → revenue
    const catTotals = new Map<string, number>();
    for (const l of lines) {
        const cat = l.parentCategoryName || l.categoryName;
        const month = l.day.slice(0, 7);
        const m = monthlyCats.get(month) || new Map<string, number>();
        m.set(cat, (m.get(cat) || 0) + l.netRevenue);
        monthlyCats.set(month, m);
        catTotals.set(cat, (catTotals.get(cat) || 0) + l.netRevenue);
    }
    const topCategories = [...catTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([c]) => c);

    const mixShift: MixPoint[] = [...monthlyCats.keys()]
        .sort()
        .map((month) => {
            const m = monthlyCats.get(month)!;
            const point: MixPoint = {
                month,
                label: `${MONTH_LABELS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`,
            };
            for (const cat of topCategories) {
                point[cat] = Math.round(m.get(cat) || 0);
            }
            return point;
        });

    return { priceBands, purity, makingCharges, mixShift, topCategories };
}
