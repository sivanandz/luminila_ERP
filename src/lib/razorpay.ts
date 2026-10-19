/**
 * Razorpay Payment Gateway Integration
 * Strict adherence to official documentation:
 * https://razorpay.com/docs/api/payments/payment-links
 * https://razorpay.com/docs/cli/install-cli
 */

import crypto from 'crypto';
import { getTenantStorageKey, pb } from './pocketbase';

export interface RazorpayConfig {
    keyId: string;
    keySecret: string;
    webhookSecret?: string;
    isTestMode: boolean;
}

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

let config: RazorpayConfig = {
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    isTestMode: process.env.NEXT_PUBLIC_RAZORPAY_ENV !== 'production',
};

function refreshConfigFromStorage() {
    if (typeof window === 'undefined') return;
    try {
        const stored = localStorage.getItem(getTenantStorageKey('luminila_settings'));
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.razorpayKeyId) {
                config.keyId = parsed.razorpayKeyId;
                config.keySecret = parsed.razorpayKeySecret || config.keySecret;
                config.webhookSecret = parsed.razorpayWebhookSecret || config.webhookSecret;
                config.isTestMode = parsed.razorpayEnv !== 'PROD';
            }
        }
    } catch (e) {
        console.error('Failed to load Razorpay config from storage', e);
    }
}

// Client-side initialization from localStorage if available
refreshConfigFromStorage();

export function setRazorpayConfig(newConfig: Partial<RazorpayConfig>) {
    config = { ...config, ...newConfig };
}

export function getRazorpayConfig(): RazorpayConfig {
    refreshConfigFromStorage();
    return { ...config };
}

export function isRazorpayConfigured(): boolean {
    refreshConfigFromStorage();
    if (typeof window !== 'undefined') {
        return Boolean(config.keyId);
    }
    return Boolean(config.keyId && config.keySecret);
}

/** Standard Razorpay MDR fee rate (2.2%) */
export const DEFAULT_RAZORPAY_FEE_PERCENT = 2.2;

/**
 * Calculates net-neutral markup for Razorpay links.
 * Gross = ceil(Net / (1 - feeRate))
 */
export function calculateGatewayMarkup(
    netAmount: number,
    feePercent: number = DEFAULT_RAZORPAY_FEE_PERCENT
): { netAmount: number; feeAmount: number; grossAmount: number; feePercent: number } {
    const net = Math.max(0, Number(netAmount) || 0);
    if (net === 0) return { netAmount: 0, feeAmount: 0, grossAmount: 0, feePercent };
    const rate = feePercent / 100;
    const gross = Math.ceil(net / (1 - rate));
    const fee = gross - net;
    return { netAmount: net, feeAmount: fee, grossAmount: gross, feePercent };
}

/**
 * Converts INR Rupees to Paise (integer subunits)
 */
export function toPaise(rupees: number): number {
    return Math.round(rupees * 100);
}

/**
 * Converts Paise to INR Rupees
 */
export function fromPaise(paise: number): number {
    return paise / 100;
}

/**
 * Format customer phone number per Razorpay spec (E.164 or +91 standard)
 */
export function formatPhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
    if (digits.length > 10 && !digits.startsWith('91')) return `+${digits}`;
    return digits ? `+${digits}` : undefined;
}

