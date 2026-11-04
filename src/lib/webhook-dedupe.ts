/**
 * Razorpay webhook bookkeeping.
 *
 * The signature check was already fail-closed; what was missing is a record of
 * which events have been handled, and any check that the money Razorpay says it
 * collected matches the order it claims to pay. Both live here, with the pure
 * parts separated so they can be tested without a database.
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

const SETTINGS_KEY = 'razorpay_webhook_events';
const MAX_REMEMBERED = 200;

/**
 * Dedupe records are per tenant; a shared key would skip another store's events (SF-23).
 *
 * PAY-5: an unresolved tenant must match nothing. Returning the bare key let a
 * single row be read and overwritten across every tenant.
 */
function settingsFilter(db: typeof pb): string {
    const tenant = tenantEmail(db);
    if (!tenant) return 'id = ""';
    return `key="${SETTINGS_KEY}" && account_email="${sanitizeFilter(tenant)}"`;
}

function tenantEmail(db: typeof pb): string {
    const record = db.authStore.record as { email?: string; account_email?: string } | null;
    return String(record?.account_email || record?.email || accountScopeEmail() || '').trim().toLowerCase();
}

/** True only when PocketBase reported "no matching record", not a transport failure. */
function isNotFoundError(err: unknown): boolean {
    return (err as { status?: number } | null)?.status === 404;
}

/** A stable key for the event, using the payment or link id as the subject. */
export function webhookEventKey(event: string, entityId?: string): string | null {
    const id = (entityId || '').trim();
    if (!event || !id) return null;
    return `${event}:${id}`;
}

export function isDuplicateEvent(processed: string[], key: string | null): boolean {
    if (!key) return false;
    return processed.includes(key);
}

/** Append, drop the oldest beyond `max`, and keep order stable. */
export function rememberEvent(processed: string[], key: string | null, max = MAX_REMEMBERED): string[] {
    if (!key) return processed;
    const next = processed.filter((entry) => entry !== key);
    next.push(key);
    if (next.length <= max) return next;
    const dropped = next.slice(0, next.length - max);
    // PAY-11: eviction re-opens replay for the dropped keys, so make it visible.
    console.warn(`[webhook-dedupe] evicting ${dropped.length} old processed event key(s):`, dropped.slice(0, 5));
    return next.slice(Math.max(0, next.length - max));
}

/**
 * Compare an order total in rupees with the captured amount in paise.
 * Razorpay always reports integer paise.
 */
export function amountMatchesRupees(expectedRupees: number, amountPaise: number): boolean {
    if (!Number.isFinite(expectedRupees) || !Number.isFinite(amountPaise)) return false;
    const expectedPaise = Math.round(expectedRupees * 100);
    return expectedPaise === Math.round(amountPaise);
}

export async function loadProcessedEvents(db: typeof pb = pb): Promise<string[]> {
    const pb = db;
    // PAY-5: never read an unscoped row; an unresolved tenant has no history.
    if (!tenantEmail(pb)) {
        throw new Error('[webhook-dedupe] refusing to read processed events without a resolved tenant');
    }
    let row: { id: string; value?: unknown };
    try {
        row = await pb.collection('store_settings').getFirstListItem(settingsFilter(pb));
    } catch (err) {
        // Only "no row yet" means no history. A transport error used to read as
        // an empty list, which re-opened replay of every processed event.
        if (isNotFoundError(err)) return [];
        throw err;
    }

    try {
        const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
        return [];
    }
}

export async function saveProcessedEvents(events: string[], db: typeof pb = pb): Promise<void> {
    const pb = db;
    const tenant = tenantEmail(pb);
    // PAY-5: an empty account_email row is invisible to every scoped read, so
    // the next pass would treat the event as unprocessed and replay it.
    if (!tenant) {
        throw new Error('[webhook-dedupe] refusing to persist processed events without a resolved tenant');
    }

    // PAY-11: two settlements can interleave between the caller's load and this
    // save. Re-read the freshest list and append, instead of overwriting it with
    // a stale copy that loses the other writer's keys.
    const latest = await loadProcessedEvents(pb);
    let merged = [...latest];
    for (const key of events) merged = rememberEvent(merged, key);
    const value = JSON.stringify(merged);

    let row: { id: string } | null = null;
    try {
        row = await pb.collection('store_settings').getFirstListItem(settingsFilter(pb));
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }

    if (row) {
        await pb.collection('store_settings').update(row.id, { value });
    } else {
        await pb.collection('store_settings').create({
            account_email: tenant,
            key: SETTINGS_KEY,
            value,
            category: 'payments',
        });
    }
}
