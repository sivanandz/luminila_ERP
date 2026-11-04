/**
 * Meta Commerce Catalog Batch API Client
 * 
 * Directly pushes product creations, updates, price changes, and stock decrements
 * to Meta Commerce Manager & WhatsApp Catalog in real-time (< 2 seconds)
 * via Meta Graph API v21.0 items_batch endpoint.
 * 
 * Spec: https://developers.facebook.com/documentation/ads-commerce/catalog/guides/manage-catalog-items/catalog-batch-api
 */

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
    DEFAULT_SALES_CHANNELS,
    getChannelPriceFromList,
    type SalesChannelDefinition,
} from './pricing-rules';
import { decryptSecret, encryptSecret, isEncryptedSecret, parseRegistryKey } from './tenant-secrets';

/**
 * Opaque tenant handle for public catalog image links.
 *
 * The link handed to Meta used to embed `account_email`, exposing tenant PII to
 * anyone holding the URL (ENG-3). The tenant is encrypted with a dedicated
 * secret instead; the image route decrypts it server-side. The token wraps an
 * identifier only (never a credential), so the already-provisioned registry key
 * is an acceptable fallback when no dedicated secret is configured.
 */
function catalogTokenKey(env: NodeJS.ProcessEnv): Buffer | null {
    const secret = (env.CATALOG_TOKEN_SECRET || '').trim();
    if (secret) return crypto.createHash('sha256').update(`catalog-tenant-token:${secret}`).digest();
    const registry = parseRegistryKey(env.TENANT_REGISTRY_KEY);
    if (registry) return crypto.createHash('sha256').update(registry).digest();
    const fallback = (env.CUSTOMER_SESSION_SECRET || env.JWT_SECRET || '').trim();
    if (!fallback) return null;
    return crypto.createHash('sha256').update(`catalog-tenant-token:${fallback}`).digest();
}

export function buildCatalogTenantToken(
    tenantEmail: string,
    env: NodeJS.ProcessEnv = process.env
): string {
    const email = tenantEmail.trim().toLowerCase();
    if (!email) throw new Error('A tenant email is required to build catalog image links.');
    const key = catalogTokenKey(env);
    if (!key) {
        throw new Error(
            'Set CATALOG_TOKEN_SECRET, TENANT_REGISTRY_KEY or CUSTOMER_SESSION_SECRET before publishing catalog image links.'
        );
    }
    return encryptSecret(email, key);
}

export function readCatalogTenantToken(
    token: string,
    env: NodeJS.ProcessEnv = process.env
): string | null {
    const value = (token || '').trim();
    // Plaintext/absent tokens fail closed: only the encrypted form is trusted.
    if (!value || !isEncryptedSecret(value)) return null;
    const key = catalogTokenKey(env);
    if (!key) return null;
    try {
        const email = decryptSecret(value, key).trim().toLowerCase();
        return email || null;
    } catch {
        return null;
    }
}

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

/**
 * Resolves a publicly reachable base URL for Meta Catalog image & product links.
 * Prevents local browser triggers (http://127.0.0.1:3000) from poisoning Meta's catalog image_link.
 */
