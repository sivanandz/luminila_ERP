"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
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
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
    ScanBarcode,
    CheckCircle2,
    AlertTriangle,
    PlusCircle,
    ArrowRightLeft,
    Loader2,
    RefreshCw,
    MapPin,
    Package,
    ShieldAlert,
    Camera,
} from "lucide-react";
import {
    computeTrayAuditDiff,
    commitTrayAudit,
    type TrayAuditDiff,
    type TrayAuditLineItem,
} from "@/lib/cycle-count";
import { STORAGE_LOCATIONS } from "@/lib/products";
import { loadTrayLocationOptions, trayChoices, trayChoiceLabel, type TrayLocationOption } from "@/lib/tray-locations";
import { soundEffects } from "@/lib/sound-effects";
import dynamic from "next/dynamic";

const BarcodeScanner = dynamic(
    () => import("@/components/pos/BarcodeScanner").then((mod) => mod.BarcodeScanner),
    { ssr: false, loading: () => <div className="h-48 bg-bg-navy rounded-lg animate-pulse flex items-center justify-center text-moonstone text-xs">Loading camera…</div> }
);

interface TrayCycleCountModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    products: Array<{
        id: string;
        variant_id?: string;
        sku: string;
        name: string;
        location?: string;
        stock: number;
        image?: string | null;
    }>;
    onAuditCompleted: () => void;
}

