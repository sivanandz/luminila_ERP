/**
 * Backfill unit_cost snapshots on historical sale_items / sales_order_items.
 *
 * New sales snapshot cost at sale time (2026-11-02); historical rows predate
 * the snapshot column. This script estimates each row's cost the same way the
 * stock report values inventory — weighted-average landed cost from purchase
 * receipts, falling back to the product's current cost_price — and writes it
 * into unit_cost. Rows with a snapshot already present are untouched; rows
 * with no cost basis at all are left unset so analytics keep flagging them.
 *
 * Run:  npx tsx src/scripts/backfill-unit-costs.ts [--apply]
 *       (default is dry-run: prints what WOULD change and overall stats)
 * Env:  POCKETBASE_SUPERUSER_EMAIL / POCKETBASE_SUPERUSER_PASSWORD
 *       PB_URL (default http://127.0.0.1:8090)
 */

import { config as loadEnv } from 'dotenv';
import PocketBase from 'pocketbase';
import { buildLandedCostMap } from '../lib/reports';

loadEnv();

const baseUrl = (process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const adminEmail = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || '';
const adminPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || '';
const apply = process.argv.includes('--apply');

interface ItemRow {
    id: string;
    account_email?: string;
    product?: string;
    variant?: string;
    quantity?: number;
    unit_cost?: number | '';
}

async function resolveCost(
    row: ItemRow,
    landed: Map<string, number>,
    productCost: Map<string, number>
): Promise<number> {
    const variantId = String(row.variant || '');
    const productId = String(row.product || '');
    const landedCost = variantId ? landed.get(variantId) : undefined;
    const fallback = productId ? productCost.get(productId) || 0 : 0;
    return landedCost ?? fallback;
}

async function main() {
    if (!adminEmail || !adminPassword) {
        console.error('Superuser credentials required: set POCKETBASE_SUPERUSER_EMAIL / POCKETBASE_SUPERUSER_PASSWORD');
        process.exit(1);
    }

    const client = new PocketBase(baseUrl);
    client.autoCancellation(false);
    await client.collection('_superusers').authWithPassword(adminEmail, adminPassword);
    console.log(`Connected to ${baseUrl} as superuser. Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

    const items = await client.collection('sale_items').getFullList<ItemRow>({ filter: 'unit_cost=""' });
    const orderItems = await client.collection('sales_order_items').getFullList<ItemRow>({ filter: 'unit_cost=""' });
    const tenants = [...new Set([...items, ...orderItems].map((r) => String(r.account_email || '')).filter(Boolean))];

    if (tenants.length === 0) {
        console.log('No sale/order items missing unit_cost. Nothing to do.');
        return;
    }

    for (const tenant of tenants) {
        console.log(`\n=== Tenant: ${tenant} ===`);

        // Full landed-cost map for this tenant (same engine as the stock report).
        const landed = await buildLandedCostMap(client as unknown as PocketBase, tenant);

        const products = await client.collection('products').getFullList<{ id: string; cost_price?: number }>({
            filter: `account_email="${tenant}"`,
        });
        const productCost = new Map(products.map((p) => [p.id, Number(p.cost_price || 0)]));

        const rows: Array<{ row: ItemRow; collection: string }> = [
            ...items.map((row) => ({ row, collection: 'sale_items' })),
            ...orderItems.map((row) => ({ row, collection: 'sales_order_items' })),
        ].filter((entry) => String(entry.row.account_email || '') === tenant);

        let resolvable = 0;
        let unknown = 0;
        let updated = 0;
        const CHUNK = 25;

        if (!apply) {
            for (const entry of rows) {
                const cost = await resolveCost(entry.row, landed, productCost);
                if (cost > 0) resolvable += 1;
                else unknown += 1;
            }
        } else {
            for (let i = 0; i < rows.length; i += CHUNK) {
                const batch = rows.slice(i, i + CHUNK);
                await Promise.all(
                    batch.map(async (entry) => {
                        const cost = await resolveCost(entry.row, landed, productCost);
                        if (cost <= 0) {
                            unknown += 1;
                            return;
                        }
                        await client.collection(entry.collection).update(entry.row.id, { unit_cost: cost });
                        updated += 1;
                    })
                );
            }
        }

        console.log(`rows missing cost : ${rows.length}`);
        console.log(apply ? `rows updated      : ${updated}` : `rows resolvable   : ${resolvable}`);
        console.log(`no cost basis     : ${unknown} (needs product cost_price, or no purchase history)`);
    }

    console.log(`\nDone${apply ? '' : ' (dry run — re-run with --apply to write)'}.`);
}

main().catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
});
