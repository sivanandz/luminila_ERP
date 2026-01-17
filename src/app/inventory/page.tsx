"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";

// Dynamic import for camera scanner
const BarcodeScanner = dynamic(
    () => import("@/components/pos/BarcodeScanner").then((mod) => mod.BarcodeScanner),
    { ssr: false, loading: () => <div className="h-48 bg-surface-navy rounded-lg animate-pulse flex items-center justify-center text-moonstone">Loading camera...</div> }
);
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout";
import { formatPrice } from "@/lib/utils";
// Supabase removed
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
    Loader2,
    ScanBarcode
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
import { getCategories, createCategory, type Category } from "@/lib/categories";
import { getAttributes, type ProductAttribute } from "@/lib/attributes";
import { printLabels, parseSKUFromBarcode } from "@/lib/barcode-generator";
import {
    getProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    updateStock,
    createVariant,
    getProductVariants,
    updateVariant,
    type Product as PBProduct,
    type ProductWithVariant
} from "@/lib/products";
import { toast } from "sonner";
import { pb } from "@/lib/pocketbase";

// UI Product interface (flat structure)
interface Product {
    id: string;
    sku: string;
    name: string;
    category: string; // Name
    categoryId?: string; // ID
    material?: string;
    price: number;
    stock: number;
    image: string | null;
    hsn_code?: string;
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

