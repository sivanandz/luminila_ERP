/**
 * Public flash-drop storefront endpoint (WA-01 / WA-02).
 *
 * A WhatsApp flash-drop link is opened by an external buyer with no ERP
 * session, so everything here is server-authoritative:
 *
 *  - the drop, its item snapshot and the drop price are read from PocketBase;
 *    the client never supplies a price, a tenant id it could spoof into another
 *    account, or a stock quantity;
 *  - `reserve` creates a 10-minute hold in `flash_drop_reservations` under the
 *    drop's tenant, enforcing `allocatedStock - live holds` server-side;
 *  - `pay-intent` writes a real `sales_orders` + `sales_order_items` document and
 *    a Razorpay order for the DB-computed total. No stock is deducted yet: the
 *    reservation is the hold;
 *  - `order` verifies the captured payment with the gateway (amount + order id),
 *    deducts `product_variants` through `applyChannelStock`, settles the order
 *    (invoice, CRM aggregates, loyalty) and completes the reservation.
 *
 * Fail-closed rules inherited from the storefront checkout: no configured
 * gateway -> 503, unverifiable payment -> no order confirmation, and a failed
 * stock deduction after capture is recorded for manual reconciliation instead of
 * silently confirming an unfulfillable order.
 */

import { NextResponse } from "next/server";
import { createTenantClient, sanitizeFilter } from "@/lib/pocketbase";
import { isSingleAccountMode, SINGLE_ACCOUNT_EMAIL } from "@/lib/deployment-mode";
import {
    upsertChannelCustomer,
    loadChannelStoreTaxContext,
    computeChannelTax,
    canonicalPhone,
    type ChannelTaxLine,
} from "@/lib/channel-orders";
import {
    applyChannelStock,
    InsufficientStockError,
    toStockDb,
} from "@/lib/channel-stock";
import { settleCapturedOrder } from "@/lib/razorpay-webhook-handler";
import {
    gatewayConfigured,
    createGatewayOrder,
    verifyGatewaySignature,
    fetchGatewayPayment,
} from "@/lib/razorpay-orders";
import { getStateCode } from "@/lib/gst";
import { getRazorpayConfig } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DROP_COLLECTION = "flash_drops";
const RESERVATION_COLLECTION = "flash_drop_reservations";
const HOLD_MINUTES = 10;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Rate limiting (per phone and per IP, in memory)
// ---------------------------------------------------------------------------

interface LimitEntry {
    count: number;
    firstSeen: number;
}

const limits = new Map<string, LimitEntry>();
const MAX_LIMIT_ENTRIES = 5000;

