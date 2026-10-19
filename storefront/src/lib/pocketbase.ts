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
    base_metal: string; // e.g., "Skin-Safe Brass & Copper Alloy"
    plating_type: string; // e.g., "22K Micro Gold Plated", "Antique Matte", "Rhodium"
    stone_type?: string; // e.g., "Kemp Stones", "AAA Zircon", "Uncut Kundan"
    occasion?: string;
    care_instructions?: string;
}

export interface StorefrontCartItem {
    product: StorefrontProduct;
    quantity: number;
}

export interface StorefrontOrderInput {
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
    assignedCourier?: string; // e.g., "BlueDart Express via Shiprocket"
}

/**
 * Fetch imitation jewellery products for storefront with channel pricing & omnichannel stock calculations
 */
export async function getStorefrontCatalog(adminEmail?: string): Promise<StorefrontProduct[]> {
    try {
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
            const mrp = Math.round(websitePrice * 1.35); // 35% festive markup for strikethrough

            let stock_status: "in_stock" | "low_stock" | "out_of_stock" = "in_stock";
            if (totalStock <= 0) stock_status = "out_of_stock";
            else if (totalStock <= 3) stock_status = "low_stock";

            const rawCat = rec.expand?.category?.name || rec.category;
            const cleanCategory = (rawCat && !rawCat.startsWith("iq") && rawCat.length < 50) ? rawCat : "Necklace Sets";

            // Gracefully handle images: prefer base64 image_data or clean web URLs, avoiding broken WhatsApp CDN tokens
            const resolvedImage = (rec.image_data && rec.image_data.length > 20)
                ? rec.image_data
                : (rec.image_url && !rec.image_url.includes("whatsapp.net") ? rec.image_url : "");

            return {
                id: rec.id,
                sku: rec.sku,
                name: rec.name,
                category: cleanCategory,
                sub_style: (rec.sub_style as any) || "Temple",
                description: rec.description,
                base_price: rec.base_price,
                website_price: websitePrice,
                mrp,
                image_url: resolvedImage,
                total_stock: totalStock,
                stock_status,
                base_metal: rec.base_metal || "Lead & Nickel-Free Copper Alloy",
                plating_type: rec.plating_type || "22K Micro Gold Plated",
                stone_type: rec.stone_type || "Kemp / Uncut Kundan",
                occasion: rec.occasion || "Festive & Wedding",
                care_instructions: "Wipe with soft cloth. Avoid perfumes and direct moisture.",
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
 * Submit online order securely via ERP backend API route, falling back to PocketBase client
 */
export async function submitStorefrontOrder(order: StorefrontOrderInput) {
    const txnId = `ORD-${Date.now().toString(36).toUpperCase()}`;

    // 1. Primary: Secure Server-Side Order Intake via ERP API
    try {
        const res = await fetch(getStorefrontApiUrl("/api/storefront/order"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(order),
        });

        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                return { success: true, orderId: data.orderId, txnId: data.txnId };
            }
        }
    } catch (apiErr) {
        console.warn("[Storefront] Server order endpoint unreachable, trying PocketBase direct:", apiErr);
    }

    // 2. Secondary: Direct PocketBase creation if reachable
    try {
        const sale = await pb.collection("sales").create({
            channel: "website",
            channel_order_id: txnId,
            customer_name: order.customerName,
            customer_phone: order.customerPhone,
            customer_address: `${order.shippingAddress}, ${order.city} - ${order.pincode}`,
            subtotal: order.total,
            discount: order.discountAmount || 0,
            total: order.total,
            payment_method: order.paymentMethod,
            payment_id: order.razorpayPaymentId || "",
            status: order.paymentMethod === "razorpay_online" ? "paid" : "pending",
            notes: `Storefront Web Order [${order.paymentMethod.toUpperCase()}]. Courier: ${
                order.assignedCourier || "Smart Routing"
            }. Coupon: ${order.couponCode || "None"}.`,
        });

        // Deduct inventory
        for (const it of order.items) {
            await pb.collection("stock_movements").create({
                movement_type: "sale",
                quantity: -it.quantity,
                reference_id: sale.id,
                source: "website",
                notes: `Online order ${txnId}`,
            }).catch(() => {});
        }

        return { success: true, orderId: sale.id, txnId };
    } catch (err: any) {
        console.error("[Storefront] Direct order submission error:", err);
        throw new Error(
            "Could not finalize your order automatically. Please verify your internet connection or use 1-Click WhatsApp Concierge for instant confirmation."
        );
    }
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
