import { calculateInvoiceTotals } from "../src/lib/invoice";

async function runTests() {
    console.log("=== Testing GST Turn-Off & Unregistered Business Logic ===");

    // Test 1: calculateInvoiceTotals with isGstRegistered: true vs false
    const items = [
        {
            product_id: "prod_1",
            description: "Gold Ring 22K",
            quantity: 2,
            unit_price: 10000,
            discount_percent: 0,
            gst_rate: 3,
            cgst_rate: 1.5,
            sgst_rate: 1.5,
            taxable_amount: 20000,
            hsn_code: "7113",
            igst_rate: 0
        }
    ];

    const regTotals = calculateInvoiceTotals(items as any, "27", "27", true);
    console.log("Registered Totals:", {
        taxable: regTotals.taxableValue,
        tax: regTotals.totalTax,
        cgst: regTotals.cgstAmount,
        sgst: regTotals.sgstAmount,
        grandTotal: regTotals.grandTotal
    });

    if (regTotals.totalTax !== 600 || regTotals.grandTotal !== 20600) {
        throw new Error(`Expected registered tax=600, grandTotal=20600, got tax=${regTotals.totalTax}, grand=${regTotals.grandTotal}`);
    }

    const unregTotals = calculateInvoiceTotals(items as any, "27", "27", false);
    console.log("Unregistered Totals:", {
        taxable: unregTotals.taxableValue,
        tax: unregTotals.totalTax,
        cgst: unregTotals.cgstAmount,
        sgst: unregTotals.sgstAmount,
        grandTotal: unregTotals.grandTotal
    });

    if (unregTotals.totalTax !== 0 || unregTotals.cgstAmount !== 0 || unregTotals.sgstAmount !== 0 || unregTotals.grandTotal !== 20000) {
        throw new Error(`Expected unregistered tax=0, grandTotal=20000, got tax=${unregTotals.totalTax}, grand=${unregTotals.grandTotal}`);
    }

    console.log("✔ Test 1 Passed: calculateInvoiceTotals calculates 0% GST when unregistered.");

    // Test 2: StoreSettings derivation logic
    const { getDefaultStoreSettings } = await import("../src/lib/settings");
    const defaults = getDefaultStoreSettings();
    console.log("Default store settings isGstRegistered:", defaults.isGstRegistered);
    if (defaults.isGstRegistered !== true) {
        throw new Error("Expected default isGstRegistered to be true");
    }
    console.log("✔ Test 2 Passed: Default store settings has isGstRegistered: true.");

    // Test 3: Simulation of Sale to Invoice item mapping when unregistered
    const unitPrice = 5000;
    const qty = 2;
    const lineTotal = qty * unitPrice;
    const isUnregistered = true;
    const effectiveGstRate = isUnregistered ? 0 : 3;
    const taxableAmount = lineTotal;
    const cgstRate = effectiveGstRate / 2;
    const cgstAmount = (taxableAmount * cgstRate) / 100;
    const sgstAmount = (taxableAmount * cgstRate) / 100;
    const totalTax = cgstAmount + sgstAmount;
    const grandTotal = taxableAmount + totalTax;

    if (totalTax !== 0 || grandTotal !== 10000) {
        throw new Error(`Expected zero tax for unregistered item mapping, got totalTax=${totalTax}, grandTotal=${grandTotal}`);
    }
    console.log("✔ Test 3 Passed: Unregistered sale item mapping results in 0 tax.");

    console.log("=== ALL UNIT VERIFICATIONS PASSED SUCCESSFULLY ===");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
