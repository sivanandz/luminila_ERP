import { NextRequest, NextResponse } from "next/server";
import { resolveStorefrontTenant } from "@/lib/storefront-tenant";
import { getChannelPriceFromList } from "@/lib/pricing-rules";
import { loadTenantChannelDefinitions } from "@/lib/server-pricing";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-account-email",
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

interface CatalogProduct {
    id: string;
    sku: string;
    name: string;
    category?: string;
    sub_style?: string;
    description?: string;
    base_price: number;
    website_price: number;
    mrp: number;
    image_url?: string;
    total_stock: number;
    stock_status: "in_stock" | "low_stock" | "out_of_stock";
    variants: { id: string; label: string; stock_level: number }[];
    base_metal: string;
    plating_type: string;
    stone_type?: string;
    occasion?: string;
    care_instructions?: string;
    craft?: string;
    plating?: string;
}

/**
 * GET /api/storefront/catalog
 *
 * Public catalogue for the storefront: an anonymous visitor has no PB
 * credentials, and `products` is tenant-locked, so the server resolves the
 * tenant and serves only public-safe, active listings. Mirrors the
 * storefront app's StorefrontProduct shape exactly.
 *
 * Tenant resolution: explicit hint → the hosting registry's active tenant →
 * the primary database. The content route's default-binding fallback is
 * deliberately NOT used here — it can select an unrelated tenant (A25).
 */
export async function GET(req: NextRequest) {
    try {
        const hintEmail =
            req.nextUrl.searchParams.get("account_email") ||
            req.headers.get("x-account-email") ||
            undefined;

        // The storefront content's adminBinding is authoritative: the catalogue
        // must show the inventory of the tenant the CMS is actually bound to.
        const { email: boundAdminEmail, client } =
            await resolveStorefrontTenant(hintEmail);

        const channels = await loadTenantChannelDefinitions(client, boundAdminEmail);

        const products = await client.collection("products").getFullList<{
            id: string;
            sku: string;
            name: string;
            category?: string;
            sub_style?: string;
            description?: string;
            base_price: number;
            cost_price?: number;
            channel_prices?: Record<string, number>;
            image_data?: string;
            image_url?: string;
            total_stock?: number;
            craft?: string;
            plating?: string;
            occasion?: string;
            base_metal?: string;
            plating_type?: string;
            stone_type?: string;
            care_instructions?: string;
            is_active: boolean;
            account_email?: string;
            expand?: { category?: { name?: string } };
        }>({
            filter: client.filter("is_active = true && account_email = {:tenant}", {
                tenant: boundAdminEmail,
            }),
            sort: "-created",
            expand: "category",
        });

        const variants = await client
            .collection("product_variants")
            .getFullList<{ id: string; product: string; variant_name?: string; stock_level?: number; price_adjustment?: number }>()
            .catch(() => []);

        const catalogue: CatalogProduct[] = products.map((rec) => {
            const own = variants.filter((v) => v.product === rec.id);
            const totalStock =
                own.reduce((sum, v) => sum + (Number(v.stock_level) || 0), 0) ||
                Number(rec.total_stock) ||
                0;

            const channelPrices = rec.channel_prices || {};
            const websitePrice = getChannelPriceFromList(
                {
                    base_price: Number(rec.base_price) || 0,
                    cost_price: Number(rec.cost_price) || 0,
                    channel_prices: channelPrices,
                },
                "website",
                channels
            );

            let stockStatus: CatalogProduct["stock_status"] = "in_stock";
            if (totalStock <= 0) stockStatus = "out_of_stock";
            else if (totalStock <= 3) stockStatus = "low_stock";

            const firstImage =
                // Local asset path (seeded demo/managed uploads) or a data URI
                rec.image_data && (rec.image_data.startsWith("/") || rec.image_data.startsWith("data:"))
                    ? rec.image_data
                    : rec.image_url && !rec.image_url.includes("whatsapp.net")
                      ? rec.image_url
                      : "";

            return {
                id: rec.id,
                sku: rec.sku,
                name: rec.name,
                category: rec.expand?.category?.name || "",
                sub_style: rec.sub_style || rec.craft || "",
                description: rec.description || "",
                base_price: Number(rec.base_price) || 0,
                website_price: websitePrice,
                // There is no compare-at price in the inventory schema; never
                // invent a markup. The card only shows a strikethrough when a
                // real MRP exceeds the selling price.
                mrp: websitePrice,
                image_url: firstImage,
                total_stock: totalStock,
                stock_status: stockStatus,
                variants: own.map((v) => ({
                    id: v.id,
                    label: v.variant_name || "Standard",
                    stock_level: Number(v.stock_level) || 0,
                })),
                base_metal: rec.base_metal || "",
                plating_type: rec.plating_type || rec.plating || "",
                stone_type: rec.stone_type || "",
                occasion: rec.occasion || "",
                care_instructions: rec.care_instructions || "",
            };
        });

        return NextResponse.json(
            { success: true, products: catalogue, count: catalogue.length },
            { headers: CORS_HEADERS }
        );
    } catch (err: unknown) {
        console.error("[Storefront Catalog API] Error:", err);
        return NextResponse.json(
            { success: false, products: [], error: err instanceof Error ? err.message : "Catalogue unavailable" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}
