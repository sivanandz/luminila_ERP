/**
 * Verification for POS sale quantity validation (D-18).
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { validateSaleQuantities } from '../lib/pos-sales';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
