/**
 * Excel Bulk Inventory Import & Template Management Service
 * Provides format generation, database template caching, parsing, and bulk ingestion.
 */

import ExcelJS from 'exceljs';
import { pb } from './pocketbase';
import { calculateLandedUnitCosts, reconcilePOWithInwardBatch, decodePOMetadata } from './purchase';

export interface InventoryImportRow {
    rowNumber: number;
    name: string;
    sku?: string;
    category: string;
    base_price: number;
    cost_price?: number;
    stock: number;
    hsn_code?: string;
    material?: string;
    purity?: string;
    gross_weight?: number;
    net_weight?: number;
    making_charges?: number;
    location?: string;
    description?: string;
    po_reference?: string;
}

export interface RowValidationError {
    rowNumber: number;
    name?: string;
    sku?: string;
    errors: string[];
}

export interface ParsedImportResult {
    validRows: InventoryImportRow[];
    invalidRows: RowValidationError[];
    totalRows: number;
}

export interface ImportCommitResult {
    successCount: number;
    failureCount: number;
    importedProducts: { id: string; name: string; sku: string; stock: number; cost_price?: number }[];
    errors: { rowNumber: number; error: string }[];
    reconciledPOs?: {
        poNumber: string;
        budgetAmount?: number;
        inwardGoodsCost?: number;
        discrepancyAmount: number;
        discrepancyStatus: string;
        approvalStatus: string;
    }[];
}

const TEMPLATE_SETTING_KEY = 'inventory_import_template_xlsx';

/**
 * Builds the comprehensive Excel workbook template for bulk inventory upload.
 */
