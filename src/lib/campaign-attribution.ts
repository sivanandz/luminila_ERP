/**
 * Campaign Conversion & Revenue Attribution Engine
 * Tracks WhatsApp marketing campaigns, 7-day multi-touch order attribution, funnel analytics, and ROI.
 */

import { pb, ensureAuth, getCurrentTenantEmail, getTenantStorageKey } from "./pocketbase";
import { normalizeE164 } from "./whatsapp-crm";

export const ATTRIBUTION_WINDOW_DAYS = 7;
const CAMPAIGNS_COLLECTION = "whatsapp_campaigns";
const getStorageKey = () => getTenantStorageKey("luminila_marketing_campaigns_v1");

export type CampaignCategory =
    | "promotional"
    | "flash_drop"
    | "lifecycle"
    | "vip_concierge"
    | "clearance";

export interface MarketingCampaign {
    id: string;
    title: string;
    category: CampaignCategory;
    promo_code?: string;
    discount_percent?: number;
    target_segment: string;
    status: "draft" | "active" | "completed" | "paused";
    created_at: string;
    scheduled_at?: string;
    completed_at?: string;
    // Funnel Performance Metrics
    total_recipients: number;
    sent_count: number;
    delivered_count: number;
    read_count: number;
    replied_count: number;
    orders_converted: number;
    attributed_revenue: number;
    account_email?: string;
    notes?: string;
}

export interface FunnelStage {
    label: string;
    count: number;
    percentage: number;
    color: string;
}

export interface CampaignAnalyticsOverview {
    totalCampaigns: number;
    activeCampaigns: number;
    totalSent: number;
    totalDelivered: number;
    totalRead: number;
    totalOrders: number;
    totalRevenue: number;
    overallDeliveryRate: number;
    overallReadRate: number;
    overallConversionRate: number;
    funnel: FunnelStage[];
    campaigns: MarketingCampaign[];
}

// In-memory / LocalStorage cache fallback
let memoryCampaigns: MarketingCampaign[] = [];

function persistLocalCampaigns(campaigns: MarketingCampaign[]) {
    memoryCampaigns = [...campaigns];
    if (typeof window !== "undefined") {
        try {
            localStorage.setItem(getStorageKey(), JSON.stringify(campaigns));
        } catch {
            // ignore
        }
    }
}

/**
 * Fetch all marketing campaigns with live metrics
 */
export async function getMarketingCampaigns(): Promise<MarketingCampaign[]> {
    ensureAuth();
    const userEmail = getCurrentTenantEmail();
    const storageKey = getStorageKey();

    try {
        // Attempt to fetch from PocketBase collection
        const records = await pb.collection(CAMPAIGNS_COLLECTION).getFullList<MarketingCampaign>({
            filter: `account_email = "${userEmail}"`,
            sort: "-created",
        });
        if (records.length > 0) {
            persistLocalCampaigns(records);
            return records;
        }
    } catch {
        // Collection may not exist yet in PocketBase, use local store fallback
    }

    if (typeof window !== "undefined") {
        try {
            const cached = localStorage.getItem(storageKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) {
                    memoryCampaigns = parsed;
                    return parsed;
                }
            }
        } catch {
            // ignore
        }
    }

    return memoryCampaigns;
}

/**
 * Create a new campaign entry
 */