    // Edit mode
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingProductId, setEditingProductId] = useState<string | null>(null);

    // Scan State
    const [showScanDialog, setShowScanDialog] = useState(false);
    const [scanQuery, setScanQuery] = useState("");
    const [scanResult, setScanResult] = useState<Product | null>(null);
    const [scanStockInput, setScanStockInput] = useState("1");
    const scanInputRef = useRef<HTMLInputElement>(null);
    const [scanMode, setScanMode] = useState<'text' | 'camera'>('text');
    const [scanNotFoundSku, setScanNotFoundSku] = useState<string | null>(null);

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

    // Handle Scan Logic
    const handleScanSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!scanQuery.trim()) return;

        const normalizedQuery = scanQuery.trim().toUpperCase();
        const extractedSku = parseSKUFromBarcode(normalizedQuery) || normalizedQuery;

        const found = products.find(p =>
            p.sku.toUpperCase() === extractedSku ||
            p.sku.toUpperCase() === normalizedQuery ||
            p.name.toUpperCase().includes(normalizedQuery)
        );

        if (found) {
            setScanResult(found);
            setScanStockInput("1");
            setScanNotFoundSku(null);
        } else {
            setScanResult(null);
            setScanNotFoundSku(scanQuery.trim().toUpperCase());
        }
    };

    // Update stock from scanner
    const handleScanStockUpdate = async (change: number) => {
        if (!scanResult) return;

        try {
            const newStock = scanResult.stock + change;
            if (newStock < 0) {
                toast.error("Stock cannot be negative");
                return;
            }

            // Find variant to update
            const variants = await getProductVariants(scanResult.id);
            // Try to match variant by SKU or take first
            let variant = variants.find(v => v.variant_name === scanResult.sku || v.sku_suffix === scanResult.sku.split('-').pop());
            if (!variant && variants.length > 0) variant = variants[0];

            if (variant) {
                // Use service to update stock (PB doesn't support atomic increment easily yet, we do read-write in updateStock)
                // Use direct update here since we calculated newStock locally
                await updateVariant(variant.id, { stock_level: newStock });

                // Update local list
                setProducts(prev => prev.map(p =>
                    p.id === scanResult.id ? { ...p, stock: newStock } : p
                ));
                setScanResult(prev => prev ? { ...prev, stock: newStock } : null);

                toast.success(`Stock updated to ${newStock}`);

                if (change > 0) {
                    // Optional auto-clear
                }
            } else {
                toast.error("Could not find variant record to update.");
            }
        } catch (err) {
            console.error("Stock update failed", err);
            toast.error("Failed to update stock");
        }
    };

    // Auto-generate SKU
    const generateSKU = (categoryName: string, attrVals: Record<string, string>) => {
        if (!categoryName) return;
        const catPrefix = categoryName.substring(0, 3).toUpperCase();
        const attrCodes = Object.values(attrVals)
            .filter(v => v && v.length > 0)
            .map(v => v.substring(0, 2).toUpperCase())
            .slice(0, 3)
            .join('');
        const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
        const sku = `${catPrefix}-${attrCodes || 'XX'}-${timestamp}`;
        setNewProduct(prev => ({ ...prev, sku }));
    };

    // Fetch products
    const fetchProducts = async () => {
        try {
            setLoading(true);
            setError(null);

            const fetchedProducts = await getProducts();

            // Map PB data to UI Product interface
            // We need to fetch variants to get stock levels. 
            // Or assume stock is aggregated or stored on product (not recommended for variants but OK for simple fallback)
            // Ideally we query variants. 
            // For listing, doing N+1 queries is bad.
            // PB 'products' list response includes expanded 'category'.
            // Stock is in 'product_variants'. 
            // We can try to expand variants? expands: 'product_variants(product)' is reverse. 
            // PB supports reverse expand: expand: 'product_variants_via_product' if relation is set up?
            // PocketBase > 0.13 supports reverse relation expand if we use the correct syntax.
            // Assuming 'product_variants' has 'product' relation.
            // expand: 'product_variants(product)' might not work directly.

            // WORKAROUND: Fetch all variants (if < 1000 items OK) or fetch stock separately.
            // Or better: store total stock on Product record as a cached field.
            // For now, let's fetch all variants and map them. It's safe for < 200 products.

            const allVariants = await pb.collection('product_variants').getFullList();
            const variantMap = new Map(); // productId -> sum stock
            const variantMaterialMap = new Map(); // productId -> material

            allVariants.forEach((v: any) => {
                const pid = v.product;
                const currentStock = variantMap.get(pid) || 0;
                variantMap.set(pid, currentStock + (v.stock_level || 0));

                if (v.material && !variantMaterialMap.has(pid)) {
                    variantMaterialMap.set(pid, v.material);
                }
            });

            const mappedProducts: Product[] = fetchedProducts.map((p: any) => {
                const catName = p.expand?.category?.name || "Uncategorized";
                return {
                    id: p.id,
                    sku: p.sku,
                    name: p.name,
                    category: p.category ? catName : "Uncategorized",
                    categoryId: p.category,
                    price: p.base_price,
                    stock: variantMap.get(p.id) || 0,
                    material: variantMaterialMap.get(p.id),
                    image: p.image_url,
                    hsn_code: p.hsn_code
                };
            });

            setProducts(mappedProducts);
        } catch (err: any) {
            console.error("Fetch error:", err);
            setError(err.message || "Failed to load products");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
        getCategories().then(setCategories);
        getAttributes().then(setAttributes);

        // Realtime subscription
        pb.collection('products').subscribe('*', fetchProducts);
        pb.collection('product_variants').subscribe('*', fetchProducts);

        return () => {
            pb.collection('products').unsubscribe('*');
            pb.collection('product_variants').unsubscribe('*');
        };
    }, []);

    // Handle add/edit
    const handleAddProduct = async () => {
        setFormLoading(true);
        try {
            // Find category ID from name if needed
            let categoryId = newProduct.category;
            const catObj = categories.find(c => c.name === newProduct.category || c.id === newProduct.category);
            if (catObj) categoryId = catObj.id;
            // If new category (simple string), create it?
            if (!catObj && newProduct.category && newProduct.category !== "Uncategorized") {
                try {
                    const newCat = await createCategory({ name: newProduct.category, is_active: true });
                    categoryId = newCat.id;
                    setCategories(prev => [...prev, newCat]);
                } catch (e) { console.error("Cat create failed", e) }
            }

            if (isEditMode && editingProductId) {
                // Update
                await updateProduct(editingProductId, {
                    name: newProduct.name,
                    sku: newProduct.sku,
                    category: categoryId,
                    base_price: parseFloat(newProduct.base_price) || 0,
                    hsn_code: newProduct.hsn_code,
                    image_url: newProduct.image_url
                });

                // Update stock (find first variant)
                const variants = await getProductVariants(editingProductId);
                if (variants.length > 0) {
                    await updateVariant(variants[0].id, {
                        stock_level: parseInt(newProduct.stock) || 0,
                        variant_name: newProduct.sku
                    });
                } else {
                    // Create if missing
                    await createVariant({
                        product: editingProductId,
                        variant_name: newProduct.sku,
                        stock_level: parseInt(newProduct.stock) || 0
                    });
                }
                toast.success("Product updated");
            } else {
                // Create
                const product = await createProduct({
                    name: newProduct.name,
                    sku: newProduct.sku,
                    category: categoryId,
                    base_price: parseFloat(newProduct.base_price) || 0,
                    hsn_code: newProduct.hsn_code,
                    image_url: newProduct.image_url,
                    is_active: true
                });

                // Create default variant
                await createVariant({
                    product: product.id,
                    variant_name: newProduct.sku,
                    stock_level: parseInt(newProduct.stock) || 0
                });
                toast.success("Product created");
            }

            setShowAddDialog(false);
            setNewProduct({ name: '', sku: '', category: 'Earrings', base_price: '', stock: '', hsn_code: '7117', image_url: '' });
            fetchProducts();
        } catch (err: any) {
            console.error('Error saving product:', err);
            toast.error('Failed to save: ' + err.message);
        } finally {
            setFormLoading(false);
            setIsEditMode(false);
            setEditingProductId(null);
        }
    };

    const handleDeleteProduct = async (id: string) => {
        if (!confirm("Are you sure you want to delete this product?")) return;
        try {
            await deleteProduct(id);
            toast.success("Product deleted");
            fetchProducts();
        } catch (err) {
            toast.error("Failed to delete product");
        }
    };

    // File import logic reused (simplified)
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        // Assuming similar logic for parsing, but saving via PB
        // For brevity, using the existing parsing logic if it was robust, 
        // but rewriting just the save part in handleBulkImport
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
            if (lines.length < 2) return;
            const headers = lines[0].split(',').map(h => h.trim());
            const data: Record<string, string>[] = [];
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim());
                if (values.length < headers.length) continue;
                const row: Record<string, string> = {};
                headers.forEach((header, idx) => { row[header] = values[idx] || ''; });
                if (row['Name'] || row['name']) data.push(row);
            }
            setImportData(data);
            setShowImportDialog(true);
        };
        reader.readAsText(file);
    };

    const handleBulkImport = async () => {
        if (importData.length === 0) return;
        setImportLoading(true);
        let success = 0;
        let errors = 0;

        const defaultCat = categories.find(c => c.name === "Uncategorized")?.id || categories[0]?.id;

        for (const row of importData) {
            try {
                const name = row['Name'] || row['name'];
                const sku = row['SKU'] || row['sku'] || `SKU-${Date.now()}`;
                const price = parseFloat(row['Price'] || row['price'] || '0');
                const stock = parseInt(row['Stock'] || row['stock'] || '0');

                const product = await createProduct({
                    name,
                    sku,
                    base_price: price,
                    category: defaultCat,
                    is_active: true
                });

                await createVariant({
                    product: product.id,
                    variant_name: sku,
                    stock_level: stock
                });
                success++;
            } catch (e) {
                errors++;
            }
        }

        setImportLoading(false);
        setShowImportDialog(false);
        setImportData([]);
        toast.success(`Imported ${success} items. ${errors} failed.`);
        fetchProducts();
    };


    const filteredProducts = products.filter(product => {
        return selectedCategory === "All" || product.category === selectedCategory || product.categoryId === selectedCategory;
    });

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
                    {/* Filters */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1">
                            <div className="relative group max-w-sm flex-1">
                                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone">
                                    <Search size={20} />
                                </div>
                                <input
                                    className="bg-surface-navy border-none text-white text-sm rounded-lg block w-full pl-10 py-3 pr-4 focus:ring-1 focus:ring-primary placeholder-moonstone transition-all shadow-sm"
                                    placeholder="Search by name or SKU..."
                                    type="text"
                                    value={scanQuery}
                                    onChange={(e) => setScanQuery(e.target.value)}
                                    // Use Enter to scan
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleScanSubmit(e) }}
                                />
                            </div>
                            <div className="flex bg-surface-navy p-1 rounded-lg border border-surface-hover overflow-x-auto max-w-md">
                                <button onClick={() => setSelectedCategory("All")} className={`px-4 py-1.5 text-xs font-bold rounded-md whitespace-nowrap ${selectedCategory === "All" ? "bg-bg-navy text-white" : "text-moonstone"}`}>All</button>
                                {categories.map(cat => (
                                    <button key={cat.id} onClick={() => setSelectedCategory(cat.name)} className={`px-4 py-1.5 text-xs font-bold rounded-md whitespace-nowrap ${selectedCategory === cat.name ? "bg-bg-navy text-white" : "text-moonstone"}`}>{cat.name}</button>
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={fetchProducts} className="bg-surface-navy text-moonstone hover:text-white h-10 px-4 rounded-lg flex items-center gap-2 border border-surface-hover"><RefreshCw size={16} /> Sync</button>
                            <button onClick={() => setShowScanDialog(true)} className="bg-primary/20 text-primary h-10 px-4 rounded-lg flex items-center gap-2 border border-primary/30"><ScanBarcode size={16} /> Scan</button>
                            <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".csv" className="hidden" />
                            <button onClick={() => fileInputRef.current?.click()} className="bg-surface-navy text-moonstone hover:text-white h-10 px-4 rounded-lg flex items-center gap-2 border border-surface-hover"><Upload size={16} /> Import</button>
                        </div>
                    </div>

                    {/* Grid */}
                    {loading ? (
                        <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" size={40} /></div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredProducts.map((product) => (
                                <div key={product.id} className="bg-surface-navy rounded-xl border border-surface-hover p-4 group hover:border-primary/50 transition-colors shadow-sm">
                                    <div className="aspect-square bg-bg-navy rounded-lg mb-4 flex items-center justify-center relative overflow-hidden group-hover:shadow-inner border border-surface-hover/50">
                                        {product.image ? (
                                            <div className="w-full h-full bg-cover bg-center transition-transform group-hover:scale-105 duration-500" style={{ backgroundImage: `url(${product.image})` }} />
                                        ) : (
                                            <Package size={48} className="text-surface-hover/50" />
                                        )}
                                        <div className="absolute inset-0 bg-bg-navy/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[2px]">
                                            <button onClick={() => {
                                                setNewProduct({
                                                    name: product.name,
                                                    sku: product.sku,
                                                    category: product.categoryId || "",
                                                    base_price: String(product.price),
                                                    stock: String(product.stock),
                                                    hsn_code: product.hsn_code || "7117",
                                                    image_url: product.image || "",
                                                });
                                                setIsEditMode(true);
                                                setEditingProductId(product.id);
                                                setShowAddDialog(true);
                                            }} className="bg-primary text-primary-foreground p-2 rounded-lg hover:scale-110"><Edit size={18} /></button>
                                            <button onClick={() => handleDeleteProduct(product.id)} className="bg-red-500 text-white p-2 rounded-lg hover:scale-110"><Trash2 size={18} /></button>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-0.5">{product.sku}</p>
                                        <h3 className="text-white font-bold text-sm truncate">{product.name}</h3>
                                        <div className="flex justify-between items-center mt-2">
                                            <span className="text-white font-mono">{formatPrice(product.price)}</span>
                                            <span className={`text-xs px-2 py-1 rounded ${product.stock > 5 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>Stock: {product.stock}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Add Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white">
                    <DialogHeader><DialogTitle>{isEditMode ? 'Edit Product' : 'Add Product'}</DialogTitle></DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div><Label>Name</Label><Input value={newProduct.name} onChange={e => setNewProduct({ ...newProduct, name: e.target.value })} className="bg-bg-navy border-surface-hover" /></div>
                            <div><Label>SKU</Label><Input value={newProduct.sku} onChange={e => setNewProduct({ ...newProduct, sku: e.target.value })} className="bg-bg-navy border-surface-hover" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><Label>Category</Label>
                                <Select value={newProduct.category || ""} onValueChange={v => setNewProduct({ ...newProduct, category: v || "" })}>
                                    <SelectTrigger className="bg-bg-navy border-surface-hover"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div><Label>Price</Label><Input type="number" value={newProduct.base_price} onChange={e => setNewProduct({ ...newProduct, base_price: e.target.value })} className="bg-bg-navy border-surface-hover" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><Label>Stock</Label><Input type="number" value={newProduct.stock} onChange={e => setNewProduct({ ...newProduct, stock: e.target.value })} className="bg-bg-navy border-surface-hover" /></div>
                            <div><Label>Generate SKU</Label><Button variant="outline" onClick={() => generateSKU(newProduct.category, attributeValues)} className="w-full">Generate</Button></div>
                        </div>
                        <Button onClick={handleAddProduct} disabled={formLoading} className="mt-4">{formLoading ? 'Saving...' : 'Save Product'}</Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Scan Dialog */}
            <Dialog open={showScanDialog} onOpenChange={setShowScanDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white">
                    <DialogHeader><DialogTitle>Scan Stock</DialogTitle></DialogHeader>
                    <div className="flex flex-col gap-4">
                        {scanMode === 'camera' ? (
                            <BarcodeScanner onScan={(res) => { setScanQuery(res); handleScanSubmit({ preventDefault: () => { } } as any); setScanMode('text'); }} onError={console.error} />
                        ) : (
                            <Input
                                ref={scanInputRef}
                                value={scanQuery}
                                onChange={e => setScanQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleScanSubmit(e)}
                                placeholder="Scan barcode or enter SKU"
                                className="bg-bg-navy border-surface-hover text-lg h-12"
                                autoFocus
                            />
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setScanMode(m => m === 'text' ? 'camera' : 'text')}>{scanMode === 'text' ? 'Use Camera' : 'Use Keyboard'}</Button>
                        </div>

                        {scanResult && (
                            <div className="bg-bg-navy p-4 rounded-lg border border-primary/30">
                                <h3 className="font-bold text-lg text-primary">{scanResult.name}</h3>
                                <p className="text-moonstone">Current Stock: {scanResult.stock}</p>
                                <div className="flex gap-2 mt-4">
                                    <Button onClick={() => handleScanStockUpdate(1)} className="flex-1 bg-green-600 hover:bg-green-700">+ Add</Button>
                                    <Button onClick={() => handleScanStockUpdate(-1)} className="flex-1 bg-red-600 hover:bg-red-700">- Remove</Button>
                                </div>
                            </div>
                        )}
                        {scanNotFoundSku && (
                            <div className="text-red-400 text-center p-4 bg-red-500/10 rounded-lg">Product not found: {scanNotFoundSku}</div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white max-h-[80vh] overflow-y-auto">
                    <DialogHeader><DialogTitle>Import Data Preview</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <p>{importData.length} items found.</p>
                        <Button onClick={handleBulkImport} disabled={importLoading} className="w-full">{importLoading ? 'Importing...' : 'Confirm Import'}</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
