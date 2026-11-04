/**
 * Daily snapshot layer (Analytics Deep-Insights, performance Layer 3).
 *
 * The `analytics_daily_snapshots` collection stores one row per tenant × day
 * × category with revenue/units/cogs/orders/discounts. Long-range views (12m
 * mix shift, seasonality) read these instead of rescanning the whole ledger;
 * when snapshots are absent the callers fall back to live computation.
 *
 * Upserts are keyed by the unique index (account_email, day, category_id).
 */

import { pb, sanitizeFilter } from '../pocketbase';
import { tenantEmail, loadUnifiedLines } from './load';
import { resolveRange, dayKey } from './range';

export interface DailySnapshot {
    id?: string;
    day: string;
    category_id: string;
    category_name: string;
    revenue: number;
    cogs: number;
    units: number;
    orders: number;
    discounts: number;
}

export interface SnapshotSeriesPoint {
    day: string;
    revenue: number;
    orders: number;
    cogs: number;
    byCategory: Record<string, number>;
}

/**
 * Read snapshot rows for a day span (tenant-scoped).
 *
 * An empty result means "no snapshots written yet"; a read FAILURE is raised so
 * callers cannot mistake an outage for an empty span and silently fall back to
 * live computation (AN2-10). A missing collection (404, migration unapplied) is
 * the one documented exception.
 */
export async function getSnapshotSeries(fromDay: string, toDay: string): Promise<SnapshotSeriesPoint[]> {
    const tenant = tenantEmail();
    if (!tenant) return [];

    let rows: Array<Record<string, unknown>>;
    try {
        rows = (await pb.collection('analytics_daily_snapshots').getFullList({
            filter: `account_email="${sanitizeFilter(tenant)}" && day>="${fromDay}" && day<="${toDay}"`,
            sort: 'day',
        })) as Array<Record<string, unknown>>;
    } catch (e) {
        if ((e as { status?: number })?.status === 404) {
            console.warn('[snapshots] collection not found; treating as no snapshots yet');
            return [];
        }
        console.error('[snapshots] read failed:', e);
        throw e;
    }
    if (rows.length === 0) return [];

    const byDay = new Map<string, SnapshotSeriesPoint>();
    for (const row of rows) {
        const day = String(row.day);
        const p = byDay.get(day) || { day, revenue: 0, orders: 0, cogs: 0, byCategory: {} };
        p.revenue += Number(row.revenue || 0);
        // Legacy snapshot rows carried the day's order count on every
        // category row (sum over-counted orders × categories); new rows
        // carry it once on a single per-day row. max() is correct for
        // both shapes (audit AN-15).
        p.orders = Math.max(p.orders, Number(row.orders || 0));
        p.cogs += Number(row.cogs || 0);
        const catName = String(row.category_name || 'Unclassified');
        p.byCategory[catName] = (p.byCategory[catName] || 0) + Number(row.revenue || 0);
        byDay.set(day, p);
    }
    return [...byDay.values()];
}

/** Are snapshots populated for the given span? (drives the UI fallback) */
export async function snapshotsAvailable(fromDay: string, toDay: string): Promise<boolean> {
    const series = await getSnapshotSeries(fromDay, toDay);
    return series.length > 0;
}

