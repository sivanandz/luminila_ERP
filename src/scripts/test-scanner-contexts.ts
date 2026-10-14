/**
 * Test Suite: Context-Aware Barcode Scanner Priority Stack
 * Validates that scans are routed strictly and correctly depending on active function/modal:
 * - Shipping AWB (Priority 100)
 * - Quick Modal (Priority 90)
 * - Discrepancy / Tray Audit (Priority 85)
 * - Inventory Form (Priority 70)
 * - Sales Orders / Challan / Invoice Entry (Priority 60)
 * - Inventory Catalog Search (Priority 50)
 * - POS Retail Billing (Priority 40)
 */

import { MobileScanner, ScanResult } from "../lib/mobile-scanner";

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`  ✓ ${message}`);
}

async function runTests() {
    console.log("======================================================");
    console.log("🚀 TESTING CONTEXT-AWARE BARCODE SCANNER PRIORITY STACK");
    console.log("======================================================");

    // TEST 1: POS Billing receives scan when no higher priority context is active
    console.log("\n--- TEST 1: Baseline POS Billing Context ---");
    let posReceived: string | null = null;
    const unregisterPOS = MobileScanner.registerContext("pos_billing", (result) => {
        posReceived = result.barcode;
        return true;
    }, 40);

    assert(MobileScanner.getActiveContext() === "pos_billing", "Active context is pos_billing");
    MobileScanner.dispatchScan("TMPNECCHK00001", "hardware");
    assert(posReceived === "TMPNECCHK00001", "POS billing received jewelry SKU TMPNECCHK00001");

    // TEST 2: Shipping AWB Modal intercepts scans (Priority 100) and shields POS
    console.log("\n--- TEST 2: Shipping AWB Modal (Priority 100) Preemption ---");
    posReceived = null;
    let awbReceived: string | null = null;

    const unregisterShipping = MobileScanner.registerContext("shipping_awb", (result) => {
        awbReceived = result.barcode;
        return true; // Stop propagation
    }, 100);

    assert(MobileScanner.getActiveContext() === "shipping_awb", "Active context is elevated to shipping_awb");
    MobileScanner.dispatchScan("64437374632", "hardware");

    assert(awbReceived === "64437374632", "Shipping modal captured real ST Courier AWB 64437374632");
    assert(posReceived === null, "POS billing was shielded and received ZERO unwanted keystrokes");

    // Close Shipping Modal
    unregisterShipping();
    assert(MobileScanner.getActiveContext() === "pos_billing", "After closing shipping modal, context restored to pos_billing");

    // TEST 3: Inventory Form (Priority 70) vs Main Table (Priority 50)
    console.log("\n--- TEST 3: Inventory Form vs Catalog Table ---");
    let inventorySearchReceived: string | null = null;
    const unregisterInvSearch = MobileScanner.registerContext("inventory_search", (result) => {
        inventorySearchReceived = result.barcode;
        return true;
    }, 50);

    assert(MobileScanner.getActiveContext() === "inventory_search", "Active context is inventory_search (Priority 50 > 40)");

    // User opens Product Creation dialog
    let inventoryFormReceived: string | null = null;
    const unregisterInvForm = MobileScanner.registerContext("inventory_form", (result) => {
        inventoryFormReceived = result.barcode;
        return true;
    }, 70);

    assert(MobileScanner.getActiveContext() === "inventory_form", "Active context elevated to inventory_form (Priority 70)");

    MobileScanner.dispatchScan("8901234567890", "hardware");
    assert(inventoryFormReceived === "8901234567890", "Product Form SKU input captured barcode 8901234567890");
    assert(inventorySearchReceived === null, "Inventory search table was not triggered while in Form mode");
    assert(posReceived === null, "POS was not triggered while in Inventory mode");

    // User saves/closes Product dialog
    unregisterInvForm();
    assert(MobileScanner.getActiveContext() === "inventory_search", "Context restored to inventory_search on modal close");

    // Scanning on main table now searches
    MobileScanner.dispatchScan("8901234567890", "hardware");
    assert(inventorySearchReceived === "8901234567890", "Main table received scan for catalog lookup");

    // TEST 4: Discrepancy Tray Audit (Priority 85)
    console.log("\n--- TEST 4: Stock Audit & Physical Tray Quarantine (Priority 85) ---");
    let discrepancyReceived: string | null = null;
    const unregisterDiscrepancy = MobileScanner.registerContext("discrepancy_audit", (result) => {
        discrepancyReceived = result.barcode;
        return true;
    }, 85);

    assert(MobileScanner.getActiveContext() === "discrepancy_audit", "Active context is discrepancy_audit (Priority 85)");
    inventorySearchReceived = null;
    MobileScanner.dispatchScan("JWL-RING-004", "hardware");

    assert(discrepancyReceived === "JWL-RING-004", "Discrepancy audit isolated tray item JWL-RING-004");
    assert(inventorySearchReceived === null, "Inventory search was not triggered");

    // Cleanup
    unregisterDiscrepancy();
    unregisterInvSearch();
    unregisterPOS();

    console.log("\n======================================================");
    console.log("✅ ALL CONTEXT-AWARE SCANNER PRIORITY TESTS PASSED (100%)");
    console.log("======================================================");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
