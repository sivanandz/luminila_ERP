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
    const host = hostname.toLowerCase();
    return host === "trycloudflare.com"
        || host.endsWith(".trycloudflare.com")
        || host === "cloudflare.com"
        || host.endsWith(".cloudflare.com");
}

/** True for IPv4 addresses in the loopback/LAN/CGNAT ranges the app uses. */
function isPrivateIpv4(hostname: string): boolean {
    const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;
    const octets = match.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false;
    const [first, second] = octets;
    return first === 10
        || first === 127
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 169 && second === 254)
        || (first === 100 && second >= 64 && second <= 127); // Tailscale/CGNAT
}

/** True for the loopback/LAN/tunnel hosts an http override may target (INF-5). */
function isLocalHttpHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host) return false;
    if (host === "localhost" || host.endsWith(".localhost")) return true; // includes tauri.localhost
    if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
    if (host.endsWith(".local")) return true;
    if (isTunnelHost(host)) return true;
    if (isPrivateIpv4(host)) return true;
    // Any other IPv6 literal (public or link-local) is not an allowed http target.
    if (host.includes(":")) return false;
    // A bare hostname has no public TLD and is resolved on the local network.
    return !host.includes(".");
}

/**
 * Allowlist for a server-provided PocketBase URL (INF-5).
 *
 * `https` is accepted anywhere. `http` is accepted only for the loopback, LAN
 * and tunnel hosts this app already supports, so a compromised/misconfigured
 * tenant-db response cannot repoint the browser at an arbitrary origin.
 */
export function isAllowedPocketBaseUrl(rawUrl: string): boolean {
    const value = normalizeUrl(rawUrl);
    if (!value) return true; // clearing the override is always allowed
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    return isLocalHttpHost(parsed.hostname);
}

export function resolvePocketBaseBaseUrl(context: PocketBaseUrlContext): string {
    const envUrl = normalizeUrl(context.envUrl);
    if (envUrl) return envUrl;

    const protocol = context.protocol || "http:";
    const storedUrl = normalizeUrl(context.storedUrl);
    // INF-10: on an https page an http override cannot be used (mixed content)
    // and is likely stale state from another deployment. Ignore it instead of
    // returning it before the same-origin /pb contract below.
    if (storedUrl && (protocol !== "https:" || /^https:\/\//i.test(storedUrl))) {
        return storedUrl;
    }

    const hostname = (context.hostname || "").toLowerCase();
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
