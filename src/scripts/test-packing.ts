/**
 * Verification for the packing station grammar: line building from order
 * items, scan matching (strict variant / unambiguous product), quantity
 * accumulation, completion gating, queue derivation, and packing-slip
 * disambiguation.
 * Run: npx tsx src/scripts/test-packing.ts
 */

import assert from 'node:assert/strict';
import {
    buildPackingLines,
    buildWavePickList,
    decrementPackedItem,
    derivePackingQueue,
    findOrderBySlipScan,
    incompleteLines,
    incrementPackedItem,
    isSessionComplete,
    matchResolvedToLine,
    type PackingLine,
    type PackingSession,
    type PackedItemEntry,
} from '../lib/packing';
import type { OrderDetailItem } from '../lib/orders';
import type { ProductVariant } from '../lib/products';

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

console.log('packing');

// ---- fixtures ----

function makeVariant(id: string, parentSku: string, suffix: string): ProductVariant {
    return {
        id,
        product: 'prod_1',
        variant_name: suffix,
        sku_suffix: suffix,
        stock_level: 5,
        created: '',
        updated: '',
        expand: {
            product: { id: 'prod_1', sku: parentSku } as ProductVariant['expand'] extends { product?: infer P } ? P : never,
        },
    } as unknown as ProductVariant;
}

/**
 * Mirror the real PocketBase shape: the relation stays an id string and the
 * expanded records live under `expand` (the TS type lies about this).
 */
function makeItem(id: string, variant: ProductVariant | undefined, quantity: number, description?: string): OrderDetailItem {
    return {
        id,
        order: 'order_1',
        product: 'prod_1',
        variant: variant?.id,
        expand: variant ? { variant, product: variant.expand?.product } : undefined,
        description: description || (variant ? `${variant.expand?.product?.sku}-${variant.sku_suffix}` : 'Bare item'),
        quantity,
        unit_price: 1000,
        tax_rate: 3,
        discount_amount: 0,
        total: 1000 * quantity,
    } as unknown as OrderDetailItem;
}

const vRuby = makeVariant('var_ruby', 'TMPNECCHK04821', 'MGRBSTD');
const vEmerald = makeVariant('var_emerald', 'TMPNECCHK04821', 'MGEMSTD');
const vSize206 = makeVariant('var_206', 'TMPBAN206', '206');

function defaultLines(): PackingLine[] {
    return buildPackingLines([
        makeItem('item_1', vRuby, 1),
        makeItem('item_2', vEmerald, 2),
    ]);
}

// ---- buildPackingLines ----

test('lines compose the full variant SKU and carry the order quantity', () => {
    const lines = defaultLines();
    assert.equal(lines.length, 2);
    assert.equal(lines[0].sku, 'TMPNECCHK04821-MGRBSTD');
    assert.equal(lines[0].quantity, 1);
    assert.equal(lines[1].sku, 'TMPNECCHK04821-MGEMSTD');
    assert.equal(lines[1].quantity, 2);
    assert.equal(lines[0].variant_id, 'var_ruby');
    assert.equal(lines[0].product_id, 'prod_1');
});

test('an item without an expanded variant falls back to the description', () => {
    const lines = buildPackingLines([makeItem('item_x', undefined, 1, 'Custom loose piece')]);
    assert.equal(lines[0].sku, 'Custom loose piece');
    assert.equal(lines[0].variant_id, ''); // unresolvable line: only matched via product
    assert.equal(lines[0].product_id, 'prod_1');
});

test('a product SKU that already ends with the variant suffix is not duplicated', () => {
    // Quick Add writes the full child SKU onto the product record.
    const quickAddVariant = makeVariant('var_qa', 'TMPHARHAR00001-MGWHSTD', 'MGWHSTD');
    const lines = buildPackingLines([makeItem('item_qa', quickAddVariant, 1)]);
    assert.equal(lines[0].sku, 'TMPHARHAR00001-MGWHSTD');
});

// ---- matchResolvedToLine ----

test('a variant scan matches its line strictly', () => {
    const match = matchResolvedToLine({ variantId: 'var_ruby', productId: 'prod_1' }, defaultLines(), []);
    assert.equal(match.type, 'line');
    assert.equal(match.line?.item_id, 'item_1');
});

test('a variant not on the order is rejected as not_in_order', () => {
    const match = matchResolvedToLine({ variantId: 'var_206', productId: 'prod_1' }, defaultLines(), []);
    assert.equal(match.type, 'not_in_order');
});

test('a product-level tag matches a single-variant line but is ambiguous across variants', () => {
    const single = buildPackingLines([makeItem('item_3', vSize206, 1)]);
    assert.equal(matchResolvedToLine({ productId: 'prod_1' }, single, []).type, 'line');
    assert.equal(matchResolvedToLine({ productId: 'prod_1' }, defaultLines(), []).type, 'ambiguous');
});

test('no resolved identity at all is unknown', () => {
    assert.equal(matchResolvedToLine({}, defaultLines(), []).type, 'unknown');
});

