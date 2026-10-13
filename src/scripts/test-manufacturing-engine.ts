/**
 * BRUTAL VERIFICATION TEST SUITE: Phase 2 - Karigar & Artisan BOM & Manufacturing Assembly Engine
 */

import {
    calculateTotalAdditionalCosts,
    calculateRawMaterialsCost,
    reconcileMetalBalance,
    validateManufacturingOrder,
    executeManufacturingAssembly,
    ManufacturingOrder,
    RawMaterialInput,
    ManufacturingAdditionalCosts,
    FinishedItemOutput,
    ScrapRecoveryOutput
} from '../lib/manufacturing-engine';

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
console.log('BRUTALLY TESTING: Phase 2 Manufacturing Assembly Engine');
console.log('============================================================\n');

// -------------------------------------------------------------------------
// TEST 1: Additional Costs (ac1..ac5) Calculation
// -------------------------------------------------------------------------
console.log('Suite 1: Overhead Costs (ac1..ac5)');
{
    const ac: ManufacturingAdditionalCosts = {
        ac1_labour: 1500,
        ac2_hallmarking: 150,
        ac3_finishing: 350,
        ac4_logistics: 200,
        ac5_certification_other: 800,
    };
    const total = calculateTotalAdditionalCosts(ac);
    assert(total === 3000, 'Sum of ac1..ac5 is exact ₹3,000', `Got ${total}`);

    // Edge case: handles negative/NaN gracefully
    const invalidAc = {
        ac1_labour: -500,
        ac2_hallmarking: NaN as unknown as number,
        ac3_finishing: 100,
        ac4_logistics: 0,
        ac5_certification_other: 50,
    };
    const cleanedTotal = calculateTotalAdditionalCosts(invalidAc);
    assert(cleanedTotal === 150, 'Negative and NaN overheads clamped to 0', `Got ${cleanedTotal}`);
}

// -------------------------------------------------------------------------
// TEST 2: Raw Materials Cost Calculation
// -------------------------------------------------------------------------
console.log('\nSuite 2: Raw Materials Valuation');
{
    const materials: RawMaterialInput[] = [
        {
            variantId: 'mat-gold-24k',
            name: '24K Fine Gold Grain',
            materialType: 'gold_bullion',
            quantity: 10.500,
            unit: 'g',
            purityKarat: '24K',
            unitCostPrice: 7200, // ₹7,200/g = ₹75,600
        },
        {
            variantId: 'mat-copper-alloy',
            name: 'Master Copper Alloy',
            materialType: 'alloy',
            quantity: 0.850,
            unit: 'g',
            unitCostPrice: 100, // ₹100/g = ₹85
        },
        {
            variantId: 'mat-diamond-vvs',
            name: 'Round Brilliant Diamond 0.25ct',
            materialType: 'diamond',
            quantity: 2, // 2 stones
            unit: 'pcs',
            unitCostPrice: 12000, // ₹24,000
        }
    ];

    const totalRawCost = calculateRawMaterialsCost(materials);
    const expected = (10.5 * 7200) + (0.85 * 100) + (2 * 12000); // 75600 + 85 + 24000 = 99685
    assert(totalRawCost === 99685, 'Total raw material cost is ₹99,685', `Got ${totalRawCost}`);
}

