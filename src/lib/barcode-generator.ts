/**
 * Barcode Generator Utility
 * Generates barcodes for product SKUs for reliable stock updates
 */

export type SymbologyMode = '2D_DATAMATRIX_ECC200' | '2D_QRCODE' | '1D_CODE128_POINTER';

/**
 * Generate barcode as data URL using bwip-js or external API
 * Uses Code 128 format which supports alphanumeric SKUs
 */
export function generateBarcodeURL(sku: string): string {
    const encoded = encodeURIComponent(sku);
    return `https://barcodeapi.org/api/128/${encoded}`;
}

/**
 * Generate Data Matrix ECC 200 symbol URL (ISO/IEC 16022)
 * High density 2D code optimal for micro dumbbell tags (Wing A 19x10mm)
 */
export function generateDataMatrixURL(sku: string): string {
    const encoded = encodeURIComponent(sku);
    return `https://barcode.tec-it.com/barcode.ashx?data=${encoded}&code=DataMatrix&unit=Fit&dpi=300`;
}

/**
 * Generate QR code symbol URL (ISO/IEC 18004)
 */
export function generateQRCodeURL(sku: string): string {
    const encoded = encodeURIComponent(sku);
    return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encoded}`;
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
 * Generate 54x11mm Dumbbell Label HTML for jewelry thermal printers
 * Left Wing A (19x10mm) + Adhesive-free Bridge (16x2mm) + Right Wing B (19x10mm)
 */
export function generateDumbbellLabelHTML(product: {
    sku: string;
    name: string;
    base_price?: number;
    hsn_code?: string;
    symbology?: SymbologyMode;
}): string {
    const symbology = product.symbology || '2D_DATAMATRIX_ECC200';
    let codeUrl = '';
    if (symbology === '2D_DATAMATRIX_ECC200') {
        codeUrl = generateDataMatrixURL(product.sku);
    } else if (symbology === '2D_QRCODE') {
        codeUrl = generateQRCodeURL(product.sku);
    } else {
        codeUrl = generateBarcodeURL(product.sku);
    }

    const formattedPrice = (Number(product.base_price) || 0).toLocaleString('en-IN');
    const hsn = product.hsn_code || '71179010';

    return `
        <div style="
            width: 54mm;
            height: 11mm;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: white;
            color: black;
            font-family: Arial, sans-serif;
            box-sizing: border-box;
            padding: 0.5mm;
            page-break-inside: avoid;
            border: 1px dashed #ddd;
        ">
            <!-- Wing A: Symbology Zone (19 x 10mm) -->
            <div style="
                width: 19mm;
                height: 10mm;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            ">
                <img src="${codeUrl}" alt="${product.sku}" style="
                    max-width: ${symbology === '1D_CODE128_POINTER' ? '18mm' : '9mm'};
                    max-height: 9mm;
                    object-fit: contain;
                " />
            </div>

            <!-- Central Bridge: Adhesive-Free (16 x 2mm) -->
            <div style="
                width: 16mm;
                height: 2mm;
                border-top: 1px dotted #ccc;
                border-bottom: 1px dotted #ccc;
            "></div>

            <!-- Wing B: Text Information Zone (19 x 10mm) -->
            <div style="
                width: 19mm;
                height: 10mm;
                display: flex;
                flex-direction: column;
                justify-content: center;
                text-align: right;
                overflow: hidden;
                line-height: 1.1;
            ">
                <div style="font-size: 5.5pt; font-weight: 900; letter-spacing: 0.5px;">LUMINILA</div>
                <div style="font-size: 4.8pt; font-family: monospace; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${product.sku}</div>
                <div style="font-size: 5.5pt; font-weight: 900;">₹${formattedPrice}</div>
                <div style="font-size: 4.2pt; color: #555;">HSN ${hsn}</div>
            </div>
        </div>
    `;
}

/**
 * Generate a printable label with product info and barcode
 */
export function generateLabelHTML(product: {
    sku: string;
    name: string;
    base_price?: number;
}): string {
    const barcodeUrl = generateBarcodeURL(product.sku);
    const formattedPrice = (Number(product.base_price) || 0).toLocaleString('en-IN');

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
                ₹${formattedPrice}
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
    base_price?: number;
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
    base_price?: number;
}): string {
    const barcodeUrl = generateBarcodeURL(product.sku);
    const formattedPrice = (Number(product.base_price) || 0).toLocaleString('en-IN');

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
            <div style="font-size: 10px; font-weight: bold;">₹${formattedPrice}</div>
        </div>
    `;
}