function getAuthHeader(cfg = config): string {
    const credentials = `${cfg.keyId}:${cfg.keySecret}`;
    if (typeof window !== 'undefined') {
        return `Basic ${btoa(credentials)}`;
    }
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

export interface RazorpayCustomer {
    name?: string;
    contact?: string;
    email?: string;
}

export interface RazorpayNotifyOptions {
    sms?: boolean;
    email?: boolean;
    whatsapp?: boolean;
}

export interface CreatePaymentLinkParams {
    /**
     * Amount to be collected.
     * If amountInRupees is true (default), amount is expected in Rupees and will be converted to paise.
     * If amountInRupees is false, amount is treated as raw currency subunits (paise).
     */
    amount: number;
    amountInRupees?: boolean;
    currency?: string; // Default: 'INR'
    accept_partial?: boolean;
    first_min_partial_amount?: number;
    description?: string; // Max 2048 chars
    reference_id?: string; // Max 40 chars
    orderId?: string; // Convenience alias for reference_id
    customer?: RazorpayCustomer;
    // Convenience customer fields
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    notify?: RazorpayNotifyOptions;
    reminder_enable?: boolean;
    expire_by?: number; // Unix timestamp in seconds (cannot exceed 6 months)
    expireByMinutes?: number; // Convenience helper to calculate expire_by
    notes?: Record<string, string>; // Max 15 key-value pairs, max 256 chars each
    callback_url?: string;
    callback_method?: 'get';
    upi_link?: boolean; // Set to true for UPI-only link
    options?: Record<string, unknown>;
}

export interface UpdatePaymentLinkParams {
    reference_id?: string;
    expire_by?: number;
    reminder_enable?: boolean;
    notes?: Record<string, string>;
    accept_partial?: boolean;
}

export interface ListPaymentLinksParams {
    from?: number;
    to?: number;
    count?: number; // Default: 10, max: 100
    skip?: number;
    payment_id?: string;
    reference_id?: string;
}

export interface PaymentLinkResponse {
    id: string;
    user_id?: string;
    short_url: string;
    status: 'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
    amount: number; // in subunits (paise)
    amount_paid: number; // in subunits (paise)
    currency: string;
    reference_id: string;
    description: string;
    customer?: RazorpayCustomer;
    notify?: RazorpayNotifyOptions;
    reminder_enable?: boolean;
    reminders?: unknown[];
    accept_partial?: boolean;
    first_min_partial_amount?: number;
    upi_link?: boolean;
    whatsapp_link?: boolean;
    notes?: Record<string, string>;
    callback_url?: string;
    callback_method?: string;
    payments?: Array<{
        id: string;
        amount: number;
        status: string;
        method?: string;
        created_at?: number;
    }> | null;
    created_at: number;
    updated_at?: number;
    cancelled_at?: number;
    expired_at?: number;
    expire_by?: number;
}

export interface ListPaymentLinksResponse {
    payment_links: PaymentLinkResponse[];
    count?: number;
}

interface CreatePaymentLinkPayload {
    amount: number;
    currency: string;
    accept_partial: boolean;
    reference_id: string;
    description: string;
    reminder_enable: boolean;
    notify: RazorpayNotifyOptions;
    notes: Record<string, string>;
    first_min_partial_amount?: number;
    expire_by?: number;
    customer?: RazorpayCustomer;
    callback_url?: string;
    callback_method?: 'get';
    upi_link?: boolean;
    options?: Record<string, unknown>;
}

/**
 * 1. Create a Standard or UPI Payment Link
 * POST /v1/payment_links
 * https://razorpay.com/docs/api/payments/payment-links/create-standard
 */
export async function createPaymentLink(
    params: CreatePaymentLinkParams,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: PaymentLinkResponse; error?: string }> {
    if (typeof window !== 'undefined') {
        try {
            const res = await fetch('/api/pos/payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(pb.authStore.token ? { 'Authorization': `Bearer ${pb.authStore.token}` } : {}),
                },
                body: JSON.stringify({ action: 'razorpay_create_link', payload: params }),
            });
            return await res.json();
        } catch (err: any) {
            return { success: false, error: err.message || 'Failed to connect to payment service' };
        }
    }

    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    if (!activeCfg.keyId || !activeCfg.keySecret) {
        return {
            success: false,
            error: 'Razorpay is not configured. Please add Key ID and Secret in Settings.',
        };
    }

    try {
        const amountInRupees = params.amountInRupees !== false;
        const amountInSubunits = amountInRupees ? toPaise(params.amount) : Math.round(params.amount);

        const refId = (params.reference_id || params.orderId || '').substring(0, 40);

        let expireBy = params.expire_by;
        if (!expireBy && params.expireByMinutes) {
            expireBy = Math.floor(Date.now() / 1000) + params.expireByMinutes * 60;
        }

        const customerObj: RazorpayCustomer = {
            ...(params.customer || {}),
        };
        if (params.customerName && !customerObj.name) customerObj.name = params.customerName;
        if (params.customerPhone && !customerObj.contact) customerObj.contact = formatPhone(params.customerPhone);
        if (params.customerEmail && !customerObj.email) customerObj.email = params.customerEmail;
        if (customerObj.contact) customerObj.contact = formatPhone(customerObj.contact);

        const payload: CreatePaymentLinkPayload = {
            amount: amountInSubunits,
            currency: params.currency || 'INR',
            accept_partial: params.accept_partial ?? false,
            reference_id: refId,
            description: params.description || (refId ? `Luminila Jewels #${refId}` : 'Luminila Jewels Order'),
            reminder_enable: params.reminder_enable ?? true,
            notify: {
                sms: params.notify?.sms ?? false,
                email: params.notify?.email ?? false,
                ...(params.notify?.whatsapp !== undefined ? { whatsapp: params.notify.whatsapp } : {}),
            },
            notes: {
                order_id: refId,
                source: 'luminila_erp',
                ...(params.notes || {}),
            },
        };

        if (params.accept_partial && params.first_min_partial_amount) {
            payload.first_min_partial_amount = params.first_min_partial_amount;
        }

        if (expireBy) {
            payload.expire_by = expireBy;
        }

        if (customerObj.name || customerObj.contact || customerObj.email) {
            payload.customer = {
                ...(customerObj.name ? { name: customerObj.name } : { name: 'Customer' }),
                ...(customerObj.contact ? { contact: customerObj.contact } : {}),
                ...(customerObj.email ? { email: customerObj.email } : {}),
            };
        }

        if (params.callback_url) {
            payload.callback_url = params.callback_url;
            payload.callback_method = params.callback_method || 'get';
        }

        if (params.upi_link) {
            payload.upi_link = true;
        }

        if (params.options) {
            payload.options = params.options;
        }

        const response = await fetch(`${RAZORPAY_API_BASE}/payment_links`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: getAuthHeader(activeCfg),
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data.error?.description || data.message || 'Failed to create payment link';
            return { success: false, error: errorMsg };
        }

        return { success: true, data };
    } catch (err) {
        console.error('Razorpay createPaymentLink error:', err);
        return { success: false, error: (err instanceof Error ? err.message : String(err)) || 'Network error connecting to Razorpay' };
    }
}

