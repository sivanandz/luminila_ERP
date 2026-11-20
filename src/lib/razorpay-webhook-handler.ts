import { pb, createTenantClient, sanitizeFilter } from '@/lib/pocketbase';
import { fetchPaymentLinkStatus, getRazorpayConfig, verifyWebhookSignature } from '@/lib/razorpay';
import { sendPaidOrderInvoice, sendLoyaltyMilestoneAlert } from '@/lib/whatsapp-notifications';
import { applyChannelStock, toStockDb } from '@/lib/channel-stock';
import { applyPurchaseAggregates, AGGREGATES_MARKER, aggregatesWereCounted } from '@/lib/channel-orders';
import { generateInvoiceFromOrder } from '@/lib/orders';
import { earnPoints, calculatePointsToEarn } from '@/lib/loyalty';
import {
    amountMatchesRupees,
    isDuplicateEvent,
    loadProcessedEvents,
    rememberEvent,
    saveProcessedEvents,
    webhookEventKey,
} from '@/lib/webhook-dedupe';

export interface WebhookProcessResult {
    success: boolean;
    orderId?: string;
    event?: string;
    error?: string;
}

export interface SettleResult {
    success: boolean;
    orderId: string;
    error?: string;
}

/**
 * Settle one captured payment against one ERP order (CO-05).
 *
 * Shared by the Razorpay webhook and the storefront confirm endpoint so a
 * payment is settled through exactly one implementation: item gate → PAID +
 * confirmed → stock (only when intake did not already deduct it) → invoice →
 * customer notification → aggregates + loyalty (each exactly once).
 *
 * Every read and write goes through a per-tenant client (CO-08): the caller may
 * pass the client it already holds, otherwise one is created from the tenant
 * email in the gateway notes. The shared module client is never mutated.
 */
export async function settleCapturedOrder(
    orderId: string,
    options: {
        paymentId?: string;
        tenantEmail?: string;
        client?: typeof pb;
        /** Actually captured rupees; falls back to the order total. */
        amountRupees?: number;
    } = {}
): Promise<SettleResult> {
    // Settlement is check-then-act (read payment_status, then write). Three
    // callers can race on one order — the client confirm, `payment.captured`
    // and `payment_link.paid` — and a double settlement fulfils twice. Serialize
    // per order id inside the process (SF-06).
    return withOrderSettlementLock(orderId, () => settleCapturedOrderInner(orderId, options));
}

const settlementLocks = new Map<string, Promise<unknown>>();

