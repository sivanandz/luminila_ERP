import { NextResponse } from 'next/server';
import { syncCatalog } from '@/lib/catalog-sync';

export async function POST(req: Request) {
    try {
        // Optional: Check for authorization (e.g. CRON_SECRET)
        // const authHeader = req.headers.get('authorization');
        // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        //     return new NextResponse('Unauthorized', { status: 401 });
        // }

        const result = await syncCatalog();

        if (result.success) {
            return NextResponse.json(result);
        } else {
            return NextResponse.json(result, { status: 500 });
        }
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// Allow manual trigger via GET for easy testing in browser
export async function GET(req: Request) {
    return POST(req);
}
