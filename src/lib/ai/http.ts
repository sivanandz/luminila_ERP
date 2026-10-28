/**
 * Shared plumbing for the /api/ai routes (server-only).
 *
 * Every AI route derives its tenant identity from the verified PocketBase
 * operator session — never from the request body. The tenant scope is the
 * user's `account_email` (the store owner) when present, falling back to the
 * signed-in email; the operator email is kept separately for audit fields.
 */

import PocketBase from 'pocketbase';
import { NextResponse } from 'next/server';
import { authenticateOperator, hasCapability, type OperatorSession } from '../api-auth';
import { createTenantClient } from '../pocketbase';
import { readRegistrySecret } from '../tenant-secrets';
import { readTenantRegistry } from '../tenant-db-manager';
import { FixedWindowRateLimiter } from '../rate-limit';
import type { Permission, Resource } from '../rbac';

export interface CapabilityChecker {
    isAdmin: boolean;
    has(resource: Resource, action: Permission): Promise<boolean>;
}

export interface AiRequestContext {
    session: OperatorSession;
    /** Client authenticated as the operator; all ERP reads go through it. */
    operatorClient: PocketBase;
    /** Superuser client for server-owned AI collections (providers, log). */
    adminClient: PocketBase;
    /** Tenant scope for ERP data (store owner email when available). */
    accountEmail: string;
    /** Signed-in operator email, used for audit fields. */
    operatorEmail: string;
    userId?: string;
    capabilities: CapabilityChecker;
}

export type AiAuthResult =
    | { ok: true; context: AiRequestContext }
    | { ok: false; response: NextResponse };

export const AI_CHAT_REQUESTS_PER_MINUTE = 30;
export const AI_CONFIG_REQUESTS_PER_MINUTE = 20;
const MAX_JSON_BODY_BYTES = 256 * 1024;
const CONVERSATION_LOCK_TTL_MS = 10 * 60 * 1000;

const chatLimiter = new FixedWindowRateLimiter({ max: AI_CHAT_REQUESTS_PER_MINUTE, windowMs: 60_000 });
const configLimiter = new FixedWindowRateLimiter({ max: AI_CONFIG_REQUESTS_PER_MINUTE, windowMs: 60_000 });
// Read-only surfaces (status/conversation list/detail) get their own bucket so
// UI polling cannot consume the expensive turn budget.
const readLimiter = new FixedWindowRateLimiter({ max: 120, windowMs: 60_000 });

export function jsonError(status: number, message: string, code?: string): NextResponse {
    return NextResponse.json({ success: false, error: message, ...(code ? { code } : {}) }, { status });
}

export function jsonOk(data: unknown, status = 200): NextResponse {
    const body = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : { data };
    // Spread first so a payload field named `success` cannot override the flag.
    return NextResponse.json({ ...body, success: true }, { status });
}

function tenantHint(req: Request): string | undefined {
    const header = (req.headers.get('x-tenant-email') || '').trim().toLowerCase();
    if (header) return header;
    try {
        const url = new URL(req.url);
        const query = (url.searchParams.get('tenant') || '').trim().toLowerCase();
        if (query) return query;
    } catch {
        // Ignore malformed URLs; auth will fail closed below.
    }
    return undefined;
}

/**
 * Authenticate an AI route: bearer operator token, tenant resolution, admin
 * client for server-owned collections, RBAC capability cache and rate limit.
 */
