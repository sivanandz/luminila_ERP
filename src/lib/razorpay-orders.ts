/**
 * Server-side Razorpay order lifecycle (CO-05).
 *
 * The storefront used to charge the customer first and create the order
 * afterwards, with no local order reference attached to the payment. A
 * `payment.captured` webhook therefore had nothing to map back to, and a failed
 * order write left the customer paid with no order.
 *
 * The two-phase flow is:
 *   1. the ERP order is created (draft) and this module creates a Razorpay
 *      order whose `notes.order_id` is the ERP order id;
 *   2. the checkout opens Razorpay against that order id;
 *   3. the storefront confirm endpoint (or the webhook) verifies the payment
 *      signature/status and settles the same order exactly once.
 *
 * Server-only: it reads the API secret and must never be imported into a client
 * component.
 */

import crypto from 'crypto';
import { getRazorpayConfig } from './razorpay';

const API_BASE = 'https://api.razorpay.com/v1';

export interface GatewayOrderResult {
    configured: boolean;
    orderId?: string;
    amountPaise?: number;
    currency?: string;
    keyId?: string;
    error?: string;
}

export interface GatewayPaymentResult {
    orderId?: string;
    amountPaise?: number;
    status?: string;
    notes?: Record<string, string>;
    error?: string;
}

export function gatewayConfigured(): boolean {
    const cfg = getRazorpayConfig();
    return Boolean(cfg.keyId && cfg.keySecret);
}

function authHeader(): string {
    const cfg = getRazorpayConfig();
    return `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
}

/** Create the Razorpay order that carries the local order reference. */
export async function createGatewayOrder(params: {
    amountRupees: number;
    receipt: string;
    notes: Record<string, string>;
}): Promise<GatewayOrderResult> {
    const cfg = getRazorpayConfig();
    if (!cfg.keyId || !cfg.keySecret) {
        return { configured: false, error: 'Razorpay API keys are not configured' };
    }

    const amountPaise = Math.round(Number(params.amountRupees) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
        return { configured: true, error: 'Invalid gateway amount' };
    }

    try {
        const res = await fetch(`${API_BASE}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
            body: JSON.stringify({
                amount: amountPaise,
                currency: 'INR',
                receipt: String(params.receipt || '').slice(0, 40),
                notes: params.notes,
            }),
        });
        const data = (await res.json().catch(() => null)) as {
            id?: string;
            amount?: number;
            currency?: string;
            error?: { description?: string };
        } | null;
        if (!res.ok || !data?.id) {
            return {
                configured: true,
                error: data?.error?.description || `Razorpay order creation failed (${res.status})`,
            };
        }
        return {
            configured: true,
            orderId: data.id,
            amountPaise: Number(data.amount),
            currency: data.currency || 'INR',
            keyId: cfg.keyId,
        };
    } catch (err) {
        return {
            configured: true,
            error: err instanceof Error ? err.message : 'Network error creating the Razorpay order',
        };
    }
}

/** Verify the checkout `handler` signature: HMAC-SHA256("<order_id>|<payment_id>", key_secret). */
export function verifyGatewaySignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
}): boolean {
    const cfg = getRazorpayConfig();
    if (!cfg.keySecret || !params.orderId || !params.paymentId || !params.signature) return false;
    const expected = crypto
        .createHmac('sha256', cfg.keySecret)
        .update(`${params.orderId}|${params.paymentId}`)
        .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(params.signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/** Server-side payment lookup for the confirm endpoint (webhook fallback). */
export async function fetchGatewayPayment(paymentId: string): Promise<GatewayPaymentResult> {
    const cfg = getRazorpayConfig();
    if (!cfg.keyId || !cfg.keySecret) {
        return { error: 'Razorpay API keys are not configured' };
    }
    try {
        const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
            headers: { Authorization: authHeader() },
        });
        const data = (await res.json().catch(() => null)) as {
            order_id?: string;
            amount?: number;
            status?: string;
            notes?: Record<string, string>;
            error?: { description?: string };
        } | null;
        if (!res.ok) {
            return { error: data?.error?.description || `Razorpay payment lookup failed (${res.status})` };
        }
        return {
            orderId: data?.order_id,
            amountPaise: Number(data?.amount),
            status: data?.status,
            notes: data?.notes,
        };
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Network error looking up the payment' };
    }
}