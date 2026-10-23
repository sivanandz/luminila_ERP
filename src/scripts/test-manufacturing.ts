/**
 * Verification for karigar job costing.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { computeKarigarJobCost, nextJobNumber, type KarigarJobInput, type KarigarJobRecord } from '../lib/manufacturing-jobs';

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

const base: KarigarJobInput = {
    karigarName: 'Ramesh Soni',
    productName: 'Gold Ring',
    metalGrams: 10,
    purityKarat: '22K',
    ratePerGram: 6000,
    finishedNetGrams: 9.5,
    scrapGrams: 0.4,
    labour: 2000,
    hallmarking: 500,
    finishing: 300,
    logistics: 200,
    certification: 100,
    tolerancePercent: 1,
};

console.log('manufacturing');

test('raw material cost is grams times rate', () => {
    const cost = computeKarigarJobCost(base);
    assert.equal(cost.rawMaterialCost, 60000);
});

test('additional costs sum the five charge heads', () => {
    const cost = computeKarigarJobCost(base);
    assert.equal(cost.additionalCosts, 3100);
    assert.equal(cost.grossProductionCost, 63100);
});

test('scrap credit reduces the net cost and sets a per-gram rate', () => {
    const cost = computeKarigarJobCost(base);
    assert.equal(cost.scrapCredit, 2400);
    assert.equal(cost.netProductionCost, 60700);
    assert.equal(cost.perGramCost, 6389.47);
});

test('metal loss inside tolerance reconciles cleanly', () => {
    const cost = computeKarigarJobCost(base);
    assert.equal(cost.reconciliation.totalInputMetalGrams, 10);
    assert.equal(cost.reconciliation.unrecoveredMeltingLossGrams, 0.1);
    assert.equal(cost.reconciliation.varianceGrams, 0);
    assert.equal(cost.reconciliation.isWithinTolerance, true);
});

test('excess loss beyond tolerance is flagged', () => {
    const cost = computeKarigarJobCost({ ...base, finishedNetGrams: 9.35, scrapGrams: 0.4 });
    assert.equal(cost.reconciliation.unrecoveredMeltingLossGrams, 0.25);
    assert.equal(cost.reconciliation.varianceGrams, 0.15);
    assert.equal(cost.reconciliation.isWithinTolerance, false);
});

test('zero finished weight does not divide by zero', () => {
    const cost = computeKarigarJobCost({ ...base, finishedNetGrams: 0 });
    assert.equal(cost.perGramCost, 0);
});

test('job numbers are sequential per day', () => {
    const existing = [
        { jobNumber: 'MJ-20261023-001' },
        { jobNumber: 'MJ-20261023-002' },
        { jobNumber: 'MJ-20261022-001' },
    ] as KarigarJobRecord[];
    assert.equal(nextJobNumber(existing, new Date(2026, 9, 23)), 'MJ-20261023-003');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