export async function createMarketingCampaign(
    campaign: Omit<MarketingCampaign, "id" | "created_at" | "sent_count" | "delivered_count" | "read_count" | "replied_count" | "orders_converted" | "attributed_revenue">
): Promise<MarketingCampaign> {
    ensureAuth();
    const userEmail = getCurrentTenantEmail();
    const newRecord: MarketingCampaign = {
        ...campaign,
        id: `cmp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        created_at: new Date().toISOString(),
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        orders_converted: 0,
        attributed_revenue: 0,
        account_email: userEmail,
    };

    try {
        const pbRecord = await pb.collection(CAMPAIGNS_COLLECTION).create(newRecord);
        newRecord.id = pbRecord.id;
    } catch {
        // Save to local cache
    }

    const updated = [newRecord, ...memoryCampaigns];
    persistLocalCampaigns(updated);
    return newRecord;
}

/**
 * Attribute an order to campaigns using Hybrid Attribution
 * 1. Checks campaign promo code match
 * 2. Checks recipient phone dispatch within 7-day rolling window
 */
export async function attributeOrderToCampaign(order: {
    id: string;
    customerPhone?: string;
    total: number;
    promoCode?: string;
    created?: string;
}): Promise<{ attributed: boolean; campaignId?: string; campaignTitle?: string }> {
    if (!order.total || order.total <= 0) return { attributed: false };

    const campaigns = await getMarketingCampaigns();
    const orderPhone = order.customerPhone ? normalizeE164(order.customerPhone) : "";
    const orderDate = order.created ? new Date(order.created) : new Date();

    // 1. Direct Promo Code Match
    if (order.promoCode) {
        const matched = campaigns.find(
            (c) => c.promo_code && c.promo_code.trim().toUpperCase() === order.promoCode?.trim().toUpperCase()
        );
        if (matched) {
            await recordCampaignConversion(matched.id, order.total);
            return { attributed: true, campaignId: matched.id, campaignTitle: matched.title };
        }
    }

    // 2. 7-Day Window Phone Attribution Match
    if (orderPhone) {
        const windowStart = new Date(orderDate.getTime() - ATTRIBUTION_WINDOW_DAYS * 86400000);

        // Find campaign created/active within the 7-day window
        for (const c of campaigns) {
            const cmpDate = new Date(c.created_at);
            if (cmpDate >= windowStart && cmpDate <= orderDate) {
                // Check if this recipient was in broadcast messages
                try {
                    const hit = await pb.collection("broadcast_messages").getFirstListItem(
                        `campaign="${c.title}" && recipient_phone~"${orderPhone.slice(-10)}"`
                    );
                    if (hit) {
                        await recordCampaignConversion(c.id, order.total);
                        return { attributed: true, campaignId: c.id, campaignTitle: c.title };
                    }
                } catch {
                    // Not found in this campaign
                }
            }
        }
    }

    return { attributed: false };
}

/**
 * Increment attributed conversions and revenue for a campaign
 */
export async function recordCampaignConversion(campaignId: string, orderRevenue: number): Promise<void> {
    const campaigns = await getMarketingCampaigns();
    const target = campaigns.find((c) => c.id === campaignId);
    if (!target) return;

    target.orders_converted = (target.orders_converted || 0) + 1;
    target.attributed_revenue = (target.attributed_revenue || 0) + Number(orderRevenue);

    try {
        await pb.collection(CAMPAIGNS_COLLECTION).update(campaignId, {
            orders_converted: target.orders_converted,
            attributed_revenue: target.attributed_revenue,
        });
    } catch {
        // Updated in memory
    }

    persistLocalCampaigns(campaigns);
}

/**
 * Aggregate Campaign Analytics Overview
 */
export async function getCampaignAnalyticsOverview(): Promise<CampaignAnalyticsOverview> {
    const campaigns = await getMarketingCampaigns();

    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter((c) => c.status === "active").length;

    const totalSent = campaigns.reduce((acc, c) => acc + (c.sent_count || 0), 0);
    const totalDelivered = campaigns.reduce((acc, c) => acc + (c.delivered_count || 0), 0);
    const totalRead = campaigns.reduce((acc, c) => acc + (c.read_count || 0), 0);
    const totalOrders = campaigns.reduce((acc, c) => acc + (c.orders_converted || 0), 0);
    const totalRevenue = campaigns.reduce((acc, c) => acc + (c.attributed_revenue || 0), 0);

    const overallDeliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;
    const overallReadRate = totalDelivered > 0 ? Math.round((totalRead / totalDelivered) * 100) : 0;
    const overallConversionRate = totalSent > 0 ? Math.round((totalOrders / totalSent) * 100 * 10) / 10 : 0;

    const funnel: FunnelStage[] = [
        {
            label: "Sent",
            count: totalSent,
            percentage: 100,
            color: "bg-primary",
        },
        {
            label: "Delivered",
            count: totalDelivered,
            percentage: totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
            color: "bg-blue-500",
        },
        {
            label: "Read",
            count: totalRead,
            percentage: totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0,
            color: "bg-emerald-500",
        },
        {
            label: "Replied",
            count: campaigns.reduce((acc, c) => acc + (c.replied_count || 0), 0),
            percentage: totalSent > 0 ? Math.round((campaigns.reduce((acc, c) => acc + (c.replied_count || 0), 0) / totalSent) * 100) : 0,
            color: "bg-purple-500",
        },
        {
            label: "Ordered (7d Attribution)",
            count: totalOrders,
            percentage: totalSent > 0 ? Math.round((totalOrders / totalSent) * 100 * 10) / 10 : 0,
            color: "bg-amber-500",
        },
    ];

    return {
        totalCampaigns,
        activeCampaigns,
        totalSent,
        totalDelivered,
        totalRead,
        totalOrders,
        totalRevenue,
        overallDeliveryRate,
        overallReadRate,
        overallConversionRate,
        funnel,
        campaigns,
    };
}
