// Run with: node scripts/create-template-excel.js
// Creates a comprehensive Excel import template with all field types

const ExcelJS = require('exceljs');
const path = require('path');

async function createTemplate() {
    const workbook = new ExcelJS.Workbook();

    // ============ SHEET 1: Products Data ============
    const dataSheet = workbook.addWorksheet('Products');

    // Define headers with type annotations
    const headers = [
        // Standard Fields (no suffix)
        { header: 'Name', key: 'name', width: 30, type: 'required' },
        { header: 'SKU', key: 'sku', width: 15, type: 'optional' },
        { header: 'Category', key: 'category', width: 15, type: 'required' },
        { header: 'Base Price', key: 'base_price', width: 12, type: 'required' },
        { header: 'Stock', key: 'stock', width: 8, type: 'required' },
        { header: 'HSN Code', key: 'hsn_code', width: 10, type: 'required' },
        { header: 'Status', key: 'status', width: 12, type: 'optional' },

        // Custom Attributes with Type Suffixes
        { header: 'Material:text', key: 'material', width: 15, type: 'attribute' },
        { header: 'Purity:select[24K,22K,18K,14K,Sterling Silver,N/A]', key: 'purity', width: 35, type: 'attribute' },
        { header: 'Weight (g):number', key: 'weight', width: 15, type: 'attribute' },
        { header: 'Color:select[Gold,Silver,Rose Gold,Oxidized,Multi]', key: 'color', width: 40, type: 'attribute' },
        { header: 'Hallmarked:boolean', key: 'hallmarked', width: 15, type: 'attribute' },
        { header: 'Warranty Until:date', key: 'warranty', width: 18, type: 'attribute' },
        { header: 'Stone Type:text', key: 'stone_type', width: 15, type: 'attribute' },
        { header: 'Stone Count:number', key: 'stone_count', width: 15, type: 'attribute' },
    ];

    dataSheet.columns = headers;

    // Style header row
    const headerRow = dataSheet.getRow(1);
    headerRow.height = 25;
    headerRow.font = { bold: true, size: 11 };
    headerRow.alignment = { vertical: 'middle', wrapText: true };

    // Color code headers by type
    headers.forEach((h, idx) => {
        const cell = headerRow.getCell(idx + 1);
        if (h.type === 'required') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F3FF' } }; // Light blue
        } else if (h.type === 'attribute') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E6' } }; // Light orange
        } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }; // Light gray
        }
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });

    // Sample data rows
    const sampleData = [
        {
            name: 'Diamond Solitaire Ring',
            sku: '',  // Will be auto-generated
            category: 'Rings',
            base_price: 145000,
            stock: 3,
            hsn_code: '7113',
            status: 'Active',
            material: 'Gold',
            purity: '22K',
            weight: 4.5,
            color: 'Gold',
            hallmarked: 'Yes',
            warranty: '2026-12-31',
            stone_type: 'Diamond',
            stone_count: 1,
        },
        {
            name: 'Pearl Drop Earrings',
            sku: '',
            category: 'Earrings',
            base_price: 8500,
            stock: 15,
            hsn_code: '7117',
            status: 'Active',
            material: 'Silver',
            purity: 'Sterling Silver',
            weight: 6.2,
            color: 'Silver',
            hallmarked: 'No',
            warranty: '',
            stone_type: 'Pearl',
            stone_count: 2,
        },
        {
            name: 'Ruby Pendant Necklace',
            sku: '',
            category: 'Necklaces',
            base_price: 85000,
            stock: 5,
            hsn_code: '7113',
            status: 'Active',
            material: 'Gold',
            purity: '18K',
            weight: 8.3,
            color: 'Gold',
            hallmarked: 'Yes',
            warranty: '2027-06-15',
            stone_type: 'Ruby',
            stone_count: 1,
        },
        {
            name: 'Sapphire Tennis Bracelet',
            sku: 'BRC-SAP-001',
            category: 'Bracelets',
            base_price: 165000,
            stock: 2,
            hsn_code: '7113',
            status: 'Active',
            material: 'Gold',
            purity: '18K',
            weight: 12.5,
            color: 'Gold',
            hallmarked: 'Yes',
            warranty: '2027-12-31',
            stone_type: 'Sapphire',
            stone_count: 15,
        },
        {
            name: 'Oxidized Silver Jhumka',
            sku: '',
            category: 'Earrings',
            base_price: 2200,
            stock: 25,
            hsn_code: '7117',
            status: 'Active',
            material: 'Silver',
            purity: 'N/A',
            weight: 18.0,
            color: 'Oxidized',
            hallmarked: 'No',
            warranty: '',
            stone_type: '',
            stone_count: 0,
        },
    ];

    sampleData.forEach((data, idx) => {
        const rowNum = idx + 2;
        const row = dataSheet.addRow(data);
        row.height = 60; // Space for images

        // Add borders to data cells
        row.eachCell((cell, colNumber) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
            };
        });
    });

    // Add colored placeholder images
    const colors = [
        [255, 215, 0],   // Gold
        [192, 192, 192], // Silver
        [255, 69, 0],    // Ruby red
        [30, 144, 255],  // Sapphire blue
        [105, 105, 105], // Oxidized gray
    ];

    const { createCanvas } = require('canvas');

    for (let i = 0; i < sampleData.length; i++) {
        const canvas = createCanvas(50, 50);
        const ctx = canvas.getContext('2d');
        const [r, g, b] = colors[i];
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, 50, 50);

        const imageId = workbook.addImage({
            buffer: canvas.toBuffer('image/png'),
            extension: 'png',
        });

        dataSheet.addImage(imageId, {
            tl: { col: headers.length, row: i + 1 },
            ext: { width: 50, height: 50 },
        });
    }

    // ============ SHEET 2: Instructions ============
    const instructionsSheet = workbook.addWorksheet('Instructions');
    instructionsSheet.columns = [
        { header: 'Topic', key: 'topic', width: 25 },
        { header: 'Description', key: 'description', width: 80 },
    ];

    instructionsSheet.getRow(1).font = { bold: true, size: 12 };
    instructionsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A90D9' } };
    instructionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const instructions = [
        ['HEADER FORMAT', 'Headers define field names and types. Standard fields have no suffix.'],
        ['', ''],
        ['STANDARD FIELDS', 'Name, SKU, Category, Base Price, Stock, HSN Code, Status - these are built-in.'],
        ['Light Blue Headers', 'Required fields - must be filled for each product.'],
        ['Light Orange Headers', 'Custom attributes - these are created automatically if they don\'t exist.'],
        ['Gray Headers', 'Optional standard fields.'],
        ['', ''],
        ['ATTRIBUTE TYPES', 'Add a suffix after colon (:) to define the attribute type:'],
        [':text', 'Free-form text input. Example: Material:text'],
        [':number', 'Numeric values only. Example: Weight (g):number'],
        [':select[opt1,opt2,...]', 'Dropdown with specified options. Example: Purity:select[22K,18K,14K]'],
        [':boolean', 'Yes/No checkbox. Use "Yes", "No", "True", "False", "1", "0".'],
        [':date', 'Date values. Format: YYYY-MM-DD or any parseable date format.'],
        ['', ''],
        ['IMAGES', 'Paste images directly into cells at the end of each row.'],
        ['', 'Images are extracted automatically and linked to products.'],
        ['', ''],
        ['SKU', 'Leave blank for auto-generation, or provide your own SKU code.'],
        ['CATEGORY', 'Must match an existing category or a new one will be created.'],
        ['STATUS', 'Values: Active, Inactive, Discontinued. Default: Active.'],
    ];

    instructions.forEach((row, idx) => {
        const dataRow = instructionsSheet.addRow({ topic: row[0], description: row[1] });
        if (row[0] && row[0].startsWith(':')) {
            dataRow.getCell(1).font = { bold: true, color: { argb: 'FF0066CC' } };
        }
    });

    // ============ SHEET 3: HSN Codes Reference ============
    const hsnSheet = workbook.addWorksheet('HSN Codes');
    hsnSheet.columns = [
        { header: 'HSN Code', key: 'code', width: 12 },
        { header: 'Description', key: 'description', width: 50 },
        { header: 'GST Rate', key: 'gst', width: 12 },
    ];

    hsnSheet.getRow(1).font = { bold: true };
    hsnSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
    hsnSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const hsnCodes = [
        ['7113', 'Articles of Jewellery (Gold, Silver, Platinum)', '3%'],
        ['7117', 'Imitation Jewellery', '12%'],
        ['7114', 'Articles of Goldsmiths/Silversmiths Wares', '3%'],
        ['7116', 'Articles of Natural/Cultured Pearls, Precious Stones', '3%'],
        ['7118', 'Coin', '3%'],
    ];

    hsnCodes.forEach(row => {
        hsnSheet.addRow({ code: row[0], description: row[1], gst: row[2] });
    });

    // ============ SHEET 4: Categories ============
    const catSheet = workbook.addWorksheet('Categories');
    catSheet.columns = [
        { header: 'Category Name', key: 'name', width: 20 },
        { header: 'Parent Category', key: 'parent', width: 20 },
        { header: 'Description', key: 'description', width: 40 },
    ];

    catSheet.getRow(1).font = { bold: true };
    catSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9C27B0' } };
    catSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const categories = [
        ['Rings', '', 'All types of rings'],
        ['Earrings', '', 'Studs, drops, hoops, jhumkas'],
        ['Necklaces', '', 'Chains, pendants, chokers'],
        ['Bracelets', '', 'Bangles, kadas, charm bracelets'],
        ['Pendants', 'Necklaces', 'Standalone pendant pieces'],
        ['Mangalsutra', 'Necklaces', 'Traditional wedding necklaces'],
        ['Nose Pins', 'Earrings', 'Nose studs and rings'],
    ];

    categories.forEach(row => {
        catSheet.addRow({ name: row[0], parent: row[1], description: row[2] });
    });

    // Save the template
    const outputPath = path.join(__dirname, '..', 'public', 'templates', 'inventory_import_template.xlsx');
    await workbook.xlsx.writeFile(outputPath);
    console.log(`\n✓ Template created: ${outputPath}`);
    console.log('\nSheets included:');
    console.log('  1. Products - Main data sheet with sample products');
    console.log('  2. Instructions - How to use the template');
    console.log('  3. HSN Codes - Common jewelry HSN codes reference');
    console.log('  4. Categories - Available product categories');
}

createTemplate().catch(console.error);
