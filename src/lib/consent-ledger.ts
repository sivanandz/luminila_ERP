/**
 * Consent ledger (A30).
 *
 * A DPDP/WhatsApp consent decision is a fact with a time, a source and a
 * purpose. The customer profile only holds the latest boolean, which is enough
 * to gate a send but not enough to prove what the customer agreed to, when, or
 * through which channel. This module appends an auditable event for every
 * capture point and exposes the current state derived from the newest event.
 *
 * The collection is append-only by API rule (no update/delete), so history
 * cannot be rewritten from the app. Callers pass the per-tenant client (CO-08).
 */

import { pb } from './pocketbase';

export type ConsentChannel = 'storefront' | 'website' | 'whatsapp' | 'pos' | 'import' | 'system';
export type ConsentPurpose = 'marketing' | 'transactional' | 'whatsapp_service';

export interface ConsentEventInput {
    customerId?: string;
    phone?: string;
    channel: ConsentChannel;
    purpose: ConsentPurpose;
    granted: boolean;
    source?: string;
    orderId?: string;
    notes?: string;
    policyVersion?: string;
    occurredAt?: string;
}

export interface ConsentState {
    marketing: boolean | null;
    transactional: boolean | null;
    whatsapp_service: boolean | null;
    lastEventAt: string | null;
}

function tenantEmail(db: typeof pb): string {
    return db.authStore.record?.email?.trim().toLowerCase() || '';
}

/** Append one consent decision. Best-effort: a ledger failure must not block an order. */
export async function recordConsentEvent(db: typeof pb, input: ConsentEventInput): Promise<void> {
    if (!input.phone && !input.customerId) return;
    try {
        await db.collection('consent_events').create({
            account_email: tenantEmail(db),
            customer: input.customerId || '',
            phone: input.phone || '',
            channel: input.channel,
            purpose: input.purpose,
            granted: input.granted,
            source: input.source || '',
            policy_version: input.policyVersion || '2026-10',
            order: input.orderId || '',
            occurred_at: input.occurredAt || new Date().toISOString(),
            notes: input.notes || '',
        });
    } catch (err) {
        console.warn('[consent-ledger] Could not record consent event:', err);
    }
}

/** Append several decisions for the same order/customer. */
export async function recordConsentEvents(
    db: typeof pb,
    inputs: ConsentEventInput[]
): Promise<void> {
    for (const input of inputs) {
        await recordConsentEvent(db, input);
    }
}

/** Current state = the newest event per purpose. */
export async function getConsentState(
    db: typeof pb,
    opts: { customerId?: string; phone?: string }
): Promise<ConsentState> {
    const state: ConsentState = {
        marketing: null,
        transactional: null,
        whatsapp_service: null,
        lastEventAt: null,
    };
    const filters: string[] = [];
    if (opts.customerId) filters.push(`customer = "${opts.customerId.replace(/"/g, '')}"`);
    if (opts.phone) {
        const digits = opts.phone.replace(/\D/g, '').slice(-10);
        if (digits.length === 10) filters.push(`phone ~ "${digits}"`);
    }
    if (filters.length === 0) return state;

    try {
        const events = await db.collection('consent_events').getFullList<{
            purpose: ConsentPurpose;
            granted: boolean;
            occurred_at?: string;
        }>({
            filter: filters.join(' || '),
            sort: '-occurred_at',
            requestKey: null,
        });
        for (const event of events) {
            if (event.purpose in state && state[event.purpose] === null) {
                state[event.purpose] = Boolean(event.granted);
            }
            if (!state.lastEventAt && event.occurred_at) state.lastEventAt = event.occurred_at;
        }
    } catch (err) {
        console.warn('[consent-ledger] Could not read consent state:', err);
    }
    return state;
}

/** Keep the profile booleans in sync with the ledger (latest decision wins). */
export async function syncCustomerConsentFlags(
    db: typeof pb,
    customerId: string,
    flags: { marketing?: boolean; whatsappOptOut?: boolean }
): Promise<void> {
    const body: Record<string, unknown> = {};
    if (typeof flags.marketing === 'boolean') body.opt_in_marketing = flags.marketing;
    if (typeof flags.whatsappOptOut === 'boolean') body.whatsapp_opt_out = flags.whatsappOptOut;
    if (Object.keys(body).length === 0) return;
    try {
        await db.collection('customers').update(customerId, body);
    } catch (err) {
        console.warn('[consent-ledger] Could not sync customer consent flags:', err);
    }
}