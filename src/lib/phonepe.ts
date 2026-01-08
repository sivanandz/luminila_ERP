/**
 * PhonePe Payment Gateway Integration
 * 
 * Implements PhonePe PG API v1 for payment processing
 * @see https://developer.phonepe.com/payment-gateway
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

interface PhonePeConfig {
    merchantId: string;
    saltKey: string;
    saltIndex: string;
    isProduction: boolean;
}

// Default to environment variables, can be overridden by settings
// Default to environment variables
let config: PhonePeConfig = {
    merchantId: process.env.NEXT_PUBLIC_PHONEPE_MERCHANT_ID || process.env.PHONEPE_MERCHANT_ID || '',
    saltKey: process.env.NEXT_PUBLIC_PHONEPE_SALT_KEY || process.env.PHONEPE_SALT_KEY || '',
    saltIndex: process.env.NEXT_PUBLIC_PHONEPE_SALT_INDEX || process.env.PHONEPE_SALT_INDEX || '1',
    isProduction: process.env.NEXT_PUBLIC_PHONEPE_ENV === 'production' || process.env.PHONEPE_ENV === 'production',
};

// Internal: Load config from localStorage if available (Runtime override)
function loadConfigFromStorage() {
    if (typeof window === 'undefined') return;
    try {
        const saved = localStorage.getItem("luminila_settings");
        if (saved) {
            const parsed = JSON.parse(saved);
            // Only override if settings exist in storage
            if (parsed.phonepeMerchantId) {
                config.merchantId = parsed.phonepeMerchantId;
                config.saltKey = parsed.phonepeSaltKey || config.saltKey;
                config.saltIndex = parsed.phonepeSaltIndex || config.saltIndex;
                config.isProduction = parsed.phonepeEnv === 'PROD';
            }
        }
    } catch (e) {
        console.error("Failed to load PhonePe config from storage", e);
    }
}

// API Endpoints
const ENDPOINTS = {
    UAT: {
        base: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
        pay: '/pg/v1/pay',
        status: '/pg/v1/status',
    },
    PRODUCTION: {
        base: 'https://api.phonepe.com/apis/hermes',
        pay: '/pg/v1/pay',
        status: '/pg/v1/status',
    },
};

function getEndpoints() {
    loadConfigFromStorage(); // Ensure config is up-to-date
    return config.isProduction ? ENDPOINTS.PRODUCTION : ENDPOINTS.UAT;
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

export function setPhonePeConfig(newConfig: Partial<PhonePeConfig>) {
    config = { ...config, ...newConfig };
}

export function getPhonePeConfig(): Omit<PhonePeConfig, 'saltKey'> & { saltKey: string } {
    loadConfigFromStorage();
    return {
        ...config,
        saltKey: config.saltKey ? '****' + config.saltKey.slice(-4) : '',
    };
}

export function isPhonePeConfigured(): boolean {
    loadConfigFromStorage();
    return !!(config.merchantId && config.saltKey && config.saltIndex);
}

// ============================================================================
// CHECKSUM GENERATION (X-VERIFY)
// ============================================================================

/**
 * Helper to compute SHA-256 hash using Web Crypto API
 */
