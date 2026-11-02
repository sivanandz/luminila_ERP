/**
 * E-way bill credentials, stored per tenant in `store_settings` under the
 * single row `key="eway_bill"`.
 *
 * Secrets are encrypted at rest by `/api/settings/eway` (AI-SYS-18). The
 * non-reveal read returns only `hasClientSecret`/`hasPassword`; saving with an
 * empty secret field keeps the stored value.
 */

import { pb, ensureAuth, getCurrentTenantEmail } from './pocketbase';
import { getStoreSettings } from './settings';

export interface EwayBillConfig {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    isProduction: boolean;
    /** True when a secret is already stored (the value itself is not returned). */
    hasClientSecret?: boolean;
    hasPassword?: boolean;
}

interface EwayApiResponse {
    success?: boolean;
    error?: string;
    configured?: boolean;
    clientId?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    isProduction?: boolean;
    hasClientSecret?: boolean;
    hasPassword?: boolean;
}

function authHeaders(): Record<string, string> {
    ensureAuth();
    return pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {};
}

export async function getEwayBillConfig(revealSecrets = false): Promise<EwayBillConfig | null> {
    const tenant = getCurrentTenantEmail();
    const params = new URLSearchParams();
    if (tenant) params.set('accountEmail', tenant);
    if (revealSecrets) params.set('reveal', '1');

    const res = await fetch(`/api/settings/eway?${params.toString()}`, {
        headers: authHeaders(),
        cache: 'no-store',
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const data = await res.json() as EwayApiResponse;
    if (!data.success || !data.configured) return null;

    return {
        clientId: data.clientId || '',
        clientSecret: data.clientSecret || '',
        username: data.username || '',
        password: data.password || '',
        isProduction: Boolean(data.isProduction),
        hasClientSecret: Boolean(data.hasClientSecret),
        hasPassword: Boolean(data.hasPassword),
    };
}

export async function saveEwayBillConfig(config: EwayBillConfig): Promise<void> {
    const tenant = getCurrentTenantEmail();
    const res = await fetch('/api/settings/eway', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
        },
        body: JSON.stringify({
            accountEmail: tenant || undefined,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            username: config.username,
            password: config.password,
            isProduction: config.isProduction,
        }),
    });

    const data = await res.json().catch(() => null) as EwayApiResponse | null;
    if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Could not save E-way Bill settings (HTTP ${res.status}).`);
    }
}

const SANDBOX_BASE_URL = 'https://gst.charteredinfo.com/ewayapi';
const PRODUCTION_BASE_URL = 'https://api.ewaybillgst.gov.in/ewayapi';
const TEST_TIMEOUT_MS = 15_000;

export interface EwayBillTestResult {
    ok: boolean;
    /** True when the test could not run because the credentials are incomplete. */
    notConfigured?: boolean;
    message: string;
}

function base64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/**
 * Real NIC ACCESSTOKEN check for the credentials in the form.
 *
 * The settings screen used to answer "Connection successful" from a 1500 ms
 * timer with no network call at all (AI-SYS-18). This asks the NIC auth endpoint
 * and reports exactly what it answered; incomplete credentials are reported as
 * "not configured", never as a success.
 */
export async function testEwayBillConnection(input: EwayBillConfig): Promise<EwayBillTestResult> {
    // The settings form no longer receives stored secrets; if the operator did
    // not retype them, use the saved (decrypted server-side) values.
    let config = input;
    if (!config.clientSecret || !config.password) {
        const saved = await getEwayBillConfig(true).catch(() => null);
        if (saved) {
            config = {
                ...config,
                clientSecret: config.clientSecret || saved.clientSecret,
                password: config.password || saved.password,
            };
        }
    }

    if (!config.clientId || !config.clientSecret || !config.username || !config.password) {
        return {
            ok: false,
            notConfigured: true,
            message: 'E-way Bill is not configured: client ID, client secret, username and password are all required.',
        };
    }

    let gstin = '';
    try {
        const settings = await getStoreSettings();
        gstin = String(settings.gstin ?? '').trim();
    } catch {
        gstin = '';
    }
    if (!gstin) {
        return {
            ok: false,
            notConfigured: true,
            message: 'E-way Bill is not configured: add the store GSTIN in Invoice & GST settings first.',
        };
    }

    const baseUrl = config.isProduction ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
    const authPayload = {
        action: 'ACCESSTOKEN',
        username: config.username,
        password: config.password,
        app_key: config.clientId,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${baseUrl}/authenticate?action=ACCESSTOKEN`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'client-id': config.clientId,
                'client-secret': config.clientSecret,
                gstin,
            },
            body: JSON.stringify({
                action: 'ACCESSTOKEN',
                data: base64Utf8(JSON.stringify(authPayload)),
            }),
            signal: controller.signal,
        });

        const body = await response.json().catch(() => null) as
            | { status?: number | string; error?: { message?: string; errorDesc?: string } }
            | null;

        if (!response.ok) {
            return {
                ok: false,
                message: `NIC rejected the request (HTTP ${response.status}). Check the client ID/secret and GSTIN.`,
            };
        }
        const accepted = body?.status === 1 || body?.status === '1';
        if (accepted) {
            return {
                ok: true,
                message: `NIC accepted the credentials in ${config.isProduction ? 'production' : 'sandbox'} mode.`,
            };
        }
        return {
            ok: false,
            message: body?.error?.message || body?.error?.errorDesc || 'NIC rejected the credentials.',
        };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return { ok: false, message: 'The NIC endpoint did not answer within 15 seconds.' };
        }
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'The connection test failed.',
        };
    } finally {
        clearTimeout(timeout);
    }
}
