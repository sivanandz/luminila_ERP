import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createTenantClient, sanitizeFilter } from "@/lib/pocketbase";
import { resolveOrderTenant } from "@/lib/storefront";
import { verifyCustomerToken } from "@/lib/customer-token";
import { extractBearer } from "@/lib/api-auth";
import {
    upsertChannelCustomer,
    applyPurchaseAggregates,
    computeChannelTax,
    findExistingChannelOrder,
    resolveVariantForProduct,
    loadChannelStoreTaxContext,
    AGGREGATES_MARKER,
    type ChannelTaxLine,
} from "@/lib/channel-orders";
import {
    applyChannelStock,
    assertStockAvailable,
    InsufficientStockError,
    VariantMismatchError,
    VariantRequiredError,
    toStockDb,
} from "@/lib/channel-stock";
import { calculatePointsToEarn, earnPoints } from "@/lib/loyalty";
import { getStateCode, validateGSTIN } from "@/lib/gst";
import { getChannelPriceFromList } from "@/lib/pricing-rules";
import { loadTenantChannelDefinitions } from "@/lib/server-pricing";
import { resolveCampaign } from "@/lib/campaigns";
import { recordConsentEvents } from "@/lib/consent-ledger";
import { getRazorpayConfig } from "@/lib/razorpay";
import {
    gatewayConfigured,
    createGatewayOrder,
    verifyGatewaySignature,
    fetchGatewayPayment,
} from "@/lib/razorpay-orders";
import { settleCapturedOrder } from "@/lib/razorpay-webhook-handler";

