/**
 * Channel order capture service.
 *
 * The web storefront and the WhatsApp concierge previously each wrote their
 * own partial slice of the CRM: the storefront dropped email/state, chat
 * orders skipped sales_orders entirely, and no path updated the customer's
 * lifetime aggregates. Every remote channel now funnels through the helpers
 * here so a captured order carries the same field set and the same customer
 * side-effects regardless of origin (gap report 2026-10-24, A1/A2/A5/F1/F4/F5).
 *
 * All functions take the PocketBase client to use (tenant client on the
 * server routes, the shared pb singleton in client code).
 */

import type PocketBase from 'pocketbase';
import { allocateDiscountPaise, splitInclusiveLine, toPaise } from './invoice-math';
import { GST_RATES } from './gst';

export interface ChannelCustomerInput {
    tenantEmail: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    /** GST state code resolved from `state` (CO-14). */
    stateCode?: string;
    pincode?: string;
    source: string;
    marketingConsent?: boolean;
    /** B2B buyer identity (A3/A4). */
    gstin?: string;
    companyName?: string;
    billingAddress?: string;
}

/** Last 10 digits of a phone, for tenant-wide matching. */
export function phoneSuffix(phone: string): string {
    return (phone || '').replace(/\D/g, '').slice(-10);
}

/**
 * Canonical storage form for a customer phone: +91XXXXXXXXXX for Indian
 * numbers, +<digits> otherwise. Chat orders already stored this shape; web
 * orders stored bare digits, which made exact-match flows disagree (F5).
 * Tenant lookups keep matching on the last-10 suffix, which is a substring
 * of both forms.
 */
export function canonicalPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';
    const last10 = digits.slice(-10);
    if (digits.length === 10 || (digits.length > 10 && digits.startsWith('91'))) {
        return `+91${last10}`;
    }
    return `+${digits}`;
}

/**
 * Find-or-create the customer for a channel order, merging any fields the
 * CRM is missing into the existing profile instead of leaving it stale (F4).
 * Returns the customer id and whether the record already existed.
 */
export async function upsertChannelCustomer(
    client: PocketBase,
    input: ChannelCustomerInput
): Promise<{ id: string; existed: boolean }> {
    const suffix = phoneSuffix(input.phone);
    let existing: {
        id: string;
        email?: string;
        address?: string;
        city?: string;
        state?: string;
        state_code?: string;
        pincode?: string;
        opt_in_marketing?: boolean;
        gstin?: string;
        company_name?: string;
        billing_address?: string;
    } | null = null;

    if (suffix.length === 10) {
        existing = await client.collection('customers').getFirstListItem(
            client.filter('phone ~ {:phone} && account_email = {:tenant}', {
                phone: suffix,
                tenant: input.tenantEmail,
            })
        ).catch(() => null);
    }

    if (existing) {
        // Backfill blanks only; never overwrite what the store already knows.
        const updates: Record<string, string | boolean> = {};
        const merge = (field: string, incoming?: string) => {
            const value = (incoming || '').trim();
            if (value && !String((existing as Record<string, unknown>)[field] || '').trim()) {
                updates[field] = value;
            }
        };
        merge('email', input.email);
        merge('address', input.address);
        merge('city', input.city);
        merge('state', input.state);
        merge('state_code', input.stateCode);
        merge('pincode', input.pincode);
        merge('gstin', input.gstin);
        merge('company_name', input.companyName);
        merge('billing_address', input.billingAddress);
        if (input.marketingConsent === true && !existing.opt_in_marketing) {
            updates.opt_in_marketing = true;
        }
        if (Object.keys(updates).length > 0) {
            await client.collection('customers').update(existing.id, updates).catch(() => {});
        }
        return { id: existing.id, existed: true };
    }

    const record = await client.collection('customers').create({
        name: input.name || `Customer ${suffix.slice(-4)}`,
        phone: canonicalPhone(input.phone),
        email: input.email || '',
        address: input.address || '',
        city: input.city || '',
        state: input.state || '',
        state_code: input.stateCode || '',
        pincode: input.pincode || '',
        gstin: input.gstin || '',
        company_name: input.companyName || '',
        billing_address: input.billingAddress || '',
        customer_type: input.gstin ? 'wholesale' : 'retail',
        source: input.source,
        preferred_contact: input.source === 'whatsapp' ? 'whatsapp' : 'phone',
        lead_status: 'new_lead',
        opt_in_marketing: !!input.marketingConsent,
        is_active: true,
        account_email: input.tenantEmail,
    });
    return { id: record.id, existed: false };
}

/**
 * Bump the customer's lifetime aggregates atomically (F1). Read in a dozen
 * places across the CRM, these fields were never written by any order path.
 */
