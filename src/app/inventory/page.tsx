"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
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
import { InventoryBulkActionBar } from "@/components/inventory/InventoryBulkActionBar";
import { ProductStockLedgerModal } from "@/components/inventory/ProductStockLedgerModal";
import { TrayCycleCountModal } from "@/components/inventory/TrayCycleCountModal";
import { SmartReplenishmentModal } from "@/components/inventory/SmartReplenishmentModal";
import { BundleComposerSection } from "@/components/inventory/BundleComposerSection";
import type { BundleComponent } from "@/lib/bundles";
import { History, ShoppingBag } from "lucide-react";
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
    DropdownMenuGroup,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
    updateStock,
    deleteProductCascade,
    STORAGE_LOCATIONS,
    getProductDisplayImage,
    loadProductGalleryMap,
    saveProductGalleryAngles,
    mergeProductAngle,
    isDeadStockProduct,
    type Product as PbProduct,
    type ProductGalleryAngles,
    type ProductAngleSlot,
} from "@/lib/products";
import type { ProductVariant } from "@/lib/products";
import {
    loadChannelBufferConfigs,
    saveChannelBufferConfigs,
    DEFAULT_CHANNEL_CONFIGS,
    type ChannelBufferConfig,
} from "@/lib/omnichannel-buffer-engine";
import { loadTrayLocationOptions, trayChoices, trayChoiceLabel, type TrayLocationOption } from "@/lib/tray-locations";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Archive, MoreVertical, RotateCcw, ShieldCheck } from "lucide-react";
import { pb } from "@/lib/pocketbase";
import { usePermissions } from "@/hooks/usePermissions";

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
    gallery_angles?: ProductGalleryAngles;
    hsn_code?: string;
    barcode?: string;
    location?: string;
    craft?: string;
    plating?: string;
    occasion?: string;
    base_metal?: string;
    is_active?: boolean;
    variant_id?: string;
    is_bundle?: boolean;
    bundle_items?: BundleComponent[];
    created?: string;
    updated?: string;
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
    // PG-19: destructive handlers re-check the permission; hiding the button is
    // not a security boundary.
    const { hasPermission, isAdmin } = usePermissions();
    const canDeleteProducts = () => isAdmin || hasPermission("inventory", "delete");
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
    const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft" | "dead_stock">("all");
    const [showBufferModal, setShowBufferModal] = useState(false);
    const [bufferConfigs, setBufferConfigs] = useState<ChannelBufferConfig[]>(DEFAULT_CHANNEL_CONFIGS);
    const [bufferSaving, setBufferSaving] = useState(false);
    const [page, setPage] = useState(1);
    const INVENTORY_PAGE_SIZE = 48;
    const [salesChannels, setSalesChannels] = useState<SalesChannelDef[]>(() => getConfiguredChannels());
    const [formLoading, setFormLoading] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [, setAttributes] = useState<ProductAttribute[]>([]);

    const [showBulkImportModal, setShowBulkImportModal] = useState(false);

    // Edit mode
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingProductId, setEditingProductId] = useState<string | null>(null);
    const [editingVariants, setEditingVariants] = useState<
        Array<{
            id: string;
            variant_name: string;
            stock_level: number;
            original_stock: number;
            price_adjustment: number;
            original_price_adjustment: number;
        }>
    >([]);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingDemoCleanup, setPendingDemoCleanup] = useState<{
        createdName: string;
        demoIds: string[];
    } | null>(null);

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
    const [showLedgerModal, setShowLedgerModal] = useState(false);
    const [selectedLedgerProduct, setSelectedLedgerProduct] = useState<Product | null>(null);
    const [showCycleCountModal, setShowCycleCountModal] = useState(false);
    const [showReplenishmentModal, setShowReplenishmentModal] = useState(false);

    // Editable tray locations (Settings → Tray Locations). Falls back to the
    // built-in presets until the shop defines its own codes.
    const [trayOptions, setTrayOptions] = useState<TrayLocationOption[]>([]);
    useEffect(() => {
        let alive = true;
        loadTrayLocationOptions()
            .then((opts) => { if (alive) setTrayOptions(opts); })
            .catch(() => { /* presets already cover the select */ });
        return () => { alive = false; };
    }, []);

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
        gallery_angles: {} as ProductGalleryAngles,
        location: "Showcase Tray A",
        craft: "",
        plating: "",
        occasion: "",
        base_metal: "",
        is_bundle: false,
        bundle_items: [] as BundleComponent[],
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
            !showPOHistoryModal
    );

    // Handle Scan Logic. `overrideQuery` lets the camera path pass the scanned code
    // directly, because a setScanQuery() in the same event is not visible to this
    // render's closure yet.
    const handleScanSubmit = useCallback((e: Pick<React.FormEvent, "preventDefault">, overrideQuery?: string) => {
        e.preventDefault();
        const rawQuery = (overrideQuery ?? scanQuery).trim();
        if (!rawQuery) return;

        const normalizedQuery = rawQuery.toUpperCase();
        const extractedSku = parseSKUFromBarcode(normalizedQuery) || normalizedQuery;

        // I11: exact SKU/barcode wins over the fuzzy name search; a partial name
        // hit could otherwise return a different product than the scanned code.
        const exact = products.find(p =>
            p.sku?.toUpperCase() === extractedSku ||
            p.sku?.toUpperCase() === normalizedQuery ||
            p.barcode?.toUpperCase() === normalizedQuery
        );
        const found = exact || products.find(p => {
            const name = (p.name || '').toUpperCase();
            return name.length > 0 && name.includes(normalizedQuery);
        });

        if (found) {
            setScanResult(found);
            setScanStockInput("1");
            setScanNotFoundSku(null);
        } else {
            setScanResult(null);
            setScanNotFoundSku(normalizedQuery);
        }
    }, [scanQuery, products]);

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
    }, [showAddDialog, showScanDialog, showDiscrepancyModal, showBroadcastModal, handleScanSubmit]);

    // Update stock from scanner
    const handleScanStockUpdate = async (change: number) => {
        if (!scanResult) return;

        try {
            // I4: resolve the exact variant. Falling back to variants[0] moved
            // the wrong SKU on a multi-variant product.
            const variants = await getProductVariants(scanResult.id);
            const suffix = scanResult.sku.split('-').pop();
            let variant = variants.find(
                (v) => v.variant_name === scanResult.sku || (suffix && v.sku_suffix === suffix)
            );
            if (!variant && variants.length === 1) variant = variants[0];

            if (!variant) {
                toast.error("This product has multiple variants. Scan or select the exact variant before adjusting stock.");
                return;
            }

            // updateStock reads the current level, rejects an under-flow and
            // applies the change atomically (`stock_level+/-`), so two scans
            // cannot lose each other's update.
            await updateStock(variant.id, change);

            // Update local list: product `stock` is the aggregate, so it shifts by `change`
            setProducts(prev => prev.map(p =>
                p.id === scanResult.id ? { ...p, stock: p.stock + change } : p
            ));
            setScanResult(prev => prev ? { ...prev, stock: prev.stock + change } : null);

            toast.success(`Stock updated to ${scanResult.stock + change}`);
        } catch (err) {
            console.error("Stock update failed", err);
            toast.error(err instanceof Error ? err.message : "Failed to update stock");
        }
    };



    // Auto-generate Architectural SKU according to Spec
    const handleApplyGeneratedSKU = async () => {
        // Dictionary codes only (A-Z0-9): used both as the pb.filter bound value
        // and as the literal regex anchor below.
        const prefix = `${skuGenre}${skuCategory}${skuSubcat}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
        let nextSeq: number;
        try {
            // The allocator fails loudly instead of guessing a colliding number.
            nextSeq = await computeNextSkuSequence(prefix);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not allocate a SKU sequence.");
            return;
        }
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
        computeNextSkuSequence(prefix)
            .then(seq => {
                if (!cancelled) setNextSkuSeq(seq);
            })
            .catch((err) => {
                if (!cancelled) console.error("Could not allocate a SKU sequence", err);
            });
        return () => { cancelled = true; };
    }, [showSkuArchitect, skuGenre, skuCategory, skuSubcat, products]);

    // Fetch products
    const fetchProducts = async () => {
        try {
            setLoading(true);
            setError(null);

            const [fetchedProducts, variantSummary, galleryMap] = await Promise.all([
                getProducts({ activeOnly: false }) as Promise<ProductRecordWithCategory[]>,
                getVariantStockSummary(),
                loadProductGalleryMap().catch(() => ({} as Record<string, ProductGalleryAngles>)),
            ]);

            const {
                stockByProduct: variantMap,
                materialByProduct: variantMaterialMap,
                productByVariant: variantToProduct,
                primaryVariantByProduct,
            } = variantSummary;

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
                const primaryImage = getProductDisplayImage(p);
                const angles = galleryMap[p.id] || (primaryImage ? { HERO: primaryImage } : {});
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
                    image: primaryImage,
                    gallery_angles: angles,
                    hsn_code: p.hsn_code,
                    barcode: p.barcode,
                    location: p.location || "Showcase Tray A",
                    craft: p.craft || "",
                    plating: p.plating || "",
                    occasion: p.occasion || "",
                    base_metal: p.base_metal || "",
                    is_active: p.is_active !== false,
                    variant_id: primaryVariantByProduct.get(p.id) || '',
                    is_bundle: Boolean(p.is_bundle),
                    bundle_items: Array.isArray(p.bundle_items) ? (p.bundle_items as unknown as BundleComponent[]) : [],
                    created: p.created,
                    updated: p.updated,
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
            // I2: `parseInt(...) || 0` preserved a negative initial stock and
            // silently turned junk into 0. An empty field still means 0.
            const stockRaw = String(newProduct.stock ?? "").trim();
            const parsedStock = stockRaw === "" ? 0 : Number(stockRaw);
            if (!Number.isInteger(parsedStock) || parsedStock < 0) {
                toast.error("Stock must be a whole number of 0 or more.");
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
                image_data: newProduct.gallery_angles?.HERO || newProduct.image_url || '',
                location: newProduct.location || "Showcase Tray A",
                craft: newProduct.craft || '',
                plating: newProduct.plating || '',
                occasion: newProduct.occasion || '',
                base_metal: newProduct.base_metal || '',
                is_active: isEditMode
                    ? products.find((product) => product.id === editingProductId)?.is_active !== false
                    : false,
                is_bundle: Boolean(newProduct.is_bundle),
                bundle_items: (newProduct.is_bundle ? newProduct.bundle_items : []) as unknown as PbProduct["bundle_items"],
            };

            let targetVariantId = "";
            let savedProductId = editingProductId || "";
            // Quantity actually added to stock by this save. In edit mode this is
            // the delta, not the cumulative total the dialog shows (INV-05).
            let intakeQuantity = parsedStock;

            if (isEditMode && editingProductId) {
                // Update
                await updateProduct(editingProductId, productPayload);

                // Persist per-variant stock & price adjustments edited in the Variant Matrix
                if (editingVariants.length > 1) {
                    for (const ev of editingVariants) {
                        const stockDelta = ev.stock_level - ev.original_stock;
                        const priceChanged = ev.price_adjustment !== ev.original_price_adjustment;
                        if (stockDelta !== 0 || priceChanged) {
                            await updateVariant(ev.id, {
                                ...(stockDelta !== 0 ? { stock_level: ev.stock_level } : {}),
                                ...(priceChanged ? { price_adjustment: ev.price_adjustment } : {}),
                            });
                        }
                        if (stockDelta !== 0) {
                            await recordManualIntakeMovement({
                                variantId: ev.id,
                                quantity: stockDelta,
                                referenceId: editingProductId,
                                notes: `Variant ${ev.variant_name} adjustment (${ev.original_stock} → ${ev.stock_level})`,
                            }).catch(err => console.warn('Could not log variant movement:', err));
                        }
                    }
                } else if (editingVariants.length === 1 && editingVariants[0].price_adjustment !== editingVariants[0].original_price_adjustment) {
                    await updateVariant(editingVariants[0].id, {
                        price_adjustment: editingVariants[0].price_adjustment,
                    });
                }

                // I3: apply the aggregate delta only when there is exactly one
                // variant. A multi-variant product must be edited per variant —
                // dumping the delta on variants[0] corrupted the stock matrix,
                // and renaming that variant to the parent SKU destroyed it.
                const variants = await getProductVariants(editingProductId);
                if (variants.length > 1) {
                    toast.warning(
                        `"${newProduct.name}" has ${variants.length} variants; edit each variant's stock individually. The product-level stock field was not applied.`
                    );
                } else if (variants.length === 1) {
                    targetVariantId = variants[0].id;
                    const liveVariantStock = Number(variants[0].stock_level || 0);
                    const stockDelta = parsedStock - liveVariantStock;
                    intakeQuantity = Math.max(0, stockDelta);
                    if (stockDelta !== 0) {
                        await updateVariant(variants[0].id, {
                            stock_level: Math.max(0, liveVariantStock + stockDelta),
                        });
                        if (!poRef) {
                            await recordManualIntakeMovement({
                                variantId: variants[0].id,
                                quantity: stockDelta,
                                referenceId: editingProductId,
                                notes: stockDelta > 0
                                    ? `Manual stock increase: +${stockDelta} units`
                                    : `Manual stock adjustment: ${stockDelta} units`,
                            }).catch(err => console.warn('Could not log manual stock movement:', err));
                        }
                    }
                } else {
                    // Create if missing
                    const v = await createVariant({
                        product: editingProductId,
                        variant_name: newProduct.sku,
                        stock_level: parsedStock
                    });
                    targetVariantId = v.id;
                    if (parsedStock > 0 && !poRef) {
                        await recordManualIntakeMovement({
                            variantId: v.id,
                            quantity: parsedStock,
                            referenceId: editingProductId,
                            notes: `Initial stock for newly created variant: ${parsedStock} units`,
                        }).catch(err => console.warn('Could not log stock movement:', err));
                    }
                }
                toast.success("Product updated");
            } else {
                // Create
                const product = await createProduct(productPayload);
                savedProductId = product.id;

                // Create default variant
                const v = await createVariant({
                    product: product.id,
                    variant_name: newProduct.sku,
                    stock_level: parsedStock
                });
                targetVariantId = v.id;
                if (parsedStock > 0 && !poRef) {
                    await recordManualIntakeMovement({
                        variantId: v.id,
                        quantity: parsedStock,
                        referenceId: product.id,
                        notes: `Initial stock for product: ${parsedStock} units`,
                    }).catch(err => console.warn('Could not log stock movement:', err));
                }
                toast.success("Product created");
            }

            // If tagged to a Purchase Order, log stock movement and reconcile
            if (poRef && targetVariantId) {
                const addedStock = intakeQuantity;
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
                } catch (recErr) {
                    console.warn('PO reconciliation notice:', recErr instanceof Error ? recErr.message : String(recErr));
                }
            }

            if (savedProductId) {
                const anglesToSave =
                    Object.keys(newProduct.gallery_angles || {}).length > 0
                        ? newProduct.gallery_angles
                        : newProduct.image_url
                        ? { HERO: newProduct.image_url }
                        : {};
                await saveProductGalleryAngles(savedProductId, anglesToSave);
            }

            setShowAddDialog(false);
            setNewProduct({ name: '', sku: '', category: 'Uncategorized', base_price: '', cost_price: '', po_reference: activeInwardPo || '', channel_prices: {}, stock: '', hsn_code: '71179010', image_url: '', gallery_angles: {} as ProductGalleryAngles, location: trayOptions[0]?.code ?? 'Showcase Tray A', craft: '', plating: '', occasion: '', base_metal: '', is_bundle: false, bundle_items: [] });
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
        setPendingDemoCleanup({
            createdName: created.name,
            demoIds: demos.map((d) => d.id),
        });
    };

    const confirmDemoCleanup = async () => {
        if (!pendingDemoCleanup) return;
        const { demoIds } = pendingDemoCleanup;
        setPendingDemoCleanup(null);
        for (const demoId of demoIds) {
            await deleteProductCascade(demoId).catch(() => {});
        }
        toast.success("Demo products removed.");
        await fetchProducts();
    };

    const handleArchiveToggle = async (product: Product) => {
        const nextActive = product.is_active === false;
        try {
            await updateProduct(product.id, { is_active: nextActive });
            toast.success(nextActive ? `${product.name} restored to catalog` : `${product.name} archived as draft`);
            await fetchProducts();
        } catch (err) {
            console.error("Archive toggle failed:", err);
            toast.error(err instanceof Error ? err.message : "Could not update product status");
        }
    };

    const openEditProduct = (product: Product) => {
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
            gallery_angles: product.gallery_angles || (product.image ? { HERO: product.image } : {}),
            location: product.location || "Showcase Tray A",
            craft: product.craft || "",
            plating: product.plating || "",
            occasion: product.occasion || "",
            base_metal: product.base_metal || "",
            is_bundle: Boolean(product.is_bundle),
            bundle_items: product.bundle_items || [],
        });
        setEditingVariants([]);
        setIsEditMode(true);
        setEditingProductId(product.id);
        setShowAddDialog(true);
        getProductVariants(product.id)
            .then((vars: ProductVariant[]) => {
                setEditingVariants(
                    vars.map((v) => ({
                        id: v.id,
                        variant_name: v.variant_name || product.sku,
                        stock_level: Number(v.stock_level) || 0,
                        original_stock: Number(v.stock_level) || 0,
                        price_adjustment: Number(v.price_adjustment) || 0,
                        original_price_adjustment: Number(v.price_adjustment) || 0,
                    }))
                );
            })
            .catch(() => setEditingVariants([]));
    };

    const handleDeleteProduct = (id: string) => {
        if (!canDeleteProducts()) {
            toast.error("You do not have permission to delete products.");
            return;
        }
        setPendingDeleteId(id);
    };

    const executeDeleteProduct = async (id: string) => {
        try {
            // A product with sales or order history must stay readable for invoices and
            // order details, so it is refused rather than orphaned.
            // PG-18: fail closed — a failed history query aborts the delete (the
            // outer catch toasts) instead of being read as "no history".
            const [orderHistory, posHistory] = await Promise.all([
                pb.collection("sales_order_items").getList(1, 1, { filter: `product="${id}"` }),
                pb.collection("sale_items").getList(1, 1, { filter: `product="${id}"` }),
            ]);
            if ((orderHistory && orderHistory.totalItems > 0) || (posHistory && posHistory.totalItems > 0)) {
                toast.error("This product has sales history and cannot be deleted. Unpublish it instead.");
                return;
            }

            const variants = await getProductVariants(id);
            if (variants.length > 0) {
                const variantFilter = variants.map(v => `variant="${v.id}"`).join(" || ");
                const [orderVarHistory, posVarHistory, invVarHistory] = await Promise.all([
                    pb.collection("sales_order_items").getList(1, 1, { filter: variantFilter }),
                    pb.collection("sale_items").getList(1, 1, { filter: variantFilter }),
                    pb.collection("invoice_items").getList(1, 1, { filter: variantFilter }),
                ]);
                if (
                    (orderVarHistory && orderVarHistory.totalItems > 0) ||
                    (posVarHistory && posVarHistory.totalItems > 0) ||
                    (invVarHistory && invVarHistory.totalItems > 0)
                ) {
                    toast.error("This product's variants have sales or invoice history and cannot be deleted. Unpublish it instead.");
                    return;
                }
            }

            // Clears the required-relation blockers (stock movements, label
            // queue, vendor mappings) before the product delete cascades the
            // variants — see deleteProductCascade for the full map.
            const report = await deleteProductCascade(id);
            const cleaned = [
                report.removedStockMovements > 0 ? `${report.removedStockMovements} stock movements` : null,
                report.removedLabelQueueEntries > 0 ? `${report.removedLabelQueueEntries} label jobs` : null,
                report.removedVendorMappings > 0 ? `${report.removedVendorMappings} vendor mappings` : null,
            ].filter(Boolean).join(", ");
            toast.success("Product deleted", {
                description: cleaned ? `Also removed ${cleaned}.` : undefined,
            });
            fetchProducts();
        } catch (err: unknown) {
            console.error("Failed to delete product:", err);
            const msg = (err as { data?: { message?: string }; message?: string })?.data?.message || (err as Error)?.message || "Failed to delete product";
            toast.error("Failed to delete product: " + msg);
        }
    };

    const handleOpenBufferModal = async () => {
        setShowBufferModal(true);
        try {
            const configs = await loadChannelBufferConfigs();
            setBufferConfigs(configs);
        } catch {
            setBufferConfigs(DEFAULT_CHANNEL_CONFIGS);
        }
    };

    const handleSaveBufferConfigs = async () => {
        setBufferSaving(true);
        try {
            await saveChannelBufferConfigs(bufferConfigs);
            toast.success("Omnichannel safety buffers updated");
            setShowBufferModal(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed saving safety buffers");
        } finally {
            setBufferSaving(false);
        }
    };

    const filteredProducts = products.filter(product => {
        const matchesCategory = selectedCategory === "All" || product.category === selectedCategory || product.categoryId === selectedCategory;
        const matchesLocation = selectedLocation === "All" || (product.location || "Showcase Tray A") === selectedLocation;
        const matchesStatus =
            statusFilter === "all" ||
            (statusFilter === "draft"
                ? product.is_active === false
                : statusFilter === "dead_stock"
                ? isDeadStockProduct(product)
                : product.is_active !== false);
        const q = scanQuery.trim().toLowerCase();
        const matchesSearch = !q || product.name.toLowerCase().includes(q) || product.sku.toLowerCase().includes(q);
        return matchesCategory && matchesLocation && matchesStatus && matchesSearch;
    });

    const publishedCount = products.filter((product) => product.is_active !== false).length;
    const draftCount = products.length - publishedCount;
    const deadStockCount = products.filter((product) => isDeadStockProduct(product)).length;

    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / INVENTORY_PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const paginatedProducts = filteredProducts.slice(
        (currentPage - 1) * INVENTORY_PAGE_SIZE,
        currentPage * INVENTORY_PAGE_SIZE
    );

    useEffect(() => {
        setPage(1);
    }, [selectedCategory, selectedLocation, statusFilter, scanQuery]);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Inventory"
                subtitle={`${publishedCount} published • ${draftCount} drafts • ${products.reduce((acc, p) => acc + p.stock, 0)} units`}
                action={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setShowCycleCountModal(true)}
                            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold border-surface-hover/70 bg-surface-navy/70 text-moonstone hover:text-white hover:bg-surface-hover/40"
                            title="Barcode cycle count & tray reconciliation station"
                        >
                            <ScanBarcode size={15} className="text-cyan-400" />
                            Tray Audit
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setShowReplenishmentModal(true)}
                            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold border-surface-hover/70 bg-surface-navy/70 text-moonstone hover:text-white hover:bg-surface-hover/40"
                            title="Smart Replenishment Queue & Supplier PO Generator"
                        >
                            <ShoppingBag size={15} className="text-amber-400" />
                            Replenish
                        </Button>
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
                                              : statusFilter === "dead_stock"
                                                ? "Dead Stock (90d+)"
                                                : "Drafts"}
                                    </span>
                                    <ChevronDown size={14} />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-48">
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
                                    <DropdownMenuItem onClick={() => setStatusFilter("dead_stock")}>
                                        <span className="flex-1 text-rose-300">Dead Stock (90d+)</span>
                                        <span className="text-[10px] text-rose-300">{deadStockCount}</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <button
                                type="button"
                                onClick={() => setStatusFilter(statusFilter === "dead_stock" ? "all" : "dead_stock")}
                                className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                                    statusFilter === "dead_stock"
                                        ? "bg-rose-500 text-white border-rose-500 shadow-sm"
                                        : deadStockCount > 0
                                        ? "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
                                        : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/40"
                                }`}
                                title="Filter in-stock items unchanged for 90+ days"
                            >
                                <AlertTriangle size={13} />
                                <span>90d+ Dead Stock ({deadStockCount})</span>
                            </button>

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
                                    <DropdownMenuGroup>
                                    <DropdownMenuLabel>Operations</DropdownMenuLabel>
                                    <DropdownMenuItem onClick={() => setShowQuickReceiveModal(true)}>
                                        <Truck size={14} />
                                        <span className="flex-1">Receive from PO</span>
                                        {openPOCount > 0 && (
                                            <span className="text-[10px] text-moonstone">{openPOCount}</span>
                                        )}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setShowCycleCountModal(true)}>
                                        <ScanBarcode size={14} className="text-cyan-400" />
                                        <span className="flex-1">Tray cycle count</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setShowReplenishmentModal(true)}>
                                        <ShoppingBag size={14} className="text-amber-400" />
                                        <span className="flex-1">Replenishment queue</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setShowTransferModal(true)}>
                                        <ArrowRightLeft size={14} />
                                        Transfer stock
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void handleOpenBufferModal()}>
                                        <ShieldCheck size={14} className="text-emerald-400" />
                                        Omnichannel safety buffers
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
                                    </DropdownMenuGroup>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuGroup>
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
                                    </DropdownMenuGroup>
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
                        <>
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
                                paginatedProducts.map((product) => {
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

                                        {/* Touch-friendly 3-dot quick actions menu (for mobile / tablet without hover) */}
                                        <div className="absolute top-2 right-2 z-20">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger
                                                    type="button"
                                                    aria-label={`Actions for ${product.name}`}
                                                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-surface-hover/80 bg-bg-navy/90 text-moonstone shadow hover:border-primary/60 hover:text-white transition-colors"
                                                >
                                                    <MoreVertical size={14} />
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-52 bg-surface-navy border-surface-hover text-white">
                                                    <DropdownMenuLabel className="text-[11px] text-moonstone truncate">{product.name}</DropdownMenuLabel>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => openEditProduct(product)}>
                                                        <Edit size={14} className="mr-2 text-primary" /> Edit & Variants
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => {
                                                        setCloneSeed(product);
                                                        setShowQuickAdd(true);
                                                    }}>
                                                        <Copy size={14} className="mr-2" /> Clone Piece
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => {
                                                        setBroadcastProductsList([product]);
                                                        setShowBroadcastModal(true);
                                                    }}>
                                                        <Share2 size={14} className="mr-2 text-emerald-400" /> WhatsApp Broadcast
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => {
                                                        setSelectedDiscrepancyProduct({
                                                            id: product.id,
                                                            name: product.name,
                                                            sku: product.sku,
                                                            stock: product.stock,
                                                        });
                                                        setShowDiscrepancyModal(true);
                                                    }}>
                                                        <AlertTriangle size={14} className="mr-2 text-amber-400" /> Flag Discrepancy
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => {
                                                        setSelectedPOProduct(product);
                                                        setShowPOHistoryModal(true);
                                                    }}>
                                                        <Truck size={14} className="mr-2 text-indigo-400" /> PO History
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => {
                                                        setSelectedLedgerProduct(product);
                                                        setShowLedgerModal(true);
                                                    }}>
                                                        <History size={14} className="mr-2 text-cyan-400" /> Stock Ledger
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => void handleArchiveToggle(product)}>
                                                        {product.is_active === false ? (
                                                            <>
                                                                <RotateCcw size={14} className="mr-2 text-emerald-400" /> Restore to Catalog
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Archive size={14} className="mr-2 text-amber-300" /> Archive as Draft
                                                            </>
                                                        )}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => handleDeleteProduct(product.id)}
                                                        className="text-red-400 focus:text-red-300"
                                                    >
                                                        <Trash2 size={14} className="mr-2" /> Delete Permanently
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
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
                                                <button
                                                    onClick={() => {
                                                        setSelectedLedgerProduct(product);
                                                        setShowLedgerModal(true);
                                                    }}
                                                    title="Stock Ledger Audit Trail (Movements & History)"
                                                    className="bg-cyan-600 hover:bg-cyan-500 text-white p-2 rounded-lg hover:scale-110 transition-transform font-bold"
                                                >
                                                    <History size={18} />
                                                </button>
                                                <button onClick={() => openEditProduct(product)} className="bg-primary text-primary-foreground p-2 rounded-lg hover:scale-110" title="Edit product & variants"><Edit size={18} /></button>
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
                                                <button
                                                    type="button"
                                                    onClick={() => void handleArchiveToggle(product)}
                                                    className="bg-amber-600/90 text-white p-2 rounded-lg hover:scale-110"
                                                    title={product.is_active === false ? "Restore to live catalog" : "Archive as draft"}
                                                >
                                                    {product.is_active === false ? <RotateCcw size={16} /> : <Archive size={16} />}
                                                </button>
                                                <button onClick={() => handleDeleteProduct(product.id)} className="bg-red-500 text-white p-2 rounded-lg hover:scale-110" title="Delete product"><Trash2 size={18} /></button>
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
                                                    {product.is_bundle && (
                                                        <span className="shrink-0 rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-purple-300">
                                                            Bundle ({product.bundle_items?.length || 0})
                                                        </span>
                                                    )}
                                                    {isDeadStockProduct(product) && (
                                                        <span className="shrink-0 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-300">
                                                            90d+ Slow Mover
                                                        </span>
                                                    )}
                                                    {Object.keys(product.gallery_angles || {}).length > 1 && (
                                                        <span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-300">
                                                            {Object.keys(product.gallery_angles || {}).length} Angles
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
                        {filteredProducts.length > INVENTORY_PAGE_SIZE && (
                            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-hover/70 bg-surface-navy/70 px-4 py-3 text-xs text-moonstone">
                                <span className="tabular-nums">
                                    Showing {(currentPage - 1) * INVENTORY_PAGE_SIZE + 1}–{Math.min(currentPage * INVENTORY_PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length} products
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={currentPage <= 1}
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        className="h-8 border-surface-hover text-xs"
                                    >
                                        Prev
                                    </Button>
                                    <span className="tabular-nums font-semibold text-white">
                                        Page {currentPage} / {totalPages}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={currentPage >= totalPages}
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        className="h-8 border-surface-hover text-xs"
                                    >
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                        </>
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

                                {/* Multi-Angle Gallery Slots (HERO / MACR / REVR / SCAL) */}
                                <div className="grid grid-cols-4 gap-2 pt-1">
                                    {(["HERO", "MACR", "REVR", "SCAL"] as ProductAngleSlot[]).map((slot) => {
                                        const slotImg = newProduct.gallery_angles?.[slot];
                                        const labels: Record<ProductAngleSlot, string> = {
                                            HERO: "Hero",
                                            MACR: "Macro",
                                            REVR: "Reverse",
                                            SCAL: "Scale",
                                        };
                                        return (
                                            <div
                                                key={slot}
                                                className="rounded-lg border border-surface-hover/70 bg-bg-navy/50 p-1.5 flex flex-col items-center gap-1"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setProductShotType(slot);
                                                        setShowPhotoModal(true);
                                                    }}
                                                    className="w-full aspect-square rounded border border-dashed border-surface-hover hover:border-primary/60 overflow-hidden flex items-center justify-center bg-black/30"
                                                    title={`Upload/capture ${labels[slot]} (${slot}) angle`}
                                                >
                                                    {slotImg ? (
                                                        // eslint-disable-next-line @next/next/no-img-element -- preview data URL
                                                        <img src={slotImg} alt={slot} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Camera size={14} className="text-moonstone/60" />
                                                    )}
                                                </button>
                                                <div className="w-full flex items-center justify-between text-[9px] px-0.5">
                                                    <span className="font-mono text-moonstone">{slot}</span>
                                                    {slotImg && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setNewProduct((prev) => {
                                                                    const nextAngles = mergeProductAngle(prev.gallery_angles, slot, "");
                                                                    return {
                                                                        ...prev,
                                                                        gallery_angles: nextAngles,
                                                                        image_url:
                                                                            nextAngles.HERO ||
                                                                            nextAngles.MACR ||
                                                                            nextAngles.REVR ||
                                                                            nextAngles.SCAL ||
                                                                            "",
                                                                    };
                                                                });
                                                            }}
                                                            className="text-rose-400 hover:text-rose-300"
                                                            title={`Clear ${slot}`}
                                                        >
                                                            ×
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
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

                            {/* Virtual Bundle / Combo Kit Composer */}
                            <BundleComposerSection
                                isBundle={newProduct.is_bundle}
                                onIsBundleChange={(val: boolean) => setNewProduct(prev => ({ ...prev, is_bundle: val }))}
                                bundleItems={newProduct.bundle_items}
                                onBundleItemsChange={(items: BundleComponent[]) => setNewProduct(prev => ({ ...prev, bundle_items: items }))}
                                availableProducts={products}
                            />

                            {/* Stock & Storage Location */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Stock Level</Label>
                                    <Input
                                        type="number"
                                        value={newProduct.stock}
                                        disabled={isEditMode && editingVariants.length > 1}
                                        onChange={e => setNewProduct({ ...newProduct, stock: e.target.value })}
                                        placeholder="10"
                                        className="bg-bg-navy border-surface-hover text-sm h-9 font-mono mt-1 disabled:opacity-60"
                                    />
                                    {isEditMode && editingVariants.length > 1 && (
                                        <p className="mt-1 text-[10px] text-moonstone">Managed per variant below</p>
                                    )}
                                </div>
                                <div>
                                    <Label className="flex items-center gap-1.5 text-xs"><MapPin size={13} className="text-gold" /> Storage Location</Label>
                                    <Select value={newProduct.location || trayOptions[0]?.code || "Showcase Tray A"} onValueChange={v => setNewProduct({ ...newProduct, location: v || trayOptions[0]?.code || "Showcase Tray A" })}>
                                        <SelectTrigger className="bg-bg-navy border-surface-hover text-sm h-9 mt-1"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {trayChoices(trayOptions, newProduct.location).map((opt) => (
                                                <SelectItem key={opt.code} value={opt.code}>{trayChoiceLabel(opt)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {isEditMode && editingVariants.length > 0 && (
                                <div className="rounded-lg border border-surface-hover/80 bg-bg-navy/50 p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-semibold text-white">Variant Stock &amp; Price Adjustment</Label>
                                        <span className="text-[10px] text-moonstone">{editingVariants.length} variant{editingVariants.length === 1 ? "" : "s"}</span>
                                    </div>
                                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                                        {editingVariants.map((variant, idx) => (
                                            <div key={variant.id} className="grid grid-cols-12 items-center gap-2 text-xs">
                                                <span className="col-span-5 truncate font-mono text-white" title={variant.variant_name}>
                                                    {variant.variant_name}
                                                </span>
                                                <div className="col-span-3">
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        aria-label={`Stock for ${variant.variant_name}`}
                                                        value={variant.stock_level}
                                                        onChange={(e) => {
                                                            const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                                            setEditingVariants((prev) =>
                                                                prev.map((row, i) => (i === idx ? { ...row, stock_level: val } : row))
                                                            );
                                                        }}
                                                        className="h-8 bg-bg-navy border-surface-hover font-mono text-xs tabular-nums"
                                                    />
                                                </div>
                                                <div className="col-span-4">
                                                    <Input
                                                        type="number"
                                                        step="1"
                                                        aria-label={`Price adjustment for ${variant.variant_name}`}
                                                        placeholder="₹ Adj"
                                                        value={variant.price_adjustment}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value) || 0;
                                                            setEditingVariants((prev) =>
                                                                prev.map((row, i) => (i === idx ? { ...row, price_adjustment: val } : row))
                                                            );
                                                        }}
                                                        className="h-8 bg-bg-navy border-surface-hover font-mono text-xs tabular-nums"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

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

            {/* Sticky Bottom Action Bar for Bulk Labels, Tray Moves, Price Updates & Broadcast */}
            <InventoryBulkActionBar
                selectedIds={selectedProductIds}
                products={products}
                onClearSelection={() => setSelectedProductIds([])}
                onRefresh={fetchProducts}
                onOpenBroadcast={() => {
                    const list = products.filter(p => selectedProductIds.includes(p.id));
                    setBroadcastProductsList(list);
                    setShowBroadcastModal(true);
                }}
            />

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
                    setNewProduct(prev => {
                        const nextAngles = mergeProductAngle(prev.gallery_angles, shotType, imageData);
                        return {
                            ...prev,
                            gallery_angles: nextAngles,
                            image_url: nextAngles.HERO || imageData,
                        };
                    });
                    setProductShotType(shotType);
                    setShowPhotoModal(false);
                    toast.success(`Photo tagged as [${shotType}] shot successfully!`);
                }}
            />

            {/* Omnichannel Safety Buffer Configuration Modal */}
            <Dialog open={showBufferModal} onOpenChange={setShowBufferModal}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                            Omnichannel Safety Stock Buffers
                        </DialogTitle>
                        <DialogDescription className="text-moonstone">
                            Reserve safety units for in-store POS and WhatsApp before exposing inventory to external online storefronts.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2 max-h-[55vh] overflow-y-auto">
                        {bufferConfigs.map((cfg) => (
                            <div
                                key={cfg.channel}
                                className="flex items-center justify-between gap-3 rounded-lg border border-surface-hover bg-bg-navy/50 p-3"
                            >
                                <div>
                                    <div className="text-sm font-semibold text-white uppercase tracking-wide">
                                        {cfg.channel}
                                    </div>
                                    <div className="text-[11px] text-moonstone">
                                        Priority #{cfg.priorityOrder}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5">
                                        <Label className="text-xs text-moonstone whitespace-nowrap">Buffer</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            value={cfg.safetyBuffer}
                                            onChange={(e) => {
                                                const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                                setBufferConfigs((prev) =>
                                                    prev.map((c) =>
                                                        c.channel === cfg.channel ? { ...c, safetyBuffer: val } : c
                                                    )
                                                );
                                            }}
                                            className="w-16 h-8 bg-surface-navy border-surface-hover text-white text-xs text-center font-mono"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setBufferConfigs((prev) =>
                                                prev.map((c) =>
                                                    c.channel === cfg.channel ? { ...c, isFrozen: !c.isFrozen } : c
                                                )
                                            )
                                        }
                                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                                            cfg.isFrozen
                                                ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                        }`}
                                    >
                                        {cfg.isFrozen ? "Frozen" : "Live"}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowBufferModal(false)}
                            className="border-surface-hover text-moonstone"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={bufferSaving}
                            onClick={() => void handleSaveBufferConfigs()}
                        >
                            {bufferSaving ? "Saving..." : "Save Buffers"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

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

            {/* Chronological SKU Stock Ledger Audit Modal */}
            <ProductStockLedgerModal
                open={showLedgerModal}
                onOpenChange={setShowLedgerModal}
                product={selectedLedgerProduct}
            />

            {/* Tray / Location Barcode Cycle Count Audit Station */}
            <TrayCycleCountModal
                open={showCycleCountModal}
                onOpenChange={setShowCycleCountModal}
                products={products}
                onAuditCompleted={fetchProducts}
            />

            {/* Smart Replenishment Queue & Supplier PO Generator */}
            <SmartReplenishmentModal
                open={showReplenishmentModal}
                onOpenChange={setShowReplenishmentModal}
            />

            {/* Delete Product Confirmation */}
            <AlertDialog open={Boolean(pendingDeleteId)} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
                <AlertDialogContent className="bg-surface-navy border-surface-hover text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Product Permanently?</AlertDialogTitle>
                        <AlertDialogDescription className="text-moonstone">
                            This action cannot be undone. Products with sales or invoice history are protected and should be archived instead.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-bg-navy border-surface-hover text-white">Keep Product</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                const targetId = pendingDeleteId;
                                setPendingDeleteId(null);
                                if (targetId) void executeDeleteProduct(targetId);
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            Delete Permanently
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Demo Cleanup Confirmation */}
            <AlertDialog open={Boolean(pendingDemoCleanup)} onOpenChange={(open) => { if (!open) setPendingDemoCleanup(null); }}>
                <AlertDialogContent className="bg-surface-navy border-surface-hover text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Sample Demo Products?</AlertDialogTitle>
                        <AlertDialogDescription className="text-moonstone">
                            Your first real piece ({pendingDemoCleanup?.createdName}) is in. Remove the {pendingDemoCleanup?.demoIds.length || 0} demo products and their stock variants from inventory?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-bg-navy border-surface-hover text-white">Keep Samples</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => void confirmDemoCleanup()}
                            className="bg-primary text-primary-foreground"
                        >
                            Remove Demo Products
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
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
