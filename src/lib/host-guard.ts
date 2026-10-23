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
 *   because it is reachable only from the machine itself.
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

export function classifyHost(rawHost: string | null | undefined, config: HostGuardConfig): HostRole {
    if (!config.enabled) return "admin";
    const host = normalizeHost(rawHost);
    if (!host) return "storefront";
    if (config.adminHosts.includes(host) || isLoopbackHost(host)) return "admin";
    if (config.storefrontHosts.includes(host)) return "storefront";
    return "storefront";
}

/** True when the path is a public storefront surface or an asset it needs. */
export function isStorefrontServeablePath(pathname: string): boolean {
    if (isStorefrontPath(pathname)) return true;
    if (STATIC_FILES.has(pathname)) return true;
    if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
    if (STATIC_EXTENSION.test(pathname)) return true;
    return false;
}

export function isPathAllowed(role: HostRole, pathname: string): boolean {
    if (role === "admin") return true;
    return isStorefrontServeablePath(pathname);
}