async function sha256(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate X-VERIFY header for PhonePe API authentication
 * 
 * Formula: SHA256(Base64(payload) + endpoint + saltKey) + "###" + saltIndex
 */
export async function generateChecksum(
    base64Payload: string,
    endpoint: string,
    saltKey: string = config.saltKey,
    saltIndex: string = config.saltIndex
): Promise<string> {
    const stringToHash = base64Payload + endpoint + saltKey;
    const hash = await sha256(stringToHash);
    return `${hash}###${saltIndex}`;
}

/**
 * Generate X-VERIFY for status check API
 * 
 * Formula: SHA256(endpoint + saltKey) + "###" + saltIndex
 */
export async function generateStatusChecksum(
    merchantId: string,
    merchantTransactionId: string,
    saltKey: string = config.saltKey,
    saltIndex: string = config.saltIndex
): Promise<string> {
    const endpoint = `/pg/v1/status/${merchantId}/${merchantTransactionId}`;
    const stringToHash = endpoint + saltKey;
    const hash = await sha256(stringToHash);
    return `${hash}###${saltIndex}`;
}

// ============================================================================
// PAYMENT TYPES
// ============================================================================

export interface PaymentRequest {
    orderId: string;          // Unique order/transaction ID from your system
    amount: number;           // Amount in PAISE (e.g., 10000 = ₹100)
    customerPhone?: string;   // Optional customer phone number
    redirectUrl: string;      // URL to redirect after payment
    callbackUrl?: string;     // Server callback URL for payment status
}

export interface PaymentResponse {
    success: boolean;
    transactionId: string;
    redirectUrl?: string;
    error?: string;
    code?: string;
}

export interface PaymentStatusResponse {
    success: boolean;
    code: string;
    message: string;
    transactionId?: string;
    merchantTransactionId?: string;
    amount?: number;
    paymentInstrument?: {
        type: string;
        utr?: string;
        cardType?: string;
    };
}

// ============================================================================
// PAYMENT INITIATION
// ============================================================================

/**
 * Initiate a PhonePe payment
 * 
 * @returns Payment response with redirect URL
 */
export async function initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    if (!isPhonePeConfigured()) {
        return {
            success: false,
            transactionId: '',
            error: 'PhonePe is not configured. Please add credentials in Settings.',
        };
    }

    const endpoints = getEndpoints();
    const merchantTransactionId = `LMLA_${request.orderId}_${Date.now()}`;

    // Build PayPage request payload
    const payload = {
        merchantId: config.merchantId,
        merchantTransactionId,
        merchantUserId: `MUID_${request.orderId}`,
        amount: request.amount,
        redirectUrl: request.redirectUrl,
        redirectMode: 'REDIRECT',
        callbackUrl: request.callbackUrl || request.redirectUrl,
        mobileNumber: request.customerPhone || undefined,
        paymentInstrument: {
            type: 'PAY_PAGE',
        },
    };

    // Base64 encode payload
    // Use Web API btoa (or Buffer if polyfilled, but manual is safer for browser)
    const jsonPayload = JSON.stringify(payload);
    // Handle potential unicode strings safely
    const base64Payload = typeof window !== 'undefined'
        ? window.btoa(unescape(encodeURIComponent(jsonPayload)))
        : Buffer.from(jsonPayload).toString('base64');

    // Generate X-VERIFY checksum
    const xVerify = await generateChecksum(base64Payload, endpoints.pay);

    try {
        const response = await fetch(`${endpoints.base}${endpoints.pay}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': xVerify,
            },
            body: JSON.stringify({
                request: base64Payload,
            }),
        });

        const data = await response.json();

        if (data.success && data.code === 'PAYMENT_INITIATED') {
            return {
                success: true,
                transactionId: merchantTransactionId,
                redirectUrl: data.data?.instrumentResponse?.redirectInfo?.url,
            };
        }

        return {
            success: false,
            transactionId: merchantTransactionId,
            error: data.message || 'Payment initiation failed',
            code: data.code,
        };
    } catch (error) {
        console.error('PhonePe payment initiation error:', error);
        return {
            success: false,
            transactionId: merchantTransactionId,
            error: error instanceof Error ? error.message : 'Network error',
        };
    }
}

// ============================================================================
// PAYMENT STATUS CHECK
// ============================================================================

/**
 * Check payment status from PhonePe
 */
export async function checkPaymentStatus(
    merchantTransactionId: string
): Promise<PaymentStatusResponse> {
    if (!isPhonePeConfigured()) {
        return {
            success: false,
            code: 'NOT_CONFIGURED',
            message: 'PhonePe is not configured',
        };
    }

    const endpoints = getEndpoints();
    const statusEndpoint = `${endpoints.status}/${config.merchantId}/${merchantTransactionId}`;
    const xVerify = await generateStatusChecksum(config.merchantId, merchantTransactionId);

    try {
        const response = await fetch(`${endpoints.base}${statusEndpoint}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': xVerify,
                'X-MERCHANT-ID': config.merchantId,
            },
        });

        const data = await response.json();

        if (data.success) {
            return {
                success: true,
                code: data.code,
                message: data.message,
                transactionId: data.data?.transactionId,
                merchantTransactionId: data.data?.merchantTransactionId,
                amount: data.data?.amount,
                paymentInstrument: data.data?.paymentInstrument,
            };
        }

        return {
            success: false,
            code: data.code || 'UNKNOWN',
            message: data.message || 'Status check failed',
        };
    } catch (error) {
        console.error('PhonePe status check error:', error);
        return {
            success: false,
            code: 'NETWORK_ERROR',
            message: error instanceof Error ? error.message : 'Network error',
        };
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert amount in rupees to paise
 */
export function toPaise(rupees: number): number {
    return Math.round(rupees * 100);
}

/**
 * Convert amount in paise to rupees
 */
export function toRupees(paise: number): number {
    return paise / 100;
}

/**
 * Generate a unique order ID for transactions
 */
export function generateOrderId(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD_${timestamp}_${random}`;
}
