/**
 * E-way bill credentials, stored per tenant in `store_settings` under the
 * single row `key="eway_bill"`. The settings component used to build that
 * filter and upsert inline (D-23).
 */

import { pb, getCurrentTenantEmail, sanitizeFilter } from './pocketbase';
import { getStoreSettings } from './settings';

export interface EwayBillConfig {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    isProduction: boolean;
}

interface EwayBillRecord {
    id: string;
    eway_client_id?: string;
    eway_client_secret?: string;
    eway_username?: string;
    eway_password?: string;
    eway_is_production?: boolean;
}

function tenantFilter(userEmail: string): string {
    return userEmail
        ? `key="eway_bill" && account_email="${sanitizeFilter(userEmail)}"`
        : 'key="eway_bill"';
}

export async function getEwayBillConfig(): Promise<EwayBillConfig | null> {
    const userEmail = getCurrentTenantEmail();
    const filter = tenantFilter(userEmail);

    const record = await pb.collection('store_settings')
        .getFirstListItem<EwayBillRecord>(filter)
        .catch(() => null);
    if (!record) return null;

    return {
        clientId: record.eway_client_id || '',
        clientSecret: record.eway_client_secret || '',
        username: record.eway_username || '',
        password: record.eway_password || '',
        isProduction: record.eway_is_production || false,
    };
}

export async function saveEwayBillConfig(config: EwayBillConfig): Promise<void> {
    const userEmail = getCurrentTenantEmail();
    const filter = tenantFilter(userEmail);

    const data = {
        key: 'eway_bill',
        eway_client_id: config.clientId,
        eway_client_secret: config.clientSecret,
        eway_username: config.username,
        eway_password: config.password,
        eway_is_production: config.isProduction,
        account_email: userEmail || '',
    };

    const existing = await pb.collection('store_settings')
        .getFirstListItem<{ id: string }>(filter)
        .catch(() => null);

    if (existing) {
        await pb.collection('store_settings').update(existing.id, data);
    } else {
        await pb.collection('store_settings').create(data);
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
export async function testEwayBillConnection(config: EwayBillConfig): Promise<EwayBillTestResult> {
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
