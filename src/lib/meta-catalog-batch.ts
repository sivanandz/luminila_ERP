/**
 * Meta Commerce Catalog Batch API Client
 * 
 * Directly pushes product creations, updates, price changes, and stock decrements
 * to Meta Commerce Manager & WhatsApp Catalog in real-time (< 2 seconds)
 * via Meta Graph API v21.0 items_batch endpoint.
 * 
 * Spec: https://developers.facebook.com/documentation/ads-commerce/catalog/guides/manage-catalog-items/catalog-batch-api
 */

export interface MetaBatchItemData {
    id: string; // Retailer SKU
    title: string;
    description: string;
    availability: 'in stock' | 'out of stock';
    condition: 'new' | 'refurbished' | 'used';
    price: string; // e.g. "1299.00 INR"
    link: string; // WhatsApp or storefront link
    image_link: string;
    brand: string;
    item_group_id?: string;
    color?: string;
    material?: string;
}

export interface MetaBatchRequest {
    method: 'CREATE' | 'UPDATE' | 'DELETE';
    data?: MetaBatchItemData;
    retailer_id?: string; // used for DELETE
}

export interface MetaBatchPayload {
    item_type: 'PRODUCT_ITEM';
    allow_upsert: boolean;
    requests: MetaBatchRequest[];
}

export interface MetaBatchResponse {
    success: boolean;
    handles?: string[];
    errors?: Array<{ code: number; message: string; error_subcode?: number }>;
    total_processed?: number;
    raw?: unknown;
}

/**
 * Build Meta /items_batch requests from PocketBase products and variants
 */
