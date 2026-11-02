/**
 * Snapshot rebuild — populates analytics_daily_snapshots for long-range views
 * (12m mix shift, seasonality) so those charts don't rescan the whole ledger.
 *
 * Run:  npx tsx src/scripts/rebuild-analytics-snapshots.ts [--days=400]
 * Env:  POCKETBASE_SUPERUSER_EMAIL / POCKETBASE_SUPERUSER_PASSWORD
 *       PB_URL (default http://127.0.0.1:8090)
 */

import { config as loadEnv } from 'dotenv';
import PocketBase from 'pocketbase';
import { resolveRange, type AnalyticsRange } from '../lib/analytics-v2/range';
import { loadUnifiedLines, loadTxWindow } from '../lib/analytics-v2/load';

loadEnv();

const baseUrl = (process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const adminEmail = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || '';
const adminPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || '';

const daysArg = process.argv.find((a) => a.startsWith('--days='));
const days = daysArg ? Math.max(1, Number(daysArg.split('=')[1]) || 400) : 400;

interface SnapshotRow {
    day: string;
    category_id: string;
    category_name: string;
    revenue: number;
    cogs: number;
    units: number;
    orders: number;
    discounts: number;
}

async function main() {
    if (!adminEmail || !adminPassword) {
        console.error('Superuser credentials required: set POCKETBASE_SUPERUSER_EMAIL / POCKETBASE_SUPERUSER_PASSWORD');
        process.exit(1);
    }

    const client = new PocketBase(baseUrl);
    client.autoCancellation(false);
    await client.collection('_superusers').authWithPassword(adminEmail, adminPassword);
    const db = client as unknown as import('../lib/analytics-v2/load').AnalyticsDb;

    console.log(`Connected to ${baseUrl}. Rebuilding snapshots for the last ${days} days.`);

    // Tenants present on canonical sales.
    const sales = await client.collection('sales').getFullList<{ account_email?: string }>({ fields: 'id,account_email' });
    const orders = await client.collection('sales_orders').getFullList<{ account_email?: string }>({ fields: 'id,account_email' });
    const tenants = [...new Set([...sales, ...orders].map((r) => String(r.account_email || '')).filter(Boolean))];

    if (tenants.length === 0) {
        console.log('No tenant data found. Nothing to snapshot.');
        return;
    }

    for (const tenant of tenants) {
        console.log(`\n=== Tenant: ${tenant} ===`);
        const range: AnalyticsRange = { preset: 'custom', start: new Date(Date.now() - days * 86_400_000).toISOString() };
        const win = resolveRange(range);

        const [lines, txs] = await Promise.all([
            loadUnifiedLines(tenant, win.current, db),
            loadTxWindow(tenant, win.current, db),
        ]);

        // group lines by day × category
        const agg = new Map<string, SnapshotRow>();
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
        // order counts: distinct tx per day
        const ordersByDay = new Map<string, Set<string>>();
        for (const t of txs) {
            const set = ordersByDay.get(t.day) || new Set<string>();
            set.add(t.id);
            ordersByDay.set(t.day, set);
        }
        for (const row of agg.values()) {
            row.orders = ordersByDay.get(row.day)?.size || 0;
        }

        // replace span (idempotent)
        const old = await client.collection('analytics_daily_snapshots').getFullList<{ id: string }>({
            filter: `account_email="${tenant}" && day>="${win.current.startISO.slice(0, 10)}" && day<="${win.current.endISO.slice(0, 10)}"`,
            fields: 'id',
        }).catch(() => [] as Array<{ id: string }>);
        for (const row of old) {
            await client.collection('analytics_daily_snapshots').delete(row.id).catch(() => {});
        }

        let written = 0;
        const rows = [...agg.values()];
        for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50);
            await Promise.all(
                batch.map((row) =>
                    client.collection('analytics_daily_snapshots').create({ account_email: tenant, ...row })
                )
            );
            written += batch.length;
        }

        console.log(`days covered: ${new Set(rows.map((r) => r.day)).size}, rows written: ${written}`);
    }

    console.log('\nSnapshot rebuild complete.');
}

main().catch((e) => {
    console.error('Snapshot rebuild failed:', e);
    process.exit(1);
});
