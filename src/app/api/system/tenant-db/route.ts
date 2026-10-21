import { NextRequest, NextResponse } from 'next/server';
import {
    provisionTenantDatabase,
    resolveTenantDatabase,
    readTenantRegistry,
} from '@/lib/tenant-db-manager';

export const runtime = 'nodejs';

/**
 * GET /api/system/tenant-db?email=...
 * Resolves and ensures the isolated PocketBase instance for the requested email (or active tenant) is running.
 */
export async function GET(req: NextRequest) {
    try {
        const emailParam = req.nextUrl.searchParams.get('email') || undefined;
        const registry = readTenantRegistry();
        const targetEmail = emailParam || registry.activeTenantEmail;
        const resolved = await resolveTenantDatabase(targetEmail);
        return NextResponse.json(resolved);
    } catch (err) {
        return NextResponse.json(
            {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 }
        );
    }
}

/**
 * POST /api/system/tenant-db
 * Body: { mode: 'provision' | 'resolve', email: string, password?: string, storeName?: string }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const mode: 'provision' | 'resolve' = body.mode || 'resolve';
        const email = String(body.email || '').trim().toLowerCase();

        if (!email) {
            return NextResponse.json(
                { success: false, error: 'Account email is required' },
                { status: 400 }
            );
        }

        if (mode === 'provision') {
            const password = String(body.password || '');
            if (password.length < 8) {
                return NextResponse.json(
                    { success: false, error: 'Password must be at least 8 characters' },
                    { status: 400 }
                );
            }

            const provisioned = await provisionTenantDatabase({
                email,
                password,
                storeName: body.storeName ? String(body.storeName).trim() : undefined,
            });
            return NextResponse.json(provisioned);
        }

        const resolved = await resolveTenantDatabase(email);
        return NextResponse.json(resolved);
    } catch (err) {
        console.error('[API /api/system/tenant-db] Error:', err);
        return NextResponse.json(
            {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 }
        );
    }
}
