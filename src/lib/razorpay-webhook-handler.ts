import { pb, createTenantClient } from '@/lib/pocketbase';
import { getRazorpayConfig, verifyWebhookSignature } from '@/lib/razorpay';
import { sendPaidOrderInvoice, sendLoyaltyMilestoneAlert } from '@/lib/whatsapp-notifications';
import { applyChannelStock, toStockDb } from '@/lib/channel-stock';
import { applyPurchaseAggregates, AGGREGATES_MARKER } from '@/lib/channel-orders';
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
        return { success: true, orderId };
    }

    // Item integrity gate (CO-17): a paid order with no lines cannot be
    // fulfilled, invoiced or stock-deducted. Record the payment, keep the order
    // unconfirmed and surface the failure for manual reconciliation.
    const items = await pb.collection('sales_order_items').getFullList<{
        product?: string;
        variant?: string;
        quantity?: number;
    }>({ filter: `order = "${orderId}"` });
    if (items.length === 0) {
        const note = `[settlement ${new Date().toISOString()}] Payment captured but the order has no line items; settlement paused for manual reconciliation`;
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
    try {
        const existingMovements = await pb
            .collection('stock_movements')
            .getFullList({ filter: `reference_id = "${orderId}" && movement_type = "sale"` })
            .catch(() => []);
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
        // Legacy multi-variant orders cannot be attributed to a unit; log rather
        // than fail an already-captured payment.
        console.warn(`[settlement] Stock deduction warning for ${orderId}:`, stockErr);
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

    await sendPaidOrderInvoice(orderId, db);

    // Customer CRM & loyalty: online orders bump HERE (never at intake).
    if (updatedOrder.customer) {
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

    const eventData = JSON.parse(rawBody);
    const event = eventData.event;
    console.log(`Processing Razorpay webhook event: ${event}`);

    const eventEntityId =
        eventData.payload?.payment?.entity?.id || eventData.payload?.payment_link?.entity?.id;
    const eventKey = webhookEventKey(event, eventEntityId);

    if (event === 'payment_link.paid' || event === 'payment.captured') {
        const paymentLink = eventData.payload?.payment_link?.entity;
        const payment = eventData.payload?.payment?.entity;

        const orderId =
            paymentLink?.notes?.order_id || paymentLink?.reference_id || payment?.notes?.order_id;
        const tenantEmail =
            paymentLink?.notes?.account_email || payment?.notes?.account_email || undefined;

        if (orderId) {
            try {
                // CO-08: the whole settlement runs on a per-tenant client.
                const db = await createTenantClient(tenantEmail);
                const processedEvents = await loadProcessedEvents(db).catch(() => []);
                if (isDuplicateEvent(processedEvents, eventKey)) {
                    console.log(`[webhook] Duplicate event ignored: ${eventKey}`);
                    return { success: true, event };
                }

                const existingOrder = (await db.collection('sales_orders').getOne(orderId)) as unknown as {
                    payment_status?: string;
                    total?: number;
                    subtotal?: number;
                };
                if (existingOrder.payment_status === 'PAID') {
                    console.log(`[webhook] Order ${orderId} already settled — skipping replayed ${event}`);
                    return { success: true, orderId, event };
                }

                // The captured amount must match the order. Settling a mismatch
                // would hand goods away for the wrong money.
                const capturedPaise = Number(eventData.payload?.payment?.entity?.amount);
                if (Number.isFinite(capturedPaise) && capturedPaise > 0) {
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