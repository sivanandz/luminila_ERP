import PocketBase from "pocketbase";
import { getStorefrontApiUrl } from "@/lib/api";

const DEFAULT_URL =
    process.env.NEXT_PUBLIC_POCKETBASE_URL ||
    (typeof window !== "undefined"
        ? window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
            ? "http://127.0.0.1:8091"
            : `${window.location.origin}/api/pb`
        : "http://127.0.0.1:8091");

export const pb = new PocketBase(DEFAULT_URL);
pb.autoCancellation(false);

export interface StorefrontProduct {
    id: string;
    sku: string;
    name: string;
    category?: string;
    sub_style?: "Temple" | "Kundan" | "Antique" | "Zircon" | "Bridal";
    description?: string;
    base_price: number;
    website_price: number;
    mrp: number; // Strikethrough comparison
    image_url?: string;
    total_stock: number;
    stock_status: "in_stock" | "low_stock" | "out_of_stock";
    /** Sellable units for this product. Checkout must send a variant id when there is more than one. */
    variants: StorefrontVariant[];
    base_metal: string; // e.g., "Skin-Safe Brass & Copper Alloy"
    plating_type: string; // e.g., "22K Micro Gold Plated", "Antique Matte", "Rhodium"
    stone_type?: string; // e.g., "Kemp Stones", "AAA Zircon", "Uncut Kundan"
    occasion?: string;
    care_instructions?: string;
}

export interface StorefrontVariant {
    id: string;
    label: string;
    stock_level: number;
}

export interface StorefrontCartItem {
    product: StorefrontProduct;
    quantity: number;
    /** Chosen sellable variant. Required by the order API for multi-variant products. */
    variantId?: string;
    variantLabel?: string;
}

/** Stable identity for a cart line: one product can appear once per variant. */
export function cartLineKey(item: Pick<StorefrontCartItem, "product" | "variantId">): string {
    return `${item.product.id}:${item.variantId || "base"}`;
}

function variantLabel(v: any): string {
    const label = [v.variant_name, v.size, v.color, v.purity_karat ? `${v.purity_karat}K` : ""]
        .filter(Boolean)
        .join(" · ");
    return label || v.sku_suffix || `Variant ${String(v.id || "").slice(-4)}`;
}

export interface StorefrontOrderInput {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    shippingAddress: string;
    city: string;
    state?: string;
    pincode: string;
    items: {
        productId: string;
        /** Required when the product has more than one variant. */
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
    assignedCourier?: string; // e.g., "BlueDart Express via Shiprocket"
    /** Shipping (+ COD handling) charged at checkout, in rupees. */
    shippingCharges?: number;
    /** UTM attribution captured from the landing URL. */
    campaign?: string;
    /** Marketing consent captured at checkout (DPDP). */
    marketingConsent?: boolean;
    /** B2B billing identity (A3/A4). */
    companyName?: string;
    gstin?: string;
    billingSameAsShipping?: boolean;
    billingAddress?: string;
    billingCity?: string;
    billingState?: string;
    billingPincode?: string;
    /** Stable per-checkout key so a retried submit cannot double-order. */
    idempotencyKey?: string;
}

/**
 * Fetch imitation jewellery products for storefront with channel pricing & omnichannel stock calculations
 */
export async function getStorefrontCatalog(adminEmail?: string): Promise<StorefrontProduct[]> {
    try {
        // Primary: the ERP's public catalog route. `products` is tenant-locked,
        // so an anonymous storefront visitor cannot read it directly — the ERP
        // serves the bound tenant's active listings server-side.
        try {
            const url = adminEmail
                ? getStorefrontApiUrl(`/api/storefront/catalog?account_email=${encodeURIComponent(adminEmail)}`)
                : getStorefrontApiUrl("/api/storefront/catalog");
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data?.success && Array.isArray(data.products) && data.products.length > 0) {
                    return data.products as StorefrontProduct[];
                }
            }
        } catch (routeErr) {
            console.warn("[Storefront] Catalog route unreachable, falling back to direct PB:", routeErr);
        }

        // Secondary: direct PocketBase read — only works for sessions whose
        // auth email matches the tenant (operator previews).
        const filter = adminEmail && adminEmail.trim()
            ? `is_active = true && account_email = "${adminEmail.trim()}"`
            : "is_active = true";

        const records = await pb.collection("products").getFullList({
            filter,
            sort: "-created",
            expand: "category",
        });

        if (!records || records.length === 0) {
            return [];
        }

        const variants = await pb.collection("product_variants").getFullList().catch(() => []);

