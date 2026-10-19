const path = require('path');
const fs = require('fs');
const PocketBase = require('E:/Local_GIT_2/luminila_inv_mgmt/node_modules/pocketbase/dist/pocketbase.cjs.js');
const ExcelJS = require('exceljs');

const pb = new PocketBase('http://127.0.0.1:8091');

async function seedTemplate() {
    console.log('Authenticating as admin...');
    await pb.admins.authWithPassword('admin@luminila.local', 'Luminila2026!');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Luminila ERP';
    workbook.created = new Date();

    // Sheet 1: Products
    const dataSheet = workbook.addWorksheet('Products', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });

    const columns = [
        { header: 'Product Name *', key: 'name', width: 32 },
        { header: 'SKU', key: 'sku', width: 22 },
        { header: 'Category *', key: 'category', width: 22 },
        { header: 'Selling Price (₹) *', key: 'base_price', width: 20 },
        { header: 'Cost Price (₹)', key: 'cost_price', width: 18 },
        { header: 'Stock Quantity *', key: 'stock', width: 18 },
        { header: 'HSN Code', key: 'hsn_code', width: 14 },
        { header: 'Material', key: 'material', width: 18 },
        { header: 'Purity', key: 'purity', width: 16 },
        { header: 'Gross Weight (g)', key: 'gross_weight', width: 18 },
        { header: 'Net Weight (g)', key: 'net_weight', width: 18 },
        { header: 'Making Charges (₹)', key: 'making_charges', width: 18 },
        { header: 'Location / Tray', key: 'location', width: 20 },
        { header: 'Description', key: 'description', width: 35 },
    ];

    dataSheet.columns = columns;

    const headerRow = dataSheet.getRow(1);
    headerRow.height = 28;
    headerRow.font = { bold: true, size: 11, color: { argb: 'FF1E293B' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    const requiredIndexes = [1, 3, 4, 6];
    const specIndexes = [8, 9, 10, 11, 12];

    columns.forEach((_, idx) => {
        const colNumber = idx + 1;
        const cell = headerRow.getCell(colNumber);
        if (requiredIndexes.includes(colNumber)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
        } else if (specIndexes.includes(colNumber)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
        } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        }
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
    });

    const sampleRows = [
        {
            name: '22K Gold Temple Haram (Lakshmi Motif)',
            sku: 'TMP-HAR-001',
            category: 'Harams (Long Chains)',
            base_price: 185000,
            cost_price: 165000,
            stock: 3,
            hsn_code: '7113',
            material: 'Gold',
            purity: '22K',
            gross_weight: 42.5,
            net_weight: 40.2,
            making_charges: 1200,
            location: 'Vault Shelf 1',
            description: 'Traditional temple jewelry long chain with antique finish'
        },
        {
            name: 'Kundan Choker Necklace with Pearls',
            sku: '',
            category: 'Necklaces',
            base_price: 34500,
            cost_price: 28000,
            stock: 8,
            hsn_code: '7117',
            material: 'Brass / Alloy',
            purity: '1 Gram Gold Plated',
            gross_weight: 85.0,
            net_weight: 75.0,
            making_charges: 450,
            location: 'Showcase Tray A',
            description: 'Bridal kundan choker set with matching studs'
        },
        {
            name: 'Diamond Solitaire Engagement Ring',
            sku: 'RNG-DIA-001',
            category: 'Rings',
            base_price: 95000,
            cost_price: 82000,
            stock: 5,
            hsn_code: '7113',
            material: 'Gold',
            purity: '18K',
            gross_weight: 4.8,
            net_weight: 4.5,
            making_charges: 800,
            location: 'Tray B - Rings',
            description: 'VVS-EF natural certified diamond ring'
        },
        {
            name: 'Antique Peacock Jhumka Earrings',
            sku: '',
            category: 'Earrings',
            base_price: 12500,
            cost_price: 9500,
            stock: 12,
            hsn_code: '7117',
            material: 'Silver',
            purity: '925 Sterling Silver',
            gross_weight: 22.4,
            net_weight: 22.0,
            making_charges: 300,
            location: 'Tray C - Earrings',
            description: 'Handcrafted oxidized finish jhumkas'
        },
        {
            name: '22K Royal Antique Gold Kada / Bangle',
            sku: 'BAN-GLD-002',
            category: 'Bangles',
            base_price: 128000,
            cost_price: 114000,
            stock: 4,
            hsn_code: '7113',
            material: 'Gold',
            purity: '22K',
            gross_weight: 32.0,
            net_weight: 31.2,
            making_charges: 950,
            location: 'Showcase Tray B',
            description: 'Screw-open antique finish floral kada'
        }
    ];

    sampleRows.forEach(row => {
        const addedRow = dataSheet.addRow(row);
        addedRow.height = 22;
        addedRow.alignment = { vertical: 'middle' };
        addedRow.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            };
        });
    });

    // Sheet 2: Instructions
    const instructionSheet = workbook.addWorksheet('Instructions');
    instructionSheet.columns = [
        { header: 'Section / Field', key: 'col1', width: 28 },
        { header: 'Requirement & Guidance', key: 'col2', width: 85 },
    ];
    instructionSheet.getRow(1).height = 26;
    instructionSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    instructionSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const instructions = [
        ['Product Name *', 'REQUIRED. Full name of the jewelry ornament or item.'],
        ['SKU', 'OPTIONAL. Unique Stock Keeping Unit code. If left blank, Luminila auto-generates one.'],
        ['Category *', 'REQUIRED. Category name (e.g., Rings, Necklaces, Harams, Earrings, Bangles).'],
        ['Selling Price (₹) *', 'REQUIRED. Retail sales price inclusive of making charges (number > 0).'],
        ['Cost Price (₹)', 'OPTIONAL. Wholesale procurement cost or base metal cost.'],
        ['Stock Quantity *', 'REQUIRED. Current on-hand quantity available in store inventory (integer >= 0).'],
        ['HSN Code', 'OPTIONAL. 7113 for precious gold/silver/platinum jewelry; 7117 for imitation fashion jewelry.'],
        ['Material', 'OPTIONAL. Primary metal or material (e.g., Gold, Silver, Brass, Copper, Alloy).'],
        ['Purity', 'OPTIONAL. Karat or fineness (e.g., 24K, 22K, 18K, 14K, 925 Sterling Silver, 1 Gram Gold).'],
        ['Gross Weight (g)', 'OPTIONAL. Total weight of the piece including stones in grams.'],
        ['Net Weight (g)', 'OPTIONAL. Pure metal weight excluding stones/wax in grams.'],
        ['Making Charges (₹)', 'OPTIONAL. Artisan or manufacturing making charge amount in ₹.'],
        ['Location / Tray', 'OPTIONAL. Physical storage location (e.g., Showcase Tray A, Vault 1, Locker 2).'],
        ['Description', 'OPTIONAL. Detailed notes, design details, or hallmark certifications.'],
    ];
    instructions.forEach(inst => instructionSheet.addRow({ col1: inst[0], col2: inst[1] }));

    // Sheet 3: HSN Codes Reference
    const hsnSheet = workbook.addWorksheet('HSN Codes Reference');
    hsnSheet.columns = [
        { header: 'HSN Code', key: 'hsn', width: 16 },
        { header: 'Jewelry Category / Description', key: 'desc', width: 55 },
        { header: 'GST Tax Rate', key: 'gst', width: 16 },
    ];
    hsnSheet.getRow(1).height = 24;
    hsnSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    hsnSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    [
        { hsn: '7113', desc: 'Articles of jewelry of precious metal (Gold, Silver, Platinum)', gst: '3%' },
        { hsn: '7117', desc: 'Imitation and fashion jewelry (Base metal, beads, brass)', gst: '3%' },
        { hsn: '7114', desc: 'Articles of goldsmiths or silversmiths wares (Utensils, idols)', gst: '3%' },
        { hsn: '7116', desc: 'Articles of natural or cultured pearls, precious or semi-precious stones', gst: '3%' },
        { hsn: '7118', desc: 'Gold, silver and commemorative coins', gst: '3%' },
    ].forEach(item => hsnSheet.addRow(item));

    // Save to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const base64Data = Buffer.from(buffer).toString('base64');

    // 1. Save to PocketBase database in store_settings
    const TEMPLATE_KEY = 'inventory_import_template_xlsx';
    const payload = {
        filename: 'luminila_inventory_import_template.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.byteLength,
        generatedAt: new Date().toISOString(),
        base64: base64Data,
    };

    const valStr = JSON.stringify(payload);
    const existing = await pb.collection('store_settings').getFirstListItem(`key="${TEMPLATE_KEY}"`).catch(() => null);

    if (existing) {
        await pb.collection('store_settings').update(existing.id, {
            value: valStr,
            category: 'inventory',
        });
        console.log('✓ Updated template in database (store_settings):', existing.id);
    } else {
        const created = await pb.collection('store_settings').create({
            key: TEMPLATE_KEY,
            value: valStr,
            category: 'inventory',
            account_email: 'admin@luminila.local',
        });
        console.log('✓ Created template in database (store_settings):', created.id);
    }

    // 2. Save to public directory for static download
    const publicDir = path.join(__dirname, '..', 'public', 'templates');
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }
    const outputPath = path.join(publicDir, 'inventory_import_template.xlsx');
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    console.log('✓ Saved static template to:', outputPath);
    console.log(`✓ Template buffer size: ${buffer.byteLength} bytes`);
}

seedTemplate().catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
});
