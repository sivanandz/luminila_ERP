/**
 * Verification for the GST filing period helpers used by the official GSTR-1
 * builder. Run: npm test
 */

import assert from 'node:assert/strict';
import { financialYearStart, toFinancialPeriod } from '../lib/gstr1-report';

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

console.log('gstr1-period');

test('financial period is MMYYYY', () => {
    assert.equal(toFinancialPeriod(new Date(2026, 9, 23)), '102026');
    assert.equal(toFinancialPeriod(new Date(2027, 0, 5)), '012027');
    assert.equal(toFinancialPeriod(new Date(2026, 11, 31)), '122026');
});

test('financial year starts on 1 April', () => {
    const inYear = financialYearStart(new Date(2026, 9, 23));
    assert.equal(inYear.getFullYear(), 2026);
    assert.equal(inYear.getMonth(), 3);
    assert.equal(inYear.getDate(), 1);

    const beforeApril = financialYearStart(new Date(2026, 2, 31));
    assert.equal(beforeApril.getFullYear(), 2025);
    assert.equal(beforeApril.getMonth(), 3);
});

test('the first day of the financial year belongs to that year', () => {
    const aprilFirst = financialYearStart(new Date(2026, 3, 1));
    assert.equal(aprilFirst.getFullYear(), 2026);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
