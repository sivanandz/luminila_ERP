/**
 * Smart Staggered Broadcast Queue (spec §11 — Marketing Campaigns & Anti-Ban Safeguards)
 *
 * Engineering rules enforced by this engine:
 *  1. Humanized jitter — every queued message gets a randomized 8–22s dispatch slot.
 *  2. Personalized merge tags — {{customer_name}}, {{first_name}}, {{loyalty_points}}, {{tier}}, {{total_spent}}.
 *  3. Audience segmentation — opted-in cohorts only (loyalty tier / point balance / wholesale / all).
 *  4. Daily volume quota — hard stop at 150 marketing messages per day;
 *     transactional receipts and customer-initiated replies are unaffected.
 *  5. Opt-out compliance — `whatsapp_opt_outs` registry + customer profile flag; "STOP" replies auto-register.
 *
 * The queue drains via `processBroadcastQueue()`, which sends due messages one at a
 * time and re-schedules the rest — call it on an interval from a long-lived surface.
 */

import { pb } from './pocketbase';
import { whatsappManager } from './whatsapp';
import { normalizeE164, isWhatsAppOptedOut } from './whatsapp-crm';

export const DAILY_MARKETING_QUOTA = 150;
export const JITTER_MIN_MS = 8_000;
export const JITTER_MAX_MS = 22_000;

export type AudienceSegment =
    | 'all_active'
    | 'vip_tiers'
    | 'points_over_500'
    | 'wholesale';

export interface BroadcastAudienceMember {
    id: string;
    name: string;
    phone: string;
    loyalty_points: number;
    total_spent: number;
    customer_type: string;
}

export interface CampaignQueueResult {
    campaign: string;
    queued: number;
    skippedOptOut: number;
    skippedNoPhone: number;
}

interface CustomerRow {
    id: string;
    name: string;
    phone?: string;
    loyalty_points?: number;
    total_spent?: number;
    customer_type?: string;
    whatsapp_opt_out?: boolean;
}

export interface AudienceResolutionResult {
    members: BroadcastAudienceMember[];
    skippedOptOut: number;
    skippedNoPhone: number;
}

export interface CachedTier {
    name: string;
    min_points: number;
}

let cachedLoyaltyTiers: CachedTier[] | null = null;

export async function loadLoyaltyTiers(): Promise<CachedTier[]> {
    if (cachedLoyaltyTiers) return cachedLoyaltyTiers;
    try {
        const records = await pb.collection('loyalty_tiers').getFullList({
            sort: '-min_points',
        });
        if (records.length > 0) {
            cachedLoyaltyTiers = records.map((r: any) => ({
                name: r.name,
                min_points: r.min_points || 0,
            }));
            return cachedLoyaltyTiers;
        }
    } catch {
        // fallback to standard ladder
    }
    return [
        { name: 'Platinum', min_points: 2000 },
        { name: 'Gold', min_points: 1000 },
        { name: 'Silver', min_points: 300 },
        { name: 'Bronze', min_points: 0 },
    ];
}

export function resolveTierName(points: number, configuredTiers?: CachedTier[]): string {
    const tiers = configuredTiers && configuredTiers.length > 0 ? configuredTiers : [
        { name: 'Platinum', min_points: 2000 },
        { name: 'Gold', min_points: 1000 },
        { name: 'Silver', min_points: 300 },
        { name: 'Bronze', min_points: 0 },
    ];
    const match = tiers.find(t => points >= t.min_points);
    return match ? match.name : 'Bronze';
}

