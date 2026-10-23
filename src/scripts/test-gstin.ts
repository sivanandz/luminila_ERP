/**
 * Verification for GSTIN shape and check digit (D-16).
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { gstinCheckDigit, gstinStateCode, isValidGstin } from '../lib/gstin';

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

console.log('gstin');

test('a published valid GSTIN passes', () => {
    assert.equal(isValidGstin('27AAPFU0939F1ZV'), true);
    assert.equal(isValidGstin('29AAGCB7383J1Z4'), true);
    assert.equal(isValidGstin('27AAACR5055K1Z7'), true);
});

test('a wrong check digit is rejected even when the shape looks right', () => {
    assert.equal(isValidGstin('27AAPFU0939F1ZX'), false);
    assert.equal(isValidGstin('29AAGCB7383J1Z5'), false);
});

test('the check digit is reproducible from the first fourteen characters', () => {
    for (const gstin of ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '27AAACR5055K1Z7']) {
        assert.equal(gstinCheckDigit(gstin.slice(0, 14)), gstin[14]);
    }
});

test('lowercase input is normalised', () => {
    assert.equal(isValidGstin('27aapfu0939f1zv'), true);
    assert.equal(isValidGstin('  27AAPFU0939F1ZV  '), true);
});

test('malformed values are rejected', () => {
    assert.equal(isValidGstin(''), false);
    assert.equal(isValidGstin(undefined), false);
    assert.equal(isValidGstin('22AAAAA0000A1Z'), false);
    assert.equal(isValidGstin('22AAAAA0000A1Z55'), false);
    assert.equal(isValidGstin('ZZAAPFU0939F1ZV'), false);
});

test('the state code is the leading two digits', () => {
    assert.equal(gstinStateCode('27AAPFU0939F1ZV'), '27');
    assert.equal(gstinStateCode('not-a-gstin'), '');
    assert.equal(gstinStateCode(undefined), '');
});

test('the check digit helper refuses bad inputs', () => {
    assert.equal(gstinCheckDigit('too-short'), null);
    assert.equal(gstinCheckDigit('22AAAAA0000A1Z!'), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
