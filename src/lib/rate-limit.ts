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
 * Client IP for limiting.
 *
 * PAY-12: `x-forwarded-for` is a comma list that each proxy appends to, so the
 * left-most entry is whatever the caller sent — trusting it let a client rotate
 * the header and dodge OTP/scrape limits. Use the last entry (the hop our own
 * proxy appended), or `TRUSTED_PROXY_HOPS` entries from the right.
 */
export function clientKeyFromHeaders(headers: Headers): string {
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
        if (hops.length > 0) {
            const index = Math.max(0, hops.length - 1 - trustedProxyHops());
            const client = hops[index];
            if (client) return client;
        }
    }
    const direct = headers.get('x-real-ip')?.trim() || headers.get('cf-connecting-ip')?.trim();
    if (direct) return direct;
    // PAY-12: no forwarding header at all — give the request its own bucket
    // instead of a shared "unknown" that one caller can exhaust for everyone.
    return `direct:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
