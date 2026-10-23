/**
 * Verification for the fixed-window rate limiter used by public routes.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { FixedWindowRateLimiter, clientKeyFromHeaders } from '../lib/rate-limit';

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

console.log('rate-limit');

test('requests inside the limit are allowed', () => {
    const limiter = new FixedWindowRateLimiter({ max: 3, windowMs: 1000 });
    assert.equal(limiter.check('ip', 0).allowed, true);
    assert.equal(limiter.check('ip', 10).allowed, true);
    const third = limiter.check('ip', 20);
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);
});

test('the request after the limit is refused with a retry hint', () => {
    const limiter = new FixedWindowRateLimiter({ max: 2, windowMs: 1000 });
    limiter.check('ip', 0);
    limiter.check('ip', 0);
    const blocked = limiter.check('ip', 250);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.retryAfterMs, 750);
});

test('the window resets after it expires', () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 1000 });
    assert.equal(limiter.check('ip', 0).allowed, true);
    assert.equal(limiter.check('ip', 500).allowed, false);
    assert.equal(limiter.check('ip', 1000).allowed, true);
});

test('keys are independent', () => {
    const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 1000 });
    assert.equal(limiter.check('a', 0).allowed, true);
    assert.equal(limiter.check('b', 0).allowed, true);
    assert.equal(limiter.check('a', 0).allowed, false);
});

test('pruning drops only expired windows', () => {
    const limiter = new FixedWindowRateLimiter({ max: 2, windowMs: 1000 });
    limiter.check('old', 0);
    limiter.check('fresh', 900);
    assert.equal(limiter.prune(1000), 1);
    assert.equal(limiter.size(), 1);
});

test('the client key prefers the first forwarded hop', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.2' });
    assert.equal(clientKeyFromHeaders(headers), '203.0.113.9');

    const realIp = new Headers({ 'x-real-ip': '198.51.100.4' });
    assert.equal(clientKeyFromHeaders(realIp), '198.51.100.4');

    assert.equal(clientKeyFromHeaders(new Headers()), 'unknown');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
