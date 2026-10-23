/**
 * Verification for the return quantity policy (src/lib/returns-policy.ts).
 *
 * Run: npx tsx src/scripts/test-returns-policy.ts
 */

import assert from 'node:assert/strict';
import { validateReturnQuantities, type ReturnableLine } from '../lib/returns-policy';

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

function line(partial: Partial<ReturnableLine>): ReturnableLine {
    return {
        invoiceItemId: 'item-1',
        description: 'Gold Ring',
        ordered: 2,
        alreadyReturned: 0,
        requested: 1,
        ...partial,
    };
}

console.log('returns-policy');

test('a first partial return is allowed', () => {
    const result = validateReturnQuantities([line({ ordered: 2, requested: 1 })]);
    assert.equal(result.ok, true);
    assert.equal(result.remaining['item-1'], 2);
});

test('returning the full line once is allowed', () => {
    const result = validateReturnQuantities([line({ ordered: 2, requested: 2 })]);
    assert.equal(result.ok, true);
});

test('a second return is capped by the first', () => {
    const result = validateReturnQuantities([line({ ordered: 2, alreadyReturned: 1, requested: 2 })]);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /only 1 of 2 remain returnable/);
});

test('the exact remainder is allowed', () => {
    const result = validateReturnQuantities([line({ ordered: 3, alreadyReturned: 2, requested: 1 })]);
    assert.equal(result.ok, true);
});

test('a line that is fully returned cannot be returned again', () => {
    const result = validateReturnQuantities([line({ ordered: 1, alreadyReturned: 1, requested: 1 })]);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /only 0 of 1 remain/);
});

test('zero and negative quantities are rejected', () => {
    for (const requested of [0, -1]) {
        const result = validateReturnQuantities([line({ requested })]);
        assert.equal(result.ok, false);
        assert.match(result.errors.join(' '), /greater than zero/);
    }
});

test('fractional quantities are rejected', () => {
    const result = validateReturnQuantities([line({ ordered: 2, requested: 1.5 })]);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /whole number/);
});

test('an empty return is rejected', () => {
    assert.equal(validateReturnQuantities([]).ok, false);
});

test('each line is validated independently', () => {
    const result = validateReturnQuantities([
        line({ invoiceItemId: 'a', ordered: 2, requested: 2 }),
        line({ invoiceItemId: 'b', ordered: 1, alreadyReturned: 1, requested: 1 }),
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.remaining['a'], 2);
    assert.equal(result.remaining['b'], 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
