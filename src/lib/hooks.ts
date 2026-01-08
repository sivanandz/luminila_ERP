"use client";

import { useState, useEffect, useCallback } from "react";
import { pb } from "@/lib/pocketbase";
import type {
    Product,
    ProductVariant,
    ProductWithVariants,
    Sale,
} from "@/types/database";

// PocketBase record types
interface PBProduct {
    id: string;
    sku: string;
    name: string;
    description?: string;
    category?: string;
    base_price: number;
    cost_price?: number;
    image_url?: string;
    barcode?: string;
    is_active: boolean;
    created: string;
    updated: string;
}

interface PBVariant {
    id: string;
    product: string;
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
    expand?: {
        product?: PBProduct;
    };
}

/**
 * Subscribe helper for PocketBase collections
 */
function subscribeToCollection<T>(
    collectionName: string,
    callback: (data: { action: string; record: T }) => void
): () => void {
    pb.collection(collectionName).subscribe('*', (e) => {
        callback({ action: e.action, record: e.record as T });
    });
    return () => {
        pb.collection(collectionName).unsubscribe('*');
    };
}

/**
 * Hook to fetch all products with their variants
 */
export function useProducts() {
    const [products, setProducts] = useState<ProductWithVariants[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchProducts = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            // Fetch products
            const productRecords = await pb.collection('products').getFullList<PBProduct>({
                filter: 'is_active=true',
                sort: 'name',
            });

            // Fetch all variants with product expansion
            const variantRecords = await pb.collection('product_variants').getFullList<PBVariant>({
                expand: 'product',
            });

            // Group variants by product
            const variantsByProduct = new Map<string, ProductVariant[]>();
            for (const v of variantRecords) {
                const productId = v.product;
                if (!variantsByProduct.has(productId)) {
                    variantsByProduct.set(productId, []);
                }
                variantsByProduct.get(productId)!.push({
                    id: v.id,
                    product_id: v.product,
                    sku_suffix: v.sku_suffix || '',
                    variant_name: v.variant_name,
                    material: v.material || null,
                    size: v.size || null,
                    color: v.color || null,
                    price_adjustment: v.price_adjustment || 0,
                    stock_level: v.stock_level,
                    low_stock_threshold: v.low_stock_threshold || 5,
                    shopify_inventory_id: null,
                    woocommerce_product_id: null,
                    created_at: v.created,
                } as ProductVariant);
            }

            // Map to expected type
            const mappedProducts: ProductWithVariants[] = productRecords.map(p => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                description: p.description || null,
                category: p.category || null,
                base_price: p.base_price,
                cost_price: p.cost_price || null,
                image_url: p.image_url || null,
                barcode_data: p.barcode || null,
                is_active: p.is_active,
                created_at: p.created,
                updated_at: p.updated,
                variants: variantsByProduct.get(p.id) || [],
            }));

            setProducts(mappedProducts);
        } catch (err) {
            console.error("Error fetching products:", err);
            setError("Failed to load products");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProducts();

        // Subscribe to realtime updates
        const unsub = subscribeToCollection('products', () => {
            fetchProducts();
        });

        return () => {
            unsub();
        };
    }, [fetchProducts]);

    return { products, isLoading, error, refetch: fetchProducts };
}

/**
 * Hook to search products by SKU or name
 */
