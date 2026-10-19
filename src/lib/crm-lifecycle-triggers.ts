/**
 * Automated Milestone & Customer Lifecycle Campaign Engine
 * Detects birthdays, wedding anniversaries, lapsed VIPs, and post-purchase followups,
 * and queues personalized messages into the staggered WhatsApp broadcast queue.
 */

import { pb, ensureAuth, getCurrentTenantEmail, getTenantStorageKey } from "./pocketbase";
import { Customer } from "./customers";
import { computeRFMAnalysis, getDaysUntilMilestone } from "./crm-rfm";
import { getHumanizedJitterDelayMs } from "./whatsapp-broadcast";
import { isWhatsAppOptedOut } from "./whatsapp-crm";

export type LifecycleFlowId =
    | "birthday_reward"
    | "anniversary_gift"
    | "lapsed_vip_winback"
    | "post_delivery_review";

export interface LifecycleFlowConfig {
    id: LifecycleFlowId;
    name: string;
    description: string;
    enabled: boolean;
    triggerDaysOffset: number; // e.g. 3 days before birthday, 5 days after delivery
    promoCode: string;
    template: string;
    lastRunAt?: string;
    totalSentCount: number;
}

const getLifecycleStorageKey = () => getTenantStorageKey("luminila_crm_lifecycle_configs_v1");

export const DEFAULT_LIFECYCLE_FLOWS: LifecycleFlowConfig[] = [
    {
        id: "birthday_reward",
        name: "Birthday Celebration Voucher",
        description: "Sent 3 days before customer's birthday with a personalized birthday discount voucher.",
        enabled: true,
        triggerDaysOffset: 3,
        promoCode: "BDAY1000",
        template:
            "Dear {{customer_name}}, ✨ Wishing you a wonderful birthday in advance! Celebrate your special day with an exclusive gift voucher (Code: BDAY1000) on your favorite jewelry pieces. Valid for 7 days at our showroom or online.",
        totalSentCount: 0,
    },
    {
        id: "anniversary_gift",
        name: "Wedding Anniversary Concierge",
        description: "Sent 3 days before anniversary with a couple's jewelry curation and discount perk.",
        enabled: true,
        triggerDaysOffset: 3,
        promoCode: "ANNIV7",
        template:
            "Dear {{customer_name}}, 💍 Happy Wedding Anniversary! May your bond shine as brilliantly as fine jewelry. Enjoy a complimentary jewelry polishing service + 7% off your anniversary gift using code ANNIV7.",
        totalSentCount: 0,
    },
    {
        id: "lapsed_vip_winback",
        name: "Lapsed VIP Concierge Win-Back",
        description: "Automatically sent when a VIP or champion has not made a purchase in 60 days.",
        enabled: true,
        triggerDaysOffset: 60,
        promoCode: "VIPRENEW",
        template:
            "Hello {{customer_name}}, we've missed your visit! As one of our cherished VIP patrons, we've reserved an exclusive 10% private voucher (Code: VIPRENEW) on our latest handcrafted necklace and ring collections.",
        totalSentCount: 0,
    },
    {
        id: "post_delivery_review",
        name: "Post-Purchase Care & Review Request",
        description: "Sent 5 days after order delivery with jewelry maintenance advice and feedback request.",
        enabled: true,
        triggerDaysOffset: 5,
        promoCode: "CARE50",
        template:
            "Hello {{customer_name}}, we hope you love your jewelry! To keep your pieces shining for decades, store them in a velvet pouch away from moisture. Reply with any styling questions, or rate your experience for 50 bonus loyalty points!",
        totalSentCount: 0,
    },
];

let cachedFlowConfigs: LifecycleFlowConfig[] = [...DEFAULT_LIFECYCLE_FLOWS];

function persistFlowConfigs(configs: LifecycleFlowConfig[]) {
    cachedFlowConfigs = [...configs];
    if (typeof window !== "undefined") {
        try {
            localStorage.setItem(getLifecycleStorageKey(), JSON.stringify(configs));
        } catch {
            // ignore
        }
    }
}

export function getLifecycleConfigs(): LifecycleFlowConfig[] {
    if (typeof window !== "undefined") {
        try {
            const stored = localStorage.getItem(getLifecycleStorageKey());
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    cachedFlowConfigs = parsed;
                    return [...cachedFlowConfigs];
                }
            }
        } catch {
            // ignore
        }
    }
    return [...DEFAULT_LIFECYCLE_FLOWS];
}

export function updateLifecycleConfig(
    flowId: LifecycleFlowId,
    patch: Partial<LifecycleFlowConfig>
): LifecycleFlowConfig[] {
    const updated = cachedFlowConfigs.map((flow) =>
        flow.id === flowId ? { ...flow, ...patch } : flow
    );
    persistFlowConfigs(updated);
    return updated;
}

export interface EligibleRecipient {
    customer: Customer;
    reason: string;
    daysDelta: number;
    phone: string;
    personalizedMessage: string;
}

/**
 * Identify all customers eligible for an automated lifecycle flow today
 */