        return records.map((rec: any) => {
            const productVariants = variants.filter((v: any) => v.product === rec.id);
            const totalStock = productVariants.reduce(
                (sum: number, v: any) => sum + (Number(v.stock_level) || 0),
                Number(rec.stock_level) || 0
            );

            // Channel pricing: check if website custom rate exists
            const channelPrices = rec.channel_prices || {};
            const websitePrice = Number(channelPrices.website) || Number(rec.base_price) || 0;
            const mrp = websitePrice;

            let stock_status: "in_stock" | "low_stock" | "out_of_stock" = "in_stock";
            if (totalStock <= 0) stock_status = "out_of_stock";
            else if (totalStock <= 3) stock_status = "low_stock";

            const rawCat = rec.expand?.category?.name || rec.category;
            const cleanCategory =
                rawCat && !rawCat.startsWith("iq") && rawCat.length < 50
                    ? rawCat
                    : "Jewellery";

            // Gracefully handle images: prefer base64 image_data or clean web URLs, avoiding broken WhatsApp CDN tokens
            const resolvedImage = (rec.image_data && rec.image_data.length > 20)
                ? rec.image_data
                : (rec.image_url && !rec.image_url.includes("whatsapp.net") ? rec.image_url : "");

            return {
                id: rec.id,
                sku: rec.sku,
                name: rec.name,
                category: cleanCategory,
                sub_style: (rec.sub_style as any) || rec.craft || "",
                description: rec.description,
                base_price: rec.base_price,
                website_price: websitePrice,
                mrp,
                image_url: resolvedImage,
                total_stock: totalStock,
                stock_status,
                variants: productVariants.map((v: any) => ({
                    id: v.id,
                    label: variantLabel(v),
                    stock_level: Math.max(0, Number(v.stock_level) || 0),
                })),
                base_metal: rec.base_metal || "",
                plating_type: rec.plating_type || rec.plating || "",
                stone_type: rec.stone_type || "",
                occasion: rec.occasion || "",
                care_instructions: rec.care_instructions || "",
            };
        });
    } catch (err) {
        console.warn("Failed to load storefront products:", err);
        return [];
    }
}

export interface InventoryCategoryNode {
    name: string;
    slug: string;
    totalCount: number;
    subcategories: {
        name: string;
        slug: string;
        count: number;
    }[];
}

/**
 * Intelligently extract active categories and subcategories based strictly on in-stock inventory
 */
export function extractInventoryCategories(products: StorefrontProduct[]): InventoryCategoryNode[] {
    const map = new Map<string, { count: number; subMap: Map<string, number> }>();

    for (const p of products) {
        // Only count products with available stock
        if (p.total_stock <= 0 && p.stock_status === "out_of_stock") continue;

        const cat = p.category?.trim() || "Jewellery";
        if (!map.has(cat)) {
            map.set(cat, { count: 0, subMap: new Map() });
        }
        const entry = map.get(cat)!;
        entry.count += 1;

        if (p.sub_style) {
            const sub = p.sub_style.trim();
            entry.subMap.set(sub, (entry.subMap.get(sub) || 0) + 1);
        }
    }

    const result: InventoryCategoryNode[] = [];
    for (const [catName, { count, subMap }] of map.entries()) {
        const subcategories = Array.from(subMap.entries())
            .map(([subName, subCount]) => ({
                name: subName,
                slug: subName.toLowerCase(),
                count: subCount,
            }))
            .sort((a, b) => b.count - a.count);

        result.push({
            name: catName,
            slug: catName.toLowerCase(),
            totalCount: count,
            subcategories,
        });
    }

    return result.sort((a, b) => b.totalCount - a.totalCount);
}


/**
 * Submit the order to the ERP intake route.
 *
 * The route is the only writer: it authenticates the customer session, re-prices
 * every line, re-computes discounts and tax, and owns stock and idempotency.
 * There is deliberately no direct-PocketBase fallback: a client-trusted write
 * would bypass all of those guards (capture analysis §12.4.2 A41/A49).
 *
 * Throws an `OrderSubmissionError` carrying the HTTP status and any stock
 * shortages the route reported, so the checkout UI can tell the customer what
 * to do next.
 */
export class OrderSubmissionError extends Error {
    readonly status: number;
    readonly shortages?: unknown;
    constructor(message: string, status: number, shortages?: unknown) {
        super(message);
        this.name = "OrderSubmissionError";
        this.status = status;
        this.shortages = shortages;
    }
}

function customerSessionToken(): string | null {
    if (typeof window === "undefined") return null;
    try {
        return localStorage.getItem("luminila_storefront_token");
    } catch {
        return null;
    }
}

