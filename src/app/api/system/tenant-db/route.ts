import { NextRequest, NextResponse } from 'next/server';
import {
    provisionTenantDatabase,
    resolveTenantDatabase,
    readTenantRegistry,
} from '@/lib/tenant-db-manager';
import { authenticateOperator, tenantAccessAllowed } from '@/lib/api-auth';

export const runtime = 'nodejs';

function registryHasTenant(email: string): boolean {
    const registry = readTenantRegistry();
    return Boolean(registry.tenants[email]) || registry.activeTenantEmail === email;
}

function errorResponse(message: string, status: number) {
    return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * GET /api/system/tenant-db?email=...
 *
 * The login screen runs before a session exists, so the lookup itself stays
 * open. Two things changed: it no longer switches the process-global active
 * tenant, and an unauthenticated caller only receives the URL needed to
 * connect, not the tenant inventory (existence, port, slug).
 */
export async function GET(req: NextRequest) {
    try {
        const emailParam = (req.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
        const registry = readTenantRegistry();
        const targetEmail = emailParam || registry.activeTenantEmail;

        const resolved = await resolveTenantDatabase(targetEmail, { activate: false });

        if (targetEmail && req.headers.get('authorization')) {
            const session = await authenticateOperator(req, targetEmail);
            if (session.ok && tenantAccessAllowed(session.email, session.isSuperuser, targetEmail)) {
                return NextResponse.json(resolved);
            }
        }

        return NextResponse.json({ success: resolved.success, pbUrl: resolved.pbUrl });
    } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 500);
    }
}

/**
 * POST /api/system/tenant-db
 * Body: { mode: 'provision' | 'resolve', email, password?, storeName? }
 *
 * Creating a brand-new tenant is allowed without a session because the setup
 * wizard runs before the first login. Re-provisioning an existing tenant can
 * reset its superuser password, so it requires a valid session for that tenant
 * (or a superuser).
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const mode: 'provision' | 'resolve' = body.mode || 'resolve';
        const email = String(body.email || '').trim().toLowerCase();

        if (!email) {
            return errorResponse('Account email is required', 400);
        }

        if (mode === 'resolve') {
            const resolved = await resolveTenantDatabase(email, { activate: false });
            return NextResponse.json({ success: resolved.success, pbUrl: resolved.pbUrl });
        }

        const password = String(body.password || '');
        if (password.length < 8) {
            return errorResponse('Password must be at least 8 characters', 400);
        }

        if (registryHasTenant(email)) {
            const session = await authenticateOperator(req, email);
            if (!session.ok) {
                return errorResponse(
                    session.error || 'This account already exists. Sign in before re-provisioning it.',
                    session.status
                );
            }
            if (!tenantAccessAllowed(session.email, session.isSuperuser, email)) {
                return errorResponse('You cannot provision another account', 403);
            }
        }

        const provisioned = await provisionTenantDatabase({
            email,
            password,
            storeName: body.storeName ? String(body.storeName).trim() : undefined,
        });
        return NextResponse.json(provisioned);
    } catch (err) {
        console.error('[API /api/system/tenant-db] Error:', err);
        return errorResponse(err instanceof Error ? err.message : String(err), 500);
    }
}