export function useProductSearch() {
    const [results, setResults] = useState<ProductWithVariants[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const search = useCallback(async (query: string) => {
        if (!query || query.length < 2) {
            setResults([]);
            return;
        }

        setIsSearching(true);

        try {
            const productRecords = await pb.collection('products').getList<PBProduct>(1, 10, {
                filter: `is_active=true && (name~"${query}" || sku~"${query}")`,
            });

            // Fetch variants for found products
            const productIds = productRecords.items.map(p => p.id);
            let variantRecords: PBVariant[] = [];
            if (productIds.length > 0) {
                const variantFilter = productIds.map(id => `product="${id}"`).join(' || ');
                variantRecords = await pb.collection('product_variants').getFullList<PBVariant>({
                    filter: variantFilter,
                });
            }

            // Group variants by product
            const variantsByProduct = new Map<string, ProductVariant[]>();
            for (const v of variantRecords) {
                const productId = v.product;
                if (!variantsByProduct.has(productId)) {
                    variantsByProduct.set(productId, []);
                }
                variantsByProduct.get(productId)!.push({
                    id: v.id,
                    product_id: v.product,
                    sku_suffix: v.sku_suffix || '',
                    variant_name: v.variant_name,
                    material: v.material || null,
                    size: v.size || null,
                    color: v.color || null,
                    price_adjustment: v.price_adjustment || 0,
                    stock_level: v.stock_level,
                    low_stock_threshold: v.low_stock_threshold || 5,
                    shopify_inventory_id: null,
                    woocommerce_product_id: null,
                    created_at: v.created,
                } as ProductVariant);
            }

            const mappedProducts: ProductWithVariants[] = productRecords.items.map(p => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                description: p.description || null,
                category: p.category || null,
                base_price: p.base_price,
                cost_price: p.cost_price || null,
                image_url: p.image_url || null,
                barcode_data: p.barcode || null,
                is_active: p.is_active,
                created_at: p.created,
                updated_at: p.updated,
                variants: variantsByProduct.get(p.id) || [],
            }));

            setResults(mappedProducts);
        } catch (err) {
            console.error("Search error:", err);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    }, []);

    const searchBySku = useCallback(async (sku: string): Promise<ProductVariant | null> => {
        try {
            // First try exact match on variant SKU suffix
            const variants = await pb.collection('product_variants').getList<PBVariant>(1, 1, {
                filter: `sku_suffix="${sku}"`,
                expand: 'product',
            });

            if (variants.items.length > 0) {
                const v = variants.items[0];
                return {
                    id: v.id,
                    product_id: v.product,
                    sku_suffix: v.sku_suffix || '',
                    variant_name: v.variant_name,
                    material: v.material || null,
                    size: v.size || null,
                    color: v.color || null,
                    price_adjustment: v.price_adjustment || 0,
                    stock_level: v.stock_level,
                    low_stock_threshold: v.low_stock_threshold || 5,
                    shopify_inventory_id: null,
                    woocommerce_product_id: null,
                    created_at: v.created,
                } as ProductVariant;
            }

            // Try matching against product SKU
            const products = await pb.collection('products').getList<PBProduct>(1, 1, {
                filter: `sku~"${sku}"`,
            });

            if (products.items.length > 0) {
                const p = products.items[0];
                const pVariants = await pb.collection('product_variants').getList<PBVariant>(1, 1, {
                    filter: `product="${p.id}"`,
                });

                if (pVariants.items.length > 0) {
                    const v = pVariants.items[0];
                    return {
                        id: v.id,
                        product_id: v.product,
                        sku_suffix: v.sku_suffix || '',
                        variant_name: v.variant_name,
                        material: v.material || null,
                        size: v.size || null,
                        color: v.color || null,
                        price_adjustment: v.price_adjustment || 0,
                        stock_level: v.stock_level,
                        low_stock_threshold: v.low_stock_threshold || 5,
                        shopify_inventory_id: null,
                        woocommerce_product_id: null,
                        created_at: v.created,
                    } as ProductVariant;
                }
            }

            return null;
        } catch (err) {
            console.error("SKU search error:", err);
            return null;
        }
    }, []);

    return { results, isSearching, search, searchBySku, clearResults: () => setResults([]) };
}

/**
 * Hook to manage sales transactions
 */
