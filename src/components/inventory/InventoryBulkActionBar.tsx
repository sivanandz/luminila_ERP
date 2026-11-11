"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuLabel,
    DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Tag,
    Printer,
    MapPin,
    Percent,
    Share2,
    X,
    Loader2,
    CheckCircle2,
    Eye,
    EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { pushToLabelQueue } from "@/lib/label-queue";
import { loadTrayLocationOptions, trayChoices, trayChoiceLabel, type TrayLocationOption } from "@/lib/tray-locations";
import { pb } from "@/lib/pocketbase";

interface BulkProduct {
    id: string;
    sku: string;
    name: string;
    price: number;
    stock: number;
    location?: string;
    is_active?: boolean;
}

interface InventoryBulkActionBarProps {
    selectedIds: string[];
    products: BulkProduct[];
    onClearSelection: () => void;
    onRefresh: () => Promise<void> | void;
    onOpenBroadcast: () => void;
}

export function InventoryBulkActionBar({
    selectedIds,
    products,
    onClearSelection,
    onRefresh,
    onOpenBroadcast,
}: InventoryBulkActionBarProps) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [moveLocationModalOpen, setMoveLocationModalOpen] = useState(false);
    const [priceAdjustModalOpen, setPriceAdjustModalOpen] = useState(false);
    const [pricePercent, setPricePercent] = useState("");
    const [fixedAdjustment, setFixedAdjustment] = useState("");
    // Editable tray locations (Settings → Tray Locations); presets until defined.
    const [trayOptions, setTrayOptions] = useState<TrayLocationOption[]>([]);
    React.useEffect(() => {
        let alive = true;
        loadTrayLocationOptions()
            .then((opts) => { if (alive) setTrayOptions(opts); })
            .catch(() => { /* presets already cover the grid */ });
        return () => { alive = false; };
    }, []);

    if (selectedIds.length === 0) return null;

    const selectedProducts = products.filter((p) => selectedIds.includes(p.id));

    // 1. Label Printing Queue
    const handleQueueLabels = (mode: "one_per_sku" | "one_per_stock") => {
        const queuedItems = selectedProducts.map((p) => ({
            sku: p.sku,
            name: p.name,
            price: p.price,
            quantity: mode === "one_per_stock" ? Math.max(1, p.stock) : 1,
        }));

        pushToLabelQueue(queuedItems);
        const totalTags = queuedItems.reduce((sum, it) => sum + it.quantity, 0);
        toast.success(
            `Added ${selectedProducts.length} items (${totalTags} labels) to print queue.`
        );
        router.push("/labels");
    };

