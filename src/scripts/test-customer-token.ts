/**
 * Verification for customer session signing.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import {
    MissingSessionSecretError,
    isCustomerTokenConfigured,
    signCustomerToken,
    verifyCustomerToken,
} from '../lib/customer-token';

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

const savedSecret = process.env.CUSTOMER_SESSION_SECRET;
const savedJwt = process.env.JWT_SECRET;

function withSecret(secret: string) {
    process.env.CUSTOMER_SESSION_SECRET = secret;
    delete process.env.JWT_SECRET;
}

function withoutSecret() {
    delete process.env.CUSTOMER_SESSION_SECRET;
    delete process.env.JWT_SECRET;
}

const payload = {
    id: 'cust_1',
    phone: '919876543210',
    tenant: 'owner@example.com',
    exp: Date.now() + 60_000,
};

console.log('customer-token');

test('a signed token verifies and keeps its payload', () => {
    withSecret('a-long-test-secret-value');
    const token = signCustomerToken(payload);
    const decoded = verifyCustomerToken(token);
    assert.equal(decoded?.id, 'cust_1');
    assert.equal(decoded?.tenant, 'owner@example.com');
});

test('a tampered payload is rejected', () => {
    withSecret('a-long-test-secret-value');
    const token = signCustomerToken(payload);
    const [data, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, id: 'cust_2' })).toString('base64url');
    assert.equal(verifyCustomerToken(`${forged}.${signature}`), null);
    assert.equal(verifyCustomerToken(`${data}.${signature}x`), null);
});

test('an expired token is rejected', () => {
    withSecret('a-long-test-secret-value');
    const token = signCustomerToken({ ...payload, exp: Date.now() - 1_000 });
    assert.equal(verifyCustomerToken(token), null);
});

test('without a secret, signing refuses and verification fails closed', () => {
    withoutSecret();
    assert.equal(isCustomerTokenConfigured(), false);
    assert.throws(() => signCustomerToken(payload), MissingSessionSecretError);
    assert.equal(verifyCustomerToken('anything.anything'), null);
});

test('JWT_SECRET is accepted as a fallback', () => {
    delete process.env.CUSTOMER_SESSION_SECRET;
    process.env.JWT_SECRET = 'jwt-secret-value';
    assert.equal(isCustomerTokenConfigured(), true);
    const token = signCustomerToken(payload);
    assert.equal(verifyCustomerToken(token)?.id, 'cust_1');
});

if (savedSecret === undefined) delete process.env.CUSTOMER_SESSION_SECRET;
else process.env.CUSTOMER_SESSION_SECRET = savedSecret;
if (savedJwt === undefined) delete process.env.JWT_SECRET;
else process.env.JWT_SECRET = savedJwt;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