export function useSales() {
    const [sales, setSales] = useState<Sale[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchSales = useCallback(async (limit = 50) => {
        setIsLoading(true);

        try {
            const records = await pb.collection('sales').getList(1, limit, {
                sort: '-created',
            });

            const mappedSales: Sale[] = records.items.map((s: any) => ({
                id: s.id,
                channel: s.channel,
                channel_order_id: s.channel_order_id || null,
                customer_name: s.customer_name || null,
                customer_phone: s.customer_phone || null,
                customer_address: s.customer_address || null,
                subtotal: s.subtotal,
                discount: s.discount || 0,
                total: s.total,
                payment_method: s.payment_method || null,
                status: s.status,
                notes: s.notes || null,
                created_at: s.created,
                updated_at: s.updated,
            }));

            setSales(mappedSales);
        } catch (err) {
            console.error("Error fetching sales:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const createSale = useCallback(
        async (
            saleData: {
                channel: "pos" | "shopify" | "woocommerce" | "whatsapp";
                channel_order_id?: string | null;
                customer_name?: string | null;
                customer_phone?: string | null;
                customer_address?: string | null;
                subtotal: number;
                discount: number;
                total: number;
                payment_method?: string | null;
                status?: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
                notes?: string | null;
            },
            items: { variant_id: string; quantity: number; unit_price: number }[]
        ): Promise<Sale | null> => {
            try {
                // Create sale
                const saleRecord = await pb.collection('sales').create({
                    channel: saleData.channel,
                    channel_order_id: saleData.channel_order_id || '',
                    customer_name: saleData.customer_name || '',
                    customer_phone: saleData.customer_phone || '',
                    subtotal: saleData.subtotal,
                    discount: saleData.discount,
                    total: saleData.total,
                    payment_method: saleData.payment_method || 'cash',
                    status: saleData.status || 'confirmed',
                    notes: saleData.notes || '',
                });

                // Create sale items
                for (const item of items) {
                    await pb.collection('sale_items').create({
                        sale: saleRecord.id,
                        variant: item.variant_id,
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        total_price: item.quantity * item.unit_price,
                    });

                    // Update stock level
                    const variant = await pb.collection('product_variants').getOne(item.variant_id);
                    await pb.collection('product_variants').update(item.variant_id, {
                        stock_level: (variant.stock_level || 0) - item.quantity,
                    });

                    // Log stock movement
                    await pb.collection('stock_movements').create({
                        variant: item.variant_id,
                        movement_type: 'sale',
                        quantity: -item.quantity,
                        reference_id: saleRecord.id,
                        source: saleData.channel,
                    });
                }

                return {
                    id: saleRecord.id,
                    channel: saleData.channel,
                    channel_order_id: saleData.channel_order_id || null,
                    customer_name: saleData.customer_name || null,
                    customer_phone: saleData.customer_phone || null,
                    customer_address: saleData.customer_address || null,
                    subtotal: saleData.subtotal,
                    discount: saleData.discount,
                    total: saleData.total,
                    payment_method: saleData.payment_method || null,
                    status: saleData.status || 'confirmed',
                    notes: saleData.notes || null,
                    created_at: saleRecord.created,
                    updated_at: saleRecord.updated,
                };
            } catch (err) {
                console.error("Error creating sale:", err);
                return null;
            }
        },
        []
    );

    useEffect(() => {
        fetchSales();

        const unsub = subscribeToCollection('sales', () => {
            fetchSales();
        });

        return () => {
            unsub();
        };
    }, [fetchSales]);

    return { sales, isLoading, refetch: fetchSales, createSale };
}

/**
 * Hook to track low stock items
 */
export function useLowStockAlerts() {
    const [lowStockItems, setLowStockItems] = useState<
        (ProductVariant & { product: Product })[]
    >([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchLowStock = useCallback(async () => {
        setIsLoading(true);

        try {
            const records = await pb.collection('product_variants').getFullList<PBVariant>({
                filter: 'stock_level <= 5',
                sort: 'stock_level',
                expand: 'product',
            });

            const mappedItems = records.map(v => {
                const p = v.expand?.product;
                return {
                    id: v.id,
                    product_id: v.product,
                    sku_suffix: v.sku_suffix || '',
                    variant_name: v.variant_name,
                    material: v.material || null,
                    size: v.size || null,
                    color: v.color || null,
                    price_adjustment: v.price_adjustment || 0,
                    stock_level: v.stock_level,
                    low_stock_threshold: v.low_stock_threshold || 5,
                    shopify_inventory_id: null,
                    woocommerce_product_id: null,
                    created_at: v.created,
                    product: p ? {
                        id: p.id,
                        sku: p.sku,
                        name: p.name,
                        description: p.description || null,
                        category: p.category || null,
                        base_price: p.base_price,
                        cost_price: p.cost_price || null,
                        image_url: p.image_url || null,
                        barcode_data: p.barcode || null,
                        is_active: p.is_active,
                        created_at: p.created,
                        updated_at: p.updated,
                    } : undefined,
                } as (ProductVariant & { product: Product });
            });

            setLowStockItems(mappedItems);
        } catch (err) {
            console.error("Error fetching low stock:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLowStock();

        const unsub = subscribeToCollection('product_variants', () => {
            fetchLowStock();
        });

        return () => {
            unsub();
        };
    }, [fetchLowStock]);

    return { lowStockItems, isLoading, refetch: fetchLowStock };
}

/**
 * Hook to get dashboard stats
 */
export function useDashboardStats() {
    const [stats, setStats] = useState({
        totalProducts: 0,
        totalStock: 0,
        todaySales: 0,
        todayRevenue: 0,
        lowStockCount: 0,
    });
    const [isLoading, setIsLoading] = useState(true);

    const fetchStats = useCallback(async () => {
        setIsLoading(true);

        try {
            // Get product count
            const products = await pb.collection('products').getList(1, 1, {
                filter: 'is_active=true',
            });
            const productCount = products.totalItems;

            // Get total stock
            const variants = await pb.collection('product_variants').getFullList<{ stock_level: number }>();
            const totalStock = variants.reduce((sum, v) => sum + (v.stock_level || 0), 0);

            // Get today's sales
            const today = new Date().toISOString().split("T")[0];
            const todaySalesRecords = await pb.collection('sales').getFullList<{ total: number; status: string }>({
                filter: `created >= "${today} 00:00:00" && status != "cancelled"`,
            });

            const todaySales = todaySalesRecords.length;
            const todayRevenue = todaySalesRecords.reduce((sum, s) => sum + (s.total || 0), 0);

            // Get low stock count
            const lowStockVariants = await pb.collection('product_variants').getList(1, 1, {
                filter: 'stock_level <= 5',
            });
            const lowStockCount = lowStockVariants.totalItems;

            setStats({
                totalProducts: productCount,
                totalStock,
                todaySales,
                todayRevenue,
                lowStockCount,
            });
        } catch (err) {
            console.error("Error fetching stats:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();

        // Refresh stats every 30 seconds
        const interval = setInterval(fetchStats, 30000);

        return () => clearInterval(interval);
    }, [fetchStats]);

    return { stats, isLoading, refetch: fetchStats };
}
