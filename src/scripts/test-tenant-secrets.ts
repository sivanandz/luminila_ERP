/**
 * Verification for registry secret encryption (S-06).
 * Run: npm test
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    ENCRYPTED_PREFIX,
    decryptSecret,
    encryptSecret,
    isEncryptedSecret,
    parseRegistryKey,
    readRegistrySecret,
} from '../lib/tenant-secrets';

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

const key = crypto.randomBytes(32);
const otherKey = crypto.randomBytes(32);

console.log('tenant-secrets');

test('encrypt then decrypt round-trips', () => {
    const encrypted = encryptSecret('s3cret-password', key);
    assert.equal(decryptSecret(encrypted, key), 's3cret-password');
});

test('the prefix marks the value and hides the plaintext', () => {
    const encrypted = encryptSecret('visible-text', key);
    assert.equal(isEncryptedSecret(encrypted), true);
    assert.equal(encrypted.startsWith(ENCRYPTED_PREFIX), true);
    assert.equal(encrypted.includes('visible-text'), false);
});

test('each encryption uses a fresh IV', () => {
    assert.notEqual(encryptSecret('same', key), encryptSecret('same', key));
});

test('the wrong key cannot decrypt', () => {
    const encrypted = encryptSecret('s3cret-password', key);
    assert.throws(() => decryptSecret(encrypted, otherKey));
});

test('tampering is detected by the auth tag', () => {
    const encrypted = encryptSecret('s3cret-password', key);
    const parts = encrypted.split(':');
    const data = Buffer.from(parts[4], 'base64');
    data[0] ^= 0xff;
    parts[4] = data.toString('base64');
    assert.throws(() => decryptSecret(parts.join(':'), key));
});

test('plaintext passes through in development (legacy readability)', () => {
    assert.equal(decryptSecret('legacy-plaintext', null), 'legacy-plaintext');
    assert.throws(() => decryptSecret(encryptSecret('x', key), null), /TENANT_REGISTRY_KEY/);
    // Development keeps the incremental-migration allowance.
    assert.equal(readRegistrySecret('legacy-plaintext', {} as NodeJS.ProcessEnv), 'legacy-plaintext');
});

test('production refuses a plaintext registry value (fail closed)', () => {
    const prodEnv = { NODE_ENV: 'production', TENANT_REGISTRY_KEY: key.toString('hex') } as NodeJS.ProcessEnv;
    assert.throws(
        () => readRegistrySecret('legacy-plaintext', prodEnv),
        /plaintext/,
        'a plaintext secret must never be accepted when NODE_ENV=production'
    );
    // The encrypted form still reads in production.
    const encrypted = encryptSecret('from-env', key);
    assert.equal(readRegistrySecret(encrypted, prodEnv), 'from-env');
});

test('the key parser accepts only 64 hex characters', () => {
    assert.equal(parseRegistryKey(key.toString('hex'))?.length, 32);
    assert.equal(parseRegistryKey('short'), null);
    assert.equal(parseRegistryKey(''), null);
    assert.equal(parseRegistryKey(undefined), null);
});

test('readRegistrySecret reads the key from the environment', () => {
    const encrypted = encryptSecret('from-env', key);
    assert.equal(readRegistrySecret(encrypted, { TENANT_REGISTRY_KEY: key.toString('hex') } as NodeJS.ProcessEnv), 'from-env');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
