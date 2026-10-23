/**
 * Verification for backup validation and preview helpers.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import {
    isBackupOlderThan,
    summariseBackup,
    validateBackup,
    type BackupData,
} from '../lib/backup';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
        passed += 1;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(`        ${error instanceof Error ? error.message : String(error)}`);
    }
}

function makeBackup(): BackupData {
    return {
        version: '1.0.0',
        createdAt: '2026-10-20T10:00:00.000Z',
        tables: {
            customers: [{ id: 'c1' }, { id: 'c2' }],
            products: [{ id: 'p1' }],
            product_variants: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
            vendors: [],
            sales: [{ id: 's1' }],
            sale_items: [{ id: 'si1' }],
            stock_movements: [{ id: 'm1' }, { id: 'm2' }],
        },
    };
}

console.log('backup');

test('a well-formed backup passes validation', () => {
    assert.equal(validateBackup(makeBackup()), true);
});

test('missing required tables fail validation', () => {
    const broken = makeBackup() as unknown as { tables: Record<string, unknown> };
    delete broken.tables.products;
    assert.equal(validateBackup(broken), false);
});

test('non-array tables fail validation', () => {
    const broken = makeBackup() as unknown as { tables: Record<string, unknown> };
    broken.tables.sales = 'not-an-array';
    assert.equal(validateBackup(broken), false);
});

test('the summary counts rows and totals them', () => {
    const summary = summariseBackup(makeBackup());
    assert.equal(summary.totalRows, 10);
    assert.deepEqual(summary.tables[0], { name: 'product_variants', rows: 3 });
    assert.equal(summary.tables.find((table) => table.name === 'vendors')?.rows, 0);
});

test('an old backup is flagged, a fresh one is not', () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    assert.equal(isBackupOlderThan('2026-10-20T10:00:00.000Z', 2, now), true);
    assert.equal(isBackupOlderThan('2026-10-22T10:00:00.000Z', 2, now), false);
});

test('an unparseable date is treated as stale', () => {
    assert.equal(isBackupOlderThan('not-a-date', 1), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
