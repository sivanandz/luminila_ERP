/**
 * Razorpay Payment Link Reconciliation (spec §7 "Automated Webhook Reconciliation")
 *
 * Luminila's frontend is a static export (no server), so Razorpay webhooks cannot
 * reach the app directly. Instead this reconciler polls every pending
 * `payment_links` record via the Razorpay Payment Link fetch API and settles:
 *
 *   paid            → mark link paid → mark linked sales order PAID/confirmed →
 *                     settle invoice & invoice_payments → loyalty points →
 *                     WhatsApp invoice notification → double-entry clearing ledger
 *   partially_paid  → left pending (logged)
 *   expired/cancelled → link marked accordingly
 *
 * Run `reconcilePendingPaymentLinks()` from any surface (the /whatsapp hub runs
 * it on an interval), or call `startPaymentReconciler()` for automatic polling.
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';
import { fetchPaymentLinkStatus, isRazorpayConfigured } from './razorpay';
import { sendPaidOrderInvoice } from './whatsapp-notifications';
import { settleCapturedOrder } from './razorpay-webhook-handler';
import { normalizeE164 } from './whatsapp-crm';

/** `&& account_email = "…"` for tenant-scoped queries (SF-09). */
function tenantClause(): string {
    const tenant = accountScopeEmail();
    return tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
}

export interface ReconciliationSummary {
    checked: number;
    settled: number;
    expired: number;
    errors: number;
    details: string[];
}

interface PaymentLinkRecord {
    id: string;
    provider: string;
    link_id: string;
    amount: number;
    currency?: string;
    customer?: string;
    order?: string;
    invoice?: string;
    status: string;
    notes?: Record<string, unknown> | null;
    expand?: {
        customer?: { id: string; name?: string; phone?: string };
    };
}

// Keyed by tenant: a single cached id leaked the first tenant's clearing account
// into every other tenant's reconciler run (SF-09).
const clearingAccountCache = new Map<string, string>();
const clearingAccountPromises = new Map<string, Promise<string>>();

/** Find (or create) the Razorpay clearing account used for settlement entries with concurrency lock. */
export async function getRazorpayClearingAccountId(): Promise<string> {
    const tenant = accountScopeEmail();
    const cached = clearingAccountCache.get(tenant);
    if (cached) return cached;
    const inflight = clearingAccountPromises.get(tenant);
    if (inflight) return inflight;

    const promise = (async () => {
        const existing = await pb.collection('bank_accounts').getFirstListItem(
            `account_name~"Razorpay"${tenantClause()}`
        ).catch(() => null);
        if (existing) {
            clearingAccountCache.set(tenant, existing.id);
            return existing.id;
        }

        const created = await pb.collection('bank_accounts').create({
            account_email: tenant,
            account_name: 'Razorpay Clearing Account',
            bank_name: 'Razorpay',
            account_number: 'RZP-SETTLEMENT',
            opening_balance: 0,
            current_balance: 0,
            is_active: true,
        });
        clearingAccountCache.set(tenant, created.id);
        return created.id;
    })();

    clearingAccountPromises.set(tenant, promise);
    try {
        return await promise;
    } finally {
        clearingAccountPromises.delete(tenant);
    }
}

/** True if a clearing deposit already exists for this payment link (crash-safe retry guard). */
async function hasClearingEntry(linkRecordId: string): Promise<boolean> {
    const existing = await pb.collection('bank_transactions').getFirstListItem(
        `related_entity_type="payment_link" && related_entity_id="${sanitizeFilter(linkRecordId)}"${tenantClause()}`
    ).catch(() => null);
    return !!existing;
}

/** True if an invoice payment with this reference was already recorded (retry guard). */
async function hasInvoicePayment(invoiceId: string, reference: string): Promise<boolean> {
    if (!reference) return false;
    const existing = await pb.collection('invoice_payments').getFirstListItem(
        `invoice="${sanitizeFilter(invoiceId)}" && reference_number="${sanitizeFilter(reference)}"${tenantClause()}`
    ).catch(() => null);
    return !!existing;
}

