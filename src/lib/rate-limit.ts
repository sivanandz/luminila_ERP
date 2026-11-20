/**
 * Fixed-window rate limiting for public routes.
 *
 * In-memory on purpose: the product runs one PocketBase and one Next process per
 * tenant on a showroom machine, so a distributed limiter would be apparatus
 * without a purpose. The window resets on process restart, which is acceptable
 * for the abuse cases it exists to stop (scraping, OTP floods).
 */

export interface RateLimiterOptions {
    max: number;
    windowMs: number;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    /** Epoch milliseconds when the current window ends. */
    resetAt: number;
    retryAfterMs: number;
}

interface WindowState {
    count: number;
    resetAt: number;
}

/** Hard ceiling on tracked windows; XFF rotation must not grow the map forever. */
const MAX_WINDOWS = 10_000;

export class FixedWindowRateLimiter {
    private readonly max: number;
    private readonly windowMs: number;
    private readonly windows = new Map<string, WindowState>();
    private checks = 0;

    constructor(options: RateLimiterOptions) {
        this.max = Math.max(1, Math.floor(options.max));
        this.windowMs = Math.max(1, Math.floor(options.windowMs));
    }

    check(key: string, now: number = Date.now()): RateLimitResult {
        // AI-10: the map used to grow without bound. Prune expired windows on a
        // cheap sample (every 256 checks) and hard-cap the key count, evicting
        // the oldest tracked keys first when the cap is reached.
        this.checks += 1;
        if ((this.checks & 0xff) === 0) this.prune(now);
        if (this.windows.size >= MAX_WINDOWS) this.enforceSizeLimit(now);

        const existing = this.windows.get(key);

        if (!existing || now >= existing.resetAt) {
            const resetAt = now + this.windowMs;
            this.windows.set(key, { count: 1, resetAt });
            return { allowed: true, remaining: this.max - 1, resetAt, retryAfterMs: 0 };
        }

        if (existing.count >= this.max) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: existing.resetAt,
                retryAfterMs: Math.max(0, existing.resetAt - now),
            };
        }

        existing.count += 1;
        return {
            allowed: true,
            remaining: this.max - existing.count,
            resetAt: existing.resetAt,
            retryAfterMs: 0,
        };
    }

    /** Prune expired windows, then evict the oldest keys until there is room. */
    private enforceSizeLimit(now: number): void {
        this.prune(now);
        if (this.windows.size < MAX_WINDOWS) return;
        const excess = this.windows.size - MAX_WINDOWS + 1;
        let removed = 0;
        for (const tracked of this.windows.keys()) {
            if (removed >= excess) break;
            this.windows.delete(tracked);
            removed += 1;
        }
        console.warn(`[rate-limit] window cap reached; evicted ${removed} oldest key(s)`);
    }

    /** Drop expired windows; call opportunistically to bound memory. */
    prune(now: number = Date.now()): number {
        let removed = 0;
        for (const [key, state] of this.windows) {
            if (now >= state.resetAt) {
                this.windows.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    size(): number {
        return this.windows.size;
    }
}

/**
 * Number of proxies in front of the app that append to `x-forwarded-for`.
 * Default 0: the deployment terminates TLS at the app/proxy that appends the
 * last hop, so the right-most entry is the client.
 */
function trustedProxyHops(): number {
    const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? '');
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

/**
 * T-06: `cf-connecting-ip`, `x-forwarded-for` and `x-real-ip` are only
 * meaningful when a trusted proxy actually sits in front of the app and sets
 * them. On a directly-reachable surface (LAN/Tailscale, `next dev`, the Tauri
 * local server) every one of them is caller-controlled: a client can rotate
 * `cf-connecting-ip` for a fresh bucket or set a victim's address to exhaust
 * theirs. Only consult those headers when proxy trust is explicitly enabled.
 */
function trustProxyHeaders(): boolean {
    if ((process.env.TRUST_PROXY_HEADERS || '').trim() === '1') return true;
    const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? '');
    return Number.isFinite(hops) && hops > 0;
}

/**
 * Client IP for limiting.
 *
 * PAY-12 (retained): when proxy trust is on, `x-forwarded-for` is a comma list
 * that each proxy appends to, so the left-most entry is caller-controlled —
 * use the right-most hop (or `TRUSTED_PROXY_HOPS` entries from the right).
 * Otherwise give the request its own bucket rather than trusting a header any
 * caller can forge.
 */
export function clientKeyFromHeaders(headers: Headers): string {
    if (trustProxyHeaders()) {
        const cfConnectingIp = headers.get('cf-connecting-ip')?.trim();
        if (cfConnectingIp) return cfConnectingIp;

        const forwarded = headers.get('x-forwarded-for');
        if (forwarded) {
            const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
            if (hops.length > 0) {
                const index = Math.max(0, hops.length - 1 - trustedProxyHops());
                const client = hops[index];
                if (client) return client;
            }
        }
        const direct = headers.get('x-real-ip')?.trim();
        if (direct) return direct;
    }
    // No trusted proxy (or no usable header): a separate bucket per request,
    // never a caller-supplied key and never a shared "unknown" bucket.
    return `direct:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export function checkPublicRateLimit(
    req: Request,
    limiter: FixedWindowRateLimiter,
    customKey?: string
): RateLimitResult {
    const key = customKey ?? clientKeyFromHeaders(req.headers);
    return limiter.check(key);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
    const headers: Record<string, string> = {
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    };
    if (!result.allowed) {
        headers['Retry-After'] = String(Math.ceil(result.retryAfterMs / 1000));
    }
    return headers;
}