export async function authenticateAiRequest(
    req: Request,
    limiter: FixedWindowRateLimiter = chatLimiter
): Promise<AiAuthResult> {
    const session = await authenticateOperator(req, tenantHint(req));
    if (!session.ok || !session.client) {
        return {
            ok: false,
            response: jsonError(session.status || 401, session.error || 'Operator session required.', 'unauthorized'),
        };
    }
    const operatorEmail = (session.email || '').trim().toLowerCase();
    if (!operatorEmail) {
        return { ok: false, response: jsonError(401, 'Operator session has no usable email.', 'unauthorized') };
    }

    const record = session.client.authStore.record as Record<string, unknown> | null;
    const recordAccountEmail = typeof record?.account_email === 'string' ? record.account_email.trim().toLowerCase() : '';
    const accountEmail = recordAccountEmail || operatorEmail;

    const rateKey = `ai:${accountEmail}:${session.userId || operatorEmail}`;
    const rate = limiter.check(rateKey);
    if (!rate.allowed) {
        const response = jsonError(429, 'Too many AI requests. Wait a moment and try again.', 'rate_limited');
        response.headers.set('Retry-After', String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
        return { ok: false, response };
    }

    let adminClient: PocketBase;
    try {
        adminClient = await createAdminClientForTenant(session.pbUrl || session.client.baseUrl);
    } catch (error) {
        return {
            ok: false,
            response: jsonError(
                503,
                error instanceof Error ? error.message : 'The tenant database could not be reached for AI settings.',
                'tenant_admin_unavailable'
            ),
        };
    }

    const admin = session.isSuperuser === true || (await hasCapability(session, 'settings', 'update'));
    const cache = new Map<string, Promise<boolean>>();
    const capabilities: CapabilityChecker = {
        isAdmin: admin,
        has: (resource, action) => {
            const key = `${resource}:${action}`;
            const existing = cache.get(key);
            if (existing) return existing;
            const promise = admin ? Promise.resolve(true) : hasCapability(session, resource, action);
            cache.set(key, promise);
            return promise;
        },
    };

    return {
        ok: true,
        context: {
            session,
            operatorClient: session.client,
            adminClient,
            accountEmail,
            operatorEmail,
            userId: session.userId,
            capabilities,
        },
    };
}

/** Admin-only gate for provider configuration endpoints. */
export async function requireAiAdmin(context: AiRequestContext): Promise<NextResponse | null> {
    if (context.session.isSuperuser === true) return null;
    if (await context.capabilities.has('settings', 'update')) return null;
    return jsonError(403, 'Only an administrator can manage AI provider settings.', 'forbidden');
}

/** Config endpoints use a tighter limiter than chat. */
export async function authenticateAiConfigRequest(req: Request): Promise<AiAuthResult> {
    return authenticateAiRequest(req, configLimiter);
}

/** Read-only endpoints get a separate, more generous bucket. */
export async function authenticateAiReadRequest(req: Request): Promise<AiAuthResult> {
    return authenticateAiRequest(req, readLimiter);
}

interface AdminCredentials {
    email: string;
    password: string;
}

function adminCredentialsForUrl(pbUrl: string): AdminCredentials | null {
    try {
        const port = Number(new URL(pbUrl).port);
        if (port) {
            const registry = readTenantRegistry();
            for (const tenant of Object.values(registry.tenants)) {
                if (tenant.port === port && tenant.email && tenant.adminPassword) {
                    return { email: tenant.email, password: readRegistrySecret(tenant.adminPassword) };
                }
            }
        }
    } catch {
        // Fall through to the deployment environment credentials.
    }
    const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || '';
    const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || '';
    if (!email || !password) return null;
    return { email, password: readRegistrySecret(password) };
}

/**
 * Superuser client for the exact PocketBase instance the operator session was
 * verified against. Using the session's URL (not the registry's "active"
 * tenant) prevents cross-tenant reads under concurrent tenants.
 */
export async function createAdminClientForTenant(pbUrl: string): Promise<PocketBase> {
    const credentials = adminCredentialsForUrl(pbUrl);
    if (credentials) {
        const client = new PocketBase(pbUrl);
        client.autoCancellation(false);
        try {
            await client.collection('_superusers').authWithPassword(credentials.email, credentials.password);
            if (client.authStore.isValid) return client;
        } catch {
            // Fall back to the registry-resolved tenant client below.
        }
    }
    const fallback = await createTenantClient();
    if (fallback.baseUrl === pbUrl) return fallback;
    throw new Error('The tenant database for this session is unavailable.');
}

/** Read and shape-check a JSON body with a hard size cap. */
export async function readJsonBody<T>(req: Request): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
    const lengthHeader = req.headers.get('content-length');
    if (lengthHeader) {
        const length = Number(lengthHeader);
        if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) {
            return { ok: false, response: jsonError(413, 'Request body is too large.', 'payload_too_large') };
        }
    }
    try {
        // Read with an explicit byte bound: content-length can be absent on a
        // chunked request, so the stream itself must be capped.
        let text = '';
        if (req.body) {
            const reader = req.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let bytes = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > MAX_JSON_BODY_BYTES) {
                    await reader.cancel().catch(() => undefined);
                    return { ok: false, response: jsonError(413, 'Request body is too large.', 'payload_too_large') };
                }
                text += decoder.decode(value, { stream: true });
            }
            text += decoder.decode();
        }
        const body = JSON.parse(text) as T;
        if (!body || typeof body !== 'object') {
            return { ok: false, response: jsonError(400, 'Request body must be a JSON object.', 'invalid_body') };
        }
        return { ok: true, body };
    } catch {
        return { ok: false, response: jsonError(400, 'Request body is not valid JSON.', 'invalid_body') };
    }
}

const conversationLocks = new Map<string, number>();

/**
 * One writer per conversation. A second concurrent turn gets a 409 instead of
 * interleaving event sequences; stale locks expire after 10 minutes.
 */
export function acquireConversationLock(conversationId: string): boolean {
    const now = Date.now();
    const existing = conversationLocks.get(conversationId);
    if (existing !== undefined && now - existing < CONVERSATION_LOCK_TTL_MS) return false;
    conversationLocks.set(conversationId, now);
    return true;
}

export function releaseConversationLock(conversationId: string): void {
    conversationLocks.delete(conversationId);
}

export function isConversationLocked(conversationId: string): boolean {
    const existing = conversationLocks.get(conversationId);
    if (existing === undefined) return false;
    if (Date.now() - existing >= CONVERSATION_LOCK_TTL_MS) {
        conversationLocks.delete(conversationId);
        return false;
    }
    return true;
}
