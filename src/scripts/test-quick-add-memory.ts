/**
 * Verification for the Quick Add series memory: series identity (colour
 * excluded), recent-stack upsert ordering, architecture SKU recovery for
 * clones, and the auto piece name.
 * Run: npx tsx src/scripts/test-quick-add-memory.ts
 */

import assert from 'node:assert/strict';
import {
    autoPieceName,
    getQuickAddMemory,
    getDefaultSeriesEntry,
    rememberQuickAdd,
    seriesKeyOf,
    taxonomyFromProduct,
    COLOR_SWATCHES,
} from '../lib/quick-add-memory';
import { getDefaultTaxonomies } from '../lib/sku-generator';

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

const taxonomies = getDefaultTaxonomies();

function makeEntry(overrides: Partial<ReturnType<typeof getDefaultSeriesEntry>> = {}) {
    return { ...getDefaultSeriesEntry(), ...overrides };
}

console.log('quick-add-memory');

test('series identity ignores colour, the per-piece level', () => {
    const ruby = makeEntry({ skuColor: 'RB' });
    const emerald = makeEntry({ skuColor: 'EM' });
    assert.equal(seriesKeyOf(ruby), seriesKeyOf(emerald));
    assert.notEqual(seriesKeyOf(ruby), seriesKeyOf(makeEntry({ skuSubcat: 'JHU' })));
});

test('a colour-run upserts one series entry instead of stacking chips', () => {
    const before = getQuickAddMemory().recent.length;
    rememberQuickAdd(makeEntry({ skuColor: 'RB' }));
    rememberQuickAdd(makeEntry({ skuColor: 'EM' }));
    rememberQuickAdd(makeEntry({ skuColor: 'PK' }));
    const after = getQuickAddMemory();
    // Net gain is exactly one entry; the front entry carries the last colour.
    assert.equal(after.recent.length, Math.min(before + 1, 5));
    assert.equal(after.last?.skuColor, 'PK');
});

test('a different series pushes the previous one down the stack', () => {
    rememberQuickAdd(makeEntry({ skuGenre: 'TMP', skuCategory: 'NEC', skuSubcat: 'CHK' }));
    rememberQuickAdd(makeEntry({ skuGenre: 'KUN', skuCategory: 'EAR', skuSubcat: 'JHU' }));
    const recent = getQuickAddMemory().recent;
    assert.equal(recent[0].skuGenre, 'KUN');
    assert.ok(recent.slice(1).some((entry) => entry.skuGenre === 'TMP'));
});

test('architecture child SKUs recover every code exactly', () => {
    const { taxonomy, fromArchitectureSku } = taxonomyFromProduct(
        {
            sku: 'TMPNECCHK04821-MGRBSTD',
            name: 'Temple Necklaces Choker',
            category: 'Necklaces',
        },
        taxonomies
    );
    assert.equal(fromArchitectureSku, true);
    assert.equal(taxonomy.skuGenre, 'TMP');
    assert.equal(taxonomy.skuCategory, 'NEC');
    assert.equal(taxonomy.skuSubcat, 'CHK');
    assert.equal(taxonomy.skuPlating, 'MG');
    assert.equal(taxonomy.skuColor, 'RB');
    assert.equal(taxonomy.skuSize, 'STD');
    assert.equal(taxonomy.categoryName, 'Necklaces');
});

test('wholesale suffix SKUs also recover the packaging tier', () => {
    const { taxonomy, fromArchitectureSku } = taxonomyFromProduct(
        { sku: 'KUNEARJHU00003-RHEM16I-C12', name: 'Kundan Jhumka', category: 'Earrings' },
        taxonomies
    );
    assert.equal(fromArchitectureSku, true);
    assert.equal(taxonomy.skuPackagingTier, 'C12');
    assert.equal(taxonomy.skuColor, 'EM');
    assert.equal(taxonomy.skuSize, '16I');
});

test('simple SKUs fall back to category label matching', () => {
    const { taxonomy, fromArchitectureSku } = taxonomyFromProduct(
        { sku: 'EAR-0001', name: 'Jhumka', category: 'Earrings' },
        taxonomies
    );
    assert.equal(fromArchitectureSku, false);
    assert.equal(taxonomy.skuCategory, 'EAR');
    assert.equal(taxonomy.categoryName, 'Earrings');
});

test('unmatchable categories degrade to General without throwing', () => {
    const { taxonomy } = taxonomyFromProduct(
        { sku: 'XYZ-0042', name: 'Odd piece', category: 'Completely Unknown' },
        taxonomies
    );
    assert.equal(taxonomy.skuCategory, 'GEN');
});

test('auto piece name joins genre, category and subcategory labels', () => {
    assert.equal(
        autoPieceName(taxonomies, { skuGenre: 'TMP', skuCategory: 'NEC', skuSubcat: 'CHK' }),
        'Temple Necklaces Choker'
    );
});

test('General series produces no auto name (merchant must type one)', () => {
    assert.equal(
        autoPieceName(taxonomies, { skuGenre: 'GEN', skuCategory: 'GEN', skuSubcat: 'GEN' }),
        ''
    );
});

test('every default colour has a display swatch', () => {
    for (const color of taxonomies.colors) {
        assert.ok(
            COLOR_SWATCHES[color.code],
            `missing swatch for default colour ${color.code}`
        );
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
