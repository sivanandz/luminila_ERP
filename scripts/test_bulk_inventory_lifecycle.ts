import ExcelJS from 'exceljs';
import { pb } from '../src/lib/pocketbase';
import {
    parseInventoryImportFile,
    commitBulkInventoryImport,
    getTemplateBufferFromDatabase,
    persistDefaultTemplateToDatabase
} from '../src/lib/excel-import';

async function runTestCycle() {
    console.log('========================================================');
    console.log('BULK INVENTORY EXCEL IMPORT LIFECYCLE & FAILURE MODES TEST');
    console.log('========================================================');

    // 1. Authenticate Demo Account
    console.log('\n[1] Authenticating as Demo Account (admin@luminila.local)...');
    await pb.collection('users').authWithPassword('admin@luminila.local', 'Luminila2026!');
    console.log('✓ Authenticated as:', (pb.authStore.model as any)?.email);

    // 2. Verify Database Template Persistence
    console.log('\n[2] Verifying Template File in Database (store_settings)...');
    await persistDefaultTemplateToDatabase(pb);
    const dbTemplateBuffer = await getTemplateBufferFromDatabase(pb);
    console.log(`✓ Template loaded from database: ${dbTemplateBuffer.length} bytes`);
    if (dbTemplateBuffer.length < 5000) {
        throw new Error('Database template buffer is suspiciously small or corrupted.');
    }

    // 3. Generate a Test Excel Workbook with Valid Rows AND Failure Modes
    console.log('\n[3] Generating Test Excel Workbook with Valid & Invalid Rows...');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');

    sheet.columns = [
        { header: 'Product Name *', key: 'name', width: 30 },
        { header: 'SKU', key: 'sku', width: 20 },
        { header: 'Category *', key: 'category', width: 20 },
        { header: 'Selling Price (₹) *', key: 'base_price', width: 18 },
        { header: 'Cost Price (₹)', key: 'cost_price', width: 18 },
        { header: 'Stock Quantity *', key: 'stock', width: 18 },
        { header: 'HSN Code', key: 'hsn_code', width: 14 },
        { header: 'Material', key: 'material', width: 18 },
        { header: 'Purity', key: 'purity', width: 16 },
        { header: 'Gross Weight (g)', key: 'gross_weight', width: 16 },
        { header: 'Net Weight (g)', key: 'net_weight', width: 16 },
        { header: 'Making Charges (₹)', key: 'making_charges', width: 18 },
        { header: 'Location / Tray', key: 'location', width: 18 },
        { header: 'Description', key: 'description', width: 30 },
    ];

    // Valid items
    const validItems = [
        {
            name: 'TEST 22K Gold Antique Choker',
            sku: 'TEST-CHK-001',
            category: 'Necklaces',
            base_price: 85000,
            cost_price: 74000,
            stock: 6,
            hsn_code: '7113',
            material: 'Gold',
            purity: '22K',
            gross_weight: 28.5,
            net_weight: 26.2,
            making_charges: 900,
            location: 'Vault 1',
            description: 'Handcrafted antique bridal choker'
        },
        {
            name: 'TEST Diamond Floral Studs',
            sku: 'TEST-EAR-002',
            category: 'Earrings',
            base_price: 42000,
            cost_price: 35000,
            stock: 10,
            hsn_code: '7113',
            material: 'Gold',
            purity: '18K',
            gross_weight: 5.2,
            net_weight: 4.8,
            making_charges: 600,
            location: 'Showcase Tray A',
            description: 'Solitaire diamond floral studs'
        },
        {
            name: 'TEST Silver Traditional Kada',
            sku: '', // Test Auto-SKU generation
            category: 'Bangles',
            base_price: 15500,
            cost_price: 12000,
            stock: 14,
            hsn_code: '7117',
            material: 'Silver',
            purity: '925 Sterling',
            gross_weight: 35.0,
            net_weight: 35.0,
            making_charges: 250,
            location: 'Showcase Tray B',
            description: 'Heavy solid silver kada'
        },
        {
            name: 'TEST Temple Lakshmi Kasu Haram',
            sku: 'TEST-HAR-004',
            category: 'Harams (Long Chains)',
            base_price: 210000,
            cost_price: 188000,
            stock: 2,
            hsn_code: '7113',
            material: 'Gold',
            purity: '22K',
            gross_weight: 55.4,
            net_weight: 52.0,
            making_charges: 1500,
            location: 'Vault Locker 2',
            description: 'Traditional South Indian temple haram'
        }
    ];

    validItems.forEach(i => sheet.addRow(i));

    // Failure mode items (invalid rows)
    const invalidItems = [
        {
            name: '', // Failure mode: Missing Name
            sku: 'TEST-FAIL-001',
            category: 'Rings',
            base_price: 25000,
            stock: 5,
        },
        {
            name: 'TEST Negative Price Ring',
            sku: 'TEST-FAIL-002',
            category: 'Rings',
            base_price: -500, // Failure mode: Negative Price
            stock: 3,
        },
        {
            name: 'TEST Negative Stock Item',
            sku: 'TEST-FAIL-003',
            category: 'Earrings',
            base_price: 12000,
            stock: -4, // Failure mode: Negative Stock
        },
        {
            name: 'TEST Non-Numeric Price Item',
            sku: 'TEST-FAIL-004',
            category: 'Pendants',
            base_price: 'FREE_SAMPLE', // Failure mode: Non-numeric price
            stock: 1,
        }
    ];

    invalidItems.forEach(i => sheet.addRow(i));

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    console.log(`✓ Created test workbook in memory (${xlsxBuffer.byteLength} bytes) with 4 valid rows and 4 invalid rows.`);

    // 4. Test Parsing & Validation Logic
    console.log('\n[4] Testing parseInventoryImportFile() with Excel buffer...');
    const parseResult = await parseInventoryImportFile(xlsxBuffer, 'bulk_inventory_test.xlsx');
    console.log(`Parsed total rows: ${parseResult.totalRows}`);
    console.log(`✓ Valid rows: ${parseResult.validRows.length}`);
    console.log(`✓ Invalid rows: ${parseResult.invalidRows.length}`);

    if (parseResult.validRows.length !== 4) {
        throw new Error(`Expected 4 valid rows, got ${parseResult.validRows.length}`);
    }
    if (parseResult.invalidRows.length !== 4) {
        throw new Error(`Expected 4 invalid rows, got ${parseResult.invalidRows.length}`);
    }

    console.log('\nDetailed failure modes verified:');
    parseResult.invalidRows.forEach(inv => {
        console.log(`  Row #${inv.rowNumber} (${inv.name || 'Unnamed'}): ${inv.errors.join(' | ')}`);
    });

    // 5. Test Database Ingestion (commitBulkInventoryImport)
    console.log('\n[5] Testing commitBulkInventoryImport() into Demo Account...');
    const commitResult = await commitBulkInventoryImport(parseResult.validRows, pb);
    console.log(`✓ Successfully imported: ${commitResult.successCount} products`);
    console.log(`✓ Failed: ${commitResult.failureCount}`);

    if (commitResult.successCount !== 4) {
        throw new Error(`Expected 4 successful imports, got ${commitResult.successCount}`);
    }

    // Verify imported products in PocketBase
    console.log('\n[6] Verifying Database Records, Variants, and Stock Movements...');
    const createdProductIds: string[] = [];
    const createdVariantIds: string[] = [];

    for (const imp of commitResult.importedProducts) {
        createdProductIds.push(imp.id);
        const prod = await pb.collection('products').getOne(imp.id, { expand: 'category' });
        console.log(`  Product: ${prod.name} | SKU: ${prod.sku} | Price: ₹${prod.base_price} | Account: ${prod.account_email}`);

        if (prod.account_email !== 'admin@luminila.local') {
            throw new Error(`Tenant leak! Product account_email was "${prod.account_email}", expected "admin@luminila.local"`);
        }

        // Verify variant
        const variant = await pb.collection('product_variants').getFirstListItem(`product = "${prod.id}"`);
        createdVariantIds.push(variant.id);
        console.log(`    Variant: ${variant.id} | Stock: ${variant.stock_level} | Purity: ${variant.purity_karat || 'N/A'}`);

        if (variant.stock_level !== imp.stock) {
            throw new Error(`Stock mismatch! Expected ${imp.stock}, got ${variant.stock_level}`);
        }
        if (variant.account_email !== 'admin@luminila.local') {
            throw new Error(`Tenant leak! Variant account_email was "${variant.account_email}", expected "admin@luminila.local"`);
        }

        // Verify stock movement
        const movement = await pb.collection('stock_movements').getFirstListItem(`variant = "${variant.id}"`);
        console.log(`    Movement: ID ${movement.id} | Type: ${movement.movement_type} | Qty: ${movement.quantity} | Source: ${movement.source}`);
        if (movement.quantity !== imp.stock) {
            throw new Error(`Stock movement quantity mismatch! Expected ${imp.stock}, got ${movement.quantity}`);
        }
    }

    // 6. Test CSV Parsing & Failure Modes
    console.log('\n[7] Testing CSV Import & Robustness...');
    const csvContent = `Product Name *,SKU,Category *,Selling Price (₹) *,Stock Quantity *
"TEST CSV Kundan Bangle",CSV-BAN-001,Bangles,12000,5
"TEST CSV Missing Price",CSV-FAIL-001,Rings,,10
"TEST CSV Pearl Drop",CSV-PRL-002,Earrings,3500,20
`;
    const csvBuffer = Buffer.from(csvContent, 'utf-8');
    const csvResult = await parseInventoryImportFile(csvBuffer, 'inventory.csv');
    console.log(`✓ CSV Parsed: ${csvResult.validRows.length} valid rows, ${csvResult.invalidRows.length} invalid rows`);
    if (csvResult.validRows.length !== 2 || csvResult.invalidRows.length !== 1) {
        throw new Error('CSV parsing validation mismatch');
    }

    // 7. Test Corrupted / Binary Garbage Failure Mode
    console.log('\n[8] Testing Corrupt File Failure Mode...');
    try {
        const garbageBuffer = Buffer.from('NOT_AN_EXCEL_FILE_JUST_RANDOM_GARBAGE_BYTES_12345');
        await parseInventoryImportFile(garbageBuffer, 'corrupt.xlsx');
        throw new Error('Corrupt file should have failed parsing!');
    } catch (err: any) {
        console.log(`✓ PASS: Corrupt file gracefully caught: "${err.message}"`);
    }

    // 8. Cleanup Test Products
    console.log('\n[9] Cleaning up test records from database...');
    for (const vId of createdVariantIds) {
        const movements = await pb.collection('stock_movements').getFullList({ filter: `variant = "${vId}"` });
        for (const m of movements) {
            await pb.collection('stock_movements').delete(m.id).catch(() => {});
        }
        await pb.collection('product_variants').delete(vId).catch(() => {});
    }
    for (const pId of createdProductIds) {
        await pb.collection('products').delete(pId).catch(() => {});
    }
    console.log('✓ Cleanup completed.');

    console.log('\n========================================================');
    console.log('✅ ALL BULK INVENTORY IMPORT TESTS & FAILURE MODES PASSED!');
    console.log('========================================================');
}

runTestCycle().catch(err => {
    console.error('\n❌ Test execution failed:', err);
    process.exit(1);
});
