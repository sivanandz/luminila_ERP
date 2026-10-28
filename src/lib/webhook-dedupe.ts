/**
 * Razorpay webhook bookkeeping.
 *
 * The signature check was already fail-closed; what was missing is a record of
 * which events have been handled, and any check that the money Razorpay says it
 * collected matches the order it claims to pay. Both live here, with the pure
 * parts separated so they can be tested without a database.
 */

import { pb } from './pocketbase';

const SETTINGS_KEY = 'razorpay_webhook_events';
const MAX_REMEMBERED = 200;

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
    const row = await pb
        .collection('store_settings')
        .getFirstListItem(`key="${SETTINGS_KEY}"`)
        .catch(() => null);
    if (!row) return [];

    try {
        const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
        return [];
    }
}

export async function saveProcessedEvents(events: string[], db: typeof pb = pb): Promise<void> {
    const pb = db;
    const value = JSON.stringify(events);
    const row = await pb
        .collection('store_settings')
        .getFirstListItem(`key="${SETTINGS_KEY}"`)
        .catch(() => null);

    if (row) {
        await pb.collection('store_settings').update(row.id, { value });
    } else {
        await pb.collection('store_settings').create({
            key: SETTINGS_KEY,
            value,
            category: 'payments',
        });
    }
}
