/**
 * Execution test for the Next 16 proxy (host guard), no full build required.
 * Run: npx tsx src/scripts/test-proxy.ts
 *
 * Next 16 runs the proxy convention on the Node.js runtime (`isProxyFile` forces
 * it), so `process.env` is read at request time and this test can set the host
 * lists before importing the module.
 */

import assert from 'node:assert/strict';

process.env.ADMIN_HOSTS = 'erp.tail1234.ts.net,localhost,127.0.0.1';
process.env.STOREFRONT_HOSTS = 'shop.example.com';
delete process.env.HOST_GUARD;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
    try {
        await fn();
        passed += 1;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(`        ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function main() {
    const { default: proxy } = await import('../proxy');
    const { NextRequest } = await import('next/server');

    function request(host: string, path: string): InstanceType<typeof NextRequest> {
        return new NextRequest(`https://${host}${path}`, {
            headers: { host },
            method: 'GET',
        });
    }

    function isPassThrough(response: Response): boolean {
        // NextResponse.next() marks itself for the router pipeline.
        return response.headers.get('x-middleware-next') === '1';
    }

    console.log('proxy (Next 16 proxy convention)');

    await test('storefront host serves the public checkout', () => {
        assert.equal(isPassThrough(proxy(request('shop.example.com', '/checkout/whatsapp'))), true);
    });

    await test('storefront host serves storefront APIs', () => {
        assert.equal(isPassThrough(proxy(request('shop.example.com', '/api/storefront/order'))), true);
    });

    await test('storefront host 404s every ERP page', () => {
        for (const path of ['/inventory', '/pos', '/settings', '/login', '/backup']) {
            assert.equal(proxy(request('shop.example.com', path)).status, 404, `expected 404 for ${path}`);
        }
    });

    await test('storefront host 404s admin APIs', () => {
        for (const path of ['/api/system/tenant-db', '/api/pos/payment', '/api/catalog/batch']) {
            assert.equal(proxy(request('shop.example.com', path)).status, 404, path);
        }
    });

    await test('unknown hosts are treated as public storefronts', () => {
        assert.equal(proxy(request('random.example.net', '/inventory')).status, 404);
        assert.equal(isPassThrough(proxy(request('random.example.net', '/tracking/ABC'))), true);
    });

    await test('admin tailnet host passes every route and gets hardening headers', () => {
        const response = proxy(request('erp.tail1234.ts.net', '/inventory'));
        assert.equal(isPassThrough(response), true);
        assert.equal(response.headers.get('x-frame-options'), 'DENY');
        assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    });

    await test('storefront responses do not send the admin-only framing header', () => {
        const response = proxy(request('shop.example.com', '/checkout/whatsapp'));
        assert.equal(response.headers.get('x-frame-options'), null);
    });

    await test('guard is a no-op when the host lists are unset', async () => {
        const saved = { admin: process.env.ADMIN_HOSTS, storefront: process.env.STOREFRONT_HOSTS };
        delete process.env.ADMIN_HOSTS;
        delete process.env.STOREFRONT_HOSTS;
        try {
            const { parseHostGuardConfig } = await import('../lib/host-guard');
            assert.equal(parseHostGuardConfig(process.env).enabled, false);
            assert.equal(isPassThrough(proxy(request('shop.example.com', '/inventory'))), true);
        } finally {
            process.env.ADMIN_HOSTS = saved.admin;
            process.env.STOREFRONT_HOSTS = saved.storefront;
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

void main();
