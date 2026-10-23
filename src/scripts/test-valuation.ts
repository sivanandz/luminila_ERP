/**
 * Verification for landed-cost allocation.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { allocateLandedCosts, summariseLanded, weightedAverageCost } from '../lib/valuation';

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

console.log('valuation');

test('overhead is allocated by line value', () => {
    const lines = allocateLandedCosts([
        { key: 'a', quantity: 1, unitCost: 100 },
        { key: 'b', quantity: 1, unitCost: 300 },
    ], 40);

    assert.equal(lines[0].allocatedOverhead, 10);
    assert.equal(lines[1].allocatedOverhead, 30);
    assert.equal(lines[0].landedUnitCost, 110);
    assert.equal(lines[1].landedUnitCost, 330);
});

test('zero or negative overhead leaves unit cost unchanged', () => {
    const lines = allocateLandedCosts([
        { key: 'a', quantity: 2, unitCost: 250 },
    ], -50);
    assert.equal(lines[0].landedUnitCost, 250);
    assert.equal(lines[0].allocatedOverhead, 0);
});

test('rounding remains exact to the paise', () => {
    const lines = allocateLandedCosts([
        { key: 'a', quantity: 1, unitCost: 100 },
        { key: 'b', quantity: 1, unitCost: 100 },
        { key: 'c', quantity: 1, unitCost: 100 },
    ], 10);

    const totalAllocated = lines.reduce((sum, line) => sum + line.allocatedOverhead, 0);
    assert.equal(Math.round(totalAllocated * 100), 1000);
});

test('overhead divides across the quantity of each line', () => {
    const lines = allocateLandedCosts([
        { key: 'a', quantity: 2, unitCost: 500 },
    ], 100);
    assert.equal(lines[0].landedUnitCost, 550);
});

test('lines with no quantity never absorb overhead', () => {
    const lines = allocateLandedCosts([
        { key: 'a', quantity: 0, unitCost: 900 },
        { key: 'b', quantity: 1, unitCost: 100 },
    ], 10);

    assert.equal(lines[0].allocatedOverhead, 0);
    assert.equal(lines[0].landedUnitCost, 900);
    assert.equal(lines[1].allocatedOverhead, 10);
    assert.equal(lines[1].landedUnitCost, 110);
});

test('free goods still absorb overhead by quantity', () => {
    const lines = allocateLandedCosts([
        { key: 'a', quantity: 1, unitCost: 0 },
        { key: 'b', quantity: 1, unitCost: 0 },
    ], 10);

    assert.equal(lines[0].allocatedOverhead + lines[1].allocatedOverhead, 10);
    assert.equal(lines[0].landedUnitCost, 5);
    assert.equal(lines[1].landedUnitCost, 5);
});

test('the summary reconciles goods value plus overhead', () => {
    const lines = allocateLandedCosts([
        { key: 'a', quantity: 2, unitCost: 100 },
        { key: 'b', quantity: 1, unitCost: 300 },
    ], 50);

    const summary = summariseLanded(lines);
    assert.equal(summary.totalUnits, 3);
    assert.equal(summary.goodsValue, 500);
    assert.equal(Math.round(summary.allocatedOverhead * 100), 5000);
    assert.equal(Math.round(summary.landedValue * 100), 55000);
});

test('weighted average lets quantity, not the newest receipt, decide value', () => {
    assert.equal(weightedAverageCost([
        { quantity: 10, landedUnitCost: 110 },
        { quantity: 10, landedUnitCost: 130 },
    ]), 120);

    assert.equal(weightedAverageCost([
        { quantity: 1, landedUnitCost: 100 },
        { quantity: 9, landedUnitCost: 200 },
    ]), 190);
});

test('no receipts or zero quantities yield zero, not a division error', () => {
    assert.equal(weightedAverageCost([]), 0);
    assert.equal(weightedAverageCost([{ quantity: 0, landedUnitCost: 500 }]), 0);
});

test('negative quantities are ignored', () => {
    assert.equal(weightedAverageCost([
        { quantity: -5, landedUnitCost: 999 },
        { quantity: 2, landedUnitCost: 50 },
    ]), 50);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
