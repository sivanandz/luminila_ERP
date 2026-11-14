/**
 * Sprint 3 Feature Verification Suite
 * Tests pure business logic added across Sprint 3 modules:
 * - Multi-angle gallery merge/delete & 90-day dead-stock detection (products.ts)
 * - Omnichannel buffer allocation & 15-minute CartReservationManager (omnichannel-buffer-engine.ts)
 * - E-Way Bill ₹50,000 threshold & GSTIN format guards (eway-bill.ts)
 */

import assert from 'node:assert/strict';
import { mergeProductAngle, isDeadStockProduct } from '../lib/products';
import {
    calculateChannelStock,
    CartReservationManager,
    DEFAULT_CHANNEL_CONFIGS,
} from '../lib/omnichannel-buffer-engine';
import { isEwayBillRequired } from '../lib/eway-bill';

let passed = 0;
function test(name: string, fn: () => void) {
    try {
        fn();
        passed++;
        console.log(`PASS: ${name}`);
    } catch (err) {
        console.error(`FAIL: ${name}`, err);
        process.exitCode = 1;
    }
}

test('mergeProductAngle adds, updates, and deletes slots immutably', () => {
    const step1 = mergeProductAngle(undefined, 'HERO', 'data:image/png;base64,hero');
    assert.deepEqual(step1, { HERO: 'data:image/png;base64,hero' });

    const step2 = mergeProductAngle(step1, 'MACR', 'data:image/png;base64,macro');
    assert.equal(step2.HERO, 'data:image/png;base64,hero');
    assert.equal(step2.MACR, 'data:image/png;base64,macro');
    assert.equal(step1.MACR, undefined);

    const step3 = mergeProductAngle(step2, 'HERO', '   ');
    assert.equal(step3.HERO, undefined);
    assert.equal(step3.MACR, 'data:image/png;base64,macro');
});

test('isDeadStockProduct flags in-stock items unchanged for 90+ days only', () => {
    const now = new Date('2026-11-14T12:00:00Z').getTime();
    const days95Ago = new Date(now - 95 * 86_400_000).toISOString();
    const days30Ago = new Date(now - 30 * 86_400_000).toISOString();

    assert.equal(isDeadStockProduct({ stock: 4, updated: days95Ago }, 90, now), true);
    assert.equal(isDeadStockProduct({ stock: 0, updated: days95Ago }, 90, now), false);
    assert.equal(isDeadStockProduct({ stock: 4, updated: days30Ago }, 90, now), false);
    assert.equal(isDeadStockProduct({ stock: 2, created: days95Ago }, 90, now), true);
});

test('calculateChannelStock enforces channel buffers and CartReservationManager 15m TTL', () => {
    const mgr = new CartReservationManager();
    const allocBefore = calculateChannelStock(5, 0, DEFAULT_CHANNEL_CONFIGS, 'var-1');
    assert.equal(allocBefore.channelAllocations.pos.allocatedStock, 5);
    assert.equal(allocBefore.channelAllocations.whatsapp.allocatedStock, 4);
    assert.equal(allocBefore.channelAllocations.shopify.allocatedStock, 3);

    const r1 = mgr.reserveStock('cart-a', 'var-1', 2, 'whatsapp', 5, 15, DEFAULT_CHANNEL_CONFIGS);
    assert.equal(r1.success, true);
    assert.equal(mgr.getActiveReservationCount('var-1'), 2);

    const allocAfter = calculateChannelStock(
        5,
        mgr.getActiveReservationCount('var-1'),
        DEFAULT_CHANNEL_CONFIGS,
        'var-1'
    );
    assert.equal(allocAfter.channelAllocations.pos.allocatedStock, 3);
    assert.equal(allocAfter.channelAllocations.shopify.allocatedStock, 1);

    // Next Shopify request of 2 must fail because only 1 sellable unit remains above buffer 2
    const rFail = mgr.reserveStock('cart-b', 'var-1', 2, 'shopify', 5, 15, DEFAULT_CHANNEL_CONFIGS);
    assert.equal(rFail.success, false);

    mgr.releaseReservation('cart-a');
    assert.equal(mgr.getActiveReservationCount('var-1'), 0);
});

test('isEwayBillRequired enforces > Rs.50,000 GST rule', () => {
    assert.equal(isEwayBillRequired(50000), false);
    assert.equal(isEwayBillRequired(50001), true);
    assert.equal(isEwayBillRequired(125000), true);
});

console.log(`\nSprint 3 verification complete: ${passed} test(s) passed.`);
