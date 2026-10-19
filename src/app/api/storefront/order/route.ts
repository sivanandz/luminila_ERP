import { NextResponse } from "next/server";
import { pb, ensureServerAuth } from "@/lib/pocketbase";

// Rate limiter: max 5 orders per 10 minutes per clean phone number
const orderRateLimit = new Map<string, { count: number; firstSeen: number }>();
function checkRateLimit(phone: string): boolean {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
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
    shippingAddress: string;
    city: string;
    pincode: string;
    items: {
        productId: string;
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
    accountEmail?: string;
}

function generateTxnId(): string {
    const today = new Date();
    const dateStr = today.toISOString().slice(2, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${dateStr}-${rand}`;
}

export async function POST(req: Request) {
    try {
        const body: StorefrontOrderPayload = await req.json();

        // 1. Validation
        if (!body.customerName || !body.customerPhone || !body.items || body.items.length === 0) {
            return NextResponse.json(
                { success: false, error: "Missing required order details (customer info or items)." },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        const cleanPhoneDigits = (body.customerPhone || "").replace(/\D/g, "");
        if (!checkRateLimit(cleanPhoneDigits)) {
            return NextResponse.json(
                { success: false, error: "Too many orders placed recently. Please wait a few minutes before trying again." },
                { status: 429, headers: CORS_HEADERS }
            );
        }

        const txnId = generateTxnId();
        let persistedOrderId: string = txnId;
        let pbSyncSuccess = false;

        // Resolve bound admin account from PocketBase store_settings for data isolation
        let boundAdminEmail = (body.accountEmail || "").trim().toLowerCase();
        let boundDomain = "storefront";
        try {
            await ensureServerAuth();
            const cmsFilter = boundAdminEmail
                ? `key="storefront_content" && account_email="${boundAdminEmail}"`
                : `key="storefront_content"`;
            const cmsRecord = await pb.collection("store_settings").getFirstListItem(cmsFilter).catch(() => null);
            if (cmsRecord && cmsRecord.value) {
                const cms = typeof cmsRecord.value === "string" ? JSON.parse(cmsRecord.value) : cmsRecord.value;
                if (cms.adminBinding?.boundAdminEmail) {
                    boundAdminEmail = cms.adminBinding.boundAdminEmail;
                }
                if (cms.adminBinding?.customDomain) {
                    boundDomain = cms.adminBinding.customDomain;
                }
            }
        } catch {}

        if (!boundAdminEmail) {
            boundAdminEmail = "admin@store.local";
        }

        // 2. Attempt Database Sync via PocketBase
        try {
            await ensureServerAuth();

            // Find or create customer
            const cleanPhone = body.customerPhone.replace(/\D/g, "");
            let customerId = "";

            try {
                const existing = await pb.collection("customers").getFirstListItem(
                    `phone ~ "${cleanPhone.slice(-10)}" && account_email = "${boundAdminEmail}"`
                );
                if (existing) customerId = existing.id;
            } catch {}

            if (!customerId) {
                try {
                    const newCust = await pb.collection("customers").create({
                        name: body.customerName,
                        phone: cleanPhone,
                        address: body.shippingAddress,
                        city: body.city,
                        pincode: body.pincode,
                        customer_type: "retail",
                        source: "website",
                        account_email: boundAdminEmail,
                    });
                    customerId = newCust.id;
                } catch {}
            }

            // Validate items and verify pricing from database
            let calculatedSubtotal = 0;
            const validatedItems: {
                productId: string;
                sku: string;
                name: string;
                price: number;
                quantity: number;
            }[] = [];

            for (const item of body.items) {
                const qty = Math.max(1, Math.min(100, Math.floor(Number(item.quantity) || 1)));
                let verifiedPrice = Number(item.price) || 0;

                try {
                    const dbProd = await pb.collection("products").getOne(item.productId);
                    if (dbProd) {
                        const channelPrices = (dbProd as any).channel_prices || {};
                        verifiedPrice = Number(channelPrices.website) || Number(dbProd.base_price) || verifiedPrice;
                    }
                } catch {
                    // product lookup fallback
                }

                calculatedSubtotal += verifiedPrice * qty;
                validatedItems.push({
                    productId: item.productId,
                    sku: item.sku || "",
                    name: item.name || "Jewelry Item",
                    price: verifiedPrice,
                    quantity: qty,
                });
            }

            const verifiedDiscount = Math.max(0, Math.min(calculatedSubtotal, Number(body.discountAmount) || 0));
            const calculatedTotal = Math.max(0, calculatedSubtotal - verifiedDiscount);

            // Online orders remain PENDING until Razorpay webhook confirms payment
            const orderStatus = "pending";
            const paymentStatus = "PENDING";

            // Create official Sales Order bound to single admin account
            const salesOrder = await pb.collection("sales_orders").create({
                order_number: txnId,
                order_type: "sales_order",
                customer: customerId,
                customer_name: body.customerName,
                customer_phone: cleanPhone,
                shipping_address: `${body.shippingAddress}, ${body.city} - ${body.pincode}`,
                order_date: new Date().toISOString(),
                status: orderStatus,
                subtotal: calculatedSubtotal,
                discount_total: verifiedDiscount,
                shipping_charges: 0,
                total: calculatedTotal,
                payment_status: paymentStatus,
                payment_method: body.paymentMethod,
                account_email: boundAdminEmail,
                notes: `Storefront Web Order [${body.paymentMethod.toUpperCase()} | Domain: ${boundDomain} | Admin: ${boundAdminEmail}]. Courier: ${
                    body.assignedCourier || "Smart Routing"
                }. Coupon: ${body.couponCode || "None"}. Txn: ${body.razorpayPaymentId || "N/A"}`,
            });

            persistedOrderId = salesOrder.id;

            // Create Sales Order Items
            for (const item of validatedItems) {
                await pb.collection("sales_order_items").create({
                    order: salesOrder.id,
                    product: item.productId,
                    description: `${item.name} (${item.sku})`,
                    quantity: item.quantity,
                    unit_price: item.price,
                    total: item.price * item.quantity,
                    account_email: boundAdminEmail,
                }).catch(() => {});

                // Record Inventory stock movement for COD/offline orders (online orders deduct when confirmed paid via webhook)
                if (body.paymentMethod !== "razorpay_online") {
                    await pb.collection("stock_movements").create({
                        product: item.productId,
                        movement_type: "sale",
                        quantity: -item.quantity,
                        reference_id: salesOrder.id,
                        source: "website",
                        notes: `Web checkout order ${txnId} [Domain: ${boundDomain}]`,
                        account_email: boundAdminEmail,
                    }).catch(() => {});
                }
            }

            // Also create POS sales record for unified daily revenue reporting
            await pb.collection("sales").create({
                channel: "website",
                channel_order_id: txnId,
                customer_name: body.customerName,
                customer_phone: cleanPhone,
                customer_address: `${body.shippingAddress}, ${body.city} - ${body.pincode}`,
                subtotal: calculatedSubtotal,
                discount: verifiedDiscount,
                total: calculatedTotal,
                payment_method: body.paymentMethod,
                payment_id: body.razorpayPaymentId || "",
                status: "pending",
                notes: `Storefront Web Order ${txnId} [Domain: ${boundDomain}]`,
                account_email: boundAdminEmail,
            }).catch(() => {});

            pbSyncSuccess = true;
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
