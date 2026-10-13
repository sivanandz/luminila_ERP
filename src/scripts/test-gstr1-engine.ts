/**
 * BRUTAL VERIFICATION TEST SUITE: Phase 4 - Official Statutory GSTR-1 Return Exports Engine
 */

import {
    isValidGstin,
    extractStateCode,
    formatGstnDate,
    normalizeUqc,
    compileGstr1Payload,
    validateGstr1Payload,
    exportGstr1JsonString,
    SourceInvoice,
} from '../lib/gstr1-engine';

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
console.log('BRUTALLY TESTING: Phase 4 Statutory GSTR-1 Return Exports Engine');
console.log('============================================================\n');

// -------------------------------------------------------------------------
// TEST 1: GSTIN & State Code Normalization
// -------------------------------------------------------------------------
console.log('Suite 1: GSTIN & State Code Validation');
{
    assert(isValidGstin('29AABCU9603R1ZM') === true, 'Accepts valid 15-digit GSTIN (Karnataka 29)');
    assert(isValidGstin('33AAAAA0000A1Z5') === true, 'Accepts valid 15-digit GSTIN (Tamil Nadu 33)');
    assert(isValidGstin('29AABCU9603R1Z') === false, 'Rejects 14-digit GSTIN');
    assert(isValidGstin('29AABCU9603R1ZMM') === false, 'Rejects 16-digit GSTIN');
    assert(isValidGstin('URP') === false, 'Rejects "URP" (Unregistered Person)');
    assert(isValidGstin('') === false, 'Rejects empty string');

    assert(extractStateCode('29AABCU9603R1ZM') === '29', 'Extracts state code "29" from GSTIN');
    assert(extractStateCode('33') === '33', 'Extracts "33" from state code string');
    assert(normalizeUqc('grams') === 'GMS', 'Normalizes "grams" to "GMS"');
    assert(normalizeUqc('carats') === 'CTS', 'Normalizes "carats" to "CTS"');
    assert(normalizeUqc('pcs') === 'PCS', 'Normalizes "pcs" to "PCS"');
}

// -------------------------------------------------------------------------
// TEST 2: Date Formatting to Statutory DD-MM-YYYY
// -------------------------------------------------------------------------
console.log('\nSuite 2: Statutory Date Formatting');
{
    assert(formatGstnDate('2026-10-13T10:00:00Z') === '13-10-2026', 'Formats ISO string to "13-10-2026"');
    assert(formatGstnDate('2026-05-04') === '04-05-2026', 'Formats date string with leading zeroes');
}

