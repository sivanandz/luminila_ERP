/**
 * SSRF guard for operator-configured AI provider URLs.
 *
 * `/api/ai/providers/test`, `/models` and `/chat` fetch the URL server-side and
 * echo part of the response, so an unrestricted URL turns the AI settings into
 * a probe for cloud metadata and the local PocketBase/sidecar ports (AI-SYS-04).
 *
 * The literal checks here are cheap and synchronous so the Zod settings schema
 * can use them; `isBlockedAiHostByResolution` adds the DNS check that must run
 * immediately before a fetch (a public name can resolve to 169.254.169.254).
 *
 * This module only imports Node builtins, so the schema and the fetch layer can
 * share it without a cycle.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/** Hostnames that are always internal, whatever they resolve to. */
function isInternalHostname(host: string): boolean {
    return (
        host === 'localhost'
        || host.endsWith('.localhost')
        || host === 'local'
        || host.endsWith('.local')
        || host.endsWith('.internal')
        || host.endsWith('.home.arpa')
        || host.endsWith('.lan')
    );
}

/** Lowercase, unbracket and strip a trailing root dot (`localhost.` → `localhost`). */
function normalizeHostname(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

/**
 * Canonical dotted-quad for any numeric IPv4 spelling: `127.0.0.1`,
 * `127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1`.
 */
function parseNumericIpv4(host: string): number[] | null {
    if (!host) return null;
    const parts = host.split('.');
    if (parts.length > 4) return null;
    const values: number[] = [];
    for (const raw of parts) {
        if (!raw) return null;
        let value: number;
        if (/^0x[0-9a-f]+$/i.test(raw)) value = Number.parseInt(raw.slice(2), 16);
        else if (/^0[0-7]+$/.test(raw)) value = Number.parseInt(raw.slice(1), 8);
        else if (/^\d+$/.test(raw)) value = Number.parseInt(raw, 10);
        else return null;
        if (!Number.isSafeInteger(value) || value < 0) return null;
        values.push(value);
    }
    for (let index = 0; index < values.length - 1; index += 1) {
        if (values[index] > 255) return null;
    }
    const last = values[values.length - 1];
    const remainingBytes = 4 - (values.length - 1);
    if (last > 256 ** remainingBytes - 1) return null;
    const bytes = values.slice(0, -1);
    for (let shift = remainingBytes - 1; shift >= 0; shift -= 1) {
        bytes.push((last >>> (shift * 8)) & 0xff);
    }
    return bytes.length === 4 ? bytes : null;
}

/** Loopback, RFC1918, link-local, CGNAT, metadata, documentation, multicast. */
function isBlockedIpv4(bytes: number[]): boolean {
    const [a, b, c] = bytes;
    if (a === 0) return true; // 0.0.0.0/8 ("this network")
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
}

/** Expand an IPv6 spelling (including `::ffff:1.2.3.4`) to eight 16-bit groups. */
function parseIpv6(host: string): number[] | null {
    let value = host;
    const zoneIndex = value.indexOf('%');
    if (zoneIndex !== -1) value = value.slice(0, zoneIndex);
    if (!value.includes(':')) return null;

    // An embedded IPv4 tail occupies the last two groups.
    let embedded: number[] | null = null;
    const lastColon = value.lastIndexOf(':');
    const maybeV4 = value.slice(lastColon + 1);
    if (maybeV4.includes('.')) {
        embedded = parseNumericIpv4(maybeV4);
        if (!embedded) return null;
        value = `${value.slice(0, lastColon + 1)}0:0`;
    }

    const halves = value.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if (halves.length === 1) {
        if (head.length !== 8) return null;
    } else if (8 - head.length - tail.length < 1) {
        return null;
    }
    const groups = [...head, ...new Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
        .map((part) => (/^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : Number.NaN));
    if (groups.length !== 8 || groups.some((group) => !Number.isFinite(group))) return null;
    if (embedded) {
        groups[6] = (embedded[0] << 8) | embedded[1];
        groups[7] = (embedded[2] << 8) | embedded[3];
    }
    return groups;
}

function isBlockedIpv6(groups: number[]): boolean {
    if (groups.every((group) => group === 0)) return true; // ::
    if (groups.slice(0, 7).every((group) => group === 0) && groups[7] <= 1) return true; // ::1
    if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast

    const embeddedV4 = (): boolean => {
        const bytes = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
        return isBlockedIpv4(bytes);
    };
    // ::ffff:0:0/96 (IPv4-mapped) and the deprecated ::/96 (IPv4-compatible).
    if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
        return embeddedV4();
    }
    // 64:ff9b::/96 NAT64.
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
        return embeddedV4();
    }
    return false;
}

/** True for a literal loopback host, used by the http/https policy. */
export function isLoopbackAiHost(hostname: string): boolean {
    const host = normalizeHostname(hostname);
    if (host === 'localhost' || host === 'tauri.localhost') return true;
    if (isIP(host) === 6) {
        const groups = parseIpv6(host);
        return Boolean(groups && groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1);
    }
    const bytes = parseNumericIpv4(host);
    return Boolean(bytes && bytes[0] === 127);
}

export function isBlockedAiHost(hostname: string, port?: string): boolean {
    const host = normalizeHostname(hostname);
    if (!host) return true;
    if (isInternalHostname(host)) return true;

    // Internal ERP / WhatsApp sidecar ports, wherever they are bound.
    const numericPort = Number(port || '');
    if (Number.isFinite(numericPort)) {
        if (numericPort >= 8090 && numericPort <= 8199) return true;
        if (numericPort === 21465 || numericPort === 3210) return true;
    }

    // Any host containing a colon is an IPv6 literal (zone ids included), so
    // parse it even when `net.isIP` does not recognise the spelling.
    if (host.includes(':')) {
        const groups = parseIpv6(host);
        return !groups || isBlockedIpv6(groups);
    }
    if (isIP(host) === 4) {
        const bytes = parseNumericIpv4(host);
        return !bytes || isBlockedIpv4(bytes);
    }
    // Non-literal numeric IPv4 spellings that `isIP` does not recognise
    // (decimal/hex/short forms) must still be range-checked.
    const numeric = parseNumericIpv4(host);
    if (numeric) return isBlockedIpv4(numeric);

    return false;
}

/**
 * Literal checks plus DNS: every address a hostname resolves to must be public.
 * Call this immediately before each outbound fetch (and on every redirect hop):
 * a public name that resolves to loopback/link-local is the classic SSRF alias.
 *
 * Fails closed when resolution fails — the fetch could not succeed anyway.
 */
export async function isBlockedAiHostByResolution(hostname: string, port?: string): Promise<boolean> {
    if (isBlockedAiHost(hostname, port)) return true;
    const host = normalizeHostname(hostname);
    // A literal address was already range-checked above.
    if (isIP(host) || parseNumericIpv4(host)) return false;
    try {
        const addresses = await lookup(host, { all: true, verbatim: true });
        if (addresses.length === 0) return true;
        return addresses.some((entry) => isBlockedAiHost(entry.address));
    } catch {
        return true;
    }
}
