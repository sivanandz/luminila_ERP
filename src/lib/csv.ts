/**
 * CSV Import/Export Utilities
 * Handles bulk product and inventory operations
 */

interface ProductCSVRow {
    [key: string]: string;
    sku: string;
    name: string;
    category: string;
    base_price: string;
    cost_price: string;
    variant_name: string;
    material: string;
    size: string;
    color: string;
    stock: string;
    price_adjustment: string;
}

interface ParseResult<T> {
    success: boolean;
    data: T[];
    errors: { row: number; message: string }[];
}

/**
 * Parse CSV string to array of objects
 *
 * Records are split with a quote-aware scanner and the header row goes through
 * `parseCSVLine`, so quoted commas/newlines in a field no longer shift columns
 * or split one record into two (INF-13).
 */
export function parseCSV<T extends Record<string, string>>(csvString: string): ParseResult<T> {
    const text = csvString.replace(/^\uFEFF/, "");
    const lines = splitCSVRecords(text);
    const errors: { row: number; message: string }[] = [];

    if (lines.length < 2) {
        return { success: false, data: [], errors: [{ row: 0, message: "CSV must have header and data rows" }] };
    }

    const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const data: T[] = [];

    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "") continue; // blank record between rows
        const values = parseCSVLine(lines[i]);

        if (values.length !== headers.length) {
            errors.push({ row: i + 1, message: `Expected ${headers.length} columns, got ${values.length}` });
            continue;
        }

        const row = {} as T;
        headers.forEach((header, idx) => {
            (row as Record<string, string>)[header] = values[idx].trim();
        });

        data.push(row);
    }

    return { success: errors.length === 0, data, errors };
}

/**
 * Split CSV text into records on unquoted newlines only (LF, CRLF or lone CR).
 * Quotes are preserved for `parseCSVLine`, which owns field-level unescaping.
 */
function splitCSVRecords(text: string): string[] {
    const records: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '"') {
            current += char;
            if (inQuotes && text[i + 1] === '"') {
                current += text[i + 1];
                i++; // Escaped quote: stay inside the quoted field
            } else {
                inQuotes = !inQuotes;
            }
        } else if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && text[i + 1] === "\n") i++;
            records.push(current);
            current = "";
        } else {
            current += char;
        }
    }

    if (current.length > 0 || records.length === 0) records.push(current);
    return records;
}

/**
 * Parse a single CSV line, handling quoted fields and RFC 4180 escaped
 * (`""`) quotes. Quote characters are consumed, never appended, so a literal
 * quote survives while the enclosing quotes do not.
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Skip the escaped second quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === "," && !inQuotes) {
            result.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    result.push(current);

    return result;
}

/**
 * Validate product CSV row
 */
export function validateProductRow(row: ProductCSVRow, rowIndex: number): string[] {
    const errors: string[] = [];

    if (!row.sku) errors.push(`Row ${rowIndex}: SKU is required`);
    if (!row.name) errors.push(`Row ${rowIndex}: Product name is required`);

    const price = parseFloat(row.base_price);
    if (isNaN(price) || price <= 0) {
        errors.push(`Row ${rowIndex}: Invalid base price "${row.base_price}"`);
    }

    const stock = parseInt(row.stock);
    if (isNaN(stock) || stock < 0) {
        errors.push(`Row ${rowIndex}: Invalid stock value "${row.stock}"`);
    }

    return errors;
}

/**
 * Convert products to CSV format for export
 */
export function exportProductsToCSV(products: {
    sku: string;
    name: string;
    category: string;
    basePrice: number;
    costPrice: number;
    variants: {
        name: string;
        material?: string;
        size?: string;
        color?: string;
        stock: number;
        priceAdjustment: number;
    }[];
}[]): string {
    const headers = [
        "SKU",
        "Name",
        "Category",
        "Base Price",
        "Cost Price",
        "Variant Name",
        "Material",
        "Size",
        "Color",
        "Stock",
        "Price Adjustment",
    ];

    const rows: string[][] = [headers];

    products.forEach((product) => {
        product.variants.forEach((variant) => {
            rows.push([
                escapeCSVField(product.sku),
                escapeCSVField(product.name),
                escapeCSVField(product.category),
                product.basePrice.toString(),
                product.costPrice.toString(),
                escapeCSVField(variant.name),
                escapeCSVField(variant.material || ""),
                escapeCSVField(variant.size || ""),
                escapeCSVField(variant.color || ""),
                variant.stock.toString(),
                variant.priceAdjustment.toString(),
            ]);
        });
    });

    return rows.map((row) => row.join(",")).join("\n");
}

