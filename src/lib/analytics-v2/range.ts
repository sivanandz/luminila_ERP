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

const DAY_MS = 86_400_000;

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
    // Guard: cap day arrays at 400 entries (12m preset = 365) so a caller bug
    // can't build an unbounded array. End is EXCLUSIVE: a preset of N days
    // yields exactly N day keys (…through today), never tomorrow's.
    let guard = 0;
    while (cursor.getTime() < endExclusive.getTime() && guard < 400) {
        days.push(dayKey(cursor));
        cursor.setTime(cursor.getTime() + DAY_MS);
        guard += 1;
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
            start = new Date(end.getTime() - 7 * DAY_MS);
            break;
        case '90d':
            end = endOfToday(now);
            start = new Date(end.getTime() - 90 * DAY_MS);
            break;
        case '12m':
            end = endOfToday(now);
            start = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
            break;
        case 'custom': {
            // Normalise the order on the raw strings (ISO sorts lexicographically),
            // THEN resolve to local day bounds — swapping resolved instants would
            // lose the end-date extension.
            let startISO = range.start || new Date(endOfToday(now).getTime() - 30 * DAY_MS).toISOString();
            let endISO = range.end || endOfToday(now).toISOString();
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
            start = new Date(end.getTime() - 30 * DAY_MS);
            break;
    }

    const lengthDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
    const prevEnd = new Date(start.getTime());
    const prevStart = new Date(start.getTime() - lengthDays * DAY_MS);

    return {
        current: buildWindow(start, end),
        previous: buildWindow(prevStart, prevEnd),
        lengthDays,
    };
}

function endOfToday(now: Date): Date {
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return e;
}

/** True when an ISO instant falls inside [startISO, endISO). */
export function inWindow(iso: string | undefined | null, w: DateWindow): boolean {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= new Date(w.startISO).getTime() && t < new Date(w.endISO).getTime();
}

/** % change with a safe zero-previous guard (0 rather than Infinity). */
export function deltaPct(current: number, previous: number): number {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
    if (previous === 0) return current === 0 ? 0 : 100;
    return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** A metric with its period-over-period comparison. */
export interface ComparedMetric {
    current: number;
    previous: number;
    deltaPct: number;
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
