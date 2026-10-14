"use client";

import React, { useState, useRef, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { pb } from "@/lib/pocketbase";
import { MobileScanner } from "@/lib/mobile-scanner";
import { ScanBarcode, Camera, Search, Loader2, CheckCircle2, Volume2 } from "lucide-react";
import dynamic from "next/dynamic";

const CameraScanner = dynamic(
    () => import("@/components/pos/BarcodeScanner").then((mod) => mod.BarcodeScanner),
    { ssr: false }
);

export interface ScannedItemPayload {
    barcode: string;
    product?: {
        id: string;
        name: string;
        sku: string;
        base_price: number;
        category?: string;
        hsn_code?: string;
        stock?: number;
    };
    variant?: {
        id: string;
        size?: string;
        color?: string;
        material?: string;
        price_adjustment?: number;
    };
}

interface QuickBarcodeScanModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title?: string;
    onItemScanned: (item: ScannedItemPayload) => void;
}

export function QuickBarcodeScanModal({
    open,
    onOpenChange,
    title = "Quick Barcode Scanner",
    onItemScanned,
}: QuickBarcodeScanModalProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [scannedCode, setScannedCode] = useState("");
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [resolvedInfo, setResolvedInfo] = useState<ScannedItemPayload | null>(null);

    const playChime = () => {
        try {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(987.77, ctx.currentTime); // B5
            osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.08); // E6
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.22);
        } catch {
            // Audio optional
        }
    };

    useEffect(() => {
        if (open) {
            setScannedCode("");
            setResolvedInfo(null);
            setTimeout(() => inputRef.current?.focus(), 150);
        } else {
            setIsCameraActive(false);
        }
    }, [open]);

    // High-priority hardware scanner listener: captures scans into this modal and prevents background leaks
    useEffect(() => {
        if (!open) return;
        const unregister = MobileScanner.registerContext("active_modal", (result) => {
            setScannedCode(result.barcode);
            handleResolve(result.barcode);
            return true; // Stop propagation
        }, 90);
        return () => unregister();
    }, [open]);

    const handleResolve = async (code: string) => {
        const clean = code.trim().replace(/[*]/g, "");
        if (!clean) return;

        setResolving(true);
        playChime();

        try {
            // 1. Search products by SKU or barcode
            let prodRecord = null;
            let variantRecord = null;

            try {
                const prodList = await pb.collection("products").getList(1, 1, {
                    filter: `sku = "${clean}" || barcode = "${clean}"`,
                });
                if (prodList.items.length > 0) {
                    prodRecord = prodList.items[0];
                }
            } catch {
                // Ignore query error
            }

            // 2. If not found in product root, check product_variants
            if (!prodRecord) {
                try {
                    const varList = await pb.collection("product_variants").getList(1, 1, {
                        filter: `sku_suffix = "${clean}" || barcode = "${clean}"`,
                        expand: "product",
                    });
                    if (varList.items.length > 0) {
                        variantRecord = varList.items[0];
                        prodRecord = varList.items[0].expand?.product || null;
                    }
                } catch {
                    // Ignore query error
                }
            }

            const payload: ScannedItemPayload = {
                barcode: clean,
                product: prodRecord ? {
                    id: prodRecord.id,
                    name: prodRecord.name,
                    sku: prodRecord.sku,
                    base_price: prodRecord.base_price || prodRecord.price || 0,
                    category: prodRecord.category,
                    hsn_code: prodRecord.hsn_code,
                    stock: prodRecord.stock,
                } : undefined,
                variant: variantRecord ? {
                    id: variantRecord.id,
                    size: variantRecord.size,
                    color: variantRecord.color,
                    material: variantRecord.material,
                    price_adjustment: variantRecord.price_adjustment,
                } : undefined,
            };

            setResolvedInfo(payload);
            onItemScanned(payload);

            // Close after brief visual confirmation
            setTimeout(() => {
                onOpenChange(false);
            }, 500);
        } catch (err) {
            console.error("Error resolving barcode:", err);
            onItemScanned({ barcode: clean });
            onOpenChange(false);
        } finally {
            setResolving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleResolve(scannedCode);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md bg-surface-navy border border-surface-hover text-white p-5">
                <DialogHeader>
                    <DialogTitle className="text-base font-bold flex items-center gap-2">
                        <ScanBarcode size={18} className="text-emerald-400" />
                        {title}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 my-2">
                    {/* Hardware Scanner Input Station */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-moonstone">
                            <span className="flex items-center gap-1 text-emerald-400">
                                <ScanBarcode size={14} className="animate-pulse" />
                                USB / Wireless Barcode Gun Ready
                            </span>
                            <span className="text-[10px] text-moonstone font-mono flex items-center gap-1">
                                <Volume2 size={12} className="text-emerald-400" /> Audio Chime
                            </span>
                        </div>

                        <div className="relative">
                            <Input
                                ref={inputRef}
                                value={scannedCode}
                                onChange={(e) => setScannedCode(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Scan barcode or type SKU..."
                                className="bg-bg-navy border border-emerald-500/40 text-white font-mono text-sm pl-10 h-11 rounded-lg focus-visible:ring-emerald-400"
                            />
                            <ScanBarcode size={18} className="absolute left-3 top-3 text-emerald-400" />
                        </div>
                    </div>

                    {/* Camera Toggle Option */}
                    <div className="pt-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsCameraActive(!isCameraActive)}
                            className="w-full text-xs border-surface-hover hover:border-emerald-500/40 text-moonstone hover:text-white"
                        >
                            <Camera size={14} className="mr-1.5 text-emerald-400" />
                            {isCameraActive ? "Switch to USB / Handheld Gun" : "Use Phone / Web Camera Scanner"}
                        </Button>

                        {isCameraActive && (
                            <div className="mt-3 rounded-lg overflow-hidden border border-emerald-500/30">
                                <CameraScanner
                                    onScan={(code) => {
                                        setScannedCode(code);
                                        handleResolve(code);
                                    }}
                                    isActive={isCameraActive}
                                />
                            </div>
                        )}
                    </div>

                    {/* Resolved Match Pill */}
                    {resolving && (
                        <div className="p-3 bg-bg-navy/60 rounded-lg flex items-center justify-center gap-2 text-xs text-amber-400">
                            <Loader2 size={14} className="animate-spin" />
                            <span>Looking up jewelry catalog records...</span>
                        </div>
                    )}

                    {resolvedInfo?.product && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center justify-between text-xs text-emerald-400">
                            <div>
                                <div className="font-bold text-white">{resolvedInfo.product.name}</div>
                                <div className="font-mono text-[11px] text-moonstone">{resolvedInfo.product.sku}</div>
                            </div>
                            <CheckCircle2 size={18} className="text-emerald-400" />
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-surface-hover">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-xs text-moonstone">
                        Cancel
                    </Button>
                    <Button
                        onClick={() => handleResolve(scannedCode)}
                        disabled={!scannedCode.trim() || resolving}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-9 px-4"
                    >
                        Apply Scanned Code
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