function checkLimit(key: string, max: number, windowMs = 10 * 60 * 1000): boolean {
    const now = Date.now();
    if (limits.size > MAX_LIMIT_ENTRIES) {
        for (const [k, v] of limits) {
            if (now - v.firstSeen > windowMs) limits.delete(k);
        }
    }
    const entry = limits.get(key);
    if (!entry || now - entry.firstSeen > windowMs) {
        limits.set(key, { count: 1, firstSeen: now });
        return true;
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
}

function clientIp(req: Request): string {
    const forwarded = req.headers.get("x-forwarded-for") || "";
    const first = forwarded.split(",")[0]?.trim();
    return first || req.headers.get("x-real-ip") || "unknown";
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

interface FlashDropItem {
    productId: string;
    variantId: string;
    name: string;
    sku: string;
    imageUrl?: string;
    originalPrice: number;
    dropPrice: number;
    allocatedStock: number;
}

interface FlashDropRecord {
    id: string;
    account_email?: string;
    title?: string;
    description?: string;
    starts_at?: string;
    ends_at?: string;
    status?: string;
    items?: unknown;
    target_jids?: unknown;
    created?: string;
}

function parsePbDate(value?: string): string {
    if (!value) return "";
    const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeItems(raw: unknown): FlashDropItem[] {
    let value = raw;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return value
        .map((entry): FlashDropItem | null => {
            if (!entry || typeof entry !== 'object') return null;
            const item = entry as Record<string, unknown>;
            const variantId = String(item.variantId || '').trim();
            if (!variantId) return null;
            return {
                productId: String(item.productId || '').trim(),
                variantId,
                name: String(item.name || "Jewelry piece"),
                sku: String(item.sku || ""),
                imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
                originalPrice: Math.max(0, Number(item.originalPrice) || 0),
                dropPrice: Math.max(0, Number(item.dropPrice) || 0),
                allocatedStock: Math.max(0, Math.floor(Number(item.allocatedStock) || 0)),
            };
        })
        .filter((item): item is FlashDropItem => item !== null);
}

function phoneLast10(phone: string): string {
    return String(phone || "").replace(/\D/g, "").slice(-10);
}

function resolveAccountEmail(raw?: string | null): string {
    const requested = String(raw || "").trim().toLowerCase();
    if (requested) {
        // A tenant is an email address; rejecting anything else prevents a
        // crafted value from reaching the registry lookup.
        if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(requested)) return "";
        return requested;
    }
    return isSingleAccountMode() ? SINGLE_ACCOUNT_EMAIL : "";
}

function tenantFilter(accountEmail: string, extra?: string): string {
    const scope = `account_email = "${sanitizeFilter(accountEmail)}"`;
    return extra ? `(${extra}) && ${scope}` : scope;
}

function belongsToTenant(record: { account_email?: string }, accountEmail: string): boolean {
    const stored = String(record.account_email || "").trim().toLowerCase();
    return !stored || stored === accountEmail;
}

/** Map a drop record to the public projection (no phone numbers, no holds). */
function publicDrop(record: FlashDropRecord): Record<string, unknown> {
    return {
        id: record.id,
        title: record.title || "Flash Drop",
        description: record.description || "",
        items: normalizeItems(record.items),
        startTime: parsePbDate(record.starts_at),
        endTime: parsePbDate(record.ends_at),
        status: record.status || "active",
        targetJids: [],
        reservations: [],
        created: parsePbDate(record.created),
        accountEmail: record.account_email || "",
    };
}

async function loadDrop(client: Awaited<ReturnType<typeof createTenantClient>>, dropId: string, accountEmail: string) {
    if (!dropId || !/^[a-z0-9]{15}$/.test(dropId)) return null;
    const record = await client.collection(DROP_COLLECTION).getOne(dropId).catch(() => null);
    if (!record) return null;
    const row = record as unknown as FlashDropRecord;
    if (!belongsToTenant(row, accountEmail)) return null;
    return row;
}

function dropIsOpen(record: FlashDropRecord): { ok: boolean; error?: string } {
    const now = Date.now();
    const start = new Date(parsePbDate(record.starts_at) || 0).getTime();
    const end = new Date(parsePbDate(record.ends_at) || 0).getTime();
    if (String(record.status || "") !== "active" && String(record.status || "") !== "scheduled") {
        return { ok: false, error: "This flash drop is not active." };
    }
    // One minute of clock skew on the start; the end is strict.
    if (start && now < start - 60_000) return { ok: false, error: "This flash drop has not started yet." };
    if (end && now >= end) return { ok: false, error: "This flash drop has ended." };
    return { ok: true };
}

async function expireStale(
    client: Awaited<ReturnType<typeof createTenantClient>>,
    accountEmail: string,
    dropId?: string
): Promise<void> {
    const nowIso = new Date().toISOString();
    try {
        const filter = tenantFilter(
            accountEmail,
            `status = "active" && expires_at <= "${sanitizeFilter(nowIso)}"${
                dropId ? ` && drop = "${sanitizeFilter(dropId)}"` : ""
            }`
        );
        const stale = await client.collection(RESERVATION_COLLECTION).getList(1, 200, { filter });
        await Promise.all(
            stale.items.map((row) =>
                client.collection(RESERVATION_COLLECTION).update(row.id, { status: "expired" }).catch(() => {})
            )
        );
    } catch {
        // Availability maths excludes time-expired rows regardless.
    }
}

/** Live (active, not expired) + completed holds for one variant. */
async function liveHoldCount(
    client: Awaited<ReturnType<typeof createTenantClient>>,
    accountEmail: string,
    dropId: string,
    variantId: string
): Promise<number> {
    const nowIso = new Date().toISOString();
    const scope = `drop = "${sanitizeFilter(dropId)}" && variant = "${sanitizeFilter(variantId)}"`;
    const [active, completed] = await Promise.all([
        client
            .collection(RESERVATION_COLLECTION)
            .getList(1, 1, {
                filter: tenantFilter(accountEmail, `${scope} && status = "active" && expires_at > "${sanitizeFilter(nowIso)}"`),
            })
            .catch(() => ({ totalItems: 0 })),
        client
            .collection(RESERVATION_COLLECTION)
            .getList(1, 1, { filter: tenantFilter(accountEmail, `${scope} && status = "completed"`) })
            .catch(() => ({ totalItems: 0 })),
    ]);
    return (active.totalItems || 0) + (completed.totalItems || 0);
}

async function findLiveReservation(
    client: Awaited<ReturnType<typeof createTenantClient>>,
    accountEmail: string,
    dropId: string,
    variantId: string,
    phone: string
) {
    const nowIso = new Date().toISOString();
    const filter = tenantFilter(
        accountEmail,
        `drop = "${sanitizeFilter(dropId)}" && variant = "${sanitizeFilter(variantId)}" && phone ~ "${sanitizeFilter(
            phoneLast10(phone)
        )}" && status = "active" && expires_at > "${sanitizeFilter(nowIso)}"`
    );
    return client.collection(RESERVATION_COLLECTION).getFirstListItem(filter).catch(() => null);
}

function reservationPayload(record: Record<string, unknown>) {
    return {
        id: record.id,
        dropId: record.drop,
        variantId: record.variant,
        customerPhone: record.phone || "",
        customerName: record.name || "",
        createdAt: parsePbDate(String(record.created || "")),
        expiresAt: parsePbDate(String(record.expires_at || "")),
        status: record.status || "active",
        orderId: record.order || "",
    };
}

/** Validate that the drop snapshot still points at a sellable tenant product. */
async function resolveDropSale(
    client: Awaited<ReturnType<typeof createTenantClient>>,
    accountEmail: string,
    item: FlashDropItem
): Promise<{ ok: true; product: Record<string, unknown>; variant: Record<string, unknown> } | { ok: false; error: string }> {
    if (!item.productId || !/^[a-z0-9]{15}$/.test(item.productId)) {
        return { ok: false, error: "This flash drop item is missing its product." };
    }
    if (!item.dropPrice || item.dropPrice <= 0) {
        return { ok: false, error: "This flash drop item has no valid price." };
    }
    const product = await client.collection("products").getOne(item.productId).catch(() => null);
    if (!product) return { ok: false, error: "The product for this flash drop no longer exists." };
    if (product.is_active === false) return { ok: false, error: "This product is no longer available." };
    if (product.account_email && String(product.account_email).toLowerCase() !== accountEmail) {
        return { ok: false, error: "This product belongs to another store." };
    }
    const variant = await client.collection("product_variants").getOne(item.variantId).catch(() => null);
    if (!variant) return { ok: false, error: "The variant for this flash drop no longer exists." };
    if (variant.product && String(variant.product) !== item.productId) {
        return { ok: false, error: "This flash drop item does not match its product." };
    }
    if (variant.account_email && String(variant.account_email).toLowerCase() !== accountEmail) {
        return { ok: false, error: "This variant belongs to another store." };
    }
    return { ok: true, product: product as unknown as Record<string, unknown>, variant: variant as unknown as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// GET — public drop projection + live availability
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
    const ip = clientIp(req);
    if (!checkLimit(`ip:get:${ip}`, 120, 60 * 1000)) {
        return NextResponse.json(
            { success: false, error: "Too many requests. Please retry in a minute." },
            { status: 429, headers: CORS_HEADERS }
        );
    }

    const url = new URL(req.url);
    const dropId = String(url.searchParams.get("dropId") || "").trim();
    const accountEmail = resolveAccountEmail(url.searchParams.get("account_email"));
    if (!dropId) {
        return NextResponse.json({ success: false, error: "dropId is required." }, { status: 400, headers: CORS_HEADERS });
    }
    if (!accountEmail) {
        return NextResponse.json(
            { success: false, error: "This flash drop link is missing its store reference." },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    try {
        const client = await createTenantClient(accountEmail);
        const record = await loadDrop(client, dropId, accountEmail);
        if (!record) {
            return NextResponse.json({ success: false, error: "Flash Drop Not Found" }, { status: 404, headers: CORS_HEADERS });
        }

        const drop = publicDrop(record);
        const items = drop.items as FlashDropItem[];
        await expireStale(client, accountEmail, dropId);

        const available: Record<string, number> = {};
        for (const item of items) {
            const holds = await liveHoldCount(client, accountEmail, dropId, item.variantId);
            available[item.variantId] = Math.max(0, item.allocatedStock - holds);
        }

        return NextResponse.json(
            { success: true, drop: { ...drop, availableStock: available } },
            { status: 200, headers: CORS_HEADERS }
        );
    } catch (err) {
        console.error("[flash-drop] GET failed:", err);
        return NextResponse.json(
            { success: false, error: "The flash drop could not be loaded." },
            { status: 503, headers: CORS_HEADERS }
        );
    }
}

// ---------------------------------------------------------------------------
// POST — reserve | pay-intent | order
// ---------------------------------------------------------------------------

interface FlashDropRequest {
    action?: "reserve" | "pay-intent" | "order";
    accountEmail?: string;
    dropId?: string;
    variantId?: string;
    reservationId?: string;
    phone?: string;
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    orderId?: string;
    paymentId?: string;
    signature?: string;
}

export async function POST(req: Request) {
    const ip = clientIp(req);
    let body: FlashDropRequest;
    try {
        body = (await req.json()) as FlashDropRequest;
    } catch {
        return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400, headers: CORS_HEADERS });
    }

    if (!body || (body.action !== "reserve" && body.action !== "pay-intent" && body.action !== "order")) {
        return NextResponse.json(
            { success: false, error: "action must be reserve, pay-intent or order." },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const accountEmail = resolveAccountEmail(body.accountEmail);
    if (!accountEmail) {
        return NextResponse.json(
            { success: false, error: "This flash drop link is missing its store reference." },
            { status: 400, headers: CORS_HEADERS }
        );
    }
    const phone = phoneLast10(body.phone || "");

    try {
        const client = await createTenantClient(accountEmail);

        if (body.action === "reserve") {
            return await handleReserve(client, accountEmail, body, phone, ip);
        }
        if (body.action === "pay-intent") {
            return await handlePayIntent(client, accountEmail, body, phone, ip);
        }
        return await handleOrderConfirmation(client, accountEmail, body, phone, ip);
    } catch (err) {
        console.error("[flash-drop] POST failed:", err);
        return NextResponse.json(
            { success: false, error: "The flash drop checkout could not be completed." },
            { status: 503, headers: CORS_HEADERS }
        );
    }
}

type TenantClient = Awaited<ReturnType<typeof createTenantClient>>;

async function handleReserve(
    client: TenantClient,
    accountEmail: string,
    body: FlashDropRequest,
    phone: string,
    ip: string
): Promise<NextResponse> {
    if (phone.length < 10) {
        return NextResponse.json(
            { success: false, error: "A valid 10-digit WhatsApp phone number is required." },
            { status: 400, headers: CORS_HEADERS }
        );
    }
    if (!checkLimit(`ip:reserve:${ip}`, 30) || !checkLimit(`reserve:${accountEmail}:${phone}`, 10)) {
        return NextResponse.json(
            { success: false, error: "Too many reservation attempts. Please wait a few minutes." },
            { status: 429, headers: CORS_HEADERS }
        );
    }

    const record = await loadDrop(client, String(body.dropId || ""), accountEmail);
    if (!record) {
        return NextResponse.json({ success: false, error: "Flash Drop Not Found" }, { status: 404, headers: CORS_HEADERS });
    }
    const open = dropIsOpen(record);
    if (!open.ok) {
        return NextResponse.json({ success: false, error: open.error }, { status: 409, headers: CORS_HEADERS });
    }

    const items = normalizeItems(record.items);
    const item = items.find((entry) => entry.variantId === body.variantId);
    if (!item) {
        return NextResponse.json(
            { success: false, error: "This product is not part of the flash drop." },
            { status: 404, headers: CORS_HEADERS }
        );
    }
    const sale = await resolveDropSale(client, accountEmail, item);
    if (!sale.ok) {
        return NextResponse.json({ success: false, error: sale.error }, { status: 409, headers: CORS_HEADERS });
    }

    await expireStale(client, accountEmail, record.id);

    // A retry from the same phone returns the live hold instead of consuming a
    // second unit (the partial unique index enforces the same rule).
    const existing = await findLiveReservation(client, accountEmail, record.id, item.variantId, phone);
    if (existing) {
        return NextResponse.json(
            { success: true, reservation: reservationPayload(existing as unknown as Record<string, unknown>) },
            { status: 200, headers: CORS_HEADERS }
        );
    }

    const holds = await liveHoldCount(client, accountEmail, record.id, item.variantId);
    if (holds >= item.allocatedStock) {
        return NextResponse.json(
            { success: false, error: "Sorry! All flash drop stock is currently claimed or reserved." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
    let created;
    try {
        created = await client.collection(RESERVATION_COLLECTION).create({
            account_email: accountEmail,
            drop: record.id,
            product: item.productId,
            variant: item.variantId,
            phone: canonicalPhone(phone) || phone,
            name: String(body.name || "").trim().slice(0, 200),
            quantity: 1,
            status: "active",
            expires_at: expiresAt,
        });
    } catch (createErr) {
        // Lost the unique-active race: return the row the winner created.
        const raced = await findLiveReservation(client, accountEmail, record.id, item.variantId, phone);
        if (raced) {
            return NextResponse.json(
                { success: true, reservation: reservationPayload(raced as unknown as Record<string, unknown>) },
                { status: 200, headers: CORS_HEADERS }
            );
        }
        throw createErr;
    }

    // Re-count after the write: two simultaneous reservations can both pass the
    // pre-check, so the later one cancels itself instead of overselling. This
    // makes the hold fail closed under a race.
    const after = await liveHoldCount(client, accountEmail, record.id, item.variantId);
    if (after > item.allocatedStock) {
        await client.collection(RESERVATION_COLLECTION).update(created.id, { status: "cancelled" }).catch(() => {});
        return NextResponse.json(
            { success: false, error: "Sorry! All flash drop stock is currently claimed or reserved." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    return NextResponse.json(
        { success: true, reservation: reservationPayload(created as unknown as Record<string, unknown>) },
        { status: 201, headers: CORS_HEADERS }
    );
}

async function handlePayIntent(
    client: TenantClient,
    accountEmail: string,
    body: FlashDropRequest,
    phone: string,
    ip: string
): Promise<NextResponse> {
    if (!checkLimit(`ip:pay:${ip}`, 30)) {
        return NextResponse.json(
            { success: false, error: "Too many checkout attempts. Please wait a few minutes." },
            { status: 429, headers: CORS_HEADERS }
        );
    }
    if (!gatewayConfigured()) {
        // Fail closed: without gateway credentials no payment can be collected.
        return NextResponse.json(
            { success: false, error: "Online payment is not configured for this store." },
            { status: 503, headers: CORS_HEADERS }
        );
    }
    if (phone.length < 10) {
        return NextResponse.json(
            { success: false, error: "A valid 10-digit WhatsApp phone number is required." },
            { status: 400, headers: CORS_HEADERS }
        );
    }
    const address = String(body.address || "").trim();
    if (!address) {
        return NextResponse.json(
            { success: false, error: "A delivery address is required." },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const record = await loadDrop(client, String(body.dropId || ""), accountEmail);
    if (!record) {
        return NextResponse.json({ success: false, error: "Flash Drop Not Found" }, { status: 404, headers: CORS_HEADERS });
    }
    const open = dropIsOpen(record);
    if (!open.ok) {
        return NextResponse.json({ success: false, error: open.error }, { status: 409, headers: CORS_HEADERS });
    }

    const items = normalizeItems(record.items);
    const item = items.find((entry) => entry.variantId === body.variantId);
    if (!item) {
        return NextResponse.json(
            { success: false, error: "This product is not part of the flash drop." },
            { status: 404, headers: CORS_HEADERS }
        );
    }
    const sale = await resolveDropSale(client, accountEmail, item);
    if (!sale.ok) {
        return NextResponse.json({ success: false, error: sale.error }, { status: 409, headers: CORS_HEADERS });
    }

    // The reservation is the stock hold; paying without a live hold could
    // oversell the drop if the hold was released to another buyer.
    const reservationFilter = tenantFilter(
        accountEmail,
        `id = "${sanitizeFilter(String(body.reservationId || ""))}" && drop = "${sanitizeFilter(record.id)}" && variant = "${sanitizeFilter(item.variantId)}"`
    );
    const reservation = body.reservationId
        ? await client
              .collection(RESERVATION_COLLECTION)
              .getFirstListItem(reservationFilter)
              .catch(() => null)
        : null;
    if (!reservation) {
        return NextResponse.json(
            { success: false, error: "Your 10-minute hold was not found. Please reserve the item again." },
            { status: 409, headers: CORS_HEADERS }
        );
    }
    const reservationPhone = phoneLast10(String(reservation.phone || ""));
    if (reservationPhone !== phone) {
        return NextResponse.json(
            { success: false, error: "This hold belongs to a different phone number." },
            { status: 403, headers: CORS_HEADERS }
        );
    }
    if (
        String(reservation.status) !== "active" ||
        new Date(parsePbDate(String(reservation.expires_at || "")) || 0).getTime() <= Date.now()
    ) {
        return NextResponse.json(
            { success: false, error: "Your 10-minute hold has expired. Please reserve the item again." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    // Tenant lookup for the delivery state; a registered store cannot invoice
    // without a place of supply.
    const addressLine = [address, body.city, body.state, body.pincode].filter(Boolean).join(", ");
    const buyerStateCode = getStateCode(String(body.state || "").trim());
    const storeTax = await loadChannelStoreTaxContext(client, accountEmail);
    if (storeTax.gstRegistered && !buyerStateCode) {
        return NextResponse.json(
            { success: false, error: "Please select your delivery state so GST is applied correctly." },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const total = Math.round(item.dropPrice * 100) / 100;
    const taxLines: ChannelTaxLine[] = [{ gross: total }];
    const tax = computeChannelTax(taxLines, 0, 0, {
        sellerStateCode: storeTax.sellerStateCode,
        buyerStateCode: buyerStateCode || storeTax.sellerStateCode,
        gstRegistered: storeTax.gstRegistered,
    });

    const customer = await upsertChannelCustomer(client, {
        tenantEmail: accountEmail,
        name: String(body.name || "").trim() || "WhatsApp Customer",
        phone,
        address,
        city: String(body.city || "").trim(),
        state: String(body.state || "").trim(),
        stateCode: buyerStateCode,
        pincode: String(body.pincode || "").trim(),
        source: "whatsapp_flash_drop",
    });

    const orderNumber = `ORD-FD-${reservation.id}`;

    // Idempotency: one order per reservation. A retried pay-intent reuses the
    // order (and its gateway order) rather than creating a second charge.
    let salesOrder = await client
        .collection("sales_orders")
        .getFirstListItem(tenantFilter(accountEmail, `order_number = "${sanitizeFilter(orderNumber)}"`))
        .catch(() => null);

    if (salesOrder && String(salesOrder.payment_status || "").toUpperCase() === "PAID") {
        return NextResponse.json(
            {
                success: true,
                paid: true,
                orderId: salesOrder.id,
                orderNumber,
            },
            { status: 200, headers: CORS_HEADERS }
        );
    }

    if (salesOrder?.gateway_order_id) {
        return NextResponse.json(
            {
                success: true,
                duplicate: true,
                orderId: salesOrder.id,
                orderNumber,
                gateway: {
                    orderId: String(salesOrder.gateway_order_id),
                    amountPaise: Math.round(Number(salesOrder.total || total) * 100),
                    currency: "INR",
                    keyId: getRazorpayConfig().keyId,
                },
                amount: Number(salesOrder.total || total),
            },
            { status: 200, headers: CORS_HEADERS }
        );
    }

    if (!salesOrder) {
        const createdOrder = await client.collection("sales_orders").create({
            order_number: orderNumber,
            order_type: "sales_order",
            customer: customer.id,
            customer_name: String(body.name || "").trim() || "WhatsApp Customer",
            customer_phone: phone,
            billing_address: addressLine,
            shipping_address: addressLine,
            order_date: new Date().toISOString(),
            status: "draft",
            subtotal: total,
            discount_total: 0,
            shipping_charges: 0,
            tax_total: tax.taxTotal,
            total,
            payment_status: "PENDING",
            payment_method: "razorpay_online",
            buyer_state_code: buyerStateCode,
            place_of_supply: buyerStateCode,
            capture_source: "whatsapp_flash_drop",
            gateway: "razorpay",
            campaign: "",
            account_email: accountEmail,
            internal_notes: `WhatsApp flash drop ${record.title || record.id} (hold ${reservation.id}). GST ${tax.blendedRate}% inclusive, taxable ₹${tax.taxableValue.toFixed(2)}.`,
            notes: `Flash drop order ${orderNumber}`,
        });

        // Variant is a required relation: fail loudly instead of writing an
        // invisible zero-line order.
        await client.collection("sales_order_items").create({
            order: createdOrder.id,
            product: item.productId,
            variant: item.variantId,
            description: item.name,
            quantity: 1,
            unit_price: total,
            total,
            account_email: accountEmail,
        });
        salesOrder = createdOrder;
    } else if (String(salesOrder.status || "") === "cancelled") {
        // A previous gateway attempt failed; reopen the same document so the
        // unique order_number is never duplicated.
        salesOrder = await client.collection("sales_orders").update(salesOrder.id, {
            status: "draft",
            payment_status: "PENDING",
            total,
            subtotal: total,
            tax_total: tax.taxTotal,
            gateway: "razorpay",
        });
    }

    if (!salesOrder) {
        return NextResponse.json(
            { success: false, error: "The order could not be created." },
            { status: 500, headers: CORS_HEADERS }
        );
    }

    // A crash between the header and the line write could leave a zero-line
    // order; repair it before attaching a gateway charge.
    const existingItems = await client.collection("sales_order_items").getList(1, 1, {
        filter: `order = "${sanitizeFilter(salesOrder.id)}"`,
    }).catch(() => null);
    if (!existingItems || existingItems.totalItems === 0) {
        await client.collection("sales_order_items").create({
            order: salesOrder.id,
            product: item.productId,
            variant: item.variantId,
            description: item.name,
            quantity: 1,
            unit_price: total,
            total,
            account_email: accountEmail,
        });
    }

    const gateway = await createGatewayOrder({
        amountRupees: Number(salesOrder.total || total),
        receipt: orderNumber,
        notes: {
            order_id: salesOrder.id,
            account_email: accountEmail,
            source: "whatsapp_flash_drop",
            drop_id: record.id,
            reservation_id: reservation.id,
        },
    });

    if (!gateway.configured || !gateway.orderId) {
        await client
            .collection("sales_orders")
            .update(salesOrder.id, {
                status: "cancelled",
                internal_notes: [
                    String(salesOrder.internal_notes || ""),
                    `[flash-drop] Gateway order creation failed: ${gateway.error || "unknown"}`,
                ]
                    .filter(Boolean)
                    .join("\n"),
            })
            .catch(() => {});
        return NextResponse.json(
            { success: false, error: gateway.error || "Online payment is unavailable right now." },
            { status: 503, headers: CORS_HEADERS }
        );
    }

    await client
        .collection("sales_orders")
        .update(salesOrder.id, {
            gateway: "razorpay",
            gateway_order_id: gateway.orderId,
            payment_method: "razorpay_online",
        })
        .catch(async () => {
            // A lost unique race on gateway_order_id means another request
            // already attached a gateway order to this document.
        });

    return NextResponse.json(
        {
            success: true,
            orderId: salesOrder.id,
            orderNumber,
            gateway: {
                orderId: gateway.orderId,
                amountPaise: gateway.amountPaise,
                currency: gateway.currency || "INR",
                keyId: gateway.keyId || "",
            },
            amount: Number(salesOrder.total || total),
            customerName: String(body.name || ""),
            customerPhone: phone,
        },
        { status: 200, headers: CORS_HEADERS }
    );
}

async function handleOrderConfirmation(
    client: TenantClient,
    accountEmail: string,
    body: FlashDropRequest,
    phone: string,
    ip: string
): Promise<NextResponse> {
    if (!checkLimit(`ip:order:${ip}`, 30) || (phone && !checkLimit(`order:${accountEmail}:${phone}`, 10))) {
        return NextResponse.json(
            { success: false, error: "Too many payment attempts. Please wait a few minutes." },
            { status: 429, headers: CORS_HEADERS }
        );
    }

    const orderId = String(body.orderId || "").trim();
    const paymentId = String(body.paymentId || "").trim();
    if (!orderId || !paymentId) {
        // Fail closed: an order is never confirmed without a payment id.
        return NextResponse.json(
            { success: false, error: "A verified payment is required to confirm this order." },
            { status: 402, headers: CORS_HEADERS }
        );
    }

    const order = await client.collection("sales_orders").getOne(orderId).catch(() => null);
    if (!order || !belongsToTenant(order as { account_email?: string }, accountEmail)) {
        return NextResponse.json({ success: false, error: "Order not found." }, { status: 404, headers: CORS_HEADERS });
    }
    if (String(order.capture_source || "") !== "whatsapp_flash_drop") {
        return NextResponse.json(
            { success: false, error: "This order does not belong to a flash drop." },
            { status: 403, headers: CORS_HEADERS }
        );
    }
    const orderPhone = phoneLast10(String(order.customer_phone || ""));
    if (phone && orderPhone && orderPhone !== phone) {
        return NextResponse.json(
            { success: false, error: "This order belongs to a different phone number." },
            { status: 403, headers: CORS_HEADERS }
        );
    }

    if (String(order.payment_status || "").toUpperCase() === "PAID") {
        return NextResponse.json(
            { success: true, settled: true, duplicate: true, orderId: order.id, orderNumber: order.order_number },
            { status: 200, headers: CORS_HEADERS }
        );
    }

    const gatewayOrderId = String(order.gateway_order_id || "");
    if (!gatewayOrderId) {
        return NextResponse.json(
            { success: false, error: "This order has no gateway payment to confirm." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    // One gateway payment settles one order, even if the tuple is replayed.
    const replayed = await client
        .collection("sales_orders")
        .getList(1, 1, {
            filter: `gateway_payment_id = "${sanitizeFilter(paymentId)}" && id != "${sanitizeFilter(order.id)}"`,
        })
        .catch(() => null);
    if (replayed && replayed.items.length > 0) {
        return NextResponse.json(
            { success: false, error: "This payment has already been used to settle another order." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    const signature = String(body.signature || "");
    if (signature) {
        const signatureOk = verifyGatewaySignature({ orderId: gatewayOrderId, paymentId, signature });
        if (!signatureOk) {
            return NextResponse.json(
                { success: false, error: "The payment signature is not valid." },
                { status: 409, headers: CORS_HEADERS }
            );
        }
    }

    // Verify with the gateway itself: the signature only proves the tuple, not
    // capture state or amount.
    const payment = await fetchGatewayPayment(paymentId);
    if (payment.error) {
        return NextResponse.json(
            {
                success: false,
                error: `Payment could not be verified with the gateway (${payment.error}). Contact support with payment id ${paymentId}.`,
            },
            { status: 502, headers: CORS_HEADERS }
        );
    }
    const statusOk = payment.status === "captured";
    const orderOk = payment.orderId === gatewayOrderId;
    const amountOk = Math.abs(Number(payment.amountPaise || 0) - Math.round(Number(order.total || 0) * 100)) <= 1;
    if (!(statusOk && orderOk && amountOk)) {
        return NextResponse.json(
            { success: false, error: "The payment does not match this order; it was not settled." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    // Deduct variant stock through the unified channel ledger. The order id is
    // the ledger reference, so a retried confirmation cannot deduct twice.
    const orderItems = await client.collection("sales_order_items").getFullList({
        filter: `order = "${sanitizeFilter(order.id)}"`,
    }).catch(() => []);
    const lines = orderItems
        .filter((row) => row.product)
        .map((row) => ({
            productId: String(row.product),
            variantId: row.variant ? String(row.variant) : undefined,
            quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)),
            name: String(row.description || ""),
        }));

    if (lines.length === 0) {
        await client
            .collection("sales_orders")
            .update(order.id, {
                payment_status: "PAID",
                gateway_payment_id: paymentId,
                internal_notes: [
                    String(order.internal_notes || ""),
                    `[flash-drop] Payment captured but the order has no line items; settlement paused for manual reconciliation.`,
                ]
                    .filter(Boolean)
                    .join("\n"),
            })
            .catch(() => {});
        return NextResponse.json(
            {
                success: false,
                error: "Your payment was received but the order needs manual review. Our team will contact you.",
            },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    try {
        await applyChannelStock(toStockDb(client), lines, {
            accountEmail,
            channel: "storefront",
            referenceId: order.id,
            notes: `Flash drop paid order ${order.order_number || order.id}`,
        });
    } catch (stockErr) {
        const message =
            stockErr instanceof InsufficientStockError
                ? stockErr.message
                : (stockErr as Error)?.message || "stock could not be reserved";
        // The money is real even when the hold is gone; record the payment and
        // leave the order for manual reconciliation rather than confirming an
        // order that cannot be fulfilled.
        await client
            .collection("sales_orders")
            .update(order.id, {
                payment_status: "PAID",
                gateway_payment_id: paymentId,
                internal_notes: [
                    String(order.internal_notes || ""),
                    `[flash-drop] Payment captured but stock deduction failed (${message}); manual reconciliation required.`,
                ]
                    .filter(Boolean)
                    .join("\n"),
            })
            .catch(() => {});
        return NextResponse.json(
            {
                success: false,
                error: "Your payment was received but the item just went out of stock. Our team will contact you to fulfil or refund it.",
            },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    // Settlement marks PAID/confirmed, raises the invoice, and credits CRM
    // aggregates + loyalty exactly once. It sees the stock movements above and
    // will not deduct a second time.
    const settled = await settleCapturedOrder(order.id, {
        paymentId,
        tenantEmail: accountEmail,
        client,
    });
    if (!settled.success) {
        return NextResponse.json(
            { success: false, error: settled.error || "The payment was verified but the order could not be settled." },
            { status: 409, headers: CORS_HEADERS }
        );
    }

    // Complete the hold that belongs to this order. Best effort: the sale is
    // already durable and the paid stock movement is the authority.
    const orderNumber = String(order.order_number || "");
    if (orderNumber.startsWith("ORD-FD-")) {
        const reservationId = orderNumber.slice("ORD-FD-".length);
        const reservation = await client
            .collection(RESERVATION_COLLECTION)
            .getOne(reservationId)
            .catch(() => null);
        if (reservation && belongsToTenant(reservation as { account_email?: string }, accountEmail)) {
            await client
                .collection(RESERVATION_COLLECTION)
                .update(reservationId, { status: "completed", order: order.id })
                .catch(() => {});
        }
    }

    return NextResponse.json(
        {
            success: true,
            settled: true,
            orderId: order.id,
            orderNumber: order.order_number,
            amount: Number(order.total || 0),
        },
        { status: 200, headers: CORS_HEADERS }
    );
}
