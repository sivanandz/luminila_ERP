import { NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { authenticateOperator, hasCapability } from '@/lib/api-auth';
import { sanitizeFilter } from '@/lib/pocketbase';
import { decryptSecret, encryptSecret, isEncryptedSecret, parseRegistryKey } from '@/lib/tenant-secrets';

/**
 * H-23: the canonical store_config row is readable by every tenant member, so
 * gateway secrets are never written there. They live in a dedicated row,
 * encrypted at rest with TENANT_REGISTRY_KEY, and only an operator with
 * settings:update may read or write them. Without the key (dev) values are
 * stored as-is; production should always set it.
 */
const SECRET_FIELDS = [
    'razorpayKeySecret',
    'razorpayWebhookSecret',
    'phonepeSaltKey',
    'shopifyToken',
] as const;

type SecretField = (typeof SECRET_FIELDS)[number];
type SecretPayload = Partial<Record<SecretField, string>>;

function registryKey(): Buffer | null {
    return parseRegistryKey(process.env.TENANT_REGISTRY_KEY);
}

function encryptValue(value: string): string {
    const key = registryKey();
    if (!key || !value || isEncryptedSecret(value)) return value;
    return encryptSecret(value, key);
}

function decryptValue(value: string): string {
    if (!value || !isEncryptedSecret(value)) return value;
    const key = registryKey();
    return decryptSecret(value, key);
}

/** The dedicated per-tenant secrets row. */
async function loadSecretsRow(client: PocketBase, tenant: string) {
    return client.collection('store_settings').getFirstListItem<{
        id: string;
        value?: unknown;
    }>(
        `key="gateway_secrets" && account_email="${sanitizeFilter(tenant)}"`,
        { requestKey: null }
    ).catch(() => null);
}

export async function GET(req: NextRequest) {
    const session = await authenticateOperator(
        req,
        req.nextUrl.searchParams.get('accountEmail') || undefined
    );
    if (!session.ok || !session.client) {
        return NextResponse.json(
            { success: false, error: session.error },
            { status: session.status || 401 }
        );
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

    let parsed: SecretPayload | null = null;
    let row = await loadSecretsRow(session.client, tenant);

    // Lazy migration: an install upgraded from before this route kept the four
    // secrets inside the canonical store_config row. Move them out (encrypted)
    // and strip them from the canonical value on first reveal.
    if (!row) {
        const canonical = await session.client.collection('store_settings').getFirstListItem<{
            id: string;
            value?: unknown;
        }>(
            `category="store_config" && account_email="${sanitizeFilter(tenant)}"`,
            { sort: 'created', requestKey: null }
        ).catch(() => null);
        const canonicalValue = canonical?.value;
        if (canonicalValue) {
            const raw = typeof canonicalValue === 'string' ? JSON.parse(canonicalValue) : canonicalValue;
            const legacy: SecretPayload = {};
            let found = false;
            for (const field of SECRET_FIELDS) {
                const value = String((raw as Record<string, unknown>)?.[field] || '');
                if (value) {
                    legacy[field] = value;
                    found = true;
                }
            }
            if (found) {
                for (const field of SECRET_FIELDS) delete (raw as Record<string, unknown>)[field];
                await session.client.collection('store_settings').update(canonical!.id, {
                    value: raw,
                }).catch(() => {});
                const created = await session.client.collection('store_settings').create({
                    account_email: tenant,
                    key: 'gateway_secrets',
                    category: 'gateway_secrets',
                    value: Object.fromEntries(
                        SECRET_FIELDS.map((field) => [field, encryptValue(legacy[field] || '')])
                    ),
                }).catch(() => null);
                if (created) row = await loadSecretsRow(session.client, tenant);
            }
        }
    }

    if (row) {
        const raw = row.value;
        parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw as SecretPayload);
    }

    const secrets: Record<string, string> = {};
    for (const field of SECRET_FIELDS) {
        secrets[field] = decryptValue(String(parsed?.[field] || ''));
    }
    return NextResponse.json({ success: true, secrets });
}

export async function POST(req: NextRequest) {
    const session = await authenticateOperator(req, undefined);
    if (!session.ok || !session.client) {
        return NextResponse.json(
            { success: false, error: session.error },
            { status: session.status || 401 }
        );
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

    const body = await req.json().catch(() => ({}));
    const incoming: SecretPayload = {};
    for (const field of SECRET_FIELDS) {
        if (typeof body?.[field] === 'string') incoming[field] = body[field];
    }

    const row = await loadSecretsRow(session.client, tenant);
    const existing = row
        ? (typeof row.value === 'string' ? JSON.parse(row.value) : (row.value as SecretPayload))
        : {};
    const merged: Record<string, string> = {};
    for (const field of SECRET_FIELDS) {
        merged[field] = Object.prototype.hasOwnProperty.call(incoming, field)
            ? encryptValue(incoming[field] || '')
            : encryptValue(String(existing?.[field] || ''));
    }

    const payload = { key: 'gateway_secrets', category: 'gateway_secrets', value: merged };
    if (row) {
        await session.client.collection('store_settings').update(row.id, payload);
    } else {
        await session.client.collection('store_settings').create({
            ...payload,
            account_email: tenant,
        });
    }
    return NextResponse.json({ success: true });
}
