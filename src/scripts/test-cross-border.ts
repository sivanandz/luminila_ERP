/**
 * Verification for the cross-border export invoice engine.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import {
    compileLutExportInvoice,
    convertForeignToInr,
    convertInrToForeign,
    type LutExportInvoiceRequest,
} from '../lib/cross-border-engine';

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

const request: LutExportInvoiceRequest = {
    invoiceNumber: 'EXP-20261023-001',
    invoiceDate: '2026-10-23',
    buyerName: 'Aurora Gems LLC',
    buyerCountry: 'United States',
    buyerAddress: '5th Avenue, New York',
    currency: 'USD',
    exchangeRateToInr: 83,
    items: [
        { sku: 'RG-001', description: 'Gold ring', hsnCode: '7113', quantity: 2, unitPriceInr: 41500 },
        { sku: 'NK-002', description: 'Gold necklace', hsnCode: '7113', quantity: 1, unitPriceInr: 83000 },
    ],
    isLutExport: true,
    lutArnNumber: 'AD1234567890123',
    portCode: 'INBLR4',
};

console.log('cross-border');

test('INR converts to foreign currency at a custom rate', () => {
    const result = convertInrToForeign(83000, 'USD', 83);
    assert.equal(result.foreignAmount, 1000);
    assert.equal(result.exchangeRate, 83);
    assert.match(result.formattedDisplay, /\$1000\.00/);
});

test('foreign currency converts back to INR', () => {
    assert.equal(convertForeignToInr(1000, 'USD', 83), 83000);
});

test('a LUT export is zero-rated', () => {
    const invoice = compileLutExportInvoice(request);
    assert.equal(invoice.exportType, 'LUT_ZERO_RATED');
    assert.equal(invoice.totals.inrGstTotal, 0);
    assert.equal(invoice.totals.inrGrandTotal, invoice.totals.inrSubtotal);
    assert.equal(invoice.totals.inrSubtotal, 166000);
});

test('foreign line totals use the unit rate, not the INR line total', () => {
    const invoice = compileLutExportInvoice(request);
    assert.equal(invoice.lineItems[0].unitPriceForeign, 500);
    assert.equal(invoice.lineItems[0].totalForeign, 1000);
    assert.equal(invoice.lineItems[1].totalForeign, 1000);
    assert.equal(invoice.totals.foreignSubtotal, 2000);
});

test('an IGST-paid export charges 3 percent', () => {
    const invoice = compileLutExportInvoice({ ...request, isLutExport: false });
    assert.equal(invoice.exportType, 'IGST_PAID_EXPORT');
    assert.equal(invoice.totals.inrGstTotal, 4980);
    assert.equal(invoice.totals.inrGrandTotal, 170980);
    assert.equal(invoice.lutDetails, undefined);
});

test('the declaration names the LUT and its ARN', () => {
    const invoice = compileLutExportInvoice(request);
    assert.match(invoice.declarationText, /LETTER OF UNDERTAKING/);
    assert.equal(invoice.lutDetails?.arnNumber, 'AD1234567890123');
    assert.equal(invoice.lutDetails?.portCode, 'INBLR4');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