// -------------------------------------------------------------------------
// TEST 3: Metal Reconciliation & Melting Loss
// -------------------------------------------------------------------------
console.log('\nSuite 3: Metal Reconciliation & Melting Loss');
{
    const materials: RawMaterialInput[] = [
        { variantId: 'm1', name: '24K Gold', materialType: 'gold_bullion', quantity: 20.000, unit: 'g', unitCostPrice: 7000 },
        { variantId: 'm2', name: 'Alloy', materialType: 'alloy', quantity: 1.800, unit: 'g', unitCostPrice: 50 },
        { variantId: 'm3', name: 'Diamond', materialType: 'diamond', quantity: 0.5, unit: 'ct', unitCostPrice: 50000 } // diamond should not count in metal weight!
    ];

    const finished: FinishedItemOutput[] = [
        {
            variantId: 'fin-1',
            productName: '22K Designer Necklace',
            quantityProduced: 1,
            grossWeightGrams: 20.200,
            netWeightGrams: 20.100, // 20.1g gold
            purityKarat: '22K',
        }
    ];

    const scrap: ScrapRecoveryOutput[] = [
        {
            name: 'Gold Dust & Polish Scrap',
            recoveredWeightGrams: 1.500, // 1.5g scrap recovered
            purityKarat: '22K',
            valuationRatePerGram: 6000,
        }
    ];

    // Total input metal: 20.000 + 1.800 = 21.800g
    // Output metal: 20.100g finished + 1.500g scrap = 21.600g accounted for
    // Melting loss: 21.800 - 21.600 = 0.200g
    // Melting loss %: (0.200 / 21.800) * 100 = 0.917%
    // Allowed tolerance @ 1.0% = 0.218g -> Within tolerance!

    const recon = reconcileMetalBalance(materials, finished, scrap, 1.0);
    assert(recon.totalInputMetalGrams === 21.800, 'Total input metal correctly excludes diamonds (21.800g)', `Got ${recon.totalInputMetalGrams}`);
    assert(recon.totalFinishedNetMetalGrams === 20.100, 'Finished net metal is 20.100g', `Got ${recon.totalFinishedNetMetalGrams}`);
    assert(recon.totalScrapRecoveredGrams === 1.500, 'Scrap metal recovered is 1.500g', `Got ${recon.totalScrapRecoveredGrams}`);
    assert(recon.unrecoveredMeltingLossGrams === 0.200, 'Melting loss is exactly 0.200g', `Got ${recon.unrecoveredMeltingLossGrams}`);
    assert(recon.meltingLossPercent === 0.917, 'Melting loss % is 0.917%', `Got ${recon.meltingLossPercent}`);
    assert(recon.isWithinTolerance === true, 'Loss is within 1.0% tolerance', `Allowed ${recon.allowedLossGrams}g, actual ${recon.unrecoveredMeltingLossGrams}g`);
}

// -------------------------------------------------------------------------
// TEST 4: Excess Loss Warning (> Tolerance)
// -------------------------------------------------------------------------
console.log('\nSuite 4: Excess Loss Detection');
{
    const materials: RawMaterialInput[] = [
        { variantId: 'm1', name: '24K Gold', materialType: 'gold_bullion', quantity: 50.000, unit: 'g', unitCostPrice: 7000 },
    ];
    const finished: FinishedItemOutput[] = [
        { variantId: 'fin-1', productName: 'Gold Chain', quantityProduced: 1, grossWeightGrams: 47.000, netWeightGrams: 47.000, purityKarat: '24K' },
    ];
    // Input 50g, finished 47g, 0 scrap -> Loss is 3.0g (6.0%)
    const recon = reconcileMetalBalance(materials, finished, [], 1.5);
    assert(recon.unrecoveredMeltingLossGrams === 3.000, 'Melting loss is 3.000g', `Got ${recon.unrecoveredMeltingLossGrams}`);
    assert(recon.meltingLossPercent === 6.000, 'Melting loss is 6.000%', `Got ${recon.meltingLossPercent}`);
    assert(recon.isWithinTolerance === false, 'Detects loss exceeds 1.5% tolerance', `isWithinTolerance is ${recon.isWithinTolerance}`);
    assert(recon.varianceGrams === 2.250, 'Variance is +2.250g above allowed threshold', `Got ${recon.varianceGrams}`);
}

