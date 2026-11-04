/**
 * Sales metrics engine (Analytics Deep-Insights).
 *
 * Every headline number is {current, previous, deltaPct} over the resolved
 * range, built on the DEDUPED canonical transaction set from load.ts (see the
 * revenue-truth rule there — storefront mirrors are excluded by filter, unpaid
 * Razorpay orders stay out via the revenue status filter).
 */

import { pb, sanitizeFilter } from '../pocketbase';
import { resolveRange, compare, dayKey, pbBound, type AnalyticsRange, type ComparedMetric, type DateWindow } from './range';
import { loadTxWindow, loadUnifiedLines, type UnifiedTx, tenantEmail } from './load';

// Recharts v3 types chart rows as Record<string, unknown>; every chart-row
// interface here needs the same index signature (see analytics.ts:50).
export interface TrendPoint {
    date: string;
    label: string;
    revenue: number;
    orders: number;
    previousRevenue: number | null;
    [key: string]: string | number | null;
}

export interface SalesKpis {
    revenue: ComparedMetric;
    orders: ComparedMetric;
    aov: ComparedMetric;
    units: ComparedMetric;
    margin: ComparedMetric;
}

export interface ChannelRow {
    channel: string;
    orders: number;
    revenue: number;
    percentage: number;
    previousRevenue: number;
    deltaPct: number;
    [key: string]: string | number;
}

export interface PaymentMixRow {
    method: string;
    amount: number;
    count: number;
    percentage: number;
    [key: string]: string | number;
}

export interface HeatCell {
    weekday: number; // 0=Sun … 6=Sat
    hour: number; // 0–23
    revenue: number;
    orders: number;
}

