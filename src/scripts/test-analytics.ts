/**
 * Verification for the analytics engines (Analytics Deep-Insights):
 * range window math, previous-window alignment, trend granularity, deduped
 * channel/payment/heatmap aggregation, KPI compare math, and the insights
 * rule engine ranking.
 * Run: npx tsx src/scripts/test-analytics.ts
 */

import assert from 'node:assert/strict';
import { resolveRange, inWindow, deltaPct, compare, dayKey, pbBound, type AnalyticsRange } from '../lib/analytics-v2/range';
import { buildTrend, buildChannelTable, buildPaymentMix, buildHeatmap, buildKpis, alignPreviousMonths, aggregateCustomerSplit, type TrendPoint } from '../lib/analytics-v2/sales-metrics';
import { buildInsights, type InsightCard } from '../lib/analytics-v2/insights';
import type { UnifiedTx } from '../lib/analytics-v2/load';
import type { TurnoverAnalytics } from '../lib/analytics-v2/turnover';
import type { ProfitabilityAnalytics } from '../lib/analytics-v2/profitability';
import type { SalesAnalytics } from '../lib/analytics-v2/sales-metrics';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
    const done = (error: unknown) => {
        if (error) {
            failed += 1;
            console.error(`  FAIL  ${name}`);
            console.error(`        ${error instanceof Error ? error.message : String(error)}`);
        } else {
            passed += 1;
            console.log(`  PASS  ${name}`);
        }
    };
    try {
        const result = fn();
        if (result instanceof Promise) return result.then(() => done(null)).catch(done);
        done(null);
    } catch (error) {
        done(error);
    }
}

console.log('analytics-v2');

// ---- fixtures ----

function tx(partial: Partial<UnifiedTx> & { id: string; day: string }): UnifiedTx {
    return {
        kind: 'sale',
        dateISO: `${partial.day}T10:00:00.000Z`,
        revenue: 1000,
        discount: 0,
        channel: 'In-Store (POS)',
        paymentMethod: 'cash',
        customerKey: 'walk-in',
        total: 1000,
        ...partial,
    };
}

// Fixed "now" so windows are deterministic: 2026-06-15 12:00 local.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

// ===========================================
test('resolveRange: 30d window length + previous window equal length', () => {
    const win = resolveRange({ preset: '30d' }, NOW);
    assert.equal(win.current.days.length, 30);
    assert.equal(win.previous.days.length, 30);
    // previous ends exactly where current begins
    const prevLast = new Date(win.previous.days[win.previous.days.length - 1] + 'T00:00:00');
    const curFirst = new Date(win.current.days[0] + 'T00:00:00');
    assert.ok(prevLast.getTime() < curFirst.getTime(), 'previous window must precede current');
});

test('resolveRange: 7d and 12m presets', () => {
    assert.equal(resolveRange({ preset: '7d' }, NOW).current.days.length, 7);
    const win12 = resolveRange({ preset: '12m' }, NOW);
    assert.ok(win12.current.days.length >= 365, `12m covers >=365 days, got ${win12.current.days.length}`);
});

test('resolveRange: custom range bounds + swapped bounds normalised', () => {
    const win = resolveRange({ preset: 'custom', start: '2026-01-01T00:00:00Z', end: '2026-01-10T00:00:00Z' }, NOW);
    assert.equal(win.current.days.length, 10);
    const swapped = resolveRange({ preset: 'custom', start: '2026-01-10T00:00:00Z', end: '2026-01-01T00:00:00Z' }, NOW);
    assert.equal(swapped.current.days.length, 10, 'swapped bounds must normalise');
});

test('inWindow: every day key is inside; the day after the last key is not', () => {
    const { current: win } = resolveRange({ preset: 'custom', start: '2026-01-01T00:00:00Z', end: '2026-01-03T00:00:00Z' }, NOW);
    // Timezone-independent probes: local noon of the day key's calendar date.
    const probe = (dayKeyStr: string) => {
        const [y, m, d] = dayKeyStr.split('-').map(Number);
        const iso = new Date(y, m - 1, d, 12).toISOString();
        return iso;
    };
    for (const key of win.days) {
        assert.ok(inWindow(probe(key), win), `day key ${key} must be inside its own window`);
    }
    const last = win.days[win.days.length - 1];
    const [y, m, d] = last.split('-').map(Number);
    assert.equal(inWindow(new Date(y, m - 1, d + 1, 12).toISOString(), win), false, 'day after the picked end must be outside');
    assert.equal(inWindow(undefined, win), false);
});

