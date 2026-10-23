/**
 * Pure resolver for the browser's PocketBase base URL.
 *
 * Hosted deployments must not guess `http://<host>:8090` (mixed content) and
 * must not probe localhost from a customer's browser. Precedence:
 *   1. NEXT_PUBLIC_POCKETBASE_URL — the deployment's explicit value, inlined at
 *      build time. This is what a hosted ERP sets (e.g. its private Tailscale URL).
 *   2. PB_CUSTOM_URL from localStorage — the desktop/self-hosted override.
 *   3. tauri.localhost and http origins — the existing desktop/LAN behaviour.
 *   4. https without configuration — same-origin `${origin}/pb`, the documented
 *      reverse-proxy path used by the deployment profile.
 */

export interface PocketBaseUrlContext {
    envUrl?: string;
    storedUrl?: string;
    protocol?: string;
    hostname?: string;
    origin?: string;
    userAgent?: string;
}

export const LOCAL_POCKETBASE_URL = "http://127.0.0.1:8090";

function normalizeUrl(value: string | null | undefined): string {
    return (value || "").trim().replace(/\/+$/, "");
}

function isTunnelHost(hostname: string): boolean {
    return hostname.includes("trycloudflare.com") || hostname.includes("cloudflare");
}

export function resolvePocketBaseBaseUrl(context: PocketBaseUrlContext): string {
    const envUrl = normalizeUrl(context.envUrl);
    if (envUrl) return envUrl;

    const storedUrl = normalizeUrl(context.storedUrl);
    if (storedUrl) return storedUrl;

    const hostname = (context.hostname || "").toLowerCase();
    const protocol = context.protocol || "http:";
    const userAgent = (context.userAgent || "").toLowerCase();

    if (hostname === "tauri.localhost") {
        return userAgent.includes("android")
            ? "http://10.0.2.2:8090"
            : LOCAL_POCKETBASE_URL;
    }

    // A hosted HTTPS page cannot reach an http origin and cannot assume the
    // PocketBase port is public; same-origin /pb is the deployment contract.
    if (protocol === "https:") {
        const origin = normalizeUrl(context.origin);
        return origin ? `${origin}/pb` : `https://${hostname}/pb`;
    }

    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1" && !isTunnelHost(hostname)) {
        return `http://${hostname}:8090`;
    }

    return LOCAL_POCKETBASE_URL;
}
