/**
 * Verification for the server-side tenant authorization rule and the storefront
 * email normalization that replaced raw filter interpolation.
 *
 * Run: npx tsx src/scripts/test-tenant-auth.ts
 */

import assert from 'node:assert/strict';
import { tenantAccessAllowed, roleGrantsCapability } from '../lib/api-auth';
import { normalizeBindingEmail, resolveOrderTenant } from '../lib/storefront';

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

console.log('tenant-auth');

test('a session may act on its own tenant', () => {
    assert.equal(tenantAccessAllowed('owner@shop.in', false, 'owner@shop.in'), true);
});

test('a session may not act on another tenant', () => {
    assert.equal(tenantAccessAllowed('owner@shop.in', false, 'other@shop.in'), false);
});

test('a superuser may act on any tenant', () => {
    assert.equal(tenantAccessAllowed('admin@luminila.local', true, 'owner@shop.in'), true);
    assert.equal(tenantAccessAllowed('admin@luminila.local', false, 'owner@shop.in'), false);
});

test('a missing session is never authorized', () => {
    assert.equal(tenantAccessAllowed(undefined, false, 'owner@shop.in'), false);
    assert.equal(tenantAccessAllowed('', false, 'owner@shop.in'), false);
});

test('comparison is case and whitespace insensitive', () => {
    assert.equal(tenantAccessAllowed(' Owner@Shop.IN ', false, 'owner@shop.in'), true);
});

test('plain emails are accepted as a storefront binding', () => {
    assert.equal(normalizeBindingEmail('owner@shop.in'), 'owner@shop.in');
    assert.equal(normalizeBindingEmail('  OWNER@shop.in '), 'owner@shop.in');
});

test('filter injection is rejected instead of sanitized into a lookup', () => {
    assert.equal(normalizeBindingEmail('a" || account_email != "a'), '');
    assert.equal(normalizeBindingEmail('a"@shop.in'), '');
    assert.equal(normalizeBindingEmail("a'@shop.in"), '');
});

test('empty and malformed values fall back to no tenant', () => {
    assert.equal(normalizeBindingEmail(undefined), '');
    assert.equal(normalizeBindingEmail(''), '');
    assert.equal(normalizeBindingEmail('not-an-email'), '');
    assert.equal(normalizeBindingEmail('a@'), '');
});

test('an order uses the tenant from the session', () => {
    const result = resolveOrderTenant('owner@shop.in');
    assert.equal(result.ok, true);
    assert.equal(result.tenant, 'owner@shop.in');
});

test('an order may repeat its own tenant', () => {
    const result = resolveOrderTenant('owner@shop.in', 'OWNER@shop.in');
    assert.equal(result.ok, true);
});

test('an order cannot name a different tenant', () => {
    const result = resolveOrderTenant('owner@shop.in', 'other@shop.in');
    assert.equal(result.ok, false);
    assert.match(result.error || '', /does not match/);
});

test('a session without a valid tenant cannot order', () => {
    assert.equal(resolveOrderTenant('').ok, false);
    assert.equal(resolveOrderTenant('garbage').ok, false);
});

test('Admin and Super Admin roles pass every capability', () => {
    assert.equal(roleGrantsCapability({ name: 'Admin' }, 'products', 'update'), true);
    assert.equal(roleGrantsCapability({ name: 'Super Admin' }, 'anything', 'delete'), true);
});

test('other roles need the explicit resource and action', () => {
    const manager = { name: 'Manager', permissions: { products: ['read', 'update'] } };
    assert.equal(roleGrantsCapability(manager, 'products', 'update'), true);
    assert.equal(roleGrantsCapability(manager, 'products', 'delete'), false);
    assert.equal(roleGrantsCapability(manager, 'settings', 'update'), false);
});

test('a role with no permissions or no role record is denied', () => {
    assert.equal(roleGrantsCapability({ name: 'Cashier' }, 'products', 'update'), false);
    assert.equal(roleGrantsCapability(undefined, 'products', 'update'), false);
    assert.equal(roleGrantsCapability(null, 'settings', 'update'), false);
});

test('a malformed permission entry is denied rather than trusted', () => {
    const broken = { name: 'Staff', permissions: { products: 'update' as unknown as string[] } };
    assert.equal(roleGrantsCapability(broken, 'products', 'update'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