/**
 * Escape field for CSV output and neutralize spreadsheet formula injection.
 *
 * The formula-start class deliberately lists `-` last: written as `@-|` it is a
 * character *range* from `@` to `|`, which prefixes most uppercase and some
 * lowercase fields with `'` and corrupts ordinary SKUs and names.
 */
function escapeCSVField(field: string): string {
    let sanitized = field;
    // INF-15: a formula can hide behind leading whitespace/control characters,
    // so test the first non-space character rather than the raw start.
    const firstContent = sanitized.replace(/^[\s\u0000-\u001f]+/, "");
    if (/^[=+\-@]/.test(firstContent)) {
        sanitized = `'${sanitized}`;
    }
    if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n") || sanitized.includes("\r")) {
        return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
}

/**
 * Generate sample CSV template
 */
export function getProductCSVTemplate(): string {
    return `SKU,Name,Category,Base Price,Cost Price,Variant Name,Material,Size,Color,Stock,Price Adjustment
LUM-EAR-001,Pearl Drop Earrings,Earrings,1290,650,Small,Gold-Plated,,White,20,0
LUM-EAR-001,Pearl Drop Earrings,Earrings,1290,650,Medium,Gold-Plated,,White,15,200
LUM-NEC-023,Layered Chain Necklace,Necklaces,2450,1200,16 inch,Sterling Silver,,,10,0
LUM-NEC-023,Layered Chain Necklace,Necklaces,2450,1200,18 inch,Sterling Silver,,,8,0`;
}

/**
 * Download string as file
 */
export function downloadAsFile(content: string, filename: string, mimeType = "text/csv"): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Read file as text
 */
export function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
}

/**
 * Parse and validate product import file
 */
export async function importProductsFromFile(file: File): Promise<{
    success: boolean;
    products: ProductCSVRow[];
    errors: string[];
}> {
    try {
        const content = await readFileAsText(file);
        const parseResult = parseCSV<ProductCSVRow>(content);

        const validationErrors: string[] = [];

        parseResult.data.forEach((row, idx) => {
            const rowErrors = validateProductRow(row, idx + 2); // +2 for 1-indexed + header
            validationErrors.push(...rowErrors);
        });

        return {
            success: parseResult.success && validationErrors.length === 0,
            products: parseResult.data,
            errors: [
                ...parseResult.errors.map((e) => `Row ${e.row}: ${e.message}`),
                ...validationErrors,
            ],
        };
    } catch (err) {
        return {
            success: false,
            products: [],
            errors: [`Failed to read file: ${err}`],
        };
    }
}

/**
 * Export inventory report
 */
export function exportInventoryReport(products: {
    sku: string;
    name: string;
    category: string;
    variants: {
        name: string;
        stock: number;
        lowStockThreshold: number;
    }[];
}[]): string {
    const headers = ["SKU", "Product Name", "Category", "Variant", "Stock", "Status"];
    const rows: string[][] = [headers];

    products.forEach((product) => {
        product.variants.forEach((variant) => {
            const status = variant.stock <= 0
                ? "OUT OF STOCK"
                : variant.stock <= variant.lowStockThreshold
                    ? "LOW STOCK"
                    : "IN STOCK";

            rows.push([
                escapeCSVField(product.sku),
                escapeCSVField(product.name),
                escapeCSVField(product.category),
                escapeCSVField(variant.name),
                variant.stock.toString(),
                escapeCSVField(status),
            ]);
        });
    });

    return rows.map((row) => row.join(",")).join("\n");
}