// -------------------------------------------------------------------------
// TEST 3: Full Statutory Compilation (Tables 4, 5, 7, 9B, 12, 13)
// -------------------------------------------------------------------------
console.log('\nSuite 3: Multi-Transaction GSTR-1 Compilation');
{
    const invoices: SourceInvoice[] = [
        // 1. Table 4: B2B Regular (Wholesale to registered jeweller in Karnataka)
        {
            id: 'inv-1',
            invoice_number: 'INV-2026-001',
            invoice_date: '2026-10-02',
            invoice_type: 'regular',
            buyer_name: 'Mayur Jewellers B2B',
            buyer_gstin: '29AABCU9603R1ZM',
            place_of_supply: '29',
            grand_total: 103000,
            taxable_value: 100000,
            cgst_amount: 1500,
            sgst_amount: 1500,
            igst_amount: 0,
            items: [
                {
                    description: '22K Gold Bangles',
                    hsn_code: '7113',
                    quantity: 14.500,
                    unit: 'GMS',
                    taxable_amount: 100000,
                    gst_rate: 3.0,
                    cgst_amount: 1500,
                    sgst_amount: 1500,
                    igst_amount: 0,
                    total: 103000,
                }
            ]
        },
        // 2. Table 5: B2CL (Inter-state retail sale to unregistered customer > ₹2.5 Lakhs)
        {
            id: 'inv-2',
            invoice_number: 'INV-2026-002',
            invoice_date: '2026-10-05',
            invoice_type: 'regular',
            buyer_name: 'Lakshmi Narayanan (Chennai)',
            buyer_gstin: '', // Unregistered!
            place_of_supply: '33', // Tamil Nadu (Inter-state from KA 29!)
            grand_total: 309000, // > ₹2,50,000!
            taxable_value: 300000,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 9000, // 3% IGST
            items: [
                {
                    description: 'Bridal Diamond Necklace 18K',
                    hsn_code: '7113',
                    quantity: 42.000,
                    unit: 'GMS',
                    taxable_amount: 250000,
                    gst_rate: 3.0,
                    igst_amount: 7500,
                    total: 257500,
                },
                {
                    description: 'Certified Solitaire Diamonds',
                    hsn_code: '7102',
                    quantity: 2.500,
                    unit: 'CTS',
                    taxable_amount: 50000,
                    gst_rate: 3.0, // Or 1.5/0.25 depending on rough vs cut
                    igst_amount: 1500,
                    total: 51500,
                }
            ]
        },
        // 3. Table 7: B2CS (Intra-state retail sale to local walk-in customer)
        {
            id: 'inv-3',
            invoice_number: 'INV-2026-003',
            invoice_date: '2026-10-08',
            invoice_type: 'regular',
            buyer_name: 'Walk-in Retail Buyer',
            buyer_gstin: '',
            place_of_supply: '29', // Intra-state Karnataka
            grand_total: 51500,
            taxable_value: 50000,
            cgst_amount: 750,
            sgst_amount: 750,
            igst_amount: 0,
            items: [
                {
                    description: '22K Gold Chain',
                    hsn_code: '7113',
                    quantity: 7.250,
                    unit: 'GMS',
                    taxable_amount: 50000,
                    gst_rate: 3.0,
                    cgst_amount: 750,
                    sgst_amount: 750,
                    igst_amount: 0,
                    total: 51500,
                }
            ]
        },
        // 4. Table 7: B2CS (Small inter-state retail sale <= ₹2.5 Lakhs)
        {
            id: 'inv-4',
            invoice_number: 'INV-2026-004',
            invoice_date: '2026-10-10',
            invoice_type: 'regular',
            buyer_name: 'Kavita Reddy (Hyderabad)',
            buyer_gstin: '',
            place_of_supply: '36', // Telangana
            grand_total: 82400, // < ₹2.5 Lakhs -> goes to B2CS!
            taxable_value: 80000,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 2400,
            items: [
                {
                    description: '22K Gold Earrings',
                    hsn_code: '7113',
                    quantity: 11.000,
                    unit: 'GMS',
                    taxable_amount: 80000,
                    gst_rate: 3.0,
                    igst_amount: 2400,
                    total: 82400,
                }
            ]
        },
        // 5. Table 9B: CDNR (Registered Credit Note for Mayur Jewellers)
        {
            id: 'cn-1',
            invoice_number: 'CN-2026-001',
            invoice_date: '2026-10-11',
            invoice_type: 'credit_note',
            buyer_name: 'Mayur Jewellers B2B',
            buyer_gstin: '29AABCU9603R1ZM',
            place_of_supply: '29',
            original_invoice_number: 'INV-2026-001',
            original_invoice_date: '2026-10-02',
            grand_total: 10300,
            taxable_value: 10000,
            cgst_amount: 150,
            sgst_amount: 150,
            igst_amount: 0,
        },
        // 6. Cancelled invoice (Should be counted in Table 13 doc_issue, but omitted from sales)
        {
            id: 'inv-canc',
            invoice_number: 'INV-2026-005',
            invoice_date: '2026-10-12',
            invoice_type: 'regular',
            buyer_name: 'Mistake Invoice',
            grand_total: 10000,
            status: 'cancelled',
        }
    ];

    const payload = compileGstr1Payload(invoices, {
        supplierGstin: '29AABCS1429B1ZB',
        financialPeriod: '102026',
        supplierStateCode: '29',
        b2cLargeThreshold: 250000,
        grossTurnoverPrecedingFy: 15000000,
        currentTurnover: 4200000,
    });

    // Check Header
    assert(payload.gstin === '29AABCS1429B1ZB', 'Supplier GSTIN matches');
    assert(payload.fp === '102026', 'Financial period is 102026');
    assert(payload.version === 'GST3.0.4', 'Offline schema version is GST3.0.4');

    // Check Table 4: B2B
    assert(payload.b2b.length === 1, 'Table 4 has 1 B2B recipient (Mayur Jewellers)', `Got ${payload.b2b.length}`);
    assert(payload.b2b[0].ctin === '29AABCU9603R1ZM', 'B2B CTIN is Mayur Jewellers');
    assert(payload.b2b[0].inv.length === 1, 'B2B recipient has 1 invoice');
    assert(payload.b2b[0].inv[0].inum === 'INV-2026-001', 'B2B invoice number is INV-2026-001');
    assert(payload.b2b[0].inv[0].itms[0].num === 1, 'Item sequential number is 1');
    assert(payload.b2b[0].inv[0].itms[0].itm_det.rt === 3.0, 'B2B GST rate is 3.0%');
    assert(payload.b2b[0].inv[0].itms[0].itm_det.camt === 1500, 'B2B CGST is ₹1,500');
    assert(payload.b2b[0].inv[0].itms[0].itm_det.samt === 1500, 'B2B SGST is ₹1,500');

    // Check Table 5: B2CL
    assert(payload.b2cl.length === 1, 'Table 5 has 1 B2CL state group (Tamil Nadu 33)', `Got ${payload.b2cl.length}`);
    assert(payload.b2cl[0].pos === '33', 'B2CL Place of Supply is 33');
    assert(payload.b2cl[0].inv[0].inum === 'INV-2026-002', 'B2CL invoice number is INV-2026-002 (Chennai > ₹2.5L)');
    assert(payload.b2cl[0].inv[0].val === 309000, 'B2CL invoice value is ₹309,000');

    // Check Table 7: B2CS
    // Expect 2 entries: 1 for INTRA pos 29 @ 3%, 1 for INTER pos 36 @ 3%
    assert(payload.b2cs.length === 2, 'Table 7 has 2 consolidated B2CS entries', `Got ${payload.b2cs.length}`);
    const intraB2cs = payload.b2cs.find(b => b.sply_ty === 'INTRA' && b.pos === '29');
    assert(intraB2cs !== undefined, 'Found INTRA POS 29 B2CS entry');
    assert(intraB2cs?.txval === 50000, 'INTRA POS 29 taxable value is ₹50,000');
    assert(intraB2cs?.camt === 750, 'INTRA POS 29 CGST is ₹750');
    assert(intraB2cs?.samt === 750, 'INTRA POS 29 SGST is ₹750');

    const interB2cs = payload.b2cs.find(b => b.sply_ty === 'INTER' && b.pos === '36');
    assert(interB2cs !== undefined, 'Found INTER POS 36 B2CS entry');
    assert(interB2cs?.txval === 80000, 'INTER POS 36 taxable value is ₹80,000');
    assert(interB2cs?.iamt === 2400, 'INTER POS 36 IGST is ₹2,400');

    // Check Table 9B: CDNR
    assert(payload.cdnr !== undefined, 'Table 9B CDNR is populated');
    assert(payload.cdnr?.length === 1, '1 CDNR recipient');
    assert(payload.cdnr?.[0].nt[0].nt_num === 'CN-2026-001', 'Credit Note number is CN-2026-001');
    assert(payload.cdnr?.[0].nt[0].inum === 'INV-2026-001', 'References original invoice INV-2026-001');

    // Check Table 12: HSN Summary
    assert(payload.hsn.data.length === 2, 'Table 12 has 2 HSN groups (7113 Jewelry + 7102 Diamonds)', `Got ${payload.hsn.data.length}`);
    const hsn7113 = payload.hsn.data.find(h => h.hsn_sc === '7113');
    assert(hsn7113 !== undefined, 'HSN 7113 (Jewelry) present');
    assert(hsn7113?.uqc === 'GMS', 'Jewelry UQC is GMS');
    // Total Jewelry weight: 14.5 + 42.0 + 7.25 + 11.0 = 74.750g
    assert(hsn7113?.qty === 74.750, 'Jewelry total quantity is 74.750 grams', `Got ${hsn7113?.qty}`);
    assert(payload.hsn.data[0].num === 1, 'First HSN row num is strictly 1');
    assert(payload.hsn.data[1].num === 2, 'Second HSN row num is strictly 2');

    // Check Table 13: Documents Issued
    assert(payload.doc_issue !== undefined, 'Table 13 doc_issue populated');
    const invDocs = payload.doc_issue?.doc_det.find(d => d.doc_num === 1);
    assert(invDocs !== undefined, 'Found invoice document section');
    assert(invDocs?.docs[0].from === 'INV-2026-001', 'First invoice is INV-2026-001');
    assert(invDocs?.docs[0].to === 'INV-2026-005', 'Last invoice is INV-2026-005');
    assert(invDocs?.docs[0].totnum === 5, 'Total invoices: 5');
    assert(invDocs?.docs[0].canc === 1, 'Cancelled invoices: 1 (INV-2026-005)');
    assert(invDocs?.docs[0].net_issue === 4, 'Net issued invoices: 4');

    // Validation Check
    const validation = validateGstr1Payload(payload);
    assert(validation.valid === true, 'Compiled payload passes all GSTN statutory schema validations', `Errors: ${validation.errors.join(', ')}`);
    assert(validation.errors.length === 0, 'Zero statutory validation errors');

    // Export JSON string verification
    const jsonStr = exportGstr1JsonString(payload);
    assert(typeof jsonStr === 'string' && jsonStr.length > 500, 'JSON string exported successfully');
    const parsed = JSON.parse(jsonStr);
    assert(parsed.gstin === '29AABCS1429B1ZB', 'JSON string is valid and round-trip parseable');
}

console.log('\n============================================================');
console.log(`PHASE 4 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
if (passedTests === totalTests) {
    console.log('STATUS: BRUTAL VERIFICATION PHASE 4 SUCCESSFUL! 🚀');
} else {
    console.error('STATUS: VERIFICATION FAILED! ❌');
    process.exit(1);
}
console.log('============================================================\n');
