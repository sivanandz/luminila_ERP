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
    /** GST percentage. Optional until the column is provisioned. */
    gst_rate?: number;
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
    account_email?: string;
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

export interface CatalogSearchProduct {
    id: string;
    name: string;
    sku: string;
    base_price: number;
    hsn_code?: string;
    variants: Array<{
        id: string;
        sku_suffix?: string;
        size?: string;
        color?: string;
        price_adjustment: number;
    }>;
}

/**
 * Catalog search for document builders (challan, invoices, orders). Lives here
 * so pages do not interpolate their own PocketBase filters; the search term is
 * sanitized once, and variants are fetched in batches of thirty parent ids.
 */
export async function searchProductsForDocuments(query: string): Promise<CatalogSearchProduct[]> {
    const term = sanitizeFilter((query || '').trim());
    if (term.length < 2) return [];

    const products = await pb.collection('products').getFullList<Product>({
        filter: `name~"${term}" || sku~"${term}"`,
        batch: 200,
    });
    if (products.length === 0) return [];

    const variants: ProductVariant[] = [];
    for (let i = 0; i < products.length; i += 30) {
        const filter = products.slice(i, i + 30).map((p) => `product="${p.id}"`).join(' || ');
        variants.push(
            ...(await pb.collection('product_variants').getFullList<ProductVariant>({ filter, batch: 500 }))
        );
    }

    return products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        base_price: product.base_price,
        hsn_code: product.hsn_code,
        variants: variants
            .filter((variant) => variant.product === product.id)
            .map((variant) => ({
                id: variant.id,
                sku_suffix: variant.sku_suffix,
                size: variant.size,
                color: variant.color,
                price_adjustment: variant.price_adjustment || 0,
            })),
    }));
}

/** Resolve a scanned or typed barcode (product sku or barcode) to its product and first variant. */
export async function resolveBarcodeProduct(
    code: string
): Promise<{ product: Product; variant: ProductVariant | null } | null> {
    const term = sanitizeFilter((code || '').trim());
    if (!term) return null;

    try {
        const product = await pb
            .collection('products')
            .getFirstListItem<Product>(`sku="${term}" || barcode="${term}"`);
        const variants = await pb.collection('product_variants').getList<ProductVariant>(1, 1, {
            filter: `product="${product.id}"`,
        });
        return { product, variant: variants.items[0] || null };
    } catch {
        return null;
    }
}

export async function getTypeAheadProducts(query: string): Promise<ProductWithVariant[]> {
    if (!query || query.length < 2) return [];

    // Search variants with product expansion
    try {
        const tenantEmail = typeof window !== "undefined" ? pb.authStore.model?.email?.trim().toLowerCase() : undefined;
        const tenantFilter = tenantEmail ? ` && account_email = "${sanitizeFilter(tenantEmail)}"` : '';
        const records = await pb.collection('product_variants').getList<ProductVariant>(1, 20, {
            filter: `(product.name~"${query}" || product.sku~"${query}" || variant_name~"${query}" || sku_suffix~"${query}") && product.is_active=true${tenantFilter}`,
            expand: 'product',
            sort: 'product.name'
        });

        const result: ProductWithVariant[] = [];
        for (const v of records.items) {
            const p = v.expand?.product;
            if (!p || p.is_active === false) continue;
            if (tenantEmail && ((v.account_email && v.account_email.toLowerCase() !== tenantEmail) || (p.account_email && p.account_email.toLowerCase() !== tenantEmail))) continue;
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

/** Aggregated stock and material per product, used by inventory listings. */
export async function getVariantStockSummary(): Promise<{
    stockByProduct: Map<string, number>;
    materialByProduct: Map<string, string>;
    productByVariant: Map<string, string>;
}> {
    const variants = await pb.collection('product_variants').getFullList<ProductVariant>();
    const stockByProduct = new Map<string, number>();
    const materialByProduct = new Map<string, string>();
    const productByVariant = new Map<string, string>();

    for (const variant of variants) {
        const productId = variant.product;
        if (!productId) continue;
        productByVariant.set(variant.id, productId);
        stockByProduct.set(productId, (stockByProduct.get(productId) || 0) + (variant.stock_level || 0));
        if (variant.material && !materialByProduct.has(productId)) {
            materialByProduct.set(productId, variant.material);
        }
    }

    return { stockByProduct, materialByProduct, productByVariant };
}

/** Log a manual inward movement against a variant, stamped with the tenant. */
export async function recordManualIntakeMovement(input: {
    variantId: string;
    quantity: number;
    referenceId: string;
    notes: string;
    accountEmail?: string;
}): Promise<void> {
    await pb.collection('stock_movements').create({
        account_email: input.accountEmail ?? (pb.authStore.model as { email?: string } | null)?.email ?? '',
        variant: input.variantId,
        movement_type: 'restock',
        quantity: input.quantity,
        reference_id: input.referenceId,
        source: 'manual_intake',
        notes: input.notes,
    });
}

/** Sellable variant option for document builders (invoices, orders). */
export interface SellableVariant {
    id: string;
    variant_name?: string;
    sku_suffix?: string;
    material?: string;
    stock_level?: number;
    price_adjustment: number;
    product: {
        id: string;
        name: string;
        sku: string;
        base_price: number;
        category?: string;
    };
}

/** In-stock variants with their product expanded, for invoice/order builders. */
export async function getSellableVariants(): Promise<SellableVariant[]> {
    const variants = await pb.collection('product_variants').getFullList<{
        id: string;
        variant_name?: string;
        sku_suffix?: string;
        material?: string;
        stock_level?: number;
        price_adjustment?: number;
        expand?: {
            product?: {
                id: string;
                name: string;
                sku: string;
                base_price: number;
                category?: string;
            };
        };
    }>({
        filter: 'stock_level>0',
        sort: 'variant_name',
        expand: 'product',
    });

    return variants.map((variant) => ({
        id: variant.id,
        variant_name: variant.variant_name,
        sku_suffix: variant.sku_suffix,
        material: variant.material,
        stock_level: variant.stock_level,
        price_adjustment: variant.price_adjustment || 0,
        product: variant.expand?.product
            ? {
                id: variant.expand.product.id,
                name: variant.expand.product.name,
                sku: variant.expand.product.sku,
                base_price: variant.expand.product.base_price,
                category: variant.expand.product.category,
            }
            : { id: '', name: '', sku: '', base_price: 0 },
    }));
}

/** Single variant by id, for discrepancy and stock flows. */
export async function getVariantById(variantId: string): Promise<ProductVariant | null> {
    try {
        return await pb.collection('product_variants').getOne<ProductVariant>(variantId);
    } catch {
        return null;
    }
}

/** Stockiest variant of a product, for flows that pick a default line. */
export async function getVariantForProduct(productId: string): Promise<ProductVariant | null> {
    try {
        const variants = await pb.collection('product_variants').getList<ProductVariant>(1, 1, {
            filter: `product="${sanitizeFilter(productId)}"`,
            sort: '-stock_level',
        });
        return variants.items[0] || null;
    } catch {
        return null;
    }
}