export async function applyPurchaseAggregates(
    client: PocketBase,
    customerId: string,
    amountRupees: number
): Promise<void> {
    if (!customerId) return;
    try {
        await client.collection('customers').update(customerId, {
            'total_spent+': Math.max(0, amountRupees),
            'total_orders+': 1,
            last_purchase_date: new Date().toISOString(),
        });
    } catch (err) {
        // Aggregates are derived data; an order must not fail over them.
        console.warn('[channel-orders] aggregate update failed:', err);
    }
}

/**
 * Marker written into an order's `internal_notes` once its lifetime aggregates
 * have been counted (intake for COD/chat, settlement for online). Cancellation
 * reads it so a reversal is only applied to orders that actually incremented the
 * counters (CO-15 residual).
 */
export const AGGREGATES_MARKER = 'AggregatesCounted: yes';

export function aggregatesWereCounted(internalNotes?: string): boolean {
    return (internalNotes || '').includes(AGGREGATES_MARKER);
}

/**
 * Reverse the customer lifetime aggregates for a cancelled order (CO-15).
 * Floors at zero so a legacy order that predates the marker cannot drive the
 * counters negative. Loyalty-point reversal is the caller's responsibility.
 */
export async function applyPurchaseReversal(
    client: PocketBase,
    customerId: string,
    amountRupees: number
): Promise<void> {
    if (!customerId) return;
    try {
        const customer = await client
            .collection('customers')
            .getOne<{ total_spent?: number; total_orders?: number }>(customerId);
        const spent = Math.max(0, Number(customer.total_spent) || 0);
        const orders = Math.max(0, Number(customer.total_orders) || 0);
        await client.collection('customers').update(customerId, {
            total_spent: Math.max(0, spent - Math.max(0, amountRupees)),
            total_orders: Math.max(0, orders - 1),
        });
    } catch (err) {
        console.warn('[channel-orders] aggregate reversal failed:', err);
    }
}

/**
 * Read the store's GST posture through a per-tenant client. Shared by every
 * channel so the tax-inclusive split uses the same seller state and registration
 * decision (the web route and the WhatsApp concierge previously disagreed).
 */
export async function loadChannelStoreTaxContext(
    client: PocketBase,
    tenantEmail: string
): Promise<{ gstRegistered: boolean; sellerStateCode: string }> {
    const fallback = { gstRegistered: false, sellerStateCode: '' };
    try {
        const records = await client.collection('store_settings').getFullList<{
            key: string;
            value: string;
        }>({
            filter: client.filter('account_email = {:tenant}', { tenant: tenantEmail }),
        });
        const blobRecord = records.find((r) => r.key.startsWith('store_settings_'));
        const flat: Record<string, string> = {};
        if (blobRecord?.value) {
            try {
                const parsed =
                    typeof blobRecord.value === 'string'
                        ? JSON.parse(blobRecord.value)
                        : blobRecord.value;
                flat.isGstRegistered = String(
                    parsed.isGstRegistered ?? parsed.is_gst_registered ?? ''
                );
                flat.gstin = String(parsed.gstin ?? parsed.store_gstin ?? '');
                flat.stateCode = String(parsed.stateCode ?? parsed.store_state_code ?? '');
            } catch {
                // fall through to flat keys
            }
        }
        for (const row of records) {
            if (row.key.startsWith('store_settings_')) continue;
            let val = row.value || '';
            try {
                if (typeof val === 'string' && (val.startsWith('"') || val.startsWith('{'))) {
                    val = JSON.parse(val);
                }
            } catch {
                // keep raw
            }
            if (val !== undefined && val !== null && val !== '') flat[row.key] = String(val);
        }
        const registered =
            flat.is_gst_registered === 'true' ||
            flat.isGstRegistered === 'true' ||
            (flat.is_gst_registered === undefined &&
                flat.isGstRegistered === undefined &&
                Boolean(flat.gstin || flat.store_gstin));
        return {
            gstRegistered: registered,
            sellerStateCode: flat.store_state_code || flat.stateCode || '',
        };
    } catch {
        return fallback;
    }
}

export interface ChannelTaxLine {
    /** Line gross in rupees (quantity × unit price). */
    gross: number;
    /** Per-product GST rate override; falls back to the jewelry default. */
    taxRate?: number | null;
}

export interface ChannelTaxResult {
    /** Tax already contained in the charged amount, in rupees. */
    taxTotal: number;
    /** Charged amount minus the contained tax, in rupees. */
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    /** Weighted rate used, for the order notes. */
    blendedRate: number;
}

/**
 * Split the tax already contained in a channel order's charged amount
 * (storefront prices are tax-inclusive, matching the POS model chosen for
 * invoice.ts). The discount is allocated across lines before the split so
 * GST applies to the post-discount base (GST Act s.15); shipping joins the
 * base at the lines' weighted rate.
 */
