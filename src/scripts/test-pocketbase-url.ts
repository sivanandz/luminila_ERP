/**
 * Verification for the browser PocketBase URL resolver (hosting profile).
 * Run: npx tsx src/scripts/test-pocketbase-url.ts
 */

import assert from 'node:assert/strict';
import { LOCAL_POCKETBASE_URL, resolvePocketBaseBaseUrl } from '../lib/pocketbase-url';

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

console.log('pocketbase-url');

const hosted = {
    protocol: 'https:',
    hostname: 'luminila-vps.tail1234.ts.net',
    origin: 'https://luminila-vps.tail1234.ts.net',
};

test('explicit NEXT_PUBLIC_POCKETBASE_URL wins everywhere', () => {
    assert.equal(
        resolvePocketBaseBaseUrl({ ...hosted, envUrl: 'https://luminila-vps.tail1234.ts.net:10000/' }),
        'https://luminila-vps.tail1234.ts.net:10000'
    );
    assert.equal(
        resolvePocketBaseBaseUrl({ protocol: 'http:', hostname: 'tauri.localhost', envUrl: 'http://127.0.0.1:9000' }),
        'http://127.0.0.1:9000'
    );
});

test('stored override is used when no env URL is set', () => {
    assert.equal(
        resolvePocketBaseBaseUrl({ ...hosted, storedUrl: 'https://pb.example.com/' }),
        'https://pb.example.com'
    );
});

test('https without configuration uses the same-origin /pb path', () => {
    assert.equal(resolvePocketBaseBaseUrl(hosted), 'https://luminila-vps.tail1234.ts.net/pb');
    assert.equal(
        resolvePocketBaseBaseUrl({ protocol: 'https:', hostname: 'shop.example.com' }),
        'https://shop.example.com/pb'
    );
});

test('desktop and Android emulator keep their local origins', () => {
    assert.equal(
        resolvePocketBaseBaseUrl({ protocol: 'http:', hostname: 'tauri.localhost', userAgent: 'Mozilla/5.0' }),
        LOCAL_POCKETBASE_URL
    );
    assert.equal(
        resolvePocketBaseBaseUrl({ protocol: 'http:', hostname: 'tauri.localhost', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }),
        'http://10.0.2.2:8090'
    );
});

test('LAN access over http keeps the host:8090 convention', () => {
    assert.equal(
        resolvePocketBaseBaseUrl({ protocol: 'http:', hostname: '192.168.1.20' }),
        'http://192.168.1.20:8090'
    );
});

test('localhost and quick tunnels fall back to the local server', () => {
    assert.equal(resolvePocketBaseBaseUrl({ protocol: 'http:', hostname: 'localhost' }), LOCAL_POCKETBASE_URL);
    assert.equal(
        resolvePocketBaseBaseUrl({ protocol: 'http:', hostname: 'random.trycloudflare.com' }),
        LOCAL_POCKETBASE_URL
    );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
