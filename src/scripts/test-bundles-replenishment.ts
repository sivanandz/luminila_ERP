/**
 * Verification test for Virtual Bundles & Smart Replenishment (Phase 5).
 * Run: npx tsx src/scripts/test-bundles-replenishment.ts
 */

import assert from "node:assert/strict";
import { computeBundleAvailability, explodeBundle, type BundleComponent } from "../lib/bundles";
import { groupRestockItemsByVendor, formatVendorWhatsAppMessage, type RestockItem } from "../lib/replenishment";

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

console.log("bundles & replenishment engine");

// ---- Virtual Bundles ----

const bridalSetComponents: BundleComponent[] = [
    {
        variant_id: "var_choker",
        product_id: "prod_choker",
        sku: "TMP-CHOK-01",
        name: "Temple Choker Ruby",
        quantity: 1, // 1 per bridal set
    },
    {
        variant_id: "var_earring",
        product_id: "prod_earring",
        sku: "TMP-EARR-01",
        name: "Temple Jhumka Pair",
        quantity: 1, // 1 per bridal set
    },
    {
        variant_id: "var_bangle",
        product_id: "prod_bangle",
        sku: "TMP-BANG-206",
        name: "Temple Bangles (Pair)",
        quantity: 2, // 2 pairs required per bridal set!
    },
];

test("bundle availability is limited by the bottleneck component", () => {
    // Chokers: 10 in stock (supports 10 sets)
    // Jhumkas: 8 in stock (supports 8 sets)
    // Bangles: 6 pairs in stock (requires 2 per set -> supports 3 sets)
    const stockMap = new Map<string, number>([
        ["var_choker", 10],
        ["var_earring", 8],
        ["var_bangle", 6],
    ]);

    const availableSets = computeBundleAvailability(bridalSetComponents, stockMap);
    assert.equal(availableSets, 3);
});

test("bundle availability drops to 0 if any single component is out of stock", () => {
    const stockMap = new Map<string, number>([
        ["var_choker", 10],
        ["var_earring", 0], // out of stock
        ["var_bangle", 6],
    ]);

    const availableSets = computeBundleAvailability(bridalSetComponents, stockMap);
    assert.equal(availableSets, 0);
});

test("bundle explosion expands combo into individual scannable packing/order lines", () => {
    const exploded = explodeBundle("SET-BRIDAL-RUBY", 2, bridalSetComponents);
    assert.equal(exploded.length, 3);

    // 2 bridal sets ordered:
    // Choker: 1 * 2 = 2
    assert.equal(exploded[0].sku, "TMP-CHOK-01");
    assert.equal(exploded[0].quantity, 2);

    // Earring: 1 * 2 = 2
    assert.equal(exploded[1].sku, "TMP-EARR-01");
    assert.equal(exploded[1].quantity, 2);

    // Bangle: 2 * 2 = 4
    assert.equal(exploded[2].sku, "TMP-BANG-206");
    assert.equal(exploded[2].quantity, 4);
});

// ---- Smart Replenishment ----

const mockRestockItems: RestockItem[] = [
    {
        productId: "prod_1",
        variantId: "var_1",
        sku: "TMP-CHOK-01",
        name: "Temple Choker Ruby",
        currentStock: 1,
        reorderPoint: 5,
        suggestedQuantity: 10,
        unitCost: 800,
        vendorId: "ven_srim",
        vendorName: "Sri Meenakshi Jewels",
        vendorPhone: "919876543210",
        leadTimeDays: 7,
    },
    {
        productId: "prod_2",
        variantId: "var_2",
        sku: "TMP-EARR-01",
        name: "Temple Jhumka",
        currentStock: 0,
        reorderPoint: 6,
        suggestedQuantity: 12,
        unitCost: 350,
        vendorId: "ven_srim",
        vendorName: "Sri Meenakshi Jewels",
        vendorPhone: "919876543210",
        leadTimeDays: 7,
    },
    {
        productId: "prod_3",
        variantId: "var_3",
        sku: "KND-CHOK-02",
        name: "Kundan Bridal Choker",
        currentStock: 2,
        reorderPoint: 4,
        suggestedQuantity: 5,
        unitCost: 1500,
        vendorId: "ven_raj",
        vendorName: "Rajasthan Crafts",
        vendorPhone: "919123456780",
        leadTimeDays: 14,
    },
];

test("groupRestockItemsByVendor aggregates items and calculates total PO cost", () => {
    const groups = groupRestockItemsByVendor(mockRestockItems);
    assert.equal(groups.length, 2);

    // Srim: (10 * 800) + (12 * 350) = 8000 + 4200 = 12200
    // Raj: 5 * 1500 = 7500
    // Sorted by cost descending: Srim first
    assert.equal(groups[0].vendorName, "Sri Meenakshi Jewels");
    assert.equal(groups[0].items.length, 2);
    assert.equal(groups[0].estimatedTotalCost, 12200);

    assert.equal(groups[1].vendorName, "Rajasthan Crafts");
    assert.equal(groups[1].items.length, 1);
    assert.equal(groups[1].estimatedTotalCost, 7500);
});

test("formatVendorWhatsAppMessage generates clear editable order draft", () => {
    const groups = groupRestockItemsByVendor(mockRestockItems);
    const message = formatVendorWhatsAppMessage(groups[0], "Luminila Jewellery");

    assert.ok(message.includes("Sri Meenakshi Jewels"));
    assert.ok(message.includes("TMP-CHOK-01"));
    assert.ok(message.includes("10 pcs"));
    assert.ok(message.includes("12 pcs"));
    assert.ok(message.includes("₹12,200"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