/** Helper to process bulk database writes in sequential chunks to avoid SQLite lock contention */
async function batchProcess<T>(items: T[], batchSize: number, fn: (item: T) => Promise<unknown>): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
        const chunk = items.slice(i, i + batchSize);
        await Promise.all(chunk.map(fn));
    }
}

    // 2. Bulk Move Tray Location
    const handleConfirmMoveLocation = async (newLocation: string) => {
        setBusy(true);
        try {
            await batchProcess(selectedIds, 15, (id) =>
                pb.collection("products").update(id, { location: newLocation })
            );
            toast.success(`Moved ${selectedIds.length} items to ${newLocation}!`);
            setMoveLocationModalOpen(false);
            onClearSelection();
            await onRefresh();
        } catch (err) {
            console.error("Bulk location move failed:", err);
            toast.error("Failed to move items to new location.");
        } finally {
            setBusy(false);
        }
    };

    // 3. Bulk Price Adjust
    const handleApplyPriceAdjustment = async () => {
        const pct = parseFloat(pricePercent);
        const fixed = parseFloat(fixedAdjustment);
        if (isNaN(pct) && isNaN(fixed)) {
            toast.error("Enter a percentage or fixed amount to adjust.");
            return;
        }

        setBusy(true);
        try {
            await batchProcess(selectedProducts, 15, (p) => {
                let nextPrice = p.price;
                if (!isNaN(pct)) {
                    nextPrice = Math.round(nextPrice * (1 + pct / 100));
                }
                if (!isNaN(fixed)) {
                    nextPrice = Math.max(0, nextPrice + fixed);
                }
                return pb.collection("products").update(p.id, {
                    base_price: nextPrice,
                });
            });
            toast.success(`Adjusted pricing on ${selectedIds.length} products!`);
            setPriceAdjustModalOpen(false);
            onClearSelection();
            await onRefresh();
        } catch (err) {
            console.error("Bulk price adjust failed:", err);
            toast.error("Failed to adjust prices.");
        } finally {
            setBusy(false);
        }
    };

    // 4. Bulk Toggle Active / Inactive
    const handleToggleActive = async (setActive: boolean) => {
        setBusy(true);
        try {
            await batchProcess(selectedIds, 15, (id) =>
                pb.collection("products").update(id, { is_active: setActive })
            );
            toast.success(
                `${setActive ? "Published" : "Moved to Draft"} ${selectedIds.length} products!`
            );
            onClearSelection();
            await onRefresh();
        } catch (err) {
            console.error("Bulk status update failed:", err);
            toast.error("Failed to update product statuses.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div data-bottom-dock className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)_+_5.5rem)] md:bottom-6 left-1/2 -translate-x-1/2 z-[95] bg-surface-navy/95 border border-primary/40 shadow-2xl backdrop-blur-md rounded-2xl p-2 px-4 flex items-center gap-2 max-w-2xl w-[92vw] sm:w-auto animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center gap-2 border-r border-surface-hover pr-3 mr-1">
                    <Badge className="bg-primary text-primary-foreground font-mono font-bold text-xs">
                        {selectedIds.length}
                    </Badge>
                    <span className="text-xs text-white font-semibold hidden sm:inline">
                        Selected
                    </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Print labels dropdown */}
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            disabled={busy}
                            className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-surface-hover bg-bg-navy/70 text-white hover:bg-bg-navy h-8 px-3 transition-colors disabled:opacity-50"
                        >
                            <Printer size={13} className="mr-1 text-primary" />
                            Print Labels
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-surface-navy border-surface-hover text-white text-xs">
                            <DropdownMenuGroup>
                            <DropdownMenuLabel className="text-[10px] text-moonstone uppercase tracking-wider">
                                Barcode Tag Queue
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                                onClick={() => handleQueueLabels("one_per_sku")}
                                className="cursor-pointer hover:bg-bg-navy"
                            >
                                🏷️ 1 Tag per SKU ({selectedIds.length} total)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => handleQueueLabels("one_per_stock")}
                                className="cursor-pointer hover:bg-bg-navy"
                            >
                                📦 1 Tag per In-Stock Unit (
                                {selectedProducts.reduce((sum, p) => sum + Math.max(1, p.stock), 0)}{" "}
                                total)
                            </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Move Tray */}
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setMoveLocationModalOpen(true)}
                        className="h-8 text-xs border-surface-hover bg-bg-navy/70 text-white hover:bg-bg-navy"
                    >
                        <MapPin size={13} className="mr-1 text-emerald-400" />
                        Move Tray
                    </Button>

                    {/* Price Adjust */}
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setPriceAdjustModalOpen(true)}
                        className="h-8 text-xs border-surface-hover bg-bg-navy/70 text-white hover:bg-bg-navy hidden sm:flex"
                    >
                        <Percent size={13} className="mr-1 text-amber-400" />
                        Adjust Price
                    </Button>

                    {/* Toggle Active */}
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            disabled={busy}
                            className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-surface-hover bg-bg-navy/70 text-white hover:bg-bg-navy h-8 px-3 transition-colors disabled:opacity-50"
                        >
                            Status
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-surface-navy border-surface-hover text-white text-xs">
                            <DropdownMenuItem
                                onClick={() => void handleToggleActive(true)}
                                className="cursor-pointer hover:bg-bg-navy text-emerald-300"
                            >
                                <Eye size={12} className="mr-1.5" /> Publish All
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => void handleToggleActive(false)}
                                className="cursor-pointer hover:bg-bg-navy text-amber-300"
                            >
                                <EyeOff size={12} className="mr-1.5" /> Move to Draft
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* WhatsApp Broadcast */}
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={onOpenBroadcast}
                        className="h-8 text-xs border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    >
                        <Share2 size={13} className="mr-1" />
                        Broadcast
                    </Button>
                </div>

                <div className="border-l border-surface-hover pl-2 ml-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClearSelection}
                        disabled={busy}
                        className="size-7 text-moonstone hover:text-white"
                        title="Deselect All"
                    >
                        <X size={14} />
                    </Button>
                </div>
            </div>

            {/* Move Location Modal */}
            <Dialog open={moveLocationModalOpen} onOpenChange={setMoveLocationModalOpen}>
                <DialogContent className="max-w-md bg-surface-navy border-surface-hover text-white">
                    <DialogHeader>
                        <DialogTitle className="text-base font-bold flex items-center gap-2">
                            <MapPin className="size-4 text-emerald-400" />
                            Move {selectedIds.length} Products to Tray / Location
                        </DialogTitle>
                        <DialogDescription className="text-xs text-moonstone">
                            Select the physical showcase tray or storage bin to assign to these pieces.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-2 gap-2 py-3">
                        {trayChoices(trayOptions).map((opt) => (
                            <button
                                key={opt.code}
                                type="button"
                                disabled={busy}
                                onClick={() => void handleConfirmMoveLocation(opt.code)}
                                className="p-3 rounded-lg border border-surface-hover bg-bg-navy text-left text-xs font-bold text-white hover:border-primary hover:bg-primary/10 transition-colors flex items-center justify-between gap-2"
                            >
                                <span className="truncate">{trayChoiceLabel(opt)}</span>
                                {busy ? <Loader2 size={12} className="animate-spin text-primary shrink-0" /> : null}
                            </button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Price Adjust Modal */}
            <Dialog open={priceAdjustModalOpen} onOpenChange={setPriceAdjustModalOpen}>
                <DialogContent className="max-w-md bg-surface-navy border-surface-hover text-white">
                    <DialogHeader>
                        <DialogTitle className="text-base font-bold flex items-center gap-2">
                            <Percent className="size-4 text-amber-400" />
                            Bulk Price Adjustment
                        </DialogTitle>
                        <DialogDescription className="text-xs text-moonstone">
                            Modify base prices across all {selectedIds.length} selected items simultaneously.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="text-xs text-moonstone">Percentage Markup or Discount (%):</Label>
                            <Input
                                type="number"
                                placeholder="e.g. 10 for +10%, or -5 for -5%"
                                value={pricePercent}
                                onChange={(e) => setPricePercent(e.target.value)}
                                className="h-9 bg-bg-navy border-surface-hover text-xs font-mono text-white mt-1"
                            />
                        </div>

                        <div>
                            <Label className="text-xs text-moonstone">Or Fixed Rupee Change (₹):</Label>
                            <Input
                                type="number"
                                placeholder="e.g. 50 for +₹50, or -20 for -₹20"
                                value={fixedAdjustment}
                                onChange={(e) => setFixedAdjustment(e.target.value)}
                                className="h-9 bg-bg-navy border-surface-hover text-xs font-mono text-white mt-1"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-surface-hover">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPriceAdjustModalOpen(false)}
                            className="h-8 text-xs text-moonstone"
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void handleApplyPriceAdjustment()}
                            className="h-8 text-xs font-bold bg-primary text-primary-foreground"
                        >
                            {busy ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
                            Apply to {selectedIds.length} Items
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