export function buildMetaBatchRequests(
    products: Array<{
        id: string;
        name: string;
        sku?: string;
        description?: string;
        base_price?: number;
        stock_quantity?: number;
        image_url?: string;
        is_active?: boolean;
    }>,
    variants: Array<{
        id: string;
        product: string;
        variant_name?: string;
        sku_suffix?: string;
        price_adjustment?: number;
        stock_level?: number;
        color?: string;
        material?: string;
    }>,
    origin: string,
    phone: string = '917092122334',
    action: 'CREATE' | 'UPDATE' | 'DELETE' = 'UPDATE'
): MetaBatchRequest[] {
    const variantsByProduct = new Map<string, typeof variants>();
    for (const v of variants) {
        if (!variantsByProduct.has(v.product)) {
            variantsByProduct.set(v.product, []);
        }
        variantsByProduct.get(v.product)!.push(v);
    }

    const requests: MetaBatchRequest[] = [];

    for (const p of products) {
        const pVariants = variantsByProduct.get(p.id) || [];
        const basePrice = Number(p.base_price) || 0;
        const brand = 'Niththigal Jewellery';
        const cleanDesc = (p.description || p.name || 'Fine Jewelry').replace(/[\r\n]+/g, ' ').slice(0, 5000);
        const imageLink = (p.image_url && p.image_url.startsWith('http'))
            ? p.image_url
            : `${origin}/api/catalog/image?id=${p.id}`;

        if (action === 'DELETE' || p.is_active === false) {
            // Mark out of stock or delete
            if (pVariants.length === 0) {
                const sku = p.sku || `PROD-${p.id}`;
                requests.push({
                    method: 'UPDATE',
                    data: {
                        id: sku,
                        title: p.name,
                        description: cleanDesc,
                        availability: 'out of stock',
                        condition: 'new',
                        price: `${basePrice.toFixed(2)} INR`,
                        link: `https://wa.me/${phone}?text=${encodeURIComponent(`Inquire about ${p.name}`)}`,
                        image_link: imageLink,
                        brand,
                        item_group_id: sku,
                    }
                });
            } else {
                for (const v of pVariants) {
                    const variantSku = p.sku ? `${p.sku}-${v.sku_suffix || v.id.slice(-4)}` : `VAR-${v.id}`;
                    requests.push({
                        method: 'UPDATE',
                        data: {
                            id: variantSku,
                            title: `${p.name} - ${v.variant_name || 'Standard'}`,
                            description: cleanDesc,
                            availability: 'out of stock',
                            condition: 'new',
                            price: `${basePrice.toFixed(2)} INR`,
                            link: `https://wa.me/${phone}?text=${encodeURIComponent(`Inquire about ${p.name}`)}`,
                            image_link: imageLink,
                            brand,
                            item_group_id: p.sku || p.id,
                        }
                    });
                }
            }
            continue;
        }

        if (pVariants.length === 0) {
            const sku = p.sku || `PROD-${p.id}`;
            const stock = Number(p.stock_quantity) || 0;
            const chatLink = `https://wa.me/${phone}?text=${encodeURIComponent(`Hello, I want to order ${p.name} (SKU: ${sku})`)}`;

            requests.push({
                method: 'UPDATE',
                data: {
                    id: sku,
                    title: p.name,
                    description: cleanDesc,
                    availability: stock > 0 ? 'in stock' : 'out of stock',
                    condition: 'new',
                    price: `${basePrice.toFixed(2)} INR`,
                    link: chatLink,
                    image_link: imageLink,
                    brand,
                    item_group_id: sku,
                }
            });
        } else {
            for (const v of pVariants) {
                const variantSku = p.sku ? `${p.sku}-${v.sku_suffix || v.id.slice(-4)}` : `VAR-${v.id}`;
                const variantPrice = Math.max(0, basePrice + (Number(v.price_adjustment) || 0));
                const variantStock = Number(v.stock_level) || 0;
                const title = `${p.name} - ${v.variant_name || 'Standard'}`;
                const chatLink = `https://wa.me/${phone}?text=${encodeURIComponent(`Hello, I want to order ${title} (SKU: ${variantSku})`)}`;

                requests.push({
                    method: 'UPDATE',
                    data: {
                        id: variantSku,
                        title,
                        description: cleanDesc,
                        availability: variantStock > 0 ? 'in stock' : 'out of stock',
                        condition: 'new',
                        price: `${variantPrice.toFixed(2)} INR`,
                        link: chatLink,
                        image_link: imageLink,
                        brand,
                        item_group_id: p.sku || p.id,
                        color: v.color || undefined,
                        material: v.material || undefined,
                    }
                });
            }
        }
    }

    return requests;
}

/**
 * Dispatch Meta Catalog Batch API request
 */
export async function sendMetaCatalogBatch(
    catalogId: string,
    accessToken: string,
    requests: MetaBatchRequest[],
    apiVersion: string = 'v21.0'
): Promise<MetaBatchResponse> {
    if (!catalogId) {
        return { success: false, errors: [{ code: 400, message: 'Missing Meta Catalog ID' }] };
    }
    if (!accessToken) {
        return { 
            success: false, 
            errors: [{ 
                code: 401, 
                message: 'Missing META_GRAPH_ACCESS_TOKEN. Please set your Meta System User Access Token in .env.local' 
            }] 
        };
    }

    if (requests.length === 0) {
        return { success: true, total_processed: 0 };
    }

    const payload: MetaBatchPayload = {
        item_type: 'PRODUCT_ITEM',
        allow_upsert: true,
        requests,
    };

    const endpoint = `https://graph.facebook.com/${apiVersion}/${catalogId}/items_batch`;

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok) {
            console.error('[MetaBatchAPI] Error response:', data);
            return {
                success: false,
                errors: data.error ? [data.error] : [{ code: res.status, message: res.statusText }],
                raw: data,
            };
        }

        return {
            success: true,
            handles: data.handles || [data.id || 'batch_submitted'],
            total_processed: requests.length,
            raw: data,
        };
    } catch (err) {
        console.error('[MetaBatchAPI] Network/fetch error:', err);
        return {
            success: false,
            errors: [{ code: 500, message: err instanceof Error ? err.message : String(err) }],
        };
    }
}
