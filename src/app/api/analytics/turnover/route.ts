/**
 * Analytics API — performance Layer 2 (Analytics Deep-Insights).
 *
 * GET /api/analytics/turnover?days=90[&hint=<account_email>]
 *
 * The turnover suite scans the whole stock ledger (movements window + every
 * variant's last sale) which gets slow client-side as history grows; this
 * route runs the same engines against a per-request authenticated session
 * client (never a shared server session) and returns the compact result.
 * Auth: bearer operator token, verified against the tenant DB like every
 * other API route (authenticateOperator).
 */

import { NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { authenticateOperator } from '@/lib/api-auth';
import { getTurnoverAnalytics } from '@/lib/analytics-v2/turnover';
import type { AnalyticsRange } from '@/lib/analytics-v2/range';

export const dynamic = 'force-dynamic';

const VALID_PRESETS = new Set(['7d', '30d', '90d', '12m']);

export async function GET(req: Request) {
    const url = new URL(req.url);
    const hint = url.searchParams.get('hint') || undefined;

    const session = await authenticateOperator(req, hint);
    if (!session.ok || !session.email || !session.client) {
        return NextResponse.json({ success: false, error: session.error || 'Unauthorized' }, { status: session.status });
    }

    const preset = url.searchParams.get('days') || '30d';
    const range: AnalyticsRange = VALID_PRESETS.has(preset)
        ? { preset: preset as '7d' | '30d' | '90d' | '12m' }
        : { preset: 'custom', start: url.searchParams.get('start') || undefined, end: url.searchParams.get('end') || undefined };

    try {
        // The session client is a full PocketBase instance; the engines accept
        // it verbatim so the scan runs against the tenant's own database.
        const analytics = await getTurnoverAnalytics(range, {
            db: session.client as unknown as PocketBase,
            tenant: session.email,
        });
        return NextResponse.json({ success: true, analytics });
    } catch (error) {
        console.error('[api/analytics/turnover] failed:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Analytics computation failed' },
            { status: 500 }
        );
    }
}
