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
import { Loader2, Printer, MapPin, Package, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import {
    buildWavePickList,
    loadPackingLinesForOrder,
    type QueueOrder,
    type WavePickGroup,
    type PackingLine,
} from "@/lib/packing";
import { escapeHtml } from "@/lib/utils";

interface WavePickListModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    orders: QueueOrder[];
}

export function WavePickListModal({ open, onOpenChange, orders }: WavePickListModalProps) {
    const [loading, setLoading] = useState(false);
    const [groups, setGroups] = useState<WavePickGroup[]>([]);
    const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!open || orders.length === 0) return;

        let cancelled = false;
        async function loadAllLines() {
            setLoading(true);
            try {
                const linesMap = new Map<string, PackingLine[]>();
                await Promise.all(
                    orders.map(async (order) => {
                        const lines = await loadPackingLinesForOrder(order.id);
                        if (!cancelled) linesMap.set(order.id, lines);
                    })
                );
                if (!cancelled) {
                    const waveGroups = buildWavePickList(orders, linesMap);
                    setGroups(waveGroups);
                }
            } catch (err) {
                console.error("Failed to build wave pick list:", err);
                toast.error("Could not load items for wave picking.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadAllLines();
        return () => {
            cancelled = true;
        };
    }, [open, orders]);

    const toggleItemCheck = (key: string) => {
        setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handlePrintWavePickList = () => {
        if (groups.length === 0) return;
        const win = window.open("", "_blank", "width=800,height=900");
        if (!win) {
            toast.error("Please allow pop-ups to print the wave pick list.");
            return;
        }

        const dateStr = new Date().toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
        });

        const totalPcs = groups.reduce(
            (sum, g) => sum + g.items.reduce((s, it) => s + it.totalQuantity, 0),
            0
        );

        const html = `<!doctype html><html><head><title>Wave Pick List — ${escapeHtml(dateStr)}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 20px; color: #111; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 16px; }
            .brand { font-size: 18px; font-weight: 900; }
            .meta { font-size: 11px; color: #444; }
            .group-title { background: #f3f4f6; border-left: 4px solid #111; padding: 6px 10px; font-size: 13px; font-weight: 800; margin: 16px 0 8px; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
            th { border-bottom: 1px solid #000; text-align: left; padding: 5px 6px; font-size: 9px; text-transform: uppercase; }
            td { border-bottom: 1px dashed #ddd; padding: 6px; vertical-align: top; }
            .cb { text-align: center; }
            .mono { font-family: "Courier New", monospace; font-weight: 700; }
            .orders { font-size: 9px; color: #555; }
            .box { width: 16px; height: 16px; border: 1px solid #000; display: inline-block; }
            @media print { body { margin: 8mm; } @page { size: A4; margin: 10mm; } }
        </style></head><body>
            <div class="header">
                <div>
                    <div class="brand">LUMINILA · CONSOLIDATED WAVE PICK LIST</div>
                    <div class="meta">${escapeHtml(orders.length.toString())} Orders · ${totalPcs} Total Pieces to Pull</div>
                </div>
                <div class="meta" style="text-align: right;">
                    <div>Date: ${escapeHtml(dateStr)}</div>
                    <div>Tray-Grouped Sequence</div>
                </div>
            </div>
            ${groups
                .map(
                    (g) => `
                <div class="group-title">📍 ${escapeHtml(g.location)} (${g.items.reduce((s, it) => s + it.totalQuantity, 0)} pcs)</div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 30px;" class="cb">Pick</th>
                            <th style="width: 130px;">SKU</th>
                            <th>Description</th>
                            <th style="width: 60px;" class="cb">Total Qty</th>
                            <th style="width: 200px;">Orders to Allocate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${g.items
                            .map(
                                (item) => `
                            <tr>
                                <td class="cb"><div class="box"></div></td>
                                <td class="mono">${escapeHtml(item.sku)}</td>
                                <td>${escapeHtml(item.description)}</td>
                                <td class="cb"><strong>${item.totalQuantity}</strong></td>
                                <td class="orders">${escapeHtml(
                                    item.orders.map((o) => `${o.order_number} (${o.quantity})`).join(", ")
                                )}</td>
                            </tr>
                        `
                            )
                            .join("")}
                    </tbody>
                </table>
            `
                )
                .join("")}
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                };
            </script>
        </body></html>`;

        win.document.write(html);
        win.document.close();
    };

    const totalItems = groups.reduce(
        (sum, g) => sum + g.items.reduce((s, it) => s + it.totalQuantity, 0),
        0
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col bg-surface-navy border-surface-hover text-white">
                <DialogHeader className="border-b border-surface-hover pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
                                <Package className="text-primary size-5" />
                                Consolidated Wave Pick List
                            </DialogTitle>
                            <DialogDescription className="text-xs text-moonstone mt-0.5">
                                Grouped by showcase tray / storage location for {orders.length} pending orders ({totalItems} total pieces).
                            </DialogDescription>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handlePrintWavePickList}
                            disabled={loading || groups.length === 0}
                            className="h-8 text-xs border-surface-hover text-white hover:bg-bg-navy"
                        >
                            <Printer className="size-3.5 mr-1" />
                            Print Pick Sheet
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 py-3 pr-1">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center p-12 text-moonstone gap-2">
                            <Loader2 className="size-6 animate-spin text-primary" />
                            <p className="text-xs">Consolidating tray lines from {orders.length} orders…</p>
                        </div>
                    ) : groups.length === 0 ? (
                        <div className="text-center p-8 text-moonstone text-xs">
                            No packable items found in the selected orders.
                        </div>
                    ) : (
                        groups.map((group) => {
                            const groupQty = group.items.reduce((sum, i) => sum + i.totalQuantity, 0);
                            return (
                                <div
                                    key={group.location}
                                    className="rounded-lg border border-surface-hover/80 bg-bg-navy/70 overflow-hidden"
                                >
                                    <div className="px-3 py-2 bg-surface-navy/90 border-b border-surface-hover flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <MapPin size={13} className="text-primary" />
                                            <span className="text-xs font-bold text-white uppercase tracking-wider">
                                                {group.location}
                                            </span>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                                            {groupQty} pcs to pull
                                        </Badge>
                                    </div>
                                    <div className="divide-y divide-surface-hover/30">
                                        {group.items.map((item) => {
                                            const itemKey = `${group.location}_${item.sku}`;
                                            const isChecked = !!checkedItems[itemKey];
                                            return (
                                                <div
                                                    key={item.sku}
                                                    onClick={() => toggleItemCheck(itemKey)}
                                                    className={`px-3 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                                                        isChecked ? "bg-emerald-500/10 opacity-70" : "hover:bg-surface-navy/40"
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <div
                                                            className={`size-4 rounded border flex items-center justify-center transition-colors ${
                                                                isChecked
                                                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                                                    : "border-surface-hover bg-bg-navy"
                                                            }`}
                                                        >
                                                            {isChecked && <CheckSquare size={11} />}
                                                        </div>
                                                        {item.image_url ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={item.image_url}
                                                                alt={item.sku}
                                                                className="size-8 rounded object-cover border border-surface-hover shrink-0"
                                                            />
                                                        ) : (
                                                            <div className="size-8 rounded bg-surface-navy border border-surface-hover flex items-center justify-center text-moonstone text-[9px] shrink-0">
                                                                JWL
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <p
                                                                className={`text-xs font-mono font-bold truncate ${
                                                                    isChecked ? "line-through text-moonstone" : "text-white"
                                                                }`}
                                                            >
                                                                {item.sku}
                                                            </p>
                                                            <p className="text-[10px] text-moonstone truncate">
                                                                {item.description}
                                                            </p>
                                                            <p className="text-[9px] text-moonstone/80 mt-0.5 truncate">
                                                                For: {item.orders.map((o) => `${o.order_number} (×${o.quantity})`).join(", ")}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <span className="shrink-0 font-mono font-bold text-xs px-2 py-0.5 rounded bg-surface-navy border border-surface-hover text-primary">
                                                        ×{item.totalQuantity}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
