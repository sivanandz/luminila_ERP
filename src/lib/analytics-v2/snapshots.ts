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

import { pb } from '../pocketbase';
import { tenantEmail, loadUnifiedLines } from './load';
import { resolveRange } from './range';

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

/** Read snapshot rows for a day span (tenant-scoped). Empty = no snapshots yet. */
export async function getSnapshotSeries(fromDay: string, toDay: string): Promise<SnapshotSeriesPoint[]> {
    const tenant = tenantEmail();
    if (!tenant) return [];
    try {
        const rows = await pb.collection('analytics_daily_snapshots').getFullList({
            filter: `account_email="${tenant}" && day>="${fromDay}" && day<="${toDay}"`,
            sort: 'day',
        });
        if (rows.length === 0) return [];

        const byDay = new Map<string, SnapshotSeriesPoint>();
        for (const row of rows as Array<Record<string, unknown>>) {
            const day = String(row.day);
            const p = byDay.get(day) || { day, revenue: 0, orders: 0, cogs: 0, byCategory: {} };
            p.revenue += Number(row.revenue || 0);
            p.orders += Number(row.orders || 0);
            p.cogs += Number(row.cogs || 0);
            const catName = String(row.category_name || 'Unclassified');
            p.byCategory[catName] = (p.byCategory[catName] || 0) + Number(row.revenue || 0);
            byDay.set(day, p);
        }
        return [...byDay.values()];
    } catch (e) {
        // Collection may not exist yet (migration unapplied) — treat as empty.
        console.warn('[snapshots] read failed, callers should fall back to live computation:', e);
        return [];
    }
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

    const win = resolveRange({ preset: 'custom', start: new Date(Date.now() - days * 86_400_000).toISOString() });
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
    for (const [key, row] of agg) {
        row.orders = ordersByDay.get(row.day)?.size || 0;
        agg.set(key, row);
    }

    // Replace the span (idempotent rebuild): delete then create.
    const old = await pb.collection('analytics_daily_snapshots').getFullList({
        filter: `account_email="${tenant}" && day>="${win.current.startISO.slice(0, 10)}" && day<="${win.current.endISO.slice(0, 10)}"`,
        fields: 'id',
    }).catch(() => [] as Array<{ id: string }>);
    for (const row of old) {
        await pb.collection('analytics_daily_snapshots').delete(row.id).catch(() => {});
    }

    let written = 0;
    const rows = [...agg.values()];
    for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        await Promise.all(
            batch.map((row) =>
                pb.collection('analytics_daily_snapshots').create({ account_email: tenant, ...row }).catch((e) => {
                    console.warn('[snapshots] row write failed:', row.day, row.category_id, e);
                })
            )
        );
        written += batch.length;
    }

    return { written, days: new Set(rows.map((r) => r.day)).size };
}
