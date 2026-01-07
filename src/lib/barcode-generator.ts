/**
 * Barcode Generator Utility
 * Generates barcodes for product SKUs for reliable stock updates
 */

/**
 * Generate barcode as data URL using bwip-js or external API
 * Uses Code 128 format which supports alphanumeric SKUs
 */
export function generateBarcodeURL(sku: string, width: number = 250, height: number = 80): string {
    // Use barcodeapi.org for Code 128 barcode generation (no dependencies)
    const encoded = encodeURIComponent(sku);
    return `https://barcodeapi.org/api/128/${encoded}`;
}

/**
 * Generate barcode as SVG for high-quality printing
 * Uses barcode.tec-it.com API which supports SVG output
 */
export function generateBarcodeSVG(sku: string): string {
    const encoded = encodeURIComponent(sku);
    return `https://barcode.tec-it.com/barcode.ashx?data=${encoded}&code=Code128&translate-esc=on&unit=Fit&imagetype=Svg`;
}

/**
 * Generate a printable label with product info and barcode
 */
export function generateLabelHTML(product: {
    sku: string;
    name: string;
    base_price: number;
}): string {
    const barcodeUrl = generateBarcodeURL(product.sku);

    return `
        <div style="
            width: 280px;
            padding: 12px;
            border: 1px solid #ccc;
            font-family: Arial, sans-serif;
            text-align: center;
            background: white;
            page-break-inside: avoid;
        ">
            <div style="font-size: 12px; font-weight: bold; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${product.name}
            </div>
            <img src="${barcodeUrl}" alt="Barcode" style="width: 240px; height: 60px;" />
            <div style="font-size: 14px; font-family: 'Courier New', monospace; color: #333; margin-top: 4px;">
                ${product.sku}
            </div>
            <div style="font-size: 14px; font-weight: bold; color: #0066cc; margin-top: 4px;">
                ₹${product.base_price.toLocaleString('en-IN')}
            </div>
        </div>
    `;
}

/**
 * Print multiple product labels
 */
export function printLabels(products: Array<{
    sku: string;
    name: string;
    base_price: number;
}>, copies: number = 1): void {
    // Repeat each product for the specified number of copies
    const allProducts = products.flatMap(p => Array(copies).fill(p));
    const labelsHTML = allProducts.map(p => generateLabelHTML(p)).join('');

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow pop-ups to print labels');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Product Barcode Labels</title>
            <style>
                body {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    padding: 10px;
                    margin: 0;
                }
                @media print {
                    body { padding: 5mm; }
                    @page { margin: 5mm; }
                }
            </style>
        </head>
        <body>
            ${labelsHTML}
            <script>
                // Wait for barcode images to load before printing
                const images = document.querySelectorAll('img');
                let loaded = 0;
                images.forEach(img => {
                    if (img.complete) {
                        loaded++;
                    } else {
                        img.onload = img.onerror = () => {
                            loaded++;
                            if (loaded === images.length) {
                                window.print();
                                window.close();
                            }
                        };
                    }
                });
                if (loaded === images.length) {
                    setTimeout(() => {
                        window.print();
                        window.close();
                    }, 500);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * Parse scanned barcode text to extract SKU
 */
export function parseSKUFromBarcode(barcodeText: string): string | null {
    const trimmed = barcodeText.trim();

    // Validate SKU format (alphanumeric with dashes)
    if (/^[A-Z0-9-]+$/i.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    return null;
}

/**
 * Generate barcode for small thermal printer labels (common 40x30mm size)
 */
export function generateSmallLabelHTML(product: {
    sku: string;
    name: string;
    base_price: number;
}): string {
    const barcodeUrl = generateBarcodeURL(product.sku);

    return `
        <div style="
            width: 40mm;
            height: 30mm;
            padding: 2mm;
            font-family: Arial, sans-serif;
            text-align: center;
            background: white;
            box-sizing: border-box;
            page-break-inside: avoid;
        ">
            <div style="font-size: 8px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${product.name}
            </div>
            <img src="${barcodeUrl}" alt="" style="width: 34mm; height: 10mm; margin: 1mm 0;" />
            <div style="font-size: 7px; font-family: monospace;">${product.sku}</div>
            <div style="font-size: 10px; font-weight: bold;">₹${product.base_price.toLocaleString('en-IN')}</div>
        </div>
    `;
}
