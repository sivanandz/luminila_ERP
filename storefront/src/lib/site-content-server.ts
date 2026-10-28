/**
 * Build-time storefront content.
 *
 * The static export cannot fetch the ERP from the browser during prerender, so
 * the root layout reads the CMS block here, once per build, and hands it to the
 * client provider as `initialContent`. The client keeps its post-mount refresh,
 * so a later CMS edit still appears without a rebuild (metadata and JSON-LD do
 * not — see docs/SEO_CONTRACT.md).
 *
 * URL policy: the ERP origin is operator build configuration, never request
 * input. Only http(s) is fetched; localhost, loopback, private and reserved
 * hosts are refused unless the operator explicitly sets
 * STOREFRONT_ALLOW_LOCAL_ERP=true (the isolated build sets it for its
 * 127.0.0.1 development fallback). Redirects are refused, so a public origin
 * cannot bounce the request to a private host.
 *
 * Failure policy: never throw. A missing ERP, a refused origin, a bad payload
 * or a timeout falls back to an optional local snapshot
 * (STOREFRONT_CONTENT_SNAPSHOT) and then to NITHTHIGAL_DEFAULTS, so an offline
 * build still produces a working site.
 */

import { cache } from "react";
import {
    NITHTHIGAL_DEFAULTS,
    mergeNiththigal,
    type NiththigalContent,
} from "./niththigal-content-data";

const DEFAULT_ERP_ORIGIN = "http://127.0.0.1:3000";
const FETCH_TIMEOUT_MS = 5000;

/** Conventional build-time content snapshot, read only by this literal name. */
export const CONTENT_SNAPSHOT_FILE_NAME = "content-snapshot.json";

export interface SiteContentResult {
    content: NiththigalContent;
    /** "erp" / "snapshot" when a payload was read, else "defaults". */
    source: "erp" | "snapshot" | "defaults";
}

let localErpAllowed: boolean | undefined;

function allowsLocalErp(): boolean {
    if (localErpAllowed === undefined) {
        localErpAllowed =
            (process.env.STOREFRONT_ALLOW_LOCAL_ERP || "").trim().toLowerCase() === "true";
    }
    return localErpAllowed;
}

function normalizeHost(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function ipv4Octets(host: string): number[] | null {
    const parts = host.split(".");
    if (parts.length !== 4) return null;
    const octets: number[] = [];
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const value = Number(part);
        if (value < 0 || value > 255) return null;
        octets.push(value);
    }
    return octets;
}

/** Loopback, private, link-local, CGNAT and reserved IPv4 ranges. */
function isReservedIpv4(host: string): boolean {
    const octets = ipv4Octets(host);
    if (!octets) return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
}

/** Loopback, unspecified, unique-local, link-local and IPv4-mapped IPv6. */
function isReservedIpv6(host: string): boolean {
    if (!host.includes(":")) return false;
    if (host === "::" || host === "::1") return true;
    const first = host.split(":")[0] || "";
    if (/^f[cd][0-9a-f]{0,2}$/.test(first)) return true;
    if (/^fe[89ab][0-9a-f]?$/.test(first)) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isReservedIpv4(mapped[1]);
    return false;
}

/** Hostnames that always resolve to the local machine or a metadata service. */
function isLocalHostName(host: string): boolean {
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    return [
        "metadata.google.internal",
        "instance-data",
        "host.docker.internal",
        "gateway.docker.internal",
    ].includes(host);
}

/**
 * Validate and normalise an ERP origin.
 * Returns the origin (scheme + host + port, no path) or null when refused.
 * Local/private targets require the explicit STOREFRONT_ALLOW_LOCAL_ERP opt-in.
 */
export function validateErpOrigin(raw: string): string | null {
    const value = (raw || "").trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        if (url.username || url.password) return null;
        const host = normalizeHost(url.hostname);
        if (!host) return null;
        const isLocal = isLocalHostName(host) || isReservedIpv4(host) || isReservedIpv6(host);
        if (isLocal && !allowsLocalErp()) return null;
        return url.origin;
    } catch {
        return null;
    }
}

let resolvedErpOrigin: string | null | undefined;
let erpWarningLogged = false;

