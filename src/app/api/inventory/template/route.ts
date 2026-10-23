import { NextResponse } from 'next/server';
import { getTemplateBufferFromDatabase } from '@/lib/excel-import';
import { authenticateOperator } from '@/lib/api-auth';
import { ensureServerAuth } from '@/lib/pocketbase';

export async function GET(req: Request) {
    try {
        // The template is generated from the caller's store settings, which used
        // to mean whichever tenant the global client happened to hold.
        const session = await authenticateOperator(req);
        if (!session.ok) {
            return NextResponse.json({ error: session.error || 'Unauthorized' }, { status: session.status });
        }
        await ensureServerAuth(session.email);

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
