/**
 * Verification for per-tenant client resolution (S-05).
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { resolveTenantRuntime, type TenantRegistryLike } from '../lib/pocketbase';

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

const registry: TenantRegistryLike = {
    activeTenantEmail: 'owner@example.com',
    tenants: {
        'owner@example.com': { port: 8092, email: 'admin@tenant.local', adminPassword: 'registry-pass' },
        'other@example.com': { port: 8093 },
    },
};

console.log('tenant-runtime');

test('a registered tenant resolves to its own port and credentials', () => {
    const runtime = resolveTenantRuntime(
        'other@example.com',
        { ...registry, tenants: { ...registry.tenants, 'other@example.com': { port: 8093, email: 'a@b.c', adminPassword: 'p' } } },
        { email: 'env@example.com', password: 'env-pass' },
        'http://127.0.0.1:8091'
    );
    assert.equal(runtime.url, 'http://127.0.0.1:8093');
    assert.equal(runtime.adminEmail, 'a@b.c');
    assert.equal(runtime.adminPassword, 'p');
});

test('the active tenant is used when no email is supplied', () => {
    const runtime = resolveTenantRuntime(undefined, registry, {}, 'http://127.0.0.1:8091');
    assert.equal(runtime.url, 'http://127.0.0.1:8092');
    assert.equal(runtime.adminEmail, 'admin@tenant.local');
});

test('a tenant without credentials falls back to the environment', () => {
    const runtime = resolveTenantRuntime(
        'not-registered@example.com',
        registry,
        { email: 'env@example.com', password: 'env-pass' },
        'http://127.0.0.1:8090'
    );
    assert.equal(runtime.url, 'http://127.0.0.1:8090');
    assert.equal(runtime.adminEmail, 'env@example.com');
    assert.equal(runtime.adminPassword, 'env-pass');
});

test('no registry and no environment resolves to the fallback URL and empty credentials', () => {
    const runtime = resolveTenantRuntime('someone@example.com', null, {}, 'http://127.0.0.1:8091');
    assert.equal(runtime.url, 'http://127.0.0.1:8091');
    assert.equal(runtime.adminEmail, '');
    assert.equal(runtime.adminPassword, '');
});

test('email lookup ignores case and surrounding spaces', () => {
    const runtime = resolveTenantRuntime('  OWNER@Example.com ', registry, {}, 'http://127.0.0.1:8091');
    assert.equal(runtime.url, 'http://127.0.0.1:8092');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
