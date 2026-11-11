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
    options: { paymentId?: string; tenantEmail?: string; client?: typeof pb } = {}
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
    options: { paymentId?: string; tenantEmail?: string; client?: typeof pb } = {}
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
    // (buyer confirm or payment.captured webhook). Completion used to live only
    // in the confirm route, so webhook-settled orders left the hold active →
    // expired → the sold unit reappeared in the drop's available count and the
    // allocation cap could be oversold (audit FD-02). Best effort: the paid
    // stock movement remains the authority.
    try {
        const orderNumber = String(existingOrder.order_number || '');
        if (orderNumber.startsWith('ORD-FD-')) {
            const reservationId = orderNumber.slice('ORD-FD-'.length);
            await pb
                .collection('flash_drop_reservations')
                .update(reservationId, { status: 'completed', order: orderId })
                .catch(() => {});
        }
    } catch {
        /* best effort */
    }

    // Raise the GST invoice before notifying the customer (CO-16).
    try {
        const invoiceResult = await generateInvoiceFromOrder(orderId, db);
        if (!invoiceResult?.success) {
            console.warn(`[settlement] Invoice generation did not succeed for ${orderId}`);
        }
    } catch (invoiceErr) {
        console.warn(`[settlement] Invoice generation failed for ${orderId}:`, invoiceErr);
    }

    // Mirror the now-paid order into `sales` for unified reporting. Online
    // intake deliberately skips this, so an abandoned checkout never creates a
    // phantom revenue row (SF-16).
    try {
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
        const existingMirror = await pb
            .collection('sales')
            .getFirstListItem(
                `channel="storefront" && channel_order_id="${sanitizeFilter(orderNumber)}"`
            )
            .catch(() => null);
        if (!existingMirror) {
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
        console.warn(`[settlement] sales mirror write failed for ${orderId}:`, mirrorErr);
    }

    // A settlement that keeps resuming (stock flagged for review) must not
    // re-message the customer on every retry, so the send is attempted once.
    try {
        const freshNotes = await pb.collection('sales_orders').getOne<{ internal_notes?: string }>(orderId, {
            fields: 'internal_notes',
        });
        if (!String(freshNotes.internal_notes || '').includes(NOTIFY_MARKER)) {
            await sendPaidOrderInvoice(orderId, db);
            await pb.collection('sales_orders').update(orderId, {
                internal_notes: [
                    freshNotes.internal_notes,
                    `[settlement ${new Date().toISOString()}] ${NOTIFY_MARKER}`,
                ]
                    .filter(Boolean)
                    .join('\n'),
            });
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
            payment?: { entity?: { id?: string; currency?: string; amount?: number; notes?: Record<string, string> } };
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
        const orderId =
            paymentLink?.notes?.order_id || paymentLink?.reference_id || payment?.notes?.order_id;
        const tenantEmail =
            paymentLink?.notes?.account_email || payment?.notes?.account_email || undefined;

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

                const expectedRupees = Number(existingOrder.total ?? existingOrder.subtotal ?? 0);
                if (!amountMatchesRupees(expectedRupees, capturedPaise)) {
                    console.error(
                        `[webhook] Amount mismatch on order ${orderId}: expected ₹${expectedRupees}, captured ₹${(capturedPaise / 100).toFixed(2)}`
                    );
                    return {
                        success: false,
                        orderId,
                        event,
                        error: 'Captured amount does not match the order total',
                    };
                }

                const settled = await settleCapturedOrder(orderId, {
                    paymentId: payment?.id,
                    tenantEmail,
                    client: db,
                });
                if (!settled.success) {
                    return { success: false, orderId, event, error: settled.error };
                }

                await saveProcessedEvents(rememberEvent(processedEvents, eventKey), db).catch((err) => {
                    console.warn('[webhook] Could not record the processed event:', err);
                });

                return { success: true, orderId, event };
            } catch (orderErr) {
                console.error(`Failed to process order ${orderId} in webhook:`, orderErr);
                return { success: false, orderId, event, error: (orderErr as Error).message };
            }
        }
    }

    return { success: true, event };
}