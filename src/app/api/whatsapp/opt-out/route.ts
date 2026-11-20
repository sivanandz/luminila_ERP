import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createTenantClient } from '@/lib/pocketbase';
import { isSingleAccountMode, SINGLE_ACCOUNT_EMAIL } from '@/lib/deployment-mode';
import { normalizeBindingEmail } from '@/lib/storefront';
import { resolveWppSecret } from '@/lib/whatsapp';
import { setWhatsAppOptOut } from '@/lib/whatsapp-crm';

/**
 * H-27: the sidecar calls this when a STOP reply arrives while no operator has
 * the WhatsApp hub open, so opted-out customers stop receiving marketing even
 * unattended. Authenticated with the shared sidecar secret (never a session);
 * tenant is the configured single account or an explicitly named one.
 */
function timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function POST(req: NextRequest) {
    const expected = resolveWppSecret(undefined, undefined, process.env.WPPCONNECT_SECRET);
    const provided = req.headers.get('x-sidecar-secret') || '';
    if (!expected || !timingSafeEqual(expected, provided)) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const phone = String(body?.phone || '').trim();
    if (!phone) {
        return NextResponse.json({ success: false, error: 'phone is required' }, { status: 400 });
    }

    const tenant = isSingleAccountMode()
        ? SINGLE_ACCOUNT_EMAIL
        : normalizeBindingEmail(body?.tenant);
    if (!tenant) {
        return NextResponse.json(
            { success: false, error: 'A tenant email is required in multi-account mode.' },
            { status: 400 }
        );
    }

    try {
        const client = await createTenantClient(tenant);
        const ok = await setWhatsAppOptOut(phone, undefined, 'stop', client);
        if (!ok) {
            return NextResponse.json({ success: false, error: 'Opt-out could not be recorded.' }, { status: 502 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[whatsapp opt-out] failed:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Opt-out failed.' },
            { status: 502 }
        );
    }
}
