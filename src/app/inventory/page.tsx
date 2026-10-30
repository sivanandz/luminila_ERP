"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

// Dynamic import for camera scanner
const BarcodeScanner = dynamic(
    () => import("@/components/pos/BarcodeScanner").then((mod) => mod.BarcodeScanner),
    { ssr: false, loading: () => <div className="h-48 bg-surface-navy rounded-lg animate-pulse flex items-center justify-center text-moonstone">Loading camera...</div> }
);
import { Header } from "@/components/layout";
import { formatPrice } from "@/lib/utils";
import {
    Search,
    Plus,
    Upload,

    RefreshCw,

    Package,

    Edit,
    AlertTriangle,


    Trash2,

    Loader2,
    ScanBarcode,
    Share2,
    MapPin,
    Camera,
    Sparkles,
    CheckCircle2,


    ChevronDown,
    ChevronUp,
    Truck,
    FileSpreadsheet,
    Layers,
    MoreHorizontal,
    ClipboardPaste,
    Copy,
} from "lucide-react";
import { ProductBroadcastModal } from "@/components/whatsapp/ProductBroadcastModal";
import { ProductPhotoTaggingModal, type ShotType } from "@/components/inventory/ProductPhotoTaggingModal";
import { QuickAddProductDialog } from "@/components/inventory/QuickAddProductDialog";
import { PasteProductsDialog } from "@/components/inventory/PasteProductsDialog";
import { DiscrepancyModal } from "@/components/inventory/DiscrepancyModal";
import { ProductPurchaseHistoryModal } from "@/components/inventory/ProductPurchaseHistoryModal";
import { QuickReceivePOModal } from "@/components/inventory/QuickReceivePOModal";
import { BulkInventoryImportModal } from "@/components/inventory/BulkInventoryImportModal";
import { getDiscrepancyStats } from "@/lib/discrepancies";
import { getOpenPurchaseOrders, getOpenPurchaseOrderItems, reconcilePOWithInwardBatch } from "@/lib/purchase";
import { getVariantStockSummary, recordManualIntakeMovement } from "@/lib/products";
import { subscribeInventoryChanges } from "@/lib/inventory-feed";
import { ChannelPricingInput } from "@/components/pricing/ChannelPricingInput";
import {
    getChannelPrice,
    getChannelPriceFromList,
    getConfiguredChannels,
    loadConfiguredChannels,
    subscribeConfiguredChannels,
    type SalesChannelDef,
} from "@/lib/channel-pricing";
import { MobileScanner } from "@/lib/mobile-scanner";
import {
    getSKUTaxonomies,
    loadSKUTaxonomies,
    subscribeSKUTaxonomies,
    type SKUTaxonomies,
    generateParentSKU,
    generateChildSKU,
    generateWholesaleSKU,
    deriveHSNCode,
    getSubcategoriesForCategory,
    computeNextSkuSequence,
} from "@/lib/sku-generator";
import { loadQuickAddMemory } from "@/lib/quick-add-memory";
import { useInventoryShortcuts } from "@/hooks/use-inventory-shortcuts";
import {
    BASE_METAL_DEFINITIONS,
    CRAFT_DEFINITIONS,
    OCCASION_DEFINITIONS,
    PLATING_DEFINITIONS,
} from "@/lib/imitation-jewelry-engine";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
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
import { parseSKUFromBarcode } from "@/lib/barcode-generator";
import { StockTransferModal } from "@/components/inventory/StockTransferModal";
import { getInventoryLocations, type InventoryLocation } from "@/lib/multi-location";
import { ArrowRightLeft } from "lucide-react";
import {
    getProducts,
    createProduct,
    updateProduct,

    createVariant,
    getProductVariants,
    updateVariant,
    deleteVariant,
    STORAGE_LOCATIONS,
    getProductDisplayImage,
    type Product as PbProduct,
    type ProductVariant,
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
    cost_price?: number;
    channel_prices?: Record<string, number>;
    stock: number;
    pending_po_quantity?: number;
    image: string | null;
    hsn_code?: string;
    location?: string;
    craft?: string;
    plating?: string;
    occasion?: string;
    base_metal?: string;
    is_active?: boolean;
}

// PocketBase product row as returned by getProducts(), which queries with
// expand: 'category', so the expanded category record carries the display name.
interface ProductRecordWithCategory extends PbProduct {
    expand?: {
        category?: {
            name?: string;
        };
    };
}

function InventoryContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [activeInwardPo, setActiveInwardPo] = useState<string>("");

    useEffect(() => {
        const inwardPo = searchParams.get("inwardPo");
        const search = searchParams.get("search");
        if (inwardPo) {
            setActiveInwardPo(inwardPo);
        }
        if (search) {
            setScanQuery(search);
        }
    }, [searchParams]);

    const [selectedCategory, setSelectedCategory] = useState("All");
    const [selectedLocation, setSelectedLocation] = useState("All");
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [, setError] = useState<string | null>(null);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [showQuickAdd, setShowQuickAdd] = useState(false);
    const [cloneSeed, setCloneSeed] = useState<Product | null>(null);
    const [showPasteList, setShowPasteList] = useState(false);
    const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");
    const [salesChannels, setSalesChannels] = useState<SalesChannelDef[]>(() => getConfiguredChannels());
    const [formLoading, setFormLoading] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [, setAttributes] = useState<ProductAttribute[]>([]);

    const [showImportDialog, setShowImportDialog] = useState(false);
    const [showBulkImportModal, setShowBulkImportModal] = useState(false);
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
    const [, setScanStockInput] = useState("1");
    const scanInputRef = useRef<HTMLInputElement>(null);
    const [scanMode, setScanMode] = useState<'text' | 'camera'>('text');
    const [scanNotFoundSku, setScanNotFoundSku] = useState<string | null>(null);

    // Multi-Product WhatsApp Broadcast state
    const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
    const [showBroadcastModal, setShowBroadcastModal] = useState(false);
    const [broadcastProductsList, setBroadcastProductsList] = useState<Product[]>([]);

    const toggleSelectProduct = (id: string) => {
        setSelectedProductIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    // Form state
    const [newProduct, setNewProduct] = useState({
        name: "",
        sku: "",
        category: "Uncategorized",
        base_price: "",
        cost_price: "",
        po_reference: "",
        channel_prices: {} as Record<string, number>,
        stock: "",
        hsn_code: "71179010",
        image_url: "",
        location: "Showcase Tray A",
        craft: "",
        plating: "",
        occasion: "",
        base_metal: "",
    });

    // Auto-populate po_reference when opening add dialog during active inward mode
    useEffect(() => {
        if (showAddDialog && activeInwardPo && !isEditMode) {
            setNewProduct(prev => ({ ...prev, po_reference: prev.po_reference || activeInwardPo }));
        }
    }, [showAddDialog, activeInwardPo, isEditMode]);

    // Product Photo Tagging Modal State
    const [showPhotoModal, setShowPhotoModal] = useState(false);
    const [productShotType, setProductShotType] = useState<ShotType>("HERO");

    // Stock Discrepancy & Quarantine Modal State
    const [showDiscrepancyModal, setShowDiscrepancyModal] = useState(false);
    const [selectedDiscrepancyProduct, setSelectedDiscrepancyProduct] = useState<{
        id: string;
        name: string;
        sku: string;
        stock: number;
        variant_id?: string;
    } | null>(null);
    const [activeDiscrepanciesCount, setActiveDiscrepanciesCount] = useState<number>(0);

    const loadDiscrepancyCount = async () => {
        try {
            const stats = await getDiscrepancyStats();
            setActiveDiscrepanciesCount(stats.totalUnitsQuarantined);
        } catch {
            // ignore
        }
    };

    // Purchase Order & Delivery History Modal State
    const [selectedPOProduct, setSelectedPOProduct] = useState<Product | null>(null);
    const [showPOHistoryModal, setShowPOHistoryModal] = useState(false);
    const [showQuickReceiveModal, setShowQuickReceiveModal] = useState(false);
    const [openPOCount, setOpenPOCount] = useState<number>(0);

    const loadOpenPOCount = async () => {
        try {
            const list = await getOpenPurchaseOrders();
            setOpenPOCount(list.length);
        } catch {
            // ignore
        }
    };

    // Multi-Location & Stock Transfer Modal State
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [locationsList, setLocationsList] = useState<InventoryLocation[]>([]);

    useEffect(() => {
        getInventoryLocations().then(setLocationsList).catch(() => {});
    }, []);

    // Master Jewelry SKU Generator State
    const [showSkuArchitect, setShowSkuArchitect] = useState(false);
    const [skuGenre, setSkuGenre] = useState("TMP");
    const [skuCategory, setSkuCategory] = useState("NEC");
    const [skuSubcat, setSkuSubcat] = useState("CHK");
    const [skuPlating, setSkuPlating] = useState("MG");
    const [skuColor, setSkuColor] = useState("RB");
    const [skuSize, setSkuSize] = useState("STD");
    const [skuPackagingTier, setSkuPackagingTier] = useState("EA");
    const [skuBaseMetal, setSkuBaseMetal] = useState("BR");
    const [skuStone, setSkuStone] = useState("KP");
    const [nextSkuSeq, setNextSkuSeq] = useState(1);
    const [skuTaxonomies, setSkuTaxonomies] = useState<SKUTaxonomies>(getSKUTaxonomies());

    useEffect(() => {
        loadSKUTaxonomies().then(setSkuTaxonomies);
        loadQuickAddMemory().catch(() => {});
        const unsubscribe = subscribeSKUTaxonomies(setSkuTaxonomies);
        return () => unsubscribe();
    }, []);

    // Alt+N opens Quick add when no other modal is in the way.
    useInventoryShortcuts(
        {
            onQuickAdd: () => {
                setCloneSeed(null);
                setShowQuickAdd(true);
            },
        },
        !showQuickAdd &&
            !showAddDialog &&
            !showPasteList &&
            !showScanDialog &&
            !showDiscrepancyModal &&
            !showBroadcastModal &&
            !showBulkImportModal &&
            !showImportDialog &&
            !showPOHistoryModal
    );

    // Handle Scan Logic. `overrideQuery` lets the camera path pass the scanned code
    // directly, because a setScanQuery() in the same event is not visible to this
    // render's closure yet.
    const handleScanSubmit = (e: Pick<React.FormEvent, "preventDefault">, overrideQuery?: string) => {
        e.preventDefault();
        const rawQuery = (overrideQuery ?? scanQuery).trim();
        if (!rawQuery) return;

        const normalizedQuery = rawQuery.toUpperCase();
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
            setScanNotFoundSku(normalizedQuery);
        }
    };

    // Context-aware hardware barcode scanner routing for Inventory
    useEffect(() => {
        if (showAddDialog) {
            // Priority 70: When product creation/edit modal is open, scan fills the SKU code
            const unregister = MobileScanner.registerContext("inventory_form", (result) => {
                setNewProduct(prev => ({ ...prev, sku: result.barcode }));
                toast.success(`Scanned Barcode to SKU: ${result.barcode}`);
                return true;
            }, 70);
            return () => unregister();
        } else if (!showScanDialog && !showDiscrepancyModal && !showBroadcastModal) {
            // Priority 50: When on main inventory table, scan performs instant product lookup
            const unregister = MobileScanner.registerContext("inventory_search", (result) => {
                setShowScanDialog(true);
                setScanQuery(result.barcode);
                handleScanSubmit({ preventDefault: () => {} }, result.barcode);
                return true;
            }, 50);
            return () => unregister();
        }
    }, [showAddDialog, showScanDialog, showDiscrepancyModal, showBroadcastModal, products]);

    // Update stock from scanner
    const handleScanStockUpdate = async (change: number) => {
        if (!scanResult) return;

        try {
            // Find variant to update
            const variants = await getProductVariants(scanResult.id);
            // Try to match variant by SKU or take first
            let variant = variants.find(v => v.variant_name === scanResult.sku || v.sku_suffix === scanResult.sku.split('-').pop());
            if (!variant && variants.length > 0) variant = variants[0];

            if (variant) {
                // scanResult.stock is the product-wide aggregate across all variants,
                // so the write must target the variant's own stock_level, not the aggregate.
                const newVariantStock = (variant.stock_level || 0) + change;
                if (newVariantStock < 0) {
                    toast.error("Stock cannot be negative");
                    return;
                }

                await updateVariant(variant.id, { stock_level: newVariantStock });

                // Update local list: product `stock` is the aggregate, so it shifts by `change`
                setProducts(prev => prev.map(p =>
                    p.id === scanResult.id ? { ...p, stock: p.stock + change } : p
                ));
                setScanResult(prev => prev ? { ...prev, stock: prev.stock + change } : null);

                toast.success(`Stock updated to ${scanResult.stock + change}`);
            } else {
                toast.error("Could not find variant record to update.");
            }
        } catch (err) {
            console.error("Stock update failed", err);
            toast.error("Failed to update stock");
        }
    };



    // Auto-generate Architectural SKU according to Spec
    const handleApplyGeneratedSKU = async () => {
        // Dictionary codes only (A-Z0-9): used both as the pb.filter bound value
        // and as the literal regex anchor below.
        const prefix = `${skuGenre}${skuCategory}${skuSubcat}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const nextSeq = await computeNextSkuSequence(prefix, products.length + 1);
        const parent = generateParentSKU(skuGenre, skuCategory, skuSubcat, nextSeq);
        const child = generateChildSKU(parent, skuPlating, skuColor, skuSize);
        const finalSKU = generateWholesaleSKU(child, skuPackagingTier);
        const derivedHsn = deriveHSNCode(skuCategory, skuBaseMetal, skuStone);

        const isGen = skuCategory === "GEN";
        const genreLabel = isGen ? "" : (skuTaxonomies.genres.find(g => g.code === skuGenre)?.label.split(" ")[0] || "");
        const catLabel = isGen ? "" : (skuTaxonomies.categories.find(c => c.code === skuCategory)?.label || "");
        const subLabel = (isGen || skuSubcat === "GEN") ? "" : (skuTaxonomies.subcategories.find(s => s.code === skuSubcat)?.label || "");
        const autoName = [genreLabel, catLabel, subLabel].filter(Boolean).join(" ").trim();

        setNewProduct(prev => ({
            ...prev,
            sku: finalSKU,
            hsn_code: derivedHsn,
            name: prev.name ? prev.name : autoName,
            category: isGen ? "Uncategorized" : (catLabel || prev.category),
        }));
        toast.success(`Generated Architectural SKU: ${finalSKU} (HSN: ${derivedHsn})`);
    };

    // Keep the Architect preview's sequence in sync with the DB (see computeNextSkuSequence)
    useEffect(() => {
        if (!showSkuArchitect) return;
        let cancelled = false;
        const prefix = `${skuGenre}${skuCategory}${skuSubcat}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
        computeNextSkuSequence(prefix, products.length + 1).then(seq => {
            if (!cancelled) setNextSkuSeq(seq);
        });
        return () => { cancelled = true; };
    }, [showSkuArchitect, skuGenre, skuCategory, skuSubcat, products]);

    // Fetch products
    const fetchProducts = async () => {
        try {
            setLoading(true);
            setError(null);

            const fetchedProducts: ProductRecordWithCategory[] = await getProducts({ activeOnly: false });

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

            const {
                stockByProduct: variantMap,
                materialByProduct: variantMaterialMap,
                productByVariant: variantToProduct,
            } = await getVariantStockSummary();

            // Calculate pending stock from active Purchase Orders
            const productPendingMap = new Map<string, number>();
            try {
                const openPoItems = await getOpenPurchaseOrderItems();

                openPoItems.forEach((poi) => {
                    const variantId = poi.variant || '';
                    const prodId = variantToProduct.get(variantId);
                    if (prodId) {
                        const ordered = poi.quantity_ordered ?? poi.quantity ?? 0;
                        const rec = poi.quantity_received || 0;
                        const pending = Math.max(0, ordered - rec);
                        productPendingMap.set(prodId, (productPendingMap.get(prodId) || 0) + pending);
                    }
                });
            } catch (poErr) {
                console.warn('Could not load pending PO quantities:', poErr);
            }

            const mappedProducts: Product[] = fetchedProducts.map((p) => {
                const catName = p.expand?.category?.name || "Uncategorized";
                return {
                    id: p.id,
                    sku: p.sku,
                    name: p.name,
                    category: p.category ? catName : "Uncategorized",
                    categoryId: p.category,
                    price: getChannelPrice(
                        {
                            base_price: p.base_price,
                            cost_price: p.cost_price,
                            channel_prices: p.channel_prices,
                        },
                        "pos"
                    ),
                    cost_price: p.cost_price || 0,
                    channel_prices: p.channel_prices || {},
                    stock: variantMap.get(p.id) || 0,
                    pending_po_quantity: productPendingMap.get(p.id) || 0,
                    material: variantMaterialMap.get(p.id),
                    image: getProductDisplayImage(p),
                    hsn_code: p.hsn_code,
                    location: p.location || "Showcase Tray A",
                    craft: p.craft || "",
                    plating: p.plating || "",
                    occasion: p.occasion || "",
                    base_metal: p.base_metal || "",
                    is_active: p.is_active !== false,
                };
            });

            setProducts(mappedProducts);
        } catch (err) {
            console.error("Fetch error:", err);
            setError((err instanceof Error ? err.message : String(err)) || "Failed to load products");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
        loadDiscrepancyCount();
        loadOpenPOCount();
        getCategories().then(setCategories);
        getAttributes().then(setAttributes);
        loadConfiguredChannels()
            .then((channels) => {
                setSalesChannels(channels);
                // Prices materialised at load time may predate the tenant's
                // rules; refetch once the rules are available.
                fetchProducts();
            })
            .catch(console.error);
        const unsubscribeChannels = subscribeConfiguredChannels(setSalesChannels);

        // Realtime subscription with graceful error catch (handles transient SSE 404 client id)
        const unsubscribe = subscribeInventoryChanges({
            onChange: fetchProducts,
            onProcurementChange: loadOpenPOCount,
            onDiscrepancyChange: loadDiscrepancyCount,
        });

        return () => {
            unsubscribe();
            unsubscribeChannels();
        };
    }, []);

    // Handle add/edit
    const handleAddProduct = async () => {
        setFormLoading(true);
        try {
            if (!newProduct.name.trim()) {
                toast.error("Product name is required.");
                return;
            }
            if (!parseFloat(newProduct.cost_price) && !parseFloat(newProduct.base_price)) {
                toast.error("Enter a cost price so channel prices can be calculated.");
                return;
            }

            // Find category ID from name if needed
            let categoryId = "";
            if (newProduct.category && newProduct.category !== "Uncategorized") {
                const catObj = categories.find(c => c.name === newProduct.category || c.id === newProduct.category);
                if (catObj) {
                    categoryId = catObj.id;
                } else {
                    try {
                        const newCat = await createCategory({ name: newProduct.category, is_active: true });
                        categoryId = newCat.id;
                        setCategories(prev => [...prev, newCat]);
                    } catch (e) { console.error("Cat create failed", e); }
                }
            }

            const costPrice = parseFloat(newProduct.cost_price) || 0;
            const manualBasePrice = parseFloat(newProduct.base_price) || 0;
            // Cost is the pricing root. When the Shop channel has a cost rule,
            // materialise its output into base_price so legacy consumers and
            // lists keep showing the real counter price.
            const resolvedBasePrice = getChannelPrice(
                {
                    base_price: manualBasePrice,
                    cost_price: costPrice,
                    channel_prices: newProduct.channel_prices || {},
                },
                "pos"
            );
            const poRef = newProduct.po_reference.trim();

            const productPayload: Omit<PbProduct, "id" | "created" | "updated"> = {
                name: newProduct.name,
                sku: newProduct.sku,
                category: categoryId,
                base_price: resolvedBasePrice > 0 ? resolvedBasePrice : manualBasePrice,
                cost_price: costPrice,
                channel_prices: newProduct.channel_prices || {},
                hsn_code: newProduct.hsn_code,
                image_url: newProduct.image_url && newProduct.image_url.startsWith('http') ? newProduct.image_url : '',
                image_data: newProduct.image_url || '',
                location: newProduct.location || "Showcase Tray A",
                craft: newProduct.craft || '',
                plating: newProduct.plating || '',
                occasion: newProduct.occasion || '',
                base_metal: newProduct.base_metal || '',
                is_active: isEditMode
                    ? products.find((product) => product.id === editingProductId)?.is_active !== false
                    : false,
            };

            let targetVariantId = "";

            if (isEditMode && editingProductId) {
                // Update
                await updateProduct(editingProductId, productPayload);

                // Update stock (find first variant).
                // `newProduct.stock` holds the product-wide aggregate (the dialog prefills it
                // that way), so apply only the user's delta to the first variant instead of
                // overwriting it with the aggregate.
                const variants = await getProductVariants(editingProductId);
                const desiredTotal = parseInt(newProduct.stock) || 0;
                const currentTotal = products.find(p => p.id === editingProductId)?.stock ?? desiredTotal;
                const stockDelta = desiredTotal - currentTotal;
                if (variants.length > 0) {
                    targetVariantId = variants[0].id;
                    await updateVariant(variants[0].id, {
                        stock_level: Math.max(0, (variants[0].stock_level || 0) + stockDelta),
                        variant_name: newProduct.sku
                    });
                } else {
                    // Create if missing
                    const v = await createVariant({
                        product: editingProductId,
                        variant_name: newProduct.sku,
                        stock_level: parseInt(newProduct.stock) || 0
                    });
                    targetVariantId = v.id;
                }
                toast.success("Product updated");
            } else {
                // Create
                const product = await createProduct(productPayload);

                // Create default variant
                const v = await createVariant({
                    product: product.id,
                    variant_name: newProduct.sku,
                    stock_level: parseInt(newProduct.stock) || 0
                });
                targetVariantId = v.id;
                toast.success("Product created");
            }

            // If tagged to a Purchase Order, log stock movement and reconcile
            if (poRef && targetVariantId) {
                const addedStock = parseInt(newProduct.stock) || 0;
                await recordManualIntakeMovement({
                    variantId: targetVariantId,
                    quantity: addedStock,
                    referenceId: poRef,
                    notes: `Inward intake tagged to PO: ${poRef}. Unit cost: ₹${costPrice}`,
                }).catch(err => console.warn('Could not log stock movement:', err));

                try {
                    const batchCost = costPrice * addedStock;
                    const rec = await reconcilePOWithInwardBatch(poRef, batchCost);
                    if (rec.discrepancyStatus === 'over_budget') {
                        toast.error(
                            `PO ${poRef} Over Budget! Inward: ₹${rec.po.inward_goods_cost?.toLocaleString('en-IN')} vs Budget: ₹${rec.po.budget_amount?.toLocaleString('en-IN')} (Variance: ₹${rec.discrepancyAmount.toLocaleString('en-IN')}). Discrepancy flagged for manager approval.`,
                            { duration: 8000 }
                        );
                    } else if (rec.discrepancyStatus === 'under_budget') {
                        toast.warning(
                            `PO ${poRef} Under Budget: Inward ₹${rec.po.inward_goods_cost?.toLocaleString('en-IN')} of ₹${rec.po.budget_amount?.toLocaleString('en-IN')}. Remaining: ₹${rec.discrepancyAmount.toLocaleString('en-IN')}.`,
                            { duration: 6000 }
                        );
                    } else {
                        toast.success(`PO ${poRef} reconciled successfully with inward intake!`);
                    }
                } catch (recErr: any) {
                    console.warn('PO reconciliation notice:', recErr.message);
                }
            }

            setShowAddDialog(false);
            setNewProduct({ name: '', sku: '', category: 'Uncategorized', base_price: '', cost_price: '', po_reference: activeInwardPo || '', channel_prices: {}, stock: '', hsn_code: '71179010', image_url: '', location: 'Showcase Tray A', craft: '', plating: '', occasion: '', base_metal: '' });
            fetchProducts();
        } catch (err) {
            console.error('Error saving product:', err);
            toast.error('Failed to save: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setFormLoading(false);
            setIsEditMode(false);
            setEditingProductId(null);
        }
    };

    const DEMO_SKUS = ["TMP-NCK-LAKSHMI", "KND-JHU-MALAR", "BGL-NILA-HERITAGE"];
    const demoPromptHandled = useRef(false);

    const publishReadiness = (product: Product): string[] => {
        const missing: string[] = [];
        if (!product.image) missing.push("a photo");
        if (!product.category || product.category === "Uncategorized") missing.push("a category");
        if (!product.cost_price || product.cost_price <= 0) missing.push("a cost price");
        if (!product.price || product.price <= 0) missing.push("a selling price");
        return missing;
    };

    const handlePublishProduct = async (product: Product) => {
        const missing = publishReadiness(product);
        if (missing.length > 0) {
            toast.error(`Add ${missing.join(", ")} before publishing.`);
            return;
        }
        try {
            await updateProduct(product.id, { is_active: true });
            toast.success(`${product.name} is live on the storefront.`);
            fetchProducts();
        } catch (err) {
            console.error("Publish failed:", err);
            toast.error(err instanceof Error ? err.message : "Could not publish the product");
        }
    };

    const handleQuickAddCreated = async (created: {
        productId: string;
        name: string;
        sku: string;
        categoryName: string;
    }) => {
        const hadRealProducts = products.some((product) => !DEMO_SKUS.includes(product.sku));
        await fetchProducts();
        getCategories().then(setCategories).catch(() => {});

        if (hadRealProducts || demoPromptHandled.current) return;
        const demos = products.filter((product) => DEMO_SKUS.includes(product.sku));
        if (demos.length === 0) return;

        demoPromptHandled.current = true;
        const shouldRemove = window.confirm(
            `Your first real piece (${created.name}) is in. Remove the ${demos.length} demo products and their stock variants from inventory?`
        );
        if (!shouldRemove) return;

        for (const demo of demos) {
            const variants = await getProductVariants(demo.id).catch(() => []);
            for (const variant of variants) {
                await deleteVariant(variant.id).catch(() => {});
            }
            await pb.collection("products").delete(demo.id).catch(() => {});
        }
        toast.success("Demo products removed.");
        await fetchProducts();
    };

    const handleDeleteProduct = async (id: string) => {
        if (!confirm("Delete this product permanently? This cannot be undone.")) return;
        try {
            // A product with sales history must stay readable for invoices and
            // order details, so it is refused rather than orphaned.
            const history = await pb
                .collection("sales_order_items")
                .getList(1, 1, { filter: `product="${id}"` })
                .catch(() => null);
            if (history && history.totalItems > 0) {
                toast.error("This product has sales history and cannot be deleted. Unpublish it instead.");
                return;
            }

            const variants = await getProductVariants(id).catch(() => []);
            for (const variant of variants) {
                await deleteVariant(variant.id).catch(() => {});
            }
            await pb.collection("products").delete(id);
            toast.success("Product deleted");
            fetchProducts();
        } catch (err: unknown) {
            console.error("Failed to delete product:", err);
            const msg = (err as { data?: { message?: string }; message?: string })?.data?.message || (err as Error)?.message || "Failed to delete product";
            toast.error("Failed to delete product: " + msg);
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
            } catch {
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
        const matchesCategory = selectedCategory === "All" || product.category === selectedCategory || product.categoryId === selectedCategory;
        const matchesLocation = selectedLocation === "All" || (product.location || "Showcase Tray A") === selectedLocation;
        const matchesStatus =
            statusFilter === "all" ||
            (statusFilter === "draft"
                ? product.is_active === false
                : product.is_active !== false);
        const q = scanQuery.trim().toLowerCase();
        const matchesSearch = !q || product.name.toLowerCase().includes(q) || product.sku.toLowerCase().includes(q);
        return matchesCategory && matchesLocation && matchesStatus && matchesSearch;
    });

    const publishedCount = products.filter((product) => product.is_active !== false).length;
    const draftCount = products.length - publishedCount;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Inventory"
                subtitle={`${publishedCount} published • ${draftCount} drafts • ${products.reduce((acc, p) => acc + p.stock, 0)} units`}
                action={
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => {
                                setCloneSeed(null);
                                setShowQuickAdd(true);
                            }}
                        >
                            <Plus size={18} className="mr-2" />
                            Quick add
                        </Button>
                        <span className="hidden md:inline-flex items-center rounded border border-surface-hover/60 bg-bg-navy/70 px-1.5 py-0.5 text-[9px] font-mono text-moonstone">
                            Alt+N
                        </span>
                    </div>
                }
                hideSearch
            />

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto flex flex-col gap-4 md:gap-8">
                    {/* Active Inward PO Intake Banner */}
                    {activeInwardPo && (
                        <div className="bg-gradient-to-r from-teal-950/90 via-surface-navy to-teal-950/90 border border-teal-500/40 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xl animate-in fade-in">
                            <div className="flex items-center gap-3">
                                <div className="size-10 rounded-lg bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0 border border-teal-500/30">
                                    <Truck size={20} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-white uppercase tracking-wider">Active Inward Intake Mode</span>
                                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/40 font-bold">
                                            {activeInwardPo}
                                        </span>
                                    </div>
                                    <p className="text-xs text-moonstone mt-0.5">
                                        Inward products will be linked to this Purchase Order with automatic landed cost absorption and discrepancy reconciliation.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 self-end md:self-auto">
                                <Button
                                    size="sm"
                                    onClick={() => setShowBulkImportModal(true)}
                                    className="bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs h-8 px-3 flex items-center gap-1.5 shadow-md"
                                >
                                    <Upload size={14} /> Bulk Upload Sheet
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        setNewProduct(prev => ({ ...prev, po_reference: activeInwardPo }));
                                        setIsEditMode(false);
                                        setEditingProductId(null);
                                        setShowAddDialog(true);
                                    }}
                                    className="bg-primary text-primary-foreground font-semibold text-xs h-8 px-3 flex items-center gap-1.5"
                                >
                                    <Plus size={14} /> Add Product for PO
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setActiveInwardPo("");
                                        router.replace("/inventory");
                                    }}
                                    className="text-xs text-slate-400 hover:text-white h-8 px-2"
                                >
                                    Exit Inward Mode
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Toolbar */}
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative min-w-[220px] flex-1 max-w-[440px]">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone pointer-events-none" />
                                <input
                                    className="h-10 w-full rounded-lg border border-surface-hover/70 bg-surface-navy/70 pl-9 pr-10 text-sm text-white placeholder-moonstone outline-none transition-colors focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                                    placeholder="Search name or SKU, or scan…"
                                    type="text"
                                    value={scanQuery}
                                    onChange={(e) => setScanQuery(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleScanSubmit(e) }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowScanDialog(true)}
                                    title="Scan a barcode"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-moonstone transition-colors hover:bg-surface-hover/50 hover:text-white"
                                >
                                    <ScanBarcode size={16} />
                                </button>
                            </div>

                            <DropdownMenu>
                                <DropdownMenuTrigger className="flex h-10 items-center gap-2 rounded-lg border border-surface-hover/70 bg-surface-navy/70 px-3 text-xs font-medium text-moonstone transition-colors hover:bg-surface-hover/40 hover:text-white">
                                    <Layers size={15} />
                                    <span className="max-w-[140px] truncate">
                                        {selectedCategory === "All" ? "All categories" : selectedCategory}
                                    </span>
                                    <ChevronDown size={14} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-56">
                                    <DropdownMenuItem onClick={() => setSelectedCategory("All")}>
                                        <span className="flex-1">All categories</span>
                                        <span className="text-[10px] text-moonstone">{products.length}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {categories.map((cat) => (
                                        <DropdownMenuItem key={cat.id} onClick={() => setSelectedCategory(cat.name)}>
                                            <span className="flex-1 truncate">{cat.name}</span>
                                            <span className="text-[10px] text-moonstone">
                                                {products.filter((product) => product.category === cat.name).length}
                                            </span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <DropdownMenu>
                                <DropdownMenuTrigger className="flex h-10 items-center gap-2 rounded-lg border border-surface-hover/70 bg-surface-navy/70 px-3 text-xs font-medium text-moonstone transition-colors hover:bg-surface-hover/40 hover:text-white">
                                    <MapPin size={15} />
                                    <span className="max-w-[140px] truncate">
                                        {selectedLocation === "All" ? "All locations" : selectedLocation}
                                    </span>
                                    <ChevronDown size={14} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-60">
                                    <DropdownMenuItem onClick={() => setSelectedLocation("All")}>
                                        All locations
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {locationsList.length > 0
                                        ? locationsList.map((location) => (
                                              <DropdownMenuItem key={location.id} onClick={() => setSelectedLocation(location.name)}>
                                                  [{location.code}] {location.name}
                                              </DropdownMenuItem>
                                          ))
                                        : STORAGE_LOCATIONS.map((location) => (
                                              <DropdownMenuItem key={location} onClick={() => setSelectedLocation(location)}>
                                                  {location}
                                              </DropdownMenuItem>
                                          ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <DropdownMenu>
                                <DropdownMenuTrigger className="flex h-10 items-center gap-2 rounded-lg border border-surface-hover/70 bg-surface-navy/70 px-3 text-xs font-medium text-moonstone transition-colors hover:bg-surface-hover/40 hover:text-white">
                                    <CheckCircle2 size={15} />
                                    <span>
                                        {statusFilter === "all"
                                            ? "All statuses"
                                            : statusFilter === "published"
                                              ? "Published"
                                              : "Drafts"}
                                    </span>
                                    <ChevronDown size={14} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-44">
                                    <DropdownMenuItem onClick={() => setStatusFilter("all")}>
                                        <span className="flex-1">All</span>
                                        <span className="text-[10px] text-moonstone">{products.length}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setStatusFilter("published")}>
                                        <span className="flex-1">Published</span>
                                        <span className="text-[10px] text-moonstone">{publishedCount}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setStatusFilter("draft")}>
                                        <span className="flex-1">Drafts</span>
                                        <span className="text-[10px] text-moonstone">{draftCount}</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    aria-label="More inventory actions"
                                    className="relative flex size-10 items-center justify-center rounded-lg border border-surface-hover/70 bg-surface-navy/70 text-moonstone transition-colors hover:bg-surface-hover/40 hover:text-white"
                                >
                                    <MoreHorizontal size={18} />
                                    {(openPOCount > 0 || activeDiscrepanciesCount > 0) && (
                                        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-400" />
                                    )}
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60">
                                    <DropdownMenuLabel>Operations</DropdownMenuLabel>
                                    <DropdownMenuItem onClick={() => setShowQuickReceiveModal(true)}>
                                        <Truck size={14} />
                                        <span className="flex-1">Receive from PO</span>
                                        {openPOCount > 0 && (
                                            <span className="text-[10px] text-moonstone">{openPOCount}</span>
                                        )}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setShowTransferModal(true)}>
                                        <ArrowRightLeft size={14} />
                                        Transfer stock
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setSelectedDiscrepancyProduct(null);
                                            setShowDiscrepancyModal(true);
                                        }}
                                    >
                                        <AlertTriangle size={14} />
                                        <span className="flex-1">Quarantine / replacements</span>
                                        {activeDiscrepanciesCount > 0 && (
                                            <span className="text-[10px] text-amber-300">{activeDiscrepanciesCount}</span>
                                        )}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel>Inventory</DropdownMenuLabel>
                                    <DropdownMenuItem onClick={() => setShowBulkImportModal(true)}>
                                        <Upload size={14} />
                                        Import from Excel
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setShowPasteList(true)}>
                                        <ClipboardPaste size={14} />
                                        Paste a product list
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => window.location.assign("/api/inventory/template")}>
                                        <FileSpreadsheet size={14} />
                                        Download Excel template
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setIsEditMode(false);
                                            setEditingProductId(null);
                                            setShowAddDialog(true);
                                        }}
                                    >
                                        <Edit size={14} />
                                        Advanced product form
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={fetchProducts}>
                                        <RefreshCw size={14} />
                                        Sync now
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    {/* Grid */}
                    {loading ? (
                        <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" size={40} /></div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
                            {filteredProducts.length === 0 ? (
                                <div className="col-span-full rounded-xl border border-dashed border-surface-hover/80 bg-surface-navy/40 px-6 py-12 text-center">
                                    <Package size={38} className="mx-auto text-moonstone/60" />
                                    <h3 className="mt-3 text-sm font-bold text-white">
                                        {products.length === 0 ? "Add your first piece" : "Nothing matches this view"}
                                    </h3>
                                    <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-moonstone">
                                        {products.length === 0
                                            ? "A photo, a name and a cost price are enough. It saves as a draft, so nothing reaches the storefront until you publish."
                                            : "Clear the status or category filter, or add a new piece."}
                                    </p>
                                    <div className="mt-4 flex items-center justify-center gap-2">
                                        <Button onClick={() => setShowQuickAdd(true)} className="h-9 text-xs font-bold">
                                            <Plus size={14} />
                                            Quick add
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => setShowPasteList(true)}
                                            className="h-9 text-xs border-surface-hover/80 bg-transparent text-white hover:bg-surface-hover/40"
                                        >
                                            <ClipboardPaste size={14} />
                                            Paste a list
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                filteredProducts.map((product) => {
                                const isSelected = selectedProductIds.includes(product.id);
                                const pricingShape = {
                                    base_price: product.price,
                                    cost_price: product.cost_price,
                                    channel_prices: product.channel_prices,
                                };
                                const whatsappPrice = getChannelPriceFromList(pricingShape, "whatsapp", salesChannels);
                                const websitePrice = getChannelPriceFromList(pricingShape, "website", salesChannels);
                                const wholesalePrice = getChannelPriceFromList(pricingShape, "wholesale", salesChannels);
                                return (
                                    <div
                                        key={product.id}
                                        className={`min-w-0 bg-surface-navy rounded-xl border p-3 md:p-4 group transition-all shadow-sm relative ${
                                            isSelected ? 'border-emerald-500 ring-1 ring-emerald-500/40' : 'border-surface-hover hover:border-primary/50'
                                        }`}
                                    >
                                        {/* Multi-Select Checkbox */}
                                        <div className="absolute top-2 left-2 z-20">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelectProduct(product.id)}
                                                className="size-4 rounded border-surface-hover accent-emerald-500 cursor-pointer shadow bg-bg-navy/80"
                                                title="Select for WhatsApp broadcast or bulk actions"
                                            />
                                        </div>

                                        <div className="aspect-square bg-bg-navy rounded-lg mb-4 flex items-center justify-center relative overflow-hidden group-hover:shadow-inner border border-surface-hover/50">
                                            {product.image ? (
                                                <div className="w-full h-full bg-cover bg-center transition-transform group-hover:scale-105 duration-500" style={{ backgroundImage: `url(${product.image})` }} />
                                            ) : (
                                                <Package size={48} className="text-surface-hover/50" />
                                            )}
                                            <div className="absolute inset-0 bg-bg-navy/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-wrap items-center justify-center content-center gap-1.5 p-1.5 backdrop-blur-[2px]">
                                                <button
                                                    onClick={() => {
                                                        setBroadcastProductsList([product]);
                                                        setShowBroadcastModal(true);
                                                    }}
                                                    title="Broadcast this product to WhatsApp Status, Channels & Groups"
                                                    className="bg-emerald-600 text-white p-2 rounded-lg hover:scale-110 transition-transform"
                                                >
                                                    <Share2 size={18} />
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setSelectedDiscrepancyProduct({
                                                            id: product.id,
                                                            name: product.name,
                                                            sku: product.sku,
                                                            stock: product.stock,
                                                        });
                                                        setShowDiscrepancyModal(true);
                                                    }}
                                                    title="Flag Damaged, Missing, or Send to Vendor for Replacement"
                                                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 p-2 rounded-lg hover:scale-110 transition-transform font-bold"
                                                >
                                                    <AlertTriangle size={18} />
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setSelectedPOProduct(product);
                                                        setShowPOHistoryModal(true);
                                                    }}
                                                    title="View Purchase Orders, Deliveries & GRN Stock Intake History"
                                                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-lg hover:scale-110 transition-transform font-bold"
                                                >
                                                    <Truck size={18} />
                                                </button>
                                                <button onClick={() => {
                                                    setNewProduct({
                                                        name: product.name,
                                                        sku: product.sku,
                                                        category: product.categoryId ? (categories.find(c => c.id === product.categoryId)?.name || product.category || "Uncategorized") : (product.category || "Uncategorized"),
                                                        base_price: String(product.price),
                                                        cost_price: String(product.cost_price || ""),
                                                        po_reference: "",
                                                        channel_prices: product.channel_prices || {},
                                                        stock: String(product.stock),
                                                        hsn_code: product.hsn_code || "7117",
                                                        image_url: product.image || "",
                                                        location: product.location || "Showcase Tray A",
                                                        craft: product.craft || "",
                                                        plating: product.plating || "",
                                                        occasion: product.occasion || "",
                                                        base_metal: product.base_metal || "",
                                                    });
                                                    setIsEditMode(true);
                                                    setEditingProductId(product.id);
                                                    setShowAddDialog(true);
                                                }} className="bg-primary text-primary-foreground p-2 rounded-lg hover:scale-110"><Edit size={18} /></button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setCloneSeed(product);
                                                        setShowQuickAdd(true);
                                                    }}
                                                    className="bg-surface-hover/60 text-white p-2 rounded-lg hover:scale-110"
                                                    title="Clone into Quick add — change colour & photo, save"
                                                >
                                                    <Copy size={16} />
                                                </button>
                                                <button onClick={() => handleDeleteProduct(product.id)} className="bg-red-500 text-white p-2 rounded-lg hover:scale-110"><Trash2 size={18} /></button>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <p className="text-[10px] font-bold text-primary uppercase tracking-wider truncate">{product.sku}</p>
                                                    {product.is_active === false && (
                                                        <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                                                            Draft
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 text-[10px] font-medium text-amber-300/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                                    <MapPin size={10} className="text-gold shrink-0" />
                                                    <span className="truncate max-w-[100px]">{product.location || 'Showcase Tray A'}</span>
                                                </div>
                                            </div>
                                            <h3 className="text-white font-bold text-sm truncate">{product.name}</h3>
                                            <div className="flex justify-between items-center mt-2">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-white font-mono font-bold">{formatPrice(product.price)}</span>
                                                    {whatsappPrice > 0 && whatsappPrice !== product.price && (
                                                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold" title={`WhatsApp Price: ₹${whatsappPrice.toLocaleString('en-IN')}`}>
                                                            WA: ₹{whatsappPrice.toLocaleString('en-IN')}
                                                        </span>
                                                    )}
                                                    {websitePrice > 0 && websitePrice !== product.price && (
                                                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 font-semibold" title={`Website Price: ₹${websitePrice.toLocaleString('en-IN')}`}>
                                                            Web: ₹{websitePrice.toLocaleString('en-IN')}
                                                        </span>
                                                    )}
                                                    {wholesalePrice > 0 && wholesalePrice !== product.price && (
                                                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold" title={`B2B Wholesale Price: ₹${wholesalePrice.toLocaleString('en-IN')}`}>
                                                            B2B: ₹{wholesalePrice.toLocaleString('en-IN')}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                                    {product.is_active === false && (
                                                        <button
                                                            type="button"
                                                            onClick={() => void handlePublishProduct(product)}
                                                            className="text-[10px] font-semibold px-2 py-1 rounded bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors flex items-center gap-1"
                                                            title="Publish to the storefront"
                                                        >
                                                            <CheckCircle2 size={11} /> Publish
                                                        </button>
                                                    )}
                                                    <span className={`text-xs px-2 py-1 rounded ${product.stock > 5 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>Stock: {product.stock}</span>
                                                    {product.pending_po_quantity && product.pending_po_quantity > 0 ? (
                                                        <span
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedPOProduct(product);
                                                                setShowPOHistoryModal(true);
                                                            }}
                                                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 cursor-pointer hover:bg-amber-500/25 transition-colors"
                                                            title={`${product.pending_po_quantity} units pending on Purchase Orders. Click to view.`}
                                                        >
                                                            <Truck size={10} /> +{product.pending_po_quantity} arriving
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                                })
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Add */}
            <QuickAddProductDialog
                open={showQuickAdd}
                onOpenChange={(next) => {
                    setShowQuickAdd(next);
                    if (!next) setCloneSeed(null);
                }}
                categories={categories}
                existingSkus={products.map((product) => product.sku)}
                cloneSeed={cloneSeed}
                onCreated={handleQuickAddCreated}
            />

            {/* Paste a list */}
            <PasteProductsDialog
                open={showPasteList}
                onOpenChange={setShowPasteList}
                categories={categories}
                existingSkus={products.map((product) => product.sku)}
                onImported={() => {
                    fetchProducts();
                    getCategories().then(setCategories).catch(() => {});
                }}
            />

            {/* Add Dialog */}
            <Dialog
                open={showAddDialog}
                onOpenChange={(open) => {
                    setShowAddDialog(open);
                    if (!open && !formLoading) {
                        setIsEditMode(false);
                        setEditingProductId(null);
                    }
                }}
            >
                <DialogContent className="bg-surface-navy/98 backdrop-blur-2xl border-surface-hover/80 text-white max-w-4xl sm:max-w-4xl lg:max-w-5xl max-h-[min(94vh,calc(100dvh-1.5rem))] overflow-y-auto p-5 sm:p-6 shadow-2xl custom-scrollbar">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold flex items-center justify-between">
                            <span>{isEditMode ? 'Edit Product' : 'Add Jewelry Product'}</span>
                            <span className="text-xs font-mono font-normal text-moonstone bg-bg-navy/80 px-2.5 py-0.5 rounded-full border border-surface-hover">
                                Non-Precious Jewelry ERP
                            </span>
                        </DialogTitle>
                    </DialogHeader>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 py-1 items-start">
                        {/* Left Column: Visual Assets & SKU Architecture (5 cols) */}
                        <div className="lg:col-span-5 flex flex-col gap-3.5">
                            {/* 1. Photo Tagging Card (3 Acquisition Channels: Gallery / Live Camera / WhatsApp) */}
                            <div className="bg-bg-navy/80 border border-primary/25 rounded-xl p-3.5 flex flex-col gap-2.5">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Camera className="text-primary size-4" />
                                        <span className="font-semibold text-xs text-white uppercase tracking-wider">Product Photo Tagging</span>
                                    </div>
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        ANTI-FRAUD READY
                                    </span>
                                </div>

                                {newProduct.image_url ? (
                                    <div className="flex items-center gap-3 bg-surface-navy/70 p-2.5 rounded-lg border border-surface-hover/60">
                                        <div className="size-16 rounded-lg overflow-hidden border-2 border-primary/50 bg-black/40 shrink-0 relative group shadow-md">
                                            {/* eslint-disable-next-line @next/next/no-img-element -- preview source is a canvas.toDataURL data URL with inherently dynamic dimensions, so next/image sizing props do not map */}
                                            <img src={newProduct.image_url} alt="Product Tagged" className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold truncate">
                                                <CheckCircle2 size={13} className="shrink-0" /> Photo Bound
                                            </div>
                                            <p className="text-[10px] text-moonstone truncate mt-0.5 font-mono">
                                                {newProduct.sku ? `${newProduct.sku}_${productShotType}.webp` : 'Canonical Image'}
                                            </p>
                                            <div className="flex gap-2 mt-1.5">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => setShowPhotoModal(true)}
                                                    className="h-6 text-[11px] px-2 border-primary/40 text-primary hover:bg-primary/20"
                                                >
                                                    Change Photo
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setNewProduct(prev => ({ ...prev, image_url: "" }))}
                                                    className="h-6 text-[11px] px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setShowPhotoModal(true)}
                                        className="w-full border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10 rounded-xl p-3 transition-all flex items-center justify-between group cursor-pointer text-left"
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div className="size-9 rounded-lg bg-primary/20 text-primary flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                                                <Camera size={16} />
                                            </div>
                                            <div>
                                                <div className="text-xs font-semibold text-white group-hover:text-primary transition-colors flex items-center gap-1.5">
                                                    Acquire Photo
                                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/20 text-primary">Required</span>
                                                </div>
                                                <div className="text-[10px] text-moonstone truncate mt-0.5">
                                                    Gallery • Camera • WhatsApp
                                                </div>
                                            </div>
                                        </div>
                                        <div className="px-2.5 py-1 rounded-lg bg-primary/20 text-primary text-[11px] font-semibold group-hover:bg-primary group-hover:text-black transition-all shrink-0">
                                            Select
                                        </div>
                                    </button>
                                )}
                            </div>

                            {/* 2. Master Jewelry SKU Architecture Engine */}
                            <div className="border border-surface-hover/70 rounded-xl overflow-hidden bg-bg-navy/40">
                                <button
                                    type="button"
                                    onClick={() => setShowSkuArchitect(!showSkuArchitect)}
                                    className="w-full px-3.5 py-2.5 bg-surface-navy/70 hover:bg-surface-navy flex items-center justify-between text-left transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="size-3.5 text-gold" />
                                        <div>
                                            <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                                SKU Architecture Engine
                                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-normal">
                                                    Hierarchical
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-moonstone truncate">
                                                Auto 14/21-char Parent/Child & statutory HSN 7117
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <a
                                            href="/settings?tab=sku_taxonomies"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-[10px] font-semibold text-primary hover:underline bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20 transition-all hover:bg-primary/20"
                                        >
                                            ⚙️ Manage
                                        </a>
                                        {showSkuArchitect ? <ChevronUp size={15} className="text-moonstone" /> : <ChevronDown size={15} className="text-moonstone" />}
                                    </div>
                                </button>

                                {showSkuArchitect && (
                                    <div className="p-3 space-y-2.5 border-t border-surface-hover/40 bg-bg-navy/90 text-xs">
                                        <div className="flex items-center justify-between pb-1 border-b border-surface-hover/30">
                                            <span className="text-[10px] text-moonstone font-medium">Configure jewelry taxonomy or skip for generic stock:</span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setSkuGenre("GEN");
                                                    setSkuCategory("GEN");
                                                    setSkuSubcat("GEN");
                                                    setNewProduct(prev => ({ ...prev, category: "Uncategorized" }));
                                                    toast.info("Taxonomy set to General / Uncategorized");
                                                }}
                                                className="h-6 text-[10px] px-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 font-semibold"
                                            >
                                                ⚡ Skip Taxonomy (General SKU)
                                            </Button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Style Genre</Label>
                                                <Select value={skuGenre} onValueChange={val => setSkuGenre(val || "GEN")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.genres.map((g, idx) => (
                                                            <SelectItem key={`${g.code}-${idx}`} value={g.code} className="text-xs">
                                                                {g.code} - {g.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Category</Label>
                                                <Select value={skuCategory} onValueChange={(val) => {
                                                    const v = val || "GEN";
                                                    setSkuCategory(v);
                                                    const matchedCat = skuTaxonomies.categories.find(c => c.code === v);
                                                    if (matchedCat) setNewProduct(prev => ({ ...prev, category: v === "GEN" ? "Uncategorized" : matchedCat.label }));
                                                    const validSubcats = getSubcategoriesForCategory(v, skuTaxonomies.subcategories);
                                                    if (validSubcats.length > 0 && !validSubcats.some(s => s.code === skuSubcat)) {
                                                        setSkuSubcat(validSubcats[0].code);
                                                    }
                                                }}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.categories.map((c, idx) => (
                                                            <SelectItem key={`${c.code}-${idx}`} value={c.code} className="text-xs">
                                                                {c.code} - {c.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Subcategory</Label>
                                                <Select value={skuSubcat} onValueChange={val => setSkuSubcat(val || "GEN")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {getSubcategoriesForCategory(skuCategory, skuTaxonomies.subcategories).map((s, idx) => (
                                                            <SelectItem key={`${s.code}-${idx}`} value={s.code} className="text-xs">
                                                                {s.code} - {s.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Plating Finish</Label>
                                                <Select value={skuPlating} onValueChange={val => setSkuPlating(val || "MG")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.platings.map((p, idx) => (
                                                            <SelectItem key={`${p.code}-${idx}`} value={p.code} className="text-xs">
                                                                {p.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Primary Color</Label>
                                                <Select value={skuColor} onValueChange={val => setSkuColor(val || "RB")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.colors.map((c, idx) => (
                                                            <SelectItem key={`${c.code}-${idx}`} value={c.code} className="text-xs">
                                                                {c.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Size / Sizing</Label>
                                                <Select value={skuSize} onValueChange={val => setSkuSize(val || "STD")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.sizes.map((s, idx) => (
                                                            <SelectItem key={`${s.code}-${idx}`} value={s.code} className="text-xs">
                                                                {s.code} - {s.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Packaging Tier</Label>
                                                <Select value={skuPackagingTier} onValueChange={val => setSkuPackagingTier(val || "EA")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.packagingTiers.map((t, idx) => (
                                                            <SelectItem key={`${t.suffix}-${idx}`} value={t.suffix} className="text-xs">
                                                                {t.suffix} - {t.label} (x{t.multiplier})
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-surface-hover/30">
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Base Metal Substrate</Label>
                                                <Select value={skuBaseMetal} onValueChange={val => setSkuBaseMetal(val || "BR")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.baseMetals.map((m, idx) => (
                                                            <SelectItem key={`${m.code}-${idx}`} value={m.code} className="text-xs">
                                                                {m.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label className="text-[10px] text-moonstone">Stone / Embellishment</Label>
                                                <Select value={skuStone} onValueChange={val => setSkuStone(val || "KP")}>
                                                    <SelectTrigger className="bg-surface-navy border-surface-hover text-xs h-7.5"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {skuTaxonomies.stones.map((s, idx) => (
                                                            <SelectItem key={`${s.code}-${idx}`} value={s.code} className="text-xs">
                                                                {s.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="bg-surface-navy p-2.5 rounded-lg border border-primary/30 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-[9px] text-moonstone uppercase font-bold tracking-wider">Preview Generated SKU</div>
                                                <div className="text-xs font-mono font-bold text-primary truncate mt-0.5">
                                                    {generateWholesaleSKU(generateChildSKU(generateParentSKU(skuGenre, skuCategory, skuSubcat, nextSkuSeq), skuPlating, skuColor, skuSize), skuPackagingTier)}
                                                </div>
                                                <div className="text-[10px] text-amber-300 font-mono">
                                                    HSN {deriveHSNCode(skuCategory, skuBaseMetal, skuStone)} (3% GST)
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                onClick={handleApplyGeneratedSKU}
                                                className="bg-gold text-bg-navy hover:bg-gold/90 font-bold text-[11px] h-7 px-3 shrink-0"
                                            >
                                                Apply
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 3. Statutory HSN Code & Compliance */}
                            <div className="bg-bg-navy/60 border border-surface-hover/70 rounded-xl p-3 flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <Label className="text-[11px] text-moonstone">Statutory HSN Code (3% GST)</Label>
                                    <Input
                                        value={newProduct.hsn_code}
                                        onChange={e => setNewProduct({ ...newProduct, hsn_code: e.target.value })}
                                        className="bg-bg-navy border-surface-hover text-xs h-8 font-mono text-amber-300 mt-1"
                                        placeholder="71179010"
                                    />
                                </div>
                                {!showSkuArchitect && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setShowSkuArchitect(true)}
                                        className="text-[11px] h-8 border-gold/40 text-gold hover:bg-gold/10 gap-1 shrink-0 self-end"
                                    >
                                        <Sparkles size={12} /> Auto SKU Spec
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Right Column: Core Attributes, Pricing Engine, Inventory & Save (7 cols) */}
                        <div className="lg:col-span-7 flex flex-col gap-3.5">
                            {/* Product Identity */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Product Name</Label>
                                    <Input
                                        value={newProduct.name}
                                        onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                                        placeholder="e.g. Temple Choker Kemp Ruby"
                                        className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs">SKU Code</Label>
                                    <Input
                                        value={newProduct.sku}
                                        onChange={e => setNewProduct({ ...newProduct, sku: e.target.value })}
                                        placeholder="TMPNECCHK00001-MGRBSTD"
                                        className="bg-bg-navy border-surface-hover font-mono text-sm h-9 text-primary font-semibold mt-1"
                                    />
                                </div>
                            </div>

                            {/* Category & Base Price */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Category</Label>
                                    <Select value={newProduct.category || "Uncategorized"} onValueChange={v => setNewProduct({ ...newProduct, category: v || "Uncategorized" })}>
                                        <SelectTrigger className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"><SelectValue placeholder="Select Category" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Uncategorized">-- Skip / Uncategorized --</SelectItem>
                                            {categories.filter(c => c.name !== "Uncategorized").map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs">Base Retail Price (₹)</Label>
                                    <Input
                                        type="number"
                                        value={newProduct.base_price}
                                        onChange={e => setNewProduct({ ...newProduct, base_price: e.target.value })}
                                        placeholder="1499"
                                        className="bg-bg-navy border-surface-hover text-sm h-9 font-mono mt-1 font-semibold"
                                    />
                                    <p className="text-[10px] text-moonstone mt-1">
                                        The Shop rule sets the counter price when configured; this is the fallback.
                                    </p>
                                </div>
                            </div>

                            {/* Craft Specification (Imitation / Fashion Jewelry) */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-bg-navy/60 p-2.5 rounded-lg border border-surface-hover/70">
                                <div>
                                    <Label className="text-xs text-moonstone">Craft</Label>
                                    <Select value={newProduct.craft || "none"} onValueChange={v => setNewProduct({ ...newProduct, craft: v === "none" ? "" : (v || "") })}>
                                        <SelectTrigger className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            {Object.entries(CRAFT_DEFINITIONS).map(([key, def]) => (
                                                <SelectItem key={key} value={key}>{def.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs text-moonstone">Plating</Label>
                                    <Select value={newProduct.plating || "none"} onValueChange={v => setNewProduct({ ...newProduct, plating: v === "none" ? "" : (v || "") })}>
                                        <SelectTrigger className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            {Object.entries(PLATING_DEFINITIONS).map(([key, def]) => (
                                                <SelectItem key={key} value={key}>{def.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs text-moonstone">Occasion</Label>
                                    <Select value={newProduct.occasion || "none"} onValueChange={v => setNewProduct({ ...newProduct, occasion: v === "none" ? "" : (v || "") })}>
                                        <SelectTrigger className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            {Object.entries(OCCASION_DEFINITIONS).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>{label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs text-moonstone">Base Metal</Label>
                                    <Select value={newProduct.base_metal || "none"} onValueChange={v => setNewProduct({ ...newProduct, base_metal: v === "none" ? "" : (v || "") })}>
                                        <SelectTrigger className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            {Object.entries(BASE_METAL_DEFINITIONS).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>{label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {newProduct.plating && PLATING_DEFINITIONS[newProduct.plating] && (
                                    <p className="col-span-full text-[10px] text-moonstone">
                                        Plating durability: ~{PLATING_DEFINITIONS[newProduct.plating].durabilityMonths} months.
                                        Spec prints on dumbbell tags from the Labels page.
                                    </p>
                                )}
                            </div>

                            {/* Multi-Channel Custom Pricing Engine */}
                            <ChannelPricingInput
                                basePrice={parseFloat(newProduct.base_price) || 0}
                                costPrice={parseFloat(newProduct.cost_price) || 0}
                                channelPrices={newProduct.channel_prices || {}}
                                onChange={(cp) => setNewProduct(prev => ({ ...prev, channel_prices: cp }))}
                                onBasePriceChange={(bp) => setNewProduct(prev => ({ ...prev, base_price: String(bp) }))}
                            />

                            {/* Cost Price & Purchase Order Reference */}
                            <div className="grid grid-cols-2 gap-3 bg-bg-navy/60 p-2.5 rounded-lg border border-surface-hover/70">
                                <div>
                                    <Label className="text-xs flex items-center justify-between text-moonstone">
                                        <span>Unit Cost Price (₹)</span>
                                        <span className="text-[10px] text-teal-400 font-semibold">Inward Cost</span>
                                    </Label>
                                    <Input
                                        type="number"
                                        value={newProduct.cost_price}
                                        onChange={e => setNewProduct({ ...newProduct, cost_price: e.target.value })}
                                        placeholder="e.g. 850"
                                        className="bg-bg-navy border-surface-hover text-sm h-9 font-mono mt-1 text-teal-300 font-semibold"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs flex items-center justify-between text-moonstone">
                                        <span>Purchase Order Ref</span>
                                        {activeInwardPo && (
                                            <span className="text-[9px] text-teal-400 font-bold bg-teal-500/10 px-1 rounded">Active</span>
                                        )}
                                    </Label>
                                    <Input
                                        type="text"
                                        value={newProduct.po_reference}
                                        onChange={e => setNewProduct({ ...newProduct, po_reference: e.target.value.toUpperCase() })}
                                        placeholder="e.g. PO-SRIM-20261019-180532"
                                        className="bg-bg-navy border-surface-hover text-xs h-9 font-mono mt-1 text-teal-300 uppercase"
                                    />
                                </div>
                            </div>

                            {/* Stock & Storage Location */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Stock Level</Label>
                                    <Input
                                        type="number"
                                        value={newProduct.stock}
                                        onChange={e => setNewProduct({ ...newProduct, stock: e.target.value })}
                                        placeholder="10"
                                        className="bg-bg-navy border-surface-hover text-sm h-9 font-mono mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="flex items-center gap-1.5 text-xs"><MapPin size={13} className="text-gold" /> Storage Location</Label>
                                    <Select value={newProduct.location || "Showcase Tray A"} onValueChange={v => setNewProduct({ ...newProduct, location: v || "Showcase Tray A" })}>
                                        <SelectTrigger className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {STORAGE_LOCATIONS.map(loc => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Primary Action Button */}
                            <Button
                                onClick={handleAddProduct}
                                disabled={formLoading}
                                className="mt-1 h-10 font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg cursor-pointer"
                            >
                                {formLoading ? 'Saving Product...' : (isEditMode ? 'Update Product' : 'Save as draft')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Scan Dialog */}
            <Dialog open={showScanDialog} onOpenChange={setShowScanDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white">
                    <DialogHeader><DialogTitle>Scan Stock</DialogTitle></DialogHeader>
                    <div className="flex flex-col gap-4">
                        {scanMode === 'camera' ? (
                            <BarcodeScanner onScan={(res) => { setScanQuery(res); handleScanSubmit({ preventDefault: () => { } }, res); setScanMode('text'); }} onError={console.error} />
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

            {/* Floating Selection Toolbar for WhatsApp Broadcast & Bulk Actions */}
            {selectedProductIds.length > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface-navy/95 border border-primary/50 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-4 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-center gap-2">
                        <span className="size-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                            {selectedProductIds.length}
                        </span>
                        <span className="text-xs font-semibold">
                            {selectedProductIds.length} item{selectedProductIds.length === 1 ? '' : 's'} selected
                        </span>
                    </div>
                    <div className="h-4 w-px bg-surface-hover" />
                    <Button
                        size="sm"
                        onClick={() => {
                            const list = products.filter(p => selectedProductIds.includes(p.id));
                            setBroadcastProductsList(list);
                            setShowBroadcastModal(true);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold gap-1.5 h-8 px-3"
                    >
                        <Share2 size={14} />
                        Broadcast to WhatsApp / Social
                    </Button>
                    <button
                        onClick={() => setSelectedProductIds(filteredProducts.map(p => p.id))}
                        className="text-xs text-moonstone hover:text-white px-2 py-1 transition-colors"
                    >
                        Select All ({filteredProducts.length})
                    </button>
                    <button
                        onClick={() => setSelectedProductIds([])}
                        className="text-xs text-muted-foreground hover:text-white px-2 py-1 transition-colors"
                    >
                        Clear
                    </button>
                </div>
            )}

            {/* Product Broadcast Modal */}
            <ProductBroadcastModal
                isOpen={showBroadcastModal}
                onClose={() => setShowBroadcastModal(false)}
                initialSelectedProducts={broadcastProductsList}
                onBroadcastSuccess={() => setSelectedProductIds([])}
            />

            {/* Product Photo Tagging Modal (Gallery / Camera Viewfinder / WhatsApp Vendor Media) */}
            <ProductPhotoTaggingModal
                isOpen={showPhotoModal}
                onClose={() => setShowPhotoModal(false)}
                initialShotType={productShotType}
                productSku={newProduct.sku}
                productName={newProduct.name}
                onPhotoSelected={(imageData, shotType) => {
                    setNewProduct(prev => ({ ...prev, image_url: imageData }));
                    setProductShotType(shotType);
                    setShowPhotoModal(false);
                    toast.success(`Photo tagged as [${shotType}] shot successfully!`);
                }}
            />

            {/* Stock Discrepancies, Quarantine & Vendor Replacements Modal */}
            <DiscrepancyModal
                isOpen={showDiscrepancyModal}
                onClose={() => {
                    setShowDiscrepancyModal(false);
                    setSelectedDiscrepancyProduct(null);
                }}
                preselectedProduct={selectedDiscrepancyProduct}
                onStockUpdated={() => {
                    fetchProducts();
                    loadDiscrepancyCount();
                }}
            />

            {/* Multi-Location & Stock Transfer Modal */}
            <StockTransferModal
                open={showTransferModal}
                onOpenChange={setShowTransferModal}
                onTransferred={fetchProducts}
            />

            {/* Product Purchase Order & Delivery Intake History Modal */}
            <ProductPurchaseHistoryModal
                isOpen={showPOHistoryModal}
                onClose={() => {
                    setShowPOHistoryModal(false);
                    setSelectedPOProduct(null);
                }}
                product={selectedPOProduct}
            />

            {/* Quick Receive from Purchase Orders Modal */}
            <QuickReceivePOModal
                isOpen={showQuickReceiveModal}
                onClose={() => {
                    setShowQuickReceiveModal(false);
                    fetchProducts();
                    loadOpenPOCount();
                }}
            />

            {/* Bulk Inventory Excel / CSV Import Modal */}
            <BulkInventoryImportModal
                isOpen={showBulkImportModal}
                onClose={() => setShowBulkImportModal(false)}
                onImportSuccess={fetchProducts}
                defaultPoReference={activeInwardPo || undefined}
            />
        </div>
    );
}

export default function InventoryPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" size={40} /></div>}>
            <InventoryContent />
        </Suspense>
    );
}
