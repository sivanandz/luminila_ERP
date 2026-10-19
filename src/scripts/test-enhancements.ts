import { pb } from '../lib/pocketbase';
import {
    markStockDiscrepancy,
    resolveStockDiscrepancy,
    getStockDiscrepancies,
    getDiscrepancyStats
} from '../lib/discrepancies';
import {
    createCreditNote,
    approveCreditNote,
    processExchange,
    getCreditNote,
} from '../lib/returns';
import { getStoreSettings } from '../lib/invoice';

async function runTests() {
    console.log('Authenticating with PocketBase...');
    try {
        await pb.collection('users').authWithPassword('admin@luminila.local', 'Luminila2026!');
    } catch {
        await pb.collection('_superusers').authWithPassword('admin@luminila.local', 'Luminila2026!');
    }
    console.log('✓ Authenticated as:', pb.authStore.record?.email || 'admin');

    console.log('=== [1] TESTING STORE SETTINGS & LOGO ===');
    const store = await getStoreSettings();
    console.log('Store Name:', store?.store_name);
    console.log('Store Phone:', store?.store_phone);
    console.log('Store GSTIN:', store?.store_gstin);
    console.log('Store Logo Present:', Boolean(store?.store_logo && store?.store_logo.length > 50));

    console.log('✓ Store settings validation checked.');

    console.log('\n=== [2] TESTING STOCK DISCREPANCIES & QUARANTINE LEDGER ===');
    // Find an active variant with stock
    const variants = await pb.collection('product_variants').getFullList({
        filter: 'stock_level > 5',
        sort: '-stock_level',
    });
    if (variants.length === 0) {
        throw new Error('No variants found with stock > 5 for test');
    }

    const testVariant = variants[0];
    const initialStock = testVariant.stock_level;
    const testSku = testVariant.variant_name || testVariant.sku || 'NECK-22K-001';
    console.log(`Using Variant ${testSku} (ID: ${testVariant.id}) with initial stock: ${initialStock}`);

    // Mark 2 units as returned to vendor for replacement
    const discrepancy = await markStockDiscrepancy({
        variant_id: testVariant.id,
        sku: testSku,
        product_name: 'Test Ornament Piece',
        discrepancy_type: 'vendor_replacement',
        quantity: 2,
        vendor_name: 'Rajkot Heritage Jewellers',
        reason: 'Loose prong setting sent for vendor repair and replacement',
        notes: 'Automated test suite run',
        flagged_by: 'QA Admin',
    });
    console.log(`Created Discrepancy Record ID: ${discrepancy.id}`);

    // Verify variant stock dropped by 2
    const vAfterQuarantine = await pb.collection('product_variants').getOne(testVariant.id);
    console.log(`Stock after quarantine: ${vAfterQuarantine.stock_level} (Expected: ${initialStock - 2})`);
    if (vAfterQuarantine.stock_level !== initialStock - 2) {
        throw new Error(`Stock deduction failed! Expected ${initialStock - 2}, got ${vAfterQuarantine.stock_level}`);
    }

    // Verify stats
    const stats = await getDiscrepancyStats();
    console.log('Active Quarantine Stats:', stats);

    // Resolve discrepancy (vendor replacement arrives)
    await resolveStockDiscrepancy(discrepancy.id, {
        resolution_action: 'replacement_received',
        quantity_received: 2,
        resolution_note: 'Fresh replacement piece received from Rajkot vendor and verified',
        resolved_by: 'QA Admin',
    });

    const vAfterResolution = await pb.collection('product_variants').getOne(testVariant.id);
    console.log(`Stock after vendor replacement resolution: ${vAfterResolution.stock_level} (Expected: ${initialStock})`);
    if (vAfterResolution.stock_level !== initialStock) {
        throw new Error(`Stock restoration failed! Expected ${initialStock}, got ${vAfterResolution.stock_level}`);
    }
    console.log('✓ Stock discrepancy & quarantine lifecycle passed.');

    console.log('\n=== [3] TESTING CUSTOMER RETURN & EXCHANGE / REPLACEMENT LIFECYCLE ===');
    // Create a credit note for customer return
    const cn = await createCreditNote(
        {
            buyer_name: 'Priya Sundaram',
            buyer_address: 'Indiranagar 100ft Road, Bengaluru',
            return_reason: 'defective',
            notes: 'Clasp broken during first wear',
            taxable_value: 1000,
            cgst_amount: 15,
            sgst_amount: 15,
            igst_amount: 0,
            total_tax: 30,
            grand_total: 1030,
        },
        [
            {
                description: 'Kundan Choker Necklace',
                variant_id: testVariant.id,
                quantity: 1,
                unit_price: 1000,
                taxable_amount: 1000,
                gst_rate: 3,
                cgst_amount: 15,
                sgst_amount: 15,
                igst_amount: 0,
                total_amount: 1030,
            }
        ]
    );
    console.log(`Created Credit Note: ${cn.credit_note_number} (ID: ${cn.id})`);

    // Approve credit note with defective item routed to quarantine
    await approveCreditNote(cn.id!, {
        routeDefectiveToQuarantine: true,
        discrepancyType: 'damaged',
        notes: 'Clasp broken. Held in damaged quarantine.',
    });

    const approvedCN = await getCreditNote(cn.id!);
    console.log(`Credit note status after approval: ${approvedCN?.status}`);
    if (approvedCN?.status !== 'approved') {
        throw new Error(`Credit note status expected "approved", got "${approvedCN?.status}"`);
    }

    // Now process customer exchange for a replacement item
    const replacementVariant = variants[1] || variants[0];
    const repInitialStock = (await pb.collection('product_variants').getOne(replacementVariant.id)).stock_level;
    const repSku = replacementVariant.variant_name || replacementVariant.sku || 'TMPNECCHK00002-MGRBSTD';
    console.log(`Replacement Variant: ${repSku}, Current Stock: ${repInitialStock}`);

    // Customer picks replacement costing ₹1,500 + GST (extra due = replacement incl. GST − credit incl. GST)
    const exResult = await processExchange(
        cn.id!,
        [
            {
                variant_id: replacementVariant.id,
                description: `Replacement: ${repSku}`,
                quantity: 1,
                unit_price: 1500,
            }
        ],
        {
            paymentMethod: 'upi',
            paymentReference: 'UPI-REF-99882211',
            notes: 'Customer upgraded to higher tier set and paid difference via UPI',
        }
    );

    console.log('Exchange Result:', {
        creditUsed: exResult.creditUsed,
        replacementTotal: exResult.replacementTotal,
        balanceDue: exResult.balanceDue,
        paymentMethod: exResult.paymentMethod,
    });

    // Balance due must be tax-inclusive vs tax-inclusive (processExchange computes replacement
    // grand_total incl. GST so it is comparable with the GST-inclusive credit value).
    const expectedBalanceDue = exResult.replacementTotal - 1030;
    if (exResult.balanceDue !== expectedBalanceDue) {
        throw new Error(`Balance calculation mismatch: expected ${expectedBalanceDue}, got ${exResult.balanceDue}`);
    }
    if (exResult.replacementTotal <= 1500) {
        throw new Error(`Replacement total must be tax-inclusive (≥ ₹1,500 + GST), got ${exResult.replacementTotal}`);
    }

    // Verify replacement stock decremented
    const repAfterStock = (await pb.collection('product_variants').getOne(replacementVariant.id)).stock_level;
    console.log(`Replacement variant stock after exchange: ${repAfterStock} (Expected: ${repInitialStock - 1})`);
    if (repAfterStock !== repInitialStock - 1) {
        throw new Error(`Replacement variant stock did not decrement! Expected ${repInitialStock - 1}, got ${repAfterStock}`);
    }

    const exchangedCN = await getCreditNote(cn.id!);
    console.log(`Exchanged Credit Note status: ${exchangedCN?.status}`);
    console.log(`Exchanged Credit Note audit notes:\n${exchangedCN?.notes}`);
    if (exchangedCN?.status !== 'exchanged') {
        throw new Error(`Credit note status expected "exchanged", got "${exchangedCN?.status}"`);
    }
    console.log('✓ Customer return & replacement lifecycle test passed.');

    console.log('\n=============================================');
    console.log('ALL AUTOMATED BACKEND & ERP TESTS PASSED 100%');
    console.log('=============================================');
}

runTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