export async function submitStorefrontOrder(order: StorefrontOrderInput) {
    const token = customerSessionToken();
    if (!token) {
        throw new OrderSubmissionError(
            "Please verify your WhatsApp number before placing the order.",
            401
        );
    }

    let res: Response;
    try {
        res = await fetch(getStorefrontApiUrl("/api/storefront/order"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(order),
        });
    } catch {
        throw new OrderSubmissionError(
            "Could not reach the order service. Check your connection and retry — if you already paid, retrying is safe.",
            0
        );
    }

    let data: any = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }

    if (!res.ok || !data?.success) {
        const fallback =
            res.status === 401
                ? "Your session expired. Verify your WhatsApp number again, then retry."
                : res.status === 409
                  ? "One of the items just went out of stock. Refresh your bag and retry."
                  : "The order could not be recorded. Please retry.";
        throw new OrderSubmissionError(data?.error || fallback, res.status, data?.shortages);
    }

    return {
        success: true as const,
        orderId: String(data.orderId || ""),
        txnId: String(data.txnId || ""),
        duplicate: Boolean(data.duplicate),
    };
}

export interface StorefrontGatewayOrder {
    orderId: string;
    amountPaise?: number;
    currency?: string;
    keyId?: string;
}

async function postStorefrontOrder<T>(
    payload: Record<string, unknown>,
    failure: string
): Promise<T> {
    const token = customerSessionToken();
    if (!token) {
        throw new OrderSubmissionError(
            "Please verify your WhatsApp number before placing the order.",
            401
        );
    }
    let res: Response;
    try {
        res = await fetch(getStorefrontApiUrl("/api/storefront/order"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });
    } catch {
        throw new OrderSubmissionError(
            "Could not reach the order service. Check your connection and retry — a retry is safe.",
            0
        );
    }
    let data: any = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    if (!res.ok || !data?.success) {
        throw new OrderSubmissionError(data?.error || failure, res.status, data?.shortages);
    }
    return data as T;
}

/**
 * CO-05 prepare phase: create the ERP order (draft) and the Razorpay order whose
 * notes carry the ERP order id. The customer is charged only after this exists,
 * so a captured payment can always be mapped back and settled exactly once.
 */
export async function prepareStorefrontOrder(order: StorefrontOrderInput): Promise<{
    orderId: string;
    txnId: string;
    duplicate?: boolean;
    gateway: StorefrontGatewayOrder;
}> {
    const data = await postStorefrontOrder<any>(
        { ...order, paymentMethod: "razorpay_online", prepareGateway: true },
        "The order could not be prepared for payment. Please retry or use Cash on Delivery."
    );
    if (!data.gateway?.orderId) {
        throw new OrderSubmissionError(
            "Online payment is not configured on this store. Please choose Cash on Delivery or WhatsApp Concierge.",
            503
        );
    }
    return {
        orderId: String(data.orderId || ""),
        txnId: String(data.txnId || ""),
        duplicate: Boolean(data.duplicate),
        gateway: data.gateway as StorefrontGatewayOrder,
    };
}

/** CO-05 confirm phase: verify the checkout payment and settle the order once. */
export async function confirmStorefrontPayment(params: {
    orderId: string;
    paymentId: string;
    razorpayOrderId?: string;
    signature?: string;
}): Promise<{ orderId: string; txnId: string; settled: boolean; duplicate?: boolean }> {
    const data = await postStorefrontOrder<any>(
        { confirmPayment: params },
        "The payment could not be confirmed. Contact support with your payment id."
    );
    return {
        orderId: String(data.orderId || params.orderId),
        txnId: String(data.txnId || ""),
        settled: Boolean(data.settled),
        duplicate: Boolean(data.duplicate),
    };
}

/**
 * Format WhatsApp Concierge message string for instant checkout
 */
export function formatWhatsAppCartMessage(
    cart: StorefrontCartItem[],
    customer: { name: string; phone: string; address: string; city: string; pincode: string },
    total: number,
    coupon?: string,
    brandName?: string
): string {
    const brand = (brandName || "Fashion Atelier").toUpperCase();
    const lines = [
        `✨ *NEW ORDER - ${brand}* ✨`,
        `───────────────────────`,
        `👤 *Customer:* ${customer.name}`,
        `📞 *Phone:* ${customer.phone}`,
        `📍 *Delivery Address:*`,
        `${customer.address}`,
        `${customer.city} - ${customer.pincode}`,
        `───────────────────────`,
        `🛍️ *ORDER ITEMS:*`,
        ...cart.map(
            (c, i) =>
                `${i + 1}. *${c.product.name}*\n   SKU: \`${c.product.sku}\` | Style: ${c.product.sub_style || "Designer"} | Qty: ${c.quantity} | ₹${(c.product.website_price * c.quantity).toLocaleString("en-IN")}`
        ),
        coupon ? `🎟️ *Applied Coupon:* ${coupon}` : "",
        `───────────────────────`,
        `💰 *TOTAL AMOUNT:* ₹${total.toLocaleString("en-IN")}`,
        `📦 *Shipping:* Express Multi-Courier via Shiprocket`,
        `───────────────────────`,
        `Please confirm stock & share payment link! 💖`,
    ].filter(Boolean);
    return encodeURIComponent(lines.join("\n"));
}