// -------------------------------------------------------------------------
// TEST 5: Manufacturing Order Validation Checks
// -------------------------------------------------------------------------
console.log('\nSuite 5: Order Validation & Negative Guardrails');
{
    // Test: Missing orderNumber & artisan
    const invalidOrder1: ManufacturingOrder = {
        orderNumber: '',
        artisanKarigarName: '',
        orderDate: '2026-10-13',
        status: 'draft',
        rawMaterials: [],
        additionalCosts: { ac1_labour: 0, ac2_hallmarking: 0, ac3_finishing: 0, ac4_logistics: 0, ac5_certification_other: 0 },
        finishedItems: []
    };
    const v1 = validateManufacturingOrder(invalidOrder1);
    assert(!v1.valid, 'Rejects empty order', `Errors: ${v1.errors.join(', ')}`);
    assert(v1.errors.some(e => e.includes('Order number')), 'Reports missing order number');
    assert(v1.errors.some(e => e.includes('Karigar / Artisan name')), 'Reports missing artisan name');

    // Test: Invalid HUID code on finished item
    const invalidHuidOrder: ManufacturingOrder = {
        orderNumber: 'MFG-2026-001',
        artisanKarigarName: 'Master Goldsmith Suresh',
        orderDate: '2026-10-13',
        status: 'in_progress',
        rawMaterials: [{ variantId: 'v1', name: 'Gold', materialType: 'gold_bullion', quantity: 10, unit: 'g', unitCostPrice: 7000 }],
        additionalCosts: { ac1_labour: 1000, ac2_hallmarking: 50, ac3_finishing: 0, ac4_logistics: 0, ac5_certification_other: 0 },
        finishedItems: [{
            variantId: 'f1',
            productName: 'Ring',
            quantityProduced: 1,
            grossWeightGrams: 9.8,
            netWeightGrams: 9.8,
            purityKarat: '22K',
            huidCode: 'ABC12' // ONLY 5 chars! Must fail!
        }]
    };
    const v2 = validateManufacturingOrder(invalidHuidOrder);
    assert(!v2.valid, 'Rejects 5-digit invalid HUID', `Errors: ${v2.errors.join(', ')}`);
    assert(v2.errors.some(e => e.includes('HUID')), 'Reports invalid HUID error');

    // Test: Physical conservation violation (Output metal > Input metal)
    const impossibleOrder: ManufacturingOrder = {
        orderNumber: 'MFG-2026-002',
        artisanKarigarName: 'Master Goldsmith Suresh',
        orderDate: '2026-10-13',
        status: 'in_progress',
        rawMaterials: [{ variantId: 'v1', name: 'Gold', materialType: 'gold_bullion', quantity: 10.000, unit: 'g', unitCostPrice: 7000 }],
        additionalCosts: { ac1_labour: 500, ac2_hallmarking: 0, ac3_finishing: 0, ac4_logistics: 0, ac5_certification_other: 0 },
        finishedItems: [{
            variantId: 'f1',
            productName: 'Heavy Bangle',
            quantityProduced: 1,
            grossWeightGrams: 15.000,
            netWeightGrams: 15.000, // 15g out of 10g! Impossible!
            purityKarat: '22K',
        }]
    };
    const v3 = validateManufacturingOrder(impossibleOrder);
    assert(!v3.valid, 'Rejects output weight exceeding input metal', `Errors: ${v3.errors.join(', ')}`);
    assert(v3.errors.some(e => e.includes('Physical metal violation')), 'Reports physical metal violation');
}

