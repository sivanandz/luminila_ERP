/**
 *Host-based separation between the private ERP and the public storefront.
 *
 * The deployment runs one Next server, but only the storefront hostname is
 * published through Cloudflare; the ERP is reachable exclusively over a private
 * network (Tailscale). This module is the pure policy used by `src/proxy.ts`:
 * it decides whether a (host, path) pair may be served at all.
 *
 * Behaviour:
 * - Guard disabled (no ADMIN_HOSTS/STOREFRONT_HOSTS, or HOST_GUARD=off): every
 *   request passes, which keeps the desktop build, `next dev` and CI unchanged.
 * - Guard enabled: known admin hosts may use the whole app; known storefront
 *   hosts may use only storefront paths and static assets; any unknown host is
 *   treated as storefront (public-safe default); loopback is treated as admin
 *   only when the caller explicitly opts in.
 */

import { isStorefrontPath } from "./public-surfaces";

export type HostRole = "admin" | "storefront";

export interface HostGuardConfig {
    enabled: boolean;
    adminHosts: string[];
    storefrontHosts: string[];
}

const STATIC_PREFIXES = ["/_next/", "/icons/", "/images/", "/fonts/"] as const;

const STATIC_FILES = new Set([
    "/favicon.ico",
    "/robots.txt",
    "/manifest.json",
    "/manifest.webmanifest",
    "/apple-touch-icon.png",
    "/sw.js",
]);

const STATIC_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|map|woff2?|ttf|eot|txt)$/i;

function splitHosts(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(",")
        .map((entry) => normalizeHost(entry))
        .filter((entry): entry is string => entry.length > 0);
}

/** Host header values may include a port; reduce them to a comparable hostname. */
export function normalizeHost(raw: string | null | undefined): string {
    const value = (raw || "").trim().toLowerCase();
    if (!value) return "";
    // Strip IPv6 brackets and any :port suffix (hostnames only in this app).
    const withoutBrackets = value.replace(/^\[|\]$/g, "");
    const colon = withoutBrackets.lastIndexOf(":");
    const withoutPort = colon > -1 && withoutBrackets.indexOf(":") === colon
        ? withoutBrackets.slice(0, colon)
        : withoutBrackets;
    return withoutPort.replace(/\.$/, "");
}

export function parseHostGuardConfig(
    env: Partial<Record<string, string | undefined>>
): HostGuardConfig {
    const adminHosts = splitHosts(env.ADMIN_HOSTS);
    const storefrontHosts = splitHosts(env.STOREFRONT_HOSTS);
    const disabled = (env.HOST_GUARD || "").trim().toLowerCase() === "off";
    return {
        enabled: !disabled && (adminHosts.length > 0 || storefrontHosts.length > 0),
        adminHosts,
        storefrontHosts,
    };
}

export function isLoopbackHost(hostname: string): boolean {
    const host = normalizeHost(hostname);
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "tauri.localhost";
}

export function classifyHost(
    rawHost: string | null | undefined,
    config: HostGuardConfig,
    options: { trustLoopback?: boolean } = {}
): HostRole {
    if (!config.enabled) return "admin";
    const host = normalizeHost(rawHost);
    if (!host) return "storefront";
    // Loopback is only "the operator's own machine" when nothing forwarded the
    // request. Behind a tunnel the Host header can be rewritten to
    // localhost/127.0.0.1 while the caller is a public visitor (A-15), so
    // callers must opt in explicitly (AI-12).
    const trustLoopback = options.trustLoopback === true;
    if (config.adminHosts.includes(host)) return "admin";
    if (trustLoopback && isLoopbackHost(host)) return "admin";
    if (config.storefrontHosts.includes(host)) return "storefront";
    return "storefront";
}

export interface NormalizedPath {
    /** Canonical absolute path used for policy checks. */
    path: string;
    /** True when the input contained traversal/ambiguous separators (INF-9). */
    traversal: boolean;
}

/**
 * Decode and canonicalize a request path before any policy decision.
 *
 * Prefix checks (`/checkout/...`) are only meaningful on a canonical path: a
 * raw `..`, a backslash, repeated slashes or an encoded traversal can make the
 * string look like a storefront path while the router resolves elsewhere.
 * Encoded input is decoded (bounded, to catch double encoding); anything that
 * still resolves through `..`/backslashes is reported as traversal and refused.
 */
export function normalizePathForPolicy(pathname: string): NormalizedPath {
    const raw = String(pathname || "").split(/[?#]/, 1)[0];
    if (!raw) return { path: "/", traversal: false };

    let decoded = raw;
    for (let pass = 0; pass < 3; pass++) {
        let next: string;
        try {
            next = decodeURIComponent(decoded);
        } catch {
            // Malformed percent-encoding is not a path this app serves.
            return { path: "/", traversal: true };
        }
        if (next === decoded) break;
        decoded = next;
    }

    let traversal = decoded.includes("\\");
    const unified = decoded.replace(/\\/g, "/").replace(/\/{2,}/g, "/");

    const segments: string[] = [];
    for (const segment of unified.split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") {
            traversal = true;
            segments.pop();
            continue;
        }
        segments.push(segment);
    }

    return { path: `/${segments.join("/")}`, traversal };
}

/** True when the path is a public storefront surface or an asset it needs. */
export function isStorefrontServeablePath(pathname: string): boolean {
    const { path, traversal } = normalizePathForPolicy(pathname);
    if (traversal) return false;
    if (isStorefrontPath(path)) return true;
    if (STATIC_FILES.has(path)) return true;
    if (STATIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
    // A file extension must not make an API route serveable on the storefront
    // host (`/api/export.json`, `/api/x.js`) (A-15).
    if (!path.startsWith("/api/") && STATIC_EXTENSION.test(path)) return true;
    return false;
}

export function isPathAllowed(role: HostRole, pathname: string): boolean {
    const { path, traversal } = normalizePathForPolicy(pathname);
    if (traversal) return false;
    if (role === "admin") return true;
    return isStorefrontServeablePath(path);
}
