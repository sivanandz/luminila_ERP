/**
 * Boot-time configuration check for the remote capture channels (CO-13).
 *
 * The storefront/WhatsApp paths fail closed when their secrets are missing, but
 * they used to fail *silently at request time*: the order route 401'd every
 * submit and `createTenantClient` fell back to an unauthenticated client whose
 * writes were swallowed as "offline". This hook makes the missing configuration
 * visible once, at boot, without crashing the desktop/offline mode.
 */

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const missing: string[] = [];
    if (!process.env.CUSTOMER_SESSION_SECRET && !process.env.JWT_SECRET) {
        missing.push('CUSTOMER_SESSION_SECRET (storefront OTP/session signing)');
    }
    if (!process.env.POCKETBASE_SUPERUSER_EMAIL && !process.env.PB_ADMIN_EMAIL) {
        missing.push('POCKETBASE_SUPERUSER_EMAIL (tenant client auth)');
    }
    if (!process.env.POCKETBASE_SUPERUSER_PASSWORD && !process.env.PB_ADMIN_PASSWORD) {
        missing.push('POCKETBASE_SUPERUSER_PASSWORD (tenant client auth)');
    }
    if (missing.length > 0) {
        console.error(
            `[capture-config] Missing required environment: ${missing.join('; ')}. ` +
                'The storefront order route will fail closed until these are set.'
        );
    }

    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        console.warn(
            '[capture-config] RAZORPAY_WEBHOOK_SECRET is not set — online payments cannot settle via webhook. ' +
                'Use the storefront confirm endpoint or reconcile manually.'
        );
    }
    if (!process.env.RAZORPAY_KEY_ID && !process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
        console.warn(
            '[capture-config] Razorpay API keys are not set — storefront online payment is unavailable. ' +
                'COD and WhatsApp concierge still work.'
        );
    }
}