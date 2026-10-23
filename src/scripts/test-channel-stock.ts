/**
 * Verification for the unified channel stock service.
 * Run: npx tsx src/scripts/test-channel-stock.ts
 */

import assert from 'node:assert/strict';
import {
    applyChannelStock,
    assertStockAvailable,
    InsufficientStockError,
    restoreChannelStockForReference,
    resolveStockTargets,
    StockTenantMismatchError,
    VariantMismatchError,
    VariantRequiredError,
    type StockDb,
} from '../lib/channel-stock';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
    try {
        await fn();
        passed += 1;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(`        ${error instanceof Error ? error.message : String(error)}`);
    }
}

const TENANT = 'ops@example.com';

interface Row {
    id: string;
    [key: string]: unknown;
}

class FakeDb implements StockDb {
    products = new Map<string, Row>();
    variants = new Map<string, Row>();
    movements: Row[] = [];
    failMovementCreate = false;

    collection(name: string) {
        const map =
            name === 'products' ? this.products :
            name === 'product_variants' ? this.variants :
            null;

        return {
            getOne: async <T,>(id: string): Promise<T> => {
                if (!map) throw new Error(`unexpected collection ${name}`);
                const row = map.get(id);
                if (!row) throw new Error('404');
                return row as T;
            },
            update: async <T,>(id: string, body: Record<string, unknown>): Promise<T> => {
                if (!map) throw new Error(`unexpected collection ${name}`);
                const row = map.get(id);
                if (!row) throw new Error('404');
                for (const [key, value] of Object.entries(body)) {
                    if (key === 'stock_level-') {
                        const next = Number(row.stock_level ?? 0) - Number(value);
                        if (next < 0) throw new Error('validation_min_number_constraint');
                        row.stock_level = next;
                    } else if (key === 'stock_level+') {
                        row.stock_level = Number(row.stock_level ?? 0) + Number(value);
                    } else {
                        row[key] = value;
                    }
                }
                return row as T;
            },
            create: async <T,>(body: Record<string, unknown>): Promise<T> => {
                if (name !== 'stock_movements') throw new Error(`unexpected create on ${name}`);
                if (this.failMovementCreate) throw new Error('movement write failed');
                const row = { id: `move${this.movements.length + 1}`, ...body };
                this.movements.push(row);
                return row as T;
            },
            delete: async (id: string): Promise<void> => {
                this.movements = this.movements.filter((row) => row.id !== id);
            },
            getFullList: async <T,>(options?: Record<string, unknown>): Promise<T[]> => {
                const filter = String(options?.filter || '');
                if (map) {
                    const rows = [...map.values()];
                    const productMatch = filter.match(/product="([^"]+)"/);
                    if (productMatch) return rows.filter((row) => row.product === productMatch[1]) as T[];
                    return rows as T[];
                }
                const movementRows = this.movements.filter((row) => {
                    const ref = filter.match(/reference_id="([^"]+)"/);
                    const source = filter.match(/source="([^"]+)"/);
                    const type = filter.match(/movement_type="([^"]+)"/);
                    return (
                        (!ref || row.reference_id === ref[1]) &&
                        (!source || row.source === source[1]) &&
                        (!type || row.movement_type === type[1])
                    );
                });
                return movementRows as T[];
            },
        };
    }

    addProduct(id: string, stockLevel: number, extra: Partial<Row> = {}) {
        this.products.set(id, { id, name: `Product ${id}`, stock_level: stockLevel, account_email: TENANT, ...extra });
        return this;
    }

    addVariant(id: string, product: string, stockLevel: number) {
        this.variants.set(id, { id, product, stock_level: stockLevel });
        return this;
    }
}

