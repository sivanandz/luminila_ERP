import { NextResponse } from 'next/server';
import { createTenantClient } from '@/lib/pocketbase';

export const runtime = 'nodejs';

/**
 * Setup bootstrap status (A-18).
 *
 * The setup page used to count users with the anonymous browser client, which
 * is always rejected by `users.listRule` and made a completed install look
 * fresh. The count runs server-side on a tenant client instead.
 */
export async function GET() {
    try {
        const client = await createTenantClient();
        const users = await client.collection('users').getList(1, 1);
        return NextResponse.json({ complete: users.totalItems > 0 });
    } catch {
        // Without superuser credentials the server cannot prove completion;
        // report false and let the setup wizard verify health explicitly.
        return NextResponse.json({ complete: false });
    }
}
