/**
 * Verification for sidecar token resolution.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { resolveWppSecret } from '../lib/whatsapp';

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

console.log('whatsapp-secret');

test('the runtime injection wins', () => {
    assert.equal(
        resolveWppSecret('runtime-value-1234567890', 'stored-value-1234567890', 'build-value-1234567890'),
        'runtime-value-1234567890'
    );
});

test('a browser-stored value is used when the runtime is absent', () => {
    assert.equal(
        resolveWppSecret(undefined, 'stored-value-1234567890', 'build-value-1234567890'),
        'stored-value-1234567890'
    );
});

test('a build-time dev value is the last resort', () => {
    assert.equal(resolveWppSecret(undefined, null, 'build-value-1234567890'), 'build-value-1234567890');
});

test('tokens shorter than the sidecar minimum are ignored', () => {
    assert.equal(resolveWppSecret('short', 'also-short', 'build-value-1234567890'), 'build-value-1234567890');
    assert.equal(resolveWppSecret('short', 'also-short', 'tiny'), '');
});

test('no candidate means no token, never a default', () => {
    assert.equal(resolveWppSecret(), '');
    assert.equal(resolveWppSecret(null, null, null), '');
});

test('surrounding whitespace is trimmed', () => {
    assert.equal(resolveWppSecret('  runtime-value-1234567890  '), 'runtime-value-1234567890');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