test('a fully packed line reports already_complete instead of re-packing', () => {
    const lines = defaultLines();
    const packed: PackedItemEntry[] = [
        { item_id: 'item_1', variant_id: 'var_ruby', product_id: 'prod_1', sku: 'TMPNECCHK04821-MGRBSTD', packed_qty: 1, quantity: 1, scanned_at: '' },
    ];
    assert.equal(matchResolvedToLine({ variantId: 'var_ruby' }, lines, packed).type, 'already_complete');
    assert.equal(matchResolvedToLine({ variantId: 'var_emerald' }, lines, packed).type, 'line');
});

// ---- accumulation + completion ----

test('incrementPackedItem counts up to the line quantity without exceeding it', () => {
    const lines = defaultLines();
    let packed: PackedItemEntry[] = [];
    packed = incrementPackedItem(packed, lines[1], 't1');
    packed = incrementPackedItem(packed, lines[1], 't2');
    packed = incrementPackedItem(packed, lines[1], 't3'); // over-scan guard
    const entry = packed.find((row) => row.item_id === 'item_2');
    assert.equal(entry?.packed_qty, 2);
    assert.equal(entry?.scanned_at, 't2'); // last accepted scan stamps the time
});

test('completion requires every line at full quantity', () => {
    const lines = defaultLines();
    const packed: PackedItemEntry[] = [
        { item_id: 'item_1', variant_id: 'var_ruby', product_id: 'prod_1', sku: 's', packed_qty: 1, quantity: 1, scanned_at: '' },
        { item_id: 'item_2', variant_id: 'var_emerald', product_id: 'prod_1', sku: 's', packed_qty: 2, quantity: 2, scanned_at: '' },
    ];
    assert.equal(isSessionComplete(lines, packed), true);
    assert.deepEqual(incompleteLines(lines, packed), []);

    const short = packed.map((row) => (row.item_id === 'item_2' ? { ...row, packed_qty: 1 } : row));
    assert.equal(isSessionComplete(lines, short), false);
    assert.deepEqual(incompleteLines(lines, short).map((line) => line.item_id), ['item_2']);
});

test('an order with no items can never be complete', () => {
    assert.equal(isSessionComplete([], []), false);
});

// ---- queue derivation ----

function makeSession(orderId: string, status: PackingSession['status']): PackingSession {
    return {
        id: `sess_${orderId}`,
        account_email: 'a@b.c',
        order_id: orderId,
        order_number: `ORD-${orderId}`,
        status,
        packed_items: [],
    };
}

test('queue keeps confirmed+invoiced, splits completed sessions, ignores other statuses', () => {
    const orders = [
        { id: 'o1', order_number: 'ORD-1', customer_name: 'A', status: 'confirmed', order_date: '2026-01-03' },
        { id: 'o2', order_number: 'ORD-2', customer_name: 'B', status: 'invoiced', order_date: '2026-01-01' },
        { id: 'o3', order_number: 'ORD-3', customer_name: 'C', status: 'draft', order_date: '2026-01-02' },
        { id: 'o4', order_number: 'ORD-4', customer_name: 'D', status: 'shipped', order_date: '2026-01-02' },
        { id: 'o5', order_number: 'ORD-5', customer_name: 'E', status: 'delivered', order_date: '2026-01-02' },
        { id: 'o6', order_number: 'ORD-6', customer_name: 'F', status: 'cancelled', order_date: '2026-01-02' },
    ];
    const sessions = [makeSession('o2', 'completed'), makeSession('o1', 'in_progress')];
    const queue = derivePackingQueue(orders, sessions);

    assert.deepEqual(queue.toPack.map((order) => order.id), ['o1']); // o2 completed → other bucket
    assert.deepEqual(queue.packedAwaitingDispatch.map((order) => order.id), ['o2']);
    assert.equal(queue.toPack[0].packing_in_progress, true);
    assert.equal(queue.toPack[0].item_count, 0); // counts arrive from the IO layer
});

test('queue orders oldest first', () => {
    const orders = [
        { id: 'late', order_number: 'L', customer_name: 'x', status: 'confirmed', order_date: '2026-02-01' },
        { id: 'early', order_number: 'E', customer_name: 'y', status: 'confirmed', order_date: '2026-01-05' },
    ];
    const queue = derivePackingQueue(orders, []);
    assert.deepEqual(queue.toPack.map((order) => order.id), ['early', 'late']);
});

// ---- slip scan ----

test('a packing-slip scan resolves by exact order number, case-insensitively', () => {
    const queue = derivePackingQueue(
        [{ id: 'o1', order_number: 'ORD-260103-a1b2c3', customer_name: 'A', status: 'confirmed', order_date: '2026-01-03' }],
        []
    );
    const hit = findOrderBySlipScan('ord-260103-A1B2C3', queue);
    assert.equal(hit?.id, 'o1');
    assert.equal(findOrderBySlipScan('TMPNECCHK04821-MGRBSTD', queue), null);
    assert.equal(findOrderBySlipScan('', queue), null);
});

// ---- -1 undo decrement ----