/** True if loyalty points were already awarded for this order (retry guard). */
async function hasLoyaltyEarnForOrder(orderId: string): Promise<boolean> {
    const existing = await pb.collection('loyalty_transactions').getFirstListItem(
        `type="earn" && reference_type="sales_order" && reference_id="${sanitizeFilter(orderId)}"${tenantClause()}`
    ).catch(() => null);
    return !!existing;
}

/** Record double-entry clearing deposit in banking ledger (spec §7). Idempotent per link. */
async function recordClearingDeposit(
    link: PaymentLinkRecord,
    paymentRef: string
): Promise<void> {
    if (await hasClearingEntry(link.id)) return; // already ledgered (crash-retry)

    const accountId = await getRazorpayClearingAccountId();
    const account = await pb.collection('bank_accounts').getOne(accountId);

    await pb.collection('bank_transactions').create({
        account_email: accountScopeEmail(),
        account: accountId,
        transaction_date: new Date().toISOString(),
        type: 'deposit',
        amount: link.amount,
        description: `Razorpay payment link settled (${link.link_id})`,
        reference_number: paymentRef || link.link_id,
        related_entity_type: 'payment_link',
        related_entity_id: link.id,
    });

    const currentBal = (account as unknown as { current_balance?: number }).current_balance || 0;
    await pb.collection('bank_accounts').update(accountId, {
        current_balance: currentBal + link.amount,
    });
}

/** Settle linked sales order, invoice, and loyalty (spec §7). Idempotent per order/link. */
async function settleLinkedOrder(
    link: PaymentLinkRecord,
    paymentRef: string
): Promise<{ orderNumber: string; pointsCredited: number }> {
    if (!link.order) return { orderNumber: '', pointsCredited: 0 };

    // Delegate to the canonical settlement path. The old code marked the order
    // PAID here without deducting stock, raising an invoice or bumping customer
    // aggregates; the next webhook then saw PAID and exited early, so those
    // steps were lost forever (SF-10).
    const settled = await settleCapturedOrder(link.order, {
        paymentId: paymentRef || link.link_id,
        tenantEmail: accountScopeEmail() || undefined,
    });
    if (!settled.success) {
        throw new Error(settled.error || 'Order settlement failed');
    }

    const order = await pb.collection('sales_orders').getOne(link.order) as unknown as {
        id: string;
        order_number?: string;
    };

    // Settle the invoice the link points at (settleCapturedOrder raises one from
    // the order but leaves it pending).
    let invoiceId = link.invoice;
    if (!invoiceId) {
        const matchingInvoice = await pb.collection('invoices').getFirstListItem(
            `order="${sanitizeFilter(order.id)}"${tenantClause()}`
        ).catch(() => null);
        if (matchingInvoice) invoiceId = matchingInvoice.id;
    }

    if (invoiceId) {
        await pb.collection('invoices').update(invoiceId, {
            status: 'paid',
            paid_amount: link.amount,
        }).catch(() => {});

        const reference = paymentRef || link.link_id;
        if (!(await hasInvoicePayment(invoiceId, reference))) {
            await pb.collection('invoice_payments').create({
                account_email: accountScopeEmail(),
                invoice: invoiceId,
                amount: link.amount,
                payment_date: new Date().toISOString(),
                payment_method: 'upi',
                reference_number: reference,
                notes: `Auto-settled via Razorpay Link ${link.link_id}`,
            }).catch(() => {});
        }
    }

    // Loyalty is awarded by settleCapturedOrder (idempotently); report the
    // balance change from the ledger rather than re-awarding here.
    const earned = await pb.collection('loyalty_transactions').getFirstListItem(
        `type="earn" && reference_type="sales_order" && reference_id="${sanitizeFilter(order.id)}"${tenantClause()}`
    ).catch(() => null);
    const pointsCredited = Number((earned as { points?: number } | null)?.points || 0);

    return { orderNumber: order.order_number || order.id, pointsCredited };
}

/**
 * Poll Razorpay for every pending payment link and reconcile settled ones.
 */