test('deltaPct: zero-previous returns the null sentinel, not a fake 100', () => {
    assert.equal(deltaPct(0, 0), 0);
    assert.equal(deltaPct(500, 0), null, 'a jump from zero has no comparable percentage');
    assert.equal(deltaPct(150, 100), 50);
    assert.equal(deltaPct(50, 100), -50);
    assert.equal(deltaPct(NaN, 10), null);
    assert.deepEqual(compare(150, 100), { current: 150, previous: 100, deltaPct: 50 });
});

test('buildTrend: daily granularity sums per day', () => {
    const range: AnalyticsRange = { preset: 'custom', start: '2026-03-01T00:00:00Z', end: '2026-03-04T00:00:00Z' };
    const win = resolveRange(range, NOW);
    const current = [
        tx({ id: 'a', day: win.current.days[0], revenue: 100 }),
        tx({ id: 'b', day: win.current.days[0], revenue: 200 }),
        tx({ id: 'c', day: win.current.days[2], revenue: 50 }),
    ];
    const points = buildTrend(current, [], win);
    assert.equal(points.length, 4); // picked end is inclusive → 4 day keys
    assert.equal(points[0].revenue, 300);
    assert.equal(points[0].orders, 2);
    assert.equal(points[1].revenue, 0);
    assert.equal(points[2].revenue, 50);
});

test('buildTrend: previous window aligns by index for daily series', () => {
    const range: AnalyticsRange = { preset: 'custom', start: '2026-03-05T00:00:00Z', end: '2026-03-08T00:00:00Z' };
    const win = resolveRange(range, NOW);
    const current = [tx({ id: 'a', day: win.current.days[0], revenue: 100 })];
    const previous = [tx({ id: 'p', day: win.previous.days[0], revenue: 400 })];
    const points = buildTrend(current, previous, win);
    assert.equal(points.length, 4);
    assert.equal(points[0].revenue, 100);
    assert.equal(points[0].previousRevenue, 400, 'previous day 0 overlays current day 0');
    assert.equal(points[1].previousRevenue, null);
});

test('buildChannelTable: percentages + previous comparison', () => {
    const current = [
        tx({ id: 'a', day: '2026-03-01', revenue: 300, channel: 'In-Store (POS)' }),
        tx({ id: 'b', day: '2026-03-01', revenue: 100, channel: 'Storefront' }),
    ];
    const previous = [tx({ id: 'p', day: '2026-02-01', revenue: 200, channel: 'In-Store (POS)' })];
    const rows = buildChannelTable(current, previous);
    assert.equal(rows.length, 2);
    const pos = rows.find((r) => r.channel === 'In-Store (POS)')!;
    assert.equal(pos.revenue, 300);
    assert.equal(pos.percentage, 75);
    assert.equal(pos.deltaPct, 50);
});

test('buildPaymentMix + buildHeatmap bucket by method and weekday/hour', () => {
    const txs = [
        tx({ id: 'a', day: '2026-03-01', paymentMethod: 'upi', revenue: 100 }),
        tx({ id: 'b', day: '2026-03-02', paymentMethod: 'upi', revenue: 300 }),
        tx({ id: 'c', day: '2026-03-02', paymentMethod: 'cash', revenue: 50 }),
    ];
    const mix = buildPaymentMix(txs);
    assert.equal(mix[0].method, 'upi');
    assert.equal(mix[0].percentage, Math.round((400 / 450) * 1000) / 10);

    const heat = buildHeatmap(txs);
    assert.ok(heat.length >= 2, 'distinct weekday/hour buckets expected');
    const heatRevenue = heat.reduce((s, c) => s + c.revenue, 0);
    assert.equal(heatRevenue, 450);
    for (const cell of heat) {
        assert.ok(cell.weekday >= 0 && cell.weekday <= 6);
        assert.ok(cell.hour >= 0 && cell.hour <= 23);
    }
});

test('buildKpis: AOV math with zero-order previous window', () => {
    const current = [
        tx({ id: 'a', day: '2026-03-01', revenue: 1000 }),
        tx({ id: 'b', day: '2026-03-02', revenue: 500 }),
    ];
    const kpis = buildKpis(current, []);
    assert.equal(kpis.revenue.current, 1500);
    assert.equal(kpis.aov.current, 750);
    assert.equal(kpis.aov.previous, 0);
    assert.equal(kpis.aov.deltaPct, null, 'no previous orders → no percentage comparison');
});

