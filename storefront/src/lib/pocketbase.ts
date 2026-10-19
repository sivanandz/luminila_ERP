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
            // If scoped to a specific admin tenant, return empty if no products yet, else fallback to sample
            return adminEmail ? [] : SAMPLE_CATALOG;
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
        console.warn("Using fallback Kushal's-style imitation jewellery catalog:", err);
        return SAMPLE_CATALOG;
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

const SAMPLE_CATALOG: StorefrontProduct[] = [
    {
        id: "stitch_padmavati_01",
        sku: "LUM-PADMAVATI-CHOKER",
        name: "The Padmavati Polki Choker Suite",
        category: "Chokers",
        sub_style: "Kundan",
        description:
            "Jaipur Jadau Atelier masterpiece. 420 Carats equivalent handcrafted with uncut glass polki, 2.5-micron 24K gold immersion plating, and authentic hand-crimped bezel setting.",
        base_price: 18499,
        website_price: 18499,
        mrp: 24500,
        image_url:
            "https://lh3.googleusercontent.com/aida-public/AB6AXuDrakmGTGgsMQBOqrDQYZ1-L6ao6f7F1q7P2RTmEF6pY1r2sCKiQAkGf74zaJ9xqXCEI9jDWo1deUjg9kmfjW61tk9kU-N6m9gadEKxrrY8OnAmlxnkY0QU0QR5R58Enn-QGqnFWSNukRu8Xu2ZmXmECTFVOUXxPPXwg2uB1Um8gbEAW9hSKPAw2P_p4_D5wG3ANmzXl3PNrROUMd-OQJ4881lC8jSO2NxZnpepVcyHdCZk265Z9jUL",
        total_stock: 4,
        stock_status: "in_stock",
        base_metal: "Natural Brass & Nickel-Free Core",
        plating_type: "2.5 Micron 24K Immersion Gold",
        stone_type: "Uncut Glass Polki & Emerald Droplets",
        occasion: "Bridal / Royal Wedding",
    },
    {
        id: "stitch_mehrunisa_02",
        sku: "LUM-MEHRUNISA-SET",
        name: "Mehrunisa Royal Kundan Choker Set",
        category: "Chokers",
        sub_style: "Kundan",
        description:
            "Jaipur Hand-Crimped bridal set with matching Chandbalis & Maangtikka. Genuine Colombian emerald simulated briolettes on 2.5μm 24K gold vermeil.",
        base_price: 16800,
        website_price: 16800,
        mrp: 21000,
        image_url:
            "https://lh3.googleusercontent.com/aida-public/AB6AXuDCkZQnHTOTUa6tuDv1N21diFtzmfiTpCkI7uffir6_Nz6DndV7n63eKHxwhGC4WIXW-HXHCXtlUKFznpnzmlhoG3RpKrx5RG12AhJsox16McVg9MUBJdoM5bhEHKNHGcvt2oQEFFidoA0NkT4FqI2Kr_0Yo8hE4-LRvFlPLbGdrwSIpspg4NOFXbzjDEV4r7hhNiUDaxCK0kLORypKbeaOpwK7WOV0CNztJ9UaWdQZitpmkEnrFNZi",
        total_stock: 5,
        stock_status: "in_stock",
        base_metal: "Skin-Friendly Alloy (Lead & Nickel Free)",
        plating_type: "2.5 Micron 24K Gold Plating",
        stone_type: "Foil-Backed Glass Polki & Emerald Drops",
        occasion: "Bridal / Sangeet",
    },
    {
        id: "stitch_rani_sahiba_03",
        sku: "LUM-RANI-SAHIBA-MALA",
        name: "Rani Sahiba 7-Layered Pearl Mala",
        category: "Necklaces",
        sub_style: "Antique",
        description:
            "Hyderabad Nizam Series 7-layered necklace. Graduated high-luster natural shell pearls with gold-vermeil floral spacers and grand Jadau polki locket centerpiece.",
        base_price: 12500,
        website_price: 12500,
        mrp: 15200,
        image_url:
            "https://lh3.googleusercontent.com/aida-public/AB6AXuCBJ-PV_XEDHY8oyx24WLV87c8eHkf4-tdITMYBdCN8QfChuqjm5obpFjyz_cZesqw2CsJPUJzM5OPLJbDIvC-OJLZPqVyXRBLobSF38JeZhkfGr2rkDwmCN3t5PyokY6qQ-II0ih7CV8DV0v4lh-V7kWLHz-z5v2hqXYbBCRwv0v6g-IQ26D-AckXFHROSCndXLuKZpO3Zxg36s3ooOQwLFZnpVfXrfamv7p-CupRwcMpO4ahNfnCS",
        total_stock: 7,
        stock_status: "in_stock",
        base_metal: "Pure Brass Core",
        plating_type: "22K Antique Bullion Polish",
        stone_type: "Basra Shell Pearls & Jadau Polki",
        occasion: "Reception / Royal Evenings",
    },
    {
        id: "stitch_devi_temple_04",
        sku: "LUM-DEVI-TEMPLE-CHOKER",
        name: "Devi Temple Matte Vanki Choker",
        category: "Chokers",
        sub_style: "Temple",
        description:
            "Chettinad Heritage deep relief repoussé. Hand-engraved Goddess Lakshmi flanked by twin apsaras, ruby spinel cabochons, and heirloom South temple bell ghunghroos.",
        base_price: 9900,
        website_price: 9900,
        mrp: 12400,
        image_url:
            "https://lh3.googleusercontent.com/aida-public/AB6AXuDNPCZV5GRuwLHHFD0h2AI4fsxOT1xEiibH2CVXixw7CilNK7W5uEEq8Y62ZLseQwAKs_iX0vvTSozUd-XcI3pr7UVdrBMvHqeeTnIFqdIlapj4_anLISJIPLQss4-SQZLLo3XG3j66XtP9aw2DO0jr51RkKNMlUq2IkLy4LFpKX0kNHzsf7zCnbycs3gVW3inEEb9drhfE3_jGm8CdW2tZr2I3xACYfPvNsrxbJoZo2nI7UN0RX3KN",
        total_stock: 6,
        stock_status: "in_stock",
        base_metal: "Hypoallergenic Red Brass Core",
        plating_type: "22K Antique Saffron-Gold Matte",
        stone_type: "Synthetic Ruby Spinel & Kemp",
        occasion: "Muhurtham / Temple Wedding",
    },
    {
        id: "stitch_noor_chandbali_05",
        sku: "LUM-NOOR-CHANDBALI",
        name: "Noor Victorian Moissanite Chandbali",
        category: "Earrings",
        sub_style: "Zircon",
        description:
            "Pari-Regal Victorian chandelier earrings. Open-claw handset baguette moissanites with Russian emerald drops and featherweight surgical posts.",
        base_price: 6450,
        website_price: 6450,
        mrp: 8500,
        image_url:
            "https://lh3.googleusercontent.com/aida-public/AB6AXuD2cWI0yanfDDkT6MMYVWk27zaow_It1h3bWA5-yS1kDjznkm1HVsHgvKA_LiVKcyzgazTRjWLKHBNCg768efwa7tgwkk9jjhGtjDsyCsJCyVSuT9BYn2EFutRFm60p5eniUJGqD4IWRDTZoUXQA4g77njzaQow80FltawrmjjgKA-f-xUHNJ1CgjuGNqsEoU-4DVpHXlbxp431aNBmVYalHt2yFa9lM5sqyfcYmfIkkFV271Qvd6hr",
        total_stock: 8,
        stock_status: "in_stock",
        base_metal: "Silver Vermeil 92.5 & Brass",
        plating_type: "Rhodium Platinum & 24K Immersion",
        stone_type: "VVS Lab Moissanite & Russian Emerald",
        occasion: "Cocktail / Sangeet Night",
    },
    {
        id: "stitch_peacock_kada_06",
        sku: "LUM-PEACOCK-KADA-2PC",
        name: "Kundan Peacock Openable Kada Pair",
        category: "Bangles",
        sub_style: "Kundan",
        description: "Artisan openable kada bangles with hand-painted meenakari plumage and polki motifs.",
        base_price: 4899,
        website_price: 4899,
        mrp: 6500,
        image_url: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?q=80&w=1200&auto=format&fit=crop",
        total_stock: 9,
        stock_status: "in_stock",
        base_metal: "Copper & Brass Alloy",
        plating_type: "22K Micro Gold Plated",
        stone_type: "Glass Polki & Emerald Enamel",
        occasion: "Festive & Wedding",
    },
    {
        id: "stitch_temple_jhumka_07",
        sku: "LUM-TEMPLE-JHUMKA-01",
        name: "Matsya Antique Temple Jhumkas",
        category: "Earrings",
        sub_style: "Temple",
        description: "Authentic South temple motif jhumkas with hanging micro-pearl cluster drops.",
        base_price: 3450,
        website_price: 3450,
        mrp: 4800,
        image_url: "https://images.unsplash.com/photo-1630019852942-f89202989a59?q=80&w=1200&auto=format&fit=crop",
        total_stock: 12,
        stock_status: "in_stock",
        base_metal: "Hypoallergenic Brass Core",
        plating_type: "Antique Matte Gold Finish",
        stone_type: "Synthetic Kemp & Cultured Seed Pearls",
        occasion: "Temple / Festival",
    },
    {
        id: "stitch_meenakari_choker_08",
        sku: "LUM-MEENAKARI-CHOKER-01",
        name: "Virasat Meenakari Floral Choker",
        category: "Chokers",
        sub_style: "Antique",
        description: "Reversible jaali work choker necklace with ruby red enamel accents.",
        base_price: 8900,
        website_price: 8900,
        mrp: 11500,
        image_url: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=1200&auto=format&fit=crop",
        total_stock: 5,
        stock_status: "in_stock",
        base_metal: "Pure Brass Alloy",
        plating_type: "22K High-Grade Micron Gold",
        stone_type: "Foil Polki & Ruby Enamel",
        occasion: "Wedding / Reception",
    },
    {
        id: "stitch_temple_kasu_09",
        sku: "LUM-TEMPLE-KASU-MALA",
        name: "Devi Lakshmi Kasu Coin Long Mala",
        category: "Temple 22K Finish",
        sub_style: "Temple",
        description: "Traditional coin necklace with embossed Goddess Lakshmi coins and Kemp stone crown.",
        base_price: 11200,
        website_price: 11200,
        mrp: 14500,
        image_url: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?q=80&w=1200&auto=format&fit=crop",
        total_stock: 6,
        stock_status: "in_stock",
        base_metal: "Red Copper Brass Alloy",
        plating_type: "22K Antique Temple Polish",
        stone_type: "Kemp Cabochon",
        occasion: "Muhurtham / Wedding",
    },
    {
        id: "stitch_temple_vanki_10",
        sku: "LUM-TEMPLE-VANKI-02",
        name: "Matsya Carved Temple Armlet Vanki",
        category: "Temple 22K Finish",
        sub_style: "Temple",
        description: "South Indian traditional adjustable peacock armlet with ruby and emerald stones.",
        base_price: 5200,
        website_price: 5200,
        mrp: 7200,
        image_url: "https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?q=80&w=1200&auto=format&fit=crop",
        total_stock: 4,
        stock_status: "in_stock",
        base_metal: "Brass Core",
        plating_type: "22K Micro Gold Matte",
        stone_type: "Synthetic Emerald & Ruby",
        occasion: "Temple Festive",
    },
    {
        id: "stitch_bridal_navratna_11",
        sku: "LUM-BRIDAL-NAVRATNA-CHOKER",
        name: "Navratna Heritage Polki Bridal Choker",
        category: "Bridal Kundan",
        sub_style: "Bridal",
        description: "Nine auspicious cosmic gemstones arranged with uncut glass polki and cluster pearls.",
        base_price: 14900,
        website_price: 14900,
        mrp: 18900,
        image_url: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?q=80&w=1200&auto=format&fit=crop",
        total_stock: 3,
        stock_status: "low_stock",
        base_metal: "Natural Brass Core",
        plating_type: "24K Immersion Gold",
        stone_type: "Navratna Multicolored Gems & Glass Polki",
        occasion: "Bridal / Reception",
    },
    {
        id: "stitch_bridal_mathapatti_12",
        sku: "LUM-BRIDAL-MATHAPATTI-01",
        name: "Noorani Emerald Polki Mathapatti",
        category: "Bridal Kundan",
        sub_style: "Bridal",
        description: "Three-tier bridal headpiece with side hair strings and center dangling tikka.",
        base_price: 7800,
        website_price: 7800,
        mrp: 9900,
        image_url: "https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?q=80&w=1200&auto=format&fit=crop",
        total_stock: 5,
        stock_status: "in_stock",
        base_metal: "Hypoallergenic Brass Alloy",
        plating_type: "22K Micro Gold Plated",
        stone_type: "Glass Polki & Emerald Droplets",
        occasion: "Bridal Wedding",
    },
];

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
