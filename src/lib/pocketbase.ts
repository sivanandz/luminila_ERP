import PocketBase from 'pocketbase';
import { readRegistrySecret } from './tenant-secrets';
import { resolvePocketBaseBaseUrl } from './pocketbase-url';
import { isSingleAccountMode, SINGLE_ACCOUNT_EMAIL } from './deployment-mode';

// Determine default URL
const DEFAULT_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';

/**
 * Get active PocketBase base URL.
 *
 * The browser resolution lives in `pocketbase-url.ts` so it can be tested and
 * so hosted deployments (HTTPS, private Tailscale URL, same-origin /pb) never
 * fall back to an unreachable localhost origin.
 */
export function getPocketBaseUrl(): string {
    if (typeof window !== "undefined") {
        return resolvePocketBaseBaseUrl({
            envUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL,
            storedUrl: localStorage.getItem("PB_CUSTOM_URL") || undefined,
            protocol: window.location.protocol,
            hostname: window.location.hostname,
            origin: window.location.origin,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        });
    }
    return DEFAULT_URL.replace(/\/+$/, "");
}

// Instantiate PocketBase client
export const pb = new PocketBase(getPocketBaseUrl());

export interface TenantRegistryLike {
    activeTenantEmail?: string;
    tenants?: Record<string, { port?: number; email?: string; adminPassword?: string }>;
}

/**
 * Pure resolution of where a tenant lives and which credentials to use.
 * Separated from I/O so the ordering rules are testable.
 */
export function resolveTenantRuntime(
    email: string | undefined,
    registry: TenantRegistryLike | null,
    env: { email?: string; password?: string },
    fallbackUrl: string
): { url: string; adminEmail: string; adminPassword: string } {
    const target = (email || registry?.activeTenantEmail || '').trim().toLowerCase();
    const record = target && registry?.tenants ? registry.tenants[target] : undefined;

    return {
        url: record?.port ? `http://127.0.0.1:${record.port}` : fallbackUrl,
        adminEmail: record?.email || env.email || '',
        adminPassword: record?.adminPassword || env.password || '',
    };
}

/**
 * Authenticate a fresh client with superuser credentials, falling back to the
 * users collection for deployments whose admin lives there.
 */
async function authenticateTenantClient(client: PocketBase, email: string, password: string): Promise<void> {
    if (!email || !password) return;
    // Values may be plaintext (legacy registry) or enc:v1: ciphertext.
    const secret = readRegistrySecret(password);
    try {
        await client.collection("_superusers").authWithPassword(email, secret);
    } catch {
        await client.collection("users").authWithPassword(email, secret).catch(() => {});
    }
}

/**
 * A fresh, authenticated client for one tenant.
 *
 * `ensureServerAuth` mutates the module-level client's base URL and auth store,
 * which is unsafe under concurrency: two requests for different tenants can
 * interleave and one can read the other's data. This helper never touches the
 * shared client, so a route that uses it is isolated by construction.
 */
export async function createTenantClient(preferredTenantEmail?: string): Promise<PocketBase> {
    // Single mode has exactly one database: no registry read, no per-email lookup.
    if (isSingleAccountMode()) {
        const singleClient = new PocketBase(getPocketBaseUrl());
        singleClient.autoCancellation(false);
        await authenticateTenantClient(
            singleClient,
            process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || '',
            process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || ''
        );
        return singleClient;
    }

    let registry: TenantRegistryLike | null = null;

    if (typeof window === "undefined") {
        try {
            const nodeRequire = eval("require") as NodeRequire;
            const fs = nodeRequire("fs") as typeof import("fs");
            const path = nodeRequire("path") as typeof import("path");
            const registryPath = path.join(process.cwd(), "pocketbase", "pb_tenants", "registry.json");
            if (fs.existsSync(registryPath)) {
                registry = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as TenantRegistryLike;
            }
        } catch {
            registry = null;
        }
    }

    const runtime = resolveTenantRuntime(
        preferredTenantEmail,
        registry,
        {
            email: process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || '',
            password: process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || '',
        },
        getPocketBaseUrl()
    );

    const client = new PocketBase(runtime.url);
    client.autoCancellation(false);
    await authenticateTenantClient(client, runtime.adminEmail, runtime.adminPassword);
    return client;
}

// Disable auto-cancellation for duplicate requests
pb.autoCancellation(false);