export async function generateInventoryImportTemplateWorkbook(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Luminila ERP';
    workbook.created = new Date();

    // ==========================================
    // SHEET 1: Products (Main Data Sheet)
    // ==========================================
    const dataSheet = workbook.addWorksheet('Products', {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });

    const columns: Partial<ExcelJS.Column>[] = [
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
        { header: 'Purchase Order Ref', key: 'po_reference', width: 28 },
    ];

    dataSheet.columns = columns;

    // Header styling
    const headerRow = dataSheet.getRow(1);
    headerRow.height = 28;
    headerRow.font = { bold: true, size: 11, color: { argb: 'FF1E293B' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // Color code columns:
    // Required fields: Light Blue (E0F2FE)
    // Jewelry Specs: Light Orange (FFEDD5)
    // Optional/Info: Light Gray (F1F5F9)
    const requiredIndexes = [1, 3, 4, 6]; // Name, Category, Price, Stock
    const specIndexes = [8, 9, 10, 11, 12]; // Material, Purity, Weights, Charges

    columns.forEach((_, idx) => {
        const colNumber = idx + 1;
        const cell = headerRow.getCell(colNumber);
        if (requiredIndexes.includes(colNumber)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }; // Sky 100
        } else if (specIndexes.includes(colNumber)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } }; // Orange 100
        } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; // Slate 100
        }
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
    });

    // Sample data rows
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
            sku: '', // Will be auto-generated
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

    // ==========================================
    // SHEET 2: Instructions & Guidelines
    // ==========================================
    const instructionSheet = workbook.addWorksheet('Instructions');
    instructionSheet.columns = [
        { header: 'Section / Field', key: 'col1', width: 28 },
        { header: 'Requirement & Guidance', key: 'col2', width: 85 },
    ];

    instructionSheet.getRow(1).height = 26;
    instructionSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    instructionSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const instructions = [
        ['Product Name *', 'REQUIRED. Full name of the jewelry ornament or item (e.g., 22K Gold Temple Haram).'],
        ['SKU', 'OPTIONAL. Unique Stock Keeping Unit code. If left blank, Luminila automatically generates one.'],
        ['Category *', 'REQUIRED. Category name (e.g., Rings, Necklaces, Harams, Earrings, Bangles). If new, will be auto-created.'],
        ['Selling Price (₹) *', 'REQUIRED. Retail sales price inclusive of making charges (number greater than 0).'],
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
        ['Purchase Order Ref', 'OPTIONAL. Tag items to a Purchase Order reference number (e.g., PO-GEN-20261019-180532). Auto-reconciles inward cost and absorbs GST/shipping overheads into landed cost if configured.'],
        ['------------------', '-----------------------------------------------------------------------------------'],
        ['File Formats', 'Save and upload this file as .xlsx, .xls, or .csv. Headers must not be removed.'],
        ['Data Isolation', 'Uploaded inventory is strictly partitioned and accessible only to your authenticated store account.'],
    ];

    instructions.forEach(inst => {
        instructionSheet.addRow({ col1: inst[0], col2: inst[1] });
    });

    // ==========================================
    // SHEET 3: HSN Codes Reference
    // ==========================================
    const hsnSheet = workbook.addWorksheet('HSN Codes Reference');
    hsnSheet.columns = [
        { header: 'HSN Code', key: 'hsn', width: 16 },
        { header: 'Jewelry Category / Description', key: 'desc', width: 55 },
        { header: 'GST Tax Rate', key: 'gst', width: 16 },
    ];
    hsnSheet.getRow(1).height = 24;
    hsnSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } }; // Teal
    hsnSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const hsnList = [
        { hsn: '7113', desc: 'Articles of jewelry of precious metal (Gold, Silver, Platinum)', gst: '3%' },
        { hsn: '7117', desc: 'Imitation and fashion jewelry (Base metal, beads, brass)', gst: '3%' },
        { hsn: '7114', desc: 'Articles of goldsmiths or silversmiths wares (Utensils, idols)', gst: '3%' },
        { hsn: '7116', desc: 'Articles of natural or cultured pearls, precious or semi-precious stones', gst: '3%' },
        { hsn: '7118', desc: 'Gold, silver and commemorative coins', gst: '3%' },
    ];
    hsnList.forEach(item => hsnSheet.addRow(item));

    // ==========================================
    // SHEET 4: Standard Categories
    // ==========================================
    const catSheet = workbook.addWorksheet('Categories Reference');
    catSheet.columns = [
        { header: 'Suggested Category Name', key: 'cat', width: 30 },
        { header: 'Typical Items', key: 'items', width: 60 },
    ];
    catSheet.getRow(1).height = 24;
    catSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; // Indigo
    catSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const catList = [
        { cat: 'Rings', items: 'Solitaire, wedding bands, gemstone rings, cocktail rings' },
        { cat: 'Necklaces', items: 'Chokers, short necklaces, collar pieces, pearl strings' },
        { cat: 'Harams (Long Chains)', items: 'Traditional South Indian long chains, kasu haram, antique chains' },
        { cat: 'Earrings', items: 'Studs, jhumkas, chandbalis, drop earrings, hoop earrings' },
        { cat: 'Bangles', items: 'Kadas, single bangles, sets, daily wear thin bangles' },
        { cat: 'Mangalsutra', items: 'Short mangalsutra, traditional black bead chains, pendant chains' },
        { cat: 'Pendants', items: 'Deity pendants, diamond pendants, alphabetic initials' },
        { cat: 'Bracelets', items: 'Tennis bracelets, charm bracelets, link chains' },
        { cat: 'Nose Pins', items: 'Studs, rings, traditional nath' },
        { cat: 'Anklets / Payal', items: 'Silver anklets, ghungroo payal, leg chains' },
    ];
    catList.forEach(item => catSheet.addRow(item));

    return workbook;
}

/**
 * Saves the official Excel template directly to the PocketBase database (in `store_settings`).
 */
