import PocketBase from 'pocketbase';

// Determine default URL
const DEFAULT_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8091';

/**
 * Get active PocketBase base URL
 * Reads from localStorage if in client browser, else falls back to default
 */
export function getPocketBaseUrl(): string {
    if (typeof window !== "undefined") {
        const customUrl = localStorage.getItem("PB_CUSTOM_URL");
        if (customUrl && customUrl.trim()) {
            return customUrl.trim().replace(/\/+$/, "");
        }
        // Auto-detect host when accessed from Android emulator (10.0.2.2) or LAN (192.168.x.x)
        // If accessed via a Cloudflare Tunnel (trycloudflare.com), do NOT append :8090 (ports not proxied)
        const host = window.location.hostname;
        const isTunnelHost = host.includes("trycloudflare.com") || host.includes("cloudflare");
        if (host === "tauri.localhost") {
            const isAndroid = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("android");
            return isAndroid ? "http://10.0.2.2:8090" : "http://127.0.0.1:8090";
        }
        if (host && host !== "localhost" && host !== "127.0.0.1" && !isTunnelHost) {
            return `http://${host}:8090`;
        }
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
 * A fresh, authenticated client for one tenant.
 *
 * `ensureServerAuth` mutates the module-level client's base URL and auth store,
 * which is unsafe under concurrency: two requests for different tenants can
 * interleave and one can read the other's data. This helper never touches the
 * shared client, so a route that uses it is isolated by construction.
 */
export async function createTenantClient(preferredTenantEmail?: string): Promise<PocketBase> {
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

    if (runtime.adminEmail && runtime.adminPassword) {
        try {
            await client.collection("_superusers").authWithPassword(runtime.adminEmail, runtime.adminPassword);
            return client;
        } catch {
            await client.collection("users").authWithPassword(runtime.adminEmail, runtime.adminPassword).catch(() => {});
        }
    }

    return client;
}

// Disable auto-cancellation for duplicate requests
pb.autoCancellation(false);

// Multi-Account Data Isolation: Auto-inject account_email on record creation
pb.beforeSend = function (url, options) {
    if (options.method === 'POST' && pb.authStore.model?.email) {
        if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
            if (!(options.body as Record<string, unknown>).account_email) {
                (options.body as Record<string, unknown>).account_email = pb.authStore.model.email;
            }
        } else if (options.body instanceof FormData) {
            if (!options.body.has('account_email')) {
                options.body.append('account_email', pb.authStore.model.email);
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
    if (typeof window === "undefined") {
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
                        await pb.collection("_superusers").authWithPassword(tenantRec.email, tenantRec.adminPassword);
                        return true;
                    }
                }
            }
        } catch {
            // Fall through to standard environment variable superuser auth
        }
    }

    if (pb.authStore.isValid && (pb.authStore as any).isSuperuser) return true;
    const adminEmail = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL;
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
 * Resolve and wake up the dedicated PocketBase instance for an account during `/login` or session restore
 */
export async function resolveTenantPocketBase(email?: string): Promise<string> {
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
 * Auto-discover active PocketBase server on localhost if default port (8090)
 * is blocked or occupied by a foreign application, or wake up the tenant's isolated DB.
 */
export async function autoDiscoverPocketBase(): Promise<string> {
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