export function TrayCycleCountModal({
    open,
    onOpenChange,
    products,
    onAuditCompleted,
}: TrayCycleCountModalProps) {
    const [selectedLocation, setSelectedLocation] = useState<string>(STORAGE_LOCATIONS[0]);
    // Editable tray locations (Settings → Tray Locations); presets until defined.
    const [trayOptions, setTrayOptions] = useState<TrayLocationOption[]>([]);
    useEffect(() => {
        let alive = true;
        loadTrayLocationOptions()
            .then((opts) => {
                if (!alive) return;
                setTrayOptions(opts);
                setSelectedLocation((cur) => (opts.some((o) => o.code === cur) ? cur : opts[0]?.code ?? cur));
            })
            .catch(() => { /* presets already cover the select */ });
        return () => { alive = false; };
    }, []);
    const [scannedCounts, setScannedCounts] = useState<Map<string, number>>(new Map());
    const [scanInput, setScanInput] = useState("");
    const [showCamera, setShowCamera] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Reconciliation controls
    const [quarantineMissing, setQuarantineMissing] = useState(true);
    const [acceptSurplus, setAcceptSurplus] = useState(true);
    const [misplacedDecisions, setMisplacedDecisions] = useState<Record<string, "move_to_tray" | "keep_original">>({});

    const scanInputRef = useRef<HTMLInputElement>(null);

    // Compute diff dynamically based on scanned items
    const diff: TrayAuditDiff = useMemo(() => {
        return computeTrayAuditDiff(
            products.map((p) => ({
                id: p.id,
                variant_id: p.variant_id,
                sku: p.sku,
                name: p.name,
                location: p.location,
                stock: p.stock,
                image_url: p.image,
            })),
            scannedCounts,
            selectedLocation
        );
    }, [products, scannedCounts, selectedLocation]);

    useEffect(() => {
        if (open) {
            setScannedCounts(new Map());
            setScanInput("");
            setTimeout(() => scanInputRef.current?.focus(), 150);
        }
    }, [open, selectedLocation]);

    const handleScanCode = (code: string) => {
        const clean = code.trim().toUpperCase();
        if (!clean) return;

        setScannedCounts((prev) => {
            const next = new Map(prev);
            next.set(clean, (next.get(clean) || 0) + 1);
            return next;
        });

        soundEffects.playScanSuccess();
        setScanInput("");
    };

    const handleMisplacedToggle = (sku: string, action: "move_to_tray" | "keep_original") => {
        setMisplacedDecisions((prev) => ({ ...prev, [sku]: action }));
    };

    const handleCommitAudit = async () => {
        setSubmitting(true);
        try {
            const res = await commitTrayAudit(
                diff,
                {
                    quarantineMissing,
                    acceptSurplus,
                    misplacedActions: misplacedDecisions,
                },
                "Staff Auditor"
            );

            if (res.success) {
                soundEffects.playConfirmationChime();
                toast.success(
                    `Tray Audit Completed! ${res.quarantinedCount} missing quarantined, ${res.surplusAdjustedCount} surplus added, ${res.locationMovedCount} items moved to ${selectedLocation}.`
                );
                onAuditCompleted();
                onOpenChange(false);
            } else {
                toast.error(res.error || "Failed to commit audit.");
            }
        } catch (err) {
            console.error("Audit commit error:", err);
            toast.error("Failed to process audit reconciliation.");
        } finally {
            setSubmitting(false);
        }
    };

    const progressPct =
        diff.totalExpected > 0
            ? Math.min(100, Math.round((diff.totalScanned / diff.totalExpected) * 100))
            : diff.totalScanned > 0
              ? 100
              : 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col bg-surface-navy border-surface-hover text-white">
                <DialogHeader className="border-b border-surface-hover pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-base font-bold flex items-center gap-2 text-white">
                                <ScanBarcode className="size-5 text-primary" />
                                Tray &amp; Bin Barcode Cycle-Count Station
                            </DialogTitle>
                            <DialogDescription className="text-xs text-moonstone mt-0.5">
                                Physical stock audit for showcase velvet trays and storage vaults with live variance reconciliation.
                            </DialogDescription>
                        </div>

                        <div className="flex items-center gap-2">
                            <Label className="text-xs text-moonstone">Audit Tray:</Label>
                            <select
                                value={selectedLocation}
                                onChange={(e) => setSelectedLocation(e.target.value)}
                                className="h-8 rounded bg-bg-navy border border-surface-hover text-xs font-bold text-white px-2.5 focus:border-primary"
                            >
                                {trayChoices(trayOptions, selectedLocation).map((opt) => (
                                    <option key={opt.code} value={opt.code}>
                                        {trayChoiceLabel(opt)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </DialogHeader>

                <div className="space-y-4 py-3 flex-1 overflow-y-auto">
                    {/* Scanner Input Bar */}
                    <div className="rounded-xl border border-primary/40 bg-bg-navy p-3 space-y-2">
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleScanCode(scanInput);
                            }}
                            className="flex items-center gap-2"
                        >
                            <ScanBarcode className="text-primary size-5 shrink-0" />
                            <Input
                                ref={scanInputRef}
                                value={scanInput}
                                onChange={(e) => setScanInput(e.target.value)}
                                placeholder="Scan jewellery tag barcode on this tray…"
                                className="h-10 bg-surface-navy border-surface-hover text-xs font-mono text-white"
                            />
                            <Button
                                type="button"
                                variant={showCamera ? "default" : "outline"}
                                size="sm"
                                onClick={() => setShowCamera((prev) => !prev)}
                                className="h-10 px-3 text-xs"
                                title="Toggle camera scanner"
                            >
                                <Camera size={14} />
                            </Button>
                            <Button type="submit" size="sm" className="h-10 px-4 text-xs font-bold bg-primary text-primary-foreground">
                                Scan
                            </Button>
                        </form>

                        {showCamera && (
                            <BarcodeScanner onScan={(code) => handleScanCode(code)} isActive={showCamera} />
                        )}

                        {/* Audit Progress Bar */}
                        <div className="space-y-1 pt-1">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-moonstone">
                                    Audited on <span className="text-white font-semibold">{selectedLocation}</span>:{" "}
                                    <strong className="text-white font-mono">{diff.totalScanned}</strong> of{" "}
                                    <span className="font-mono">{diff.totalExpected}</span> expected pieces
                                </span>
                                <span className="font-mono text-xs font-bold text-primary">{progressPct}%</span>
                            </div>
                            <div className="h-2 w-full bg-surface-navy rounded-full overflow-hidden border border-surface-hover">
                                <div
                                    className="h-full bg-primary transition-all duration-300 rounded-full"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 4-Bucket Tabbed Variance View */}
                    <Tabs defaultValue="matched" className="w-full">
                        <TabsList className="grid grid-cols-4 bg-bg-navy p-1 rounded-lg border border-surface-hover h-9">
                            <TabsTrigger value="matched" className="text-xs data-[state=active]:bg-surface-navy data-[state=active]:text-white">
                                <CheckCircle2 size={13} className="mr-1 text-emerald-400" />
                                Matched ({diff.matched.length})
                            </TabsTrigger>
                            <TabsTrigger value="missing" className="text-xs data-[state=active]:bg-surface-navy data-[state=active]:text-white">
                                <AlertTriangle size={13} className="mr-1 text-amber-400" />
                                Missing ({diff.missing.length})
                            </TabsTrigger>
                            <TabsTrigger value="surplus" className="text-xs data-[state=active]:bg-surface-navy data-[state=active]:text-white">
                                <PlusCircle size={13} className="mr-1 text-blue-400" />
                                Surplus ({diff.surplus.length})
                            </TabsTrigger>
                            <TabsTrigger value="misplaced" className="text-xs data-[state=active]:bg-surface-navy data-[state=active]:text-white">
                                <ArrowRightLeft size={13} className="mr-1 text-purple-400" />
                                Misplaced ({diff.misplaced.length})
                            </TabsTrigger>
                        </TabsList>

                        {/* Matched Tab */}
                        <TabsContent value="matched" className="mt-3">
                            <div className="max-h-56 overflow-y-auto divide-y divide-surface-hover/40 border border-surface-hover rounded-lg bg-bg-navy/40">
                                {diff.matched.length === 0 ? (
                                    <p className="p-4 text-center text-xs text-moonstone">No matched items yet. Scan items from the tray.</p>
                                ) : (
                                    diff.matched.map((it) => (
                                        <div key={it.sku} className="p-2.5 flex items-center justify-between text-xs">
                                            <div>
                                                <span className="font-mono font-bold text-white">{it.sku}</span>
                                                <p className="text-[11px] text-moonstone truncate max-w-sm">{it.name}</p>
                                            </div>
                                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 font-mono">
                                                {it.scannedQuantity} / {it.expectedQuantity} pcs ✓
                                            </Badge>
                                        </div>
                                    ))
                                )}
                            </div>
                        </TabsContent>

                        {/* Missing Tab */}
                        <TabsContent value="missing" className="mt-3 space-y-2">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-xs text-moonstone flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={quarantineMissing}
                                        onChange={(e) => setQuarantineMissing(e.target.checked)}
                                        className="rounded border-surface-hover bg-bg-navy"
                                    />
                                    <span>Auto-quarantine unverified shortages into <span className="font-mono text-white">stock_discrepancies</span></span>
                                </label>
                            </div>
                            <div className="max-h-56 overflow-y-auto divide-y divide-surface-hover/40 border border-surface-hover rounded-lg bg-bg-navy/40">
                                {diff.missing.length === 0 ? (
                                    <p className="p-4 text-center text-xs text-emerald-400">Zero missing pieces on this tray! 🎉</p>
                                ) : (
                                    diff.missing.map((it) => (
                                        <div key={it.sku} className="p-2.5 flex items-center justify-between text-xs">
                                            <div>
                                                <span className="font-mono font-bold text-amber-300">{it.sku}</span>
                                                <p className="text-[11px] text-moonstone truncate max-w-sm">{it.name}</p>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-mono text-amber-400 font-bold block">
                                                    Missing: {it.expectedQuantity - it.scannedQuantity} pcs
                                                </span>
                                                <span className="text-[10px] text-moonstone">
                                                    Scanned {it.scannedQuantity} of {it.expectedQuantity}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </TabsContent>

                        {/* Surplus Tab */}
                        <TabsContent value="surplus" className="mt-3 space-y-2">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-xs text-moonstone flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={acceptSurplus}
                                        onChange={(e) => setAcceptSurplus(e.target.checked)}
                                        className="rounded border-surface-hover bg-bg-navy"
                                    />
                                    <span>Adjust catalog stock level with an <span className="font-mono text-white">audit_surplus</span> movement</span>
                                </label>
                            </div>
                            <div className="max-h-56 overflow-y-auto divide-y divide-surface-hover/40 border border-surface-hover rounded-lg bg-bg-navy/40">
                                {diff.surplus.length === 0 ? (
                                    <p className="p-4 text-center text-xs text-moonstone">No unrecorded surplus detected.</p>
                                ) : (
                                    diff.surplus.map((it) => (
                                        <div key={it.sku} className="p-2.5 flex items-center justify-between text-xs">
                                            <div>
                                                <span className="font-mono font-bold text-blue-300">{it.sku}</span>
                                                <p className="text-[11px] text-moonstone truncate max-w-sm">{it.name}</p>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-mono text-blue-400 font-bold block">
                                                    +{it.scannedQuantity - it.expectedQuantity} Extra
                                                </span>
                                                <span className="text-[10px] text-moonstone">
                                                    Scanned {it.scannedQuantity}, expected {it.expectedQuantity}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </TabsContent>

                        {/* Misplaced Tab */}
                        <TabsContent value="misplaced" className="mt-3">
                            <div className="max-h-56 overflow-y-auto divide-y divide-surface-hover/40 border border-surface-hover rounded-lg bg-bg-navy/40">
                                {diff.misplaced.length === 0 ? (
                                    <p className="p-4 text-center text-xs text-moonstone">No misplaced items from other trays found here.</p>
                                ) : (
                                    diff.misplaced.map((it) => {
                                        const action = misplacedDecisions[it.sku] || "move_to_tray";
                                        return (
                                            <div key={it.sku} className="p-2.5 flex items-center justify-between text-xs">
                                                <div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-mono font-bold text-purple-300">{it.sku}</span>
                                                        <span className="text-[10px] text-moonstone">
                                                            (Catalog location: {it.expectedLocation})
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-moonstone truncate max-w-sm">{it.name}</p>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={action === "move_to_tray" ? "default" : "outline"}
                                                        onClick={() => handleMisplacedToggle(it.sku, "move_to_tray")}
                                                        className="h-7 text-[10px] px-2"
                                                    >
                                                        Move to {selectedLocation}
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={action === "keep_original" ? "default" : "ghost"}
                                                        onClick={() => handleMisplacedToggle(it.sku, "keep_original")}
                                                        className="h-7 text-[10px] px-2 text-moonstone"
                                                    >
                                                        Keep Original
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="border-t border-surface-hover pt-3 flex justify-between items-center">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        className="h-9 text-xs text-moonstone hover:text-white"
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        disabled={submitting || (diff.totalScanned === 0 && diff.missing.length === 0)}
                        onClick={() => void handleCommitAudit()}
                        className="h-9 text-xs font-bold bg-primary text-primary-foreground"
                    >
                        {submitting ? <Loader2 size={13} className="animate-spin mr-1" /> : <CheckCircle2 size={13} className="mr-1" />}
                        Commit Reconciliation
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