export async function persistDefaultTemplateToDatabase(pbClient = pb): Promise<void> {
    const workbook = await generateInventoryImportTemplateWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const base64Data = Buffer.from(buffer).toString('base64');

    const payload = {
        filename: 'luminila_inventory_import_template.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.byteLength,
        generatedAt: new Date().toISOString(),
        base64: base64Data,
    };

    const valStr = JSON.stringify(payload);
    const userEmail = (pbClient.authStore.model as any)?.email?.trim().toLowerCase() || '';
    const filter = userEmail ? `key="${TEMPLATE_SETTING_KEY}" && account_email="${userEmail}"` : `key="${TEMPLATE_SETTING_KEY}"`;

    const existing = await pbClient
        .collection('store_settings')
        .getFirstListItem(filter)
        .catch(() => null);

    if (existing) {
        await pbClient.collection('store_settings').update(existing.id, {
            value: valStr,
            category: 'inventory',
        });
    } else {
        await pbClient.collection('store_settings').create({
            key: TEMPLATE_SETTING_KEY,
            value: valStr,
            category: 'inventory',
            account_email: userEmail,
        });
    }
}

/**
 * Retrieves the template buffer from the database, or generates and caches it if missing.
 */
export async function getTemplateBufferFromDatabase(pbClient = pb): Promise<Buffer> {
    try {
        const userEmail = (pbClient.authStore.model as any)?.email?.trim().toLowerCase() || '';
        const filter = userEmail ? `key="${TEMPLATE_SETTING_KEY}" && account_email="${userEmail}"` : `key="${TEMPLATE_SETTING_KEY}"`;

        const record = await pbClient
            .collection('store_settings')
            .getFirstListItem(filter)
            .catch(() => null);

        if (record && record.value) {
            const parsed = typeof record.value === 'string' ? JSON.parse(record.value) : record.value;
            if (parsed.base64) {
                return Buffer.from(parsed.base64, 'base64');
            }
        }
    } catch {
        // Fall back to generating fresh buffer
    }

    const workbook = await generateInventoryImportTemplateWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/**
 * Helper to clean and normalize column header names
 */
function normalizeHeader(header: string): string {
    return header
        .toLowerCase()
        .replace(/[*()₹\s_]+/g, '')
        .trim();
}

function parseCsvToRows(csvText: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentField += '"';
                i++; // Skip escaped quote
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentField);
            currentField = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++; // Skip LF in CRLF
            }
            currentRow.push(currentField);
            currentField = '';
            if (currentRow.some(col => col.trim().length > 0)) {
                rows.push(currentRow);
            }
            currentRow = [];
        } else {
            currentField += char;
        }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField);
        if (currentRow.some(col => col.trim().length > 0)) {
            rows.push(currentRow);
        }
    }

    return rows;
}

/**
 * Parses an uploaded Excel (.xlsx, .xls) or CSV file buffer and validates each row.
 */