export interface CustomerSplit {
    newCustomers: number;
    returningCustomers: number;
    newRevenue: number;
    returningRevenue: number;
    repeatRatePct: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthKey(day: string): string {
    return day.slice(0, 7);
}

function labelForDay(day: string): string {
    const d = new Date(day + 'T00:00:00');
    return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

function labelForMonth(key: string): string {
    const [y, m] = key.split('-');
    return `${MONTH_LABELS[Number(m) - 1]} ${y.slice(2)}`;
}

/** Running sum for one trend bucket (a day or a month). */
export interface TrendBucket {
    revenue: number;
    orders: number;
}

/**
 * Align previous-window monthly aggregates onto the current axis BY POSITION
 * (audit AN-06). Previous months are keyed under their own YYYY-MM, so a
 * direct label lookup against the current window's months can never match and
 * the dashed previous series would never render. Mirrors the index alignment
 * profitability.ts applies to its monthly margin trend.
 */
export function alignPreviousMonths(previousAgg: Map<string, TrendBucket>, currentKeys: string[]): Map<string, TrendBucket> {
    const prevMonths = [...previousAgg.keys()].sort();
    const aligned = new Map<string, TrendBucket>();
    prevMonths.forEach((m, i) => {
        if (i < currentKeys.length) aligned.set(currentKeys[i], previousAgg.get(m)!);
    });
    return aligned;
}

/**
 * Trend series with automatic granularity:
 *   ≤ 60 days → daily points; longer → monthly.
 * `previous` points are overlaid shifted by the window length so the chart can
 * draw "same period last window" as a dashed series. Outside the current
 * window previousRevenue is null.
 */
export function buildTrend(currentTxs: UnifiedTx[], previousTxs: UnifiedTx[], win: { current: DateWindow; previous: DateWindow; lengthDays: number }): TrendPoint[] {
    const monthly = win.lengthDays > 60;

    const currentAgg = new Map<string, { revenue: number; orders: number }>();
    for (const tx of currentTxs) {
        const key = monthly ? monthKey(tx.day) : tx.day;
        const agg = currentAgg.get(key) || { revenue: 0, orders: 0 };
        agg.revenue += tx.revenue;
        agg.orders += 1;
        currentAgg.set(key, agg);
    }

    const previousAgg = new Map<string, { revenue: number; orders: number }>();
    for (const tx of previousTxs) {
        const key = monthly ? monthKey(tx.day) : tx.day;
        const agg = previousAgg.get(key) || { revenue: 0, orders: 0 };
        agg.revenue += tx.revenue;
        agg.orders += 1;
        previousAgg.set(key, agg);
    }

    // Zero-fill the current axis first so both granularities align against it
    // (charts show continuous days/months even where no sales occurred —
    // silent gaps read as missing data otherwise).
    const keys = monthly
        ? [...new Set(win.current.days.map((d) => d.slice(0, 7)))].sort()
        : win.current.days;

    // Previous mapped onto the current axis: daily → index alignment
    // (previous day i aligns with current day i); monthly → index alignment
    // across months (see alignPreviousMonths — a label lookup never matches).
    let prevByAlignedKey = new Map<string, { revenue: number; orders: number }>();
    if (monthly) {
        prevByAlignedKey = alignPreviousMonths(previousAgg, keys);
    } else {
        const currentDays = win.current.days;
        const previousDays = win.previous.days;
        previousDays.forEach((day, i) => {
            const v = previousAgg.get(day);
            if (v && i < currentDays.length) prevByAlignedKey.set(currentDays[i], v);
        });
    }

    return keys.map((key) => {
        const cur = currentAgg.get(key) || { revenue: 0, orders: 0 };
        const prev = prevByAlignedKey.get(key);
        return {
            date: key,
            label: monthly ? labelForMonth(key) : labelForDay(key),
            revenue: Math.round(cur.revenue),
            orders: cur.orders,
            previousRevenue: prev ? Math.round(prev.revenue) : null,
        };
    });
}

export interface ChannelResult {
    rows: ChannelRow[];
}

export function buildChannelTable(currentTxs: UnifiedTx[], previousTxs: UnifiedTx[]): ChannelRow[] {
    const agg = (txs: UnifiedTx[]) => {
        const m = new Map<string, { orders: number; revenue: number }>();
        for (const tx of txs) {
            const a = m.get(tx.channel) || { orders: 0, revenue: 0 };
            a.orders += 1;
            a.revenue += tx.revenue;
            m.set(tx.channel, a);
        }
        return m;
    };

    const cur = agg(currentTxs);
    const prev = agg(previousTxs);
    const total = [...cur.values()].reduce((s, v) => s + v.revenue, 0);

    return [...cur.entries()]
        .map(([channel, a]) => {
            const p = prev.get(channel)?.revenue || 0;
            return {
                channel,
                orders: a.orders,
                revenue: Math.round(a.revenue),
                percentage: total > 0 ? Math.round((a.revenue / total) * 1000) / 10 : 0,
                previousRevenue: Math.round(p),
                deltaPct: p > 0 ? Math.round(((a.revenue - p) / p) * 1000) / 10 : a.revenue > 0 ? 100 : 0,
            };
        })
        .sort((a, b) => b.revenue - a.revenue);
}

export function buildPaymentMix(currentTxs: UnifiedTx[]): PaymentMixRow[] {
    const m = new Map<string, { amount: number; count: number }>();
    let total = 0;
    for (const tx of currentTxs) {
        const method = tx.paymentMethod || 'unspecified';
        const a = m.get(method) || { amount: 0, count: 0 };
        a.amount += tx.revenue;
        a.count += 1;
        m.set(method, a);
        total += tx.revenue;
    }
    return [...m.entries()]
        .map(([method, a]) => ({
            method,
            amount: Math.round(a.amount),
            count: a.count,
            percentage: total > 0 ? Math.round((a.amount / total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);
}

/**
 * Weekday × hour revenue heatmap from POS + order timestamps.
 *
 * KNOWN QUIRK (audit AN-27): orders whose `order_date` was saved as a bare
 * date ("YYYY-MM-DD", no time) parse to UTC midnight and heap into the
 * midnight (hour 0) cell, alongside genuinely-timed local sales. Left as-is —
 * writers emit full ISO today, so this only affects legacy rows; forcing a
 * fake time would misattribute revenue worse than an honest 00:00 spike.
 */
export function buildHeatmap(currentTxs: UnifiedTx[]): HeatCell[] {
    const cells = new Map<string, HeatCell>();
    for (const tx of currentTxs) {
        const d = new Date(tx.dateISO);
        const weekday = d.getDay();
        const hour = d.getHours();
        const key = `${weekday}-${hour}`;
        const cell = cells.get(key) || { weekday, hour, revenue: 0, orders: 0 };
        cell.revenue += tx.revenue;
        cell.orders += 1;
        cells.set(key, cell);
    }
    return [...cells.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}

/**
 * Pure core of buildCustomerSplit (unit-testable): classify each DISTINCT
 * customerKey exactly once per window (audit AN-05 — the per-transaction
 * counters inflated a repeat buyer with 5 orders 5×). A customer is counted
 * once, on their first-seen transaction, whose revenue is the revenue
 * attributed to them; repeat-rate's denominator is distinct customers.
 */
export function aggregateCustomerSplit(currentTxs: UnifiedTx[], known: Set<string>): CustomerSplit {
    let newCustomers = 0;
    let returningCustomers = 0;
    let newRevenue = 0;
    let returningRevenue = 0;
    const seen = new Set<string>();
    for (const tx of currentTxs) {
        const key = tx.customerKey;
        if (!key) continue;
        if (seen.has(key)) continue; // repeat transaction of an already-counted customer
        seen.add(key);
        if (known.has(key)) {
            returningCustomers += 1;
            returningRevenue += tx.revenue;
        } else {
            newCustomers += 1;
            newRevenue += tx.revenue;
        }
    }

    const totalCustomers = newCustomers + returningCustomers;
    return {
        newCustomers,
        returningCustomers,
        newRevenue: Math.round(newRevenue),
        returningRevenue: Math.round(returningRevenue),
        repeatRatePct: totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 1000) / 10 : 0,
    };
}

/**
 * New vs returning customers within the window. A customer is "returning"
 * when they had a canonical transaction BEFORE the window start. History is
 * probed with one cheap query per side (sales + orders); dedupe/counting is
 * aggregateCustomerSplit.
 */
export async function buildCustomerSplit(tenant: string, win: { current: DateWindow; previous: DateWindow }, currentTxs: UnifiedTx[]): Promise<CustomerSplit> {
    if (!tenant) {
        return { newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0, repeatRatePct: 0 };
    }

    // History: any canonical tx before the window start. Same canonical
    // conventions as load.ts: mirror excluded, cancelled mirrors excluded,
    // PB space-datetime bound (AN-02).
    const historyFilterSales =
        `account_email="${sanitizeFilter(tenant)}" && channel!="storefront"` +
        ` && !(channel="whatsapp" && channel_order_id != "") && status!="cancelled"` +
        ` && created<"${pbBound(win.current.startISO)}"`;
    const historyFilterOrders =
        `account_email="${sanitizeFilter(tenant)}" && created<"${pbBound(win.current.startISO)}"` +
        ` && (${['confirmed', 'shipped', 'delivered', 'invoiced'].map((s) => `status="${s}"`).join(' || ')})`;

    const [histSales, histOrders] = await Promise.all([
        pb.collection('sales').getFullList({ filter: historyFilterSales, fields: 'id,customer_phone,customer_name' }).catch(() => [] as Array<Record<string, any>>),
        pb.collection('sales_orders').getFullList({ filter: historyFilterOrders, fields: 'id,customer_phone,customer_email,customer_name' }).catch(() => [] as Array<Record<string, any>>),
    ]);

    const known = new Set<string>();
    for (const s of histSales) {
        const key = String(s.customer_phone || s.customer_name || '').trim().toLowerCase();
        if (key) known.add(key);
    }
    for (const o of histOrders) {
        const key = String(o.customer_phone || o.customer_email || o.customer_name || '').trim().toLowerCase();
        if (key) known.add(key);
    }

    return aggregateCustomerSplit(currentTxs, known);
}

/** AOV = revenue / orders, compared across windows. */
export function buildKpis(currentTxs: UnifiedTx[], previousTxs: UnifiedTx[], margin?: ComparedMetric, units?: ComparedMetric): SalesKpis {
    const sum = (txs: UnifiedTx[]) => txs.reduce((s, t) => s + t.revenue, 0);
    const revenue = compare(sum(currentTxs), sum(previousTxs));
    const orders = compare(currentTxs.length, previousTxs.length);
    const aov = compare(
        orders.current > 0 ? Math.round(revenue.current / orders.current) : 0,
        orders.previous > 0 ? Math.round(revenue.previous / orders.previous) : 0
    );
    return {
        revenue,
        orders,
        aov,
        units: units || { current: 0, previous: 0, deltaPct: 0 },
        margin: margin || { current: 0, previous: 0, deltaPct: 0 },
    };
}

// ===========================================
// ENTRYPOINT
// ===========================================

export interface SalesAnalytics {
    kpis: SalesKpis;
    trend: TrendPoint[];
    channels: ChannelRow[];
    paymentMix: PaymentMixRow[];
    heatmap: HeatCell[];
    customerSplit: CustomerSplit;
}

export async function getSalesAnalytics(range: AnalyticsRange): Promise<SalesAnalytics> {
    const tenant = tenantEmail();
    if (!tenant) {
        const empty = { current: 0, previous: 0, deltaPct: 0 };
        return {
            kpis: { revenue: empty, orders: empty, aov: empty, units: empty, margin: empty },
            trend: [],
            channels: [],
            paymentMix: [],
            heatmap: [],
            customerSplit: { newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0, repeatRatePct: 0 },
        };
    }

    const win = resolveRange(range);
    const [currentTxs, previousTxs, currentLines, previousLines] = await Promise.all([
        loadTxWindow(tenant, win.current),
        loadTxWindow(tenant, win.previous),
        loadUnifiedLines(tenant, win.current),
        loadUnifiedLines(tenant, win.previous),
    ]);

    // Units and margin must be measured, not defaulted: buildKpis() filled
    // both with zeros when called without them, so the analytics view always
    // showed 0 units / "—" margin (RPT-6).
    const sumUnits = (lines: typeof currentLines) => lines.reduce((s, l) => s + l.quantity, 0);
    const cogsOf = (lines: typeof currentLines) => lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const sumRevenue = (txs: UnifiedTx[]) => txs.reduce((s, t) => s + t.revenue, 0);
    const units = compare(sumUnits(currentLines), sumUnits(previousLines));
    const margin = compare(
        Math.round(sumRevenue(currentTxs) - cogsOf(currentLines)),
        Math.round(sumRevenue(previousTxs) - cogsOf(previousLines))
    );

    return {
        kpis: buildKpis(currentTxs, previousTxs, margin, units),
        trend: buildTrend(currentTxs, previousTxs, win),
        channels: buildChannelTable(currentTxs, previousTxs),
        paymentMix: buildPaymentMix(currentTxs),
        heatmap: buildHeatmap(currentTxs),
        customerSplit: await buildCustomerSplit(tenant, win, currentTxs),
    };
}

export { WEEKDAYS, dayKey };