/**
 * Absolute ERP origin for build-time requests.
 *
 * ERP_API_URL → NEXT_PUBLIC_ERP_API_URL → the local development fallback. The
 * fallback is usable only with STOREFRONT_ALLOW_LOCAL_ERP=true; production
 * builds must set a public http(s) origin. Returns null when refused.
 */
export function erpOrigin(): string | null {
    if (resolvedErpOrigin !== undefined) return resolvedErpOrigin;
    const configured = (process.env.ERP_API_URL || process.env.NEXT_PUBLIC_ERP_API_URL || "").trim();
    const raw = configured || DEFAULT_ERP_ORIGIN;
    const origin = validateErpOrigin(raw);
    if (!origin && !erpWarningLogged) {
        erpWarningLogged = true;
        console.warn(
            `[seo] Refusing ERP origin "${raw}": only http(s) public hosts are fetched at build time. ` +
                "Set STOREFRONT_ALLOW_LOCAL_ERP=true to allow a local ERP."
        );
    }
    resolvedErpOrigin = origin;
    return origin;
}

/** Absolute URL for a /api/storefront/* endpoint, or null with no valid origin. */
export function storefrontApiEndpoint(endpoint: string): string | null {
    const origin = erpOrigin();
    if (!origin) return null;
    const clean = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return `${origin}${clean}`;
}

/**
 * GET a JSON document with a hard timeout. Shared by the content and catalogue
 * build steps; callers decide how to degrade. Redirects are refused.
 */
export async function fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
            headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as unknown;
    } finally {
        clearTimeout(timer);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotRequested(setting: string): boolean {
    const raw = (setting || "").trim();
    if (!raw) return false;
    if (raw !== CONTENT_SNAPSHOT_FILE_NAME) {
        console.warn(
            `[seo] STOREFRONT_CONTENT_SNAPSHOT must be "${CONTENT_SNAPSHOT_FILE_NAME}" in the build directory; ignoring "${raw}".`
        );
        return false;
    }
    return true;
}

/** Accept the API envelope or a bare niththigal block. */
function readNiththigalBlock(payload: unknown): unknown {
    if (!isRecord(payload)) return undefined;
    return payload.niththigal ?? payload;
}

async function loadSnapshotContent(): Promise<SiteContentResult | null> {
    try {
        const { readFile } = await import("node:fs/promises");
        const raw = await readFile(CONTENT_SNAPSHOT_FILE_NAME, "utf8");
        const block = readNiththigalBlock(JSON.parse(raw) as unknown);
        if (!isRecord(block)) {
            console.warn(`[seo] ${CONTENT_SNAPSHOT_FILE_NAME} has no niththigal block.`);
            return null;
        }
        return {
            content: mergeNiththigal(NITHTHIGAL_DEFAULTS, block),
            source: "snapshot",
        };
    } catch (error) {
        console.warn(`[seo] Could not read ${CONTENT_SNAPSHOT_FILE_NAME}.`, error);
        return null;
    }
}

async function loadSiteContent(): Promise<SiteContentResult> {
    const url = storefrontApiEndpoint("/api/storefront/content");
    if (url) {
        try {
            const payload = await fetchJson(url);
            const block = readNiththigalBlock(payload);
            if (isRecord(block)) {
                return { content: mergeNiththigal(NITHTHIGAL_DEFAULTS, block), source: "erp" };
            }
            console.warn(`[seo] ${url} returned no niththigal block.`);
        } catch (error) {
            console.warn(`[seo] Could not load storefront content from ${url}.`, error);
        }
    }

    if (snapshotRequested(process.env.STOREFRONT_CONTENT_SNAPSHOT || "")) {
        const snapshot = await loadSnapshotContent();
        if (snapshot) return snapshot;
    }

    return { content: NITHTHIGAL_DEFAULTS, source: "defaults" };
}

/**
 * Module-level promise: React `cache()` only dedupes within one render pass,
 * and a single build worker renders many pages.
 */
let siteContentPromise: Promise<SiteContentResult> | null = null;

function loadSiteContentOnce(): Promise<SiteContentResult> {
    if (!siteContentPromise) siteContentPromise = loadSiteContent();
    return siteContentPromise;
}

/** Cached build-time site content. Never rejects. */
export const getSiteContent = cache((): Promise<SiteContentResult> => loadSiteContentOnce());
