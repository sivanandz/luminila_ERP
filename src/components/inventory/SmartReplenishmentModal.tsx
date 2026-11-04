"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
    Sparkles,
    ShoppingBag,
    MessageCircle,
    Loader2,
    Truck,
    AlertTriangle,
    Copy,
    ExternalLink,
    ChevronRight,
    Package,
} from "lucide-react";
import {
    loadReplenishmentQueue,
    formatVendorWhatsAppMessage,
    type VendorRestockGroup,
    type RestockItem,
} from "@/lib/replenishment";
import { createPurchaseOrder } from "@/lib/purchase";

interface SmartReplenishmentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SmartReplenishmentModal({
    open,
    onOpenChange,
}: SmartReplenishmentModalProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [groups, setGroups] = useState<VendorRestockGroup[]>([]);
    const [creatingPOForVendor, setCreatingPOForVendor] = useState<string | null>(null);

    // WhatsApp composer state
    const [activeWhatsAppGroup, setActiveWhatsAppGroup] = useState<VendorRestockGroup | null>(null);
    const [whatsAppText, setWhatsAppText] = useState("");

    useEffect(() => {
        if (!open) return;
        let cancelled = false;

        async function fetchQueue() {
            setLoading(true);
            try {
                const data = await loadReplenishmentQueue();
                if (!cancelled) setGroups(data);
            } catch (err) {
                console.error("Failed to load replenishment queue:", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void fetchQueue();
        return () => {
            cancelled = true;
        };
    }, [open]);

    const handleCreateDraftPO = async (group: VendorRestockGroup) => {
        if (!group.vendorId) {
            toast.error("Please assign a supplier to these items before creating a Purchase Order.");
            return;
        }
        setCreatingPOForVendor(group.vendorId);
        try {
            const todayStr = new Date().toISOString().split("T")[0];
            const items = group.items.map((it) => {
                const totalLine = it.suggestedQuantity * it.unitCost;
                return {
                    variant_id: it.variantId,
                    description: `${it.sku} - ${it.name}`,
                    quantity_ordered: it.suggestedQuantity,
                    quantity_received: 0,
                    unit: "PCS",
                    unit_price: it.unitCost,
                    gst_rate: 3,
                    gst_amount: Math.round(totalLine * 0.03),
                    total_price: Math.round(totalLine * 1.03),
                };
            });

            const subtotal = items.reduce((s, it) => s + it.unit_price * it.quantity_ordered, 0);
            const gstAmount = items.reduce((s, it) => s + it.gst_amount, 0);
            const total = subtotal + gstAmount;

            const created = await createPurchaseOrder({
                vendor_id: group.vendorId,
                status: "draft",
                order_date: todayStr,
                subtotal,
                gst_amount: gstAmount,
                shipping_cost: 0,
                discount_amount: 0,
                total,
                items,
                notes: `Auto-generated from Smart Replenishment Queue for ${group.vendorName}.`,
            });

            toast.success(`Draft PO created: ${created.po_number || "Draft"}!`);
            onOpenChange(false);
            if (created.id) {
                router.push(`/purchase/detail?id=${created.id}`);
            } else {
                router.push("/purchase");
            }
        } catch (err) {
            console.error("Draft PO creation failed:", err);
            toast.error("Could not create draft Purchase Order.");
        } finally {
            setCreatingPOForVendor(null);
        }
    };

    const handleOpenWhatsAppComposer = (group: VendorRestockGroup) => {
        setActiveWhatsAppGroup(group);
        setWhatsAppText(formatVendorWhatsAppMessage(group));
    };

    const handleCopyWhatsApp = () => {
        navigator.clipboard.writeText(whatsAppText);
        toast.success("Vendor order message copied to clipboard!");
    };

    const handleSendWhatsApp = () => {
        if (!activeWhatsAppGroup) return;
        const phone = (activeWhatsAppGroup.vendorPhone || "").replace(/\D/g, "");
        const url = phone
            ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsAppText)}`
            : `https://web.whatsapp.com/send?text=${encodeURIComponent(whatsAppText)}`;
        window.open(url, "_blank");
    };

    const totalPiecesToReorder = groups.reduce(
        (sum, g) => sum + g.items.reduce((s, it) => s + it.suggestedQuantity, 0),
        0
    );

    return (
        <>
            <Dialog open={open && !activeWhatsAppGroup} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col bg-surface-navy border-surface-hover text-white">
                    <DialogHeader className="border-b border-surface-hover pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <DialogTitle className="text-base font-bold flex items-center gap-2 text-white">
                                    <Sparkles className="size-5 text-primary" />
                                    Smart Low-Stock Replenishment Queue
                                </DialogTitle>
                                <DialogDescription className="text-xs text-moonstone mt-0.5">
                                    Automatically aggregated by supplier based on current stock, pending POs, and sales velocity.
                                </DialogDescription>
                            </div>
                            <Badge variant="outline" className="border-primary/40 text-primary text-xs font-mono">
                                {totalPiecesToReorder} pcs across {groups.length} suppliers
                            </Badge>
                        </div>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-4 py-3">
                        {loading ? (
                            <div className="flex justify-center p-12 text-moonstone">
                                <Loader2 className="animate-spin text-primary size-6" />
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="text-center p-12 text-moonstone text-xs">
                                All items are healthy! No inventory is currently below reorder thresholds. 🎉
                            </div>
                        ) : (
                            groups.map((group) => {
                                const isBusy = creatingPOForVendor === (group.vendorId || "unassigned");
                                return (
                                    <div
                                        key={group.vendorId || group.vendorName}
                                        className="rounded-xl border border-surface-hover bg-bg-navy/70 overflow-hidden"
                                    >
                                        {/* Supplier Header */}
                                        <div className="px-4 py-3 bg-surface-navy/90 border-b border-surface-hover flex items-center justify-between flex-wrap gap-2">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold text-white">
                                                        {group.vendorName}
                                                    </span>
                                                    {group.vendorPhone && (
                                                        <span className="text-xs text-moonstone font-mono">
                                                            · {group.vendorPhone}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-moonstone mt-0.5">
                                                    {group.items.length} low-stock lines · Est. Value: ₹
                                                    {group.estimatedTotalCost.toLocaleString("en-IN")}
                                                </p>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleOpenWhatsAppComposer(group)}
                                                    className="h-8 text-xs border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                                                >
                                                    <MessageCircle size={13} className="mr-1 text-emerald-400" />
                                                    WhatsApp Order
                                                </Button>

                                                <Button
                                                    size="sm"
                                                    disabled={isBusy || !group.vendorId}
                                                    onClick={() => void handleCreateDraftPO(group)}
                                                    title={!group.vendorId ? "Assign a supplier in Vendor Mappings first" : "Create 1-Click Draft PO"}
                                                    className="h-8 text-xs font-bold bg-primary text-primary-foreground disabled:opacity-50"
                                                >
                                                    {isBusy ? (
                                                        <Loader2 size={13} className="animate-spin mr-1" />
                                                    ) : (
                                                        <ShoppingBag size={13} className="mr-1" />
                                                    )}
                                                    1-Click Draft PO
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Line items table */}
                                        <div className="divide-y divide-surface-hover/30">
                                            {group.items.map((it) => (
                                                <div
                                                    key={it.sku}
                                                    className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        {it.image_url ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={it.image_url}
                                                                alt={it.sku}
                                                                className="size-9 rounded object-cover border border-surface-hover shrink-0"
                                                            />
                                                        ) : (
                                                            <div className="size-9 rounded bg-surface-navy border border-surface-hover flex items-center justify-center text-moonstone text-[9px] shrink-0 font-bold">
                                                                JWL
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <span className="font-mono font-bold text-white">
                                                                {it.sku}
                                                            </span>
                                                            <p className="text-[11px] text-moonstone truncate max-w-sm">
                                                                {it.name}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-4 shrink-0 text-right">
                                                        <div>
                                                            <span className="text-[10px] text-moonstone block">
                                                                Stock:{" "}
                                                                <strong className="text-red-400 font-mono">
                                                                    {it.currentStock}
                                                                </strong>
                                                                {it.pendingPOQuantity > 0 && (
                                                                    <span className="text-amber-300 ml-1">
                                                                        (+{it.pendingPOQuantity} PO)
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="text-[10px] text-moonstone/70">
                                                                Threshold: {it.lowStockThreshold}
                                                            </span>
                                                        </div>

                                                        <div className="min-w-[80px]">
                                                            <span className="font-mono font-bold text-xs text-primary block">
                                                                Order +{it.suggestedQuantity} pcs
                                                            </span>
                                                            <span className="text-[10px] text-moonstone">
                                                                @ ₹{it.unitCost}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Editable WhatsApp Vendor Message Composer */}
            {activeWhatsAppGroup && (
                <Dialog open={true} onOpenChange={() => setActiveWhatsAppGroup(null)}>
                    <DialogContent className="max-w-lg bg-surface-navy border-surface-hover text-white">
                        <DialogHeader className="border-b border-surface-hover pb-3">
                            <DialogTitle className="text-base font-bold flex items-center gap-2">
                                <MessageCircle className="size-5 text-emerald-400" />
                                WhatsApp Vendor Restock Order: {activeWhatsAppGroup.vendorName}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-moonstone">
                                Review and edit the order message before sending to the supplier.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3 py-2">
                            <textarea
                                value={whatsAppText}
                                onChange={(e) => setWhatsAppText(e.target.value)}
                                rows={10}
                                className="w-full rounded-lg bg-bg-navy border border-surface-hover p-3 text-xs text-white font-mono leading-relaxed focus:outline-none focus:border-primary resize-none"
                            />
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-surface-hover">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyWhatsApp}
                                className="h-8 text-xs border-surface-hover text-white hover:bg-bg-navy"
                            >
                                <Copy size={13} className="mr-1" /> Copy
                            </Button>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setActiveWhatsAppGroup(null)}
                                    className="h-8 text-xs text-moonstone"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSendWhatsApp}
                                    className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
                                >
                                    <ExternalLink size={13} className="mr-1" /> Open WhatsApp
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
