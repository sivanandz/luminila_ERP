/**
 * Verification for the inward QC routing decisions used by return approval.
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { executeInwardQcInspection, type ReturnedItemInput } from '../lib/returns-qc-engine';

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

const item = (reason: ReturnedItemInput['returnReason']): ReturnedItemInput => ({
    variantId: 'v1',
    productName: 'Gold Ring',
    quantityReturned: 1,
    unitPrice: 1180,
    taxRate: 18,
    returnReason: reason,
});

console.log('returns-qc');

test('grade A restocks the item', () => {
    const result = executeInwardQcInspection({
        returnNumber: 'CN-1',
        originalInvoiceNumber: 'INV-1',
        customerName: 'Asha',
        returnedItems: [item('manufacturing_defect')],
        dispositionGrade: 'restock_grade_a',
    });
    assert.equal(result.inventoryActions[0].action, 'restock');
    assert.equal(result.inventoryActions[0].quantity, 1);
});

test('repair grade routes to the karigar queue', () => {
    const result = executeInwardQcInspection({
        returnNumber: 'CN-2',
        originalInvoiceNumber: 'INV-2',
        customerName: 'Asha',
        returnedItems: [item('manufacturing_defect')],
        dispositionGrade: 'karigar_repair',
    });
    assert.equal(result.inventoryActions[0].action, 'route_to_karigar');
    assert.match(result.inventoryActions[0].targetLocation, /Karigar/i);
});

test('write-off grade never returns stock to sellable inventory', () => {
    const result = executeInwardQcInspection({
        returnNumber: 'CN-3',
        originalInvoiceNumber: 'INV-3',
        customerName: 'Asha',
        returnedItems: [item('transit_damage')],
        dispositionGrade: 'damaged_writeoff',
    });
    assert.equal(result.inventoryActions[0].action, 'write_off_scrap');
});

test('store faults carry no deductions, remorse does', () => {
    const storeFault = executeInwardQcInspection({
        returnNumber: 'CN-4',
        originalInvoiceNumber: 'INV-4',
        customerName: 'Asha',
        returnedItems: [item('manufacturing_defect')],
        dispositionGrade: 'restock_grade_a',
        restockingFeePercent: 10,
        reverseShippingFeeDeduction: 50,
    });
    assert.equal(storeFault.totalDeductions, 0);
    assert.equal(storeFault.netRefundCreditAmount, 1180);

    const remorse = executeInwardQcInspection({
        returnNumber: 'CN-5',
        originalInvoiceNumber: 'INV-5',
        customerName: 'Asha',
        returnedItems: [item('customer_remorse')],
        dispositionGrade: 'restock_grade_a',
        restockingFeePercent: 10,
        reverseShippingFeeDeduction: 50,
    });
    assert.equal(remorse.totalDeductions, 168);
    assert.equal(remorse.netRefundCreditAmount, 1012);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
