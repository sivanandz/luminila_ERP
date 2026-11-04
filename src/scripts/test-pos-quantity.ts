/**
 * Verification for POS sale quantity validation (D-18).
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { validateSaleQuantities, validateSaleTotals } from '../lib/pos-sales';

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

console.log('pos-quantity');

test('positive quantities pass', () => {
    assert.equal(validateSaleQuantities([{ name: 'Ring', quantity: 1 }, { name: 'Chain', quantity: 2.5 }]), null);
});

test('a negative quantity is refused', () => {
    const error = validateSaleQuantities([{ name: 'Ring', quantity: -3 }]);
    assert.match(error || '', /Ring/);
});

test('zero and non-finite quantities are refused', () => {
    assert.ok(validateSaleQuantities([{ productId: 'p1', quantity: 0 }]));
    assert.ok(validateSaleQuantities([{ productId: 'p1', quantity: Number.NaN }]));
    assert.ok(validateSaleQuantities([{ productId: 'p1', quantity: Number.POSITIVE_INFINITY }]));
});

test('an empty cart has nothing to refuse', () => {
    assert.equal(validateSaleQuantities([]), null);
});

// P1: the header must reconcile with the lines; a tampered total is refused.
const lines = [{ name: 'Ring', price: 1250.5, quantity: 2 }];

test('a reconciled bill passes', () => {
    assert.equal(
        validateSaleTotals({
            items: lines,
            subtotal: 2501,
            discountPercent: 10,
            discountAmount: 250.1,
            loyaltyDiscount: 0,
            total: 2250.9,
        }),
        null
    );
});

test('a tampered total is refused', () => {
    const error = validateSaleTotals({
        items: lines,
        subtotal: 2501,
        discountPercent: 0,
        discountAmount: 0,
        loyaltyDiscount: 0,
        total: 1,
    });
    assert.match(error || '', /total/i);
});

test('a discount above 100% is refused', () => {
    assert.ok(validateSaleTotals({
        items: lines,
        subtotal: 2501,
        discountPercent: 150,
        discountAmount: 2501,
        loyaltyDiscount: 0,
        total: 0,
    }));
});

test('a loyalty discount larger than the discounted subtotal is refused', () => {
    assert.ok(validateSaleTotals({
        items: lines,
        subtotal: 2501,
        discountPercent: 0,
        discountAmount: 0,
        loyaltyDiscount: 3000,
        total: 0,
    }));
});

test('a fully discounted bill still balances', () => {
    assert.equal(
        validateSaleTotals({
            items: lines,
            subtotal: 2501,
            discountPercent: 100,
            discountAmount: 2501,
            loyaltyDiscount: 0,
            total: 0,
        }),
        null
    );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
