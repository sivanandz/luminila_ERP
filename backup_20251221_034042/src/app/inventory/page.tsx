"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout";
import { formatPrice } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
    Search,
    Plus,
    Upload,
    Download,
    RefreshCw,
    MoreVertical,
    Package,
    Printer,
    Edit,
    AlertTriangle
} from "lucide-react";

interface Product {
    id: string;
    sku: string;
    name: string;
    category: string;
    material?: string;
    price: number;
    stock: number;
    image: string | null;
}

const categories = ["All", "Earrings", "Necklaces", "Bracelets", "Rings"];

export default function InventoryPage() {
    const [selectedCategory, setSelectedCategory] = useState("All");
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch products from Supabase
    const fetchProducts = async () => {
        try {
            setLoading(true);
            setError(null);

            const { data, error } = await supabase
                .from('products')
                .select(`
                    id,
                    sku,
                    name,
                    category,
                    base_price,
                    image_url,
                    variants:product_variants (
                        stock_level,
                        material
                    )
                `);

            if (error) throw error;

            if (data) {
                const mappedProducts: Product[] = data.map((p: any) => ({
                    id: p.id,
                    sku: p.sku,
                    name: p.name,
                    category: p.category || "Uncategorized",
                    price: p.base_price,
                    image: p.image_url,
                    // Sum stock from all variants, default to 0
                    stock: p.variants?.reduce((sum: number, v: any) => sum + (v.stock_level || 0), 0) || 0,
                    // Take material from first variant as representative
                    material: p.variants?.[0]?.material
                }));

                // Sort by name for now
                mappedProducts.sort((a, b) => a.name.localeCompare(b.name));

                setProducts(mappedProducts);
            }
        } catch (err: any) {
            console.error("Error fetching products:", err);
            setError(err.message || "Failed to load products");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();

        // Realtime subscription for updates
        const channel = supabase
            .channel('public:inventory_updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchProducts)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'product_variants' }, fetchProducts)
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // Filter products
    const filteredProducts = products.filter(product => {
        const matchesCategory = selectedCategory === "All" || product.category === selectedCategory;
        // Add search logic here if you wire up the search input state
        return matchesCategory;
    });

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Inventory"
                subtitle={`${products.length} products • ${products.reduce((acc, p) => acc + p.stock, 0)} total units`}
                action={
                    <button className="bg-primary hover:bg-primary/90 text-bg-navy h-11 px-5 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ml-1 shadow-[0_4px_10px_rgba(238,189,43,0.3)]">
                        <Plus size={20} />
                        <span>Add Product</span>
                    </button>
                }
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto flex flex-col gap-8">

                    {/* Filters & Actions */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1">
                            <div className="relative group max-w-sm flex-1">
                                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone group-focus-within:text-primary">
                                    <Search size={20} />
                                </div>
                                <input
                                    className="bg-surface-navy border-none text-white text-sm rounded-lg block w-full pl-10 py-3 pr-4 focus:ring-1 focus:ring-primary placeholder-moonstone transition-all shadow-sm"
                                    placeholder="Search by name or SKU..."
                                    type="text"
                                />
                            </div>

                            <div className="flex bg-surface-navy p-1 rounded-lg border border-surface-hover">
                                {categories.map(category => (
                                    <button
                                        key={category}
                                        onClick={() => setSelectedCategory(category)}
                                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${selectedCategory === category
                                            ? "bg-bg-navy text-white shadow-sm ring-1 ring-white/10"
                                            : "text-moonstone hover:text-white hover:bg-white/5"
                                            }`}
                                    >
                                        {category}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchProducts}
                                className="bg-surface-navy hover:bg-surface-hover text-moonstone hover:text-white h-10 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-surface-hover"
                            >
                                <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Sync
                            </button>
                            <button className="bg-surface-navy hover:bg-surface-hover text-moonstone hover:text-white h-10 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-surface-hover">
                                <Upload size={16} /> Import
                            </button>
                            <button className="bg-surface-navy hover:bg-surface-hover text-moonstone hover:text-white h-10 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-surface-hover">
                                <Download size={16} /> Export
                            </button>
                        </div>
                    </div>

                    {/* Error State */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center gap-3">
                            <AlertTriangle size={20} />
                            <div>
                                <p className="font-bold text-sm">Failed to load products</p>
                                <p className="text-xs opacity-80">{error}</p>
                            </div>
                            <button onClick={fetchProducts} className="ml-auto text-xs underline hover:text-red-300">Retry</button>
                        </div>
                    )}

                    {/* Products Grid */}
                    {loading && products.length === 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="bg-surface-navy rounded-xl p-4 border border-surface-hover h-[280px] animate-pulse">
                                    <div className="bg-bg-navy h-40 rounded-lg mb-4 opacity-50"></div>
                                    <div className="h-4 bg-bg-navy rounded w-3/4 mb-2 opacity-50"></div>
                                    <div className="h-3 bg-bg-navy rounded w-1/2 opacity-50"></div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredProducts.map((product) => (
                                <div key={product.id} className="bg-surface-navy rounded-xl border border-surface-hover p-4 group hover:border-primary/50 transition-colors shadow-sm hover:shadow-md">
                                    {/* Image Area */}
                                    <div className="aspect-square bg-bg-navy rounded-lg mb-4 flex items-center justify-center relative overflow-hidden group-hover:shadow-inner border border-surface-hover/50">
                                        {product.image ? (
                                            <div className="w-full h-full bg-cover bg-center transition-transform group-hover:scale-105 duration-500" style={{ backgroundImage: `url(${product.image})` }} />
                                        ) : (
                                            <Package size={48} className="text-surface-hover/50" />
                                        )}

                                        {/* Hover Overlay */}
                                        <div className="absolute inset-0 bg-bg-navy/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[2px]">
                                            <button className="bg-primary text-bg-navy p-2 rounded-lg hover:scale-110 transition-transform shadow-lg">
                                                <Edit size={18} />
                                            </button>
                                            <button className="bg-white text-bg-navy p-2 rounded-lg hover:scale-110 transition-transform shadow-lg">
                                                <Printer size={18} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="min-w-0 pr-2">
                                            <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-0.5">{product.sku}</p>
                                            <h3 className="text-white font-bold text-sm truncate" title={product.name}>{product.name}</h3>
                                            <p className="text-moonstone text-xs truncate mt-0.5">{product.category}</p>
                                        </div>
                                        <button className="text-moonstone hover:text-white p-1 hover:bg-bg-navy rounded transition-colors">
                                            <MoreVertical size={16} />
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-surface-hover">
                                        <span className="text-white font-bold">{formatPrice(product.price)}</span>
                                        {product.stock === 0 ? (
                                            <span className="text-red-400 text-[10px] font-bold bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20 uppercase tracking-wide">Out of Stock</span>
                                        ) : product.stock <= 5 ? (
                                            <span className="text-orange-400 text-[10px] font-bold bg-orange-400/10 px-2 py-0.5 rounded border border-orange-400/20 uppercase tracking-wide">{product.stock} Low Stock</span>
                                        ) : (
                                            <span className="text-emerald-400 text-[10px] font-bold bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 uppercase tracking-wide">{product.stock} Units</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && products.length === 0 && !error && (
                        <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-surface-hover rounded-xl bg-bg-navy/30">
                            <div className="bg-surface-navy p-4 rounded-full mb-4 shadow-lg">
                                <Package size={48} className="text-surface-hover" />
                            </div>
                            <h3 className="text-white text-lg font-bold">No products found</h3>
                            <p className="text-moonstone text-sm max-w-xs mx-auto mt-2">
                                Try adjusting your search query or add a new product to your inventory.
                            </p>
                            <button className="mt-6 btn btn-primary">
                                <Plus size={18} />
                                Add First Product
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
