/**
 * Campaign attribution (A37).
 *
 * Storefront traffic arrives with a UTM campaign name. The order used to keep it
 * only inside `internal_notes` text, so attribution could not be reported or
 * joined. This module resolves the name to a real `whatsapp_campaigns` row
 * (creating a `storefront` channel campaign when the name is new) and returns
 * the id for the `sales.campaign` relation; the name is always stored on the
 * order so the link is never lost if the campaign row is later removed.
 */

import { pb } from './pocketbase';

export type CampaignChannel = 'whatsapp' | 'sms' | 'email' | 'storefront';

export interface ResolvedCampaign {
    id: string;
    name: string;
}

/** Find or create the campaign row for a name; null when there is no name. */
export async function resolveCampaign(
    db: typeof pb,
    opts: { tenantEmail: string; name?: string; channel?: CampaignChannel }
): Promise<ResolvedCampaign | null> {
    const name = (opts.name || '').trim().slice(0, 80);
    if (!name) return null;

    try {
        const existing = await db
            .collection('whatsapp_campaigns')
            .getFirstListItem<{ id: string; name?: string }>(
                pb.filter('name = {:name} && account_email = {:account}', {
                    name,
                    account: opts.tenantEmail,
                }),
                { requestKey: null }
            )
            .catch(() => null);
        if (existing) return { id: existing.id, name };

        const created = await db.collection('whatsapp_campaigns').create({
            name,
            channel: opts.channel || 'storefront',
            status: 'running',
            account_email: opts.tenantEmail,
        });
        return { id: created.id, name };
    } catch (err) {
        console.warn('[campaigns] Could not resolve campaign attribution:', err);
        return null;
    }
}