export async function parseInventoryImportFile(
    fileBuffer: ArrayBuffer | Buffer,
    fileName: string
): Promise<ParsedImportResult> {
    const workbook = new ExcelJS.Workbook();
    const isCsv = fileName.toLowerCase().endsWith('.csv');

    if (isCsv) {
        let text: string;
        if (typeof fileBuffer === 'string') {
            text = fileBuffer;
        } else if (fileBuffer instanceof ArrayBuffer) {
            text = new TextDecoder('utf-8').decode(fileBuffer);
        } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(fileBuffer)) {
            text = fileBuffer.toString('utf-8');
        } else {
            text = new TextDecoder('utf-8').decode(new Uint8Array(fileBuffer as any));
        }

        const sheet = workbook.addWorksheet('Products');
        const parsedRows = parseCsvToRows(text);
        for (const row of parsedRows) {
            sheet.addRow(row);
        }
    } else {
        const buf = fileBuffer instanceof ArrayBuffer ? fileBuffer : (fileBuffer as any).buffer || fileBuffer;
        await workbook.xlsx.load(buf as any);
    }

    const sheet = workbook.getWorksheet('Products') || workbook.worksheets[0];
    if (!sheet) {
        throw new Error('The uploaded file contains no sheets.');
    }

    // Find header row (usually row 1)
    let headerRowIndex = 1;
    const headers: { index: number; normalized: string; original: string }[] = [];

    sheet.eachRow((row, rowNumber) => {
        if (headers.length > 0) return; // already found
        const rowValues = (row.values as any[]) || [];
        const hasProductName = rowValues.some(v => {
            const s = String(v || '').toLowerCase();
            return s.includes('product') || s.includes('name') || s.includes('sku');
        });

        if (hasProductName) {
            headerRowIndex = rowNumber;
            row.eachCell((cell, colNumber) => {
                const orig = String(cell.value || '').trim();
                if (orig) {
                    headers.push({
                        index: colNumber,
                        normalized: normalizeHeader(orig),
                        original: orig,
                    });
                }
            });
        }
    });

    if (headers.length === 0) {
        throw new Error('Unable to find a valid header row in the sheet. Please use the official Luminila Excel template.');
    }

    // Column mapping helpers
    const getColIndex = (keywords: string[]): number | undefined => {
        for (const kw of keywords) {
            const found = headers.find(h => h.normalized.includes(kw));
            if (found) return found.index;
        }
        return undefined;
    };

    const nameCol = getColIndex(['productname', 'name', 'title']);
    const skuCol = getColIndex(['sku', 'code', 'barcode']);
    const categoryCol = getColIndex(['category', 'type']);
    const priceCol = getColIndex(['sellingprice', 'baseprice', 'price', 'mrp', 'rate']);
    const costCol = getColIndex(['costprice', 'cost', 'purchaseprice']);
    const stockCol = getColIndex(['stockquantity', 'stock', 'qty', 'quantity']);
    const hsnCol = getColIndex(['hsncode', 'hsn']);
    const materialCol = getColIndex(['material', 'metal']);
    const purityCol = getColIndex(['purity', 'karat']);
    const grossWeightCol = getColIndex(['grossweight', 'weight']);
    const netWeightCol = getColIndex(['netweight']);
    const makingChargesCol = getColIndex(['makingcharges', 'mc']);
    const locationCol = getColIndex(['location', 'tray', 'rack']);
    const descCol = getColIndex(['description', 'notes', 'desc']);
    const poRefCol = getColIndex(['purchaseorder', 'poreference', 'po_ref', 'ponumber', 'po_number', 'po#', 'poref', 'po']);

    if (!nameCol) {
        throw new Error('Required column "Product Name" was not found in the uploaded file.');
    }

    const validRows: InventoryImportRow[] = [];
    const invalidRows: RowValidationError[] = [];

    // Iterate through data rows
    const rowCount = sheet.rowCount;
    for (let r = headerRowIndex + 1; r <= rowCount; r++) {
        const row = sheet.getRow(r);
        if (!row || !row.hasValues) continue;

        const getVal = (colIdx: number | undefined): any => {
            if (!colIdx) return undefined;
            const cell = row.getCell(colIdx);
            const val = cell.value;
            if (val === null || val === undefined) return undefined;
            if (typeof val === 'object' && 'result' in val) return (val as any).result; // Excel formula result
            if (typeof val === 'object' && 'text' in val) return (val as any).text; // Rich text
            return val;
        };

        const rawName = String(getVal(nameCol) || '').trim();
        const rawSku = String(getVal(skuCol) || '').trim();
        const rawCat = String(getVal(categoryCol) || 'Uncategorized').trim();
        const rawPrice = getVal(priceCol);
        const rawCost = getVal(costCol);
        const rawStock = getVal(stockCol);
        const rawHsn = String(getVal(hsnCol) || '').trim();
        const rawMaterial = String(getVal(materialCol) || '').trim();
        const rawPurity = String(getVal(purityCol) || '').trim();
        const rawGrossWeight = getVal(grossWeightCol);
        const rawNetWeight = getVal(netWeightCol);
        const rawMakingCharges = getVal(makingChargesCol);
        const rawLocation = String(getVal(locationCol) || '').trim();
        const rawDesc = String(getVal(descCol) || '').trim();
        const rawPoRef = String(getVal(poRefCol) || '').trim();

        // Skip completely empty spacer rows
        if (!rawName && !rawSku && rawPrice === undefined && rawStock === undefined) {
            continue;
        }

        const errors: string[] = [];

        // Validation 1: Product Name
        if (!rawName) {
            errors.push('Product Name is required.');
        }

        // Validation 2: Selling Price
        const parsedPrice = parseFloat(String(rawPrice || '0').replace(/[^0-9.-]+/g, ''));
        if (rawPrice === undefined || isNaN(parsedPrice) || parsedPrice <= 0) {
            errors.push(`Selling Price must be a positive number (found: "${rawPrice}").`);
        }

        // Validation 3: Stock Quantity
        const parsedStock = parseInt(String(rawStock ?? '0').replace(/[^0-9.-]+/g, ''), 10);
        if (rawStock === undefined || isNaN(parsedStock) || parsedStock < 0) {
            errors.push(`Stock Quantity must be an integer >= 0 (found: "${rawStock}").`);
        }

        // Validation 4: Optional Cost Price
        let parsedCost: number | undefined = undefined;
        if (rawCost !== undefined && String(rawCost).trim() !== '') {
            const c = parseFloat(String(rawCost).replace(/[^0-9.-]+/g, ''));
            if (isNaN(c) || c < 0) {
                errors.push(`Cost Price must be a valid number >= 0 if provided (found: "${rawCost}").`);
            } else {
                parsedCost = c;
            }
        }

        // Validation 5: Weights
        let parsedGross: number | undefined = undefined;
        if (rawGrossWeight !== undefined && String(rawGrossWeight).trim() !== '') {
            const gw = parseFloat(String(rawGrossWeight).replace(/[^0-9.-]+/g, ''));
            if (isNaN(gw) || gw < 0) {
                errors.push(`Gross Weight must be a valid number >= 0 if provided.`);
            } else {
                parsedGross = gw;
            }
        }

        let parsedNet: number | undefined = undefined;
        if (rawNetWeight !== undefined && String(rawNetWeight).trim() !== '') {
            const nw = parseFloat(String(rawNetWeight).replace(/[^0-9.-]+/g, ''));
            if (isNaN(nw) || nw < 0) {
                errors.push(`Net Weight must be a valid number >= 0 if provided.`);
            } else {
                parsedNet = nw;
            }
        }

        let parsedMakingCharges: number | undefined = undefined;
        if (rawMakingCharges !== undefined && String(rawMakingCharges).trim() !== '') {
            const mc = parseFloat(String(rawMakingCharges).replace(/[^0-9.-]+/g, ''));
            if (isNaN(mc) || mc < 0) {
                errors.push(`Making Charges must be a valid number >= 0 if provided.`);
            } else {
                parsedMakingCharges = mc;
            }
        }

        if (errors.length > 0) {
            invalidRows.push({
                rowNumber: r,
                name: rawName || 'Untitled Item',
                sku: rawSku || 'N/A',
                errors,
            });
        } else {
            validRows.push({
                rowNumber: r,
                name: rawName,
                sku: rawSku || undefined,
                category: rawCat || 'Uncategorized',
                base_price: parsedPrice,
                cost_price: parsedCost,
                stock: parsedStock,
                hsn_code: rawHsn || (rawCat.toLowerCase().includes('imitation') ? '7117' : '7113'),
                material: rawMaterial || undefined,
                purity: rawPurity || undefined,
                gross_weight: parsedGross,
                net_weight: parsedNet,
                making_charges: parsedMakingCharges,
                location: rawLocation || 'Showcase Tray A',
                description: rawDesc || undefined,
                po_reference: rawPoRef || undefined,
            });
        }
    }

    return {
        validRows,
        invalidRows,
        totalRows: validRows.length + invalidRows.length,
    };
}