/**
 * Email stamped on records and used to scope filters.
 *
 * Single mode always returns the one account, whichever user signed in: the
 * PocketBase rules treat SINGLE_ACCOUNT_EMAIL as the owner of rows stamped with
 * it or with an empty account_email. Multi mode returns the signed-in user's
 * lowercased email, or '' when there is no session.
 */
export function accountScopeEmail(): string {
    if (isSingleAccountMode()) return SINGLE_ACCOUNT_EMAIL;
    return pb.authStore.model?.email?.trim().toLowerCase() || '';
}

// Account Data Isolation: Auto-inject account_email on record creation
pb.beforeSend = function (url, options) {
    const accountEmail = accountScopeEmail();
    if (options.method === 'POST' && accountEmail) {
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            if (!(options.body as Record<string, unknown>).account_email) {
                (options.body as Record<string, unknown>).account_email = accountEmail;
            }
        } else if (options.body instanceof FormData) {
            if (!options.body.has('account_email')) {
                options.body.append('account_email', accountEmail);
            }
        }
    }
    return { url, options };
};

/**
 * Ensure PocketBase client authStore is hydrated from browser localStorage
 */
export function ensureAuth(): boolean {
    if (typeof window !== "undefined" && !pb.authStore.isValid) {
        try {
            const raw = localStorage.getItem("pocketbase_auth");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.token) {
                    pb.authStore.save(parsed.token, parsed.record || parsed.model);
                    return true;
                }
            }
        } catch { /* ignore parsing errors */ }
    }
    return pb.authStore.isValid;
}

if (typeof window !== "undefined") {
    ensureAuth();
}

/**
 * Ensure PocketBase client is authenticated in server-side API routes (Node.js)
 * Automatically routes to the active or preferred tenant's isolated PocketBase instance if provisioned.
 */
export async function ensureServerAuth(preferredTenantEmail?: string): Promise<boolean> {
    // Single mode has one database: skip the tenant registry entirely.
    if (typeof window === "undefined" && !isSingleAccountMode()) {
        try {
            const nodeRequire = eval("require") as NodeRequire;
            const fs = nodeRequire("fs") as typeof import("fs");
            const path = nodeRequire("path") as typeof import("path");
            const registryPath = path.join(process.cwd(), "pocketbase", "pb_tenants", "registry.json");
            if (fs.existsSync(registryPath)) {
                const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
                const targetEmail = (preferredTenantEmail || registry.activeTenantEmail || "").trim().toLowerCase();
                const tenantRec = targetEmail ? registry.tenants?.[targetEmail] : undefined;
                if (tenantRec?.port) {
                    const targetUrl = `http://127.0.0.1:${tenantRec.port}`;
                    if (pb.baseUrl !== targetUrl) {
                        pb.baseUrl = targetUrl;
                        pb.authStore.clear();
                    }
                    if (pb.authStore.isValid && (pb.authStore as any).isSuperuser) {
                        return true;
                    }
                    if (tenantRec.email && tenantRec.adminPassword) {
                        await pb.collection("_superusers").authWithPassword(tenantRec.email, readRegistrySecret(tenantRec.adminPassword));
                        return true;
                    }
                }
            }
        } catch {
            // Fall through to standard environment variable superuser auth
        }
    }

    if (pb.authStore.isValid && (pb.authStore as any).isSuperuser) return true;
    // Single mode falls back to the one account so routes authenticate as the
    // identity their records are stamped with.
    const adminEmail = process.env.POCKETBASE_SUPERUSER_EMAIL
        || process.env.PB_ADMIN_EMAIL
        || (isSingleAccountMode() ? SINGLE_ACCOUNT_EMAIL : '');
    const adminPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) {
        return pb.authStore.isValid;
    }
    try {
        await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
        return true;
    } catch {
        try {
            await pb.collection('users').authWithPassword(adminEmail, adminPassword);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Update the PocketBase server URL at runtime
 * Persists to localStorage and notifies subscribers
 */
export function setPocketBaseUrl(url: string): string {
    const sanitized = url.trim().replace(/\/+$/, "");
    if (typeof window !== "undefined") {
        if (sanitized && sanitized !== DEFAULT_URL) {
            localStorage.setItem("PB_CUSTOM_URL", sanitized);
        } else {
            localStorage.removeItem("PB_CUSTOM_URL");
        }
    }

    // Re-point PocketBase instance
    pb.baseUrl = sanitized || DEFAULT_URL;

    // Dispatch event so UI can react without page reload
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pb:server-changed", { detail: { url: pb.baseUrl } }));
    }

    return pb.baseUrl;
}

/**
 * Adapt a localhost PocketBase URL (http://127.0.0.1:<port>) to the current LAN host when accessed over LAN
 */
function adaptPocketBaseHostForClient(pbUrl: string): string {
    if (typeof window === "undefined") return pbUrl;
    const host = window.location.hostname;
    const isTunnelHost = host.includes("trycloudflare.com") || host.includes("cloudflare");
    if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "tauri.localhost" && !isTunnelHost) {
        return pbUrl.replace("127.0.0.1", host).replace("localhost", host);
    }
    return pbUrl;
}

