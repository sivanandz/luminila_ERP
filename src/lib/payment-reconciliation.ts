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

import { pb } from './pocketbase';
import { fetchPaymentLinkStatus, isRazorpayConfigured } from './razorpay';
import { sendPaidOrderInvoice, sendLoyaltyMilestoneAlert } from './whatsapp-notifications';
import { earnPoints, calculatePointsToEarn } from './loyalty';
import { normalizeE164 } from './whatsapp-crm';

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

let cachedClearingAccountId: string | null = null;
let clearingAccountPromise: Promise<string> | null = null;

/** Find (or create) the Razorpay clearing account used for settlement entries with concurrency lock. */
export async function getRazorpayClearingAccountId(): Promise<string> {
    if (cachedClearingAccountId) return cachedClearingAccountId;
    if (clearingAccountPromise) return clearingAccountPromise;

    clearingAccountPromise = (async () => {
        try {
            const existing = await pb.collection('bank_accounts').getFirstListItem(
                `account_name~"Razorpay"`
            ).catch(() => null);
            if (existing) {
                cachedClearingAccountId = existing.id;
                return existing.id;
            }

            const created = await pb.collection('bank_accounts').create({
                account_name: 'Razorpay Clearing Account',
                bank_name: 'Razorpay',
                account_number: 'RZP-SETTLEMENT',
                opening_balance: 0,
                current_balance: 0,
                is_active: true,
            });
            cachedClearingAccountId = created.id;
            return created.id;
        } finally {
            clearingAccountPromise = null;
        }
    })();

    return clearingAccountPromise;
}

/** Record double-entry clearing deposit in banking ledger (spec §7). */
async function recordClearingDeposit(
    link: PaymentLinkRecord,
    paymentRef: string
): Promise<void> {
    const accountId = await getRazorpayClearingAccountId();
    const account = await pb.collection('bank_accounts').getOne(accountId);

    await pb.collection('bank_transactions').create({
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

/** Settle linked sales order, credit loyalty points, and dispatch invoice (spec §7). */
async function settleLinkedOrder(
    link: PaymentLinkRecord,
    paymentRef: string
): Promise<{ orderNumber: string; pointsCredited: number }> {
    if (!link.order) return { orderNumber: '', pointsCredited: 0 };

    const order = await pb.collection('sales_orders').getOne(link.order) as unknown as {
        id: string;
        customer?: string;
        order_number?: string;
        total?: number;
        subtotal?: number;
    };

    // 1. Mark sales order PAID and confirmed
    await pb.collection('sales_orders').update(order.id, {
        payment_status: 'PAID',
        status: 'confirmed',
    });

    // 2. Settle associated invoice if exists
    let invoiceId = link.invoice;
    if (!invoiceId) {
        const matchingInvoice = await pb.collection('invoices').getFirstListItem(
            `order="${order.id}"`
        ).catch(() => null);
        if (matchingInvoice) invoiceId = matchingInvoice.id;
    }

    if (invoiceId) {
        await pb.collection('invoices').update(invoiceId, {
            status: 'paid',
            paid_amount: link.amount,
        }).catch(() => {});

        await pb.collection('invoice_payments').create({
            invoice: invoiceId,
            amount: link.amount,
            payment_date: new Date().toISOString(),
            payment_method: 'online',
            reference_number: paymentRef || link.link_id,
            notes: `Auto-settled via Razorpay Link ${link.link_id}`,
        }).catch(() => {});
    }

    // 3. Loyalty points calculation & crediting
    let pointsCredited = 0;
    if (order.customer) {
        const amount = order.total || order.subtotal || link.amount;
        const points = await calculatePointsToEarn(amount).catch(() => 0);
        if (points > 0) {
            await earnPoints(order.customer, points, order.id, order.order_number || '').catch(() => {});
            await sendLoyaltyMilestoneAlert(order.customer, points).catch(() => {});
            pointsCredited = points;
        }
    }

    // 4. WhatsApp invoice auto-dispatch
    await sendPaidOrderInvoice(order.id).catch((err) => {
        console.warn(`[reconciler] WhatsApp invoice notification failed for ${order.id}:`, err?.message);
    });

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
            filter: 'status="created"',
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
                // 1. Mark payment link settled
                await pb.collection('payment_links').update(link.id, {
                    status: 'paid',
                    paid_at: new Date().toISOString(),
                    payment_id: paymentRef,
                });

                // 2. Settle linked sales order, invoice, and loyalty
                if (link.order) {
                    try {
                        const { orderNumber, pointsCredited } = await settleLinkedOrder(link, paymentRef);
                        summary.details.push(`Order ${orderNumber} settled (pts: +${pointsCredited})`);
                    } catch (err) {
                        summary.errors++;
                        summary.details.push(`${link.link_id}: order settlement failed — ${(err as Error)?.message}`);
                    }
                }

                // 3. Double-entry bank ledger deposit
                try {
                    await recordClearingDeposit(link, paymentRef);
                } catch (err) {
                    summary.errors++;
                    summary.details.push(`${link.link_id}: bank ledger entry failed — ${(err as Error)?.message}`);
                }

                summary.settled++;
                summary.details.push(`✅ ${link.link_id} settled (₹${link.amount.toLocaleString('en-IN')})`);
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
