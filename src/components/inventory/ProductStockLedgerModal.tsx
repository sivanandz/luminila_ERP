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
import { Badge } from "@/components/ui/badge";
import { Loader2, History, ArrowDownRight, ArrowUpRight, MapPin } from "lucide-react";
import { getProductStockLedger, type StockLedgerEntry } from "@/lib/stock-ledger";

interface ProductStockLedgerModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    product: {
        id: string;
        sku: string;
        name: string;
        stock: number;
        location?: string;
    } | null;
}

export function ProductStockLedgerModal({
    open,
    onOpenChange,
    product,
}: ProductStockLedgerModalProps) {
    const [loading, setLoading] = useState(false);
    const [entries, setEntries] = useState<StockLedgerEntry[]>([]);

    useEffect(() => {
        if (!open || !product?.id) {
            setEntries([]);
            return;
        }

        let cancelled = false;
        async function fetchLedger() {
            setLoading(true);
            try {
                const data = await getProductStockLedger(product!.id);
                if (!cancelled) setEntries(data);
            } catch (err) {
                console.error("Failed to load ledger:", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void fetchLedger();
        return () => {
            cancelled = true;
        };
    }, [open, product]);

    if (!product) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col bg-surface-navy border-surface-hover text-white">
                <DialogHeader className="border-b border-surface-hover pb-3">
                    <div className="flex items-start justify-between">
                        <div>
                            <DialogTitle className="text-base font-bold flex items-center gap-2 text-white">
                                <History className="size-5 text-primary" />
                                Chronological Stock Movement Ledger
                            </DialogTitle>
                            <DialogDescription className="text-xs text-moonstone mt-0.5">
                                SKU: <span className="font-mono text-white font-bold">{product.sku}</span> · {product.name}
                            </DialogDescription>
                        </div>
                        <div className="text-right">
                            <span className="text-[10px] text-moonstone block">Current Balance</span>
                            <span className="font-mono text-base font-black text-primary">
                                {product.stock} pcs
                            </span>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-2">
                    {loading ? (
                        <div className="flex justify-center p-12">
                            <Loader2 className="animate-spin text-primary size-6" />
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="text-center p-8 text-moonstone text-xs">
                            No stock movement transactions recorded yet for this piece.
                        </div>
                    ) : (
                        <div className="divide-y divide-surface-hover/50">
                            {entries.map((entry) => {
                                const isPositive = entry.quantity > 0;
                                const isZero = entry.quantity === 0;

                                return (
                                    <div
                                        key={entry.id}
                                        className="py-3 px-2 flex items-center justify-between gap-4 hover:bg-bg-navy/40 transition-colors"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div
                                                className={`size-7 rounded-lg flex items-center justify-center shrink-0 ${
                                                    isPositive
                                                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                                                }`}
                                            >
                                                {isPositive ? (
                                                    <ArrowUpRight size={14} />
                                                ) : (
                                                    <ArrowDownRight size={14} />
                                                )}
                                            </div>

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-xs font-bold text-white">
                                                        {entry.type_label}
                                                    </span>
                                                    <span className="text-[10px] text-moonstone/70">
                                                        {new Date(entry.date).toLocaleString("en-IN", {
                                                            dateStyle: "medium",
                                                            timeStyle: "short",
                                                        })}
                                                    </span>
                                                </div>
                                                {entry.notes && (
                                                    <p className="text-[11px] text-moonstone truncate mt-0.5 max-w-md">
                                                        {entry.notes}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="text-right shrink-0">
                                            <span
                                                className={`font-mono font-bold text-xs ${
                                                    isPositive
                                                        ? "text-emerald-400"
                                                        : isZero
                                                          ? "text-moonstone"
                                                          : "text-red-400"
                                                }`}
                                            >
                                                {isPositive ? `+${entry.quantity}` : entry.quantity}
                                            </span>
                                            <span className="text-[10px] text-moonstone/60 block font-mono">
                                                Bal: {entry.running_balance}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="border-t border-surface-hover pt-3 flex justify-between items-center text-xs text-moonstone">
                    <div className="flex items-center gap-1.5">
                        <MapPin size={12} className="text-primary" />
                        <span>Tray / Location: {product.location || "Showcase Tray A"}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs border-surface-hover text-white">
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