test('decrementPackedItem decrements packed quantity by 1', () => {
    const line: PackingLine = {
        item_id: 'item_1',
        variant_id: 'var_ruby',
        product_id: 'prod_1',
        sku: 'TMPNECCHK04821-MGRBSTD',
        description: 'Ruby Choker',
        quantity: 3,
        location: 'Showcase Tray A',
    };

    let entries: PackedItemEntry[] = [
        {
            item_id: 'item_1',
            variant_id: 'var_ruby',
            product_id: 'prod_1',
            sku: 'TMPNECCHK04821-MGRBSTD',
            packed_qty: 2,
            quantity: 3,
            scanned_at: new Date().toISOString(),
        },
    ];

    entries = decrementPackedItem(entries, line);
    assert.equal(entries[0].packed_qty, 1);

    entries = decrementPackedItem(entries, line);
    assert.equal(entries[0].packed_qty, 0);

    // Decrementing when already 0 should not go negative
    entries = decrementPackedItem(entries, line);
    assert.equal(entries[0].packed_qty, 0);
});

// ---- Virtual Bundle explosion in buildPackingLines ----

test('buildPackingLines explodes a virtual bundle product into individual scannable lines', () => {
    const bundleProduct = {
        id: 'prod_bundle',
        sku: 'SET-BRIDAL-RUBY',
        name: 'Bridal Set Complete',
        is_bundle: true,
        bundle_items: [
            {
                variant_id: 'var_chok',
                product_id: 'prod_chok',
                sku: 'TMP-CHOK-01',
                name: 'Temple Choker',
                quantity: 1,
            },
            {
                variant_id: 'var_earr',
                product_id: 'prod_earr',
                sku: 'TMP-EARR-01',
                name: 'Temple Earring',
                quantity: 2,
            },
        ],
    };

    const bundleItem: OrderDetailItem = {
        id: 'order_item_bundle',
        order: 'order_1',
        product: 'prod_bundle',
        expand: {
            product: bundleProduct,
        },
        quantity: 2, // 2 complete bridal sets ordered!
        unit_price: 3500,
        tax_rate: 3,
        discount_amount: 0,
        total: 7000,
    } as unknown as OrderDetailItem;

    const lines = buildPackingLines([bundleItem]);
    assert.equal(lines.length, 2);

    // Choker: 1 per set * 2 sets = 2
    assert.equal(lines[0].sku, 'TMP-CHOK-01');
    assert.equal(lines[0].quantity, 2);
    assert.equal(lines[0].bundle_parent_sku, 'SET-BRIDAL-RUBY');

    // Earring: 2 per set * 2 sets = 4
    assert.equal(lines[1].sku, 'TMP-EARR-01');
    assert.equal(lines[1].quantity, 4);
    assert.equal(lines[1].bundle_parent_sku, 'SET-BRIDAL-RUBY');
});

// ---- Wave Pick List aggregation ----

test('buildWavePickList aggregates items by storage location across multiple orders', () => {
    const orders = [
        { id: 'ord_1', order_number: 'ORD-101', customer_name: 'Priya', status: 'confirmed', total: 1000, item_count: 2 },
        { id: 'ord_2', order_number: 'ORD-102', customer_name: 'Ananya', status: 'confirmed', total: 1500, item_count: 3 },
    ];

    const linesOrd1: PackingLine[] = [
        { item_id: '1_1', variant_id: 'v1', product_id: 'p1', sku: 'TMP-CHOK-01', description: 'Choker', quantity: 1, location: 'Showcase Tray A' },
        { item_id: '1_2', variant_id: 'v2', product_id: 'p2', sku: 'BAN-GOLD-206', description: 'Bangle', quantity: 2, location: 'Safe Vault 1' },
    ];

    const linesOrd2: PackingLine[] = [
        { item_id: '2_1', variant_id: 'v1', product_id: 'p1', sku: 'TMP-CHOK-01', description: 'Choker', quantity: 2, location: 'Showcase Tray A' },
        { item_id: '2_2', variant_id: 'v3', product_id: 'p3', sku: 'KND-EARR-01', description: 'Earring', quantity: 1, location: 'Showcase Tray A' },
    ];

    const orderLinesMap = new Map<string, PackingLine[]>([
        ['ord_1', linesOrd1],
        ['ord_2', linesOrd2],
    ]);

    const wave = buildWavePickList(orders, orderLinesMap);
    assert.equal(wave.length, 2); // Safe Vault 1 & Showcase Tray A

    const trayA = wave.find(g => g.location === 'Showcase Tray A');
    assert.ok(trayA);
    assert.equal(trayA.items.length, 2);

    const chokerPick = trayA.items.find(i => i.sku === 'TMP-CHOK-01');
    assert.ok(chokerPick);
    // 1 from ord_1 + 2 from ord_2 = 3 total
    assert.equal(chokerPick.totalQuantity, 3);
    assert.equal(chokerPick.orders.length, 2);

    const vault = wave.find(g => g.location === 'Safe Vault 1');
    assert.ok(vault);
    assert.equal(vault.items[0].totalQuantity, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