/** Resolve an audience segment into opted-in customers with valid phone numbers and detailed metrics. */
export async function resolveAudienceDetailed(segment: AudienceSegment): Promise<AudienceResolutionResult> {
    const filters: Record<AudienceSegment, string> = {
        all_active: '',
        vip_tiers: 'loyalty_points>=1000',
        points_over_500: 'loyalty_points>500',
        wholesale: 'customer_type="wholesale"',
    };

    let rows: CustomerRow[] = [];
    try {
        rows = await pb.collection('customers').getFullList({
            filter: filters[segment],
            sort: '-total_spent',
        }) as unknown as CustomerRow[];
    } catch (queryErr) {
        // Fallback: fetch without filter and filter in memory if PB syntax differs
        try {
            const allRows = await pb.collection('customers').getFullList({
                sort: '-total_spent',
            }) as unknown as CustomerRow[];

            if (segment === 'vip_tiers') {
                rows = allRows.filter((r) => (r.loyalty_points || 0) >= 1000);
            } else if (segment === 'points_over_500') {
                rows = allRows.filter((r) => (r.loyalty_points || 0) > 500);
            } else if (segment === 'wholesale') {
                rows = allRows.filter((r) => r.customer_type === 'wholesale');
            } else {
                rows = allRows;
            }
        } catch (fallbackErr) {
            console.error('[broadcast] resolveAudience failed completely:', fallbackErr);
            return { members: [], skippedOptOut: 0, skippedNoPhone: 0 };
        }
    }

    const members: BroadcastAudienceMember[] = [];
    let skippedNoPhone = 0;
    let skippedOptOut = 0;

    for (const row of rows) {
        const rawPhone = row.phone || '';
        const digits = rawPhone.replace(/\D/g, '');
        if (!rawPhone || digits.length < 10) {
            skippedNoPhone++;
            continue;
        }

        // Verify opt-out via both direct customer flag and global registry
        if (row.whatsapp_opt_out) {
            skippedOptOut++;
            continue;
        }
        if (await isWhatsAppOptedOut(rawPhone)) {
            skippedOptOut++;
            continue;
        }

        members.push({
            id: row.id,
            name: row.name || 'Customer',
            phone: normalizeE164(rawPhone),
            loyalty_points: row.loyalty_points || 0,
            total_spent: row.total_spent || 0,
            customer_type: row.customer_type || 'retail',
        });
    }

    return { members, skippedOptOut, skippedNoPhone };
}

/** Resolve an audience segment into opted-in customers with valid phone numbers. */
export async function resolveAudience(segment: AudienceSegment): Promise<BroadcastAudienceMember[]> {
    const res = await resolveAudienceDetailed(segment);
    return res.members;
}

/** Render merge tags for a specific customer (spec §11.2) using canonical tiers. */
export function renderMergeTags(
    template: string,
    member: Pick<BroadcastAudienceMember, 'name' | 'loyalty_points' | 'total_spent' | 'customer_type'>,
    configuredTiers?: CachedTier[]
): string {
    const tier = resolveTierName(member.loyalty_points || 0, configuredTiers);
    const firstName = (member.name || '').trim().split(/\s+/)[0] || 'Customer';

    return template
        .replace(/\{\{\s*customer_name\s*\}\}/gi, member.name || 'Valued Customer')
        .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
        .replace(/\{\{\s*loyalty_points\s*\}\}/gi, String(member.loyalty_points || 0))
        .replace(/\{\{\s*tier\s*\}\}/gi, tier)
        .replace(/\{\{\s*total_spent\s*\}\}/gi, `₹${(member.total_spent || 0).toLocaleString('en-IN')}`);
}

/** Marketing messages already sent today (quota guard, spec §11.4). */
export async function sentTodayCount(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    try {
        const records = await pb.collection('broadcast_messages').getList(1, 1, {
            filter: `status="sent" && sent_at>="${startOfDay.toISOString()}"`,
        });
        return records.totalItems;
    } catch {
        return 0;
    }
}

/** Compute a cryptographically sound humanized delay between 8,000ms and 22,000ms. */
export function getHumanizedJitterDelayMs(): number {
    const range = JITTER_MAX_MS - JITTER_MIN_MS;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return JITTER_MIN_MS + (buf[0] % range);
    }
    return JITTER_MIN_MS + Math.floor(Math.random() * range);
}

/**
 * Queue a campaign: resolves the audience, renders merge tags, registers
 * opt-outs, and assigns each message a randomized 8–22s staggered slot.
 */