export function resolvePublicCatalogOrigin(req: NextRequest): string {
    const envBase = (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
    const isPublicHttpsOrigin = (value: string): boolean => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:'
                && !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
        } catch {
            return false;
        }
    };
    if (isPublicHttpsOrigin(envBase)) {
        return envBase;
    }

    // The forwarded host is client-controlled unless it names a host we already
    // trust: the request's own Host header or the configured public origin.
    // Reflecting it verbatim let a spoofed header rewrite every catalog link (ENG-2).
    const hostOnly = (value: string | null | undefined): string => {
        const raw = (value || '').trim().toLowerCase();
        if (!raw) return '';
        try {
            return new URL(`https://${raw}`).hostname.toLowerCase();
        } catch {
            return '';
        }
    };
    const trustedHosts = new Set<string>();
    const requestHost = hostOnly(req.headers.get('host') || req.nextUrl.host);
    if (requestHost) trustedHosts.add(requestHost);
    const envHost = hostOnly(envBase);
    if (envHost) trustedHosts.add(envHost);

    const forwardedHost = hostOnly(req.headers.get('x-forwarded-host')?.split(',')[0]);
    const forwardedProto = (req.headers.get('x-forwarded-proto')?.split(',')[0] || '').trim().toLowerCase();
    if (
        forwardedHost
        && forwardedProto === 'https'
        && trustedHosts.has(forwardedHost)
        && !['localhost', '127.0.0.1', '::1'].includes(forwardedHost)
    ) {
        return `https://${forwardedHost}`;
    }

    const reqOrigin = req.nextUrl.origin.replace(/\/+$/, '');
    if (!reqOrigin.includes('localhost') && !reqOrigin.includes('127.0.0.1')) {
        return reqOrigin;
    }

    // Fallback to active Cloudflare Tunnel URL persisted by scripts/tunnel.js
    try {
        const tunnelFile = path.resolve(process.cwd(), 'scratch', 'tunnel-urls.json');
        if (fs.existsSync(tunnelFile)) {
            const parsed = JSON.parse(fs.readFileSync(tunnelFile, 'utf-8'));
            const tunnelAppUrl = parsed?.services?.app;
            if (typeof tunnelAppUrl === 'string' && tunnelAppUrl.startsWith('https://')) {
                return tunnelAppUrl.replace(/\/+$/, '');
            }
        }
    } catch {
        // Ignore disk read errors and fallback to request origin
    }

    return envBase || reqOrigin;
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
        cost_price?: number;
        channel_prices?: Record<string, number>;
        stock_quantity?: number;
        total_stock?: number;
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
    action: 'CREATE' | 'UPDATE' | 'DELETE' = 'UPDATE',
    brandName: string = 'Niththigal Jewellery',
    channels: SalesChannelDefinition[] = DEFAULT_SALES_CHANNELS,
    /** Tenant whose image proxy the feed links to; without it every image fell
     * back to the generic placeholder (SF-19). The raw email never goes into the
     * URL: an opaque encrypted handle does (ENG-3). */
    tenantEmail: string = ''
): MetaBatchRequest[] {
    const variantsByProduct = new Map<string, typeof variants>();
    for (const v of variants) {
        if (!variantsByProduct.has(v.product)) {
            variantsByProduct.set(v.product, []);
        }
        variantsByProduct.get(v.product)!.push(v);
    }

    let tenantHandle: string | null = null;
    const imageLinkFor = (productId: string): string => {
        if (!tenantEmail.trim()) {
            throw new Error('A tenant email is required to publish catalog image links.');
        }
        if (!tenantHandle) tenantHandle = buildCatalogTenantToken(tenantEmail);
        return `${origin}/api/catalog/image?id=${encodeURIComponent(productId)}&tenant=${encodeURIComponent(tenantHandle)}`;
    };

    const requests: MetaBatchRequest[] = [];

    for (const p of products) {
        const pVariants = variantsByProduct.get(p.id) || [];
        const whatsappPrice = getChannelPriceFromList(
            {
                base_price: Number(p.base_price) || 0,
                cost_price: Number(p.cost_price) || 0,
                channel_prices: p.channel_prices,
            },
            'whatsapp',
            channels
        );
        const brand = brandName || 'Niththigal Jewellery';
        const cleanDesc = (p.description || p.name || 'Fine Jewelry').replace(/[\r\n]+/g, ' ').slice(0, 5000);
        const imageLink = (p.image_url && p.image_url.startsWith('http'))
            ? p.image_url
            : imageLinkFor(p.id);

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
                        price: `${whatsappPrice.toFixed(2)} INR`,
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
                            price: `${whatsappPrice.toFixed(2)} INR`,
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
            const stock = Number(p.total_stock ?? p.stock_quantity) || 0;
            const chatLink = `https://wa.me/${phone}?text=${encodeURIComponent(`Hello, I want to order ${p.name} (SKU: ${sku})`)}`;

            requests.push({
                method: 'UPDATE',
                data: {
                    id: sku,
                    title: p.name,
                    description: cleanDesc,
                    availability: stock > 0 ? 'in stock' : 'out of stock',
                    condition: 'new',
                    price: `${whatsappPrice.toFixed(2)} INR`,
                    link: chatLink,
                    image_link: imageLink,
                    brand,
                    item_group_id: sku,
                }
            });
        } else {
            for (const v of pVariants) {
                const variantSku = p.sku ? `${p.sku}-${v.sku_suffix || v.id.slice(-4)}` : `VAR-${v.id}`;
                const variantPrice = Math.max(0, whatsappPrice + (Number(v.price_adjustment) || 0));
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