export async function reconcilePendingPaymentLinks(): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = { checked: 0, settled: 0, expired: 0, errors: 0, details: [] };

    if (!isRazorpayConfigured()) {
        summary.details.push('Razorpay is not configured — reconciliation skipped.');
        return summary;
    }

    let pending: PaymentLinkRecord[] = [];
    try {
        pending = await pb.collection('payment_links').getFullList({
            filter: `status="created"${tenantClause()}`,
            sort: '-created',
            expand: 'customer',
        }) as unknown as PaymentLinkRecord[];
    } catch (err) {
        summary.errors++;
        summary.details.push(`Failed to load pending payment links: ${(err as Error)?.message}`);
        return summary;
    }

    for (const link of pending) {
        summary.checked++;
        try {
            const result = await fetchPaymentLinkStatus(link.link_id);
            if (!result.success || !result.data) {
                summary.errors++;
                summary.details.push(`${link.link_id}: fetch failed — ${result.error}`);
                continue;
            }

            const remote = result.data;
            const paymentEntity = (remote as unknown as {
                payments?: { id: string; status: string }[];
            }).payments?.find((p) => p.status === 'captured');
            const paymentRef = paymentEntity?.id || '';

            if (remote.status === 'paid' || remote.amount_paid >= remote.amount) {
                // Crash-safe ordering: run all idempotent side effects FIRST; mark the
                // link paid LAST. If the process dies mid-settlement, the link stays
                // "created" and the next pass retries safely (dedupes prevent doubles).
                let orderNumber = '';
                let pointsCredited = 0;
                let settlementFailed = false;
                if (link.order) {
                    try {
                        ({ orderNumber, pointsCredited } = await settleLinkedOrder(link, paymentRef));
                        summary.details.push(`Order ${orderNumber} settled (pts: +${pointsCredited})`);
                    } catch (err) {
                        settlementFailed = true;
                        summary.errors++;
                        summary.details.push(`${link.link_id}: order settlement failed — ${(err as Error)?.message}`);
                    }
                }

                try {
                    await recordClearingDeposit(link, paymentRef);
                } catch (err) {
                    settlementFailed = true;
                    summary.errors++;
                    summary.details.push(`${link.link_id}: bank ledger entry failed — ${(err as Error)?.message}`);
                }

                // Only mark the link paid once BOTH settlement steps succeeded.
                // The old code marked it paid even after an error, so the next
                // pass saw "paid" and never retried the lost work (SF-11).
                if (settlementFailed) {
                    summary.details.push(`${link.link_id}: left pending so the next reconciliation pass retries`);
                    continue;
                }

                // Final state transition — only after side effects completed
                await pb.collection('payment_links').update(link.id, {
                    status: 'paid',
                    paid_at: new Date().toISOString(),
                    payment_id: paymentRef,
                });

                summary.settled++;
                summary.details.push(`✅ ${link.link_id} settled (₹${link.amount.toLocaleString('en-IN')})`);

                // Notification runs after the paid mark: a crash here can, at worst,
                // lose one reminder (never double-settle) — acceptable trade-off.
                if (link.order) {
                    await sendPaidOrderInvoice(link.order).catch((err) => {
                        console.warn(`[reconciler] WhatsApp invoice notification failed for ${link.order}:`, err?.message);
                    });
                }
            } else if (remote.status === 'expired' || remote.status === 'cancelled') {
                await pb.collection('payment_links').update(link.id, { status: remote.status });
                summary.expired++;
                summary.details.push(`${link.link_id} marked ${remote.status}`);
            } else if (remote.status === 'partially_paid') {
                summary.details.push(`${link.link_id} partially paid — awaiting full amount`);
            }
        } catch (err) {
            summary.errors++;
            summary.details.push(`${link.link_id}: ${(err as Error)?.message}`);
        }
    }

    return summary;
}

/**
 * Interval-based reconciler for long-lived surfaces (hub open).
 * Returns a stop function.
 */
export function startPaymentReconciler(intervalMs = 90_000): () => void {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await reconcilePendingPaymentLinks();
        } finally {
            running = false;
        }
    };
    const timer = setInterval(tick, intervalMs);
    // First pass shortly after mount
    const initial = setTimeout(tick, 3_000);
    return () => {
        clearInterval(timer);
        clearTimeout(initial);
    };
}

/** Guard helper shared by broadcast flows — E.164 normalizer re-export. */
export { normalizeE164 };