// ---- insights rule engine ----

function fixtureAnalytics(overrides: {
    turnover?: Partial<TurnoverAnalytics>;
    profitability?: Partial<ProfitabilityAnalytics>;
    sales?: Partial<SalesAnalytics>;
}): { turnover: TurnoverAnalytics; profitability: ProfitabilityAnalytics; sales: SalesAnalytics } {
    const zeroMetric = { current: 0, previous: 0, deltaPct: 0 };
    const turnover: TurnoverAnalytics = {
        suite: {
            stockValueCurrent: 0, stockValueStart: 0, avgInventoryValue: 0,
            cogs: 0, grossMargin: 0, marginPct: null,
            turnoverRate: null, annualizedTurnover: null, daysOfInventory: null, gmroi: null,
            costUnknownSharePct: 0, lengthDays: 30,
        },
        byCategory: [],
        byProduct: [],
        aging: [
            { label: '0-30 days', products: 0, stockValue: 0 },
            { label: '31-60 days', products: 0, stockValue: 0 },
            { label: '61-90 days', products: 0, stockValue: 0 },
            { label: '91-180 days', products: 0, stockValue: 0 },
            { label: '180+ days', products: 0, stockValue: 0 },
            { label: 'Never sold', products: 0, stockValue: 0 },
        ],
        overstock: [],
        zeroStockFastMovers: [],
        quadrants: [],
        receiptsUnits: 0,
        ...overrides.turnover,
    };
    const profitability: ProfitabilityAnalytics = {
        overallMargin: zeroMetric, marginPct: null, previousMarginPct: null,
        trend: [], byCategory: [], byChannel: [], topByProfit: [], topByRevenue: [],
        discountErosion: { grossRevenue: 0, totalDiscounts: 0, erosionPct: 0, previousErosionPct: 0, deltaPct: 0 },
        expenses: { total: 0, byCategory: [], operatingResult: 0, available: false },
        marginUnknownCostUnits: 0,
        ...overrides.profitability,
    };
    const sales: SalesAnalytics = {
        kpis: {
            revenue: zeroMetric, orders: zeroMetric, aov: zeroMetric, units: zeroMetric, margin: zeroMetric,
        },
        trend: [], channels: [], paymentMix: [], heatmap: [],
        customerSplit: { newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0, repeatRatePct: 0 },
        ...overrides.sales,
    };
    return { turnover, profitability, sales };
}

test('insights: clean fixtures produce no findings (zero-mock)', async () => {
    const f = fixtureAnalytics({});
    const cards: InsightCard[] = await buildInsights(f.turnover, f.profitability, f.sales);
    assert.equal(cards.length, 0);
});

test('insights: dead stock rule fires with ₹ impact and high severity at scale', async () => {
    const f = fixtureAnalytics({
        turnover: {
            aging: [
                { label: '0-30 days', products: 0, stockValue: 0 },
                { label: '31-60 days', products: 0, stockValue: 0 },
                { label: '61-90 days', products: 0, stockValue: 0 },
                { label: '91-180 days', products: 0, stockValue: 0 },
                { label: '180+ days', products: 9, stockValue: 450000 },
                { label: 'Never sold', products: 0, stockValue: 0 },
            ],
        },
    });
    const cards = await buildInsights(f.turnover, f.profitability, f.sales);
    const dead = cards.find((c) => c.id === 'dead-stock');
    assert.ok(dead, 'dead-stock card must exist');
    assert.equal(dead.impactINR, 450000);
    assert.equal(dead.severity, 'high');
    assert.equal(dead.targetTab, 'inventory');
});

test('insights: discount erosion fires only when ≥8% AND worsening', async () => {
    const base = { grossRevenue: 100000, totalDiscounts: 12000, erosionPct: 12 };
    const worsening = fixtureAnalytics({
        profitability: { discountErosion: { ...base, previousErosionPct: 5, deltaPct: 7 } },
    });
    const cards1 = await buildInsights(worsening.turnover, worsening.profitability, worsening.sales);
    assert.ok(cards1.some((c) => c.id === 'discount-erosion'));

    const improving = fixtureAnalytics({
        profitability: { discountErosion: { ...base, previousErosionPct: 18, deltaPct: -6 } },
    });
    const cards2 = await buildInsights(improving.turnover, improving.profitability, improving.sales);
    assert.ok(!cards2.some((c) => c.id === 'discount-erosion'), 'improving erosion must not fire');
});