async function main() {
    console.log('channel-stock');

    await test('explicit variant resolves to itself', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 5).addVariant('var000000000001', 'prod00000000001', 5);
        const [target] = await resolveStockTargets(db, [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 1 }], { accountEmail: TENANT });
        assert.equal(target.kind, 'variant');
        assert.equal(target.id, 'var000000000001');
        assert.equal(target.stockLevel, 5);
    });

    await test('a single variant is chosen automatically', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 3);
        const [target] = await resolveStockTargets(db, [{ productId: 'prod00000000001', quantity: 2 }], { accountEmail: TENANT });
        assert.equal(target.kind, 'variant');
        assert.equal(target.id, 'var000000000001');
    });

    await test('ambiguous multi-variant products refuse to guess', async () => {
        const db = new FakeDb()
            .addProduct('prod00000000001', 0)
            .addVariant('var000000000001', 'prod00000000001', 2)
            .addVariant('var000000000002', 'prod00000000001', 2);
        await assert.rejects(
            () => resolveStockTargets(db, [{ productId: 'prod00000000001', quantity: 1 }], { accountEmail: TENANT }),
            (error: unknown) => error instanceof VariantRequiredError
        );
    });

    await test('legacy products without variants fall back to product-level stock', async () => {
        const db = new FakeDb().addProduct('prod00000000002', 4);
        const [target] = await resolveStockTargets(db, [{ productId: 'prod00000000002', quantity: 1 }], { accountEmail: TENANT });
        assert.equal(target.kind, 'product');
        assert.equal(target.id, 'prod00000000002');
    });

    await test('a variant from another product is rejected', async () => {
        const db = new FakeDb()
            .addProduct('prod00000000001', 0).addVariant('var000000000009', 'prod00000000002', 5)
            .addProduct('prod00000000002', 0);
        await assert.rejects(
            () => resolveStockTargets(db, [{ productId: 'prod00000000001', variantId: 'var000000000009', quantity: 1 }], { accountEmail: TENANT }),
            (error: unknown) => error instanceof VariantMismatchError
        );
    });

    await test('another tenant\'s product is rejected', async () => {
        const db = new FakeDb().addProduct('prod00000000003', 4, { account_email: 'other@example.com' });
        await assert.rejects(
            () => resolveStockTargets(db, [{ productId: 'prod00000000003', quantity: 1 }], { accountEmail: TENANT }),
            (error: unknown) => error instanceof StockTenantMismatchError
        );
    });

    await test('availability reports shortages without writing', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 1);
        const result = await assertStockAvailable(db, [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 3 }], { accountEmail: TENANT });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.shortages[0].available, 1);
        assert.equal(db.variants.get('var000000000001')?.stock_level, 1);
        assert.equal(db.movements.length, 0);
    });

    await test('apply decrements stock and writes the channel ledger row', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 5);
        const result = await applyChannelStock(
            db,
            [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 2 }],
            { accountEmail: TENANT, channel: 'storefront', referenceId: 'ord123456789012' }
        );
        assert.equal(db.variants.get('var000000000001')?.stock_level, 3);
        assert.equal(db.movements.length, 1);
        assert.equal(db.movements[0].source, 'storefront');
        assert.equal(db.movements[0].movement_type, 'sale');
        assert.equal(db.movements[0].quantity, -2);
        assert.equal(db.movements[0].reference_id, 'ord123456789012');
        assert.equal(result.movementIds.length, 1);
    });

    await test('insufficient stock throws and leaves the count untouched', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 1);
        await assert.rejects(
            () => applyChannelStock(db, [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 2 }], { accountEmail: TENANT, channel: 'whatsapp', referenceId: 'ord123456789012' }),
            (error: unknown) => error instanceof InsufficientStockError
        );
        assert.equal(db.variants.get('var000000000001')?.stock_level, 1);
        assert.equal(db.movements.length, 0);
    });

    await test('a failed later line rolls the earlier lines back', async () => {
        const db = new FakeDb()
            .addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 5)
            .addProduct('prod00000000002', 0).addVariant('var000000000002', 'prod00000000002', 1);
        await assert.rejects(
            () => applyChannelStock(
                db,
                [
                    { productId: 'prod00000000001', variantId: 'var000000000001', quantity: 2 },
                    { productId: 'prod00000000002', variantId: 'var000000000002', quantity: 4 },
                ],
                { accountEmail: TENANT, channel: 'pos', referenceId: 'ord123456789013' }
            ),
            (error: unknown) => error instanceof InsufficientStockError
        );
        assert.equal(db.variants.get('var000000000001')?.stock_level, 5, 'first line must be compensated');
        assert.equal(db.variants.get('var000000000002')?.stock_level, 1);
        assert.equal(db.movements.length, 0);
    });

    await test('a ledger failure restores the decrement', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 5);
        db.failMovementCreate = true;
        await assert.rejects(
            () => applyChannelStock(db, [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 2 }], { accountEmail: TENANT, channel: 'storefront', referenceId: 'ord123456789014' })
        );
        assert.equal(db.variants.get('var000000000001')?.stock_level, 5);
    });

    await test('cancellation restores stock once and reverses the ledger', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 5);
        await applyChannelStock(
            db,
            [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 2 }],
            { accountEmail: TENANT, channel: 'whatsapp', referenceId: 'ord123456789015' }
        );
        const first = await restoreChannelStockForReference(db, { referenceId: 'ord123456789015', channel: 'whatsapp' });
        assert.deepEqual(first, { restored: 1, alreadyRestored: false });
        assert.equal(db.variants.get('var000000000001')?.stock_level, 5);
        assert.equal(db.movements.filter((m) => m.movement_type === 'return').length, 1);

        const second = await restoreChannelStockForReference(db, { referenceId: 'ord123456789015', channel: 'whatsapp' });
        assert.deepEqual(second, { restored: 0, alreadyRestored: true });
        assert.equal(db.variants.get('var000000000001')?.stock_level, 5);
    });

    await test('clamp settles a paid order at the available stock', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 2);
        const result = await applyChannelStock(
            db,
            [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 5 }],
            { accountEmail: TENANT, channel: 'storefront', referenceId: 'ord123456789016', oversell: 'clamp' }
        );
        assert.equal(db.variants.get('var000000000001')?.stock_level, 0);
        assert.equal(db.movements.length, 1);
        assert.equal(db.movements[0].quantity, -2);
        assert.equal(result.shortages.length, 1);
        assert.deepEqual(result.shortages[0], {
            productId: 'prod00000000001',
            variantId: 'var000000000001',
            name: 'Product prod00000000001',
            requested: 5,
            available: 2,
        });
    });

    await test('clamp records the shortfall when nothing is left', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 0);
        const result = await applyChannelStock(
            db,
            [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 1 }],
            { accountEmail: TENANT, channel: 'storefront', referenceId: 'ord123456789017', oversell: 'clamp' }
        );
        assert.equal(db.variants.get('var000000000001')?.stock_level, 0);
        assert.equal(db.movements.length, 0);
        assert.equal(result.shortages.length, 1);
        assert.equal(result.shortages[0].available, 0);
    });

    await test('reject mode never silently clamps', async () => {
        const db = new FakeDb().addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 2);
        await assert.rejects(
            () => applyChannelStock(db, [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 5 }], { accountEmail: TENANT, channel: 'whatsapp', referenceId: 'ord123456789018' }),
            (error: unknown) => error instanceof InsufficientStockError
        );
        assert.equal(db.variants.get('var000000000001')?.stock_level, 2);
    });

    await test('an empty account email skips the tenant gate (desktop path)', async () => {
        const db = new FakeDb().addProduct('prod00000000004', 3, { account_email: 'tenant@example.com' });
        const [target] = await resolveStockTargets(db, [{ productId: 'prod00000000004', quantity: 1 }], { accountEmail: '' });
        assert.equal(target.kind, 'product');
        assert.equal(target.stockLevel, 3);
    });

    await test('cancellation without a channel restores every source for the order', async () => {
        const db = new FakeDb()
            .addProduct('prod00000000001', 0).addVariant('var000000000001', 'prod00000000001', 5)
            .addProduct('prod00000000002', 0).addVariant('var000000000002', 'prod00000000002', 5);
        await applyChannelStock(db, [{ productId: 'prod00000000001', variantId: 'var000000000001', quantity: 2 }], {
            accountEmail: TENANT, channel: 'storefront', referenceId: 'ord123456789019',
        });
        await applyChannelStock(db, [{ productId: 'prod00000000002', variantId: 'var000000000002', quantity: 1 }], {
            accountEmail: TENANT, channel: 'whatsapp', referenceId: 'ord123456789019',
        });
        const result = await restoreChannelStockForReference(db, { referenceId: 'ord123456789019' });
        assert.deepEqual(result, { restored: 2, alreadyRestored: false });
        assert.equal(db.variants.get('var000000000001')?.stock_level, 5);
        assert.equal(db.variants.get('var000000000002')?.stock_level, 5);
        const second = await restoreChannelStockForReference(db, { referenceId: 'ord123456789019' });
        assert.equal(second.alreadyRestored, true);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

void main();
