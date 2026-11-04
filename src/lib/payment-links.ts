import { accountScopeEmail, pb } from './pocketbase';

/**
 * Ledger a gateway payment link (payment_links collection).
 *
 * PAY-14: the module-level client is not guaranteed to carry a session (and the
 * `beforeSend` stamp is skipped for superuser/server sessions), so the tenant is
 * stamped explicitly here. An unresolved tenant is refused rather than writing
 * a row that no tenant-scoped read can see.
 */
export async function createPaymentLinkLedger(payload: Record<string, unknown>): Promise<void> {
    const accountEmail = accountScopeEmail();
    if (!accountEmail) {
        throw new Error('[payment-links] no resolved tenant; refusing to create an unscoped payment_links row');
    }
    await pb.collection('payment_links').create({ ...payload, account_email: accountEmail });
}
