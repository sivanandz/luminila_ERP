/**
 * Verification test for Tray Cycle-Count 4-Bucket Engine (Phase 4).
 * Run: npx tsx src/scripts/test-cycle-count.ts
 */

import assert from "node:assert/strict";
import { computeTrayAuditDiff } from "../lib/cycle-count";

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

console.log("cycle-count diff engine");

const mockCatalog = [
    {
        id: "prod_1",
        variant_id: "var_1",
        sku: "TMP-CHOK-RUBY-01",
        name: "Temple Choker Ruby",
        location: "Showcase Tray A",
        stock: 3,
    },
    {
        id: "prod_2",
        variant_id: "var_2",
        sku: "KND-EARR-EMER-02",
        name: "Kundan Earring Emerald",
        location: "Showcase Tray A",
        stock: 2,
    },
    {
        id: "prod_3",
        variant_id: "var_3",
        sku: "BAN-GOLD-206",
        name: "Bangle Set 2.6",
        location: "Showcase Tray A",
        stock: 1,
    },
    {
        id: "prod_4",
        variant_id: "var_4",
        sku: "HAR-POLKI-SET-04",
        name: "Bridal Polki Haram",
        location: "Counter 2", // Belonging to a different location!
        stock: 1,
    },
];

test("perfect match: all expected units scanned exactly", () => {
    const scans = new Map<string, number>([
        ["TMP-CHOK-RUBY-01", 3],
        ["KND-EARR-EMER-02", 2],
        ["BAN-GOLD-206", 1],
    ]);

    const diff = computeTrayAuditDiff(mockCatalog, scans, "Showcase Tray A");
    assert.equal(diff.totalExpected, 6);
    assert.equal(diff.totalScanned, 6);
    assert.equal(diff.matched.length, 3);
    assert.equal(diff.missing.length, 0);
    assert.equal(diff.surplus.length, 0);
    assert.equal(diff.misplaced.length, 0);
});

test("missing bucket: fewer items scanned than on record", () => {
    const scans = new Map<string, number>([
        ["TMP-CHOK-RUBY-01", 2], // 1 missing
        ["KND-EARR-EMER-02", 2], // matched
        // BAN-GOLD-206 not scanned at all: 1 missing
    ]);

    const diff = computeTrayAuditDiff(mockCatalog, scans, "Showcase Tray A");
    assert.equal(diff.totalExpected, 6);
    assert.equal(diff.totalScanned, 4);
    assert.equal(diff.matched.length, 1);
    assert.equal(diff.missing.length, 2);
    assert.equal(diff.surplus.length, 0);

    const rubyMissing = diff.missing.find(m => m.sku === "TMP-CHOK-RUBY-01");
    assert.ok(rubyMissing);
    assert.equal(rubyMissing.expectedQuantity, 3);
    assert.equal(rubyMissing.scannedQuantity, 2);
    assert.equal(rubyMissing.variance, -1);

    const bangleMissing = diff.missing.find(m => m.sku === "BAN-GOLD-206");
    assert.ok(bangleMissing);
    assert.equal(bangleMissing.scannedQuantity, 0);
    assert.equal(bangleMissing.variance, -1);
});

test("surplus bucket: extra units scanned beyond recorded stock", () => {
    const scans = new Map<string, number>([
        ["TMP-CHOK-RUBY-01", 5], // 2 surplus
        ["KND-EARR-EMER-02", 2], // matched
        ["BAN-GOLD-206", 1], // matched
    ]);

    const diff = computeTrayAuditDiff(mockCatalog, scans, "Showcase Tray A");
    assert.equal(diff.totalExpected, 6);
    assert.equal(diff.totalScanned, 8);
    assert.equal(diff.matched.length, 2);
    assert.equal(diff.missing.length, 0);
    assert.equal(diff.surplus.length, 1);

    const rubySurplus = diff.surplus[0];
    assert.equal(rubySurplus.sku, "TMP-CHOK-RUBY-01");
    assert.equal(rubySurplus.variance, 2);
});

test("misplaced bucket: piece from Counter 2 scanned on Showcase Tray A", () => {
    const scans = new Map<string, number>([
        ["TMP-CHOK-RUBY-01", 3],
        ["KND-EARR-EMER-02", 2],
        ["BAN-GOLD-206", 1],
        ["HAR-POLKI-SET-04", 1], // Belongs to Counter 2!
    ]);

    const diff = computeTrayAuditDiff(mockCatalog, scans, "Showcase Tray A");
    assert.equal(diff.matched.length, 3);
    assert.equal(diff.misplaced.length, 1);

    const misplacedItem = diff.misplaced[0];
    assert.equal(misplacedItem.sku, "HAR-POLKI-SET-04");
    assert.equal(misplacedItem.expectedLocation, "Counter 2");
    assert.equal(misplacedItem.scannedQuantity, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
