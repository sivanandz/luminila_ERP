import { NextRequest, NextResponse } from 'next/server';
import { authenticateOperator, hasCapability } from '@/lib/api-auth';
import {
    decryptSecret,
    encryptSecret,
    isEncryptedSecret,
    parseRegistryKey,
} from '@/lib/tenant-secrets';
import { sanitizeFilter } from '@/lib/pocketbase';

export const runtime = 'nodejs';

/**
 * E-way Bill credential storage (AI-SYS-18).
 *
 * Client secret and GST-portal password are encrypted with the same
 * AES-256-GCM key the AI provider store uses (`AI_SECRET_KEY`, falling back to
 * `TENANT_REGISTRY_KEY`). The browser never receives them for display: the
 * non-reveal GET returns only `hasClientSecret`/`hasPassword`. NIC
 * authentication asks for `reveal=1`, which requires `settings:update`.
 *
 * Legacy plaintext rows are re-encrypted lazily on the first read when a key is
 * configured.
 */

interface EwayRow {
    id: string;
    eway_client_id?: string;
    eway_client_secret?: string;
    eway_username?: string;
    eway_password?: string;
    eway_is_production?: boolean;
    account_email?: string;
}

function registryKey(): Buffer | null {
    return parseRegistryKey(process.env.AI_SECRET_KEY || process.env.TENANT_REGISTRY_KEY);
}

function keyRequired(): NextResponse {
    return NextResponse.json(
        {
            success: false,
            error: 'Set AI_SECRET_KEY or TENANT_REGISTRY_KEY (32-byte hex) before saving E-way Bill secrets.',
        },
        { status: 503 }
    );
}

async function loadRow(
    client: NonNullable<Awaited<ReturnType<typeof authenticateOperator>>['client']>,
    tenant: string
): Promise<EwayRow | null> {
    return client
        .collection('store_settings')
        .getFirstListItem<EwayRow>(
            // Strict tenant match (audit L-01): an empty-owner legacy row is
            // nobody's credential store, not everybody's. The live
            // store_settings rule already hides such rows from operator
            // tokens; dropping the "" arm keeps the API honest if that rule
            // ever regresses.
            `key="eway_bill" && account_email="${sanitizeFilter(tenant)}"`,
            { requestKey: null }
        )
        .catch(() => null);
}

export async function GET(req: NextRequest) {
    const hint = req.nextUrl.searchParams.get('accountEmail') || undefined;
    const session = await authenticateOperator(req, hint);
    if (!session.ok || !session.client) {
        return NextResponse.json({ success: false, error: session.error }, { status: session.status || 401 });
    }

    const reveal = req.nextUrl.searchParams.get('reveal') === '1';
    const capability = reveal ? 'update' : 'read';
    if (!(await hasCapability(session, 'settings', capability))) {
        return NextResponse.json(
            { success: false, error: `Missing settings:${capability} capability.` },
            { status: 403 }
        );
    }

    const tenant = String(session.accountEmail || session.email || '').trim().toLowerCase();
    if (!tenant) {
        return NextResponse.json({ success: false, error: 'No tenant on this session.' }, { status: 400 });
    }

    const row = await loadRow(session.client, tenant);
    if (!row) {
        return NextResponse.json({ success: true, configured: false, isProduction: false });
    }

    const key = registryKey();
    let clientSecret = row.eway_client_secret || '';
    let password = row.eway_password || '';

    if (key) {
        const original = { clientSecret, password };
        if (clientSecret && !isEncryptedSecret(clientSecret)) {
            clientSecret = encryptSecret(clientSecret, key);
        }
        if (password && !isEncryptedSecret(password)) {
            password = encryptSecret(password, key);
        }
        // Lazy migration of rows written before this endpoint existed.
        if (clientSecret !== original.clientSecret || password !== original.password) {
            await session.client.collection('store_settings').update(row.id, {
                eway_client_secret: clientSecret,
                eway_password: password,
            }).catch(() => {});
        }
    }

    if (reveal) {
        if (!key && (isEncryptedSecret(clientSecret) || isEncryptedSecret(password))) {
            return keyRequired();
        }
        return NextResponse.json({
            success: true,
            configured: true,
            clientId: row.eway_client_id || '',
            clientSecret: isEncryptedSecret(clientSecret) ? decryptSecret(clientSecret, key) : clientSecret,
            username: row.eway_username || '',
            password: isEncryptedSecret(password) ? decryptSecret(password, key) : password,
            isProduction: Boolean(row.eway_is_production),
        });
    }

    return NextResponse.json({
        success: true,
        configured: true,
        clientId: row.eway_client_id || '',
        username: row.eway_username || '',
        isProduction: Boolean(row.eway_is_production),
        hasClientSecret: Boolean(clientSecret),
        hasPassword: Boolean(password),
        clientSecret: '',
        password: '',
    });
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const hint = typeof body?.accountEmail === 'string' ? body.accountEmail : undefined;
    const session = await authenticateOperator(req, hint);
    if (!session.ok || !session.client) {
        return NextResponse.json({ success: false, error: session.error }, { status: session.status || 401 });
    }
    if (!(await hasCapability(session, 'settings', 'update'))) {
        return NextResponse.json(
            { success: false, error: 'Missing settings:update capability.' },
            { status: 403 }
        );
    }

    const tenant = String(session.accountEmail || session.email || '').trim().toLowerCase();
    if (!tenant) {
        return NextResponse.json({ success: false, error: 'No tenant on this session.' }, { status: 400 });
    }

    const clientId = String(body.clientId ?? '').trim();
    const username = String(body.username ?? '').trim();
    if (!clientId || !username) {
        return NextResponse.json(
            { success: false, error: 'Client ID and username are required.' },
            { status: 400 }
        );
    }

    const existing = await loadRow(session.client, tenant);
    const key = registryKey();
    const submittedSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    const submittedPassword = typeof body.password === 'string' ? body.password.trim() : '';

    if ((submittedSecret || submittedPassword) && !key) {
        return keyRequired();
    }

    const encryptedSecret = submittedSecret
        ? encryptSecret(submittedSecret, key as Buffer)
        : (existing?.eway_client_secret || '');
    const encryptedPassword = submittedPassword
        ? encryptSecret(submittedPassword, key as Buffer)
        : (existing?.eway_password || '');

    const payload = {
        account_email: tenant,
        key: 'eway_bill',
        category: 'settings',
        eway_client_id: clientId,
        eway_client_secret: encryptedSecret,
        eway_username: username,
        eway_password: encryptedPassword,
        eway_is_production: Boolean(body.isProduction),
    };

    if (existing) {
        await session.client.collection('store_settings').update(existing.id, {
            ...payload,
            // Always stamp the caller's tenant (audit L-01): preserving a
            // legacy empty owner kept the row globally readable forever.
            account_email: tenant,
        });
    } else {
        await session.client.collection('store_settings').create(payload);
    }

    return NextResponse.json({
        success: true,
        hasClientSecret: Boolean(encryptedSecret),
        hasPassword: Boolean(encryptedPassword),
    });
}