export async function queueCampaign(input: {
    campaign: string;
    template: string;
    segment: AudienceSegment;
    createdBy?: string;
}): Promise<CampaignQueueResult> {
    const { members, skippedOptOut, skippedNoPhone } = await resolveAudienceDetailed(input.segment);
    const result: CampaignQueueResult = {
        campaign: input.campaign,
        queued: 0,
        skippedOptOut,
        skippedNoPhone,
    };
    const tiers = await loadLoyaltyTiers();

    let slotOffset = 0;
    for (const member of members) {
        const body = renderMergeTags(input.template, member, tiers) + '\n\n_Reply STOP to opt out._';
        slotOffset += getHumanizedJitterDelayMs();

        try {
            await pb.collection('broadcast_messages').create({
                campaign: input.campaign,
                customer: member.id,
                recipient_phone: member.phone,
                body,
                status: 'queued',
                scheduled_at: new Date(Date.now() + slotOffset).toISOString(),
                created_by: input.createdBy || '',
            });
            result.queued++;
        } catch (err) {
            console.warn('[broadcast] queue entry failed for customer', member.id, (err as Error)?.message);
        }
    }

    return result;
}

/**
 * Drain the broadcast queue: sends every queued message whose jittered slot
 * is due, one at a time, respecting the daily quota and opt-out registry.
 * Call repeatedly (e.g. every 10–15s) from a long-lived surface.
 */
export async function processBroadcastQueue(): Promise<{
    sent: number;
    skipped: number;
    failed: number;
    quotaRemaining: number;
}> {
    const stats = { sent: 0, skipped: 0, failed: 0, quotaRemaining: 0 };

    const quotaUsed = await sentTodayCount();
    const quotaRemaining = Math.max(0, DAILY_MARKETING_QUOTA - quotaUsed);
    stats.quotaRemaining = quotaRemaining;
    if (quotaRemaining <= 0) return stats;

    let due;
    try {
        due = await pb.collection('broadcast_messages').getList(1, Math.min(quotaRemaining, 20), {
            filter: 'status="queued" && scheduled_at<="' + new Date().toISOString() + '"',
            sort: 'scheduled_at',
        });
    } catch (err) {
        console.warn('[broadcast] queue fetch failed:', (err as Error)?.message);
        return stats;
    }

    for (const entry of due.items as unknown as {
        id: string;
        recipient_phone: string;
        body?: string;
        customer?: string;
    }[]) {
        if (stats.sent >= quotaRemaining) break;

        // Opt-outs are re-checked at dispatch time (new STOPs are honored mid-campaign)
        if (await isWhatsAppOptedOut(entry.recipient_phone)) {
            await pb.collection('broadcast_messages').update(entry.id, {
                status: 'skipped',
                error: 'opted out before dispatch',
            }).catch(() => {});
            stats.skipped++;
            continue;
        }

        try {
            const ok = await whatsappManager.sendMessage(entry.recipient_phone, entry.body || '');
            if (ok) {
                await pb.collection('broadcast_messages').update(entry.id, {
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    error: '',
                });
                stats.sent++;
            } else {
                await pb.collection('broadcast_messages').update(entry.id, {
                    status: 'failed',
                    error: 'WPPConnect sidecar returned false',
                });
                stats.failed++;
            }
        } catch (err) {
            await pb.collection('broadcast_messages').update(entry.id, {
                status: 'failed',
                error: (err as Error)?.message || 'send error',
            }).catch(() => {});
            stats.failed++;
        }
    }

    return stats;
}

/** Register a STOP opt-out for a customer (inbound "STOP" handler). */
export async function registerStopOptOut(phoneOrChatId: string, customerId?: string): Promise<void> {
    const { setWhatsAppOptOut } = await import('./whatsapp-crm');
    await setWhatsAppOptOut(phoneOrChatId, customerId, 'stop');
}

/** Campaign queue snapshot for the composer UI. */
export async function getCampaignQueueSnapshot(campaign?: string): Promise<{ queued: number; sentToday: number }> {
    try {
        const filter = campaign ? `campaign="${campaign}"` : '';
        const [queued, sentToday] = await Promise.all([
            pb.collection('broadcast_messages').getList(1, 1, {
                filter: (filter ? filter + ' && ' : '') + 'status="queued"',
            }),
            sentTodayCount(),
        ]);
        return { queued: queued.totalItems, sentToday };
    } catch {
        return { queued: 0, sentToday: 0 };
    }
}
