/**
 * Analytics range math — pure functions, no PB access (unit-testable).
 *
 * A range is [start, end) in ISO instants; the previous window is the equal-
 * length window immediately before it, so every metric can report
 * {current, previous, deltaPct} without the caller recomputing anything.
 */

export type RangePreset = '7d' | '30d' | '90d' | '12m' | 'custom';

export interface DateWindow {
    startISO: string;
    endISO: string;
    /** inclusive day keys (YYYY-MM-DD) covered by the window */
    days: string[];
}

export interface AnalyticsRange {
    preset: RangePreset;
    /** preset-relative anchor; custom carries explicit bounds */
    start?: string;
    end?: string;
}

export interface RangedWindows {
    current: DateWindow;
    previous: DateWindow;
    /** length of the window in days (compare windows share it) */
    lengthDays: number;
}

/** Hard cap on a window's day keys; longer spans throw instead of truncating. */
const MAX_WINDOW_DAYS = 400;

export function dayKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Convert an ISO instant bound ("2026-01-03T18:30:00.000Z") into PocketBase's
 * stored datetime format ("2026-01-03 18:30:00.000Z" — space separator).
 *
 * PB compares datetime filters as STRINGS: at index 10 a 'T' (0x54) sorts
 * after the space (0x20) stored in every row, so a T-format bound silently
 * excludes all boundary rows on the bound's UTC date (audit AN-02; the same
 * conversion exists in src/lib/utils.ts normalizeDateBounds). Every
 * analytics filter-bound interpolation MUST go through this helper.
 *
 * Idempotent: space-format bounds and date-only strings ("YYYY-MM-DD",
 * expanded to UTC midnight) pass through unchanged.
 */
export function pbBound(iso: string): string {
    if (!iso) return iso;
    if (iso.length === 10) return `${iso} 00:00:00.000Z`;
    if (iso.length > 10 && iso[10] === 'T') return `${iso.slice(0, 10)} ${iso.slice(11)}`;
    return iso;
}

function buildWindow(start: Date, endExclusive: Date): DateWindow {
    const days: string[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    // Calendar-day stepping (setDate), not fixed 86_400_000 ms: across a DST
    // change the millisecond step lands at 23:00/01:00 and duplicates or skips
    // a dayKey (AN2-6). End is EXCLUSIVE: a preset of N days yields exactly N
    // day keys (…through today), never tomorrow's. Over-cap spans throw rather
    // than silently truncating days[] while the ISO bounds stay full (AN2-16).
    while (cursor.getTime() < endExclusive.getTime()) {
        if (days.length >= MAX_WINDOW_DAYS) {
            throw new Error(
                `Analytics window exceeds ${MAX_WINDOW_DAYS} days (${dayKey(start)} → ${dayKey(endExclusive)}); narrow the range.`
            );
        }
        days.push(dayKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return { startISO: start.toISOString(), endISO: endExclusive.toISOString(), days };
}

/**
 * Resolve a custom bound. A date-only string ("2026-01-03", the picker
 * format) or a UTC-midnight timestamp is a PICKED CALENDAR DATE: it becomes
 * a local day boundary (start → local midnight, end → local midnight of the
 * NEXT day, so the whole picked day is inside). Any other instant is used
 * verbatim. This keeps window math deterministic across server timezones.
 */
function resolveBound(iso: string, isEnd: boolean): Date {
    if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.\d{3})?Z)?$/.test(iso)) {
        const y = Number(iso.slice(0, 4));
        const mo = Number(iso.slice(5, 7)) - 1;
        const d = Number(iso.slice(8, 10));
        return isEnd ? new Date(y, mo, d + 1) : new Date(y, mo, d);
    }
    return new Date(iso);
}

/** Resolve a range to current+previous windows. `now` injectable for tests. */
export function resolveRange(range: AnalyticsRange, now: Date = new Date()): RangedWindows {
    let start: Date;
    let end: Date;

    switch (range.preset) {
        case '7d':
            end = endOfToday(now);
            start = addCalendarDays(end, -7);
            break;
        case '90d':
            end = endOfToday(now);
            start = addCalendarDays(end, -90);
            break;
        case '12m':
            end = endOfToday(now);
            start = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
            break;
        case 'custom': {
            // Normalise the order on the raw strings (ISO sorts lexicographically),
            // THEN resolve to local day bounds — swapping resolved instants would
            // lose the end-date extension.
            const defaultEnd = endOfToday(now);
            let startISO = range.start || addCalendarDays(defaultEnd, -30).toISOString();
            let endISO = range.end || defaultEnd.toISOString();
            if (startISO > endISO) {
                const tmp = startISO;
                startISO = endISO;
                endISO = tmp;
            }
            start = resolveBound(startISO, false);
            end = resolveBound(endISO, true);
            break;
        }
        case '30d':
        default:
            end = endOfToday(now);
            start = addCalendarDays(end, -30);
            break;
    }

    const current = buildWindow(start, end);
    // Length comes from the day-key axis, not a millisecond division: a DST
    // week is 6.96 days of milliseconds but still 7 calendar days.
    const lengthDays = Math.max(1, current.days.length);
    const prevEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - lengthDays);

    return {
        current,
        previous: buildWindow(prevStart, prevEnd),
        lengthDays,
    };
}

/** Local-midnight date `days` calendar days from `date` (DST-safe). */
function addCalendarDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Local midnight of tomorrow — the exclusive end of a "through today" window. */
function endOfToday(now: Date): Date {
    return addCalendarDays(now, 1);
}

/** True when an ISO instant falls inside [startISO, endISO). */
export function inWindow(iso: string | undefined | null, w: DateWindow): boolean {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= new Date(w.startISO).getTime() && t < new Date(w.endISO).getTime();
}

/**
 * % change with a safe zero-previous guard.
 *
 * A zero previous has no meaningful percentage change (a 0 → ₹5,000 jump is not
 * "100%"), so it returns the `null` sentinel instead of inventing a number
 * (AN2-14). Callers must render null as "no comparison".
 */
export function deltaPct(current: number, previous: number): number | null {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (previous === 0) return current === 0 ? 0 : null;
    return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** A metric with its period-over-period comparison. */
export interface ComparedMetric {
    current: number;
    previous: number;
    /** null = not comparable (zero previous window or non-finite input) */
    deltaPct: number | null;
}

export function compare(current: number, previous: number): ComparedMetric {
    return { current, previous, deltaPct: deltaPct(current, previous) };
}

/** Human label for a preset, e.g. headers. */
export function rangeLabel(range: AnalyticsRange): string {
    switch (range.preset) {
        case '7d': return 'Last 7 days';
        case '90d': return 'Last 90 days';
        case '12m': return 'Last 12 months';
        case 'custom': return 'Custom range';
        case '30d':
        default: return 'Last 30 days';
    }
}
