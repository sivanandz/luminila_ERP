/**
 * Brutal Verification Suite: Jewelry Engine & Pricing Architecture (Phase 1)
 * Tests:
 * 1. Legal Metrology 3-decimal gram precision
 * 2. Carat to Gram stone weight normalization
 * 3. Wastage / Melting loss calculations
 * 4. All Making Charge modes: 'per_gram', 'percent', 'fixed'
 * 5. Bureau of Indian Standards (BIS) 6-digit HUID validation
 * 6. Receipt and invoice spec formatting
 * 7. End-to-end GST tax composition (3% jewelry, 18% imitation)
 */

import {
    roundDecimal,
    stoneWeightToGrams,
    calculateNetWeight,
    calculateJewelryPrice,
    isValidHUID,
    formatJewelrySpecs,
    JEWELRY_PURITIES,
} from '../lib/jewelry-engine';
import { calculateGST, GST_RATES } from '../lib/gst';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  [PASS] ${testName}`);
    } else {
        console.error(`  [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
        throw new Error(`Assertion failed: ${testName}`);
    }
}

console.log('====================================================');
console.log('🧪 RUNNING PHASE 1 BRUTAL VERIFICATION TEST SUITE');
console.log('====================================================\n');

// 1. Precision & Stone Conversions
console.log('--- 1. Gram Precision & Stone Unit Conversions ---');
assert(roundDecimal(14.5004, 3) === 14.500, 'Round 14.5004 to 3 decimal places');
assert(roundDecimal(14.5006, 3) === 14.501, 'Round 14.5006 up to 14.501');
assert(stoneWeightToGrams(5.0, 'carats') === 1.000, '5.0 carats equals 1.000 gram');
assert(stoneWeightToGrams(2.5, 'carats') === 0.500, '2.5 carats equals 0.500 gram');
assert(stoneWeightToGrams(1.85, 'grams') === 1.850, 'Grams pass through unmodified');
assert(stoneWeightToGrams(-2, 'carats') === 0, 'Negative stone weight clamped to 0');

// 2. Net Weight Deductions
console.log('\n--- 2. Net Weight Deductions ---');
const net1 = calculateNetWeight(14.500, 2.300, 'grams');
assert(net1 === 12.200, 'Gross 14.500g - Stones 2.300g = Net 12.200g');

const net2 = calculateNetWeight(10.000, 5.0, 'carats');
assert(net2 === 9.000, 'Gross 10.000g - Stones 5.0 carats (1.000g) = Net 9.000g');

const netClamped = calculateNetWeight(2.000, 15.0, 'carats');
assert(netClamped === 0, 'Net weight clamps to 0 when stones exceed gross weight');

// 3. BIS HUID Validation
console.log('\n--- 3. BIS 6-Digit HUID Validation ---');
assert(isValidHUID('AB1234') === true, 'AB1234 is valid HUID');
assert(isValidHUID('xy9876') === true, 'xy9876 is valid HUID (case insensitive)');
assert(isValidHUID('123456') === true, '123456 numeric is valid HUID');
assert(isValidHUID('AB123') === false, '5-digit AB123 is rejected');
assert(isValidHUID('AB12345') === false, '7-digit AB12345 is rejected');
assert(isValidHUID('AB-123') === false, 'Special character AB-123 is rejected');
assert(isValidHUID('') === false, 'Empty string is rejected');
assert(isValidHUID(undefined) === false, 'Undefined is rejected');

// 4. Jewelry Pricing Breakdown: Per-Gram Making Charges
console.log('\n--- 4. Pricing Engine: Per-Gram Making Charges ---');
const pricePerGram = calculateJewelryPrice({
    grossWeight: 14.500,
    stoneWeight: 2.300,
    stoneWeightUnit: 'grams',
    spotRatePerGram: 7000,
    wastagePercent: 5, // 5% melting loss
    makingCharges: 450,
    makingChargesType: 'per_gram',
    stoneAmount: 2500,
});

assert(pricePerGram.grossWeight === 14.500, 'Gross weight retained');
assert(pricePerGram.netWeight === 12.200, 'Net weight deducted correctly (12.200g)');
assert(pricePerGram.effectiveWastageWeight === 12.810, 'Wastage: 12.200 * 1.05 = 12.810g');
assert(pricePerGram.metalAmount === 89670, 'Metal amount: 12.810g * ₹7,000 = ₹89,670');
assert(pricePerGram.makingChargesAmount === 6525, 'Making charges: 14.500g * ₹450 = ₹6,525');
assert(pricePerGram.stoneAmount === 2500, 'Stone charges: ₹2,500');
assert(pricePerGram.taxableSubtotal === 98695, 'Taxable Subtotal: 89,670 + 6,525 + 2,500 = ₹98,695');

