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
 */
export async function ensureServerAuth(): Promise<boolean> {
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
 * Auto-discover active PocketBase server on localhost if default port (8090)
 * is blocked or occupied by a foreign application (e.g. Wondershare).
 */
export async function autoDiscoverPocketBase(): Promise<string> {
    const current = getPocketBaseUrl();
    try {
        const res = await pb.health.check();
        if (res.code === 200) return current;
    } catch {
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
