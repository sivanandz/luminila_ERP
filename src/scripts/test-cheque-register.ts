/**
 * Verification for cheque validation and the PDC lifecycle used by the register.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { validateChequeInput, type NewChequeInput } from '../lib/cheque-register';
import {
    aggregateChequePortfolio,
    canTransitionStatus,
    getPdcMaturityInfo,
    isValidChequeNumber,
    transitionChequeStatus,
    type ChequeRecord,
} from '../lib/cheque-engine';

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

const valid: NewChequeInput = {
    chequeNumber: '123456',
    direction: 'received',
    partyName: 'Asha Traders',
    bankName: 'HDFC Bank',
    chequeDate: '2026-10-25',
    amount: 50000,
};

const record: ChequeRecord = {
    id: 'chq_1',
    chequeNumber: '123456',
    direction: 'received',
    partyName: 'Asha Traders',
    bankName: 'HDFC Bank',
    chequeDate: '2026-10-25',
    amount: 50000,
    status: 'open',
    createdDate: '2026-10-23T00:00:00.000Z',
    modifiedDate: '2026-10-23T00:00:00.000Z',
};

console.log('cheque-register');

test('only six-digit CTS numbers are accepted', () => {
    assert.equal(isValidChequeNumber('123456'), true);
    assert.equal(isValidChequeNumber('12345'), false);
    assert.equal(isValidChequeNumber('12345a'), false);
});

test('a complete cheque passes validation', () => {
    assert.deepEqual(validateChequeInput(valid), []);
});

test('missing or nonsensical fields are rejected', () => {
    assert.ok(validateChequeInput({ ...valid, chequeNumber: '12' }).length > 0);
    assert.ok(validateChequeInput({ ...valid, partyName: ' ' }).length > 0);
    assert.ok(validateChequeInput({ ...valid, amount: 0 }).length > 0);
    assert.ok(validateChequeInput({ ...valid, chequeDate: '' }).length > 0);
});

test('maturity counts days until the cheque date', () => {
    const maturity = getPdcMaturityInfo('2026-10-30', '2026-10-23T00:00:00.000Z');
    assert.equal(maturity.isPdc, true);
    assert.equal(maturity.daysToMaturity, 7);
    assert.equal(maturity.isMature, false);
});

test('a cheque past its date is mature and stale after 90 days', () => {
    const mature = getPdcMaturityInfo('2026-10-20', '2026-10-23T00:00:00.000Z');
    assert.equal(mature.isMature, true);

    const stale = getPdcMaturityInfo('2026-06-01', '2026-10-23T00:00:00.000Z');
    assert.equal(stale.isStale, true);
});

test('the lifecycle refuses illegal jumps', () => {
    assert.equal(canTransitionStatus('open', 'deposited'), true);
    assert.equal(canTransitionStatus('open', 'cleared'), false);
    assert.equal(canTransitionStatus('cleared', 'bounced'), false);
});

test('depositing requires a bank account', () => {
    const result = transitionChequeStatus(record, 'deposited');
    assert.equal(result.success, false);
    assert.match(result.error || '', /bank account/i);
});

test('deposit then clear succeeds and updates the record', () => {
    const deposited = transitionChequeStatus(record, 'deposited', { targetBankAccountId: 'acc_1' });
    assert.equal(deposited.success, true);
    assert.equal(deposited.cheque.status, 'deposited');

    const cleared = transitionChequeStatus(deposited.cheque, 'cleared');
    assert.equal(cleared.success, true);
    assert.equal(cleared.cheque.status, 'cleared');
});

test('the portfolio summary separates in-hand, pending and bounced', () => {
    const summary = aggregateChequePortfolio([
        { ...record, id: 'a', status: 'open', amount: 1000 },
        { ...record, id: 'b', status: 'deposited', amount: 2000 },
        { ...record, id: 'c', status: 'bounced', amount: 3000 },
    ], '2026-10-23T00:00:00.000Z');

    assert.equal(summary.totalCount, 3);
    assert.equal(summary.openInHandAmount, 1000);
    assert.equal(summary.depositedPendingAmount, 2000);
    assert.equal(summary.bouncedAmount, 3000);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