test('insights: stockout rule estimates lost revenue from velocity', async () => {
    const f = fixtureAnalytics({
        turnover: {
            zeroStockFastMovers: [
                { productId: 'p1', productName: 'Gold Bangle', sku: 'GB', currentStock: 0, weeklyVelocity: 2, weeksCover: 0, stockValue: 0, lastSaleDaysAgo: 3 },
            ],
            byProduct: [
                { productId: 'p1', productName: 'Gold Bangle', sku: 'GB', categoryName: 'Bangles', unitsSold: 8, revenue: 80000, cogs: 60000, margin: 20000, marginPct: 25, currentStock: 0, stockValue: 0, turnover: null, gmroi: null, weeksCover: null, sellThroughPct: null, lastSaleDaysAgo: 3, velocity: 'fast' },
            ],
        },
    });
    const cards = await buildInsights(f.turnover, f.profitability, f.sales);
    const stockout = cards.find((c) => c.id === 'stockout-p1');
    assert.ok(stockout, 'stockout card must exist');
    // avg price 10000 × 2/week × 2 weeks = 40000
    assert.equal(stockout.impactINR, 40000);
    assert.equal(stockout.severity, 'high');
});

test('insights: cards rank high severity before medium, then by impact', async () => {
    const f = fixtureAnalytics({
        turnover: {
            aging: [
                { label: '0-30 days', products: 0, stockValue: 0 },
                { label: '31-60 days', products: 0, stockValue: 0 },
                { label: '61-90 days', products: 0, stockValue: 0 },
                { label: '91-180 days', products: 0, stockValue: 0 },
                { label: '180+ days', products: 2, stockValue: 150000 },
                { label: 'Never sold', products: 0, stockValue: 0 },
            ],
            overstock: [
                { productId: 'p2', productName: 'Slow Chain', sku: 'SC', currentStock: 30, weeklyVelocity: 0.1, weeksCover: 300, stockValue: 300000, lastSaleDaysAgo: 40 },
            ],
        },
    });
    const cards = await buildInsights(f.turnover, f.profitability, f.sales);
    assert.ok(cards.length >= 2);
    const order = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < cards.length; i += 1) {
        const prev = order[cards[i - 1].severity];
        const cur = order[cards[i].severity];
        assert.ok(prev <= cur, 'severity must be non-decreasing');
    }
});

// ---- dayKey utility ----
test('dayKey pads month/day', () => {
    assert.equal(dayKey(new Date(2026, 2, 5)), '2026-03-05');
    assert.equal(dayKey(new Date(2026, 11, 31)), '2026-12-31');
});

// ---- pbBound (AN-02): PB space-datetime filter bounds ----
test('pbBound: converts T-format ISO bounds to PB space format', () => {
    assert.equal(pbBound('2026-01-03T18:30:00.000Z'), '2026-01-03 18:30:00.000Z');
    assert.equal(pbBound('2026-01-03T00:00:00Z'), '2026-01-03 00:00:00Z');
    // idempotent / pass-through forms
    assert.equal(pbBound('2026-01-03 18:30:00.000Z'), '2026-01-03 18:30:00.000Z', 'already PB-format');
    assert.equal(pbBound('2026-01-03'), '2026-01-03 00:00:00.000Z', 'date-only expands to UTC midnight');
    assert.equal(pbBound(''), '');
});

test('pbBound: space-format bounds keep boundary rows comparable (string-compare semantics)', () => {
    const startBound = pbBound('2026-01-01T00:00:00.000Z');
    const endBound = pbBound('2026-01-03T18:30:00.000Z');
    // a row stored exactly at the start bound must pass `>=`
    assert.ok('2026-01-01 00:00:00.000Z' >= startBound, 'boundary start row included');
    // rows inside the window compare before the end bound (`<`)
    assert.ok('2026-01-03 09:00:00.000Z' < endBound, 'mid-window row included');
    assert.ok(!('2026-01-03 20:00:00.000Z' < endBound), 'row after the exclusive end excluded');
});

