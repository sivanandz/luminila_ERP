"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
    X,
    RefreshCw,
    Search,
    Loader2,
    Store,
    ShoppingBag,
    CheckCircle2,
    AlertTriangle,
    Link2,
    Unlink,
    Trash2,
    ExternalLink,
    Eye,
    EyeOff,
    Save,
    Plus,
    ArrowRight,
    Zap,
    Box,
    Sparkles,
    Check,
    Layers,
    Tag,
    DollarSign,
    Info,
    HelpCircle,
    ArrowUpRight,
    Image as ImageIcon
} from "lucide-react";
import { toast } from "sonner";
import { getCurrentTenantEmail } from "@/lib/pocketbase";
import {
    getWhatsAppCatalogInventory,
    linkWhatsAppCatalogItem,
    markWhatsAppCatalogSynced,
    setWhatsAppCatalogPrice,
    unlinkWhatsAppCatalogItem,
} from "@/lib/whatsapp-catalog";
import { Product, ProductVariant } from "@/types/database";
import { getChannelPrice } from "@/lib/channel-pricing";
import { resolveProductCatalogImage } from "@/lib/whatsapp-catalog";
import {
    getCatalogProducts,
    createCatalogProduct,
    editCatalogProduct,
    deleteCatalogProduct,
    getCatalogCollections,
    createCatalogCollection,
    deleteCatalogCollection,
    setCatalogCartEnabled,
    addCatalogProductImage,
    type WPPCollection,
    CatalogProduct
} from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export interface WhatsAppCatalogEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    sessionId?: string;
}

export interface CatalogItemWithInventory {
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    imageUrl: string;
    url: string;
    isHidden: boolean;
    retailerId?: string;
    reviewStatus?: string;
    availability?: string;
    // Matched PocketBase Product
    linkedProduct?: Product & { whatsapp_catalog_id?: string; whatsapp_last_synced?: string };
    inventoryPrice?: number;
    isPriceMismatch?: boolean;
    priceDifference?: number;
    totalStock?: number;
}

function normalizePrice(val: any): number {
    if (val === undefined || val === null) return 0;
    const num = Number(val);
    if (isNaN(num)) return 0;
    // Meta Catalog micro-units (e.g. 1500000 = 1500 INR)
    if (num >= 100000 && num % 1000 === 0) {
        return num / 1000;
    }
    return num;
}

