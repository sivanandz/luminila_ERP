/**
 * Automated VIP Order Milestones Pipeline
 * (Option B: WhatsApp Commerce 2.0)
 *
 * Dispatches rich multi-stage notifications with photos:
 *  1. Quality Checked (with HUID / Hallmark & gemstone verification)
 *  2. Packed (with real-time photo of boxed parcel before handover)
 *  3. Shipped (with courier partner name, AWB tracking number, and live tracking link)
 */

import { whatsappManager } from './whatsapp';
import { pb } from './pocketbase';

export type OrderMilestoneType =
    | 'quality_checked'
    | 'packed'
    | 'shipped'
    | 'out_for_delivery'
    | 'delivered';

export interface MilestoneDispatchPayload {
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    milestone: OrderMilestoneType;
    photoUrl?: string;
    huid?: string;
    courierName?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    notes?: string;
}

export interface MilestoneTemplate {
    title: string;
    badgeEmoji: string;
    message: string;
}

/**
 * Build rich message content for a given milestone
 */
export function formatMilestoneWhatsAppMessage(payload: MilestoneDispatchPayload): string {
    const { orderNumber, customerName, milestone, huid, courierName, trackingNumber, trackingUrl, notes } = payload;
    const nowStr = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    switch (milestone) {
        case 'quality_checked':
            return [
                '✨ *LUMINILA JEWELRY — QUALITY INSPECTION PASSED* ✨',
                '',
                `Dear ${customerName}, your handcrafted jewelry has completed master inspection! 🙏`,
                '',
                `🧾 Order: *${orderNumber}*`,
                `📅 Inspected: ${nowStr}`,
                huid ? `💎 *Hallmark / QC Tag:* \`${huid}\`` : '💎 *Quality Check:* Passed 100% Polish & Setting Audit',
                notes ? `📝 Note: _${notes}_` : '',
                '',
                '🎁 Next Step: Your piece is now moving to our luxury gift-packaging counter.',
                '',
                '_Luminila High-Finish Fashion & Imitation Jewels_',
            ].filter(Boolean).join('\n');

        case 'packed':
            return [
                '✨ *LUMINILA JEWELRY — PACKED WITH LOVE* ✨',
                '',
                `Dear ${customerName}, your order has been packed and sealed with tamper-proof security! 🎁`,
                '',
                `📦 Order: *${orderNumber}*`,
                `📅 Packed: ${nowStr}`,
                payload.photoUrl ? '📸 *Attached:* Live photo preview of your packed jewelry parcel before courier handover.' : '',
                notes ? `📝 Note: _${notes}_` : '',
                '',
                '🚚 Next Step: Handover to insured express courier.',
                '',
                '_Thank you for choosing Luminila!_',
            ].filter(Boolean).join('\n');

        case 'shipped':
            return [
                '✨ *LUMINILA JEWELRY — PARCEL DISPATCHED* ✨',
                '',
                `Dear ${customerName}, your parcel is officially on the road! 🚚💨`,
                '',
                `📦 Order: *${orderNumber}*`,
                `📅 Dispatched: ${nowStr}`,
                courierName ? `🏢 Courier Partner: *${courierName}*` : '',
                trackingNumber ? `🏷️ AWB / Tracking No: \`${trackingNumber}\`` : '',
                trackingUrl ? `🔗 *Track Live:* ${trackingUrl}` : '',
                notes ? `📝 Note: _${notes}_` : '',
                '',
                '⏱️ Expected Delivery: *2 to 4 business days*. Please keep your phone reachable for the delivery agent.',
                '',
                '_Track your order anytime via WhatsApp._ ✨',
            ].filter(Boolean).join('\n');

        case 'out_for_delivery':
            return [
                '✨ *LUMINILA JEWELRY — OUT FOR DELIVERY* ✨',
                '',
                `Dear ${customerName}, your parcel is out for delivery today! 🛵`,
                `📦 Order: *${orderNumber}*`,
                courierName ? `Courier: *${courierName}*` : '',
                'Please verify the tamper-proof security tape upon receiving.',
            ].filter(Boolean).join('\n');

        case 'delivered':
            return [
                '✨ *LUMINILA JEWELRY — DELIVERED* ✨',
                '',
                `Dear ${customerName}, your order *${orderNumber}* has been delivered! 🎉`,
                '',
                'We hope you fall in love with your new jewelry piece. ✨',
                'Tag us on Instagram @LuminilaJewels or reply to this chat with your styling photos!',
                '',
                '_Thank you for being part of the Luminila family!_',
            ].join('\n');
    }
}

/**
 * Dispatch an order milestone to customer's WhatsApp with photo attachment if available
 */
export async function dispatchOrderMilestoneWhatsApp(
    payload: MilestoneDispatchPayload
): Promise<{ success: boolean; error?: string }> {
    try {
        const phone = payload.customerPhone.trim();
        if (!phone) {
            return { success: false, error: 'Customer phone number is missing' };
        }

        const message = formatMilestoneWhatsAppMessage(payload);

        let sent = false;
        if (payload.photoUrl) {
            sent = await whatsappManager.sendFile(
                phone,
                payload.photoUrl,
                `${payload.orderNumber}_${payload.milestone}.jpg`,
                message
            );
        } else {
            sent = await whatsappManager.sendMessage(phone, message);
        }

        // Ledger milestone dispatch in PocketBase activity if orderId exists
        try {
            if (payload.orderId) {
                await pb.collection('activity_logs').create({
                    action: 'whatsapp_milestone_dispatched',
                    entity_type: 'order',
                    entity_id: payload.orderId,
                    details: {
                        milestone: payload.milestone,
                        order_number: payload.orderNumber,
                        customer_phone: phone,
                        has_photo: !!payload.photoUrl,
                        sent,
                    },
                });
            }
        } catch {
            // Activity log optional
        }

        return { success: sent, error: sent ? undefined : 'WhatsApp sidecar could not deliver message' };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