export async function getEligibleRecipientsForFlow(
    flowId: LifecycleFlowId
): Promise<EligibleRecipient[]> {
    const flow = cachedFlowConfigs.find((f) => f.id === flowId);
    if (!flow) return [];

    const { customers } = await computeRFMAnalysis();
    const results: EligibleRecipient[] = [];

    for (const c of customers) {
        if (!c.phone || (c.opt_in_marketing === false)) continue;

        let isEligible = false;
        let reason = "";
        let daysDelta = 0;

        if (flowId === "birthday_reward") {
            const days = getDaysUntilMilestone(c.date_of_birth || (c as any).birthday_date);
            if (days >= 0 && days <= flow.triggerDaysOffset) {
                isEligible = true;
                daysDelta = days;
                reason = days === 0 ? "Birthday is TODAY!" : `Birthday in ${days} days`;
            }
        } else if (flowId === "anniversary_gift") {
            const days = getDaysUntilMilestone(c.anniversary || (c as any).anniversary_date);
            if (days >= 0 && days <= flow.triggerDaysOffset) {
                isEligible = true;
                daysDelta = days;
                reason = days === 0 ? "Anniversary is TODAY!" : `Anniversary in ${days} days`;
            }
        } else if (flowId === "lapsed_vip_winback") {
            if ((c.segment === "champions" || c.segment === "at_risk") && c.recencyDays >= flow.triggerDaysOffset) {
                isEligible = true;
                daysDelta = c.recencyDays;
                reason = `Last purchase was ${c.recencyDays} days ago`;
            }
        }

        if (isEligible) {
            const msg = flow.template
                .replace(/\{\{customer_name\}\}/gi, c.name || "Valued Customer")
                .replace(/\{\{first_name\}\}/gi, (c.name || "Customer").split(" ")[0])
                .replace(/\{\{loyalty_points\}\}/gi, String(c.loyalty_points || 0))
                .replace(/\{\{promo_code\}\}/gi, flow.promoCode);

            results.push({
                customer: c,
                reason,
                daysDelta,
                phone: c.phone,
                personalizedMessage: msg,
            });
        }
    }

    return results;
}

/**
 * Scan all enabled lifecycle flows and queue personalized messages into the staggered queue
 */
export async function scanAndDispatchLifecycleTriggers(): Promise<{
    flowsEvaluated: number;
    queuedCount: number;
    skippedCount: number;
}> {
    let queuedCount = 0;
    let skippedCount = 0;

    const enabledFlows = cachedFlowConfigs.filter((f) => f.enabled);

    for (const flow of enabledFlows) {
        const recipients = await getEligibleRecipientsForFlow(flow.id);
        let slotOffset = 0;

        for (const r of recipients) {
            // Verify opt-out
            if (await isWhatsAppOptedOut(r.phone)) {
                skippedCount++;
                continue;
            }

            // Check if already sent recently to prevent duplicate notifications
            const campaignTag = `Lifecycle: ${flow.name}`;
            try {
                const recent = await pb.collection("broadcast_messages").getFirstListItem(
                    `campaign="${campaignTag}" && recipient_phone~"${r.phone.slice(-10)}"`
                );
                if (recent) {
                    skippedCount++;
                    continue;
                }
            } catch {
                // Not sent recently
            }

            // Queue message with staggered humanized jitter
            slotOffset += getHumanizedJitterDelayMs();
            try {
                await pb.collection("broadcast_messages").create({
                    campaign: campaignTag,
                    customer: r.customer.id,
                    recipient_phone: r.phone,
                    body: r.personalizedMessage + "\n\n_Reply STOP to opt out._",
                    status: "queued",
                    scheduled_at: new Date(Date.now() + slotOffset).toISOString(),
                    created_by: "system_lifecycle_automation",
                });
                queuedCount++;
            } catch (err) {
                console.warn("[lifecycle-trigger] Failed to queue entry:", err);
            }
        }

        // Update flow stats
        flow.lastRunAt = new Date().toISOString();
        flow.totalSentCount = (flow.totalSentCount || 0) + queuedCount;
    }

    persistFlowConfigs(cachedFlowConfigs);
    return {
        flowsEvaluated: enabledFlows.length,
        queuedCount,
        skippedCount,
    };
}

/**
 * Dispatch specifically reviewed and edited recipient messages into the anti-ban queue
 */
export async function dispatchCustomRecipientsMessages(
    flowId: LifecycleFlowId,
    recipients: { customerId: string; phone: string; message: string }[]
): Promise<{ queuedCount: number; skippedCount: number }> {
    let queuedCount = 0;
    let skippedCount = 0;
    let slotOffset = 0;

    const flow = cachedFlowConfigs.find((f) => f.id === flowId);
    const campaignTag = flow ? `Lifecycle: ${flow.name}` : `Lifecycle: Custom Trigger`;

    for (const r of recipients) {
        if (!r.phone || !r.message.trim()) {
            skippedCount++;
            continue;
        }

        if (await isWhatsAppOptedOut(r.phone)) {
            skippedCount++;
            continue;
        }

        slotOffset += getHumanizedJitterDelayMs();
        try {
            await pb.collection("broadcast_messages").create({
                campaign: campaignTag,
                customer: r.customerId,
                recipient_phone: r.phone,
                body: r.message.trim() + "\n\n_Reply STOP to opt out._",
                status: "queued",
                scheduled_at: new Date(Date.now() + slotOffset).toISOString(),
                created_by: "reviewed_lifecycle_dispatch",
            });
            queuedCount++;
        } catch (err) {
            console.warn("[lifecycle-trigger] Failed to queue entry:", err);
            skippedCount++;
        }
    }

    if (flow && queuedCount > 0) {
        flow.lastRunAt = new Date().toISOString();
        flow.totalSentCount = (flow.totalSentCount || 0) + queuedCount;
        persistFlowConfigs(cachedFlowConfigs);
    }

    return { queuedCount, skippedCount };
}