// Rate limiter: max 5 new orders per 10 minutes per clean phone number.
// Retried/idempotent submissions are checked AFTER the idempotency lookup, so a
// flaky network cannot 429 a request whose order already exists. The map is
// pruned so a long-running server cannot grow it without bound.
const orderRateLimit = new Map<string, { count: number; firstSeen: number }>();
const RATE_LIMIT_MAX_ENTRIES = 5000;
function checkRateLimit(phone: string): boolean {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    if (orderRateLimit.size > RATE_LIMIT_MAX_ENTRIES) {
        for (const [key, value] of orderRateLimit) {
            if (now - value.firstSeen > windowMs) orderRateLimit.delete(key);
        }
    }
    const entry = orderRateLimit.get(phone);
    if (!entry || now - entry.firstSeen > windowMs) {
        orderRateLimit.set(phone, { count: 1, firstSeen: now });
        return true;
    }
    if (entry.count >= 5) {
        return false;
    }
    entry.count += 1;
    return true;
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export interface StorefrontOrderPayload {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    shippingAddress: string;
    city: string;
    state?: string;
    pincode: string;
    items: {
        productId: string;
        /** Explicit variant; required when the product has more than one. */
        variantId?: string;
        sku: string;
        name: string;
        price: number;
        quantity: number;
    }[];
    total: number;
    discountAmount?: number;
    couponCode?: string;
    paymentMethod: "razorpay_online" | "whatsapp_concierge" | "cod";
    razorpayPaymentId?: string;
    assignedCourier?: string;
    /** Shipping charge in rupees as quoted at checkout; clamped server-side. */
    shippingCharges?: number;
    /** Marketing attribution (UTM campaign) from the storefront session. */
    campaign?: string;
    /** GDPR/DPDP consent captured at checkout. */
    marketingConsent?: boolean;
    /** B2B billing identity (A3/A4). */
    companyName?: string;
    gstin?: string;
    billingSameAsShipping?: boolean;
    billingAddress?: string;
    billingCity?: string;
    billingState?: string;
    billingPincode?: string;
    /** Stable key generated once per checkout session so retries don't double-order. */
    idempotencyKey?: string;
    accountEmail?: string;
    /**
     * CO-05 two-phase online payment: create the ERP order and a Razorpay order
     * carrying its id, then charge against that order. Without this flag the
     * legacy charge-first flow is kept for compatibility.
     */
    prepareGateway?: boolean;
    /** Storefront confirmation after Razorpay's checkout handler fires. */
    confirmPayment?: {
        orderId: string;
        paymentId: string;
        razorpayOrderId?: string;
        signature?: string;
    };
}

function generateTxnId(): string {
    const today = new Date();
    const dateStr = today.toISOString().slice(2, 10).replace(/-/g, "");
    // CSPRNG: order references appear on payment records, so they should not
    // be enumerable even though uniqueness alone would not demand it.
    const rand = randomBytes(3).toString("hex").toUpperCase();
    return `ORD-${dateStr}-${rand}`;
}

interface StoreTaxContext {
    gstRegistered: boolean;
    sellerStateCode: string;
}

/**
 * Confirm a Razorpay checkout payment for an order created by the prepare phase
 * (CO-05). Verifies the checkout signature (or the gateway payment server-side
 * when no signature is supplied), then settles through the same service the
 * webhook uses, so the payment can be settled exactly once from either path.
 */
async function confirmStorefrontPayment(
    req: Request,
    body: StorefrontOrderPayload
): Promise<NextResponse> {
    const confirm = body.confirmPayment!;
    const customerSession = verifyCustomerToken(extractBearer(req));
    if (!customerSession) {
        return NextResponse.json(
            { success: false, error: "Please verify your WhatsApp number before confirming the payment." },
            { status: 401, headers: CORS_HEADERS }
        );
    }
    if (!confirm.orderId || !confirm.paymentId) {
        return NextResponse.json(
            { success: false, error: "Missing payment confirmation details." },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const orderTenant = resolveOrderTenant(customerSession.tenant, body.accountEmail);
    if (!orderTenant.ok) {
        return NextResponse.json(
            { success: false, error: orderTenant.error || "This session cannot confirm that order." },
            { status: 403, headers: CORS_HEADERS }
        );
    }
    const tenant = orderTenant.tenant;

    const client = await createTenantClient(tenant);
    const order = await client.collection("sales_orders").getOne(confirm.orderId).catch(() => null);
    if (!order) {
        return NextResponse.json(
            { success: false, error: "Order not found for this store." },
            { status: 404, headers: CORS_HEADERS }
        );
    }
    if (order.account_email && order.account_email !== tenant) {
        return NextResponse.json(
            { success: false, error: "Order does not belong to this store." },
            { status: 403, headers: CORS_HEADERS }
        );
    }
    const sessionPhone = String(customerSession.phone || "").replace(/\D/g, "").slice(-10);
    const orderPhone = String(order.customer_phone || "").replace(/\D/g, "").slice(-10);
    if (sessionPhone && orderPhone && sessionPhone !== orderPhone) {
        return NextResponse.json(
            { success: false, error: "Order phone number does not match the verified number." },
            { status: 403, headers: CORS_HEADERS }
        );
    }

    if (String(order.payment_status || "").toUpperCase() === "PAID") {
        return NextResponse.json(
            { success: true, orderId: order.id, txnId: order.order_number, settled: true, duplicate: true },
            { status: 200, headers: CORS_HEADERS }
        );
    }

    const gatewayOrderId = String(order.gateway_order_id || confirm.razorpayOrderId || "");
    let verified = false;
    if (confirm.razorpayOrderId && confirm.signature) {
        verified = verifyGatewaySignature({
            orderId: confirm.razorpayOrderId,
            paymentId: confirm.paymentId,
            signature: confirm.signature,
        });
        if (verified && gatewayOrderId && confirm.razorpayOrderId !== gatewayOrderId) {
            verified = false;
        }
    }
    if (!verified) {
        const payment = await fetchGatewayPayment(confirm.paymentId);
        if (payment.error) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Payment could not be verified with the gateway (${payment.error}). Contact support with the payment id ${confirm.paymentId}.`,
                },
                { status: 502, headers: CORS_HEADERS }
            );
        }
        const statusOk = payment.status === "captured" || payment.status === "authorized";
        const orderOk = !gatewayOrderId || payment.orderId === gatewayOrderId;
        const amountOk =
            Math.abs(Number(payment.amountPaise || 0) - Math.round(Number(order.total || 0) * 100)) <= 1;
        verified = statusOk && orderOk && amountOk;
        if (!verified) {
            return NextResponse.json(
                { success: false, error: "The payment does not match this order; it was not settled." },
                { status: 409, headers: CORS_HEADERS }
            );
        }
    }

    const settled = await settleCapturedOrder(order.id, {
        paymentId: confirm.paymentId,
        tenantEmail: tenant,
        client,
    });
    if (!settled.success) {
        return NextResponse.json(
            { success: false, error: settled.error || "The payment was verified but the order could not be settled." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    return NextResponse.json(
        { success: true, orderId: order.id, txnId: order.order_number, settled: true },
        { status: 200, headers: CORS_HEADERS }
    );
}

export async function POST(req: Request) {
    try {
        const body: StorefrontOrderPayload = await req.json();

        // CO-05 confirm phase: verify and settle an already-created order.
        if (body.confirmPayment) {
            return await confirmStorefrontPayment(req, body);
        }

        // 1. Validation
        if (!body.customerName || !body.customerPhone || !body.items || body.items.length === 0) {
            return NextResponse.json(
                { success: false, error: "Missing required order details (customer info or items)." },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        const cleanPhoneDigits = (body.customerPhone || "").replace(/\D/g, "");

        // The storefront session is the only credential accepted here. The body
        // may echo an account, but it cannot choose one: the tenant and the
        // verified phone come from the signed token.
        const customerSession = verifyCustomerToken(extractBearer(req));
        if (!customerSession) {
            return NextResponse.json(
                { success: false, error: "Please verify your WhatsApp number before placing an order." },
                { status: 401, headers: CORS_HEADERS }
            );
        }

        const orderTenant = resolveOrderTenant(customerSession.tenant, body.accountEmail);
        if (!orderTenant.ok) {
            return NextResponse.json(
                { success: false, error: orderTenant.error || "This session cannot place an order for that store." },
                { status: 403, headers: CORS_HEADERS }
            );
        }
        const tenant = orderTenant.tenant;

        if (
            customerSession.phone &&
            cleanPhoneDigits.slice(-10) !== customerSession.phone.slice(-10)
        ) {
            return NextResponse.json(
                { success: false, error: "The order phone number does not match the verified number." },
                { status: 403, headers: CORS_HEADERS }
            );
        }

        // CO-05: a prepare request must be able to create a gateway order. Fail
        // before writing anything when the gateway is not configured.
        if (body.paymentMethod === "razorpay_online" && body.prepareGateway && !gatewayConfigured()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Online payment is not configured on this store. Please choose Cash on Delivery or WhatsApp Concierge.",
                },
                { status: 503, headers: CORS_HEADERS }
            );
        }

        // Idempotency (gap F6): the checkout sends one stable key per session;
        // a retried submit lands on the original order instead of duplicating.
        const txnId =
            (body.idempotencyKey || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || generateTxnId();
        let persistedOrderId: string = txnId;
        let pbSyncSuccess = false;
        let duplicate = false;

        // Tenant is fixed by the session, not by the request body (§12.4.1 A25).
        const boundAdminEmail = tenant;
        // No shared-client auth mutation in this request path (CO-08): every
        // read and write below goes through the per-tenant client. The domain is
        // only a label used in notes, read from this tenant's own settings.
        let boundDomain: string = tenant;

        // 2. Attempt Database Sync via PocketBase
        try {
            const client = await createTenantClient(boundAdminEmail);

            try {
                const cmsRecord = await client
                    .collection("store_settings")
                    .getFirstListItem(
                        `key="storefront_content" && account_email = "${sanitizeFilter(boundAdminEmail)}"`
                    );
                const cms =
                    typeof cmsRecord.value === "string"
                        ? JSON.parse(cmsRecord.value)
                        : cmsRecord.value;
                boundDomain = cms?.adminBinding?.customDomain || boundAdminEmail;
            } catch {
                // The domain label is cosmetic; tenancy is already fixed.
            }

            // Cost-based channel rules are the source of the website price.
            const channelDefinitions = await loadTenantChannelDefinitions(
                client,
                boundAdminEmail
            );

            // CO-14: place of supply comes from the shipping state mapped to a
            // GST state code. It is written on the order and drives CGST/SGST vs
            // IGST; without it a registered store cannot invoice correctly.
            const shippingStateCode = getStateCode(String(body.state || "").trim());

            // B2B capture (A3/A4): a business buyer may bill to a different
            // address and GSTIN. For a registered buyer the billing state is the
            // place of supply, so IGST vs CGST/SGST follows the GSTIN's state.
            const gstinRaw = String(body.gstin || "").trim().toUpperCase();
            let buyerGstin = "";
            if (gstinRaw) {
                const gstCheck = validateGSTIN(gstinRaw);
                if (!gstCheck.valid) {
                    return NextResponse.json(
                        { success: false, error: `GSTIN is not valid: ${gstCheck.message}` },
                        { status: 400, headers: CORS_HEADERS }
                    );
                }
                buyerGstin = gstinRaw;
            }
            const buyerCompany = String(body.companyName || "").trim().slice(0, 120);
            const billingSameAsShipping = body.billingSameAsShipping !== false;
            const billingAddressLineRaw = billingSameAsShipping
                ? [body.shippingAddress, body.city, body.state, body.pincode].filter(Boolean).join(", ")
                : [body.billingAddress, body.billingCity, body.billingState, body.billingPincode]
                      .filter(Boolean)
                      .join(", ");
            const billingStateCode = billingSameAsShipping
                ? shippingStateCode
                : getStateCode(String(body.billingState || "").trim());
            if (
                !billingSameAsShipping &&
                (!body.billingAddress || !billingStateCode || !body.billingPincode)
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "Billing address, state and pincode are required when billing differs from shipping.",
                    },
                    { status: 400, headers: CORS_HEADERS }
                );
            }
            const buyerStateCode = buyerGstin && billingStateCode ? billingStateCode : shippingStateCode;
            const placeOfSupply = buyerStateCode;

            const existing = await findExistingChannelOrder(client, txnId);
            if (existing) {
                // A retried prepare request must return the same gateway order,
                // not create a second one (CO-05 idempotency).
                if (body.paymentMethod === "razorpay_online" && body.prepareGateway) {
                    const row = await client.collection("sales_orders").getOne(existing.id);
                    if (row.gateway_order_id) {
                        return NextResponse.json(
                            {
                                success: true,
                                orderId: existing.id,
                                txnId,
                                duplicate: true,
                                gateway: {
                                    orderId: row.gateway_order_id,
                                    amountPaise: Math.round(Number(row.total || 0) * 100),
                                    currency: "INR",
                                    keyId: getRazorpayConfig().keyId,
                                },
                            },
                            { status: 200, headers: CORS_HEADERS }
                        );
                    }
                    const gw = await createGatewayOrder({
                        amountRupees: Number(row.total || 0),
                        receipt: txnId,
                        notes: {
                            order_id: existing.id,
                            account_email: boundAdminEmail,
                            source: "storefront",
                        },
                    });
                    if (gw.configured && gw.orderId) {
                        await client
                            .collection("sales_orders")
                            .update(existing.id, {
                                gateway: "razorpay",
                                gateway_order_id: gw.orderId,
                                payment_method: body.paymentMethod,
                            })
                            .catch(() => {});
                        return NextResponse.json(
                            {
                                success: true,
                                orderId: existing.id,
                                txnId,
                                duplicate: true,
                                gateway: {
                                    orderId: gw.orderId,
                                    amountPaise: gw.amountPaise,
                                    currency: gw.currency,
                                    keyId: gw.keyId,
                                },
                            },
                            { status: 200, headers: CORS_HEADERS }
                        );
                    }
                }
                return NextResponse.json(
                    { success: true, orderId: existing.id, txnId, syncedToDb: true, duplicate: true },
                    { status: 200, headers: CORS_HEADERS }
                );
            }

            // Rate limit only NEW orders: a replayed idempotency key already
            // returned above, so a flaky network cannot 429 an order that exists.
            if (!checkRateLimit(cleanPhoneDigits)) {
                return NextResponse.json(
                    { success: false, error: "Too many orders placed recently. Please wait a few minutes before trying again." },
                    { status: 429, headers: CORS_HEADERS }
                );
            }

            // Find or create the customer, merging email/state/address into the
            // profile when the CRM is missing them (gaps A1/A2/F4).
            const customer = await upsertChannelCustomer(client, {
                tenantEmail: boundAdminEmail,
                name: body.customerName,
                phone: cleanPhoneDigits,
                email: body.customerEmail,
                address: body.shippingAddress,
                city: body.city,
                state: body.state,
                stateCode: shippingStateCode,
                pincode: body.pincode,
                source: "website",
                marketingConsent: body.marketingConsent,
                gstin: buyerGstin || undefined,
                companyName: buyerCompany || undefined,
                billingAddress: billingAddressLineRaw || undefined,
            });
            const customerId = customer.id;

            // Validate items and verify pricing strictly from database
            let calculatedSubtotal = 0;
            const validatedItems: {
                productId: string;
                variantId?: string;
                sku: string;
                name: string;
                price: number;
                quantity: number;
                taxRate: number | null;
            }[] = [];

            for (const item of body.items) {
                const qty = Math.max(1, Math.min(100, Math.floor(Number(item.quantity) || 1)));
                if (!item.productId || typeof item.productId !== "string") {
                    return NextResponse.json(
                        { success: false, error: "Invalid item: Missing product ID." },
                        { status: 400, headers: CORS_HEADERS }
                    );
                }

                let dbProd: any = null;
                try {
                    dbProd = await client.collection("products").getOne(item.productId);
                } catch {
                    return NextResponse.json(
                        { success: false, error: `Product not found: ${item.name || item.productId}` },
                        { status: 400, headers: CORS_HEADERS }
                    );
                }

                if (!dbProd || dbProd.is_active === false) {
                    return NextResponse.json(
                        { success: false, error: `Product is unavailable: ${item.name || item.productId}` },
                        { status: 400, headers: CORS_HEADERS }
                    );
                }

                if (dbProd.account_email && dbProd.account_email !== boundAdminEmail) {
                    return NextResponse.json(
                        { success: false, error: "Product does not belong to this store tenant." },
                        { status: 400, headers: CORS_HEADERS }
                    );
                }

                const channelPrices = (dbProd as any).channel_prices || {};
                const verifiedPrice = getChannelPriceFromList(
                    {
                        base_price: Number(dbProd.base_price) || 0,
                        cost_price: Number(dbProd.cost_price) || 0,
                        channel_prices: channelPrices,
                    },
                    "website",
                    channelDefinitions
                );

                if (verifiedPrice <= 0) {
                    return NextResponse.json(
                        { success: false, error: `Product has no valid pricing configured: ${item.name || item.productId}` },
                        { status: 400, headers: CORS_HEADERS }
                    );
                }

                calculatedSubtotal += verifiedPrice * qty;
                validatedItems.push({
                    productId: item.productId,
                    variantId: typeof item.variantId === "string" && item.variantId ? item.variantId : undefined,
                    sku: dbProd.sku || item.sku || "",
                    name: dbProd.name || item.name || "Jewelry Item",
                    price: verifiedPrice,
                    quantity: qty,
                    taxRate: typeof dbProd.tax_rate === "number" ? dbProd.tax_rate : null,
                });
            }

            // Unified channel stock: resolve the real variant (refusing ambiguous
            // lines) and reject unfulfillable orders before any further writes.
            const stockLines = validatedItems.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
                name: item.name,
            }));
            let productLevelProduct: string | null = null;
            try {
                const availability = await assertStockAvailable(toStockDb(client), stockLines, {
                    accountEmail: boundAdminEmail,
                });
                if (!availability.ok) {
                    return NextResponse.json(
                        { success: false, error: "Insufficient stock", shortages: availability.shortages },
                        { status: 409, headers: CORS_HEADERS }
                    );
                }
                // Legacy products with no variant rows cannot satisfy the required
                // `sales_order_items.variant` relation. Refuse before any write
                // instead of failing after the order header exists (CO-21).
                const productLevel = availability.targets.find((target) => target.kind === "product");
                if (productLevel) productLevelProduct = productLevel.name || productLevel.productId;
            } catch (stockErr) {
                if (stockErr instanceof VariantRequiredError || stockErr instanceof VariantMismatchError) {
                    return NextResponse.json(
                        { success: false, error: stockErr.message },
                        { status: 400, headers: CORS_HEADERS }
                    );
                }
                throw stockErr;
            }
            if (productLevelProduct) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `"${productLevelProduct}" cannot be ordered online yet because it has no sellable variant configured. Please contact us on WhatsApp.`,
                    },
                    { status: 400, headers: CORS_HEADERS }
                );
            }

            // Server-side discount calculation: recompute from verifiedSubtotal and active discounts
            let verifiedDiscount = 0;
            if (body.couponCode && typeof body.couponCode === "string" && body.couponCode.trim()) {
                const code = body.couponCode.trim().toUpperCase();
                const discountRec = await client.collection("discounts").getFirstListItem(
                    `code = "${sanitizeFilter(code)}" && is_active = true && account_email = "${sanitizeFilter(boundAdminEmail)}"`
                ).catch(() => null);

                if (discountRec) {
                    const discVal = Number(discountRec.value) || 0;
                    const discType = discountRec.discount_type || (discountRec as any).type || "percentage";
                    if (discType === "percentage") {
                        verifiedDiscount = Math.round((calculatedSubtotal * discVal) / 100);
                        if (discountRec.max_discount && verifiedDiscount > Number(discountRec.max_discount)) {
                            verifiedDiscount = Number(discountRec.max_discount);
                        }
                    } else {
                        verifiedDiscount = discVal;
                    }
                } else if (code === "FESTIVE10" && calculatedSubtotal >= 1499) {
                    // Server port of the storefront UI rule (P0-6): minimum
                    // cart ₹1,499, then flat 10%. No unbounded fallback.
                    verifiedDiscount = Math.round(calculatedSubtotal * 0.10);
                } else if (code === "MYCART49" && calculatedSubtotal >= 799) {
                    // Server port of the client-only coupon (§12.9 P0-6):
                    // minimum cart ₹799, flat ₹49.
                    verifiedDiscount = 49;
                }
            }
            verifiedDiscount = Math.max(0, Math.min(calculatedSubtotal, verifiedDiscount));

            // Shipping (gap B1): persist the quoted charge instead of silently
            // shipping free; clamped so a tampered client cannot invent credit.
            const shippingCharges = Math.max(
                0,
                Math.min(5000, Math.round((Number(body.shippingCharges) || 0) * 100) / 100)
            );
            // The charged amount stays exactly what the customer saw at
            // checkout: subtotal - discount + shipping. Tax is contained
            // within that amount (tax-inclusive, same model as POS invoices).
            const calculatedTotal = Math.max(0, calculatedSubtotal - verifiedDiscount + shippingCharges);

            const storeTax = await loadChannelStoreTaxContext(client, boundAdminEmail);
            const taxLines: ChannelTaxLine[] = validatedItems.map((i) => ({
                gross: i.price * i.quantity,
                taxRate: i.taxRate,
            }));

            // Tax split (gap B2): contained tax on the post-discount base. A
            // registered store cannot invoice without a place of supply, so an
            // unresolvable shipping state fails closed (CO-14) instead of
            // silently booking every sale intra-state.
            if (storeTax.gstRegistered && !buyerStateCode) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "Please select your delivery state so the invoice applies the correct GST (CGST/SGST vs IGST).",
                    },
                    { status: 400, headers: CORS_HEADERS }
                );
            }
            const tax = computeChannelTax(taxLines, verifiedDiscount, shippingCharges, {
                sellerStateCode: storeTax.sellerStateCode,
                buyerStateCode: buyerStateCode || storeTax.sellerStateCode,
                gstRegistered: storeTax.gstRegistered,
            });

            // Online orders remain draft until Razorpay webhook confirms payment; COD/concierge orders are confirmed
            const orderStatus = body.paymentMethod === "razorpay_online" ? "draft" : "confirmed";
            const paymentStatus = body.paymentMethod === "cod" ? "UNPAID" : "PENDING";

            const shippingAddressLine = [
                body.shippingAddress,
                body.city,
                body.state,
                body.pincode,
            ].filter(Boolean).join(", ");

            // Campaign attribution (A37): resolve the UTM name to a campaign row
            // for the `sales.campaign` relation; the name is always kept on the
            // order so attribution survives campaign deletion.
            const campaignName = String(body.campaign || "").trim().slice(0, 80);
            const campaign = campaignName
                ? await resolveCampaign(client, {
                      tenantEmail: boundAdminEmail,
                      name: campaignName,
                      channel: "storefront",
                  })
                : null;

            // Create official Sales Order bound to single admin account.
            // A lost order-number race (A22) surfaces as a unique-constraint
            // error; the client retries idempotently rather than 500-ing.
            let salesOrder;
            try {
                salesOrder = await client.collection("sales_orders").create({
                    order_number: txnId,
                    order_type: "sales_order",
                    customer: customerId,
                    customer_name: body.customerName,
                    customer_phone: cleanPhoneDigits,
                    customer_email: body.customerEmail || "",
                    billing_address: billingAddressLineRaw || shippingAddressLine,
                    shipping_address: shippingAddressLine,
                    order_date: new Date().toISOString(),
                    status: orderStatus,
                    subtotal: calculatedSubtotal,
                    discount_total: verifiedDiscount,
                    shipping_charges: shippingCharges,
                    tax_total: tax.taxTotal,
                    total: calculatedTotal,
                    payment_status: paymentStatus,
                    payment_method: body.paymentMethod,
                    buyer_state_code: buyerStateCode,
                    place_of_supply: placeOfSupply,
                    buyer_gstin: buyerGstin,
                    buyer_company: buyerCompany,
                    campaign: campaignName,
                    capture_source: "storefront",
                    gateway: body.paymentMethod === "razorpay_online" ? "razorpay" : "",
                    gateway_payment_id: body.razorpayPaymentId || "",
                    account_email: boundAdminEmail,
                    internal_notes: `Storefront Web Order [${body.paymentMethod.toUpperCase()} | Domain: ${boundDomain} | Admin: ${boundAdminEmail}]. Courier: ${
                        body.assignedCourier || "Smart Routing"
                    }. Coupon: ${body.couponCode || "None"}. Txn: ${body.razorpayPaymentId || "N/A"}. Campaign: ${
                        body.campaign || "direct"
                    }. Marketing consent: ${body.marketingConsent ? "yes" : "no"}. GST ${tax.blendedRate}% inclusive, taxable ₹${tax.taxableValue.toFixed(2)}.`,
                    notes: `Storefront Web Order ${txnId}`,
                });
            } catch (createErr: any) {
                const msg = String(
                    createErr?.response?.data?.order_number?.message ||
                        createErr?.originalError?.message ||
                        createErr?.message ||
                        ""
                );
                if (!/unique/i.test(msg)) throw createErr;
                const raced = await findExistingChannelOrder(client, txnId);
                if (!raced) throw createErr;
                salesOrder = raced;
            }

            persistedOrderId = salesOrder.id;

            // Create Sales Order Items; the unified stock service owns the ledger.
            // `variant` is a required relation (P0-2): resolve it for
            // single-variant products the stock check accepted implicitly, and do
            // NOT swallow failures — a swallowed item row was an invisible
            // zero-line order. If a write still fails, cancel the header so an
            // order can never survive without its lines (CO-19).
            try {
                for (const item of validatedItems) {
                    const variantId = item.variantId
                        ? item.variantId
                        : await resolveVariantForProduct(client, item.productId);
                    item.variantId = variantId;
                    await client.collection("sales_order_items").create({
                        order: salesOrder.id,
                        product: item.productId,
                        variant: variantId,
                        description: `${item.name} (${item.sku})`,
                        quantity: item.quantity,
                        unit_price: item.price,
                        total: item.price * item.quantity,
                        account_email: boundAdminEmail,
                    });
                }
                const createdItems = await client.collection("sales_order_items").getFullList({
                    filter: `order = "${salesOrder.id}"`,
                    fields: "id",
                });
                if (createdItems.length !== validatedItems.length) {
                    throw new Error(
                        `order item count mismatch: expected ${validatedItems.length}, found ${createdItems.length}`
                    );
                }
            } catch (itemErr) {
                console.error("[Storefront Order] order item write failed:", itemErr);
                await client
                    .collection("sales_orders")
                    .update(salesOrder.id, { status: "cancelled" })
                    .catch(() => {});
                return NextResponse.json(
                    {
                        success: false,
                        error: "The order could not be saved because its items could not be recorded. If you were already charged, contact us with your payment reference.",
                    },
                    { status: 500, headers: CORS_HEADERS }
                );
            }

            // Consent ledger (A30): placing the order records transactional
            // consent; marketing consent is exactly what the checkout checkbox
            // said. Append-only events keep the decision auditable.
            await recordConsentEvents(client, [
                {
                    customerId,
                    phone: cleanPhoneDigits,
                    channel: "storefront",
                    purpose: "transactional",
                    granted: true,
                    source: "storefront_checkout",
                    orderId: salesOrder.id,
                },
                {
                    customerId,
                    phone: cleanPhoneDigits,
                    channel: "storefront",
                    purpose: "marketing",
                    granted: Boolean(body.marketingConsent),
                    source: "storefront_checkout",
                    orderId: salesOrder.id,
                },
            ]);

            // Unified channel stock: COD/offline orders settle at intake; an online
            // order deducts when its paid webhook confirms. The service's atomic
            // decrement is the last-unit guard shared by POS, WhatsApp and web.
            if (body.paymentMethod !== "razorpay_online") {
                try {
                    await applyChannelStock(toStockDb(client), stockLines, {
                        accountEmail: boundAdminEmail,
                        channel: "storefront",
                        referenceId: salesOrder.id,
                        notes: `Web checkout order ${txnId} [Domain: ${boundDomain}]`,
                    });
                } catch (stockErr) {
                    await client.collection("sales_orders").update(salesOrder.id, { status: "cancelled" }).catch(() => {});
                    if (stockErr instanceof InsufficientStockError) {
                        return NextResponse.json(
                            { success: false, error: stockErr.message },
                            { status: 409, headers: CORS_HEADERS }
                        );
                    }
                    throw stockErr;
                }
            }

            // Also create POS sales record for unified daily revenue reporting.
            // The mirror stores narrow enums: channel `storefront`, payment
            // projected onto cash/upi/phonepe; UTM lives in notes because
            // `sales.campaign` is a relation, not text (P0-4). This is a
            // reporting projection, not the source of truth: a failure here is
            // logged and must not turn a durable, stock-committed order into a
            // 503 (CO-20). `sales` has no payment-id column, so the gateway
            // reference stays on the order notes (CO-23).
            await client
                .collection("sales")
                .create({
                    channel: "storefront",
                    channel_order_id: txnId,
                    customer: customerId,
                    customer_name: body.customerName,
                    customer_phone: cleanPhoneDigits,
                    customer_address: shippingAddressLine,
                    subtotal: calculatedSubtotal,
                    discount: verifiedDiscount,
                    total: calculatedTotal,
                    payment_method: body.paymentMethod === "cod" ? "cash" : "upi",
                    status: "pending",
                    campaign: campaign?.id || undefined,
                    campaign_name: campaignName,
                    notes: `Storefront Web Order ${txnId} [Domain: ${boundDomain}] UTM: ${
                        body.campaign || "direct"
                    } Txn: ${body.razorpayPaymentId || "N/A"}`,
                    account_email: boundAdminEmail,
                })
                .catch((mirrorErr) => {
                    console.warn("[Storefront Order] sales mirror write failed (order is durable):", mirrorErr);
                });

            // CO-05 prepare phase: the order (and its lines) now exist. Create
            // the Razorpay order that carries this order id in its notes and
            // return the checkout parameters. No charge happens yet.
            if (body.paymentMethod === "razorpay_online" && body.prepareGateway) {
                const gateway = await createGatewayOrder({
                    amountRupees: calculatedTotal,
                    receipt: txnId,
                    notes: {
                        order_id: salesOrder.id,
                        account_email: boundAdminEmail,
                        source: "storefront",
                    },
                });
                if (!gateway.configured || !gateway.orderId) {
                    await client
                        .collection("sales_orders")
                        .update(salesOrder.id, { status: "cancelled" })
                        .catch(() => {});
                    return NextResponse.json(
                        {
                            success: false,
                            error: gateway.error || "Online payment is not configured on this store.",
                        },
                        { status: 503, headers: CORS_HEADERS }
                    );
                }
                await client
                    .collection("sales_orders")
                    .update(salesOrder.id, {
                        gateway: "razorpay",
                        gateway_order_id: gateway.orderId,
                        payment_method: body.paymentMethod,
                    })
                    .catch(() => {});
                return NextResponse.json(
                    {
                        success: true,
                        orderId: salesOrder.id,
                        txnId,
                        gateway: {
                            orderId: gateway.orderId,
                            amountPaise: gateway.amountPaise,
                            currency: gateway.currency,
                            keyId: gateway.keyId,
                        },
                    },
                    { status: 200, headers: CORS_HEADERS }
                );
            }

            // Customer lifetime aggregates + loyalty (gaps F1/F2) — COD and
            // concierge bump and award at intake; online orders do both at the
            // paid webhook, so a draft never inflates lifetime spend or points
            // before money exists (§12.4.1 A29 correction).
            if (body.paymentMethod !== "razorpay_online") {
                await applyPurchaseAggregates(client, customerId, calculatedTotal);
                try {
                    // CO-08: loyalty runs against the per-tenant client, not the
                    // shared module-level one.
                    const points = await calculatePointsToEarn(calculatedTotal, undefined, client);
                    if (points > 0) {
                        await earnPoints(customerId, calculatedTotal, "sales_order", salesOrder.id, client);
                    }
                } catch (loyaltyErr) {
                    console.warn("[order] COD loyalty award skipped:", loyaltyErr);
                }
                // Mark the order as counted so cancellation can reverse the
                // counters and points exactly once (CO-15 residual).
                try {
                    const fresh = await client.collection("sales_orders").getOne(salesOrder.id);
                    await client.collection("sales_orders").update(salesOrder.id, {
                        internal_notes: [fresh.internal_notes, AGGREGATES_MARKER]
                            .filter(Boolean)
                            .join("\n"),
                    });
                } catch (markErr) {
                    console.warn("[order] aggregate marker write failed:", markErr);
                }
            }

            pbSyncSuccess = true;
            duplicate = false;
        } catch (dbErr) {
            console.warn("[Storefront Order API] PocketBase offline or error, queueing order locally:", dbErr);
        }

        // 3. Ensure database persistence succeeded
        if (!pbSyncSuccess) {
            return NextResponse.json(
                { success: false, error: "Database service temporarily unavailable. Order could not be recorded." },
                { status: 503, headers: CORS_HEADERS }
            );
        }

        return NextResponse.json(
            {
                success: true,
                orderId: persistedOrderId,
                txnId,
                syncedToDb: pbSyncSuccess,
                duplicate,
            },
            { status: 200, headers: CORS_HEADERS }
        );
    } catch (err: any) {
        console.error("[Storefront Order API] Internal Server Error:", err);
        return NextResponse.json(
            { success: false, error: err.message || "Failed to process storefront order" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}
