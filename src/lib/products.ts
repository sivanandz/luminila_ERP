/**
 * Product Service Layer
 * CRUD operations for products and variants using PocketBase
 */

import { pb, sanitizeFilter } from './pocketbase';

// ===========================================
// TYPES
// ===========================================

export const STORAGE_LOCATIONS = [
    'Showcase Tray A',
    'Showcase Tray B',
    'Counter 1',
    'Counter 2',
    'Safe Vault 1',
    'Safe Vault 2',
    'Wholesale Warehouse',
    'Backroom Locker',
] as const;

export type StorageLocation = typeof STORAGE_LOCATIONS[number];

export interface Product {
    id: string;
    sku: string;
    name: string;
    description?: string;
    base_price: number;
    cost_price?: number;
    channel_prices?: Record<string, number>;
    category?: string;
    image_url?: string;
    image_data?: string;
    barcode?: string;
    hsn_code?: string;
    location?: string;
    account_email?: string;
    is_active: boolean;
    created: string;
    updated: string;
}

/**
 * Resilient image resolver: prioritizes base64 image_data or clean web URLs,
 * gracefully filtering out broken WhatsApp encrypted MMS3 CDN tokens.
 */
export function getProductDisplayImage(p?: { image_data?: string | null; image_url?: string | null } | null): string | null {
    if (!p) return null;
    if (p.image_data && p.image_data.length > 20) return p.image_data;
    if (p.image_url && !p.image_url.includes('whatsapp.net')) return p.image_url;
    return null;
}

export interface ProductVariant {
    id: string;
    product: string; // Relation
    variant_name: string;
    sku_suffix?: string;
    price_adjustment?: number;
    channel_prices?: Record<string, number>;
    stock_level: number;
    low_stock_threshold?: number;
    size?: string;
    color?: string;
    material?: string;
    created: string;
    updated: string;
    // Expanded
    expand?: {
        product?: Product;
    };
}

// Flat structure often used in UI
export interface ProductWithVariant extends Product {
    variant_id: string;
    variant_name: string;
    full_sku: string;
    price: number;
    price_adjustment?: number;
    stock: number;
    channel_prices?: Record<string, number>;
}

// ===========================================
// PRODUCT CRUD
// ===========================================

export async function getProducts(filters?: {
    category?: string;
    search?: string;
    activeOnly?: boolean;
    location?: string;
}): Promise<Product[]> {
    try {
        const filterParts: string[] = [];
        if (filters?.activeOnly !== false) { // Default to true
            filterParts.push('is_active=true');
        }
        if (typeof window !== "undefined" && pb.authStore.model?.email) {
            filterParts.push(`account_email="${sanitizeFilter(pb.authStore.model.email)}"`);
        }
        if (filters?.category && filters.category !== 'All') {
            filterParts.push(`category="${sanitizeFilter(filters.category)}"`);
        }
        if (filters?.location && filters.location !== 'All') {
            filterParts.push(`location="${sanitizeFilter(filters.location)}"`);
        }
        if (filters?.search) {
            const s = sanitizeFilter(filters.search);
            filterParts.push(`(name~"${s}" || sku~"${s}" || barcode~"${s}")`);
        }

        const records = await pb.collection('products').getFullList<Product>({
            filter: filterParts.join(' && '),
            sort: 'name',
            expand: 'category'
        });
        return records;
    } catch (error) {
        console.error('Error fetching products:', error);
        return [];
    }
}

export async function getProduct(id: string): Promise<Product | null> {
    try {
        const record = await pb.collection('products').getOne<Product>(id);
        return record;
    } catch {
        return null;
    }
}

export async function createProduct(product: Omit<Product, 'id' | 'created' | 'updated'>): Promise<Product> {
    try {
        const record = await pb.collection('products').create(product);
        return record as unknown as Product;
    } catch (error) {
        throw error;
    }
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
    try {
        const record = await pb.collection('products').update(id, updates);
        return record as unknown as Product;
    } catch (error) {
        throw error;
    }
}

export async function deleteProduct(id: string): Promise<void> {
    try {
        await pb.collection('products').update(id, { is_active: false }); // Soft delete preferred
    } catch (error) {
        throw error;
    }
}

// ===========================================
// VARIANT CRUD
// ===========================================

export async function getProductVariants(productId: string): Promise<ProductVariant[]> {
    try {
        const records = await pb.collection('product_variants').getFullList<ProductVariant>({
            filter: `product="${productId}"`,
            sort: 'variant_name'
        });
        return records;
    } catch {
        return [];
    }
}

export async function createVariant(variant: Omit<ProductVariant, 'id' | 'created' | 'updated'>): Promise<ProductVariant> {
    try {
        const record = await pb.collection('product_variants').create(variant);
        return record as unknown as ProductVariant;
    } catch (error) {
        throw error;
    }
}

export async function updateVariant(id: string, updates: Partial<ProductVariant>): Promise<ProductVariant> {
    try {
        const record = await pb.collection('product_variants').update(id, updates);
        return record as unknown as ProductVariant;
    } catch (error) {
        throw error;
    }
}

export async function deleteVariant(id: string): Promise<void> {
    try {
        await pb.collection('product_variants').delete(id);
    } catch (error) {
        throw error;
    }
}

// ===========================================
// INVENTORY MANAGEMENT
// ===========================================

export async function updateStock(variantId: string, quantityChange: number): Promise<void> {
    try {
        if (quantityChange >= 0) {
            await pb.collection('product_variants').update(variantId, {
                'stock_level+': quantityChange
            });
        } else {
            await pb.collection('product_variants').update(variantId, {
                'stock_level-': Math.abs(quantityChange)
            });
        }
    } catch (error) {
        console.error('Error updating stock:', error);
        throw error;
    }
}

export async function getTypeAheadProducts(query: string): Promise<ProductWithVariant[]> {
    if (!query || query.length < 2) return [];

    // Search variants with product expansion
    try {
        const records = await pb.collection('product_variants').getList<ProductVariant>(1, 20, {
            filter: `(product.name~"${query}" || product.sku~"${query}" || variant_name~"${query}" || sku_suffix~"${query}") && product.is_active=true`,
            expand: 'product',
            sort: 'product.name'
        });

        const result: ProductWithVariant[] = [];
        for (const v of records.items) {
            const p = v.expand?.product;
            if (!p || p.is_active === false) continue;
            result.push({
                ...p,
                variant_id: v.id,
                variant_name: v.variant_name,
                full_sku: p.sku + (v.sku_suffix ? `-${v.sku_suffix}` : ''),
                price: (p.base_price || 0) + (v.price_adjustment || 0),
                price_adjustment: v.price_adjustment || 0,
                channel_prices: p.channel_prices || {},
                stock: v.stock_level
            });
        }
        return result;
    } catch {
        return [];
    }
}
