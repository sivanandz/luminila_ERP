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

/**
 * Raised when campaign attribution could not be resolved for a real reason
 * (network/permission failure, or a create that never settled). Callers must
 * surface it: silently returning null de-attributed the order with no signal
 * (ENG-15).
 */
export class CampaignResolutionError extends Error {
    /** The underlying PB/client error, kept for logging. */
    readonly detail?: unknown;

    constructor(message: string, detail?: unknown) {
        super(message);
        this.name = 'CampaignResolutionError';
        this.detail = detail;
    }
}

function statusOf(error: unknown): number | undefined {
    const status = (error as { status?: number })?.status;
    return typeof status === 'number' ? status : undefined;
}

/** Find or create the campaign row for a name; null when there is no name. */
export async function resolveCampaign(
    db: typeof pb,
    opts: { tenantEmail: string; name?: string; channel?: CampaignChannel }
): Promise<ResolvedCampaign | null> {
    const name = (opts.name || '').trim().slice(0, 80);
    if (!name) return null;

    const tenantEmail = opts.tenantEmail;
    const findExisting = () =>
        db
            .collection('whatsapp_campaigns')
            .getFirstListItem<{ id: string; name?: string }>(
                pb.filter('name = {:name} && account_email = {:account}', {
                    name,
                    account: tenantEmail,
                }),
                { requestKey: null }
            );

    let existing: { id: string; name?: string } | null = null;
    try {
        existing = await findExisting();
    } catch (err) {
        // 404 is "no such campaign yet"; anything else is a real failure and
        // must not be reported as "no campaign".
        if (statusOf(err) !== 404) {
            throw new CampaignResolutionError(
                `Could not look up campaign "${name}" for ${tenantEmail}: ${err instanceof Error ? err.message : String(err)}`,
                err
            );
        }
    }
    if (existing) return { id: existing.id, name };

    try {
        const created = await db.collection('whatsapp_campaigns').create({
            name,
            channel: opts.channel || 'storefront',
            status: 'running',
            account_email: tenantEmail,
        });
        return { id: created.id, name };
    } catch (err) {
        // find-then-create race: another request created the same row between
        // the lookup and the insert (unique constraint → 400/409). Re-read the
        // winner instead of failing the order or creating a duplicate.
        const status = statusOf(err);
        if (status === 400 || status === 409) {
            try {
                const raced = await findExisting();
                return { id: raced.id, name };
            } catch (retryErr) {
                throw new CampaignResolutionError(
                    `Campaign "${name}" could not be created or re-read for ${tenantEmail}.`,
                    retryErr
                );
            }
        }
        throw new CampaignResolutionError(
            `Could not create campaign "${name}" for ${tenantEmail}: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }
}