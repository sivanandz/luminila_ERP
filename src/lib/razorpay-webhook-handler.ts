import crypto from 'crypto';
import { pb } from '@/lib/pocketbase';
import { getRazorpayConfig } from '@/lib/razorpay';
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

    // If webhook secret is configured, enforce HMAC SHA256 signature verification
    if (config.webhookSecret) {
        if (!signature) {
            return { success: false, error: 'Missing x-razorpay-signature header' };
        }
        const expectedSignature = crypto
            .createHmac('sha256', config.webhookSecret)
            .update(rawBody)
            .digest('hex');

        if (expectedSignature !== signature) {
            console.error('Razorpay Webhook signature verification failed');
            return { success: false, error: 'Invalid signature' };
        }
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
