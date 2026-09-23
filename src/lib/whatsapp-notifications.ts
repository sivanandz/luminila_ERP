/**
 * Automated WhatsApp Lifecycle Notifications for Luminila ERP
 * Dispatches order confirmations, invoices, courier tracking, loyalty alerts, and review requests.
 */

import { pb } from './pocketbase';
import { sendMessage, sendFile } from './whatsapp';
import { isWhatsAppOptedOut } from './whatsapp-crm';

const DEFAULT_SESSION_ID = 'luminila_phone';

/**
 * Format currency in Indian numbering system
 */
function formatINR(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(amount);
}

/**
 * Clean phone number to WhatsApp format (e.g. 919876543210)
 */
function toWhatsAppNumber(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
        return `91${digits}`;
    }
    if (digits.startsWith('91') && digits.length === 12) {
        return digits;
    }
    return digits;
}

/**
 * Send automated confirmation & digital receipt when an order is paid via Razorpay
 */
export async function sendPaidOrderInvoice(orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const order = await pb.collection('sales_orders').getOne(orderId, {
            expand: 'customer',
        });

        const phone = order.customer_phone || order.expand?.customer?.phone;
        if (!phone) {
            return { success: false, error: 'Customer phone number missing from order' };
        }

        if (await isWhatsAppOptedOut(phone)) {
            return { success: false, error: 'Customer has opted out of WhatsApp notifications' };
        }

        const customerName = order.customer_name || order.expand?.customer?.name || 'Valued Customer';
        const formattedTotal = formatINR(order.total || order.subtotal || 0);
        const orderNo = order.order_number || order.id.slice(0, 8);

        const messageText = `✨ *Payment Received & Order Confirmed!* ✨

Dear ${customerName},

Thank you for shopping with *Luminila Jewels*. We have received your payment of *${formattedTotal}* via Razorpay for Order *#${orderNo}*.

📦 *Order Status:* Confirmed & Processing
💳 *Payment:* PAID
🧾 *Invoice:* Your GST Tax Invoice has been generated.

We will notify you with the live courier tracking number as soon as your parcel is dispatched!

_For any queries or sizing assistance, simply reply directly to this chat._`;

        const waNumber = toWhatsAppNumber(phone);
        const sent = await sendMessage(DEFAULT_SESSION_ID, waNumber, messageText);

        return { success: sent };
    } catch (err: any) {
        console.error('Error sending WhatsApp invoice notification:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Send courier dispatch & live tracking update
 */
export async function sendShippingTracking(
    orderId: string,
    courierName: string,
    awbNumber: string,
    trackingUrl?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const order = await pb.collection('sales_orders').getOne(orderId, {
            expand: 'customer',
        });

        const phone = order.customer_phone || order.expand?.customer?.phone;
        if (!phone) {
            return { success: false, error: 'Customer phone missing' };
        }

        if (await isWhatsAppOptedOut(phone)) {
            return { success: false, error: 'Customer has opted out of WhatsApp notifications' };
        }

        const customerName = order.customer_name || order.expand?.customer?.name || 'Valued Customer';
        const orderNo = order.order_number || order.id.slice(0, 8);
        const trackLink = trackingUrl || `https://track.courier.in/${awbNumber}`;

        const messageText = `🚚 *Your Jewelry is on its way!* 🚚

Dear ${customerName},

Great news! Your Luminila Jewels order *#${orderNo}* has been dispatched.

📦 *Courier Partner:* ${courierName}
🔢 *AWB / Tracking No:* \`${awbNumber}\`
🔗 *Live Tracking:* ${trackLink}

Please inspect the tamper-evident security seal upon delivery.

_Thank you for trusting Luminila Jewels!_ ✨`;

        const waNumber = toWhatsAppNumber(phone);
        const sent = await sendMessage(DEFAULT_SESSION_ID, waNumber, messageText);

        return { success: sent };
    } catch (err: any) {
        console.error('Error sending shipping tracking WhatsApp notification:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Send loyalty points earned and tier status notification
 */
export async function sendLoyaltyMilestoneAlert(
    customerId: string,
    pointsEarned: number,
    totalBalance?: number,
    tierName?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const customer = await pb.collection('customers').getOne(customerId);
        if (!customer.phone) {
            return { success: false, error: 'Customer phone missing' };
        }

        if (customer.whatsapp_opt_out || await isWhatsAppOptedOut(customer.phone)) {
            return { success: false, error: 'Customer has opted out of WhatsApp notifications' };
        }

        const balance = totalBalance ?? customer.loyalty_points ?? 0;
        const tierStr = tierName ? `\n👑 *Current VIP Tier:* ${tierName}` : '';

        const messageText = `💎 *Luminila Rewards Update* 💎

Hello ${customer.name || 'Valued Member'},

You just earned *${pointsEarned} loyalty points* on your recent purchase!

✨ *Points Balance:* ${balance} Points${tierStr}
🏷️ *Value:* ${formatINR(balance)} store credit

You can redeem these points on your next purchase at our showroom or right here on WhatsApp.

_Thank you for being a loyal Luminila Jewels customer!_`;

        const waNumber = toWhatsAppNumber(customer.phone);
        const sent = await sendMessage(DEFAULT_SESSION_ID, waNumber, messageText);

        return { success: sent };
    } catch (err: any) {
        console.error('Error sending loyalty milestone alert:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Send post-delivery feedback & review request
 */
export async function sendPostDeliveryReviewRequest(
    orderId: string,
    reviewUrl: string = 'https://g.page/r/luminila-jewels/review'
): Promise<{ success: boolean; error?: string }> {
    try {
        const order = await pb.collection('sales_orders').getOne(orderId, {
            expand: 'customer',
        });

        const phone = order.customer_phone || order.expand?.customer?.phone;
        if (!phone) return { success: false, error: 'Customer phone missing' };

        if (await isWhatsAppOptedOut(phone)) {
            return { success: false, error: 'Customer has opted out of WhatsApp notifications' };
        }

        const customerName = order.customer_name || 'Valued Customer';

        const messageText = `🌟 *How is your new jewelry?* 🌟

Dear ${customerName},

We hope you are loving your pieces from *Luminila Jewels*! ✨

Your feedback means everything to our artisans. Could you take 30 seconds to share your experience with us?

⭐ *Leave a Google Review:* ${reviewUrl}

Need an exchange, adjustment, or styling advice? Simply reply to this message and our jewelry stylists will be glad to assist you.`;

        const waNumber = toWhatsAppNumber(phone);
        const sent = await sendMessage(DEFAULT_SESSION_ID, waNumber, messageText);

        return { success: sent };
    } catch (err: any) {
        console.error('Error sending review request:', err);
        return { success: false, error: err.message };
    }
}
