/**
 * Small helpers shared by the ERP tools.
 *
 * Tenant scoping is a hard rule: every filter built here starts from the
 * server-derived account email. Tool arguments may never influence it.
 */

import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';

/** Escape a value for a PocketBase filter string (same rule as lib/pocketbase). */
export function escapeFilterValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The mandatory tenant clause for every AI tool query. */
export function accountFilter(accountEmail: string): string {
    if (!accountEmail) throw new Error('AI tools require a resolved tenant account email.');
    return `account_email="${escapeFilterValue(accountEmail)}"`;
}

export function asText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
}

export function asNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function asBool(value: unknown): boolean {
    return value === true;
}

export interface DateWindow {
    fromIso: string;
    toIso: string;
    fromDate: string;
    toDate: string;
}

/**
 * Convert a rolling window of days into PocketBase-ready bounds. `fromDate` is
 * a date-only value for collections that store `YYYY-MM-DD` strings.
 */
export function rollingWindow(days: number, now: Date): DateWindow {
    const clamped = Math.min(365, Math.max(1, Math.trunc(days || 1)));
    const from = new Date(now.getTime() - clamped * 24 * 60 * 60 * 1000);
    const toIso = now.toISOString();
    return {
        fromIso: from.toISOString(),
        toIso,
        fromDate: from.toISOString().slice(0, 10),
        toDate: now.toISOString().slice(0, 10),
    };
}

export function dayKey(isoLike: string): string {
    if (!isoLike) return '';
    const date = new Date(isoLike);
    if (Number.isNaN(date.getTime())) return isoLike.slice(0, 10);
    return date.toISOString().slice(0, 10);
}

/** PocketBase record → plain object without the PB internals we don't need. */
export function toPlainRecord(record: RecordModel | Record<string, unknown>): Record<string, unknown> {
    return { ...(record as Record<string, unknown>) };
}

/** Fetch at most `perPage` records with sane defaults and no silent swallow. */
export async function listRecords(
    client: PocketBase,
    collection: string,
    options: {
        filter: string;
        sort?: string;
        perPage?: number;
        expand?: string;
        fields?: string;
    }
): Promise<RecordModel[]> {
    // `getList` (not `getFullList`) so `perPage` is a real result cap: tool
    // `limit` arguments and the aggregation caps must bound the read.
    const limit = Math.min(500, Math.max(1, options.perPage ?? 100));
    const page = await client.collection(collection).getList(1, limit, {
        filter: options.filter,
        sort: options.sort,
        ...(options.expand ? { expand: options.expand } : {}),
        ...(options.fields ? { fields: options.fields } : {}),
    });
    return page.items;
}

/** Fetch one record by id inside the tenant scope; undefined when absent. */
export async function findRecordById(
    client: PocketBase,
    collection: string,
    id: string,
    accountEmail: string,
    expand?: string
): Promise<RecordModel | undefined> {
    // Strict tenant clause in the query itself: an id from another account (or a
    // legacy row without account_email) is "not found", never returned.
    try {
        return await client
            .collection(collection)
            .getFirstListItem(`${accountFilter(accountEmail)} && id="${escapeFilterValue(id)}"`, {
                ...(expand ? { expand } : {}),
            });
    } catch {
        return undefined;
    }
}

/** First record matching an explicitly tenant-scoped filter. */
export async function findFirstRecord(
    client: PocketBase,
    collection: string,
    filter: string,
    accountEmail: string,
    options: { expand?: string } = {}
): Promise<RecordModel | undefined> {
    try {
        const record = await client
            .collection(collection)
            .getFirstListItem(`${accountFilter(accountEmail)} && (${filter})`, {
                ...(options.expand ? { expand: options.expand } : {}),
            });
        return record;
    } catch {
        return undefined;
    }
}

/** PB `~` (contains) operator applied to escaped input. */
export function containsClause(field: string, value: string): string {
    return `${field}~"${escapeFilterValue(value)}"`;
}

/** Build an `id = "..."` OR list, or an empty string when the list is empty. */
export function idOrClause(ids: string[]): string {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return '';
    return unique.map((id) => `id="${escapeFilterValue(id)}"`).join(' || ');
}
