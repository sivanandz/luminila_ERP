"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase, subscribeToTable } from "@/lib/supabase";
import type {
    Product,
    ProductVariant,
    ProductWithVariants,
    Sale,
    SaleWithItems,
} from "@/types/database";

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
            const { data, error: fetchError } = await supabase
                .from("products")
                .select(`
          *,
          variants:product_variants(*)
        `)
                .eq("is_active", true)
                .order("name");

            if (fetchError) throw fetchError;

            setProducts(data as ProductWithVariants[]);
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
        const channel = subscribeToTable("products", (payload) => {
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
                fetchProducts(); // Refetch to get full data with variants
            } else if (payload.eventType === "DELETE") {
                setProducts((prev) =>
                    prev.filter((p) => p.id !== payload.old.id)
                );
            }
        });

        return () => {
            supabase.removeChannel(channel);
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
            const { data, error } = await supabase
                .from("products")
                .select(`
          *,
          variants:product_variants(*)
        `)
                .eq("is_active", true)
                .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
                .limit(10);

            if (error) throw error;

            setResults(data as ProductWithVariants[]);
        } catch (err) {
            console.error("Search error:", err);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    }, []);

    const searchBySku = useCallback(async (sku: string): Promise<ProductVariant | null> => {
        try {
            // First try exact match on variant SKU (product_sku + sku_suffix)
            const { data: variants, error } = await supabase
                .from("product_variants")
                .select(`
          *,
          product:products(*)
        `)
                .or(`sku_suffix.eq.${sku}`)
                .limit(1);

            if (error) throw error;

            if (variants && variants.length > 0) {
                return variants[0] as ProductVariant;
            }

            // Try matching against product SKU
            const { data: products, error: prodError } = await supabase
                .from("products")
                .select(`
          *,
          variants:product_variants(*)
        `)
                .ilike("sku", `%${sku}%`)
                .limit(1);

            if (prodError) throw prodError;

            if (products && products.length > 0) {
                const product = products[0] as ProductWithVariants;
                if (product.variants.length > 0) {
                    return { ...product.variants[0], product } as unknown as ProductVariant;
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
            const { data, error } = await supabase
                .from("sales")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(limit);

            if (error) throw error;

            setSales(data as Sale[]);
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
                const { data: sale, error: saleError } = await supabase
                    .from("sales")
                    .insert(saleData as never)
                    .select()
                    .single();

                if (saleError) throw saleError;

                // Type assertion for sale data
                const saleRecord = sale as unknown as Sale;

                // Create sale items
                const saleItems = items.map((item) => ({
                    sale_id: saleRecord.id,
                    variant_id: item.variant_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                }));

                const { error: itemsError } = await supabase
                    .from("sale_items")
                    .insert(saleItems as never);

                if (itemsError) throw itemsError;

                // Update stock levels and log movements
                for (const item of items) {
                    // Log stock movement (RPC would be better but we'll skip for now)
                    await supabase.from("stock_movements").insert({
                        variant_id: item.variant_id,
                        movement_type: "sale",
                        quantity: -item.quantity,
                        reference_id: saleRecord.id,
                        source: saleData.channel,
                    } as never);
                }

                return saleRecord;
            } catch (err) {
                console.error("Error creating sale:", err);
                return null;
            }
        },
        []
    );

    useEffect(() => {
        fetchSales();

        const channel = subscribeToTable("sales", () => {
            fetchSales();
        });

        return () => {
            supabase.removeChannel(channel);
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
            const { data, error } = await supabase
                .from("product_variants")
                .select(`
          *,
          product:products(*)
        `)
                .lte("stock_level", 5) // Or use low_stock_threshold column
                .order("stock_level");

            if (error) throw error;

            setLowStockItems(data as (ProductVariant & { product: Product })[]);
        } catch (err) {
            console.error("Error fetching low stock:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLowStock();

        const channel = subscribeToTable("product_variants", () => {
            fetchLowStock();
        });

        return () => {
            supabase.removeChannel(channel);
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
            const { count: productCount } = await supabase
                .from("products")
                .select("*", { count: "exact", head: true })
                .eq("is_active", true);

            // Get total stock
            const { data: stockData } = await supabase
                .from("product_variants")
                .select("stock_level");
            const stockDataTyped = stockData as { stock_level: number }[] | null;
            const totalStock = stockDataTyped?.reduce((sum, v) => sum + (v.stock_level || 0), 0) || 0;

            // Get today's sales
            const today = new Date().toISOString().split("T")[0];
            const { data: todaySalesData } = await supabase
                .from("sales")
                .select("total")
                .gte("created_at", `${today}T00:00:00`)
                .neq("status", "cancelled");

            const salesDataTyped = todaySalesData as { total: number }[] | null;
            const todaySales = salesDataTyped?.length || 0;
            const todayRevenue = salesDataTyped?.reduce((sum, s) => sum + (s.total || 0), 0) || 0;

            // Get low stock count
            const { count: lowStockCount } = await supabase
                .from("product_variants")
                .select("*", { count: "exact", head: true })
                .lte("stock_level", 5);

            setStats({
                totalProducts: productCount || 0,
                totalStock,
                todaySales,
                todayRevenue,
                lowStockCount: lowStockCount || 0,
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
