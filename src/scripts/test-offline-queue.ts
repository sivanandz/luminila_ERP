/**
 * Verification for the offline queue mechanics (storage, enqueue, remove).
 * Browser APIs are stubbed; replay against PocketBase is not exercised here.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { OfflineQueue } from '../lib/offline-queue';

// The queue guards itself with `typeof window === 'undefined'`, so a minimal
// window with a Map-backed localStorage is enough to exercise the mechanics.
const store = new Map<string, string>();
const fakeWindow = {
    localStorage: {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
    },
    dispatchEvent: () => true,
};
(globalThis as unknown as { window: unknown }).window = fakeWindow;
(globalThis as unknown as { localStorage: unknown }).localStorage = fakeWindow.localStorage;

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

console.log('offline-queue');

test('an empty store yields an empty queue', () => {
    assert.deepEqual(OfflineQueue.getQueue(), []);
});

test('enqueue persists a create with its payload', () => {
    const mutation = OfflineQueue.enqueue('activity_logs', 'create', { description: 'Sold ring' });
    assert.equal(mutation.action, 'create');
    assert.equal(mutation.retries, 0);

    const queue = OfflineQueue.getQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].collection, 'activity_logs');
    assert.deepEqual(queue[0].data, { description: 'Sold ring' });
});

test('updates keep their record id and deletes keep no payload', () => {
    OfflineQueue.enqueue('products', 'update', { name: 'Ring' }, 'prod_1');
    OfflineQueue.enqueue('products', 'delete', undefined, 'prod_2');

    const queue = OfflineQueue.getQueue();
    assert.equal(queue.length, 3);
    assert.equal(queue[1].recordId, 'prod_1');
    assert.equal(queue[2].action, 'delete');
    assert.equal(queue[2].data, undefined);
});

test('remove drops exactly one mutation', () => {
    const [first] = OfflineQueue.getQueue();
    OfflineQueue.remove(first.id);
    assert.equal(OfflineQueue.getQueue().length, 2);
});

test('clear empties the queue', () => {
    OfflineQueue.clear();
    assert.deepEqual(OfflineQueue.getQueue(), []);
});

test('a corrupt store is treated as empty rather than throwing', () => {
    store.set('luminila_offline_mutations', '{not json');
    assert.deepEqual(OfflineQueue.getQueue(), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