/**
 * Provision a dedicated, physically isolated PocketBase instance for an account during `/setup`
 */
export async function provisionTenantPocketBase(
    email: string,
    password: string,
    storeName?: string
): Promise<{
    success: boolean;
    pbUrl: string;
    port?: number;
    tenantSlug?: string;
    isolated?: boolean;
    error?: string;
}> {
    // Single mode never provisions a second database; refuse without an API call.
    if (isSingleAccountMode()) {
        return {
            success: false,
            pbUrl: getPocketBaseUrl(),
            error: 'Multi-account provisioning is disabled in single-account mode.',
        };
    }

    try {
        const res = await fetch("/api/system/tenant-db", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: "provision",
                email: email.trim().toLowerCase(),
                password,
                storeName,
            }),
        });
        const data = await res.json();
        if (data.success && data.pbUrl) {
            const clientUrl = adaptPocketBaseHostForClient(data.pbUrl);
            setPocketBaseUrl(clientUrl);
            return { ...data, pbUrl: clientUrl };
        }
        return {
            success: false,
            pbUrl: getPocketBaseUrl(),
            error: data.error || "Failed to provision isolated tenant database",
        };
    } catch (err) {
        return {
            success: false,
            pbUrl: getPocketBaseUrl(),
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Drop a leftover tenant database URL before single mode resolves anything.
 *
 * Constraint: getPocketBaseUrl() prefers the stored PB_CUSTOM_URL value, so a
 * tenant URL left in storage by the previous multi-account mode would otherwise
 * win over the single account's database. Ports 8092..8199 are the tenant
 * range; a stored primary URL on 8090/8091 is a legitimate override and stays.
 */
function dropStaleTenantUrl(): void {
    if (typeof window === "undefined") return;
    let stored = "";
    try {
        stored = localStorage.getItem("PB_CUSTOM_URL") || "";
    } catch {
        return;
    }
    if (!stored) return;
    const portMatch = stored.match(/:(\d{2,5})(?:\/|$)/);
    if (!portMatch) return;
    const port = Number(portMatch[1]);
    if (port >= 8092 && port <= 8199) {
        setPocketBaseUrl("");
    }
}

/**
 * Resolve and wake up the dedicated PocketBase instance for an account during `/login` or session restore
 */
export async function resolveTenantPocketBase(email?: string): Promise<string> {
    // Single mode has one database: drop a stale tenant URL and make no request.
    if (isSingleAccountMode()) {
        dropStaleTenantUrl();
        return getPocketBaseUrl();
    }

    try {
        const cleanEmail = (email || pb.authStore.model?.email || "").trim().toLowerCase();
        const endpoint = cleanEmail
            ? `/api/system/tenant-db?email=${encodeURIComponent(cleanEmail)}`
            : "/api/system/tenant-db";
        const res = await fetch(endpoint);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.pbUrl) {
                const clientUrl = adaptPocketBaseHostForClient(data.pbUrl);
                setPocketBaseUrl(clientUrl);
                return clientUrl;
            }
        }
    } catch {
        // Fallback to standard discovery if Next.js API is unreachable
    }
    return getPocketBaseUrl();
}

/**
 * Single mode has no tenant to wake: health-check the primary URL and, on
 * localhost only, fall back to the two primary ports. Tenant databases lived on
 * 8092+, so that range is never probed here.
 */