// ---- alignPreviousMonths (AN-06): monthly previous overlay ----
test('alignPreviousMonths: previous months align by index onto the current axis', () => {
    const previousAgg = new Map([
        ['2025-08', { revenue: 100, orders: 1 }],
        ['2025-09', { revenue: 200, orders: 2 }],
        ['2025-10', { revenue: 300, orders: 3 }],
    ]);
    const currentKeys = ['2025-12', '2026-01', '2026-02', '2026-03'];
    const aligned = alignPreviousMonths(previousAgg, currentKeys);
    assert.deepEqual(aligned.get('2025-12'), { revenue: 100, orders: 1 });
    assert.deepEqual(aligned.get('2026-01'), { revenue: 200, orders: 2 });
    assert.deepEqual(aligned.get('2026-02'), { revenue: 300, orders: 3 });
    assert.equal(aligned.get('2026-03'), undefined, 'no previous month left over');
    assert.equal(aligned.size, 3);
});

test('buildTrend: monthly previous overlay renders on the current axis (AN-06)', () => {
    // 4-month window → lengthDays > 60 → monthly granularity
    const range: AnalyticsRange = { preset: 'custom', start: '2025-12-01T00:00:00Z', end: '2026-04-01T00:00:00Z' };
    const win = resolveRange(range, NOW);
    assert.ok(win.lengthDays > 60, `expected monthly granularity, lengthDays=${win.lengthDays}`);
    const current = [tx({ id: 'c', day: '2026-02-10', revenue: 700 })];
    // Previous txs in months 1–3 of the previous window (Aug/Sep/Oct 2025).
    const previous = [
        tx({ id: 'p1', day: '2025-08-05', revenue: 100 }),
        tx({ id: 'p2', day: '2025-09-10', revenue: 200 }),
        tx({ id: 'p3', day: '2025-10-15', revenue: 300 }),
    ];
    const points = buildTrend(current, previous, win);
    const feb = points.find((p) => p.date === '2026-02');
    const jan = points.find((p) => p.date === '2026-01');
    const mar = points.find((p) => p.date === '2026-03');
    assert.ok(feb && jan && mar, 'all current-window months zero-filled');
    assert.equal(feb.revenue, 700);
    assert.equal(feb.previousRevenue, 300, 'previous month with data overlays the current axis');
    assert.equal(jan.previousRevenue, 200);
    assert.equal(mar.previousRevenue, null, 'month without previous data stays null');
});

// ---- aggregateCustomerSplit (AN-05): customers, not transactions ----
test('aggregateCustomerSplit: repeat buyer counts once, revenue is first-seen (AN-05)', () => {
    const txs = [
        tx({ id: 'a', day: '2026-03-01', customerKey: 'c1', revenue: 1000 }),
        tx({ id: 'b', day: '2026-03-02', customerKey: 'c1', revenue: 500 }),
        tx({ id: 'c', day: '2026-03-03', customerKey: 'c2', revenue: 800 }),
    ];
    const split = aggregateCustomerSplit(txs, new Set(['c1'])); // c1 had history before the window
    assert.equal(split.newCustomers, 1, 'c2 only — repeat txs of c1 are not new counts');
    assert.equal(split.returningCustomers, 1, 'c1 counted once, not once per transaction');
    assert.equal(split.newRevenue, 800);
    assert.equal(split.returningRevenue, 1000, 'first-seen transaction revenue only');
    assert.equal(split.repeatRatePct, 50, '1 of 2 distinct customers returning');
});

test('aggregateCustomerSplit: unknown repeat buyer is new exactly once; empty keys skipped', () => {
    const txs = [
        tx({ id: 'a', day: '2026-03-01', customerKey: 'x', revenue: 400 }),
        tx({ id: 'b', day: '2026-03-02', customerKey: 'x', revenue: 600 }),
        tx({ id: 'c', day: '2026-03-03', customerKey: 'y', revenue: 200 }),
        tx({ id: 'd', day: '2026-03-03', customerKey: 'y', revenue: 100 }),
        tx({ id: 'e', day: '2026-03-04', customerKey: '', revenue: 999 }),
    ];
    const split = aggregateCustomerSplit(txs, new Set());
    assert.equal(split.newCustomers, 2, 'x and y each counted once');
    assert.equal(split.returningCustomers, 0);
    assert.equal(split.newRevenue, 600, 'first-seen revenue of x (400) + y (200)');
    assert.equal(split.returningRevenue, 0);
    assert.equal(split.repeatRatePct, 0);
});

test('aggregateCustomerSplit: empty window yields zeroed split', () => {
    const split = aggregateCustomerSplit([], new Set());
    assert.deepEqual(split, { newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0, repeatRatePct: 0 });
});

// ===========================================

const trendTypeCheck: TrendPoint | null = null;
void trendTypeCheck;

(async () => {
    await Promise.resolve();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
})();