// -------------------------------------------------------------------------
// TEST 6: Complete End-to-End Manufacturing Assembly
// -------------------------------------------------------------------------
console.log('\nSuite 6: End-to-End Assembly Execution');
{
    const order: ManufacturingOrder = {
        orderNumber: 'MFG-OCT-9901',
        artisanKarigarName: 'Ramesh Jewellers Workshop',
        orderDate: '2026-10-13T10:00:00Z',
        status: 'completed',
        rawMaterials: [
            {
                variantId: 'gold-24k-ingot',
                name: '24K Pure Gold Bar',
                materialType: 'gold_bullion',
                quantity: 30.000,
                unit: 'g',
                purityKarat: '24K',
                unitCostPrice: 7250, // ₹217,500
            },
            {
                variantId: 'silver-alloy-copper',
                name: 'Silver/Copper Master Alloy',
                materialType: 'alloy',
                quantity: 2.750,
                unit: 'g',
                unitCostPrice: 80, // ₹220
            },
            {
                variantId: 'stone-ruby-natural',
                name: 'Burma Natural Ruby',
                materialType: 'gemstone',
                quantity: 1.500,
                unit: 'ct',
                unitCostPrice: 15000, // ₹22,500
            }
        ],
        additionalCosts: {
            ac1_labour: 4500, // Karigar labour
            ac2_hallmarking: 180, // BIS Hallmarking
            ac3_finishing: 600, // Rhodium polish
            ac4_logistics: 250, // Insured transit
            ac5_certification_other: 1200, // Lab certificate
        },
        finishedItems: [
            {
                variantId: 'prod-ruby-ring-22k',
                productName: 'Royal 22K Ruby Ring',
                quantityProduced: 2,
                grossWeightGrams: 16.000,
                netWeightGrams: 15.700,
                stoneWeightGrams: 0.300,
                purityKarat: '22K',
                huidCode: 'K89M2P',
            },
            {
                variantId: 'prod-floral-pendant-22k',
                productName: 'Floral 22K Pendant',
                quantityProduced: 1,
                grossWeightGrams: 14.500,
                netWeightGrams: 14.500,
                purityKarat: '22K',
                huidCode: 'Z41L9B',
            }
        ],
        scrapRecoveries: [
            {
                name: 'Recovered 22K Goldsmith Filings',
                recoveredWeightGrams: 2.200,
                purityKarat: '22K',
                valuationRatePerGram: 6600, // ₹14,520 credit
            }
        ],
        allowedLossTolerancePercent: 1.2,
    };

    const result = executeManufacturingAssembly(order);

    assert(result.success === true, 'Assembly executes successfully');
    assert(result.totalRawMaterialsCost === (30 * 7250 + 2.75 * 80 + 1.5 * 15000), 'Raw material cost: ₹240,220', `Got ${result.totalRawMaterialsCost}`);
    assert(result.totalAdditionalCosts === (4500 + 180 + 600 + 250 + 1200), 'Additional overhead costs: ₹6,730', `Got ${result.totalAdditionalCosts}`);
    assert(result.grossProductionCost === (240220 + 6730), 'Gross production cost: ₹246,950', `Got ${result.grossProductionCost}`);
    assert(result.totalScrapRecoveryCredit === 14520, 'Scrap credit: ₹14,520', `Got ${result.totalScrapRecoveryCredit}`);
    assert(result.netProductionCost === (246950 - 14520), 'Net production cost: ₹232,430', `Got ${result.netProductionCost}`);

    // Stock movement inventory deductions
    assert(result.stockAdjustments.rawMaterialDeductions.length === 3, '3 raw materials deducted from inventory');
    assert(result.stockAdjustments.rawMaterialDeductions[0].quantity === -30, 'Gold raw material deducted by -30g');

    // Finished goods additions
    assert(result.stockAdjustments.finishedGoodsAdditions.length === 2, '2 finished goods added to inventory');
    assert(result.stockAdjustments.scrapAdditions.length === 1, '1 scrap addition to inventory');
    assert(result.stockAdjustments.scrapAdditions[0].recoveredWeight === 2.200, '2.2g scrap added');

    // Metal balance
    // Input metal: 30.000 + 2.750 = 32.750g
    // Output metal: 15.700 + 14.500 = 30.200g net + 2.200g scrap = 32.400g
    // Melting loss: 32.750 - 32.400 = 0.350g
    // Melting loss %: (0.350 / 32.750) * 100 = 1.069%
    // Allowed tolerance: 1.2% = 0.393g -> Within tolerance!
    assert(result.reconciliation.totalInputMetalGrams === 32.750, 'Total input metal: 32.750g', `Got ${result.reconciliation.totalInputMetalGrams}`);
    assert(result.reconciliation.unrecoveredMeltingLossGrams === 0.350, 'Unrecovered melting loss: 0.350g', `Got ${result.reconciliation.unrecoveredMeltingLossGrams}`);
    assert(result.reconciliation.isWithinTolerance === true, 'Melting loss (1.069%) is within 1.2% tolerance');
}

console.log('\n============================================================');
console.log(`PHASE 2 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
if (passedTests === totalTests) {
    console.log('STATUS: BRUTAL VERIFICATION PHASE 2 SUCCESSFUL! 🚀');
} else {
    console.error('STATUS: VERIFICATION FAILED! ❌');
    process.exit(1);
}
console.log('============================================================\n');
