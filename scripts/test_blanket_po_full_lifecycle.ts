import ExcelJS from 'exceljs';
import { pb } from '@/lib/pocketbase';
import {
    createPurchaseOrder,
    getPurchaseOrder,
    generateTimestampPONumber,
    reconcilePOWithInwardBatch,
    approvePODiscrepancy,
} from '@/lib/purchase';
import {
    parseInventoryImportFile,
    commitBulkInventoryImport,
} from '@/lib/excel-import';

async function verifyBlanketPOLifecycle() {
    console.log('================================================================');
    console.log('BLANKET PO FULL LIFECYCLE, OVERHEAD ABSORPTION & APPROVAL AUDIT');
    console.log('================================================================');

    // 1. Authenticate Demo Account
    console.log('\n[1] Authenticating as admin@luminila.local...');
    await pb.collection('users').authWithPassword('admin@luminila.local', 'Luminila2026!');
    const accountEmail = (pb.authStore.model as any)?.email;
    console.log('✓ Authenticated:', accountEmail);

    // 2. Fetch or create a test vendor
    let vendor = await pb.collection('vendors').getFirstListItem('').catch(() => null);
    if (!vendor) {
        vendor = await pb.collection('vendors').create({
            name: 'Sri Murugan Jewellers & Co',
            code: 'SRIM',
            is_active: true,
            account_email: accountEmail,
        });
    }
    console.log('✓ Vendor:', vendor.name, `(ID: ${vendor.id})`);

    // 3. Generate strict timestamp-based PO Reference
    const testDate = new Date();
    const poNumber = generateTimestampPONumber(vendor.name, testDate);
    console.log('\n[2] Strict Timestamp PO Reference Generated:', poNumber);
    if (!poNumber.startsWith('PO-SRIM-')) {
        throw new Error(`Expected PO number to start with PO-SRIM-, got: ${poNumber}`);
    }

    // 4. Create Blanket PO with Budget and Overheads
    console.log('\n[3] Creating Blanket Purchase Order in PocketBase...');
    const createdPO = await createPurchaseOrder({
        vendor_id: vendor.id,
        po_type: 'blanket',
        budget_amount: 100000, // ₹1,00,000 Budget
        gst_paid_overhead: 3000, // ₹3,000 GST paid to vendor (non-refundable for unregistered seller)
        shipping_overhead: 1000, // ₹1,000 Shipping overhead
        absorb_overhead: true,   // Absorb into landed unit cost
        is_unregistered_seller: true,
        notes: 'Test Blanket PO for raw inward stock without line items upfront',
        items: [],
    }, poNumber);

    console.log('✓ Blanket PO created successfully:');
    console.log(`  ID: ${createdPO.id}`);
    console.log(`  PO Number: ${createdPO.po_number}`);
    console.log(`  Budget: ₹${createdPO.budget_amount}`);
    console.log(`  Overheads: GST ₹${createdPO.gst_paid_overhead} + Ship ₹${createdPO.shipping_overhead}`);
    console.log(`  Absorb Overhead: ${createdPO.absorb_overhead}`);
    console.log(`  Discrepancy Status: ${createdPO.discrepancy_status}`);
    console.log(`  Approval Status: ${createdPO.approval_status}`);

    if (createdPO.po_number !== poNumber) {
        throw new Error(`Expected PO number ${poNumber}, got ${createdPO.po_number}`);
    }

    // 5. Generate Excel Import Workbook tagged to this PO
    console.log('\n[4] Generating Inward Intake Excel file with items tagged to PO...');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.columns = [
        { header: 'Product Name *', key: 'name', width: 30 },
        { header: 'SKU', key: 'sku', width: 20 },
        { header: 'Purchase Order Ref', key: 'po_reference', width: 25 },
        { header: 'Category *', key: 'category', width: 20 },
        { header: 'Selling Price (₹) *', key: 'base_price', width: 18 },
        { header: 'Cost Price (₹)', key: 'cost_price', width: 18 },
        { header: 'Stock Quantity *', key: 'stock', width: 18 },
        { header: 'HSN Code', key: 'hsn_code', width: 14 },
    ];

    // Total base inward cost = (50000 * 1) + (30000 * 2) = 50,000 + 60,000 = ₹1,10,000
    // + Item 3: (2000 * 1) = ₹2,000 => Total = ₹1,12,000
    // Total overhead = 3000 + 1000 = ₹4,000
    // Total goods base = ₹1,12,000 => Landed markup multiplier = 1 + (4000 / 112000) = 1.035714...
    // Item 1 base cost 50,000 => Landed cost = 50000 * (1 + 4000/112000) = 51785.71
    // Item 2 base cost 30,000 => Landed cost = 30000 * (1 + 4000/112000) = 31071.43
    // Item 3 base cost 2,000  => Landed cost = 2000 * (1 + 4000/112000) = 2071.43
    const testItems = [
        {
            name: 'TEST Royal Antique Haar',
            sku: `TEST-HAAR-${Date.now()}`,
            po_reference: poNumber,
            category: 'Necklaces',
            base_price: 65000,
            cost_price: 50000,
            stock: 1,
            hsn_code: '71179010',
        },
        {
            name: 'TEST Bridal Jhumka Pair',
            sku: `TEST-JHM-${Date.now()}`,
            po_reference: poNumber,
            category: 'Earrings',
            base_price: 40000,
            cost_price: 30000,
            stock: 2,
            hsn_code: '71179010',
        },
        {
            name: 'TEST Temple Kada Bracelet',
            sku: `TEST-KAD-${Date.now()}`,
            po_reference: poNumber,
            category: 'Bangles',
            base_price: 3500,
            cost_price: 2000,
            stock: 1,
            hsn_code: '71179010',
        },
    ];

    for (const item of testItems) {
        sheet.addRow(item);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    console.log(`✓ Generated Excel buffer (${buffer.byteLength} bytes) with 3 products.`);

    // 6. Parse Excel File
    console.log('\n[5] Parsing Excel File via parseInventoryImportFile...');
    const parsed = await parseInventoryImportFile(buffer, 'test_inward_blanket_po.xlsx');
    console.log(`✓ Parsed rows: ${parsed.totalRows} total, ${parsed.validRows.length} valid, ${parsed.invalidRows.length} invalid`);
    if (parsed.validRows.length !== 3) {
        throw new Error(`Expected 3 valid rows, got ${parsed.validRows.length}`);
    }

    // 7. Commit Inward Intake to Inventory
    console.log('\n[6] Committing Bulk Inventory Import with Landed Overhead Absorption...');
    const commitResult = await commitBulkInventoryImport(parsed.validRows, poNumber);
    console.log(`✓ Commit completed: ${commitResult.successCount} succeeded, ${commitResult.failureCount} failed.`);
    if (commitResult.successCount !== 3) {
        throw new Error(`Failed to commit all products: ${JSON.stringify(commitResult.errors)}`);
    }

    // Verify Reconciled POs from commitResult
    console.log('✓ Reconciled PO status reported by import service:', commitResult.reconciledPOs);
    if (!commitResult.reconciledPOs || commitResult.reconciledPOs.length === 0) {
        throw new Error('Expected reconciled PO report from commitBulkInventoryImport.');
    }
    const recReport = commitResult.reconciledPOs[0];
    console.log(`  PO: ${recReport.poNumber}`);
    console.log(`  Budget: ₹${recReport.budgetAmount}`);
    console.log(`  Inward Cost: ₹${recReport.inwardGoodsCost}`);
    console.log(`  Discrepancy: ₹${recReport.discrepancyAmount}`);
    console.log(`  Status: ${recReport.discrepancyStatus}`);

    if (recReport.discrepancyStatus !== 'over_budget') {
        throw new Error(`Expected PO status 'over_budget', got: ${recReport.discrepancyStatus}`);
    }
    if (recReport.discrepancyAmount !== 12000) {
        throw new Error(`Expected discrepancy ₹12,000 (₹1,12,000 - ₹1,00,000), got: ${recReport.discrepancyAmount}`);
    }

    // 8. Verify Landed Cost Price Inflation on Created Products
    console.log('\n[7] Verifying Landed Unit Cost Inflation in Database...');
    const createdProduct1 = await pb.collection('products').getFirstListItem(`sku="${testItems[0].sku}"`);
    console.log(`  Item 1 Base Cost: ₹${testItems[0].cost_price} -> Landed Cost in DB: ₹${createdProduct1.cost_price}`);
    const expectedCost1 = Math.round((50000 * (1 + 4000 / 112000)) * 100) / 100;
    if (Math.abs(createdProduct1.cost_price - expectedCost1) > 0.05) {
        throw new Error(`Expected landed cost ~₹${expectedCost1}, got ₹${createdProduct1.cost_price}`);
    }
    console.log('✓ Landed overhead absorption verified mathematically!');

    // 9. Verify PO Record State
    console.log('\n[8] Verifying Updated PO Record in PocketBase...');
    const updatedPO = await getPurchaseOrder(createdPO.id);
    if (!updatedPO) throw new Error('Could not retrieve updated PO');

    console.log(`  Status: ${updatedPO.status}`);
    console.log(`  Inward Goods Cost: ₹${updatedPO.inward_goods_cost}`);
    console.log(`  Discrepancy Amount: ₹${updatedPO.discrepancy_amount}`);
    console.log(`  Discrepancy Status: ${updatedPO.discrepancy_status}`);
    console.log(`  Approval Status: ${updatedPO.approval_status}`);

    if (updatedPO.approval_status !== 'pending_approval') {
        throw new Error(`Expected approval_status 'pending_approval', got: ${updatedPO.approval_status}`);
    }

    // 10. Attempt Approval without remarks (Must fail strictly)
    console.log('\n[9] Testing Strict Guard: Approve discrepancy without remarks (Must Throw)...');
    let rejected = false;
    try {
        await approvePODiscrepancy(createdPO.id, '   ');
    } catch (err: any) {
        rejected = true;
        console.log('✓ Strict approval rejected empty remarks as expected:', err.message);
    }
    if (!rejected) {
        throw new Error('Approval should have thrown error on empty remarks!');
    }

    // 11. Approve Discrepancy with Manager Remarks
    console.log('\n[10] Approving Discrepancy with Valid Manager Remarks...');
    const approvalRemarks = 'Approved additional ₹12,000 stock intake due to festive season demand spike. Overheads absorbed into inventory landed cost.';
    const approvedPO = await approvePODiscrepancy(createdPO.id, approvalRemarks, 'Senior Inventory Auditor');

    console.log('✓ Approval Successful:');
    console.log(`  Approval Status: ${approvedPO.approval_status}`);
    console.log(`  Approved By: ${approvedPO.approved_by}`);
    console.log(`  Approved At: ${approvedPO.approved_at}`);
    console.log(`  Remarks: ${approvedPO.approval_remarks}`);

    if (approvedPO.approval_status !== 'approved') {
        throw new Error(`Expected approval_status 'approved', got: ${approvedPO.approval_status}`);
    }
    if (approvedPO.approved_by !== 'Senior Inventory Auditor') {
        throw new Error(`Expected approver 'Senior Inventory Auditor', got: ${approvedPO.approved_by}`);
    }

    // 12. Cleanup Test Records
    console.log('\n[11] Cleaning up test records...');
    for (const item of testItems) {
        const p = await pb.collection('products').getFirstListItem(`sku="${item.sku}"`).catch(() => null);
        if (p) {
            const variants = await pb.collection('product_variants').getFullList({ filter: `product="${p.id}"` });
            for (const v of variants) {
                const movs = await pb.collection('stock_movements').getFullList({ filter: `variant="${v.id}"` }).catch(() => []);
                for (const m of movs) await pb.collection('stock_movements').delete(m.id).catch(() => {});
                await pb.collection('product_variants').delete(v.id).catch(() => {});
            }
            await pb.collection('products').delete(p.id).catch(() => {});
        }
    }
    await pb.collection('purchase_orders').delete(createdPO.id).catch(() => {});
    console.log('✓ Cleanup completed.');

    console.log('\n================================================================');
    console.log('✓ ALL TESTS PASSED: BLANKET PO, OVERHEADS, DISCREPANCY & APPROVAL');
    console.log('================================================================');
}

verifyBlanketPOLifecycle().catch((err) => {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
});
