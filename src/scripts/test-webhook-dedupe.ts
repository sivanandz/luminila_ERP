/**
 * Verification for Razorpay webhook dedupe and amount matching.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import {
    amountMatchesRupees,
    isDuplicateEvent,
    rememberEvent,
    webhookEventKey,
} from '../lib/webhook-dedupe';

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

console.log('webhook-dedupe');

test('an event key needs both the event and its subject', () => {
    assert.equal(webhookEventKey('payment.captured', 'pay_123'), 'payment.captured:pay_123');
    assert.equal(webhookEventKey('payment.captured', ''), null);
    assert.equal(webhookEventKey('', 'pay_123'), null);
});

test('duplicate detection is exact', () => {
    const processed = ['payment.captured:pay_123'];
    assert.equal(isDuplicateEvent(processed, 'payment.captured:pay_123'), true);
    assert.equal(isDuplicateEvent(processed, 'payment.captured:pay_124'), false);
    assert.equal(isDuplicateEvent(processed, null), false);
});

test('remembering an event is idempotent', () => {
    let processed: string[] = [];
    processed = rememberEvent(processed, 'a');
    processed = rememberEvent(processed, 'a');
    assert.deepEqual(processed, ['a']);
});

test('the oldest events are forgotten beyond the cap', () => {
    let processed: string[] = [];
    for (let i = 0; i < 5; i += 1) {
        processed = rememberEvent(processed, `event-${i}`, 3);
    }
    assert.deepEqual(processed, ['event-2', 'event-3', 'event-4']);
});

test('rupee totals match captured paise exactly', () => {
    assert.equal(amountMatchesRupees(999.5, 99950), true);
    assert.equal(amountMatchesRupees(1000, 100000), true);
    assert.equal(amountMatchesRupees(999.5, 99949), false);
    assert.equal(amountMatchesRupees(999.5, 100000), false);
});

test('non-numeric amounts never match', () => {
    assert.equal(amountMatchesRupees(Number.NaN, 1000), false);
    assert.equal(amountMatchesRupees(1000, Number.NaN), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
