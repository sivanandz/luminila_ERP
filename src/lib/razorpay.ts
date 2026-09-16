/**
 * Razorpay Payment Gateway Integration
 * Handles Payment Links generation, status verification, and webhook reconciliation
 * for Luminila WhatsApp & ERP transactions.
 */

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

// Client-side initialization from localStorage if available
if (typeof window !== 'undefined') {
    try {
        const stored = localStorage.getItem('luminila_store_settings');
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

export function setRazorpayConfig(newConfig: Partial<RazorpayConfig>) {
    config = { ...config, ...newConfig };
}

export function getRazorpayConfig(): RazorpayConfig {
    return { ...config };
}

export function isRazorpayConfigured(): boolean {
    return Boolean(config.keyId && config.keySecret);
}

export interface CreatePaymentLinkParams {
    orderId: string;
    amount: number; // in Rupees
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    description?: string;
    expireByMinutes?: number;
}

export interface PaymentLinkResponse {
    id: string;
    short_url: string;
    status: 'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
    amount: number;
    amount_paid: number;
    reference_id: string;
    description: string;
    customer?: {
        name?: string;
        contact?: string;
        email?: string;
    };
    created_at: number;
}

/**
 * Converts INR Rupees to Paise (integer)
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

function getAuthHeader(cfg = config): string {
    const credentials = `${cfg.keyId}:${cfg.keySecret}`;
    if (typeof window !== 'undefined') {
        return `Basic ${btoa(credentials)}`;
    }
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

/**
 * Format phone for Razorpay (+91 or 10 digits)
 */
function formatPhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;
    return digits;
}

/**
 * Create a Razorpay Payment Link
 */
export async function createPaymentLink(
    params: CreatePaymentLinkParams,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: PaymentLinkResponse; error?: string }> {
    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    if (!activeCfg.keyId || !activeCfg.keySecret) {
        return {
            success: false,
            error: 'Razorpay is not configured. Please add Key ID and Secret in Settings.',
        };
    }

    try {
        const amountInPaise = toPaise(params.amount);
        const expireBy = params.expireByMinutes
            ? Math.floor(Date.now() / 1000) + params.expireByMinutes * 60
            : undefined;

        const payload: Record<string, any> = {
            amount: amountInPaise,
            currency: 'INR',
            accept_partial: false,
            reference_id: params.orderId,
            description: params.description || `Luminila Jewels Order #${params.orderId}`,
            notify: {
                sms: false,
                email: false,
            },
            reminder_enable: true,
            notes: {
                order_id: params.orderId,
                source: 'luminila_whatsapp',
            },
        };

        if (expireBy) {
            payload.expire_by = expireBy;
        }

        if (params.customerName || params.customerPhone || params.customerEmail) {
            payload.customer = {
                name: params.customerName || 'Valued Customer',
                contact: formatPhone(params.customerPhone),
                email: params.customerEmail || undefined,
            };
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
    } catch (err: any) {
        console.error('Razorpay createPaymentLink error:', err);
        return { success: false, error: err.message || 'Network error connecting to Razorpay' };
    }
}

/**
 * Fetch Payment Link status from Razorpay
 */
export async function fetchPaymentLinkStatus(
    paymentLinkId: string,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; data?: PaymentLinkResponse; error?: string }> {
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
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/**
 * Cancel an open Payment Link
 */
export async function cancelPaymentLink(
    paymentLinkId: string,
    customConfig?: Partial<RazorpayConfig>
): Promise<{ success: boolean; error?: string }> {
    const activeCfg = customConfig ? { ...config, ...customConfig } : config;

    try {
        const response = await fetch(`${RAZORPAY_API_BASE}/payment_links/${paymentLinkId}/cancel`, {
            method: 'POST',
            headers: {
                Authorization: getAuthHeader(activeCfg),
            },
        });

        if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error?.description || 'Failed to cancel link' };
        }

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}
