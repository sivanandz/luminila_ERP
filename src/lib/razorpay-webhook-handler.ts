import { pb } from '@/lib/pocketbase';
import { getRazorpayConfig, verifyWebhookSignature } from '@/lib/razorpay';
import { sendPaidOrderInvoice, sendLoyaltyMilestoneAlert } from '@/lib/whatsapp-notifications';
import { earnPoints, calculatePointsToEarn } from '@/lib/loyalty';

export interface WebhookProcessResult {
    success: boolean;
    orderId?: string;
    event?: string;
    error?: string;
}

/**
 * Process an incoming Razorpay webhook event payload
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

    if (event === 'payment_link.paid' || event === 'payment.captured') {
        const paymentLink = eventData.payload?.payment_link?.entity;
        const payment = eventData.payload?.payment?.entity;

        const orderId =
            paymentLink?.notes?.order_id ||
            paymentLink?.reference_id ||
            payment?.notes?.order_id;

        if (orderId) {
            try {
                // WPA-11 idempotency guard: Razorpay can replay webhooks. If the
                // order is already settled, skip loyalty re-award and duplicate
                // customer notifications instead of processing again.
                const existingOrder = await pb.collection('sales_orders').getOne(orderId) as unknown as {
                    payment_status?: string;
                    customer?: string;
                    order_number?: string;
                    total?: number;
                    subtotal?: number;
                };
                if (existingOrder.payment_status === 'PAID') {
                    console.log(`[webhook] Order ${orderId} already settled — skipping replayed ${event}`);
                    return { success: true, orderId, event, error: undefined };
                }

                // Update sales order in PocketBase
                const updatedOrder = await pb.collection('sales_orders').update(orderId, {
                    payment_status: 'PAID',
                    status: 'confirmed',
                });

                // Deduct inventory for confirmed paid order
                try {
                    const items = await pb.collection('sales_order_items').getFullList({ filter: `order = "${orderId}"` });
                    for (const item of items) {
                        if (item.product) {
                            await pb.collection('stock_movements').create({
                                product: item.product,
                                movement_type: 'sale',
                                quantity: -(Number(item.quantity) || 1),
                                reference_id: orderId,
                                source: 'website',
                                notes: `Online paid checkout order ${orderId}`,
                                account_email: (updatedOrder as any).account_email || 'admin@store.local',
                            }).catch(() => {});
                        }
                    }
                } catch (stockErr) {
                    console.warn(`[webhook] Stock movement recording failed for ${orderId}:`, stockErr);
                }

                // Trigger WhatsApp confirmation & invoice
                await sendPaidOrderInvoice(orderId);

                // Update customer CRM & loyalty points
                if (updatedOrder.customer) {
                    const totalAmount = updatedOrder.total || updatedOrder.subtotal || 0;
                    const points = await calculatePointsToEarn(totalAmount);

                    if (points > 0) {
                        // earnPoints(customerId, purchaseAmount, referenceType, referenceId) —
                        // pass the rupee amount, never the derived points, or they get
                        // re-computed on themselves.
                        await earnPoints(
                            updatedOrder.customer,
                            totalAmount,
                            'sales_order',
                            orderId
                        );

                        await sendLoyaltyMilestoneAlert(
                            updatedOrder.customer,
                            points
                        );
                    }
                }

                return { success: true, orderId, event };
            } catch (orderErr) {
                console.error(`Failed to process order ${orderId} in webhook:`, orderErr);
                return { success: false, orderId, event, error: (orderErr as Error).message };
            }
        }
    }

    return { success: true, event };
}
