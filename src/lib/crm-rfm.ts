/**
 * RFM (Recency, Frequency, Monetary) Customer Segmentation & Milestone Engine
 * Calculates behavioral cohorts, lifetime values, and celebration dates for targeted campaigns.
 */

import { Customer } from "./customers";
import { pb } from "./pocketbase";
import { Sale } from "@/types/database";

export type RFMSegmentId =
    | "champions"
    | "loyal"
    | "potential_loyalist"
    | "at_risk"
    | "hibernating"
    | "celebrations"
    | "lead_prospects"
    | "all";

export interface RFMCustomer extends Customer {
    recencyDays: number;
    frequency: number;
    monetary: number;
    segment: RFMSegmentId;
    segmentLabel: string;
    hasUpcomingBirthday: boolean;
    hasUpcomingAnniversary: boolean;
    daysToBirthday?: number;
    daysToAnniversary?: number;
    lastPurchaseDate?: string;
    avgOrderValue: number;
}

export interface CohortSummary {
    id: RFMSegmentId;
    label: string;
    description: string;
    count: number;
    totalLTV: number;
    avgAOV: number;
    suggestedAction: string;
    badgeClass: string;
}

/**
 * Calculates days difference between today and a month-day milestone (e.g. birthday or anniversary)
 * Returns -1 if date is invalid, or number of days until next celebration (0 = today, 1-7 = upcoming)
 */
export function getDaysUntilMilestone(dateStr?: string | null): number {
    if (!dateStr) return -1;
    try {
        const target = new Date(dateStr);
        if (isNaN(target.getTime())) return -1;

        const now = new Date();
        const thisYear = now.getFullYear();

        // Calculate milestone in current year
        let nextCelebration = new Date(thisYear, target.getMonth(), target.getDate());

        // Normalize time to start of day
        now.setHours(0, 0, 0, 0);
        nextCelebration.setHours(0, 0, 0, 0);

        // If date has already passed this year, check next year
        if (nextCelebration.getTime() < now.getTime()) {
            nextCelebration = new Date(thisYear + 1, target.getMonth(), target.getDate());
            nextCelebration.setHours(0, 0, 0, 0);
        }

        const diffMs = nextCelebration.getTime() - now.getTime();
        return Math.round(diffMs / (1000 * 60 * 60 * 24));
    } catch {
        return -1;
    }
}

/**
 * Compute RFM Scores and Cohorts across customer database
 */
