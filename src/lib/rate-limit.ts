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

export class FixedWindowRateLimiter {
    private readonly max: number;
    private readonly windowMs: number;
    private readonly windows = new Map<string, WindowState>();

    constructor(options: RateLimiterOptions) {
        this.max = Math.max(1, Math.floor(options.max));
        this.windowMs = Math.max(1, Math.floor(options.windowMs));
    }

    check(key: string, now: number = Date.now()): RateLimitResult {
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

/** Client IP for limiting; trusts the first forwarded hop, like the rest of the app. */
export function clientKeyFromHeaders(headers: Headers): string {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim();
        if (first) return first;
    }
    return headers.get("x-real-ip")?.trim() || "unknown";
}
