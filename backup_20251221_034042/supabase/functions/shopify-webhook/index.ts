// Supabase Edge Function: Handle Shopify Webhooks
// Deploy to: supabase/functions/shopify-webhook/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface ShopifyOrder {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    total_price: string;
    line_items: {
        sku: string;
        quantity: number;
        price: string;
    }[];
    shipping_address: {
        address1: string;
        city: string;
        zip: string;
        country: string;
    } | null;
    fulfillment_status: string | null;
    financial_status: string;
    created_at: string;
}

interface ShopifyInventoryUpdate {
    inventory_item_id: number;
    location_id: number;
    available: number;
    updated_at: string;
}

/**
 * Verify Shopify webhook signature
 */
async function verifyWebhook(rawBody: string, hmacHeader: string): Promise<boolean> {
    if (!SHOPIFY_WEBHOOK_SECRET) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(SHOPIFY_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(rawBody)
    );

    const computedHmac = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return computedHmac === hmacHeader;
}

serve(async (req) => {
    // Only accept POST
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    const rawBody = await req.text();
    const hmacHeader = req.headers.get("X-Shopify-Hmac-SHA256") || "";
    const topic = req.headers.get("X-Shopify-Topic") || "";

    // Verify signature
    const isValid = await verifyWebhook(rawBody, hmacHeader);
    if (!isValid) {
        console.error("Invalid webhook signature");
        return new Response("Unauthorized", { status: 401 });
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        const payload = JSON.parse(rawBody);

        switch (topic) {
            case "orders/create":
            case "orders/updated": {
                const order = payload as ShopifyOrder;
                await handleOrderWebhook(supabase, order);
                break;
            }

            case "inventory_levels/update": {
                const inventory = payload as ShopifyInventoryUpdate;
                await handleInventoryWebhook(supabase, inventory);
                break;
            }

            case "products/update": {
                // Handle product updates if needed
                console.log("Product update received:", payload.id);
                break;
            }

            default:
                console.log("Unhandled webhook topic:", topic);
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Webhook processing error:", error);
        return new Response(JSON.stringify({ error: "Processing failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});

async function handleOrderWebhook(supabase: any, order: ShopifyOrder) {
    // Check if order exists
    const { data: existing } = await supabase
        .from("sales")
        .select("id")
        .eq("channel_order_id", order.id.toString())
        .eq("channel", "shopify")
        .single();

    const saleData = {
        channel: "shopify",
        channel_order_id: order.id.toString(),
        customer_name: order.email,
        customer_phone: order.phone,
        customer_address: order.shipping_address
            ? `${order.shipping_address.address1}, ${order.shipping_address.city}`
            : null,
        total: parseFloat(order.total_price),
        subtotal: parseFloat(order.total_price),
        discount: 0,
        status: mapShopifyStatus(order.fulfillment_status),
    };

    if (existing) {
        await supabase
            .from("sales")
            .update(saleData)
            .eq("id", existing.id);
    } else {
        const { data: sale, error } = await supabase
            .from("sales")
            .insert(saleData)
            .select()
            .single();

        if (error) throw error;

        // Insert line items
        for (const item of order.line_items) {
            // Find variant by SKU
            const { data: variant } = await supabase
                .from("product_variants")
                .select("id")
                .eq("sku_suffix", item.sku)
                .single();

            if (variant) {
                await supabase.from("sale_items").insert({
                    sale_id: sale.id,
                    variant_id: variant.id,
                    quantity: item.quantity,
                    unit_price: parseFloat(item.price),
                });

                // Decrement stock
                await supabase.rpc("decrement_stock", {
                    p_variant_id: variant.id,
                    p_quantity: item.quantity,
                });
            }
        }
    }

    console.log(`Processed Shopify order: ${order.name}`);
}

async function handleInventoryWebhook(supabase: any, inventory: ShopifyInventoryUpdate) {
    // Update local inventory based on Shopify inventory item ID
    const { error } = await supabase
        .from("product_variants")
        .update({ stock_level: inventory.available })
        .eq("shopify_inventory_id", inventory.inventory_item_id.toString());

    if (error) {
        console.error("Failed to update inventory:", error);
    } else {
        console.log(`Updated inventory for item ${inventory.inventory_item_id}: ${inventory.available}`);
    }
}

function mapShopifyStatus(status: string | null): string {
    switch (status) {
        case "fulfilled": return "shipped";
        case "partial": return "confirmed";
        default: return "pending";
    }
}