/**
 * 2. Fetch Payment Link with ID
 * GET /v1/payment_links/:id
 * https://razorpay.com/docs/api/payments/payment-links/fetch-id-standard
 */
export async function fetchPaymentLinkStatus(
    paymentLinkId: string,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: PaymentLinkResponse; error?: string }> {
    if (typeof window !== 'undefined') {
        try {
            const res = await fetch('/api/pos/payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(pb.authStore.token ? { 'Authorization': `Bearer ${pb.authStore.token}` } : {}),
                },
                body: JSON.stringify({ action: 'razorpay_fetch_status', payload: { paymentLinkId } }),
            });
            return await res.json();
        } catch (err: any) {
            return { success: false, error: err.message || 'Failed to connect to payment service' };
        }
    }

    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    if (!activeCfg.keyId || !activeCfg.keySecret) {
        return { success: false, error: 'Razorpay credentials not configured' };
    }

    try {
        const response = await fetch(`${RAZORPAY_API_BASE}/payment_links/${paymentLinkId}`, {
            method: 'GET',
            headers: {
                Authorization: getAuthHeader(activeCfg),
            },
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error?.description || 'Failed to fetch status' };
        }

        return { success: true, data };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * 3. Fetch All Payment Links
 * GET /v1/payment_links
 * https://razorpay.com/docs/api/payments/payment-links/fetch-all-standard
 */
export async function listPaymentLinks(
    params?: ListPaymentLinksParams,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: ListPaymentLinksResponse; error?: string }> {
    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    if (!activeCfg.keyId || !activeCfg.keySecret) {
        return { success: false, error: 'Razorpay credentials not configured' };
    }

    try {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', String(params.from));
        if (params?.to) query.set('to', String(params.to));
        if (params?.count) query.set('count', String(params.count));
        if (params?.skip) query.set('skip', String(params.skip));
        if (params?.payment_id) query.set('payment_id', params.payment_id);
        if (params?.reference_id) query.set('reference_id', params.reference_id);

        const qs = query.toString() ? `?${query.toString()}` : '';
        const response = await fetch(`${RAZORPAY_API_BASE}/payment_links${qs}`, {
            method: 'GET',
            headers: {
                Authorization: getAuthHeader(activeCfg),
            },
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error?.description || 'Failed to list payment links' };
        }

        return { success: true, data };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * 4. Update a Standard Payment Link
 * PATCH /v1/payment_links/:id
 * https://razorpay.com/docs/api/payments/payment-links/update-standard
 */
export async function updatePaymentLink(
    paymentLinkId: string,
    params: UpdatePaymentLinkParams,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: PaymentLinkResponse; error?: string }> {
    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    if (!activeCfg.keyId || !activeCfg.keySecret) {
        return { success: false, error: 'Razorpay credentials not configured' };
    }

    try {
        const payload: UpdatePaymentLinkParams = {};
        if (params.reference_id !== undefined) payload.reference_id = params.reference_id;
        if (params.expire_by !== undefined) payload.expire_by = params.expire_by;
        if (params.reminder_enable !== undefined) payload.reminder_enable = params.reminder_enable;
        if (params.notes !== undefined) payload.notes = params.notes;
        if (params.accept_partial !== undefined) payload.accept_partial = params.accept_partial;

        const response = await fetch(`${RAZORPAY_API_BASE}/payment_links/${paymentLinkId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: getAuthHeader(activeCfg),
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error?.description || 'Failed to update link' };
        }

        return { success: true, data };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * 5. Cancel an open Payment Link
 * POST /v1/payment_links/:id/cancel
 * https://razorpay.com/docs/api/payments/payment-links/cancel-standard
 */
export async function cancelPaymentLink(
    paymentLinkId: string,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: PaymentLinkResponse; error?: string }> {
    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    if (!activeCfg.keyId || !activeCfg.keySecret) {
        return { success: false, error: 'Razorpay credentials not configured' };
    }

    try {
        const response = await fetch(`${RAZORPAY_API_BASE}/payment_links/${paymentLinkId}/cancel`, {
            method: 'POST',
            headers: {
                Authorization: getAuthHeader(activeCfg),
            },
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error?.description || 'Failed to cancel link' };
        }

        return { success: true, data };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * 6. Send or Resend Notification
 * POST /v1/payment_links/:id/notify_by/:medium
 * https://razorpay.com/docs/api/payments/payment-links/resend
 */
export async function resendPaymentLinkNotification(
    paymentLinkId: string,
    medium: 'sms' | 'email',
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: { success: boolean }; error?: string }> {
    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    if (!activeCfg.keyId || !activeCfg.keySecret) {
        return { success: false, error: 'Razorpay credentials not configured' };
    }

    try {
        const response = await fetch(`${RAZORPAY_API_BASE}/payment_links/${paymentLinkId}/notify_by/${medium}`, {
            method: 'POST',
            headers: {
                Authorization: getAuthHeader(activeCfg),
            },
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error?.description || 'Failed to resend notification' };
        }

        return { success: true, data };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * 7. Verify Payment Link Signature (Server-Side)
 * Strict implementation of Razorpay Payment Link HMAC-SHA256 signature verification:
 * https://razorpay.com/docs/payments/payment-links/apis#verify-signature
 *
 * Payload: payment_link_id + '|' + (payment_link_reference_id || '') + '|' + payment_link_status + '|' + payment_id
 */
export function verifyPaymentLinkSignature(
    params: {
        payment_link_id: string;
        payment_id: string;
        payment_link_reference_id?: string;
        payment_link_status: string;
    },
    signature: string,
    keySecret?: string
): boolean {
    const secret = keySecret || config.keySecret;
    if (!secret || !signature) return false;

    try {
        const refId = params.payment_link_reference_id || '';
        const payload = `${params.payment_link_id}|${refId}|${params.payment_link_status}|${params.payment_id}`;

        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const receivedBuffer = Buffer.from(signature, 'utf8');

        if (expectedBuffer.length !== receivedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch (err) {
        console.error('Signature verification error:', err);
        return false;
    }
}

/**
 * 8. Verify Webhook Event Signature (Server-Side)
 * HMAC-SHA256 calculation over raw request body using webhookSecret.
 */
export function verifyWebhookSignature(
    rawBody: string,
    signature: string,
    webhookSecret?: string
): boolean {
    const secret = webhookSecret || config.webhookSecret;
    if (!secret || !signature) return false;

    try {
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');

        const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
        const receivedBuffer = Buffer.from(signature, 'utf8');

        if (expectedBuffer.length !== receivedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch (err) {
        console.error('Webhook signature verification error:', err);
        return false;
    }
}
