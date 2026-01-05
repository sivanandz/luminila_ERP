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
 */
export function parseCSV<T extends Record<string, string>>(csvString: string): ParseResult<T> {
    const lines = csvString.trim().split("\n");
    const errors: { row: number; message: string }[] = [];

    if (lines.length < 2) {
        return { success: false, data: [], errors: [{ row: 0, message: "CSV must have header and data rows" }] };
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const data: T[] = [];

    for (let i = 1; i < lines.length; i++) {
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
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
            result.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    result.push(current);

    return result.map((v) => v.replace(/^"|"$/g, ""));
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
                product.sku,
                escapeCSVField(product.name),
                product.category,
                product.basePrice.toString(),
                product.costPrice.toString(),
                variant.name,
                variant.material || "",
                variant.size || "",
                variant.color || "",
                variant.stock.toString(),
                variant.priceAdjustment.toString(),
            ]);
        });
    });

    return rows.map((row) => row.join(",")).join("\n");
}

/**
 * Escape field for CSV output
 */
function escapeCSVField(field: string): string {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
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
                product.sku,
                escapeCSVField(product.name),
                product.category,
                variant.name,
                variant.stock.toString(),
                status,
            ]);
        });
    });

    return rows.map((row) => row.join(",")).join("\n");
}
