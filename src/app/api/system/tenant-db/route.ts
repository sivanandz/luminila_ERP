import { NextRequest, NextResponse } from 'next/server';
import {
    provisionTenantDatabase,
    resolvePrimaryPocketBasePort,
    resolveTenantDatabase,
    readTenantRegistry,
    tenantDatabaseExists,
} from '@/lib/tenant-db-manager';
import { authenticateOperator, constantTimeEqual, tenantAccessAllowed } from '@/lib/api-auth';
import { isSingleAccountMode } from '@/lib/deployment-mode';

export const runtime = 'nodejs';

/**
 * Provisioning is an unauthenticated path during first-run setup, so it is
 * rate-limited per client address. In-memory is enough: the window that
 * matters is one setup session, and a restart resets the counter rather than
 * locking an operator out.
 */
const PROVISION_WINDOW_MS = 10 * 60 * 1000;
const PROVISION_MAX_ATTEMPTS = 5;
const provisionAttempts = new Map<string, { count: number; resetAt: number }>();

function clientAddress(req: NextRequest): string {
    const forwarded = req.headers.get('x-forwarded-for') || '';
    return (forwarded.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim();
}

function rateLimited(req: NextRequest): boolean {
    const key = clientAddress(req);
    const now = Date.now();
    const entry = provisionAttempts.get(key);
    if (!entry || entry.resetAt <= now) {
        provisionAttempts.set(key, { count: 1, resetAt: now + PROVISION_WINDOW_MS });
        return false;
    }
    entry.count += 1;
    return entry.count > PROVISION_MAX_ATTEMPTS;
}

/** Optional shared secret for provisioning; required when configured. */
function setupTokenValid(req: NextRequest): boolean {
    const expected = (process.env.TENANT_SETUP_TOKEN || process.env.SETUP_TOKEN || '').trim();
    if (!expected) return true;
    const provided = (req.headers.get('x-setup-token') || '').trim();
    return Boolean(provided) && constantTimeEqual(provided, expected);
}

function errorResponse(message: string, status: number) {
    return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * Single-account deployments have one database. Resolve it through the same
 * port probe the tenant paths use, so a deployment listening on 8091 is not
 * reported as 8090.
 */
async function primaryPocketBaseUrl(): Promise<string> {
    const port = await resolvePrimaryPocketBasePort();
    return `http://127.0.0.1:${port}`;
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
        // One database per deployment: the email parameter cannot select another
        // instance, so it is neither read nor trusted.
        if (isSingleAccountMode()) {
            return NextResponse.json({ success: true, pbUrl: await primaryPocketBaseUrl() });
        }

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

        // Provisioning is a multi-account operation and must be refused before
        // any authentication or registry work. Resolve still answers with the
        // primary instance so old clients can connect, but never with an
        // emailed tenant.
        if (isSingleAccountMode()) {
            if (mode === 'provision') {
                return NextResponse.json(
                    { success: false, error: 'Multi-account provisioning is disabled in this single-account deployment.' },
                    { status: 403 }
                );
            }
            return NextResponse.json({ success: true, pbUrl: await primaryPocketBaseUrl() });
        }

        const email = String(body.email || '').trim().toLowerCase();

        if (!email) {
            return errorResponse('Account email is required', 400);
        }

        if (mode === 'resolve') {
            const resolved = await resolveTenantDatabase(email, { activate: false });
            return NextResponse.json({ success: resolved.success, pbUrl: resolved.pbUrl });
        }

        if (rateLimited(req)) {
            return errorResponse('Too many provisioning attempts. Try again later.', 429);
        }

        const password = String(body.password || '');
        if (password.length < 8) {
            return errorResponse('Password must be at least 8 characters', 400);
        }

        // Any account that already has a database (registry entry, data dir or
        // a shared slug owner) can only be re-provisioned by a session for that
        // account. Checking the registry alone let an unauthenticated caller
        // reset the primary superuser password after the registry was cleared
        // (A-03).
        if (tenantDatabaseExists(email)) {
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
        } else if (!setupTokenValid(req)) {
            return errorResponse('A valid setup token is required to provision a new account', 401);
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
