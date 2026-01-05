// Run with: node scripts/create-test-excel.js
const ExcelJS = require('exceljs');
const path = require('path');

// Simple 1x1 pixel placeholder images as base64 (different colors)
const placeholderImages = {
    gold: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', // gold
    silver: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPY8f///38GAAr/A/0A2lgAAAAAAElFTkSuQmCC', // silver
    red: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8D4HwAFhQJ/wlseKgAAAABJRU5ErkJggg==', // red
    blue: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', // blue
    green: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', // green
};

// Create a larger colored square image
function createColoredSquare(r, g, b, size = 50) {
    // PNG header for a simple solid colored square
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, size, size);
    // Add text
    ctx.fillStyle = r > 127 ? 'black' : 'white';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    return canvas.toBuffer('image/png');
}

const products = [
    { name: 'Diamond Solitaire Ring', category: 'Rings', price: 45000, stock: 3, hsn: '7113', color: [255, 215, 0] },
    { name: 'Pearl Drop Earrings', category: 'Earrings', price: 8500, stock: 15, hsn: '7117', color: [192, 192, 192] },
    { name: 'Ruby Pendant Necklace', category: 'Necklaces', price: 32000, stock: 5, hsn: '7113', color: [255, 0, 0] },
    { name: 'Sapphire Tennis Bracelet', category: 'Bracelets', price: 65000, stock: 2, hsn: '7113', color: [0, 0, 255] },
    { name: 'Emerald Stud Earrings', category: 'Earrings', price: 28000, stock: 8, hsn: '7113', color: [0, 128, 0] },
];

async function createTestExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Products');

    // Add headers
    worksheet.columns = [
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Base Price', key: 'price', width: 12 },
        { header: 'Stock', key: 'stock', width: 8 },
        { header: 'HSN Code', key: 'hsn', width: 10 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).height = 20;

    // Add data rows with embedded images
    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const rowNum = i + 2; // Data starts at row 2

        worksheet.addRow({
            name: product.name,
            category: product.category,
            price: product.price,
            stock: product.stock,
            hsn: product.hsn,
        });

        // Set row height for image
        worksheet.getRow(rowNum).height = 60;

        try {
            // Create a simple colored square image
            const imageBuffer = createColoredSquare(...product.color, 50);

            const imageId = workbook.addImage({
                buffer: imageBuffer,
                extension: 'png',
            });

            // Add image at the end of this row
            worksheet.addImage(imageId, {
                tl: { col: 5, row: rowNum - 1 }, // Column F (0-indexed: 5)
                ext: { width: 50, height: 50 },
            });

            console.log(`✓ Row ${rowNum}: ${product.name} - image added`);
        } catch (err) {
            console.log(`✗ Row ${rowNum}: Failed - ${err.message}`);
        }
    }

    // Save the file
    const outputPath = path.join(__dirname, '..', 'public', 'templates', 'test_embedded_images.xlsx');
    await workbook.xlsx.writeFile(outputPath);
    console.log(`\n✓ Created: ${outputPath}`);
}

createTestExcel().catch(console.error);