export function WhatsAppCatalogEditorModal({
    isOpen,
    onClose,
    sessionId = "luminila"
}: WhatsAppCatalogEditorModalProps) {
    // Data states
    const [loading, setLoading] = useState(false);
    const [rawCatalog, setRawCatalog] = useState<CatalogProduct[]>([]);
    const [inventoryProducts, setInventoryProducts] = useState<(Product & { whatsapp_catalog_id?: string; whatsapp_last_synced?: string })[]>([]);
    const [stockMap, setStockMap] = useState<Record<string, number>>({});

    // Selection & Editing states
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"catalog" | "publish_new">("catalog");
    const [filterTab, setFilterTab] = useState<"all" | "mismatch" | "synced" | "unlinked" | "hidden">("all");
    const [searchQuery, setSearchQuery] = useState("");

    // Form states for currently selected product
    const [editForm, setEditForm] = useState({
        name: "",
        price: 0,
        description: "",
        url: "",
        isHidden: false,
    });
    const [syncInventoryPriceToPB, setSyncInventoryPriceToPB] = useState(false);
    const [saving, setSaving] = useState(false);
    const [bulkSyncing, setBulkSyncing] = useState(false);
    const [linkingProductId, setLinkingProductId] = useState<string>("");
    const [isLinking, setIsLinking] = useState(false);

    // Cart + collections surface (WhatsApp Business catalog features that were
    // previously unreachable from the app)
    const [cartEnabled, setCartEnabled] = useState<boolean | null>(null);
    const [collections, setCollections] = useState<WPPCollection[]>([]);
    const [showCollections, setShowCollections] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState("");
    const [collectionsBusy, setCollectionsBusy] = useState(false);
    const [addingImage, setAddingImage] = useState(false);

    const loadCollections = useCallback(async () => {
        setCollectionsBusy(true);
        try {
            setCollections(await getCatalogCollections(sessionId));
        } finally {
            setCollectionsBusy(false);
        }
    }, [sessionId]);

    useEffect(() => {
        if (isOpen) void loadCollections();
    }, [isOpen, loadCollections]);

    // Initial fetch when opened
    useEffect(() => {
        if (isOpen) {
            loadCatalogAndInventory();
        }
    }, [isOpen, sessionId]);

    const loadCatalogAndInventory = async () => {
        setLoading(true);
        try {
            const tenantEmail = getCurrentTenantEmail();

            // 1. Fetch live catalog from WPPConnect + tenant-scoped inventory
            const [waProducts, inventory] = await Promise.all([
                getCatalogProducts(sessionId).catch((err) => {
                    console.error("Failed to fetch WhatsApp catalog products:", err);
                    return [] as CatalogProduct[];
                }),
                getWhatsAppCatalogInventory(tenantEmail || undefined),
            ]);
            const rawPbProducts = inventory.products as unknown as Array<Product & { whatsapp_catalog_id?: string; whatsapp_last_synced?: string; account_email?: string; image_data?: string }>;
            const rawPbVariants = inventory.variants as unknown as Array<ProductVariant & { account_email?: string }>;

            // Layer 2 in-memory tenant ownership guard
            const pbProducts = tenantEmail
                ? rawPbProducts.filter((p) => !p.account_email || p.account_email.toLowerCase() === tenantEmail.toLowerCase())
                : rawPbProducts;
            const pbVariants = tenantEmail
                ? rawPbVariants.filter((v) => !v.account_email || v.account_email.toLowerCase() === tenantEmail.toLowerCase())
                : rawPbVariants;

            // Build stock map for quick stock lookup per product
            const stocks: Record<string, number> = {};
            for (const v of pbVariants) {
                if (v.product) {
                    stocks[v.product] = (stocks[v.product] || 0) + (v.stock_level || 0);
                }
            }

            setRawCatalog(waProducts);
            setInventoryProducts(pbProducts);
            setStockMap(stocks);

            // Select first product if none selected
            if (waProducts.length > 0 && !selectedId) {
                const firstId = typeof waProducts[0].id === "object" ? (waProducts[0].id as any)?._serialized : String(waProducts[0].id);
                setSelectedId(firstId);
            }
        } catch (err) {
            toast.error("Failed to load catalog or inventory: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setLoading(false);
        }
    };

    // Combine WhatsApp Catalog items with linked PocketBase records
    const catalogItems: CatalogItemWithInventory[] = useMemo(() => {
        return rawCatalog.map((item) => {
            const rawId = typeof item.id === "object" ? (item.id as any)?._serialized : String(item.id);
            const waPrice = normalizePrice(item.price);
            const retailerId = (item as any).retailerId || (item as any).retailer_id;
            const reviewStatus = (item as any).reviewStatus || (item as any).review_status;
            const imageUrl = item.imageUrl || (item as any).imageCdnUrl || (item as any).image || ((item as any).images?.[0]?.mediaUrl) || "";

            // Match against inventory
            // 1. By stored whatsapp_catalog_id
            let matched = inventoryProducts.find((p) => p.whatsapp_catalog_id === rawId);
            // 2. By SKU match with retailerId
            if (!matched && retailerId) {
                matched = inventoryProducts.find((p) => p.sku && p.sku.toLowerCase() === retailerId.toLowerCase());
            }
            // 3. By SKU in name or description
            if (!matched) {
                matched = inventoryProducts.find((p) => p.sku && (item.name?.includes(p.sku) || item.description?.includes(p.sku)));
            }

            const invPrice = matched ? getChannelPrice(matched, "whatsapp") : undefined;
            const isPriceMismatch = matched !== undefined && Math.abs(waPrice - (invPrice || 0)) >= 1;
            const priceDifference = matched !== undefined && invPrice !== undefined ? waPrice - invPrice : 0;
            const totalStock = matched ? (stockMap[matched.id] ?? 0) : undefined;

            return {
                id: rawId,
                name: item.name || "Untitled Product",
                description: item.description || "",
                price: waPrice,
                currency: item.currency || "INR",
                imageUrl,
                url: item.url || "",
                isHidden: !!item.isHidden,
                retailerId,
                reviewStatus,
                availability: (item as any).availability,
                linkedProduct: matched,
                inventoryPrice: invPrice,
                isPriceMismatch,
                priceDifference,
                totalStock,
            };
        });
    }, [rawCatalog, inventoryProducts, stockMap]);

    // Currently selected item
    const selectedItem = useMemo(() => {
        return catalogItems.find((c) => c.id === selectedId) || null;
    }, [catalogItems, selectedId]);

    // Sync form state when selection changes
    useEffect(() => {
        if (selectedItem) {
            setEditForm({
                name: selectedItem.name,
                price: selectedItem.price,
                description: selectedItem.description,
                url: selectedItem.url,
                isHidden: selectedItem.isHidden,
            });
            setLinkingProductId(selectedItem.linkedProduct?.id || "");
        }
    }, [selectedItem]);

    // KPIs & Metrics
    const metrics = useMemo(() => {
        const total = catalogItems.length;
        const synced = catalogItems.filter((i) => !!i.linkedProduct).length;
        const mismatches = catalogItems.filter((i) => i.isPriceMismatch).length;
        const unlinked = catalogItems.filter((i) => !i.linkedProduct).length;
        const hidden = catalogItems.filter((i) => i.isHidden).length;
        return { total, synced, mismatches, unlinked, hidden };
    }, [catalogItems]);

    // Unsynced PocketBase inventory products available for publishing
    const publishableInventory = useMemo(() => {
        const publishedIds = new Set(catalogItems.map((c) => c.linkedProduct?.id).filter(Boolean));
        return inventoryProducts.filter((p) => !publishedIds.has(p.id) && !p.whatsapp_catalog_id);
    }, [inventoryProducts, catalogItems]);

    // Filtered list based on search and tab
    const filteredCatalog = useMemo(() => {
        return catalogItems.filter((item) => {
            const matchesQuery =
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.retailerId && item.retailerId.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (item.linkedProduct?.sku && item.linkedProduct.sku.toLowerCase().includes(searchQuery.toLowerCase())) ||
                item.id.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesQuery) return false;

            if (filterTab === "mismatch") return item.isPriceMismatch;
            if (filterTab === "synced") return !!item.linkedProduct;
            if (filterTab === "unlinked") return !item.linkedProduct;
            if (filterTab === "hidden") return item.isHidden;
            return true;
        });
    }, [catalogItems, searchQuery, filterTab]);

    // Save changes to WhatsApp
    const handleSaveProduct = async () => {
        if (!selectedItem) return;
        setSaving(true);
        try {
            const res = await editCatalogProduct(sessionId, selectedItem.id, {
                name: editForm.name,
                price: Number(editForm.price),
                description: editForm.description,
                url: editForm.url,
                isHidden: editForm.isHidden,
            });

            if (!res.success) {
                throw new Error(res.error || "WPPConnect editProduct call failed");
            }

            // If user checked "Also update PocketBase price", update PB record
            if (syncInventoryPriceToPB && selectedItem.linkedProduct) {
                await setWhatsAppCatalogPrice(selectedItem.linkedProduct.id, Number(editForm.price));
            }

            toast.success(`Catalog product "${editForm.name}" updated successfully!`);
            await loadCatalogAndInventory();
        } catch (err) {
            toast.error("Failed to save changes: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setSaving(false);
        }
    };

    // Push Inventory price directly to WhatsApp
    const handlePushInventoryPrice = async (item: CatalogItemWithInventory) => {
        if (!item.inventoryPrice || !item.linkedProduct) {
            toast.error("Product has no linked inventory price");
            return;
        }

        try {
            toast.loading(`Syncing price (₹${item.inventoryPrice.toLocaleString("en-IN")}) to WhatsApp...`, { id: "sync-price" });
            const res = await editCatalogProduct(sessionId, item.id, {
                price: item.inventoryPrice,
            });

            if (!res.success) {
                throw new Error(res.error || "Failed to update price on WhatsApp");
            }

            // Touch last synced timestamp in PocketBase
            await markWhatsAppCatalogSynced(item.linkedProduct.id);

            toast.success(`Updated ${item.name} to ₹${item.inventoryPrice.toLocaleString("en-IN")}`, { id: "sync-price" });
            await loadCatalogAndInventory();
        } catch (err) {
            toast.error("Price sync failed: " + (err instanceof Error ? err.message : String(err)), { id: "sync-price" });
        }
    };

    // Bulk sync all mismatched prices from Inventory to WhatsApp
    const handleBulkSyncMismatches = async () => {
        const mismatches = catalogItems.filter((i) => i.isPriceMismatch && i.inventoryPrice !== undefined);
        if (mismatches.length === 0) {
            toast.info("All catalog prices are already in sync with inventory!");
            return;
        }

        setBulkSyncing(true);
        let updatedCount = 0;
        let failCount = 0;

        try {
            for (const item of mismatches) {
                try {
                    const res = await editCatalogProduct(sessionId, item.id, {
                        price: item.inventoryPrice,
                    });
                    if (res.success) {
                        updatedCount++;
                        if (item.linkedProduct) {
                            await markWhatsAppCatalogSynced(item.linkedProduct.id);
                        }
                    } else {
                        failCount++;
                    }
                } catch {
                    failCount++;
                }
                // Human-paced randomized delay (2.8s - 5.8s) to prevent WhatsApp bot detection
                const jitterDelay = Math.round(2800 + ((Math.random() + Math.random()) / 2) * 3000);
                await new Promise((r) => setTimeout(r, jitterDelay));
            }

            toast.success(`Sync complete! ${updatedCount} prices aligned with inventory.${failCount > 0 ? ` (${failCount} failed)` : ""}`);
            await loadCatalogAndInventory();
        } catch (err) {
            toast.error("Bulk sync error: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setBulkSyncing(false);
        }
    };

    // Link this WhatsApp item to a PocketBase product
    const handleLinkProduct = async () => {
        if (!selectedItem || !linkingProductId) return;
        setIsLinking(true);
        try {
            await linkWhatsAppCatalogItem(linkingProductId, selectedItem.id);
            toast.success("Successfully linked to inventory product!");
            await loadCatalogAndInventory();
        } catch (err) {
            toast.error("Failed to link product: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsLinking(false);
        }
    };

    // Unlink from PocketBase product
    const handleUnlinkProduct = async () => {
        if (!selectedItem?.linkedProduct) return;
        setIsLinking(true);
        try {
            await unlinkWhatsAppCatalogItem(selectedItem.linkedProduct.id);
            toast.success("Product unlinked from inventory!");
            await loadCatalogAndInventory();
        } catch (err) {
            toast.error("Failed to unlink: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsLinking(false);
        }
    };

    // Delete item from WhatsApp catalog
    const handleDeleteProduct = async (item: CatalogItemWithInventory) => {
        if (!confirm(`Are you sure you want to permanently delete "${item.name}" from WhatsApp Catalog?`)) {
            return;
        }

        try {
            toast.loading(`Deleting ${item.name} from WhatsApp...`, { id: "delete-prod" });
            const success = await deleteCatalogProduct(sessionId, item.id);
            if (!success) {
                throw new Error("WPPConnect deleteProduct failed");
            }

            // Clear whatsapp_catalog_id on PB product if matched
            if (item.linkedProduct) {
                await unlinkWhatsAppCatalogItem(item.linkedProduct.id);
            }

            toast.success(`Deleted ${item.name} from WhatsApp Catalog`, { id: "delete-prod" });
            if (selectedId === item.id) setSelectedId(null);
            await loadCatalogAndInventory();
        } catch (err) {
            toast.error("Failed to delete product: " + (err instanceof Error ? err.message : String(err)), { id: "delete-prod" });
        }
    };

    // Publish an inventory product to WhatsApp Catalog
    const handlePublishInventoryItem = async (pbProduct: Product & { image_data?: string }) => {
        try {
            const targetPrice = getChannelPrice(pbProduct, "whatsapp");
            const resolvedImage = resolveProductCatalogImage(pbProduct);
            toast.loading(`Publishing ${pbProduct.name} to WhatsApp Catalog...`, { id: "pub-item" });

            const res = await createCatalogProduct(sessionId, {
                name: pbProduct.name,
                description: `${pbProduct.description || pbProduct.category || "Jewelry"}\n\nSKU: ${pbProduct.sku}\nAuthentic Craftsmanship by Luminila Jewels`,
                price: targetPrice,
                currency: "INR",
                retailerId: pbProduct.sku,
                image: resolvedImage,
                url: `https://luminila.com/product/${pbProduct.sku}`,
                isHidden: !pbProduct.is_active,
            });

            if (!res.success || !res.productId) {
                throw new Error(res.error || "WhatsApp catalog creation did not return a valid product ID");
            }

            // Save new catalog ID to PocketBase
            await linkWhatsAppCatalogItem(pbProduct.id, res.productId);

            toast.success(`Published ${pbProduct.name} to WhatsApp Catalog!`, { id: "pub-item" });
            setSelectedId(res.productId);
            setActiveTab("catalog");
            await loadCatalogAndInventory();
        } catch (err) {
            toast.error("Publish failed: " + (err instanceof Error ? err.message : String(err)), { id: "pub-item" });
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-background/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="w-full max-w-6xl h-[92vh] flex flex-col bg-card border border-border shadow-2xl rounded-2xl overflow-hidden">
                {/* Header Strip */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
                            <ShoppingBag className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-foreground tracking-tight">WhatsApp Catalog & Inventory Sync</h2>
                                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-semibold px-2">
                                    Meta Live Sync
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Real-time catalog editing, inventory SKU linking, and channel pricing synchronization
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {metrics.mismatches > 0 && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleBulkSyncMismatches}
                                disabled={bulkSyncing || loading}
                                className="h-8 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 gap-1.5 font-semibold text-xs"
                            >
                                {bulkSyncing ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Zap className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                                )}
                                Sync All Prices ({metrics.mismatches})
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant={activeTab === "publish_new" ? "default" : "outline"}
                            onClick={() => setActiveTab(activeTab === "publish_new" ? "catalog" : "publish_new")}
                            className="h-8 gap-1.5 text-xs font-semibold"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {activeTab === "publish_new" ? "Back to Catalog" : "Publish from Inventory"}
                        </Button>

                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={loadCatalogAndInventory}
                            disabled={loading}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="Refresh Catalog & Inventory"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                        </Button>

                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={onClose}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-full"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Cart & Collections strip */}
                <div className="flex flex-wrap items-center gap-3 px-6 py-2 border-b border-border bg-muted/20 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer select-none font-semibold text-muted-foreground">
                        <Switch
                            checked={cartEnabled === true}
                            onCheckedChange={async (checked) => {
                                const prev = cartEnabled;
                                setCartEnabled(checked);
                                const ok = await setCatalogCartEnabled(sessionId, checked);
                                if (ok) {
                                    toast.success(checked ? "WhatsApp cart enabled" : "WhatsApp cart disabled");
                                } else {
                                    setCartEnabled(prev);
                                    toast.error("Could not toggle the WhatsApp cart");
                                }
                            }}
                        />
                        Shopping cart on catalog
                    </label>
                    <div className="h-4 w-px bg-border" />
                    <button
                        onClick={() => setShowCollections(prev => !prev)}
                        className="font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Collections {collections.length > 0 ? `(${collections.length})` : ""}
                    </button>
                </div>

                {showCollections && (
                    <div className="px-6 py-3 border-b border-border bg-card space-y-2">
                        <div className="flex gap-2">
                            <Input
                                value={newCollectionName}
                                onChange={e => setNewCollectionName(e.target.value)}
                                placeholder="New collection name…"
                                className="h-8 text-xs flex-1"
                            />
                            <Button
                                size="sm"
                                className="h-8 text-xs"
                                disabled={collectionsBusy || !newCollectionName.trim()}
                                onClick={async () => {
                                    setCollectionsBusy(true);
                                    try {
                                        // Start with the visible catalog items so the
                                        // collection is immediately useful
                                        const ids = catalogItems.slice(0, 20).map(i => i.id);
                                        const ok = await createCatalogCollection(sessionId, newCollectionName.trim(), ids);
                                        if (ok) {
                                            toast.success(`Collection "${newCollectionName.trim()}" created`);
                                            setNewCollectionName("");
                                            await loadCollections();
                                        } else {
                                            toast.error("Could not create the collection");
                                        }
                                    } finally {
                                        setCollectionsBusy(false);
                                    }
                                }}
                            >
                                Create
                            </Button>
                        </div>
                        {collections.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                {collectionsBusy ? "Loading…" : "No collections yet — group catalog items into collections customers can browse."}
                            </p>
                        ) : (
                            <ul className="space-y-1">
                                {collections.map(c => {
                                    const cid = typeof c.id === "string" ? c.id : c.id?.id || c.id?._serialized || String(c.id ?? "");
                                    return (
                                        <li key={cid} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50">
                                            <span className="flex-1 truncate text-xs font-medium">{c.name || cid}</span>
                                            <span className="text-[10px] text-muted-foreground">
                                                {Array.isArray(c.products) ? `${c.products.length} items` : ""}
                                            </span>
                                            <button
                                                onClick={async () => {
                                                    if (!window.confirm(`Delete collection "${c.name || cid}"?`)) return;
                                                    const ok = await deleteCatalogCollection(sessionId, cid);
                                                    if (ok) {
                                                        toast.success("Collection deleted");
                                                        await loadCollections();
                                                    } else {
                                                        toast.error("Delete failed");
                                                    }
                                                }}
                                                className="text-muted-foreground hover:text-red-500 p-1"
                                                title="Delete collection"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}

                {/* KPI Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-border divide-x divide-border bg-card text-xs">
                    <div className="p-3 text-center">
                        <span className="text-muted-foreground block text-[11px]">Total WhatsApp Items</span>
                        <span className="text-base font-bold text-foreground">{metrics.total}</span>
                    </div>
                    <div className="p-3 text-center">
                        <span className="text-muted-foreground block text-[11px]">Linked to Inventory</span>
                        <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">{metrics.synced}</span>
                    </div>
                    <div className="p-3 text-center">
                        <span className="text-muted-foreground block text-[11px]">Price Mismatches</span>
                        <span className={`text-base font-bold ${metrics.mismatches > 0 ? "text-amber-500" : "text-foreground"}`}>
                            {metrics.mismatches}
                        </span>
                    </div>
                    <div className="p-3 text-center">
                        <span className="text-muted-foreground block text-[11px]">Unlinked (WA Only)</span>
                        <span className="text-base font-bold text-slate-500">{metrics.unlinked}</span>
                    </div>
                    <div className="p-3 text-center">
                        <span className="text-muted-foreground block text-[11px]">Hidden from Catalog</span>
                        <span className="text-base font-bold text-muted-foreground">{metrics.hidden}</span>
                    </div>
                </div>

                {/* Body Content */}
                {activeTab === "publish_new" ? (
                    /* Tab: Publish New Inventory Items to WhatsApp */
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-emerald-500" /> Publish Inventory Products to WhatsApp Catalog
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    Select products from your PocketBase jewelry inventory to generate live WhatsApp Business catalog listings.
                                </p>
                            </div>
                            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-primary/10 text-primary">
                                {publishableInventory.length} Available to Publish
                            </span>
                        </div>

                        <div className="border border-border rounded-xl overflow-hidden bg-card divide-y divide-border">
                            {publishableInventory.length === 0 ? (
                                <div className="p-12 text-center text-muted-foreground">
                                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
                                    <p className="font-semibold text-sm">All Inventory Products Are Published</p>
                                    <p className="text-xs mt-1">Every active product in your inventory is already synchronized to WhatsApp.</p>
                                </div>
                            ) : (
                                publishableInventory.map((p) => {
                                    const channelPrice = getChannelPrice(p, "whatsapp");
                                    const stock = stockMap[p.id] ?? 0;
                                    return (
                                        <div key={p.id} className="p-4 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {p.image_url ? (
                                                    <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded-lg object-cover border border-border" />
                                                ) : (
                                                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                                                        <Box className="w-6 h-6" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-sm text-foreground truncate">{p.name}</span>
                                                        <Badge variant="outline" className="text-[10px] font-mono">{p.sku}</Badge>
                                                        {p.category && <Badge variant="secondary" className="text-[10px]">{p.category}</Badge>}
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                                                        <span>Base: ₹{p.base_price?.toLocaleString("en-IN")}</span>
                                                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                                            WhatsApp Channel Price: ₹{channelPrice.toLocaleString("en-IN")}
                                                        </span>
                                                        <span>Stock: {stock} units</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <Button
                                                size="sm"
                                                onClick={() => handlePublishInventoryItem(p)}
                                                className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shrink-0"
                                            >
                                                <Store className="w-3.5 h-3.5" /> Publish to Catalog
                                            </Button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    /* Main Tab: Two-Panel Master Detail Catalog Editor */
                    <div className="flex-1 flex overflow-hidden">
                        {/* Left Column: Product Navigator (38%) */}
                        <div className="w-[38%] border-r border-border flex flex-col bg-muted/10">
                            {/* Search & Filter Controls */}
                            <div className="p-3 border-b border-border space-y-2">
                                <div className="relative">
                                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by name, SKU, or ID..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="h-8 pl-8 text-xs bg-background"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery("")}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>

                                <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
                                    <button
                                        onClick={() => setFilterTab("all")}
                                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${filterTab === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                                    >
                                        All ({catalogItems.length})
                                    </button>
                                    <button
                                        onClick={() => setFilterTab("mismatch")}
                                        className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1 ${filterTab === "mismatch" ? "bg-amber-500 text-white" : "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"}`}
                                    >
                                        Mismatches ({metrics.mismatches})
                                    </button>
                                    <button
                                        onClick={() => setFilterTab("synced")}
                                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${filterTab === "synced" ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
                                    >
                                        Synced ({metrics.synced})
                                    </button>
                                    <button
                                        onClick={() => setFilterTab("unlinked")}
                                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${filterTab === "unlinked" ? "bg-slate-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
                                    >
                                        Unlinked ({metrics.unlinked})
                                    </button>
                                    <button
                                        onClick={() => setFilterTab("hidden")}
                                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${filterTab === "hidden" ? "bg-muted-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                                    >
                                        Hidden ({metrics.hidden})
                                    </button>
                                </div>
                            </div>

                            {/* Product List */}
                            <div className="flex-1 overflow-y-auto divide-y divide-border">
                                {loading ? (
                                    <div className="p-8 text-center text-muted-foreground">
                                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                                        <p className="text-xs">Loading WhatsApp Catalog...</p>
                                    </div>
                                ) : filteredCatalog.length === 0 ? (
                                    <div className="p-8 text-center text-muted-foreground text-xs">
                                        No products matched the active filters.
                                    </div>
                                ) : (
                                    filteredCatalog.map((item) => {
                                        const isSelected = selectedId === item.id;
                                        return (
                                            <div
                                                key={item.id}
                                                onClick={() => setSelectedId(item.id)}
                                                className={`p-3 cursor-pointer transition-all flex items-start gap-3 ${isSelected ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted/40"}`}
                                            >
                                                {/* Thumbnail */}
                                                <div className="w-12 h-12 rounded-lg bg-muted border border-border shrink-0 overflow-hidden relative">
                                                    {item.imageUrl ? (
                                                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                            <ShoppingBag className="w-5 h-5 opacity-40" />
                                                        </div>
                                                    )}
                                                    {item.isHidden && (
                                                        <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center">
                                                            <EyeOff className="w-4 h-4 text-muted-foreground" />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Meta Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-1">
                                                        <h4 className="text-xs font-bold text-foreground truncate">{item.name}</h4>
                                                        {item.isPriceMismatch ? (
                                                            <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[9px] px-1.5 py-0 h-4 font-mono shrink-0">
                                                                Diff: {item.priceDifference && item.priceDifference > 0 ? "+" : ""}₹{item.priceDifference?.toLocaleString("en-IN")}
                                                            </Badge>
                                                        ) : item.linkedProduct ? (
                                                            <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-[9px] px-1.5 py-0 h-4 shrink-0">
                                                                Synced
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground shrink-0">
                                                                Unlinked
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center justify-between mt-1 text-[11px]">
                                                        <span className="font-bold text-foreground">
                                                            ₹{item.price.toLocaleString("en-IN")}
                                                        </span>
                                                        {item.linkedProduct ? (
                                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                                SKU: {item.linkedProduct.sku}
                                                            </span>
                                                        ) : item.retailerId ? (
                                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                                {item.retailerId}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] text-muted-foreground italic">No SKU</span>
                                                        )}
                                                    </div>

                                                    {/* Price comparison helper */}
                                                    {item.linkedProduct && item.inventoryPrice !== undefined && (
                                                        <div className="mt-1 flex items-center justify-between text-[10px]">
                                                            <span className="text-muted-foreground">
                                                                Inv: ₹{item.inventoryPrice.toLocaleString("en-IN")}
                                                            </span>
                                                            {item.isPriceMismatch && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handlePushInventoryPrice(item);
                                                                    }}
                                                                    className="text-amber-600 dark:text-amber-400 font-bold hover:underline flex items-center gap-0.5"
                                                                >
                                                                    <Zap className="w-2.5 h-2.5 fill-current" /> Push Inv Price
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Right Column: Product Inspector & Live Editor (62%) */}
                        <div className="flex-1 flex flex-col bg-card overflow-y-auto">
                            {selectedItem ? (
                                <div className="p-6 space-y-6">
                                    {/* Inspector Header */}
                                    <div className="flex items-start justify-between gap-4 pb-4 border-b border-border">
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-16 rounded-xl bg-muted border border-border overflow-hidden relative shrink-0">
                                                {selectedItem.imageUrl ? (
                                                    <img src={selectedItem.imageUrl} alt={selectedItem.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                        <Store className="w-8 h-8 opacity-40" />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-base font-bold text-foreground">{selectedItem.name}</h3>
                                                    {selectedItem.isHidden ? (
                                                        <Badge variant="secondary" className="text-[10px] bg-muted-foreground/10 text-muted-foreground">
                                                            Hidden
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                                                            Active in Catalog
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                                                    WhatsApp Product ID: {selectedItem.id}
                                                </p>
                                                {selectedItem.reviewStatus && (
                                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                                        Meta Review Status: <span className="font-semibold text-foreground">{selectedItem.reviewStatus}</span>
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {selectedItem.url && (
                                                <a
                                                    href={selectedItem.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                                                    title="Open External URL"
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                </a>
                                            )}
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => handleDeleteProduct(selectedItem)}
                                                className="h-8 gap-1 text-xs"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" /> Delete
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Inventory Link & Live Price Comparison Banner */}
                                    <div className={`p-4 rounded-xl border ${selectedItem.linkedProduct ? (selectedItem.isPriceMismatch ? "bg-amber-500/5 border-amber-500/30" : "bg-emerald-500/5 border-emerald-500/30") : "bg-muted/30 border-border"} space-y-3`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Box className={`w-4 h-4 ${selectedItem.linkedProduct ? (selectedItem.isPriceMismatch ? "text-amber-500" : "text-emerald-500") : "text-muted-foreground"}`} />
                                                <span className="font-bold text-xs text-foreground">PocketBase Inventory Linkage</span>
                                            </div>
                                            {selectedItem.linkedProduct && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={handleUnlinkProduct}
                                                    disabled={isLinking}
                                                    className="h-6 text-[10px] text-muted-foreground hover:text-destructive gap-1 px-2"
                                                >
                                                    <Unlink className="w-3 h-3" /> Unlink SKU
                                                </Button>
                                            )}
                                        </div>

                                        {selectedItem.linkedProduct ? (
                                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs bg-background/50 p-3 rounded-lg border border-border/50">
                                                <div>
                                                    <span className="text-[10px] text-muted-foreground block">Linked SKU</span>
                                                    <span className="font-bold font-mono text-foreground">{selectedItem.linkedProduct.sku}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-muted-foreground block">Base Retail Price</span>
                                                    <span className="font-semibold text-foreground">₹{selectedItem.linkedProduct.base_price?.toLocaleString("en-IN")}</span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-muted-foreground block">WhatsApp Channel Price</span>
                                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                                        ₹{selectedItem.inventoryPrice?.toLocaleString("en-IN")}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-muted-foreground block">Variant Stock</span>
                                                    <span className="font-semibold text-foreground">{selectedItem.totalStock ?? 0} units</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                <p className="text-xs text-muted-foreground">
                                                    This WhatsApp catalog item is not yet mapped to any PocketBase inventory SKU. Select a product to link:
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={linkingProductId}
                                                        onChange={(e) => setLinkingProductId(e.target.value)}
                                                        className="flex-1 h-8 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                                    >
                                                        <option value="">-- Select an inventory product --</option>
                                                        {inventoryProducts.map((p) => (
                                                            <option key={p.id} value={p.id}>
                                                                {p.name} ({p.sku}) - ₹{getChannelPrice(p, "whatsapp")}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <Button
                                                        size="sm"
                                                        onClick={handleLinkProduct}
                                                        disabled={!linkingProductId || isLinking}
                                                        className="h-8 gap-1 text-xs font-semibold"
                                                    >
                                                        <Link2 className="w-3.5 h-3.5" /> Link SKU
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Price Difference Quick Resolution Bar */}
                                        {selectedItem.isPriceMismatch && selectedItem.inventoryPrice !== undefined && (
                                            <div className="flex items-center justify-between pt-2 border-t border-amber-500/20 text-xs">
                                                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                                    <span>
                                                        Price discrepancy: Catalog has <b>₹{selectedItem.price.toLocaleString("en-IN")}</b> but Inventory specifies <b>₹{selectedItem.inventoryPrice.toLocaleString("en-IN")}</b>
                                                    </span>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handlePushInventoryPrice(selectedItem)}
                                                    className="h-7 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-xs font-bold gap-1"
                                                >
                                                    <Zap className="w-3 h-3 fill-current" /> Set WA to ₹{selectedItem.inventoryPrice.toLocaleString("en-IN")}
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Direct WhatsApp Catalog Editing Form */}
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                            Edit Catalog Attributes
                                        </h4>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-semibold text-foreground">Product Title</label>
                                                <Input
                                                    value={editForm.name}
                                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                                    placeholder="e.g. Royal Emerald Choker Necklace"
                                                    className="h-9 text-xs"
                                                />
                                            </div>

                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-xs font-semibold text-foreground">Catalog Price (INR)</label>
                                                    {selectedItem.inventoryPrice !== undefined && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditForm({ ...editForm, price: selectedItem.inventoryPrice! })}
                                                            className="text-[10px] text-primary hover:underline font-semibold"
                                                        >
                                                            Use Inv Price (₹{selectedItem.inventoryPrice.toLocaleString("en-IN")})
                                                        </button>
                                                    )}
                                                </div>
                                                <Input
                                                    type="number"
                                                    value={editForm.price}
                                                    onChange={(e) => setEditForm({ ...editForm, price: Number(e.target.value) })}
                                                    placeholder="1500"
                                                    className="h-9 text-xs font-semibold"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-xs font-semibold text-foreground">Retailer / E-Commerce URL</label>
                                            <Input
                                                value={editForm.url}
                                                onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                                                placeholder="https://luminila.com/product/LUM-NK-001"
                                                className="h-9 text-xs font-mono"
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <label className="text-xs font-semibold text-foreground">Catalog Description</label>
                                                <span className="text-[10px] text-muted-foreground">{editForm.description.length} chars</span>
                                            </div>
                                            <Textarea
                                                rows={4}
                                                value={editForm.description}
                                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                                placeholder="Enter detailed description, craft specifications, purity karat, and SKU details..."
                                                className="text-xs resize-none"
                                            />
                                        </div>

                                        {/* Catalog Visibility Toggle */}
                                        <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
                                            <div className="space-y-0.5">
                                                <label className="text-xs font-bold text-foreground">Visibility in WhatsApp Catalog</label>
                                                <p className="text-[11px] text-muted-foreground">
                                                    When hidden, the item is not visible to customers browsing your WhatsApp Business profile.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={!editForm.isHidden}
                                                onCheckedChange={(checked) => setEditForm({ ...editForm, isHidden: !checked })}
                                            />
                                        </div>

                                        {/* Extra product images (WhatsApp supports several per item) */}
                                        <div className="flex items-center gap-2 p-3 rounded-xl border border-dashed border-border">
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                id="wa-extra-image"
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    e.target.value = "";
                                                    if (!file || !selectedItem) return;
                                                    setAddingImage(true);
                                                    try {
                                                        const dataUrl = await new Promise<string>((resolve, reject) => {
                                                            const reader = new FileReader();
                                                            reader.onload = () => resolve(reader.result as string);
                                                            reader.onerror = () => reject(new Error("read failed"));
                                                            reader.readAsDataURL(file);
                                                        });
                                                        const ok = await addCatalogProductImage(sessionId, selectedItem.id, dataUrl);
                                                        if (ok) toast.success(`Extra image added to "${selectedItem.name}"`);
                                                        else toast.error("WhatsApp rejected the extra image");
                                                    } catch {
                                                        toast.error("Could not read the image file");
                                                    } finally {
                                                        setAddingImage(false);
                                                    }
                                                }}
                                            />
                                            <label
                                                htmlFor="wa-extra-image"
                                                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                                            >
                                                {addingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                                                Add extra product image
                                            </label>
                                            <span className="text-[10px] text-muted-foreground flex-1 truncate">
                                                Extra gallery images appear alongside the main photo on WhatsApp
                                            </span>
                                        </div>

                                        {/* Option: Two-way sync price to PocketBase */}
                                        {selectedItem.linkedProduct && (
                                            <div className="flex items-center gap-2 p-3 rounded-xl border border-border bg-primary/5">
                                                <input
                                                    type="checkbox"
                                                    id="syncPB"
                                                    checked={syncInventoryPriceToPB}
                                                    onChange={(e) => setSyncInventoryPriceToPB(e.target.checked)}
                                                    className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                                                />
                                                <label htmlFor="syncPB" className="text-xs text-foreground cursor-pointer select-none">
                                                    Also update WhatsApp channel price in <b>PocketBase Inventory</b> to ₹{editForm.price.toLocaleString("en-IN")}
                                                </label>
                                            </div>
                                        )}

                                        {/* Action buttons */}
                                        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setEditForm({
                                                        name: selectedItem.name,
                                                        price: selectedItem.price,
                                                        description: selectedItem.description,
                                                        url: selectedItem.url,
                                                        isHidden: selectedItem.isHidden,
                                                    });
                                                }}
                                                className="h-9 text-xs"
                                            >
                                                Reset Changes
                                            </Button>

                                            <Button
                                                size="sm"
                                                onClick={handleSaveProduct}
                                                disabled={saving}
                                                className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                                            >
                                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                Save to WhatsApp Catalog
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                                    <ShoppingBag className="w-12 h-12 stroke-[1.2] opacity-30 mb-3" />
                                    <h3 className="font-bold text-sm text-foreground">Select a Product to Inspect</h3>
                                    <p className="text-xs max-w-sm mt-1">
                                        Choose a WhatsApp catalog item from the left panel to edit its details, check price discrepancies, or link to inventory.
                                    </p>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setActiveTab("publish_new")}
                                        className="mt-4 h-8 gap-1.5 text-xs font-semibold"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> Publish New Inventory Item
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
