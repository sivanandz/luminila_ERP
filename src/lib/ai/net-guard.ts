/**
 * SSRF guard for operator-configured AI provider URLs.
 *
 * `/api/ai/providers/test`, `/models` and `/chat` fetch the URL server-side and
 * echo part of the response, so an unrestricted URL turns the AI settings into
 * a probe for cloud metadata and the local PocketBase/sidecar ports (AI-SYS-04).
 *
 * This module has no imports so both the Zod schema and the fetch layer can
 * share it without a cycle.
 */
export function isBlockedAiHost(hostname: string, port?: string): boolean {
    const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (host === '::1' || host === '0.0.0.0' || host === '::') return true;

    // IPv4 loopback, RFC1918, link-local and cloud metadata.
    if (/^127\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^169\.254\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    // IPv6 unique-local / link-local.
    if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(host) && host.includes(':')) return true;

    // Internal ERP / WhatsApp sidecar ports, wherever they are bound.
    const numericPort = Number(port || '');
    if (Number.isFinite(numericPort)) {
        if (numericPort >= 8090 && numericPort <= 8199) return true;
        if (numericPort === 21465 || numericPort === 3210) return true;
    }
    return false;
}
