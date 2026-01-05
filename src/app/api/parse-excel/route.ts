import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// Parse header to extract field name and attribute type info
function parseHeader(header: string): {
    fieldName: string;
    attributeType: string | null;
    options: string[] | null;
    isAttribute: boolean;
} {
    // Check if header contains type suffix like :text, :number, :select[opt1,opt2], :boolean, :date
    const selectMatch = header.match(/^(.+?):select\[([^\]]+)\]$/i);
    if (selectMatch) {
        return {
            fieldName: selectMatch[1].trim(),
            attributeType: 'select',
            options: selectMatch[2].split(',').map(o => o.trim()),
            isAttribute: true
        };
    }

    const typeMatch = header.match(/^(.+?):(text|number|boolean|date)$/i);
    if (typeMatch) {
        return {
            fieldName: typeMatch[1].trim(),
            attributeType: typeMatch[2].toLowerCase(),
            options: null,
            isAttribute: true
        };
    }

    // Standard field (no suffix)
    return {
        fieldName: header.trim(),
        attributeType: null,
        options: null,
        isAttribute: false
    };
}

// Standard product fields (not custom attributes)
const STANDARD_FIELDS = new Set([
    'name', 'sku', 'category', 'base price', 'baseprice', 'price', 'stock',
    'hsn code', 'hsncode', 'hsn', 'status', 'image', 'image url', 'imageurl'
]);

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Parse Excel data with xlsx
        const workbook = XLSX.read(uint8Array, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        if (!worksheet) {
            return NextResponse.json({ error: 'No worksheet found' }, { status: 400 });
        }

        // Get headers from first row
        const rawHeaders: string[] = [];
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            const cell = worksheet[cellAddress];
            rawHeaders.push(cell ? String(cell.v || '').trim() : '');
        }

        // Parse all headers to detect attribute types
        const parsedHeaders = rawHeaders.map(parseHeader);
        const detectedAttributes: Array<{
            name: string;
            type: string;
            options: string[] | null;
        }> = [];

        parsedHeaders.forEach(h => {
            if (h.isAttribute && h.attributeType) {
                detectedAttributes.push({
                    name: h.fieldName,
                    type: h.attributeType,
                    options: h.options
                });
            }
        });

        // Convert to JSON using parsed field names
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

        // Extract embedded images from XLSX (ZIP archive)
        const embeddedImages: string[] = [];
        try {
            const zip = await JSZip.loadAsync(uint8Array);
            const imagePromises: Promise<void>[] = [];

            zip.forEach((relativePath, zipEntry) => {
                if (relativePath.startsWith('xl/media/') && !zipEntry.dir) {
                    const promise = zipEntry.async('base64').then(base64 => {
                        const ext = relativePath.split('.').pop()?.toLowerCase() || 'png';
                        const mimeType = ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' :
                            ext === 'gif' ? 'image/gif' :
                                ext === 'webp' ? 'image/webp' : 'image/png';
                        const dataUrl = `data:${mimeType};base64,${base64}`;

                        const match = relativePath.match(/image(\d+)/i);
                        const imageIndex = match ? parseInt(match[1]) - 1 : embeddedImages.length;
                        embeddedImages[imageIndex] = dataUrl;
                    });
                    imagePromises.push(promise);
                }
            });

            await Promise.all(imagePromises);
        } catch (zipError) {
            console.warn('Could not extract embedded images:', zipError);
        }

        // Build products array with normalized field names and attribute values
        const products = jsonData.map((row: Record<string, any>, index: number) => {
            const product: Record<string, any> = {
                _attributes: {} as Record<string, { value: string; type: string; options?: string[] }>
            };

            // Process each column based on parsed header info
            for (const [rawHeader, value] of Object.entries(row)) {
                const headerInfo = parsedHeaders.find(h =>
                    rawHeader === rawHeaders[parsedHeaders.indexOf(h)]
                ) || parseHeader(rawHeader);

                const stringValue = String(value ?? '').trim();
                const fieldNameLower = headerInfo.fieldName.toLowerCase().replace(/\s+/g, '');

                if (headerInfo.isAttribute) {
                    // Custom attribute
                    product._attributes[headerInfo.fieldName] = {
                        value: stringValue,
                        type: headerInfo.attributeType || 'text',
                        options: headerInfo.options || undefined
                    };
                } else if (STANDARD_FIELDS.has(fieldNameLower) || STANDARD_FIELDS.has(headerInfo.fieldName.toLowerCase())) {
                    // Standard field - normalize the key
                    product[headerInfo.fieldName] = stringValue;
                } else {
                    // Unknown field - treat as text attribute
                    product._attributes[headerInfo.fieldName] = {
                        value: stringValue,
                        type: 'text'
                    };
                }
            }

            // Attach embedded image if available
            if (embeddedImages[index]) {
                product['Image'] = embeddedImages[index];
            } else {
                product['Image'] = product['Image'] || product['Image URL'] || product['image_url'] || '';
            }

            return product;
        }).filter(row => row['Name'] || row['name']);

        return NextResponse.json({
            success: true,
            products,
            detectedAttributes,
            embeddedImageCount: embeddedImages.filter(Boolean).length,
            totalProducts: products.length
        });

    } catch (error: any) {
        console.error('Excel parsing error:', error);
        return NextResponse.json({
            error: error.message || 'Failed to parse Excel file'
        }, { status: 500 });
    }
}
