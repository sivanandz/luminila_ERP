/**
 * Server-side operator authentication for Next API routes.
 *
 * A caller supplies a bearer token and an optional tenant hint. The hint only
 * selects which database the token is checked against; the token itself has to
 * validate there. A fresh PocketBase client is created per call, so a request
 * can never inherit another tenant's session from module state.
 */

import PocketBase from 'pocketbase';
import { resolveTenantDatabase } from './tenant-db-manager';

export interface OperatorSession {
    ok: boolean;
    status: number;
    error?: string;
    email?: string;
    userId?: string;
    isSuperuser?: boolean;
    pbUrl?: string;
    client?: PocketBase;
}

export function extractBearer(req: Request): string {
    const header = req.headers.get('authorization') || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
}

/**
 * Pure authorization rule for tenant-scoped actions: a session may act on its
 * own tenant, and a superuser may act on any tenant.
 */
export function tenantAccessAllowed(
    sessionEmail: string | undefined,
    isSuperuser: boolean | undefined,
    targetEmail: string
): boolean {
    if (!sessionEmail) return false;
    if (isSuperuser) return true;
    return sessionEmail.trim().toLowerCase() === targetEmail.trim().toLowerCase();
}

export async function authenticateOperator(req: Request, hintEmail?: string): Promise<OperatorSession> {
    const token = extractBearer(req);
    if (!token) {
        return { ok: false, status: 401, error: 'Operator session token is required' };
    }

    const target = (hintEmail || '').trim().toLowerCase();
    let pbUrl: string;
    try {
        const resolved = await resolveTenantDatabase(target || undefined, { activate: false });
        pbUrl = resolved.pbUrl;
    } catch (error) {
        return {
            ok: false,
            status: 503,
            error: error instanceof Error ? error.message : 'Tenant database unavailable',
        };
    }

    const client = new PocketBase(pbUrl);
    client.autoCancellation(false);
    client.authStore.save(token, null);

    let verified = false;
    try {
        await client.collection('users').authRefresh();
        verified = client.authStore.isValid;
    } catch {
        try {
            await client.collection('_superusers').authRefresh();
            verified = client.authStore.isValid;
        } catch {
            verified = false;
        }
    }

    if (!verified) {
        return { ok: false, status: 401, error: 'Invalid or expired operator session', pbUrl };
    }

    const record = client.authStore.record as { id?: string; email?: string } | null;
    const email = (record?.email || '').trim().toLowerCase() || undefined;

    if (target && email && email !== target) {
        return {
            ok: false,
            status: 403,
            error: 'Session does not belong to the requested account',
            pbUrl,
        };
    }

    return {
        ok: true,
        status: 200,
        email,
        userId: record?.id,
        isSuperuser: Boolean(client.authStore.isSuperuser),
        pbUrl,
        client,
    };
}

export interface RoleLike {
    name?: string;
    permissions?: Record<string, string[]>;
}

/**
 * Pure role rule: Admin and Super Admin pass by name, every other role must
 * carry `<resource>: [<action>]` in its permissions map.
 */
export function roleGrantsCapability(
    role: RoleLike | undefined | null,
    resource: string,
    action: string
): boolean {
    if (!role) return false;
    if (role.name === 'Admin' || role.name === 'Super Admin') return true;
    const granted = role.permissions?.[resource];
    return Array.isArray(granted) && granted.includes(action);
}

/**
 * Capability check against the roles assigned to the authenticated user.
 * Superusers pass; a role named Admin passes; otherwise the role's permissions
 * map must contain `<resource>: [<action>]`.
 */
export async function hasCapability(
    session: OperatorSession,
    resource: string,
    action: string
): Promise<boolean> {
    if (!session.ok || !session.client) return false;
    if (session.isSuperuser) return true;
    if (!session.userId) return false;

    try {
        const roles = await session.client.collection('user_roles').getFullList({
            filter: `user="${session.userId}"`,
            expand: 'role',
        });

        return roles.some((entry) => roleGrantsCapability(entry.expand?.role as RoleLike | undefined, resource, action));
    } catch {
        return false;
    }
}