/**
 * Ingests validated rows into PocketBase database with multi-tenant scoping.
 */
export async function commitBulkInventoryImport(
    validRows: InventoryImportRow[],
    defaultPoReferenceOrPb?: string | typeof pb,
    maybePbClient?: typeof pb | string
): Promise<ImportCommitResult> {
    let defaultPoReference: string | undefined = undefined;
    let pbClient: typeof pb = pb;

    if (typeof defaultPoReferenceOrPb === "string") {
        defaultPoReference = defaultPoReferenceOrPb;
        if (maybePbClient && typeof maybePbClient !== "string") {
            pbClient = maybePbClient;
        }
    } else if (defaultPoReferenceOrPb && typeof defaultPoReferenceOrPb === "object" && "collection" in defaultPoReferenceOrPb) {
        pbClient = defaultPoReferenceOrPb;
        if (typeof maybePbClient === "string") {
            defaultPoReference = maybePbClient;
        }
    }

    const accountEmail = (pbClient.authStore.model as any)?.email || '';
    const importedProducts: { id: string; name: string; sku: string; stock: number; cost_price?: number }[] = [];
    const errors: { rowNumber: number; error: string }[] = [];

    // Cache existing categories to avoid redundant queries
    const existingCats = await pbClient.collection('categories').getFullList().catch(() => []);
    const catMap = new Map<string, string>();
    existingCats.forEach((c: any) => catMap.set(c.name.toLowerCase().trim(), c.id));

    // 0. Pre-resolve any Purchase Orders referenced across rows or via defaultPoReference
    const allPoRefs = new Set<string>();
    if (defaultPoReference?.trim()) allPoRefs.add(defaultPoReference.trim());
    validRows.forEach(r => {
        if (r.po_reference?.trim()) allPoRefs.add(r.po_reference.trim());
    });

    const poRecordMap = new Map<string, any>();
    for (const poRef of allPoRefs) {
        try {
            let po = await pbClient.collection('purchase_orders').getFirstListItem(`po_number="${poRef}"`).catch(() => null);
            if (!po) {
                po = await pbClient.collection('purchase_orders').getOne(poRef).catch(() => null);
            }
            if (po) {
                const { meta } = decodePOMetadata(po.notes);
                poRecordMap.set(poRef, { record: po, meta });
                poRecordMap.set(po.id, { record: po, meta });
                if (po.po_number) poRecordMap.set(po.po_number, { record: po, meta });
            }
        } catch (e) {
            console.warn(`Could not lookup PO ${poRef}:`, e);
        }
    }

    // 1. Group rows by effective PO reference to compute Landed Costs if PO specifies absorb_overhead
    const rowsByPo = new Map<string, InventoryImportRow[]>();
    validRows.forEach(item => {
        const effPoRef = (item.po_reference || defaultPoReference || '').trim();
        if (!rowsByPo.has(effPoRef)) {
            rowsByPo.set(effPoRef, []);
        }
        rowsByPo.get(effPoRef)!.push(item);
    });

    const landedCostMap = new Map<number, number>();
    for (const [poRef, rows] of rowsByPo.entries()) {
        const poData = poRecordMap.get(poRef);
        if (poData && poData.meta?.absorb_overhead) {
            const totalOverhead = Number(poData.meta.gst_paid_overhead || 0) + Number(poData.meta.shipping_overhead || 0);
            if (totalOverhead > 0) {
                const landed = calculateLandedUnitCosts(rows, totalOverhead);
                landed.forEach(l => {
                    landedCostMap.set(l.rowNumber, l.landed_cost_price);
                });
            }
        }
    }

    let successCount = 0;
    let failureCount = 0;
    const poBatchCostMap = new Map<string, number>();

    for (const item of validRows) {
        try {
            // 1. Resolve or create Category
            let categoryId = '';
            const normalizedCatName = item.category.trim();
            if (normalizedCatName) {
                const lowerCat = normalizedCatName.toLowerCase();
                if (catMap.has(lowerCat)) {
                    categoryId = catMap.get(lowerCat)!;
                } else {
                    const newCat = await pbClient.collection('categories').create({
                        name: normalizedCatName,
                        is_active: true,
                    });
                    categoryId = newCat.id;
                    catMap.set(lowerCat, categoryId);
                }
            }

            // 2. Generate unique SKU if missing
            const finalSku = item.sku && item.sku.trim().length > 0
                ? item.sku.trim()
                : `SKU-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

            const effPoRef = (item.po_reference || defaultPoReference || '').trim();
            const baseCost = item.cost_price || 0;
            const finalCost = landedCostMap.has(item.rowNumber) ? landedCostMap.get(item.rowNumber)! : baseCost;

            // 3. Create Product
            const product = await pbClient.collection('products').create({
                account_email: accountEmail,
                name: item.name,
                sku: finalSku,
                category: categoryId,
                base_price: item.base_price,
                cost_price: finalCost,
                hsn_code: item.hsn_code || '7113',
                gross_weight: item.gross_weight,
                net_weight: item.net_weight,
                purity_karat: item.purity,
                making_charges: item.making_charges,
                location: item.location || 'Showcase Tray A',
                description: item.description || (effPoRef ? `Inward stock under PO: ${effPoRef}` : ''),
                is_active: true,
            });

            // 4. Create Product Variant
            const variant = await pbClient.collection('product_variants').create({
                account_email: accountEmail,
                product: product.id,
                variant_name: finalSku,
                sku_suffix: 'STD',
                price_adjustment: 0,
                stock_level: item.stock,
                low_stock_threshold: 2,
                material: item.material || '',
                purity_karat: item.purity || '',
                gross_weight: item.gross_weight,
                net_weight: item.net_weight,
                making_charges: item.making_charges,
            });

            // 5. Log Stock Movement for initial inventory balance
            if (item.stock > 0) {
                let noteMsg = `Initial bulk inventory import from Excel. Added ${item.stock} units for ${item.name} (${finalSku}).`;
                if (effPoRef) {
                    noteMsg += ` Tagged to PO: ${effPoRef}.`;
                    if (finalCost !== baseCost) {
                        noteMsg += ` Landed cost inflated from ₹${baseCost} to ₹${finalCost} (GST/Shipping absorbed).`;
                    }
                }
                await pbClient.collection('stock_movements').create({
                    account_email: accountEmail,
                    variant: variant.id,
                    movement_type: 'restock',
                    quantity: item.stock,
                    reference_id: effPoRef || product.id,
                    source: 'bulk_excel_import',
                    notes: noteMsg,
                }).catch(err => console.warn('Could not log initial stock movement:', err));

                // Accumulate batch inward cost for PO reconciliation
                if (effPoRef) {
                    const currentBatchCost = poBatchCostMap.get(effPoRef) || 0;
                    poBatchCostMap.set(effPoRef, currentBatchCost + (baseCost * item.stock));
                }
            }

            importedProducts.push({
                id: product.id,
                name: product.name,
                sku: finalSku,
                stock: item.stock,
                cost_price: finalCost,
            });
            successCount++;
        } catch (err: any) {
            failureCount++;
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({
                rowNumber: item.rowNumber,
                error: `Failed to import "${item.name}": ${msg}`,
            });
        }
    }

    // 6. Reconcile POs with batch costs
    const reconciledPOs: ImportCommitResult['reconciledPOs'] = [];
    for (const [poRef, totalCost] of poBatchCostMap.entries()) {
        try {
            const result = await reconcilePOWithInwardBatch(poRef, totalCost);
            reconciledPOs.push({
                poNumber: result.po.po_number || poRef,
                budgetAmount: result.po.budget_amount,
                inwardGoodsCost: result.po.inward_goods_cost,
                discrepancyAmount: result.discrepancyAmount,
                discrepancyStatus: result.discrepancyStatus,
                approvalStatus: result.approvalStatus,
            });
        } catch (e) {
            console.warn(`Could not reconcile PO ${poRef}:`, e);
        }
    }

    return {
        successCount,
        failureCount,
        importedProducts,
        errors,
        reconciledPOs,
    };
}
