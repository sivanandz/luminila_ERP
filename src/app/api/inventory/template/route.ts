import { NextResponse } from 'next/server';
import { getTemplateBufferFromDatabase } from '@/lib/excel-import';

export async function GET() {
    try {
        const buffer = await getTemplateBufferFromDatabase();

        const uint8Array = new Uint8Array(buffer);

        return new NextResponse(uint8Array, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="luminila_inventory_import_template.xlsx"',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
        });
    } catch (err) {
        console.error('Error serving inventory template:', err);
        return NextResponse.json({ error: 'Failed to generate inventory template' }, { status: 500 });
    }
}