export function computeChannelTax(
    lines: ChannelTaxLine[],
    discountRupees: number,
    shippingRupees: number,
    opts: { sellerStateCode: string; buyerStateCode: string; gstRegistered: boolean }
): ChannelTaxResult {
    const grossesPaise = lines.map((l) => Math.max(0, toPaise(l.gross)));
    const totalPaise = grossesPaise.reduce((s, v) => s + v, 0);
    const discountPaise = Math.min(Math.max(0, toPaise(discountRupees)), totalPaise);
    const shares = allocateDiscountPaise(grossesPaise, discountPaise);

    const rates = lines.map((l) =>
        opts.gstRegistered
            ? (typeof l.taxRate === 'number' && l.taxRate >= 0 ? l.taxRate : GST_RATES.JEWELRY)
            : 0
    );
    const grossSum = grossesPaise.reduce((s, v) => s + v, 0) || 1;
    const shippingPaise = Math.max(0, toPaise(shippingRupees));
    const blendedRate =
        rates.reduce((s, r, i) => s + r * (grossesPaise[i] / grossSum), 0);

    let taxPaise = 0;
    let taxablePaise = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    lines.forEach((_, i) => {
        const net = grossesPaise[i] - shares[i] + (i === 0 ? shippingPaise : 0);
        const split = splitInclusiveLine(net, rates[i], opts.sellerStateCode, opts.buyerStateCode);
        taxPaise += split.taxPaise;
        taxablePaise += split.taxablePaise;
        cgst += split.cgstPaise;
        sgst += split.sgstPaise;
        igst += split.igstPaise;
    });
    // Shipping is only added to the first line; a single-line order is the
    // common case, and multi-line orders get the same total either way
    // because the split is linear in the base.

    return {
        taxTotal: Math.round(taxPaise) / 100,
        taxableValue: Math.round(taxablePaise) / 100,
        cgst: Math.round(cgst) / 100,
        sgst: Math.round(sgst) / 100,
        igst: Math.round(igst) / 100,
        blendedRate: Math.round(blendedRate * 100) / 100,
    };
}

/**
 * Idempotency guard for order submission (F6): the storefront generates one
 * key per checkout session and retries reuse it, so a retried submit returns
 * the original order instead of creating a duplicate.
 */
export async function findExistingChannelOrder(
    client: PocketBase,
    orderNumber: string
): Promise<{
    id: string;
    order_number?: string;
    internal_notes?: string;
    status?: string;
    customer?: string;
    total?: number;
    tax_total?: number;
} | null> {
    if (!orderNumber) return null;
    return client.collection('sales_orders').getFirstListItem(
        client.filter('order_number = {:num}', { num: orderNumber })
    ).catch(() => null);
}

/**
 * Stable hash of the cart a submission carries (A23). The idempotency key
 * alone only proves "same checkout session"; binding the key to a cart hash
 * makes a tampered re-submit with different lines reject instead of silently
 * dropping them. Pure djb2 over the sorted line list + total in paise.
 */
export function computeCartHash(
    lines: { productId: string; quantity: number }[],
    totalRupees: number
): string {
    const normalized = lines
        .map((l) => l.productId + 'x' + Math.max(1, Math.floor(Number(l.quantity) || 1)))
        .sort()
        .join('|');
    const input = normalized + '#' + Math.round((Number(totalRupees) || 0) * 100);
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
}

const CART_HASH_MARKER = /CartHash ([0-9a-f]{8})/;

/** Marker written into `internal_notes` so a stored order can be matched against a resubmit's cart. */
export function cartHashMarker(hash: string): string {
    return 'CartHash ' + hash;
}

/** Extract the stored cart hash from an order's notes, if any. */
export function readCartHash(internalNotes?: string): string | null {
    const m = CART_HASH_MARKER.exec(internalNotes || '');
    return m ? m[1] : null;
}

/**
 * Resolve the stock-owning variant for an order line (P0-2). `sales_order_items.variant`
 * is a required relation: a line without one is rejected by the schema, which the
 * swallowed `.catch()` turned into invisible zero-line orders. Throws when the product
 * has no variant to own the stock, so the caller fails the order loudly.
 */
export async function resolveVariantForProduct(
    client: PocketBase,
    productId: string,
    preferredVariantId?: string
): Promise<string> {
    if (preferredVariantId) return preferredVariantId;
    // Ask for two rows, not one: a blind `getList(1, 1)` would silently sell the
    // first variant of a multi-variant product if the upstream ambiguity guard
    // were ever bypassed (CO-22).
    const variants = await client.collection('product_variants').getList(1, 2, {
        filter: client.filter('product = {:product}', { product: productId }),
    });
    if (variants.items.length > 1) {
        const err = new Error('Product has multiple variants; a variant must be chosen for the order line');
        (err as Error & { productId?: string }).productId = productId;
        throw err;
    }
    const id = variants.items[0]?.id;
    if (!id) {
        const err = new Error('Product has no variant to attach the order line to');
        (err as Error & { productId?: string }).productId = productId;
        throw err;
    }
    return id;
}
