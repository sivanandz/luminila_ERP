"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
    AlertTriangle,
    Copy,
    CopyPlus,
    Trash2,
    Save,
    Loader2
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { getCategories, type Category } from "@/lib/categories";
import { getAttributes, type ProductAttribute } from "@/lib/attributes";

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

export default function InventoryPage() {
    const [selectedCategory, setSelectedCategory] = useState("All");
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [formLoading, setFormLoading] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
    const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
    const [showImportDialog, setShowImportDialog] = useState(false);
    const [importData, setImportData] = useState<Record<string, string>[]>([]);
    const [importLoading, setImportLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Edit mode - reuses Add Product dialog
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingProductId, setEditingProductId] = useState<string | null>(null);

    // Router for navigation
    const router = useRouter();

    // Form state
    const [newProduct, setNewProduct] = useState({
        name: "",
        sku: "",
        category: "",
        base_price: "",
        stock: "",
        hsn_code: "7117",
        image_url: "",
    });
    const [productImagePreview, setProductImagePreview] = useState<string | null>(null);
    const productImageRef = useRef<HTMLInputElement>(null);

    // Auto-generate SKU from category and attributes
    const generateSKU = (category: string, attrVals: Record<string, string>) => {
        if (!category) return;

        // Get category prefix (first 3 letters uppercase)
        const catPrefix = category.substring(0, 3).toUpperCase();

        // Get attribute codes (first 2 letters of each value)
        const attrCodes = Object.values(attrVals)
            .filter(v => v && v.length > 0)
            .map(v => v.substring(0, 2).toUpperCase())
            .slice(0, 3) // Max 3 attribute codes
            .join('');

        // Add timestamp for uniqueness
        const timestamp = Date.now().toString(36).toUpperCase().slice(-4);

        const sku = `${catPrefix}-${attrCodes || 'XX'}-${timestamp}`;
        setNewProduct(prev => ({ ...prev, sku }));
    };

    // Handle file selection (Excel with embedded images or CSV)
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            // Upload to server-side API for parsing with ExcelJS (supports embedded images)
            try {
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch('/api/parse-excel', {
                    method: 'POST',
                    body: formData,
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Failed to parse Excel');
                }

                setImportData(result.products || []);
                setShowImportDialog(true);

                if (result.imageCount > 0) {
                    console.log(`Extracted ${result.imageCount} embedded images`);
                }
            } catch (error: any) {
                console.error('Excel parse error:', error);
                alert('Failed to parse Excel file: ' + error.message);
            }
        } else {
            // Fallback to CSV parsing
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result as string;
                const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('#') && !line.startsWith('INSTRUCTIONS'));
                if (lines.length < 2) return;

                const headers = lines[0].split(',').map(h => h.trim());
                const data: Record<string, string>[] = [];

                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(',').map(v => v.trim());
                    if (values.length < 4) continue;

                    const row: Record<string, string> = {};
                    headers.forEach((header, idx) => {
                        row[header] = values[idx] || '';
                    });

                    if (row['Name'] || row['name']) data.push(row);
                }
                setImportData(data);
                setShowImportDialog(true);
            };
            reader.readAsText(file);
        }
    };

    // Bulk import products
    const handleBulkImport = async () => {
        if (importData.length === 0) return;

        setImportLoading(true);
        let successCount = 0;
        let errorCount = 0;
        const STORAGE_KEY = 'luminila_products';

        for (const row of importData) {
            try {
                const name = row['Name'] || row['name'];
                const category = row['Category'] || row['category'] || 'Uncategorized';
                const basePrice = parseFloat(row['Base Price'] || row['base_price'] || '0');
                const stock = parseInt(row['Stock'] || row['stock'] || '0', 10);
                const hsnCode = row['HSN Code'] || row['hsn_code'] || '7117';
                const status = row['Status'] || row['status'] || 'available';

                // Generate SKU if not provided
                let sku = row['SKU'] || row['sku'];
                if (!sku) {
                    const catPrefix = category.substring(0, 3).toUpperCase();
                    const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
                    sku = `${catPrefix}-XX-${timestamp}${successCount}`;
                }

                // Try Supabase first
                let supabaseSuccess = false;
                try {
                    const { data: product, error: productError } = await supabase
                        .from('products')
                        .insert({
                            name,
                            sku,
                            category,
                            base_price: basePrice,
                            hsn_code: hsnCode,
                        } as any)
                        .select()
                        .single();

                    if (!productError && product) {
                        await supabase.from('product_variants').insert({
                            product_id: (product as any).id,
                            variant_sku: sku,
                            stock_level: stock,
                        } as any);
                        supabaseSuccess = true;
                    }
                } catch (e) {
                    console.warn('Supabase unavailable, using localStorage');
                }

                // Fallback to localStorage if Supabase failed
                if (!supabaseSuccess) {
                    const stored = localStorage.getItem(STORAGE_KEY);
                    const products = stored ? JSON.parse(stored) : [];
                    products.push({
                        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
                        name,
                        sku,
                        category,
                        base_price: basePrice,
                        price: basePrice,
                        hsn_code: hsnCode,
                        stock,
                        status,
                        material: row['Material'] || '',
                        color: row['Color'] || '',
                        image_url: row['Image URL'] || row['image_url'] || row['Image'] || '',
                        created_at: new Date().toISOString(),
                    });
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
                }

                successCount++;
            } catch (err) {
                console.error('Import error:', err);
                errorCount++;
            }
        }

        setImportLoading(false);
        setShowImportDialog(false);
        setImportData([]);
        if (fileInputRef.current) fileInputRef.current.value = '';

        alert(`Import Complete!\n✓ ${successCount} products imported\n✗ ${errorCount} errors`);
        fetchProducts();
    };

    // Fetch products from Supabase (with localStorage fallback)
    const fetchProducts = async () => {
        const STORAGE_KEY = 'luminila_products';
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
            console.warn("Supabase unavailable, trying localStorage");

            // Fallback to localStorage
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                try {
                    const localProducts = JSON.parse(stored);
                    const mappedProducts: Product[] = localProducts.map((p: any) => ({
                        id: p.id,
                        sku: p.sku,
                        name: p.name,
                        category: p.category || "Uncategorized",
                        price: p.base_price || p.price,
                        image: p.image_url || p.image,
                        stock: p.stock || 0,
                        material: p.material
                    }));
                    mappedProducts.sort((a, b) => a.name.localeCompare(b.name));
                    setProducts(mappedProducts);
                    setError(null); // Clear error since we loaded from localStorage
                } catch (e) {
                    console.error("Error parsing localStorage:", e);
                    setError("Failed to load products");
                }
            } else {
                setError(err.message || "Failed to load products");
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
        getCategories().then(setCategories);
        getAttributes().then(setAttributes);

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

    // Handle add/edit product
    const handleAddProduct = async () => {
        setFormLoading(true);
        try {
            if (isEditMode && editingProductId) {
                // Update existing product
                const { error: productError } = await supabase
                    .from('products')
                    .update({
                        name: newProduct.name,
                        sku: newProduct.sku,
                        category: newProduct.category,
                        base_price: parseFloat(newProduct.base_price) || 0,
                        hsn_code: newProduct.hsn_code,
                        image_url: newProduct.image_url // Ensure image is updated
                    })
                    .eq('id', editingProductId);

                if (productError) throw productError;

                // Update variant stock (assuming single variant model)
                const { data: variant } = await supabase
                    .from('product_variants')
                    .select('id')
                    .eq('product_id', editingProductId)
                    .single();

                if (variant) {
                    await supabase.from('product_variants').update({
                        stock_level: parseInt(newProduct.stock) || 0,
                        variant_sku: newProduct.sku
                    }).eq('id', variant.id);
                }
            } else {
                // Insert new product
                const { data: product, error: productError } = await supabase
                    .from('products')
                    .insert({
                        name: newProduct.name,
                        sku: newProduct.sku,
                        category: newProduct.category,
                        base_price: parseFloat(newProduct.base_price) || 0,
                        hsn_code: newProduct.hsn_code,
                    })
                    .select()
                    .single();

                if (productError) throw productError;

                // Create default variant with stock
                if (product) {
                    await supabase.from('product_variants').insert({
                        product_id: product.id,
                        variant_sku: newProduct.sku,
                        stock_level: parseInt(newProduct.stock) || 0,
                    });
                }
            }

            setShowAddDialog(false);
            setNewProduct({ name: '', sku: '', category: 'Earrings', base_price: '', stock: '', hsn_code: '7117', image_url: '' });
            fetchProducts();
        } catch (err: any) {
            console.error('Error saving product:', err);
            // Fallback for demo/offline: mimic update locally if Supabase fails
            if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
                alert("Supabase not connected. Changes specific to session.");
                setShowAddDialog(false);
                return;
            }
            alert('Failed to save product: ' + err.message);
        } finally {
            setFormLoading(false);
            setIsEditMode(false);
            setEditingProductId(null);
        }
    };

    // Filter products
    const filteredProducts = products.filter(product => {
        const matchesCategory = selectedCategory === "All" || product.category === selectedCategory;
        return matchesCategory;
    });

    // Handle delete product
    const handleDeleteProduct = async (id: string) => {
        if (!confirm("Are you sure you want to delete this product?")) return;

        try {
            // Try Supabase first
            const { error } = await supabase.from('products').delete().eq('id', id);

            if (error) {
                // If Supabase fails (or not connected), try localStorage
                throw error;
            }
            fetchProducts();
        } catch (err: any) {
            console.warn("Supabase delete failed, trying localStorage");
            // Fallback to local storage logic
            const STORAGE_KEY = 'luminila_products';
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const localProducts = JSON.parse(stored);
                // Filter out the deleted product
                const newProducts = localProducts.filter((p: any) => p.id !== id);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(newProducts));
                fetchProducts(); // Refresh state
            } else {
                console.error("Delete failed", err);
                alert("Failed to delete product");
            }
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Inventory"
                subtitle={`${products.length} products • ${products.reduce((acc, p) => acc + p.stock, 0)} total units`}
                action={
                    <Button onClick={() => setShowAddDialog(true)}>
                        <Plus size={20} className="mr-2" />
                        Add Product
                    </Button>
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
                                <button
                                    onClick={() => setSelectedCategory("All")}
                                    className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${selectedCategory === "All"
                                        ? "bg-bg-navy text-white shadow-sm ring-1 ring-white/10"
                                        : "text-moonstone hover:text-white hover:bg-white/5"
                                        }`}
                                >
                                    All
                                </button>
                                {categories.map(cat => (
                                    <button
                                        key={cat.id}
                                        onClick={() => setSelectedCategory(cat.name)}
                                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${selectedCategory === cat.name
                                            ? "bg-bg-navy text-white shadow-sm ring-1 ring-white/10"
                                            : "text-moonstone hover:text-white hover:bg-white/5"
                                            }`}
                                    >
                                        {cat.name}
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
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-surface-navy hover:bg-surface-hover text-moonstone hover:text-white h-10 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-surface-hover"
                            >
                                <Upload size={16} /> Import Excel
                            </button>
                            <a
                                href="/templates/inventory_import_template.csv"
                                download
                                className="bg-surface-navy hover:bg-surface-hover text-moonstone hover:text-white h-10 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors border border-surface-hover"
                            >
                                <Download size={16} /> Template
                            </a>
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
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // Populate Add Product form with existing data for editing
                                                    setNewProduct({
                                                        name: product.name,
                                                        sku: product.sku,
                                                        category: product.category,
                                                        base_price: String(product.price),
                                                        stock: String(product.stock),
                                                        hsn_code: "7117",
                                                        image_url: product.image || "",
                                                    });
                                                    setIsEditMode(true);
                                                    setEditingProductId(product.id);
                                                    setShowAddDialog(true);
                                                }}
                                                className="bg-primary text-bg-navy p-2 rounded-lg hover:scale-110 transition-transform shadow-lg"
                                                title="Edit Product"
                                            >
                                                <Edit size={18} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // Navigate to labels page with product data as query params
                                                    router.push(`/labels?sku=${encodeURIComponent(product.sku)}&name=${encodeURIComponent(product.name)}&price=${product.price}`);
                                                }}
                                                className="bg-bg-navy text-white border-2 border-white/80 p-2 rounded-lg hover:scale-110 transition-transform shadow-lg hover:bg-surface-navy"
                                                title="Print Label"
                                            >
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
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    className="text-moonstone hover:text-white p-1 hover:bg-bg-navy rounded transition-colors"
                                                    title="More Options"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <MoreVertical size={16} />
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-48 bg-surface-navy border-surface-hover text-white z-50">
                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                <DropdownMenuSeparator className="bg-surface-hover" />
                                                <DropdownMenuItem
                                                    className="cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigator.clipboard.writeText(product.sku);
                                                        // Simple temporary toast or alert for now
                                                        // In a real app we'd use a toast component
                                                        const el = document.createElement('div');
                                                        el.textContent = `Copied SKU: ${product.sku}`;
                                                        el.className = 'fixed bottom-4 right-4 bg-primary text-bg-navy px-4 py-2 rounded shadow-lg z-[100] animate-fade-in-up font-bold';
                                                        document.body.appendChild(el);
                                                        setTimeout(() => el.remove(), 2000);
                                                    }}
                                                >
                                                    <Copy className="mr-2 h-4 w-4" />
                                                    <span>Copy SKU</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setNewProduct({
                                                            name: product.name,
                                                            sku: `${product.sku}-COPY`,
                                                            category: product.category,
                                                            base_price: String(product.price),
                                                            stock: String(product.stock),
                                                            hsn_code: "7117", // Default or fetch if available
                                                            image_url: product.image || "",
                                                        });
                                                        setIsEditMode(false); // Mode is ADD, but data is filled
                                                        setShowAddDialog(true);
                                                    }}
                                                >
                                                    <CopyPlus className="mr-2 h-4 w-4" />
                                                    <span>Duplicate</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-surface-hover" />
                                                <DropdownMenuItem
                                                    className="cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-400/10 focus:bg-red-400/10 focus:text-red-300"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteProduct(product.id);
                                                    }}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    <span>Delete</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
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
                        <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border rounded-xl bg-muted/30">
                            <div className="bg-muted p-4 rounded-full mb-4 shadow-lg">
                                <Package size={48} className="text-muted-foreground" />
                            </div>
                            <h3 className="text-lg font-bold">No products found</h3>
                            <p className="text-muted-foreground text-sm max-w-xs mx-auto mt-2">
                                Try adjusting your search query or add a new product to your inventory.
                            </p>
                            <Button onClick={() => setShowAddDialog(true)} className="mt-6">
                                <Plus size={18} className="mr-2" />
                                Add First Product
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Add/Edit Product Dialog */}
            <Dialog open={showAddDialog} onOpenChange={(open) => {
                setShowAddDialog(open);
                if (!open) {
                    // Reset form state when closing
                    setIsEditMode(false);
                    setEditingProductId(null);
                    setNewProduct({ name: "", sku: "", category: "", base_price: "", stock: "", hsn_code: "7117", image_url: "" });
                }
            }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{isEditMode ? "Edit Product" : "Add New Product"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Product Name</Label>
                                <Input
                                    placeholder="Pearl Drop Earrings"
                                    value={newProduct.name}
                                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>SKU</Label>
                                <Input
                                    placeholder="LUM-EAR-001"
                                    value={newProduct.sku}
                                    onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Category</Label>
                                <Select
                                    value={newProduct.category}
                                    onValueChange={(v) => {
                                        setNewProduct({ ...newProduct, category: v });
                                        generateSKU(v, attributeValues);
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.length === 0 ? (
                                            <SelectItem value="uncategorized">Uncategorized</SelectItem>
                                        ) : (
                                            categories.map(cat => (
                                                <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>HSN Code</Label>
                                <Input
                                    placeholder="7117"
                                    value={newProduct.hsn_code}
                                    onChange={(e) => setNewProduct({ ...newProduct, hsn_code: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Base Price (₹)</Label>
                                <Input
                                    type="number"
                                    placeholder="1290"
                                    value={newProduct.base_price}
                                    onChange={(e) => setNewProduct({ ...newProduct, base_price: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Initial Stock</Label>
                                <Input
                                    type="number"
                                    placeholder="10"
                                    value={newProduct.stock}
                                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Dynamic Attributes */}
                        {attributes.length > 0 && (
                            <div className="space-y-4 border-t pt-4 mt-2">
                                <Label className="text-muted-foreground">Custom Attributes</Label>
                                <div className="grid grid-cols-2 gap-4">
                                    {attributes.map(attr => (
                                        <div key={attr.id} className="space-y-2">
                                            <Label>
                                                {attr.name}
                                                {attr.is_required && <span className="text-red-500 ml-1">*</span>}
                                            </Label>
                                            {attr.attribute_type === 'select' && attr.options ? (
                                                <Select
                                                    value={attributeValues[attr.id || ''] || ''}
                                                    onValueChange={(v) => {
                                                        setAttributeValues(prev => ({ ...prev, [attr.id || '']: v }));
                                                        // Auto-generate SKU
                                                        generateSKU(newProduct.category, { ...attributeValues, [attr.id || '']: v });
                                                    }}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {attr.options.map((opt: string) => (
                                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : attr.attribute_type === 'boolean' ? (
                                                <div className="flex items-center gap-2 h-10">
                                                    <input
                                                        type="checkbox"
                                                        checked={attributeValues[attr.id || ''] === 'true'}
                                                        onChange={(e) => setAttributeValues(prev => ({
                                                            ...prev,
                                                            [attr.id || '']: e.target.checked ? 'true' : 'false'
                                                        }))}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-sm text-muted-foreground">Yes</span>
                                                </div>
                                            ) : (
                                                <Input
                                                    type={attr.attribute_type === 'number' ? 'number' : 'text'}
                                                    placeholder={`Enter ${attr.name.toLowerCase()}`}
                                                    value={attributeValues[attr.id || ''] || ''}
                                                    onChange={(e) => setAttributeValues(prev => ({
                                                        ...prev,
                                                        [attr.id || '']: e.target.value
                                                    }))}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddProduct} disabled={formLoading || !newProduct.name || !newProduct.sku} className="min-w-[140px]">
                                {formLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {isEditMode ? "Saving..." : "Adding..."}
                                    </>
                                ) : (
                                    <>
                                        {isEditMode ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                                        {isEditMode ? "Save Changes" : "Add Product"}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Import Preview Dialog */}
            <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col bg-bg-navy border-surface-hover">
                    <DialogHeader className="pb-4 border-b border-surface-hover">
                        <DialogTitle className="text-xl text-white flex items-center gap-2">
                            <Upload size={20} className="text-amber-400" />
                            Import Preview - {importData.length} products found
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-auto py-4">
                        {importData.length > 0 && (
                            <div className="border border-surface-hover rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-surface-navy sticky top-0">
                                        <tr>
                                            <th className="text-left p-3 text-moonstone font-semibold">#</th>
                                            <th className="text-left p-3 text-moonstone font-semibold">Product Name</th>
                                            <th className="text-left p-3 text-moonstone font-semibold">Category</th>
                                            <th className="text-right p-3 text-moonstone font-semibold">Price</th>
                                            <th className="text-center p-3 text-moonstone font-semibold">Stock</th>
                                            <th className="text-left p-3 text-moonstone font-semibold">SKU</th>
                                            <th className="text-center p-3 text-moonstone font-semibold">Image</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {importData.map((row, idx) => (
                                            <tr key={idx} className="border-t border-surface-hover hover:bg-surface-hover/50 transition-colors">
                                                <td className="p-3 text-moonstone/60">{idx + 1}</td>
                                                <td className="p-3 text-white font-medium">{row['Name'] || row['name']}</td>
                                                <td className="p-3">
                                                    <span className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded text-xs">
                                                        {row['Category'] || row['category']}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-right text-emerald-400 font-mono">₹{row['Base Price'] || row['base_price']}</td>
                                                <td className="p-3 text-center">
                                                    <span className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-xs font-medium">
                                                        {row['Stock'] || row['stock']}
                                                    </span>
                                                </td>
                                                <td className="p-3 font-mono text-moonstone text-xs">{row['SKU'] || row['sku'] || '(auto-gen)'}</td>
                                                <td className="p-3 text-center">
                                                    {(row['Image'] || row['Image URL'] || row['image_url']) ? (
                                                        <img
                                                            src={row['Image'] || row['Image URL'] || row['image_url']}
                                                            alt="Product"
                                                            className="w-10 h-10 object-cover rounded border border-surface-hover mx-auto"
                                                        />
                                                    ) : (
                                                        <span className="text-moonstone/40 text-xs">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    <div className="flex justify-between items-center gap-3 pt-4 border-t border-surface-hover">
                        <span className="text-sm text-moonstone">{importData.length} products will be imported</span>
                        <div className="flex gap-3">
                            <Button variant="outline" onClick={() => {
                                setShowImportDialog(false);
                                setImportData([]);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            }}>
                                Cancel
                            </Button>
                            <Button onClick={handleBulkImport} disabled={importLoading || importData.length === 0}>
                                {importLoading ? "Importing..." : `Import ${importData.length} Products`}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}