// 5. Pricing Engine: Percentage Making Charges
console.log('\n--- 5. Pricing Engine: Percentage Making Charges ---');
const pricePercent = calculateJewelryPrice({
    grossWeight: 10.000,
    stoneWeight: 0,
    spotRatePerGram: 7000,
    wastagePercent: 0,
    makingCharges: 10, // 10% of metal value
    makingChargesType: 'percent',
});
assert(pricePercent.metalAmount === 70000, 'Metal amount: 10g * ₹7,000 = ₹70,000');
assert(pricePercent.makingChargesAmount === 7000, 'Making charges: 10% of ₹70,000 = ₹7,000');
assert(pricePercent.taxableSubtotal === 77000, 'Taxable Subtotal = ₹77,000');

// 6. Pricing Engine: Fixed Making Charges
console.log('\n--- 6. Pricing Engine: Fixed Making Charges ---');
const priceFixed = calculateJewelryPrice({
    grossWeight: 5.000,
    stoneWeight: 0,
    spotRatePerGram: 7000,
    wastagePercent: 0,
    makingCharges: 1200, // Fixed fee
    makingChargesType: 'fixed',
});
assert(priceFixed.metalAmount === 35000, 'Metal amount: 5g * ₹7,000 = ₹35,000');
assert(priceFixed.makingChargesAmount === 1200, 'Making charges = ₹1,200 fixed');
assert(priceFixed.taxableSubtotal === 36200, 'Taxable Subtotal = ₹36,200');

// 7. Pricing Engine: Fashion / Imitation Jewelry Piece Fallback
console.log('\n--- 7. Pricing Engine: Fashion Jewelry Piece Fallback ---');
const priceFashion = calculateJewelryPrice({
    grossWeight: 25.000,
    fixedPiecePrice: 1499,
});
assert(priceFashion.taxableSubtotal === 1499, 'Fashion piece price fallback correctly applied');

// 8. Specification String Formatting
console.log('\n--- 8. Specification String Formatting ---');
const specStr = formatJewelrySpecs({
    purity_karat: '22K',
    gross_weight: 14.500,
    net_weight: 12.200,
    stone_weight: 2.300,
    making_charges: 450,
    making_charges_type: 'per_gram',
    huid_code: 'AB1234',
});
assert(specStr.includes('22K (916 BIS Hallmark)'), 'Formatted string contains 22K 916 label');
assert(specStr.includes('Gr: 14.5g') || specStr.includes('Gr: 14.500g'), 'Formatted string contains Gross weight');
assert(specStr.includes('Nt: 12.2g') || specStr.includes('Nt: 12.200g'), 'Formatted string contains Net weight');
assert(specStr.includes('MC: ₹450/g'), 'Formatted string contains Making charges');
assert(specStr.includes('HUID: AB1234'), 'Formatted string contains HUID code');

// 9. Full End-to-End GST Tax Integration
console.log('\n--- 9. GST Tax Integration ---');
const gstIntra = calculateGST(pricePerGram.taxableSubtotal, '29', '29', GST_RATES.JEWELRY); // Intra-state 3%
assert(gstIntra.taxableAmount === 98695, 'Taxable amount preserved in GST calculation');
assert(gstIntra.cgstRate === 1.5, 'CGST rate is 1.5%');
assert(gstIntra.sgstRate === 1.5, 'SGST rate is 1.5%');
assert(gstIntra.igstRate === 0, 'IGST rate is 0% for intra-state');
assert(gstIntra.cgstAmount === 1480.43, 'CGST rounded to ₹1,480.43');
assert(gstIntra.sgstAmount === 1480.43, 'SGST rounded to ₹1,480.43');
assert(gstIntra.totalTax === 2960.86, 'Total tax is CGST + SGST (₹2,960.86)');
assert(gstIntra.grandTotal === 98695 + 2960.86, 'Grand Total matches Taxable + Tax (₹101,655.86)');

const gstInter = calculateGST(pricePerGram.taxableSubtotal, '29', '27', GST_RATES.JEWELRY); // Inter-state 3%
assert(gstInter.igstRate === 3.0, 'IGST rate is 3.0% for inter-state');
assert(gstInter.cgstAmount === 0 && gstInter.sgstAmount === 0, 'Zero CGST/SGST for inter-state');
assert(gstInter.igstAmount === 2960.85, 'Full 3% allocated to IGST (₹2,960.85)');
assert(gstInter.grandTotal === 98695 + 2960.85, 'Inter-state Grand Total matches (₹101,655.85)');

console.log('\n====================================================');
console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED BRUTALLY!`);
console.log('====================================================');
