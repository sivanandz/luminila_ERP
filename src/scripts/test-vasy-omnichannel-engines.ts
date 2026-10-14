/**
 * BRUTAL VERIFICATION TEST SUITE: Vasy.ai Imitation Jewelry & Omnichannel ERP Engines
 */

import {
    formatImitationSpec,
    generateDumbbellTagPayload,
    calculateWholesalePrice,
} from '../lib/imitation-jewelry-engine';

import {
    calculateChannelStock,
    CartReservationManager,
    DEFAULT_CHANNEL_CONFIGS,
} from '../lib/omnichannel-buffer-engine';

import {
    calculateChargeableWeight,
    estimateShippingRate,
    generateAwbNumber,
    createShipment,
    compileDispatchManifest,
} from '../lib/logistics-engine';

import {
    executeInwardQcInspection,
    InwardQcInspectionRequest,
} from '../lib/returns-qc-engine';

import {
    convertInrToForeign,
    convertForeignToInr,
    compileLutExportInvoice,
    LutExportInvoiceRequest,
} from '../lib/cross-border-engine';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS: ${testName}`);
    } else {
        console.error(`  ✗ FAIL: ${testName}`);
        if (detail) console.error(`    Detail: ${detail}`);
    }
}

console.log('\n============================================================');
console.log('BRUTALLY TESTING: Vasy.ai Benchmark Enterprise Engines');
console.log('============================================================\n');

// -------------------------------------------------------------------------
// SUITE 1: Fashion & Imitation Jewelry Craft Taxonomy Engine
// -------------------------------------------------------------------------
console.log('Suite 1: Imitation Jewelry Craft Taxonomy & Tagging');
{
    const spec = formatImitationSpec({
        craft: 'kundan',
        plating: 'micro_gold_1gm',
        baseMetal: 'brass',
        occasion: 'bridal',
    });
    assert(spec.includes('Kundan Jadau'), 'Spec includes craft label "Kundan Jadau"');
    assert(spec.includes('1-Gram Micro Gold'), 'Spec includes plating label');
    assert(spec.includes('Brass Alloy'), 'Spec includes base metal label');
    assert(spec.includes('Bridal Trousseau'), 'Spec includes occasion label');

    // Dumbbell / Butterfly Tag Generator
    const tag = generateDumbbellTagPayload({
        craft: 'temple',
        plating: 'matte_gold_24k',
        sku: 'SKU-TMP-8801',
        name: 'Temple Lakshmi Choker',
        mrpPrice: 3499,
        occasion: 'festive',
    });
    assert(tag.wingA.sku === 'SKU-TMP-8801', 'Tag wing A contains SKU');
    assert(tag.wingA.mrp === '₹3499', 'Tag wing A contains formatted MRP');
    assert(tag.wingB.badge === 'TMP-MTG', 'Tag wing B contains compact craft/plating badge "TMP-MTG"');

    // Wholesale Volume Tiers
    // 5 pcs -> 0% discount
    const tier1 = calculateWholesalePrice(1000, 5);
    assert(tier1.unitPrice === 1000, '5 pcs priced at full ₹1,000');
    assert(tier1.discountPercentApplied === 0, '0% discount for < 10 pcs');

    // 15 pcs -> 15% discount (₹850 each)
    const tier2 = calculateWholesalePrice(1000, 15);
    assert(tier2.unitPrice === 850, '15 pcs priced at ₹850 each (15% off)');
    assert(tier2.totalAmount === 12750, 'Total amount: ₹12,750');
    assert(tier2.totalSavings === 2250, 'Total savings: ₹2,250');

    // 60 pcs -> 35% discount (₹650 each)
    const tier3 = calculateWholesalePrice(1000, 60);
    assert(tier3.unitPrice === 650, '60 pcs priced at ₹650 each (35% off)');
    assert(tier3.totalAmount === 39000, 'Total amount: ₹39,000');
}

// -------------------------------------------------------------------------
// SUITE 2: Omnichannel Anti-Oversell Buffer Engine
// -------------------------------------------------------------------------
console.log('\nSuite 2: Omnichannel Anti-Oversell Buffer Engine');
{
    // Scenario A: Healthy physical stock = 10 units
    const allocHealthy = calculateChannelStock(10, 0, DEFAULT_CHANNEL_CONFIGS, 'var-choker');
    assert(allocHealthy.channelAllocations.pos.allocatedStock === 10, 'POS can sell all 10 units down to 0');
    assert(allocHealthy.channelAllocations.shopify.allocatedStock === 8, 'Shopify has 8 units (10 - 2 buffer)');
    assert(allocHealthy.channelAllocations.whatsapp.allocatedStock === 9, 'WhatsApp has 9 units (10 - 1 buffer)');
    assert(allocHealthy.channelAllocations.amazon.allocatedStock === 7, 'Amazon has 7 units (10 - 3 buffer)');

    // Scenario B: Critical stock = 2 units (Walk-in reserve kicks in)
    const allocCritical = calculateChannelStock(2, 0, DEFAULT_CHANNEL_CONFIGS, 'var-choker');
    assert(allocCritical.channelAllocations.pos.allocatedStock === 2, 'POS can sell remaining 2 units');
    assert(allocCritical.channelAllocations.shopify.allocatedStock === 0, 'Shopify stock frozen to 0');
    assert(allocCritical.channelAllocations.shopify.isFrozen === true, 'Shopify channel is marked frozen');
    assert(allocCritical.channelAllocations.shopify.freezeReason?.includes('Safety buffer'), 'Freeze reason explains in-store walk-in reservation');
    assert(allocCritical.warning !== undefined, 'Issues critical stock warning');

    // Scenario C: Temporary Cart Reservations with TTL
    const resMgr = new CartReservationManager();
    const res1 = resMgr.reserveStock('cart-shopify-101', 'var-ring', 2, 'shopify', 6);
    assert(res1.success === true, 'Successfully reserved 2 units on Shopify');
    assert(resMgr.getActiveReservationCount('var-ring') === 2, 'Active reservations is 2');

    // Stock allocation after reservation: physical 6 - 2 reserved = 4 effective -> Shopify sees 4 - 2 buffer = 2 available
    const allocAfterRes = calculateChannelStock(6, resMgr.getActiveReservationCount('var-ring'), DEFAULT_CHANNEL_CONFIGS, 'var-ring');
    assert(allocAfterRes.channelAllocations.shopify.allocatedStock === 2, 'Shopify available stock decreased to 2');

    // Release reservation
    const released = resMgr.releaseReservation('cart-shopify-101');
    assert(released === 2, 'Released 2 reserved units back to pool');
    assert(resMgr.getActiveReservationCount('var-ring') === 0, 'Active reservations returned to 0');
}

// -------------------------------------------------------------------------
// SUITE 3: Unified Courier Logistics & Dispatch Manifest Engine
// -------------------------------------------------------------------------
console.log('\nSuite 3: Unified Courier Logistics & Manifest Engine');
{
    // 1. Chargeable Weight Calculation: Volumetric vs Actual
    // Box: 20cm x 15cm x 10cm = 3000 cm3 / 5000 = 0.6 kg = 600g
    // Actual weight: 350g -> Chargeable is 600g!
    const weightCalc = calculateChargeableWeight({
        lengthCm: 20,
        widthCm: 15,
        heightCm: 10,
        actualWeightGrams: 350,
    });
    assert(weightCalc.actualWeightGrams === 350, 'Actual weight: 350g');
    assert(weightCalc.volumetricWeightGrams === 600, 'Volumetric weight: 600g');
    assert(weightCalc.chargeableWeightGrams === 600, 'Chargeable weight correctly picks higher volumetric weight (600g)');

    // 2. Shipping Rate Estimator (Zone B Intra-State with COD)
    // 600g -> Base 500g (₹55) + 1 additional 500g slab (₹40) = ₹95 + COD 2% on ₹2000 (₹50 min) = ₹145
    const rateCalc = estimateShippingRate(600, 'zone_b', true, 2000);
    assert(rateCalc.baseRate === 55, 'Base rate for Zone B is ₹55');
    assert(rateCalc.weightSurcharge === 40, 'Weight surcharge for excess 100g is ₹40');
    assert(rateCalc.codCharge === 50, 'COD charge is minimum ₹50');
    assert(rateCalc.totalRate === 145, 'Total shipping estimate is exact ₹145');

    // 3. AWB & Shipment Generation
    const shipment = createShipment({
        orderNumber: 'ORD-DEL-9901',
        carrier: 'delhivery',
        senderAddress: { recipientName: 'Luminila Store', phone: '9999999999', streetAddress: 'MG Road', city: 'Bangalore', state: 'Karnataka', pincode: '560001' },
        deliveryAddress: { recipientName: 'Priya Mehta', phone: '9888888888', streetAddress: 'Banjara Hills', city: 'Hyderabad', state: 'Telangana', pincode: '500034' },
        dimensions: { lengthCm: 15, widthCm: 10, heightCm: 5, actualWeightGrams: 200 },
        isCod: true,
        codAmount: 1850,
        invoiceValue: 1850,
    }, 'zone_c', 12345678);

    assert(shipment.awbNumber === 'DLV12345678', 'AWB has carrier prefix "DLV"');
    assert(shipment.isCod === true, 'Marked as COD shipment');
    assert(shipment.codAmount === 1850, 'COD amount is ₹1,850');
    assert(shipment.trackingUrl.includes('DLV12345678'), 'Tracking URL includes AWB');

    // 4. Dispatch Manifest Handover Summary
    const manifest = compileDispatchManifest([shipment], 'delhivery', 1);
    assert(manifest.totalParcels === 1, 'Manifest includes 1 parcel');
    assert(manifest.totalCodValue === 1850, 'Manifest total COD: ₹1,850');
    assert(manifest.manifestNumber.startsWith('MNF-DLV-'), 'Manifest number has standard format');
}

// -------------------------------------------------------------------------
// SUITE 4: Reverse Logistics, Customer Returns & Inward QC Engine
// -------------------------------------------------------------------------
console.log('\nSuite 4: Reverse Logistics & Inward QC Engine');
{
    // Test A: Grade A Restock (Unopened return, customer remorse -> Restocked with restock fee)
    const reqGradeA: InwardQcInspectionRequest = {
        returnNumber: 'RMA-2026-001',
        originalInvoiceNumber: 'INV-2026-042',
        customerName: 'Ananya Roy',
        returnedItems: [
            {
                variantId: 'var-necklace-cz',
                productName: 'CZ Choker Necklace',
                quantityReturned: 1,
                unitPrice: 2060, // ₹2000 taxable + ₹60 GST
                taxRate: 3.0,
                returnReason: 'customer_remorse',
            }
        ],
        dispositionGrade: 'restock_grade_a',
        reverseShippingFeeDeduction: 100, // ₹100 reverse courier
        restockingFeePercent: 5, // 5% restock fee = ₹103
    };

    const resGradeA = executeInwardQcInspection(reqGradeA);
    assert(resGradeA.success === true, 'QC inspection executed successfully');
    assert(resGradeA.inventoryActions[0].action === 'restock', 'Item routed to restock');
    assert(resGradeA.inventoryActions[0].targetLocation.includes('Showroom'), 'Restocked into main showroom');
    assert(resGradeA.totalDeductions === (100 + 103), 'Deductions = ₹100 reverse shipping + ₹103 restock fee (₹203)');
    assert(resGradeA.netRefundCreditAmount === (2060 - 203), 'Net refund credit is ₹1,857');
    assert(resGradeA.creditNotePayload.creditNoteNumber.startsWith('CN-'), 'Credit Note generated');

    // Test B: Manufacturing Defect (Store fault -> Zero deductions!)
    const reqDefect: InwardQcInspectionRequest = {
        returnNumber: 'RMA-2026-002',
        originalInvoiceNumber: 'INV-2026-055',
        customerName: 'Rohit Sharma',
        returnedItems: [
            {
                variantId: 'var-bangle-kundan',
                productName: 'Kundan Bangle',
                quantityReturned: 1,
                unitPrice: 1545,
                taxRate: 3.0,
                returnReason: 'manufacturing_defect',
            }
        ],
        dispositionGrade: 'karigar_repair',
        reverseShippingFeeDeduction: 150, // Should be WAIVED because store fault!
        restockingFeePercent: 10, // Should be WAIVED!
        repairCostEstimate: 200,
    };

    const resDefect = executeInwardQcInspection(reqDefect);
    assert(resDefect.totalDeductions === 0, 'Deductions completely waived for manufacturing defects');
    assert(resDefect.netRefundCreditAmount === 1545, 'Full 100% refund of ₹1,545 credited to customer');
    assert(resDefect.inventoryActions[0].action === 'route_to_karigar', 'Item routed to Karigar workshop for repair');
}

// -------------------------------------------------------------------------
// SUITE 5: Cross-Border Multi-Currency & Statutory LUT Export Engine
// -------------------------------------------------------------------------
console.log('\nSuite 5: Cross-Border Multi-Currency & Statutory LUT Export');
{
    // 1. Currency Conversion
    // ₹83,500 INR @ 83.50 = $1,000.00 USD
    const usdConv = convertInrToForeign(83500, 'USD');
    assert(usdConv.foreignAmount === 1000.00, '₹83,500 converts to $1,000.00 USD');
    assert(usdConv.formattedDisplay === '$1000.00 USD', 'Formatted display matches US currency format');

    // Round-trip conversion: $1000.00 USD * 83.50 = ₹83,500 INR
    const inrBack = convertForeignToInr(1000, 'USD');
    assert(inrBack === 83500, 'Round-trip conversion back to INR is exact ₹83,500');

    // 2. Statutory LUT Export Invoice (Zero-Rated 0% GST)
    const exportReq: LutExportInvoiceRequest = {
        invoiceNumber: 'EXP-2026-001',
        invoiceDate: '2026-10-14',
        buyerName: 'Global Vedic Jewels LLC',
        buyerCountry: 'United States',
        buyerAddress: '5th Avenue, New York, NY 10001',
        currency: 'USD',
        isLutExport: true,
        lutArnNumber: 'AD290326001928K',
        portCode: 'INBLR4',
        items: [
            {
                sku: 'SKU-BRIDAL-SET',
                description: 'Kundan Bridal Necklace Set',
                hsnCode: '7113',
                quantity: 2,
                unitPriceInr: 41750, // 2 * 41750 = ₹83,500 ($1000)
            }
        ],
    };

    const exportInvoice = compileLutExportInvoice(exportReq);
    assert(exportInvoice.exportType === 'LUT_ZERO_RATED', 'Export marked as LUT_ZERO_RATED');
    assert(exportInvoice.declarationText.includes('LETTER OF UNDERTAKING'), 'Includes statutory LUT declaration text');
    assert(exportInvoice.totals.inrGstTotal === 0, 'GST is 0% (Zero-Rated supply under LUT)');
    assert(exportInvoice.totals.foreignGrandTotal === 1000, 'Foreign total is $1,000.00 USD');
    assert(exportInvoice.totals.inrGrandTotal === 83500, 'INR total is ₹83,500.00');
    assert(exportInvoice.lutDetails?.portCode === 'INBLR4', 'Port code is recorded');
}

console.log('\n============================================================');
console.log(`VASY BENCHMARK TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
if (passedTests === totalTests) {
    console.log('STATUS: BRUTAL VERIFICATION OF ALL 5 ENGINES SUCCESSFUL! 🚀');
} else {
    console.error('STATUS: VERIFICATION FAILED! ❌');
    process.exit(1);
}
console.log('============================================================\n');
