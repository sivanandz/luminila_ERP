"use client";

import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    AlertTriangle,
    ShieldAlert,

    Truck,
    PackageCheck,
    CheckCircle2,
    Clock,
    Filter,
    ScanBarcode,
} from "lucide-react";
import { QuickBarcodeScanModal, type ScannedItemPayload } from "@/components/common/QuickBarcodeScanModal";
import { MobileScanner } from "@/lib/mobile-scanner";
import { toast } from "sonner";
import {
    markStockDiscrepancy,
    resolveStockDiscrepancy,
    getStockDiscrepancies,
    type StockDiscrepancy,
    type DiscrepancyType,
    type ResolutionAction,
} from "@/lib/discrepancies";
import { pb } from "@/lib/pocketbase";

interface DiscrepancyModalProps {
    isOpen: boolean;
    onClose: () => void;
    preselectedProduct?: {
        id: string;
        name: string;
        sku: string;
        stock: number;
        variant_id?: string;
    } | null;
    onStockUpdated: () => void;
}

/** vendors record as returned by PocketBase (company_name kept as legacy fallback) */
interface VendorRecord {
    id: string;
    name: string;
    company_name?: string;
}

export function DiscrepancyModal({
    isOpen,
    onClose,
    preselectedProduct,
    onStockUpdated,
}: DiscrepancyModalProps) {
    const [activeTab, setActiveTab] = useState<"flag" | "active_list">("flag");
    const [discrepancies, setDiscrepancies] = useState<StockDiscrepancy[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [typeFilter, setTypeFilter] = useState<string>("all");

    // Form State for Flagging
    const [sku, setSku] = useState("");
    const [productName, setProductName] = useState("");
    const [productId, setProductId] = useState("");
    const [variantId, setVariantId] = useState("");
    const [currentAvailableStock, setCurrentAvailableStock] = useState(0);
    const [discrepancyType, setDiscrepancyType] = useState<DiscrepancyType>("damaged");
    const [quantity, setQuantity] = useState<string>("1");
    const [vendorName, setVendorName] = useState("");
    const [reason, setReason] = useState("");
    const [notes, setNotes] = useState("");
    const [submittingFlag, setSubmittingFlag] = useState(false);

    // Resolve Dialog State
    const [resolvingItem, setResolvingItem] = useState<StockDiscrepancy | null>(null);
    const [resolveQty, setResolveQty] = useState<string>("1");
    const [resolveAction, setResolveAction] = useState<ResolutionAction>("replacement_received");
    const [resolveNote, setResolveNote] = useState("");
    const [submittingResolve, setSubmittingResolve] = useState(false);

    // Vendors list
    const [vendorList, setVendorList] = useState<{ id: string; name: string }[]>([]);
    const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

    const handleScannedItem = (payload: ScannedItemPayload) => {
        if (payload.product) {
            setSku(payload.product.sku);
            setProductName(payload.product.name);
            setProductId(payload.product.id);
            if (payload.variant?.id) {
                setVariantId(payload.variant.id);
            }
            setCurrentAvailableStock(payload.product.stock ?? 0);
            toast.success(`Scanned: ${payload.product.name}`);
        } else {
            toast.error(`Barcode "${payload.barcode}" not found in catalog`);
        }
    };

    // High-priority scanner listener: intercepts physical tray jewelry tags while modal is open
    useEffect(() => {
        if (!isOpen) return;
        const unregister = MobileScanner.registerContext("discrepancy_audit", async (result) => {
            try {
                const prod = await pb.collection("products").getFirstListItem(`sku="${result.barcode}" || barcode="${result.barcode}"`);
                if (prod) {
                    const variants = await pb.collection("product_variants").getList(1, 1, {
                        filter: `product="${prod.id}"`,
                        sort: "-stock_level"
                    });
                    const v = variants.items[0];
                    handleScannedItem({
                        barcode: result.barcode,
                        product: {
                            id: prod.id,
                            name: prod.name,
                            sku: prod.sku,
                            base_price: prod.base_price,
                            stock: v?.stock_level ?? 0
                        },
                        variant: v ? {
                            id: v.id,
                            size: v.size,
                            color: v.color,
                        } : undefined
                    });
                } else {
                    toast.error(`Barcode "${result.barcode}" not found in catalog`);
                }
            } catch {
                toast.error(`Barcode "${result.barcode}" not found in catalog`);
            }
            return true; // Stop propagation
        }, 85);
        return () => unregister();
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            loadDiscrepancies();
            loadVendors();
            if (preselectedProduct) {
                setSku(preselectedProduct.sku);
                setProductName(preselectedProduct.name);
                setProductId(preselectedProduct.id);
                setCurrentAvailableStock(preselectedProduct.stock);
                setActiveTab("flag");

                // Resolve the variant that will actually be deducted and sync the
                // displayed max to its own stock_level — preselectedProduct.stock may
                // be a product-wide aggregate the server never validates against.
                const syncVariant = (req: Promise<{ id: string; stock_level?: number }>) => {
                    req.then((v) => {
                        setVariantId(v.id);
                        if (typeof v.stock_level === "number") {
                            setCurrentAvailableStock(v.stock_level);
                        }
                    }).catch(() => {});
                };
                if (preselectedProduct.variant_id) {
                    syncVariant(
                        pb.collection("product_variants").getOne(preselectedProduct.variant_id)
                    );
                } else {
                    syncVariant(
                        pb.collection("product_variants").getFirstListItem(
                            `product="${preselectedProduct.id}"`,
                            { sort: "-stock_level" }
                        )
                    );
                }
            } else {
                setActiveTab("active_list");
            }
        }
    }, [isOpen, preselectedProduct]);

    const loadDiscrepancies = async () => {
        setLoadingList(true);
        try {
            const list = await getStockDiscrepancies("active");
            setDiscrepancies(list);
        } catch (err) {
            console.error("Failed to load discrepancies:", err);
        } finally {
            setLoadingList(false);
        }
    };

    const loadVendors = async () => {
        try {
            const records = await pb.collection("vendors").getFullList<VendorRecord>({ sort: "name" }).catch(() => []);
            setVendorList(records.map((r) => ({ id: r.id, name: r.name || r.company_name || "" })));
        } catch {
            setVendorList([]);
        }
    };

    const handleFlagSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const numQty = parseInt(quantity, 10);
        if (!numQty || numQty <= 0) {
            toast.error("Please enter a valid quantity (at least 1)");
            return;
        }

        if (numQty > currentAvailableStock) {
            toast.error(`Cannot flag ${numQty} units. Only ${currentAvailableStock} units available.`);
            return;
        }

        if (!variantId) {
            toast.error("Variant record not resolved for this product.");
            return;
        }

        setSubmittingFlag(true);
        try {
            await markStockDiscrepancy({
                product_id: productId,
                variant_id: variantId,
                sku,
                product_name: productName,
                discrepancy_type: discrepancyType,
                quantity: numQty,
                vendor_name: vendorName || undefined,
                reason,
                notes,
            });

            const typeLabel =
                discrepancyType === "damaged"
                    ? "Damaged"
                    : discrepancyType === "missing"
                    ? "Missing"
                    : "Returned to Vendor for Replacement";

            toast.success(
                `Flagged ${numQty} unit(s) of ${sku} as ${typeLabel}. Available stock reduced.`
            );

            // Reset & reload
            setQuantity("1");
            setReason("");
            setNotes("");
            setCurrentAvailableStock((prev) => Math.max(0, prev - numQty));
            onStockUpdated();
            loadDiscrepancies();
            setActiveTab("active_list");
        } catch (err) {
            console.error("Failed to flag discrepancy:", err);
            toast.error((err instanceof Error ? err.message : String(err)) || "Failed to mark discrepancy");
        } finally {
            setSubmittingFlag(false);
        }
    };

    const openResolveModal = (item: StockDiscrepancy) => {
        setResolvingItem(item);
        setResolveQty(String(item.quantity));
        setResolveAction(
            item.discrepancy_type === "vendor_replacement"
                ? "replacement_received"
                : "repaired"
        );
        setResolveNote("");
    };

    const handleResolveSubmit = async () => {
        if (!resolvingItem) return;
        const numQty = parseInt(resolveQty, 10);
        if (!numQty || numQty <= 0) {
            toast.error("Please enter a valid quantity (at least 1)");
            return;
        }

        setSubmittingResolve(true);
        try {
            await resolveStockDiscrepancy(resolvingItem.id, {
                action: resolveAction,
                received_quantity: numQty,
                resolution_note: resolveNote,
            });

            if (resolveAction === "replacement_received" || resolveAction === "repaired") {
                toast.success(
                    `Restored ${numQty} unit(s) of ${resolvingItem.sku} to active sellable inventory!`
                );
            } else {
                toast.info(`Flag for ${resolvingItem.sku} closed as written-off.`);
            }

            setResolvingItem(null);
            onStockUpdated();
            loadDiscrepancies();
        } catch (err) {
            console.error("Resolve error:", err);
            toast.error((err instanceof Error ? err.message : String(err)) || "Failed to resolve discrepancy");
        } finally {
            setSubmittingResolve(false);
        }
    };

    const filteredDiscrepancies = discrepancies.filter((d) => {
        if (typeFilter === "all") return true;
        return d.discrepancy_type === typeFilter;
    });

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white text-slate-900">
                {/* Header */}
                <DialogHeader className="p-6 border-b border-slate-200 bg-slate-50/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ShieldAlert className="w-5 h-5 text-amber-600" />
                            <DialogTitle className="text-xl font-bold tracking-tight">
                                Stock Discrepancy & Quarantine Center
                            </DialogTitle>
                        </div>
                        <Badge variant="outline" className="font-mono text-xs border-amber-300 bg-amber-50 text-amber-800">
                            {discrepancies.length} Active Flag(s)
                        </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                        Quarantine damaged or missing units, or track items returned to vendors for replacement.
                        Once replacements arrive, resolve the flag to automatically restore sellable stock.
                    </p>

                    {/* Navigation Tabs */}
                    <div className="flex gap-2 mt-4">
                        <button
                            type="button"
                            onClick={() => setActiveTab("flag")}
                            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                                activeTab === "flag"
                                    ? "bg-slate-900 text-white shadow-sm"
                                    : "bg-slate-200/80 text-slate-700 hover:bg-slate-300"
                            }`}
                        >
                            + Flag Stock Discrepancy
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setActiveTab("active_list");
                                loadDiscrepancies();
                            }}
                            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                                activeTab === "active_list"
                                    ? "bg-slate-900 text-white shadow-sm"
                                    : "bg-slate-200/80 text-slate-700 hover:bg-slate-300"
                            }`}
                        >
                            <span>Active Quarantine & Vendor Queue</span>
                            {discrepancies.length > 0 && (
                                <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">
                                    {discrepancies.length}
                                </span>
                            )}
                        </button>
                    </div>
                </DialogHeader>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === "flag" ? (
                        <form onSubmit={handleFlagSubmit} className="space-y-4">
                            {/* Product Info Banner */}
                            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <p className="text-xs font-mono font-bold text-amber-900">{sku || "NO SKU SELECTED"}</p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setShowBarcodeScanner(true)}
                                            className="h-6 px-2 text-[10px] border-amber-300 bg-amber-100 hover:bg-amber-200 text-amber-900 flex items-center gap-1 font-semibold"
                                        >
                                            <ScanBarcode className="w-3 h-3" />
                                            <span>Scan Barcode Tag</span>
                                        </Button>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900">{productName || "Please select product or scan tag"}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[11px] text-slate-500">Available Sellable Stock</p>
                                    <p className="text-base font-black text-slate-900">{currentAvailableStock} units</p>
                                </div>
                            </div>

                            {/* Discrepancy Classification */}
                            <div className="space-y-2">
                                <Label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                                    Discrepancy Category
                                </Label>
                                <div className="grid grid-cols-3 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setDiscrepancyType("damaged")}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            discrepancyType === "damaged"
                                                ? "border-rose-500 bg-rose-50/50 text-rose-900 ring-2 ring-rose-500/20"
                                                : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 font-bold text-xs">
                                            <AlertTriangle className="w-4 h-4 text-rose-600" />
                                            <span>Damaged</span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-1">
                                            Broken stone, loose prongs, defective clasp
                                        </p>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setDiscrepancyType("missing")}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            discrepancyType === "missing"
                                                ? "border-amber-500 bg-amber-50/50 text-amber-900 ring-2 ring-amber-500/20"
                                                : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 font-bold text-xs">
                                            <ShieldAlert className="w-4 h-4 text-amber-600" />
                                            <span>Missing / Loss</span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-1">
                                            Audit shortage, tray mismatch, transit loss
                                        </p>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setDiscrepancyType("vendor_replacement")}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            discrepancyType === "vendor_replacement"
                                                ? "border-indigo-500 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-500/20"
                                                : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 font-bold text-xs">
                                            <Truck className="w-4 h-4 text-indigo-600" />
                                            <span>At Vendor for Replace</span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-1">
                                            Dispatched to artisan/supplier for replacement
                                        </p>
                                    </button>
                                </div>
                            </div>

                            {/* Quantity & Vendor Row */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Quantity to Quarantine</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        max={currentAvailableStock}
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        className="h-10 text-base font-bold font-mono"
                                        required
                                    />
                                    <p className="text-[10px] text-slate-400">
                                        Max available to deduct: {currentAvailableStock}
                                    </p>
                                </div>

                                {discrepancyType === "vendor_replacement" ? (
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Assigned Vendor / Supplier</Label>
                                        <div className="flex gap-2">
                                            <select
                                                value={vendorName}
                                                onChange={(e) => setVendorName(e.target.value)}
                                                className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
                                            >
                                                <option value="">Select Vendor...</option>
                                                {vendorList.map((v) => (
                                                    <option key={v.id} value={v.name}>
                                                        {v.name}
                                                    </option>
                                                ))}
                                                <option value="Rajkot Heritage Jewellers">Rajkot Heritage Jewellers</option>
                                                <option value="Surat Kemp Studio">Surat Kemp Studio</option>
                                                <option value="Jaipur Polki Workshop">Jaipur Polki Workshop</option>
                                            </select>
                                        </div>
                                        <p className="text-[10px] text-slate-400">
                                            Vendor responsible for sending replacement lot
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        <Label className="text-xs font-semibold">Specific Cause / Reason</Label>
                                        <Input
                                            placeholder="e.g. Broken lock clasp / Missing in tray audit"
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            className="h-10 text-xs"
                                        />
                                        <p className="text-[10px] text-slate-400">Brief summary for audit trail</p>
                                    </div>
                                )}
                            </div>

                            {/* Detailed Notes */}
                            <div className="space-y-1">
                                <Label className="text-xs font-semibold">Notes & Audit Remarks</Label>
                                <Textarea
                                    rows={2}
                                    placeholder="Enter details: inspection findings, courier tracking # if dispatched to vendor, locker tray location..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    className="text-xs resize-none"
                                />
                            </div>

                            <div className="pt-3 border-t flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={onClose} className="text-xs">
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={submittingFlag || !sku}
                                    className="bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs gap-1.5 shadow-sm"
                                >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    <span>Quarantine & Deduct Stock</span>
                                </Button>
                            </div>
                        </form>
                    ) : (
                        /* Active List & Replacement Resolution Tab */
                        <div className="space-y-4">
                            {/* Filter bar */}
                            <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs">
                                <div className="flex items-center gap-1.5 text-slate-500">
                                    <Filter className="w-3.5 h-3.5" />
                                    <span>Filter:</span>
                                    {["all", "damaged", "missing", "vendor_replacement"].map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTypeFilter(t)}
                                            className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                                                typeFilter === t
                                                    ? "bg-slate-900 text-white"
                                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                            }`}
                                        >
                                            {t === "vendor_replacement" ? "At Vendor" : t}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-slate-400 text-[11px]">
                                    Showing {filteredDiscrepancies.length} record(s)
                                </span>
                            </div>

                            {loadingList ? (
                                <div className="py-12 text-center text-xs text-slate-400">
                                    Loading quarantine ledger...
                                </div>
                            ) : filteredDiscrepancies.length === 0 ? (
                                <div className="py-12 text-center">
                                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                                    <p className="text-sm font-semibold text-slate-700">All Clear • No Active Discrepancies</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        No items currently damaged, missing, or awaiting vendor replacement.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredDiscrepancies.map((item) => (
                                        <div
                                            key={item.id}
                                            className="p-3 border border-slate-200 rounded-lg bg-white shadow-sm flex items-center justify-between hover:border-slate-300 transition-colors"
                                        >
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs font-bold text-slate-900">
                                                        {item.sku}
                                                    </span>
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[10px] font-bold uppercase tracking-wider ${
                                                            item.discrepancy_type === "damaged"
                                                                ? "border-rose-300 bg-rose-50 text-rose-700"
                                                                : item.discrepancy_type === "missing"
                                                                ? "border-amber-300 bg-amber-50 text-amber-700"
                                                                : "border-indigo-300 bg-indigo-50 text-indigo-700"
                                                        }`}
                                                    >
                                                        {item.discrepancy_type === "vendor_replacement"
                                                            ? "At Vendor for Replace"
                                                            : item.discrepancy_type}
                                                    </Badge>
                                                    <span className="text-xs font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                                                        {item.quantity} unit(s) quarantined
                                                    </span>
                                                </div>

                                                <p className="text-xs font-medium text-slate-800">{item.product_name}</p>

                                                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                                                    {item.vendor_name && (
                                                        <span className="flex items-center gap-1 font-medium text-indigo-700">
                                                            <Truck className="w-3 h-3" />
                                                            Vendor: {item.vendor_name}
                                                        </span>
                                                    )}
                                                    {item.reason && <span>Reason: {item.reason}</span>}
                                                    {item.created && (
                                                        <span className="flex items-center gap-1">
                                                            <Clock className="w-3 h-3" />
                                                            {new Date(item.created).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Action Button */}
                                            <Button
                                                onClick={() => openResolveModal(item)}
                                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold gap-1.5 shadow-sm"
                                            >
                                                <PackageCheck className="w-3.5 h-3.5" />
                                                <span>Replacement Arrived / Resolve</span>
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>

            {/* Resolution Sub-Dialog */}
            {resolvingItem && (
                <Dialog open={!!resolvingItem} onOpenChange={() => setResolvingItem(null)}>
                    <DialogContent className="max-w-md bg-white text-slate-900">
                        <DialogHeader>
                            <DialogTitle className="text-base font-bold flex items-center gap-2 text-emerald-800">
                                <PackageCheck className="w-5 h-5 text-emerald-600" />
                                Confirm Replacement & Restore Inventory
                            </DialogTitle>
                            <p className="text-xs text-slate-500">
                                Disabling flag for <span className="font-mono font-bold text-slate-800">{resolvingItem.sku}</span>.
                                Stock will automatically be restored to sellable inventory.
                            </p>
                        </DialogHeader>

                        <div className="space-y-4 my-2 text-xs">
                            <div className="p-2.5 bg-slate-50 border rounded space-y-1">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Initial Flagged Category:</span>
                                    <span className="font-bold uppercase text-slate-800">{resolvingItem.discrepancy_type}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Total Quarantined Quantity:</span>
                                    <span className="font-bold text-rose-600">{resolvingItem.quantity} units</span>
                                </div>
                                {resolvingItem.vendor_name && (
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Originating Vendor:</span>
                                        <span className="font-semibold text-indigo-700">{resolvingItem.vendor_name}</span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs font-semibold">Resolution Action</Label>
                                <select
                                    value={resolveAction}
                                    onChange={(e) => setResolveAction(e.target.value as ResolutionAction)}
                                    className="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
                                >
                                    <option value="replacement_received">
                                        📦 Replacement Arrived from Vendor (Restore to Stock)
                                    </option>
                                    <option value="repaired">
                                        🛠️ In-House / Artisan Repaired (Restore to Stock)
                                    </option>
                                    <option value="written_off">
                                        ❌ Write Off Permanently (Do Not Restore Stock)
                                    </option>
                                </select>
                            </div>

                            {(resolveAction === "replacement_received" || resolveAction === "repaired") && (
                                <div className="space-y-1">
                                    <Label className="text-xs font-semibold">Quantity Received / Restored</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        max={resolvingItem.quantity}
                                        value={resolveQty}
                                        onChange={(e) => setResolveQty(e.target.value)}
                                        className="h-9 font-bold font-mono"
                                    />
                                    <p className="text-[10px] text-slate-400">
                                        {resolveQty} unit(s) will be immediately added back to active inventory stock.
                                    </p>
                                </div>
                            )}

                            <div className="space-y-1">
                                <Label className="text-xs font-semibold">Resolution Remarks / Notes</Label>
                                <Input
                                    placeholder="e.g. Fresh batch received via courier, inspection OK"
                                    value={resolveNote}
                                    onChange={(e) => setResolveNote(e.target.value)}
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setResolvingItem(null)}
                                className="text-xs"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={handleResolveSubmit}
                                disabled={submittingResolve}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5 shadow-sm"
                            >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Confirm & Update Inventory</span>
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            <QuickBarcodeScanModal
                open={showBarcodeScanner}
                onOpenChange={setShowBarcodeScanner}
                title="Scan Physical Tag / Discrepancy Item"
                onItemScanned={handleScannedItem}
            />
        </Dialog>
    );
}