async function withOrderSettlementLock<T>(orderId: string, task: () => Promise<T>): Promise<T> {
    const previous = settlementLocks.get(orderId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    settlementLocks.set(
        orderId,
        current.finally(() => {
            if (settlementLocks.get(orderId) === current) settlementLocks.delete(orderId);
        })
    );
    return current;
}

/** True only when a PocketBase read failed because nothing matched (not a transport error). */
function isNotFoundError(err: unknown): boolean {
    return (err as { status?: number } | null)?.status === 404;
}

/** Note written when a human has to complete settlement (unrecoverable data). */
const MANUAL_REVIEW_MARKER = 'needs manual reconciliation';
/** Note written when the inventory debit could not be proven or applied (PAY-4). */
const STOCK_REVIEW_MARKER = 'stock deduction needs manual review';
/** Note recording that the paid-invoice notification was attempted once. */
const NOTIFY_MARKER = 'invoice notification sent';

/**
 * PAY-3: `payment_status = 'PAID'` is written before stock, invoice, the sales
 * mirror and loyalty, so the flag alone does not mean fulfillment finished. A
 * redelivery may only short-circuit when each later step left its marker on
 * disk; otherwise the (idempotent) steps must run again.
 *
 * Read errors propagate: an order whose fulfillment cannot be verified is not
 * treated as settled.
 */
async function fulfillmentMarkersPresent(
    db: typeof pb,
    orderId: string,
    order: { order_number?: string; customer?: string; internal_notes?: string }
): Promise<boolean> {
    if (String(order.internal_notes || '').includes(STOCK_REVIEW_MARKER)) return false;

    const invoices = await db.collection('invoices').getList(1, 1, {
        filter: `order="${sanitizeFilter(orderId)}"`,
    });
    if (invoices.totalItems === 0) return false;

    const orderNumber = String(order.order_number || orderId);
    const mirror = await db
        .collection('sales')
        .getFirstListItem(`channel="storefront" && channel_order_id="${sanitizeFilter(orderNumber)}"`)
        .catch((err) => {
            if (isNotFoundError(err)) return null;
            throw err;
        });
    if (!mirror) return false;

    if (order.customer && !aggregatesWereCounted(order.internal_notes)) return false;

    return true;
}

async function settleCapturedOrderInner(
    orderId: string,
    options: {
        paymentId?: string;
        tenantEmail?: string;
        client?: typeof pb;
        amountRupees?: number;
    } = {}
): Promise<SettleResult> {
    const db = options.client || (await createTenantClient(options.tenantEmail));
    const pb = db;

    const existingOrder = (await pb.collection('sales_orders').getOne(orderId)) as unknown as {
        payment_status?: string;
        customer?: string;
        order_number?: string;
        total?: number;
        subtotal?: number;
        account_email?: string;
        internal_notes?: string;
    };
    if (existingOrder.payment_status === 'PAID') {
        // An order paused for manual reconciliation cannot progress on a retry;
        // its note is the durable record of the problem.
        if (String(existingOrder.internal_notes || '').includes(MANUAL_REVIEW_MARKER)) {
            return { success: true, orderId };
        }
        // PAY-3: only skip when fulfillment actually completed. A crash between
        // the PAID write and stock/invoice/mirror/loyalty used to make every
        // redelivery return early, losing those steps silently.
        if (await fulfillmentMarkersPresent(pb, orderId, existingOrder)) {
            return { success: true, orderId };
        }
        console.warn(`[settlement] Order ${orderId} is PAID but fulfillment is incomplete — resuming`);
    }

    // Item integrity gate (CO-17): a paid order with no lines cannot be
    // fulfilled, invoiced or stock-deducted. Record the payment, keep the order
    // unconfirmed and surface the failure for manual reconciliation.
    const items = await pb.collection('sales_order_items').getFullList<{
        product?: string;
        variant?: string;
        quantity?: number;
    }>({ filter: `order = "${sanitizeFilter(orderId)}"` });
    if (items.length === 0) {
        const note = `[settlement ${new Date().toISOString()}] Payment captured but the order has no line items; settlement paused — ${MANUAL_REVIEW_MARKER}`;
        await pb
            .collection('sales_orders')
            .update(orderId, {
                payment_status: 'PAID',
                internal_notes: [existingOrder.internal_notes, note].filter(Boolean).join('\n'),
            })
            .catch(() => {});
        console.error(`[settlement] Refusing to confirm itemless order ${orderId}`);
        return {
            success: false,
            orderId,
            error: 'Order has no line items; captured payment needs manual reconciliation',
        };
    }

    const updatedOrder = await pb.collection('sales_orders').update(orderId, {
        payment_status: 'PAID',
        status: 'confirmed',
        ...(options.paymentId
            ? { gateway: 'razorpay', gateway_payment_id: options.paymentId }
            : {}),
    });

    // Unified channel stock. Online orders settle here, but a chat/concierge
    // order already deducted at intake: the ledger for this reference is the
    // authority on whether a deduction is still owed (A81).
    let stockFailed = false;
    try {
        // PAY-4: a failed ledger read is NOT "nothing was deducted". Swallowing
        // it here either skipped a real debit or double-deducted on the retry.
        const existingMovements = await pb
            .collection('stock_movements')
            .getFullList({ filter: `reference_id = "${sanitizeFilter(orderId)}" && movement_type = "sale"` });
        if (existingMovements.length === 0) {
            const lines = items
                .filter((item) => item.product)
                .map((item) => ({
                    productId: item.product as string,
                    variantId: item.variant || undefined,
                    quantity: Number(item.quantity) || 1,
                }));
            if (lines.length > 0) {
                const applied = await applyChannelStock(toStockDb(pb), lines, {
                    accountEmail:
                        (updatedOrder as { account_email?: string }).account_email ||
                        options.tenantEmail ||
                        '',
                    channel: 'storefront',
                    referenceId: orderId,
                    notes: `Online paid checkout order ${orderId}`,
                    oversell: 'clamp',
                });
                if (applied.shortages.length > 0) {
                    console.warn(`[settlement] Stock shortfall on ${orderId}:`, applied.shortages);
                }
            }
        }
    } catch (stockErr) {
        // PAY-4: never confirm a paid order with an unverified inventory debit.
        // Flag it on the order (so the retry resumes and a human can see it) and
        // fail the settlement instead of only warning.
        stockFailed = true;
        const message = stockErr instanceof Error ? stockErr.message : String(stockErr);
        console.error(`[settlement] Stock deduction failed for ${orderId}:`, stockErr);
        const note = `[settlement ${new Date().toISOString()}] ${STOCK_REVIEW_MARKER}: ${message}`;
        await pb
            .collection('sales_orders')
            .update(orderId, {
                internal_notes: [existingOrder.internal_notes, note].filter(Boolean).join('\n'),
            })
            .catch((noteErr) => {
                console.error(`[settlement] Could not flag the stock failure on ${orderId}:`, noteErr);
            });
    }

    // Flash-drop holds: complete the reservation for whichever caller settles
    // (buyer confirm or payment.captured webhook), but NEVER honour an expired
    // hold (H-28). Re-checking here matters because the webhook settles
    // independently of the confirm route that validated the hold at intake.
    let holdExpired = false;
    try {
        const orderNumber = String(existingOrder.order_number || '');
        if (orderNumber.startsWith('ORD-FD-')) {
            const reservationId = orderNumber.slice('ORD-FD-'.length);
            const reservation = await pb
                .collection('flash_drop_reservations')
                .getOne<{ status?: string; expires_at?: string; order?: string }>(reservationId)
                .catch(() => null);
            if (reservation) {
                const expiresAt = Date.parse(String(reservation.expires_at || '').replace(' ', 'T'));
                const expired = Number.isFinite(expiresAt) && expiresAt <= Date.now();
                const completedForThisOrder =
                    reservation.status === 'completed' && reservation.order === orderId;
                if (expired && !completedForThisOrder) {
                    holdExpired = true;
                    console.error(`[settlement] Flash-drop hold ${reservationId} expired before settlement`);
                } else if (reservation.status === 'active' || completedForThisOrder) {
                    await pb
                        .collection('flash_drop_reservations')
                        .update(reservationId, { status: 'completed', order: orderId })
                        .catch(() => {});
                }
            }
        }
    } catch {
        /* best effort */
    }

    // Raise the GST invoice before notifying the customer (CO-16), then settle
    // its receivable from the captured payment (H-11). A failure here MUST fail
    // settlement, otherwise the webhook 200s and Razorpay never redelivers (H-13).
    let invoiceFailed = false;
    try {
        const invoiceResult = await generateInvoiceFromOrder(orderId, db);
        if (!invoiceResult?.success || !invoiceResult.invoice?.id) {
            invoiceFailed = true;
            console.warn(`[settlement] Invoice generation did not succeed for ${orderId}`);
        } else {
            const invoiceId = invoiceResult.invoice.id;
            // Same reference as the payment-link reconciler so its dedupe sees
            // this row and never writes a second receipt on a resumed settle.
            const reference = options.paymentId || orderId;
            const existingPayment = await pb
                .collection('invoice_payments')
                .getFirstListItem(
                    `invoice="${sanitizeFilter(invoiceId)}" && reference_number="${sanitizeFilter(reference)}"`
                )
                .catch(() => null);
            if (!existingPayment) {
                const owner =
                    (updatedOrder as { account_email?: string }).account_email ||
                    options.tenantEmail ||
                    '';
                await pb.collection('invoice_payments').create({
                    account_email: owner,
                    invoice: invoiceId,
                    amount: Number(options.amountRupees ?? existingOrder.total ?? 0),
                    payment_date: new Date().toISOString(),
                    payment_method: 'upi',
                    reference_number: reference,
                    notes: `Settled via Razorpay payment ${reference}`,
                });
            }
            const invoice = await pb.collection('invoices').getOne<{
                grand_total?: number;
                total?: number;
            }>(invoiceId);
            const invoiceTotal = Number(invoice.grand_total ?? invoice.total ?? 0);
            const payments = await pb.collection('invoice_payments').getFullList({
                filter: `invoice="${sanitizeFilter(invoiceId)}"`,
            });
            const ledgerTotal = payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
            const paidAmount = invoiceTotal > 0 ? Math.min(invoiceTotal, ledgerTotal) : ledgerTotal;
            const isPaid = invoiceTotal > 0 && paidAmount >= invoiceTotal - 0.005;
            await pb.collection('invoices').update(invoiceId, {
                paid_amount: paidAmount,
                status: isPaid ? 'paid' : 'partially_paid',
                is_paid: isPaid,
            });
        }
    } catch (invoiceErr) {
        invoiceFailed = true;
        console.error(`[settlement] Invoice settlement failed for ${orderId}:`, invoiceErr);
    }

    // Mirror the now-paid order into `sales` for unified reporting. Online
    // intake deliberately skips this, so an abandoned checkout never creates a
    // phantom revenue row (SF-16).
    let mirrorFailed = false;
    let mirrorError = '';
    // A2/H-11 residual: while the invoice receivable is unresolved, writing the
    // mirror would complete the fulfillment-marker set and a redelivery would
    // short-circuit before the pending ₹0-paid invoice is ever repaired. Skip
    // it; the redelivery resumes settlement and writes the mirror after the
    // invoice payment row lands.
    if (invoiceFailed) {
        console.warn(`[settlement] Skipping sales mirror for ${orderId}: invoice receivable unresolved`);
    } else try {
        const placed = updatedOrder as unknown as {
            order_number?: string;
            customer?: string;
            customer_name?: string;
            customer_phone?: string;
            subtotal?: number;
            discount_total?: number;
            total?: number;
            payment_method?: string;
            account_email?: string;
        };
        const orderNumber = String(placed.order_number || orderId);
        // SW-11: only "no such row" may mean "write the mirror". A real read
        // failure used to look like no mirror and created a duplicate revenue
        // row; surface it so a retry is possible.
        const existingMirror = await pb
            .collection('sales')
            .getFirstListItem(
                `channel="storefront" && channel_order_id="${sanitizeFilter(orderNumber)}"`
            )
            .catch((err) => {
                if (isNotFoundError(err)) return null;
                throw err;
            });
        if (!existingMirror) {
            // Let a failed create fail settlement: reporting success would leave
            // the order out of `sales` permanently (no webhook-level retry).
            await pb.collection('sales').create({
                channel: 'storefront',
                channel_order_id: orderNumber,
                customer: placed.customer || undefined,
                customer_name: placed.customer_name || '',
                customer_phone: placed.customer_phone || '',
                subtotal: Number(placed.subtotal || 0),
                discount: Number(placed.discount_total || 0),
                total: Number(placed.total || 0),
                payment_method: placed.payment_method === 'cod' ? 'cash' : 'upi',
                status: 'confirmed',
                notes: `Paid storefront order ${orderNumber} (settled ${new Date().toISOString()})`,
                account_email: placed.account_email || options.tenantEmail || '',
            });
        }
    } catch (mirrorErr) {
        mirrorFailed = true;
        mirrorError = mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr);
        console.error(`[settlement] sales mirror write failed for ${orderId}:`, mirrorErr);
    }

    // A settlement that keeps resuming (stock flagged for review) must not
    // re-message the customer on every retry, so the send is attempted once.
    try {
        const freshNotes = await pb.collection('sales_orders').getOne<{ internal_notes?: string }>(orderId, {
            fields: 'internal_notes',
        });
        if (!String(freshNotes.internal_notes || '').includes(NOTIFY_MARKER)) {
            const notified = await sendPaidOrderInvoice(orderId, db);
            if (notified.success) {
                await pb.collection('sales_orders').update(orderId, {
                    internal_notes: [
                        freshNotes.internal_notes,
                        `[settlement ${new Date().toISOString()}] ${NOTIFY_MARKER}`,
                    ]
                        .filter(Boolean)
                        .join('\n'),
                });
            } else {
                // H-14: the send reports business failures (opt-out, no phone,
                // sidecar down) as {success:false} without throwing. Marking it
                // "sent" would permanently suppress retries.
                console.warn(`[settlement] Invoice notification not marked for ${orderId}: ${notified.error}`);
            }
        }
    } catch (notifyErr) {
        console.warn(`[settlement] Invoice notification failed for ${orderId}:`, notifyErr);
    }

    // Customer CRM & loyalty: online orders bump HERE (never at intake).
    // The marker makes the bump idempotent even if a previous settlement got
    // past the PAID check but failed before finishing (SF-06).
    if (updatedOrder.customer && !aggregatesWereCounted(existingOrder.internal_notes)) {
        const totalAmount = updatedOrder.total || updatedOrder.subtotal || 0;

        await applyPurchaseAggregates(pb, updatedOrder.customer, totalAmount).catch((aggErr) => {
            console.warn(`[settlement] Aggregate bump failed for ${orderId}:`, aggErr);
        });

        try {
            const fresh = (await pb.collection('sales_orders').getOne(orderId)) as {
                internal_notes?: string;
            };
            await pb.collection('sales_orders').update(orderId, {
                internal_notes: [fresh.internal_notes, AGGREGATES_MARKER].filter(Boolean).join('\n'),
            });
        } catch (markErr) {
            console.warn(`[settlement] Aggregate marker write failed for ${orderId}:`, markErr);
        }

        const points = await calculatePointsToEarn(totalAmount, undefined, db);
        if (points > 0) {
            await earnPoints(updatedOrder.customer, totalAmount, 'sales_order', orderId, db);
            await sendLoyaltyMilestoneAlert(updatedOrder.customer, points, undefined, undefined, db);
        }
    }

    if (stockFailed) {
        // The order stays PAID with a review note; the marker makes the next
        // attempt resume instead of short-circuiting (PAY-3/PAY-4).
        return {
            success: false,
            orderId,
            error: 'Stock deduction failed; settlement flagged for manual review',
        };
    }
    if (invoiceFailed) {
        return {
            success: false,
            orderId,
            error: 'Invoice generation or payment settlement failed; redelivery will retry',
        };
    }
    if (mirrorFailed) {
        // SW-11: the order is PAID and the sales-mirror check is part of
        // fulfillmentMarkersPresent, so a retry resumes and re-attempts the write.
        return {
            success: false,
            orderId,
            error: `Sales mirror write failed; redelivery will retry: ${mirrorError}`,
        };
    }
    if (holdExpired) {
        return {
            success: false,
            orderId,
            error: 'Flash-drop hold expired before settlement; captured payment needs manual refund',
        };
    }

    return { success: true, orderId };
}

