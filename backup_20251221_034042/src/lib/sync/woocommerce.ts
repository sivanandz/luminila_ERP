/**
 * WooCommerce Sync Engine
 * Uses WooCommerce REST API for inventory and order sync
 * 
 * Setup: Generate API keys in WooCommerce → Settings → Advanced → REST API
 */

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || "";
const WOOCOMMERCE_CONSUMER_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY || "";
const WOOCOMMERCE_CONSUMER_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET || "";

interface WooProduct {
    id: number;
    name: string;
    sku: string;
    price: string;
    stock_quantity: number;
    manage_stock: boolean;
    variations: number[];
}

interface WooVariant {
    id: number;
    sku: string;
    price: string;
    stock_quantity: number;
    attributes: Array<{
        name: string;
        option: string;
    }>;
}

interface WooOrder {
    id: number;
    number: string;
    date_created: string;
    status: string;
    total: string;
    billing: {
        first_name: string;
        last_name: string;
        phone: string;
        email: string;
        address_1: string;
        city: string;
    };
    line_items: Array<{
        id: number;
        name: string;
        sku: string;
        quantity: number;
        price: number;
        variation_id: number;
    }>;
}

/**
 * Make authenticated request to WooCommerce REST API
 */
async function wooCommerceAPI<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: Record<string, unknown>
): Promise<T> {
    if (!WOOCOMMERCE_URL || !WOOCOMMERCE_CONSUMER_KEY || !WOOCOMMERCE_CONSUMER_SECRET) {
        throw new Error("WooCommerce credentials not configured");
    }

    const url = new URL(`${WOOCOMMERCE_URL}/wp-json/wc/v3/${endpoint}`);
    url.searchParams.set("consumer_key", WOOCOMMERCE_CONSUMER_KEY);
    url.searchParams.set("consumer_secret", WOOCOMMERCE_CONSUMER_SECRET);

    const response = await fetch(url.toString(), {
        method,
        headers: {
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`WooCommerce API error: ${response.status} - ${error}`);
    }

    return response.json();
}

/**
 * Fetch all products from WooCommerce
 */
export async function fetchWooProducts(page = 1, perPage = 100): Promise<WooProduct[]> {
    return wooCommerceAPI<WooProduct[]>(`products?page=${page}&per_page=${perPage}`);
}

/**
 * Fetch all products with pagination
 */
export async function fetchAllWooProducts(): Promise<WooProduct[]> {
    const allProducts: WooProduct[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const products = await fetchWooProducts(page, 100);
        allProducts.push(...products);
        hasMore = products.length === 100;
        page++;
    }

    return allProducts;
}

/**
 * Fetch product variations
 */
export async function fetchWooVariations(productId: number): Promise<WooVariant[]> {
    return wooCommerceAPI<WooVariant[]>(`products/${productId}/variations`);
}

/**
 * Update product stock in WooCommerce
 */
export async function updateWooStock(productId: number, quantity: number): Promise<void> {
    await wooCommerceAPI(`products/${productId}`, "PUT", {
        stock_quantity: quantity,
        manage_stock: true,
    });
}

/**
 * Update variation stock in WooCommerce
 */
export async function updateWooVariationStock(
    productId: number,
    variationId: number,
    quantity: number
): Promise<void> {
    await wooCommerceAPI(`products/${productId}/variations/${variationId}`, "PUT", {
        stock_quantity: quantity,
        manage_stock: true,
    });
}

/**
 * Fetch recent orders from WooCommerce
 */
export async function fetchWooOrders(
    since?: Date,
    limit = 50
): Promise<WooOrder[]> {
    let endpoint = `orders?per_page=${limit}&orderby=date&order=desc`;

    if (since) {
        endpoint += `&after=${since.toISOString()}`;
    }

    return wooCommerceAPI<WooOrder[]>(endpoint);
}

/**
 * Sync products from WooCommerce to local database
 */
export async function syncProductsFromWoo(
    onProgress?: (current: number, total: number) => void
): Promise<{ created: number; updated: number; errors: string[] }> {
    const products = await fetchAllWooProducts();
    const errors: string[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        onProgress?.(i + 1, products.length);

        try {
            console.log(`Syncing WooCommerce product: ${product.name}`);

            // Handle variations if product has them
            if (product.variations.length > 0) {
                const variations = await fetchWooVariations(product.id);
                for (const variant of variations) {
                    console.log(`  - Variant ${variant.sku}: ${variant.stock_quantity} units`);
                    // TODO: Upsert to Supabase
                }
            } else {
                console.log(`  - Stock: ${product.stock_quantity} units`);
                // TODO: Upsert to Supabase
            }

            updated++;
        } catch (err) {
            errors.push(`Failed to sync ${product.name}: ${err}`);
        }
    }

    return { created, updated, errors };
}

/**
 * Sync orders from WooCommerce to local database
 */
export async function syncOrdersFromWoo(
    since?: Date
): Promise<{ synced: number; errors: string[] }> {
    const orders = await fetchWooOrders(since);
    const errors: string[] = [];
    let synced = 0;

    for (const order of orders) {
        try {
            console.log(`Syncing WooCommerce order: #${order.number}`);

            for (const item of order.line_items) {
                console.log(`  - Item ${item.sku}: ${item.quantity} units`);
                // TODO: Decrement local inventory, log stock movement
            }

            synced++;
        } catch (err) {
            errors.push(`Failed to sync order #${order.number}: ${err}`);
        }
    }

    return { synced, errors };
}

/**
 * Push local inventory changes to WooCommerce
 */
export async function pushInventoryToWoo(
    wooProductId: number,
    wooVariationId: number | null,
    newQuantity: number
): Promise<boolean> {
    try {
        if (wooVariationId) {
            await updateWooVariationStock(wooProductId, wooVariationId, newQuantity);
        } else {
            await updateWooStock(wooProductId, newQuantity);
        }
        console.log(`Updated WooCommerce inventory: ${wooProductId} = ${newQuantity}`);
        return true;
    } catch (err) {
        console.error(`Failed to push inventory to WooCommerce: ${err}`);
        return false;
    }
}

/**
 * Check if WooCommerce is configured
 */
export function isWooCommerceConfigured(): boolean {
    return Boolean(
        WOOCOMMERCE_URL && WOOCOMMERCE_CONSUMER_KEY && WOOCOMMERCE_CONSUMER_SECRET
    );
}
