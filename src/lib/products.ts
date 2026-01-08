/**
 * Product Service Layer
 * CRUD operations for products and variants using PocketBase
 */

import { pb } from './pocketbase';

// ===========================================
// TYPES
// ===========================================

export interface Product {
    id: string;
    sku: string;
    name: string;
    description?: string;
    base_price: number;
    cost_price?: number;
    category?: string;
    image_url?: string;
    barcode?: string;
    hsn_code?: string;
    is_active: boolean;
    created: string;
    updated: string;
}

export interface ProductVariant {
    id: string;
    product: string; // Relation
    variant_name: string;
    sku_suffix?: string;
    price_adjustment?: number;
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
    stock: number;
}

// ===========================================
// PRODUCT CRUD
// ===========================================

export async function getProducts(filters?: {
    category?: string;
    search?: string;
    activeOnly?: boolean;
}): Promise<Product[]> {
    try {
        let filterParts: string[] = [];
        if (filters?.activeOnly !== false) { // Default to true
            filterParts.push('is_active=true');
        }
        if (filters?.category && filters.category !== 'All') {
            filterParts.push(`category="${filters.category}"`);
        }
        if (filters?.search) {
            const s = filters.search;
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
    } catch (error) {
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
    } catch (error) {
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
    // PB doesn't have atomic increment in update call like SQL 'stock + 1' easily without hooks
    // But safe enough for single user/local logic to fetch-and-update or use a custom API endpoint if concurrency is high.
    // For local-first/single POS, fetch-update is acceptable.
    try {
        const variant = await pb.collection('product_variants').getOne<ProductVariant>(variantId);
        const newStock = (variant.stock_level || 0) + quantityChange;
        await pb.collection('product_variants').update(variantId, {
            stock_level: newStock
        });
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
            filter: `product.name~"${query}" || product.sku~"${query}" || variant_name~"${query}" || sku_suffix~"${query}"`,
            expand: 'product',
            sort: 'product.name'
        });

        return records.items.map(v => {
            const p = v.expand?.product!;
            if (!p) return null;
            return {
                ...p,
                variant_id: v.id,
                variant_name: v.variant_name,
                full_sku: p.sku + (v.sku_suffix ? `-${v.sku_suffix}` : ''),
                price: (p.base_price || 0) + (v.price_adjustment || 0),
                stock: v.stock_level
            };
        }).filter(p => p !== null) as ProductWithVariant[];
    } catch (error) {
        return [];
    }
}