/**
 * Process an incoming Razorpay webhook event payload.
 */
export async function processRazorpayWebhookEvent(
    rawBody: string,
    signature: string | null
): Promise<WebhookProcessResult> {
    const config = getRazorpayConfig();

    // Enforce HMAC SHA256 signature verification (fail closed)
    if (!config.webhookSecret) {
        console.error('Razorpay Webhook rejected: RAZORPAY_WEBHOOK_SECRET is not configured');
        return { success: false, error: 'Webhook secret is not configured' };
    }

    if (!signature) {
        return { success: false, error: 'Missing x-razorpay-signature header' };
    }
    const isValid = verifyWebhookSignature(rawBody, signature, config.webhookSecret);
    if (!isValid) {
        console.error('Razorpay Webhook signature verification failed');
        return { success: false, error: 'Invalid signature' };
    }

    let eventData: {
        event?: string;
        payload?: {
            payment?: {
                entity?: {
                    id?: string;
                    currency?: string;
                    amount?: number;
                    order_id?: string;
                    notes?: Record<string, string>;
                };
            };
            order?: { entity?: { id?: string; notes?: Record<string, string> } };
            payment_link?: {
                entity?: {
                    id?: string;
                    reference_id?: string;
                    currency?: string;
                    amount_paid?: number;
                    notes?: Record<string, string>;
                };
            };
        };
    };
    try {
        // PAY-15: a malformed-but-signed body is a bad request, not a 500.
        eventData = JSON.parse(rawBody);
    } catch (parseErr) {
        console.error('Razorpay Webhook rejected: malformed JSON body', parseErr);
        return { success: false, error: 'Malformed webhook payload' };
    }
    const event = eventData.event || '';
    console.log(`Processing Razorpay webhook event: ${event}`);

    const payment = eventData.payload?.payment?.entity;
    const paymentLink = eventData.payload?.payment_link?.entity;
    const gatewayOrder = eventData.payload?.order?.entity;

    // PAY-11: the dedupe key must name the payment that was captured. Keying
    // `payment_link.paid` on the link id made a later capture on the same link
    // look like a duplicate; when the event carries no payment entity, look the
    // captured payment up before building the key.
    let eventEntityId = payment?.id || paymentLink?.id;
    if (event === 'payment_link.paid' && !payment?.id && paymentLink?.id) {
        const fetched = await fetchPaymentLinkStatus(paymentLink.id);
        const captured = fetched.success
            ? fetched.data?.payments?.find((entry) => entry.status === 'captured')
            : undefined;
        if (captured?.id) eventEntityId = captured.id;
    }
    const eventKey = webhookEventKey(event, eventEntityId);

    if (event === 'payment_link.paid' || event === 'payment.captured') {
        const tenantEmail =
            paymentLink?.notes?.account_email ||
            payment?.notes?.account_email ||
            gatewayOrder?.notes?.account_email ||
            undefined;
        let orderId =
            paymentLink?.notes?.order_id || paymentLink?.reference_id || payment?.notes?.order_id || '';

        // H-12: gateway-checkout capture carries the ERP id on the Razorpay
        // ORDER (payment.order_id), never in payment.notes. Resolve it through
        // gateway_order_id, scoped by the tenant in the signed order notes.
        if (!orderId && (payment?.order_id || gatewayOrder?.id) && tenantEmail) {
            const gatewayOrderId = String(payment?.order_id || gatewayOrder?.id);
            const matched = await pb
                .collection('sales_orders')
                .getFirstListItem(
                    `gateway_order_id="${sanitizeFilter(gatewayOrderId)}" && account_email="${sanitizeFilter(tenantEmail)}"`
                )
                .catch(() => null);
            orderId = String((matched as { id?: string } | null)?.id || '');
        }

        // Never 200 an unmatched capture: that acknowledges the money and
        // stops Razorpay redelivering it.
        if (event === 'payment.captured' && !orderId) {
            console.error('[webhook] payment.captured did not resolve to an ERP order');
            return { success: false, event, error: 'Captured payment did not resolve to an order' };
        }

        if (orderId) {
            try {
                // CO-08: the whole settlement runs on a per-tenant client.
                const db = await createTenantClient(tenantEmail);
                // PAY-5: a failed load must not read as "nothing processed yet";
                // the outer catch reports the failure so Razorpay retries.
                const processedEvents = await loadProcessedEvents(db);
                if (isDuplicateEvent(processedEvents, eventKey)) {
                    console.log(`[webhook] Duplicate event ignored: ${eventKey}`);
                    return { success: true, event };
                }

                // M-05: the order must belong to the tenant named in the signed
                // gateway notes. `notes.order_id` is caller-settable at link
                // creation, so an unscoped load let one tenant settle another
                // tenant's order in a shared database. Load inside the tenant
                // scope and fail closed when the notes carry no tenant.
                const orderTenant = String(tenantEmail || '').trim().toLowerCase();
                const existingOrder = orderTenant
                    ? ((await db
                          .collection('sales_orders')
                          .getFirstListItem(
                              `id = "${sanitizeFilter(orderId)}" && account_email = "${sanitizeFilter(orderTenant)}"`
                          )
                          .catch(() => null)) as unknown as {
                          payment_status?: string;
                          total?: number;
                          subtotal?: number;
                      } | null)
                    : null;
                if (!existingOrder) {
                    console.error(
                        `[webhook] Order ${orderId} not found in tenant scope; refusing to settle`
                    );
                    return {
                        success: false,
                        orderId,
                        event,
                        error: 'Order not found for the tenant in the payment notes',
                    };
                }

                // The captured amount and currency must both be proven. The old
                // check skipped verification whenever the gateway omitted
                // `payment.amount`, and never looked at the currency (SF-07).
                const currency = String(
                    payment?.currency || paymentLink?.currency || ''
                ).toUpperCase();
                // PAY-7: an absent currency is not proof of INR.
                if (!currency || currency !== 'INR') {
                    console.error(`[webhook] Unsupported currency "${currency}" on order ${orderId}`);
                    return { success: false, orderId, event, error: 'Payment currency is not INR' };
                }

                const capturedPaise = Number(payment?.amount ?? paymentLink?.amount_paid);
                if (!Number.isFinite(capturedPaise) || capturedPaise <= 0) {
                    console.error(`[webhook] Missing captured amount on order ${orderId}`);
                    return {
                        success: false,
                        orderId,
                        event,
                        error: 'Webhook did not include a positive captured amount',
                    };
                }

                // P-05: a payment link collects the *gross* amount (the ERP adds
                // a 2.2% MDR markup), so the order's net total is not what the
                // customer actually pays. Verify against the amount the ERP
                // requested in its own payment_links ledger. Only a 404 means
                // "no ledger row"; a real read error fails closed so Razorpay
                // retries instead of a marked-up payment being rejected.
                let expectedRupees = Number(existingOrder.total ?? existingOrder.subtotal ?? 0);
                if (event === 'payment_link.paid' && paymentLink?.id) {
                    const linkRecord = await db
                        .collection('payment_links')
                        .getFirstListItem(`link_id="${sanitizeFilter(paymentLink.id)}"`)
                        .catch((err) => {
                            if (isNotFoundError(err)) return null;
                            throw err;
                        });
                    if (linkRecord) {
                        expectedRupees = Number((linkRecord as { amount?: number }).amount ?? expectedRupees);
                        // C-03 (webhook path): an editable advance link collects
                        // less than the order total; captured==link.amount would
                        // always pass, fully settling an order whose shortfall is
                        // never collected. The polling reconciler already refuses
                        // (payment-reconciliation.ts); this path must agree.
                        const orderTotalRupees = Number(existingOrder.total ?? existingOrder.subtotal ?? 0);
                        if (expectedRupees + 0.005 < orderTotalRupees) {
                            console.error(
                                `[webhook] Link ₹${expectedRupees} is below order total ₹${orderTotalRupees} on order ${orderId}; refusing partial settlement`
                            );
                            return {
                                success: false,
                                orderId,
                                event,
                                error: `Link ₹${expectedRupees} is below order total ₹${orderTotalRupees}; refusing partial settlement`,
                            };
                        }
                    }
                }
                if (!amountMatchesRupees(expectedRupees, capturedPaise)) {
                    console.error(
                        `[webhook] Amount mismatch on order ${orderId}: expected ₹${expectedRupees}, captured ₹${(capturedPaise / 100).toFixed(2)}`
                    );
                    return {
                        success: false,
                        orderId,
                        event,
                        error: 'Captured amount does not match the requested payment amount',
                    };
                }

                const settled = await settleCapturedOrder(orderId, {
                    paymentId: payment?.id,
                    tenantEmail,
                    client: db,
                    amountRupees: capturedPaise / 100,
                });
                if (!settled.success) {
                    return { success: false, orderId, event, error: settled.error };
                }

                // SW-19: do not swallow the dedupe write. Settlement is already
                // durable, so a failure here returns a retryable error and a
                // redelivery short-circuits on PAID/fulfillment markers rather
                // than re-running settlement with a missing processed-event key.
                await saveProcessedEvents(rememberEvent(processedEvents, eventKey), db);

                return { success: true, orderId, event };
            } catch (orderErr) {
                console.error(`Failed to process order ${orderId} in webhook:`, orderErr);
                return { success: false, orderId, event, error: (orderErr as Error).message };
            }
        }
    }

    return { success: true, event };
}