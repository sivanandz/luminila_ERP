/**
 * Verification for the imitation jewellery taxonomy and wholesale tiers.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import {
    calculateWholesalePrice,
    formatImitationSpec,
    generateDumbbellTagPayload,
    PLATING_DEFINITIONS,
    type ImitationSpecInput,
} from '../lib/imitation-jewelry-engine';

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

const spec: ImitationSpecInput = {
    craft: 'kundan',
    plating: 'micro_gold_1gm',
    occasion: 'bridal',
    baseMetal: 'brass',
    stoneType: 'Kundan stones',
    sku: 'IM-001',
    name: 'Bridal Choker Set',
    mrpPrice: 2499,
};

console.log('imitation');

test('the spec line uses human labels in a stable order', () => {
    assert.equal(
        formatImitationSpec(spec),
        'Kundan Jadau | 1-Gram Micro Gold | Brass Alloy | Bridal Trousseau'
    );
});

test('an empty spec still produces a label', () => {
    assert.equal(formatImitationSpec({}), 'Fashion Jewelry');
});

test('unknown values pass through instead of disappearing', () => {
    assert.equal(formatImitationSpec({ craft: 'origami' }), 'origami');
});

test('the tag carries craft and plating codes plus the MRP', () => {
    const tag = generateDumbbellTagPayload(spec);
    assert.equal(tag.wingB.badge, 'KND-1MG');
    assert.equal(tag.wingA.sku, 'IM-001');
    assert.equal(tag.wingA.mrp, '₹2499');
    assert.match(tag.printableBadge, /KND-1MG \| IM-001/);
});

test('plating durability is part of the taxonomy', () => {
    assert.equal(PLATING_DEFINITIONS.micro_gold_1gm.durabilityMonths, 18);
    assert.equal(PLATING_DEFINITIONS.oxidized_antique.durabilityMonths, 36);
});

test('wholesale tiers apply by quantity', () => {
    assert.equal(calculateWholesalePrice(1000, 1).discountPercentApplied, 0);
    assert.equal(calculateWholesalePrice(1000, 10).discountPercentApplied, 15);
    assert.equal(calculateWholesalePrice(1000, 30).discountPercentApplied, 25);
    assert.equal(calculateWholesalePrice(1000, 50).discountPercentApplied, 35);
});

test('tier pricing rounds and reports savings', () => {
    const priced = calculateWholesalePrice(999, 10);
    assert.equal(priced.unitPrice, 849.15);
    assert.equal(priced.totalAmount, 8491.5);
    assert.equal(priced.totalSavings, 1498.5);
});

test('impossible quantities are clamped, not crashed', () => {
    const priced = calculateWholesalePrice(500, 0);
    assert.equal(priced.discountPercentApplied, 0);
    assert.equal(priced.totalAmount, 500);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