async function autoDiscoverSingleAccountPocketBase(): Promise<string> {
    if (typeof window === "undefined") return getPocketBaseUrl();

    ensureAuth();
    const resolved = await resolveTenantPocketBase();

    try {
        const probe = new PocketBase(resolved);
        probe.autoCancellation(false);
        const health = await probe.health.check();
        if (health.code === 200) return resolved;
    } catch {
        // Fall through to the primary-port probe
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        const candidatePorts = [8091, 8090];
        for (const port of candidatePorts) {
            const candidateUrl = `http://127.0.0.1:${port}`;
            if (candidateUrl === resolved) continue;
            try {
                const testPb = new PocketBase(candidateUrl);
                testPb.autoCancellation(false);
                const health = await testPb.health.check();
                if (health.code === 200) {
                    setPocketBaseUrl(candidateUrl);
                    return candidateUrl;
                }
            } catch {
                // Port not responding
            }
        }
    }
    return resolved;
}

/**
 * Auto-discover active PocketBase server on localhost if default port (8090)
 * is blocked or occupied by a foreign application, or wake up the tenant's isolated DB.
 */
export async function autoDiscoverPocketBase(): Promise<string> {
    if (isSingleAccountMode()) {
        return autoDiscoverSingleAccountPocketBase();
    }

    if (typeof window !== "undefined") {
        ensureAuth();
        const authedEmail = pb.authStore.model?.email;
        if (authedEmail) {
            try {
                const resolved = await resolveTenantPocketBase(authedEmail);
                const health = await pb.health.check();
                if (health.code === 200) return resolved;
            } catch {
                // Continue to fallback probing
            }
        }
    }

    const current = getPocketBaseUrl();
    try {
        const res = await pb.health.check();
        if (res.code === 200) return current;
    } catch {
        // First ask the tenant-db API to resolve/wake the active instance
        if (typeof window !== "undefined") {
            try {
                const resolved = await resolveTenantPocketBase();
                const health = await pb.health.check();
                if (health.code === 200) return resolved;
            } catch {
                // Fallback to port probing
            }
        }

        // Current URL failed, probe alternative ports on localhost
        if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
            const candidatePorts = [8091, 8090, 8092];
            for (const port of candidatePorts) {
                const candidateUrl = `http://127.0.0.1:${port}`;
                if (candidateUrl === current) continue;
                try {
                    const testPb = new PocketBase(candidateUrl);
                    testPb.autoCancellation(false);
                    const health = await testPb.health.check();
                    if (health.code === 200) {
                        setPocketBaseUrl(candidateUrl);
                        return candidateUrl;
                    }
                } catch {
                    // Port not responding
                }
            }
        }
    }
    return current;
}

/**
 * Escape user-supplied strings before interpolating them into
 * PocketBase filter expressions. Prevents filter injection by
 * escaping double-quotes and backslashes.
 */
export function sanitizeFilter(input: string): string {
    return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface ServerHealthResult {
    ok: boolean;
    url: string;
    isTunnel: boolean;
    latencyMs?: number;
    error?: string;
}

/**
 * Check if a PocketBase server URL is reachable
 */
export async function checkServerStatus(targetUrl?: string): Promise<ServerHealthResult> {
    const urlToCheck = (targetUrl || pb.baseUrl).replace(/\/+$/, "");
    const isTunnel = urlToCheck.includes("trycloudflare.com") ||
        urlToCheck.includes("cloudflare") ||
        urlToCheck.startsWith("https://");

    const startTime = Date.now();
    try {
        const testClient = targetUrl ? new PocketBase(urlToCheck) : pb;
        const health = await testClient.health.check();
        const latencyMs = Date.now() - startTime;

        return {
            ok: health.code === 200,
            url: urlToCheck,
            isTunnel,
            latencyMs,
        };
    } catch (err) {
        return {
            ok: false,
            url: urlToCheck,
            isTunnel,
            error: (err instanceof Error ? err.message : String(err)) || "Connection refused",
        };
    }
}

/**
 * Resolves current authenticated tenant email for data isolation
 */
export function getCurrentTenantEmail(): string {
    // Single mode: every record belongs to the one account, whichever user signed in.
    if (isSingleAccountMode()) return SINGLE_ACCOUNT_EMAIL;
    ensureAuth();
    return pb.authStore.model?.email?.trim().toLowerCase() || "default";
}

/**
 * Returns a tenant-scoped browser storage key preventing cross-account contamination
 */
export function getTenantStorageKey(baseKey: string): string {
    const email = getCurrentTenantEmail();
    return `${baseKey}_${email}`;
}
