"use client";

import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    getInventoryLocations,
    getStockTransfers,
    createStockTransfer,
    receiveStockTransfer,
    type InventoryLocation,
    type StockTransfer,
} from "@/lib/multi-location";
import {
    ArrowRightLeft,
    Building2,
    Store,
    Shield,
    Plus,
    CheckCircle2,
    Truck,
    Package,
    ScanBarcode,
    Trash2,
    ExternalLink,
} from "lucide-react";

interface StockTransferModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preselectedProduct?: {
        id: string;
        sku: string;
        name: string;
        stock: number;
    } | null;
    onTransferred?: () => void;
}

export function StockTransferModal({
    open,
    onOpenChange,
    preselectedProduct,
    onTransferred,
}: StockTransferModalProps) {
    const [locations, setLocations] = useState<InventoryLocation[]>([]);
    const [transfers, setTransfers] = useState<StockTransfer[]>([]);
    const [activeTab, setActiveTab] = useState<"new_transfer" | "history" | "locations">("new_transfer");

    // Form State
    const [sourceLoc, setSourceLoc] = useState("");
    const [destLoc, setDestLoc] = useState("");
    const [carrier, setCarrier] = useState("Internal Logistics / Van");
    const [notes, setNotes] = useState("");
    const [skuInput, setSkuInput] = useState("");
    const [qtyInput, setQtyInput] = useState(1);
    const [transferItems, setTransferItems] = useState<
        {
            productId: string;
            variantId: string;
            sku: string;
            name: string;
            quantity: number;
        }[]
    >([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            loadData();
            if (preselectedProduct) {
                setTransferItems([
                    {
                        productId: preselectedProduct.id,
                        variantId: preselectedProduct.id,
                        sku: preselectedProduct.sku,
                        name: preselectedProduct.name,
                        quantity: 1,
                    },
                ]);
            }
        }
    }, [open, preselectedProduct]);

    const loadData = async () => {
        try {
            const [locs, trfs] = await Promise.all([
                getInventoryLocations(),
                getStockTransfers(),
            ]);
            setLocations(locs);
            setTransfers(trfs);

            if (locs.length >= 2) {
                const wh = locs.find((l) => l.type === "warehouse") || locs[0];
                const pos = locs.find((l) => l.type === "pos_store") || locs[1];
                setSourceLoc(wh.id);
                setDestLoc(pos.id);
            }
        } catch (e) {
            console.error("Failed to load multi-location data:", e);
        }
    };

    const handleAddItem = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const trimmed = skuInput.trim();
        if (!trimmed) {
            toast.error("Please enter a SKU or scan a barcode");
            return;
        }

        setTransferItems((prev) => [
            ...prev,
            {
                productId: `prod_${Date.now()}`,
                variantId: `var_${Date.now()}`,
                sku: trimmed.toUpperCase(),
                name: `Item (${trimmed.toUpperCase()})`,
                quantity: Math.max(1, qtyInput),
            },
        ]);
        setSkuInput("");
        setQtyInput(1);
        toast.success(`Added ${trimmed.toUpperCase()} to transfer manifest`);
    };

    const handleRemoveItem = (index: number) => {
        setTransferItems((prev) => prev.filter((_, i) => i !== index));
    };

    const handleDispatch = async () => {
        if (!sourceLoc || !destLoc) {
            toast.error("Please select both source and destination facilities");
            return;
        }
        if (sourceLoc === destLoc) {
            toast.error("Source and destination facilities must be different");
            return;
        }
        if (transferItems.length === 0) {
            toast.error("Please add at least one item to transfer");
            return;
        }

        setSubmitting(true);
        try {
            const trf = await createStockTransfer({
                sourceLocationId: sourceLoc,
                destinationLocationId: destLoc,
                items: transferItems,
                carrier,
                notes,
            });

            toast.success(`Transfer ${trf.transfer_number} dispatched successfully!`);
            setTransferItems([]);
            setNotes("");
            await loadData();
            setActiveTab("history");
            onTransferred?.();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to dispatch stock transfer";
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const handleReceive = async (trfId: string) => {
        try {
            await receiveStockTransfer(trfId);
            toast.success("Stock received and verified into destination inventory!");
            await loadData();
            onTransferred?.();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to receive transfer";
            toast.error(msg);
        }
    };

    const getLocationIcon = (type: string) => {
        switch (type) {
            case "warehouse":
                return <Building2 className="w-3.5 h-3.5 text-blue-400" />;
            case "pos_store":
                return <Store className="w-3.5 h-3.5 text-emerald-400" />;
            case "vault":
                return <Shield className="w-3.5 h-3.5 text-amber-400" />;
            default:
                return <Package className="w-3.5 h-3.5 text-muted-foreground" />;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-4 md:p-6 bg-card border-border text-foreground">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 gap-1.5">
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            Multi-Location Hub
                        </Badge>
                    </div>
                    <DialogTitle className="text-xl font-bold flex items-center justify-between">
                        <span>Multi-PoS & Multi-Warehouse Stock Management</span>
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                        Seamlessly transfer, allocate, and track jewelry inventory across retail POS counters, central warehouses, and secure safe vaults.
                    </DialogDescription>
                </DialogHeader>

                {/* Tabs */}
                <div className="flex items-center gap-1.5 border-b border-border pb-2 mt-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab("new_transfer")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                            activeTab === "new_transfer"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                    >
                        🚀 New Transfer Order
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab("history")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                            activeTab === "history"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                    >
                        📋 Transfer Manifests ({transfers.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab("locations")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                            activeTab === "locations"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                    >
                        🏢 Facilities ({locations.length})
                    </button>
                </div>

                {/* TAB 1: NEW TRANSFER */}
                {activeTab === "new_transfer" && (
                    <div className="space-y-4 pt-2">
                        {/* Source & Destination Matrix */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/20 border border-border/80 p-3.5 rounded-xl">
                            <div>
                                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                                    Source Facility (Dispatch From)
                                </label>
                                <select
                                    value={sourceLoc}
                                    onChange={(e) => setSourceLoc(e.target.value)}
                                    className="w-full bg-background border border-border text-foreground text-xs rounded-lg px-3 py-2 font-medium focus:ring-1 focus:ring-primary focus:outline-none"
                                >
                                    {locations.map((loc) => (
                                        <option key={loc.id} value={loc.id}>
                                            [{loc.code}] {loc.name} ({loc.type.toUpperCase()})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                                    Destination Facility (Receive At)
                                </label>
                                <select
                                    value={destLoc}
                                    onChange={(e) => setDestLoc(e.target.value)}
                                    className="w-full bg-background border border-border text-foreground text-xs rounded-lg px-3 py-2 font-medium focus:ring-1 focus:ring-primary focus:outline-none"
                                >
                                    {locations.map((loc) => (
                                        <option key={loc.id} value={loc.id}>
                                            [{loc.code}] {loc.name} ({loc.type.toUpperCase()})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Item Scanner / Entry */}
                        <div className="border border-border/80 rounded-xl p-3.5 bg-card space-y-3">
                            <div className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <ScanBarcode className="w-4 h-4 text-primary" />
                                Add Transfer Items (Barcode / SKU Scan)
                            </div>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        type="text"
                                        placeholder="Scan item barcode or SKU (e.g. NK-GOLD-001)..."
                                        value={skuInput}
                                        onChange={(e) => setSkuInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                                        className="h-9 text-xs font-mono"
                                    />
                                </div>
                                <Input
                                    type="number"
                                    min={1}
                                    value={qtyInput}
                                    onChange={(e) => setQtyInput(parseInt(e.target.value) || 1)}
                                    className="w-20 h-9 text-xs font-mono text-center"
                                />
                                <Button type="button" size="sm" onClick={() => handleAddItem()} className="h-9 px-3 text-xs gap-1">
                                    <Plus className="w-3.5 h-3.5" /> Add
                                </Button>
                            </div>

                            {/* Manifest Table */}
                            {transferItems.length > 0 ? (
                                <div className="border border-border rounded-lg overflow-hidden mt-2">
                                    <table className="w-full text-xs">
                                        <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                                            <tr>
                                                <th className="p-2 text-left">SKU / Item</th>
                                                <th className="p-2 text-center w-24">Transfer Qty</th>
                                                <th className="p-2 text-right w-16">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {transferItems.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-muted/20">
                                                    <td className="p-2">
                                                        <div className="font-semibold text-foreground">{item.name}</div>
                                                        <div className="font-mono text-[10px] text-muted-foreground">{item.sku}</div>
                                                    </td>
                                                    <td className="p-2 text-center font-mono font-bold text-primary">
                                                        {item.quantity} units
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveItem(idx)}
                                                            className="text-destructive hover:opacity-80 p-1"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border rounded-lg">
                                    No items in transfer manifest yet. Scan barcode or enter SKU above.
                                </div>
                            )}
                        </div>

                        {/* Logistics Details */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                                    Transit Carrier / Method
                                </label>
                                <select
                                    value={carrier}
                                    onChange={(e) => setCarrier(e.target.value)}
                                    className="w-full bg-background border border-border text-foreground text-xs rounded-lg px-3 py-2 font-medium focus:ring-1 focus:ring-primary focus:outline-none"
                                >
                                    <option value="Internal Logistics / Van">Internal Logistics / Van</option>
                                    <option value="ST Courier Express">ST Courier Express</option>
                                    <option value="Delhivery Surface">Delhivery Surface</option>
                                    <option value="Staff Hand Carry">Staff Hand Carry</option>
                                    <option value="Armored Transit Vault">Armored Transit Vault</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                                    Notes / Dispatch Purpose
                                </label>
                                <Input
                                    type="text"
                                    placeholder="e.g. Weekend Showroom Replenishment"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        {/* Submit Action */}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                disabled={submitting || transferItems.length === 0}
                                onClick={handleDispatch}
                                className="bg-primary text-primary-foreground font-semibold px-4 gap-1.5"
                            >
                                <Truck className="w-3.5 h-3.5" />
                                {submitting ? "Dispatching..." : "Dispatch Transfer Order"}
                            </Button>
                        </div>
                    </div>
                )}

                {/* TAB 2: TRANSFER MANIFESTS HISTORY */}
                {activeTab === "history" && (
                    <div className="space-y-3 pt-2">
                        {transfers.length > 0 ? (
                            <div className="space-y-2.5">
                                {transfers.map((trf) => (
                                    <div
                                        key={trf.id}
                                        className="bg-muted/20 border border-border/80 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                    >
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono font-bold text-xs text-foreground">
                                                    {trf.transfer_number}
                                                </span>
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        trf.status === "received"
                                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                            : "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse"
                                                    }
                                                >
                                                    {trf.status.toUpperCase()}
                                                </Badge>
                                                <span className="text-[10px] text-muted-foreground">
                                                    {new Date(trf.created).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                                <span className="text-foreground font-medium">{trf.source_location_name}</span>
                                                <ArrowRightLeft className="w-3 h-3 text-primary" />
                                                <span className="text-foreground font-medium">{trf.destination_location_name}</span>
                                            </div>
                                            <div className="text-[11px] text-muted-foreground">
                                                Carrier: <strong className="text-foreground">{trf.carrier}</strong> •{" "}
                                                {trf.items.reduce((s, it) => s + it.dispatched_quantity, 0)} items
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {trf.status === "dispatched" && (
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleReceive(trf.id)}
                                                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1"
                                                >
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                    Accept & Receive Stock
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                                No stock transfer orders logged yet.
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 3: FACILITIES */}
                {activeTab === "locations" && (
                    <div className="space-y-3 pt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {locations.map((loc) => (
                                <div
                                    key={loc.id}
                                    className="bg-card border border-border rounded-xl p-3.5 space-y-2 shadow-sm"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {getLocationIcon(loc.type)}
                                            <span className="font-mono text-xs font-bold text-foreground">
                                                {loc.code}
                                            </span>
                                        </div>
                                        <Badge
                                            variant="outline"
                                            className="text-[10px] uppercase tracking-wider"
                                        >
                                            {loc.type.replace("_", " ")}
                                        </Badge>
                                    </div>
                                    <div className="text-sm font-semibold text-foreground">{loc.name}</div>
                                    <div className="text-[11px] text-muted-foreground">
                                        {loc.address || "Local Address"}, {loc.city}
                                    </div>
                                    <div className="flex items-center gap-2 pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                                        {loc.allow_pos_sales ? (
                                            <span className="text-emerald-400 font-medium">✓ Active POS Billing Station</span>
                                        ) : (
                                            <span className="text-muted-foreground">Bulk Logistics Only</span>
                                        )}
                                        {loc.is_default && (
                                            <span className="ml-auto bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                                Default Hub
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
