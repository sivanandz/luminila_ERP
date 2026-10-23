/**
 * Verification for the invoice tax math (src/lib/invoice-math.ts).
 *
 * Run: npx tsx src/scripts/test-invoice-math.ts
 *
 * These are the invariants the POS, invoice, and order paths now rely on:
 * tax is derived from the amount actually collected, discount allocation is
 * exact to the paise, and every line result adds back to its own total.
 */

import assert from 'node:assert/strict';
import {
    allocateDiscountPaise,
    computeInclusiveLines,
    includedTaxPaise,
    resolveLineGstRate,
    splitExclusiveLine,
    splitInclusiveLine,
    toPaise,
    toRupees,
} from '../lib/invoice-math';

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

console.log('invoice-math');

test('inclusive split keeps taxable + tax equal to the total', () => {
    for (const total of [100, 1999, 33333, 100000, 379700]) {
        for (const rate of [0, 0.25, 3, 5, 18]) {
            const r = splitInclusiveLine(total, rate, '27', '27');
            assert.equal(r.taxablePaise + r.taxPaise, r.totalPaise, `total=${total} rate=${rate}`);
            assert.equal(r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise, r.taxPaise);
            assert.equal(r.totalPaise, total);
        }
    }
});

test('intra-state splits into two equal halves without losing a paise', () => {
    const r = splitInclusiveLine(10000, 3, '27', '27');
    assert.equal(r.isInterState, false);
    assert.equal(r.igstPaise, 0);
    assert.equal(r.cgstRate, 1.5);
    assert.equal(r.sgstRate, 1.5);
    assert.equal(r.cgstPaise + r.sgstPaise, r.taxPaise);
    assert.equal(r.taxablePaise, 9709);
    assert.equal(r.taxPaise, 291);
});

test('inter-state uses IGST only', () => {
    const r = splitInclusiveLine(10000, 3, '27', '29');
    assert.equal(r.isInterState, true);
    assert.equal(r.cgstPaise, 0);
    assert.equal(r.sgstPaise, 0);
    assert.equal(r.igstPaise, r.taxPaise);
});

test('18 percent on 118.00 back-computes exactly 100.00 taxable', () => {
    const r = splitInclusiveLine(11800, 18, '27', '27');
    assert.equal(r.taxablePaise, 10000);
    assert.equal(r.taxPaise, 1800);
});

test('zero-rated lines carry no tax', () => {
    const r = splitInclusiveLine(5000, 0, '27', '27');
    assert.equal(r.taxablePaise, 5000);
    assert.equal(r.taxPaise, 0);
});

test('exclusive split adds tax on top of the quoted amount', () => {
    const r = splitExclusiveLine(100000, 3, '27', '27');
    assert.equal(r.taxablePaise, 100000);
    assert.equal(r.taxPaise, 3000);
    assert.equal(r.totalPaise, 103000);
    assert.equal(r.cgstPaise, 1500);
    assert.equal(r.sgstPaise, 1500);
});

test('discount allocation always sums to the requested discount', () => {
    const cases: Array<[number[], number]> = [
        [[1, 1, 1], 2],
        [[33333, 66667], 5000],
        [[100000], 100000],
        [[199900, 49900, 129900], 37970],
        [[0, 100], 50],
        [[100], 0],
    ];
    for (const [grosses, discount] of cases) {
        const shares = allocateDiscountPaise(grosses, discount);
        assert.equal(shares.reduce((s, v) => s + v, 0), discount, JSON.stringify({ grosses, discount, shares }));
        shares.forEach((share, i) => {
            assert.ok(share >= 0 && share <= grosses[i], 'share must stay inside its line');
        });
    }
});

test('discount cannot exceed the bill', () => {
    const shares = allocateDiscountPaise([100, 200], 10000);
    assert.deepEqual(shares, [100, 200]);
});

test('discounted lines add up to exactly the amount collected', () => {
    const lines = [
        { grossPaise: toPaise(1999), gstRate: 3 },
        { grossPaise: toPaise(499), gstRate: 3 },
        { grossPaise: toPaise(1299), gstRate: 18 },
    ];
    const grossTotal = lines.reduce((s, l) => s + l.grossPaise, 0);
    const discount = Math.round(grossTotal * 0.1);
    const result = computeInclusiveLines(lines, discount, '27', '27');

    assert.equal(result.totalPaise, grossTotal - discount);
    assert.equal(result.taxablePaise + result.taxPaise, result.totalPaise);
    for (const line of result.lines) {
        assert.equal(line.taxablePaise + line.taxPaise, line.totalPaise);
    }
    assert.equal(toRupees(result.totalPaise), (grossTotal - discount) / 100);
});

test('a full discount produces a zero-value invoice, not a negative one', () => {
    const result = computeInclusiveLines([{ grossPaise: 50000, gstRate: 3 }], 50000, '27', '27');
    assert.equal(result.totalPaise, 0);
    assert.equal(result.taxPaise, 0);
    assert.equal(result.taxablePaise, 0);
});

test('included tax helper matches the split of the same amount', () => {
    const tax = includedTaxPaise([{ grossPaise: 10300, gstRate: 3 }], 0);
    assert.equal(tax, 300);
});

test('rate resolution prefers explicit, then product, then fallback', () => {
    assert.equal(resolveLineGstRate(18, 3, true, 3), 18);
    assert.equal(resolveLineGstRate(undefined, 5, true, 3), 5);
    assert.equal(resolveLineGstRate(undefined, undefined, true, 3), 3);
    assert.equal(resolveLineGstRate(18, 3, false, 3), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
