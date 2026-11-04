"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    ScanBarcode,
    Truck,
    PackageCheck,
    CheckCircle2,
    RefreshCw,
    Loader2,
    AlertCircle,
    ArrowRight,
} from "lucide-react";
import {
    type QueueOrder,
    type PackingQueue,
    findOrderBySlipScan,
    PACKAGING_PRESETS,
    getLatestSessionForOrder,
} from "@/lib/packing";
import { createShipmentForOrder } from "@/lib/shipments";
import { dispatchOrderMilestoneWhatsApp } from "@/lib/order-milestones";
import { getCurrentTenantEmail, pb } from "@/lib/pocketbase";
import { soundEffects } from "@/lib/sound-effects";
import { CourierCarrier, fetchStCourierLiveTracking } from "@/lib/logistics-engine";
import { MobileScanner } from "@/lib/mobile-scanner";

interface RapidManifestPanelProps {
    queue: PackingQueue;
    onQueueRefresh: () => void;
}

export function RapidManifestPanel({ queue, onQueueRefresh }: RapidManifestPanelProps) {
    const [step, setStep] = useState<"awaiting_slip" | "awaiting_awb">("awaiting_slip");
    const [activeOrder, setActiveOrder] = useState<QueueOrder | null>(null);
    const [selectedWeightGrams, setSelectedWeightGrams] = useState<number>(100);
    const [selectedPresetId, setSelectedPresetId] = useState<string>("velvet_box");
    const [scanInput, setScanInput] = useState("");
    const [dispatching, setDispatching] = useState(false);
    const [lastDispatchedOrder, setLastDispatchedOrder] = useState<string | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, [step]);

    const handleSlipScan = useCallback(async (code: string) => {
        const clean = code.trim().toUpperCase();
        if (!clean) return;

        const matchedOrder = findOrderBySlipScan(clean, queue);
        if (!matchedOrder) {
            soundEffects.playScanError();
            toast.error(`Order slip "${clean}" not found in packing queue.`);
            return;
        }

        // Check latest session packaging preset
        try {
            const session = await getLatestSessionForOrder(matchedOrder.id);
            if (session?.weight_grams) {
                setSelectedWeightGrams(session.weight_grams);
            }
            if (session?.packaging_preset) {
                setSelectedPresetId(session.packaging_preset);
            }
        } catch {}

        soundEffects.playScanSuccess();
        setActiveOrder(matchedOrder);
        setStep("awaiting_awb");
        toast.info(`Slip verified: ${matchedOrder.order_number}. Now scan the courier AWB.`);
    }, [queue]);

    const handleAwbScan = useCallback(async (awbCode: string) => {
        const cleanAwb = awbCode.trim().replace(/[*]/g, "");
        if (!cleanAwb || !activeOrder) return;

        // Auto-detect carrier
        let carrier: CourierCarrier = "st_courier";
        let carrierTitle = "ST Courier";
        let trackingUrl = "";

        if (/^\d{11}$/.test(cleanAwb)) {
            carrier = "st_courier";
            carrierTitle = "ST Courier";
            trackingUrl = `/tracking/st-courier?awb=${cleanAwb}`;
        } else if (/^DLV/i.test(cleanAwb) || (cleanAwb.length === 12 && /^\d+$/.test(cleanAwb))) {
            carrier = "delhivery";
            carrierTitle = "Delhivery Express";
            trackingUrl = `https://www.delhivery.com/track/package/${cleanAwb}`;
        } else if (/^SR/i.test(cleanAwb)) {
            carrier = "shiprocket";
            carrierTitle = "Shiprocket";
            trackingUrl = `https://shiprocket.co/tracking/${cleanAwb}`;
        } else if (/^BLD/i.test(cleanAwb) || (cleanAwb.length === 8 && /^\d+$/.test(cleanAwb))) {
            carrier = "bluedart";
            carrierTitle = "Blue Dart Express";
            trackingUrl = `https://www.bluedart.com/tracking?handler=trak&numbers=${cleanAwb}`;
        } else if (/^DTDC/i.test(cleanAwb)) {
            carrier = "dtdc";
            carrierTitle = "DTDC Courier";
            trackingUrl = `https://www.dtdc.in/tracking/shipment-tracking.asp?awb=${cleanAwb}`;
        } else {
            carrierTitle = "Courier Partner";
        }

        setDispatching(true);
        try {
            // 1. Create shipment with preset weight
            const shipmentRes = await createShipmentForOrder(pb, getCurrentTenantEmail(), {
                orderId: activeOrder.id,
                carrier,
                awbNumber: cleanAwb,
                trackingUrl,
                weightGrams: selectedWeightGrams,
            });

            if (!shipmentRes.success) {
                throw new Error(shipmentRes.error || "Could not register shipment.");
            }

            // 2. Dispatch WhatsApp milestone tracking update if customer phone exists
            if (activeOrder.customer_phone) {
                await dispatchOrderMilestoneWhatsApp({
                    orderId: activeOrder.id,
                    orderNumber: activeOrder.order_number,
                    customerName: activeOrder.customer_name,
                    customerPhone: activeOrder.customer_phone,
                    milestone: "shipped",
                    courierName: carrierTitle,
                    trackingNumber: cleanAwb,
                    trackingUrl,
                    notes: `Dispatched via 2-Scan Rapid Conveyor (${selectedWeightGrams}g)`,
                }).catch((err) => console.warn("WhatsApp notification warning:", err));
            }

            soundEffects.playConfirmationChime();
            setLastDispatchedOrder(activeOrder.order_number);
            toast.success(
                `🎉 ${activeOrder.order_number} Dispatched via ${carrierTitle} (${cleanAwb})!`
            );

            // Reset conveyor for next parcel
            setActiveOrder(null);
            setStep("awaiting_slip");
            onQueueRefresh();
        } catch (err) {
            console.error("Rapid manifest dispatch failed:", err);
            soundEffects.playScanError();
            toast.error(err instanceof Error ? err.message : "Failed to dispatch parcel.");
        } finally {
            setDispatching(false);
        }
    }, [activeOrder, selectedWeightGrams, onQueueRefresh]);

    const handleScanSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const code = scanInput.trim();
        setScanInput("");
        if (!code) return;

        if (step === "awaiting_slip") {
            void handleSlipScan(code);
        } else {
            void handleAwbScan(code);
        }
    };

    const resetConveyor = () => {
        setActiveOrder(null);
        setStep("awaiting_slip");
        setScanInput("");
    };

    return (
        <div className="rounded-xl border border-surface-hover bg-surface-navy p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Truck className="size-5 text-primary" />
                    <div>
                        <h3 className="text-sm font-bold text-white">Hands-Free 2-Scan Rapid Manifest Mode</h3>
                        <p className="text-xs text-moonstone">
                            Conveyor mode: Scan Packing Slip → Scan Courier AWB Barcode → Auto-Dispatch
                        </p>
                    </div>
                </div>
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs">
                    {queue.packedAwaitingDispatch.length} Parcels Ready for Manifest
                </Badge>
            </div>

            {/* Stepper visual */}
            <div className="grid grid-cols-2 gap-3">
                <div
                    className={`p-3 rounded-lg border flex items-center gap-3 transition-colors ${
                        step === "awaiting_slip"
                            ? "border-primary bg-primary/10 text-white"
                            : "border-surface-hover bg-bg-navy/60 text-moonstone"
                    }`}
                >
                    <div
                        className={`size-6 rounded-full flex items-center justify-center font-bold text-xs ${
                            step === "awaiting_slip"
                                ? "bg-primary text-primary-foreground"
                                : "bg-emerald-500/20 text-emerald-400"
                        }`}
                    >
                        {activeOrder ? "✓" : "1"}
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-bold truncate">Step 1: Scan Packing Slip</p>
                        <p className="text-[10px] text-moonstone truncate">
                            {activeOrder ? activeOrder.order_number : "Hardware gun or keyboard"}
                        </p>
                    </div>
                </div>

                <div
                    className={`p-3 rounded-lg border flex items-center gap-3 transition-colors ${
                        step === "awaiting_awb"
                            ? "border-primary bg-primary/10 text-white"
                            : "border-surface-hover bg-bg-navy/60 text-moonstone"
                    }`}
                >
                    <div
                        className={`size-6 rounded-full flex items-center justify-center font-bold text-xs ${
                            step === "awaiting_awb"
                                ? "bg-primary text-primary-foreground"
                                : "bg-surface-hover text-moonstone"
                        }`}
                    >
                        2
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-bold truncate">Step 2: Scan Courier AWB</p>
                        <p className="text-[10px] text-moonstone truncate">
                            {step === "awaiting_awb" ? "ST Courier / Delhivery / etc." : "Awaiting slip"}
                        </p>
                    </div>
                </div>
            </div>

            {/* Active order card if in Step 2 */}
            {activeOrder && (
                <div className="p-3.5 rounded-lg border border-primary/40 bg-bg-navy flex items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-primary">
                                {activeOrder.order_number}
                            </span>
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                                Packed &amp; Verified
                            </Badge>
                        </div>
                        <p className="text-xs text-white mt-0.5">
                            {activeOrder.customer_name} · {activeOrder.customer_phone || "No phone"}
                        </p>
                        <p className="text-[10px] text-moonstone mt-0.5 truncate max-w-md">
                            {activeOrder.shipping_address || "No shipping address on file"}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <label className="text-[10px] text-moonstone block">Packaging Tare Weight:</label>
                            <select
                                value={selectedPresetId}
                                onChange={(e) => {
                                    const preset = PACKAGING_PRESETS.find((p) => p.id === e.target.value);
                                    if (preset) {
                                        setSelectedPresetId(preset.id);
                                        setSelectedWeightGrams(preset.weightGrams);
                                    }
                                }}
                                className="h-8 rounded bg-surface-navy border border-surface-hover text-xs text-white font-mono px-2"
                            >
                                {PACKAGING_PRESETS.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} ({p.weightGrams}g)
                                    </option>
                                ))}
                            </select>
                        </div>

                        <Button variant="ghost" size="sm" onClick={resetConveyor} className="h-8 text-xs text-moonstone hover:text-white">
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {/* Barcode scanner input */}
            <form onSubmit={handleScanSubmit} className="flex gap-2">
                <div className="relative flex-1">
                    <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 text-primary size-4" />
                    <Input
                        ref={inputRef}
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        placeholder={
                            step === "awaiting_slip"
                                ? "Scan packing slip barcode (e.g. SO/2611/00001)…"
                                : "Scan courier AWB barcode label (e.g. ST Courier 11-digit or Delhivery)…"
                        }
                        disabled={dispatching}
                        className="h-12 pl-9 bg-bg-navy border-surface-hover text-sm font-mono text-white placeholder:text-moonstone/60"
                    />
                </div>
                <Button type="submit" disabled={dispatching || !scanInput.trim()} className="h-12 px-6 font-bold bg-primary text-primary-foreground">
                    {dispatching ? <Loader2 size={16} className="animate-spin" /> : "Process Scan"}
                </Button>
            </form>

            {lastDispatchedOrder && (
                <p className="text-[11px] text-emerald-400 font-mono text-center">
                    ✓ Last parcel dispatched: <span className="font-bold">{lastDispatchedOrder}</span>
                </p>
            )}
        </div>
    );
}
