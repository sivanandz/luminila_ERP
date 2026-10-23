/**
 * Verification for the private/public host guard (hosting profile).
 * Run: npx tsx src/scripts/test-host-guard.ts
 */

import assert from 'node:assert/strict';
import {
    classifyHost,
    isPathAllowed,
    normalizeHost,
    parseHostGuardConfig,
} from '../lib/host-guard';

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

console.log('host-guard');

const disabled = parseHostGuardConfig({});
const enabled = parseHostGuardConfig({
    ADMIN_HOSTS: 'luminila-vps.tail1234.ts.net, localhost',
    STOREFRONT_HOSTS: 'shop.example.com',
});

test('host normalization strips ports and casing', () => {
    assert.equal(normalizeHost('Shop.Example.COM:443'), 'shop.example.com');
    assert.equal(normalizeHost('  LUMINILA.tail.ts.net.  '), 'luminila.tail.ts.net');
    assert.equal(normalizeHost(''), '');
});

test('config parses lists and halves only when unset', () => {
    assert.equal(disabled.enabled, false);
    assert.equal(enabled.enabled, true);
    assert.deepEqual(enabled.adminHosts, ['luminila-vps.tail1234.ts.net', 'localhost']);
    assert.deepEqual(enabled.storefrontHosts, ['shop.example.com']);
    assert.equal(parseHostGuardConfig({ HOST_GUARD: 'off', ADMIN_HOSTS: 'x' }).enabled, false);
});

test('admin, storefront, loopback and unknown hosts classify correctly', () => {
    assert.equal(classifyHost('luminila-vps.tail1234.ts.net', enabled), 'admin');
    assert.equal(classifyHost('shop.example.com:443', enabled), 'storefront');
    assert.equal(classifyHost('127.0.0.1:3000', enabled), 'admin');
    assert.equal(classifyHost('localhost', enabled), 'admin');
    // Unknown hosts get the public-safe view, never the ERP.
    assert.equal(classifyHost('random.example.net', enabled), 'storefront');
    assert.equal(classifyHost('anything', disabled), 'admin');
});

test('storefront host may serve checkout, tracking and storefront APIs', () => {
    assert.equal(isPathAllowed('storefront', '/checkout'), true);
    assert.equal(isPathAllowed('storefront', '/checkout/whatsapp'), true);
    assert.equal(isPathAllowed('storefront', '/tracking/ABC123'), true);
    assert.equal(isPathAllowed('storefront', '/api/storefront/order'), true);
    assert.equal(isPathAllowed('storefront', '/api/storefront/auth/send-otp'), true);
    assert.equal(isPathAllowed('storefront', '/api/tracking/st-courier'), true);
});

test('storefront host gets static assets, which public pages need', () => {
    assert.equal(isPathAllowed('storefront', '/_next/static/chunks/main.js'), true);
    assert.equal(isPathAllowed('storefront', '/favicon.ico'), true);
    assert.equal(isPathAllowed('storefront', '/manifest.json'), true);
    assert.equal(isPathAllowed('storefront', '/icons/icon-192.png'), true);
});

test('storefront host cannot reach ERP pages or admin APIs', () => {
    for (const path of ['/', '/inventory', '/pos', '/settings', '/login', '/api/system/tenant-db', '/api/pos/payment', '/backup', '/storefront-control']) {
        assert.equal(isPathAllowed('storefront', path), false, `expected ${path} to be blocked`);
    }
});

test('admin host may reach everything', () => {
    assert.equal(isPathAllowed('admin', '/'), true);
    assert.equal(isPathAllowed('admin', '/inventory'), true);
    assert.equal(isPathAllowed('admin', '/api/system/tenant-db'), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