export async function computeRFMAnalysis(
    customerList?: Customer[]
): Promise<{
    customers: RFMCustomer[];
    cohorts: Record<RFMSegmentId, CohortSummary>;
}> {
    // 1. Fetch customers if not supplied
    let rawCustomers: Customer[] = customerList || [];
    if (rawCustomers.length === 0) {
        try {
            rawCustomers = await pb.collection("customers").getFullList<Customer>({
                sort: "-total_spent",
            });
        } catch (err) {
            console.warn("Failed to fetch customers for RFM:", err);
            rawCustomers = [];
        }
    }

    // 2. Fetch sales to cross-verify real recency
    const customerLastSaleMap: Record<string, string> = {};
    try {
        const sales = await pb.collection("sales").getFullList<Sale>({
            fields: "customer,created,total",
            sort: "-created",
        });
        for (const s of sales) {
            if (s.customer && !customerLastSaleMap[s.customer]) {
                customerLastSaleMap[s.customer] = s.created;
            }
        }
    } catch {
        // Fallback to customer.last_purchase_date or updated date
    }

    const now = new Date();
    const scoredCustomers: RFMCustomer[] = [];

    for (const c of rawCustomers) {
        const lastSaleDateStr = customerLastSaleMap[c.id] || c.last_purchase_date || c.updated || c.created;
        let recencyDays = 999;
        if (lastSaleDateStr) {
            const lastDate = new Date(lastSaleDateStr);
            if (!isNaN(lastDate.getTime())) {
                const diffMs = Math.max(0, now.getTime() - lastDate.getTime());
                recencyDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            }
        }

        const frequency = Math.max(Number(c.total_orders) || 0, customerLastSaleMap[c.id] ? 1 : 0);
        const monetary = Number(c.total_spent) || 0;
        const avgOrderValue = frequency > 0 ? Math.round(monetary / frequency) : 0;

        // Celebrations check (Birthdays or Anniversaries in next 7 days)
        const daysToBirthday = getDaysUntilMilestone(c.date_of_birth || (c as any).birthday_date);
        const daysToAnniversary = getDaysUntilMilestone(c.anniversary || (c as any).anniversary_date);

        const hasUpcomingBirthday = daysToBirthday >= 0 && daysToBirthday <= 7;
        const hasUpcomingAnniversary = daysToAnniversary >= 0 && daysToAnniversary <= 7;

        // RFM Segment Classification
        let segment: RFMSegmentId = "lead_prospects";
        let segmentLabel = "Lead / Prospect";

        if (hasUpcomingBirthday || hasUpcomingAnniversary) {
            segment = "celebrations";
            segmentLabel = hasUpcomingBirthday ? "Upcoming Birthday" : "Upcoming Anniversary";
        } else if (monetary >= 30000 || (frequency >= 3 && recencyDays <= 45)) {
            segment = "champions";
            segmentLabel = "VIP Champions";
        } else if (frequency >= 2 && recencyDays <= 60) {
            segment = "loyal";
            segmentLabel = "Loyal Shoppers";
        } else if (frequency === 1 && recencyDays <= 45) {
            segment = "potential_loyalist";
            segmentLabel = "Recent New Buyers";
        } else if (frequency >= 1 && recencyDays > 60 && recencyDays <= 120) {
            segment = "at_risk";
            segmentLabel = "At-Risk (60–120 Days)";
        } else if (frequency >= 1 && recencyDays > 120) {
            segment = "hibernating";
            segmentLabel = "Dormant / Lapsed (>120 Days)";
        } else {
            segment = "lead_prospects";
            segmentLabel = "Prospects (No Purchases)";
        }

        scoredCustomers.push({
            ...c,
            recencyDays,
            frequency,
            monetary,
            avgOrderValue,
            segment,
            segmentLabel,
            hasUpcomingBirthday,
            hasUpcomingAnniversary,
            daysToBirthday: daysToBirthday >= 0 ? daysToBirthday : undefined,
            daysToAnniversary: daysToAnniversary >= 0 ? daysToAnniversary : undefined,
            lastPurchaseDate: lastSaleDateStr,
        });
    }

    // Build Cohort Summaries
    const cohorts: Record<RFMSegmentId, CohortSummary> = {
        all: {
            id: "all",
            label: "All Contacts",
            description: "Entire customer directory across wholesale, retail, and VIP tiers.",
            count: scoredCustomers.length,
            totalLTV: scoredCustomers.reduce((acc, c) => acc + c.monetary, 0),
            avgAOV: scoredCustomers.length > 0 ? Math.round(scoredCustomers.reduce((acc, c) => acc + c.monetary, 0) / Math.max(1, scoredCustomers.reduce((acc, c) => acc + c.frequency, 0))) : 0,
            suggestedAction: "General brand updates & showroom broadcasts",
            badgeClass: "bg-primary/10 text-primary border-primary/20",
        },
        champions: {
            id: "champions",
            label: "VIP Champions",
            description: "High spenders (>₹30k) or frequent repeat buyers within 45 days.",
            count: scoredCustomers.filter((c) => c.segment === "champions").length,
            totalLTV: scoredCustomers.filter((c) => c.segment === "champions").reduce((acc, c) => acc + c.monetary, 0),
            avgAOV: 0,
            suggestedAction: "Exclusive private preview drops & concierge invites",
            badgeClass: "bg-amber-500/10 text-amber-500 border-amber-500/30",
        },
        loyal: {
            id: "loyal",
            label: "Loyal Shoppers",
            description: "Frequent repeat shoppers with continuous showroom engagement.",
            count: scoredCustomers.filter((c) => c.segment === "loyal").length,
            totalLTV: scoredCustomers.filter((c) => c.segment === "loyal").reduce((acc, c) => acc + c.monetary, 0),
            avgAOV: 0,
            suggestedAction: "Loyalty point multiplier promotions & referral perks",
            badgeClass: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
        },
        potential_loyalist: {
            id: "potential_loyalist",
            label: "Recent First-Time Buyers",
            description: "Purchased within the last 45 days with high repeat potential.",
            count: scoredCustomers.filter((c) => c.segment === "potential_loyalist").length,
            totalLTV: scoredCustomers.filter((c) => c.segment === "potential_loyalist").reduce((acc, c) => acc + c.monetary, 0),
            avgAOV: 0,
            suggestedAction: "Post-purchase jewelry care & matching collection recommendations",
            badgeClass: "bg-blue-500/10 text-blue-500 border-blue-500/30",
        },
        celebrations: {
            id: "celebrations",
            label: "Upcoming Celebrations",
            description: "Customers with a birthday or anniversary in the next 7 days.",
            count: scoredCustomers.filter((c) => c.segment === "celebrations").length,
            totalLTV: scoredCustomers.filter((c) => c.segment === "celebrations").reduce((acc, c) => acc + c.monetary, 0),
            avgAOV: 0,
            suggestedAction: "Personalized milestone voucher with complimentary silver coin perk",
            badgeClass: "bg-pink-500/10 text-pink-500 border-pink-500/30",
        },
        at_risk: {
            id: "at_risk",
            label: "At-Risk (60–120 Days)",
            description: "Previously purchased but have not visited or ordered in 2–4 months.",
            count: scoredCustomers.filter((c) => c.segment === "at_risk").length,
            totalLTV: scoredCustomers.filter((c) => c.segment === "at_risk").reduce((acc, c) => acc + c.monetary, 0),
            avgAOV: 0,
            suggestedAction: "Win-back voucher: 'We miss you' exclusive ₹1,000 off discount",
            badgeClass: "bg-orange-500/10 text-orange-500 border-orange-500/30",
        },
        hibernating: {
            id: "hibernating",
            label: "Dormant (>120 Days)",
            description: "Haven't placed an order in over 4 months.",
            count: scoredCustomers.filter((c) => c.segment === "hibernating").length,
            totalLTV: scoredCustomers.filter((c) => c.segment === "hibernating").reduce((acc, c) => acc + c.monetary, 0),
            avgAOV: 0,
            suggestedAction: "Re-engagement clearance catalog & festive teaser",
            badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30",
        },
        lead_prospects: {
            id: "lead_prospects",
            label: "Prospects & Inquiries",
            description: "Saved contacts or WhatsApp chats with no completed purchase yet.",
            count: scoredCustomers.filter((c) => c.segment === "lead_prospects").length,
            totalLTV: 0,
            avgAOV: 0,
            suggestedAction: "First-purchase welcome discount (e.g. 5% off introductory code)",
            badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/30",
        },
    };

    // Calculate average AOV for each cohort
    for (const key of Object.keys(cohorts) as RFMSegmentId[]) {
        if (key === "all") continue;
        const members = scoredCustomers.filter((c) => c.segment === key);
        const totalFreq = members.reduce((acc, c) => acc + c.frequency, 0);
        cohorts[key].avgAOV = totalFreq > 0 ? Math.round(cohorts[key].totalLTV / totalFreq) : 0;
    }

    return { customers: scoredCustomers, cohorts };
}