/** Rebuild snapshots for the last `days` days (full recompute of that span). */
export async function rebuildSnapshots(days: number = 400): Promise<{ written: number; days: number }> {
    const tenant = tenantEmail();
    if (!tenant) return { written: 0, days: 0 };

    // `days` counts day keys, so the start is today-(days-1). Computed with
    // local calendar arithmetic (a fixed ms subtraction drifts across DST) and
    // passed as a date-only string so resolveBound snaps it to local midnight.
    const span = Math.max(1, Math.floor(days));
    const today = new Date();
    const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - span + 1);
    const win = resolveRange({ preset: 'custom', start: dayKey(startDay) });
    const firstDay = win.current.days[0];
    const lastDay = win.current.days[win.current.days.length - 1];
    if (!firstDay || !lastDay) return { written: 0, days: 0 };

    const lines = await loadUnifiedLines(tenant, win.current);

    // group by day × category
    const agg = new Map<string, DailySnapshot>();
    for (const l of lines) {
        const key = `${l.day}::${l.categoryId}`;
        const row = agg.get(key) || {
            day: l.day,
            category_id: l.categoryId,
            category_name: l.categoryName,
            revenue: 0, cogs: 0, units: 0, orders: 0, discounts: 0,
        };
        row.revenue += l.netRevenue;
        row.cogs += l.quantity * l.unitCost;
        row.units += l.quantity;
        row.discounts += l.lineDiscount;
        agg.set(key, row);
    }
    // order counts are tx-level: count distinct tx per day
    const ordersByDay = new Map<string, Set<string>>();
    const txs = await (await import('./load')).loadTxWindow(tenant, win.current);
    for (const t of txs) {
        const set = ordersByDay.get(t.day) || new Set<string>();
        set.add(t.id);
        ordersByDay.set(t.day, set);
    }
    // A day with transactions but no line rows (every item unlinked) would emit
    // no snapshot at all and the order count would vanish (AN2-11). Give those
    // days an orders-only row on the '' category.
    const daysWithRows = new Set([...agg.values()].map((row) => row.day));
    for (const [day, ids] of ordersByDay) {
        if (daysWithRows.has(day)) continue;
        agg.set(`${day}::`, {
            day,
            category_id: '',
            category_name: 'Unclassified',
            revenue: 0, cogs: 0, units: 0, orders: ids.size, discounts: 0,
        });
    }
    // Orders are tx-level (per day, not per category): write the count on ONE
    // canonical row per day so summing readers don't multiply it by the
    // category count (audit AN-15).
    const orderCarrier = new Map<string, string>(); // day -> agg key
    for (const [key, row] of agg) {
        const cur = orderCarrier.get(row.day);
        if (cur === undefined || key < cur) orderCarrier.set(row.day, key);
    }
    for (const [key, row] of agg) {
        row.orders = orderCarrier.get(row.day) === key ? (ordersByDay.get(row.day)?.size || 0) : 0;
        agg.set(key, row);
    }

    // Replace the span with upserts first, then delete stale rows. A failure
    // mid-write leaves the previous snapshot intact instead of an empty span
    // (audit AN-16); only successful writes are counted.
    //
    // The existing-row read has NO fallback: swallowing it made every row look
    // new, so the unique index rejected the writes and the span was left half
    // rewritten with no error (AN2-1). Binding by local day keys (not the UTC
    // date slice) keeps the cleanup aligned with the dayKey axis (AN2-5).
    const oldRows = (await pb.collection('analytics_daily_snapshots').getFullList({
        filter: `account_email="${sanitizeFilter(tenant)}" && day>="${firstDay}" && day<="${lastDay}"`,
    })) as Array<Record<string, unknown>>;
    const existingByKey = new Map<string, string>();
    for (const r of oldRows) {
        existingByKey.set(`${String(r.day)}::${String(r.category_id)}`, String(r.id));
    }

    let written = 0;
    const rows = [...agg.values()];
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const results = await Promise.all(
            batch.map(async (row) => {
                const key = `${row.day}::${row.category_id}`;
                const existingId = existingByKey.get(key);
                try {
                    if (existingId) {
                        await pb.collection('analytics_daily_snapshots').update(existingId, { account_email: tenant, ...row });
                        existingByKey.delete(key);
                    } else {
                        await pb.collection('analytics_daily_snapshots').create({ account_email: tenant, ...row });
                    }
                    return true;
                } catch (e) {
                    console.warn('[snapshots] row write failed:', row.day, row.category_id, e);
                    return false;
                }
            })
        );
        written += results.filter(Boolean).length;
    }
    // Delete rows no longer covered by the recomputation. A swallowed failure
    // here leaves stale day×category rows in place, and summing readers then
    // double-count the day — so failures are counted and the rebuild fails
    // loudly instead of reporting success (AN2-3).
    const failedDeletes: string[] = [];
    for (const id of existingByKey.values()) {
        try {
            await pb.collection('analytics_daily_snapshots').delete(id);
        } catch (e) {
            failedDeletes.push(id);
            console.error('[snapshots] stale snapshot row delete failed:', id, e);
        }
    }
    if (failedDeletes.length > 0) {
        throw new Error(
            `[snapshots] ${failedDeletes.length} stale snapshot row(s) could not be deleted; ` +
            `the rebuilt span may double-count until they are removed.`
        );
    }

    return { written, days: new Set(rows.map((r) => r.day)).size };
}
