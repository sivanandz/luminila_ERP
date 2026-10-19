"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
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
import { pb } from "@/lib/pocketbase";
import { dispatchOrderMilestoneWhatsApp } from "@/lib/order-milestones";
import { CourierCarrier, fetchStCourierLiveTracking } from "@/lib/logistics-engine";
import { MobileScanner } from "@/lib/mobile-scanner";
import {
    ScanBarcode,
    Truck,
    Send,
    CheckCircle2,
    Search,
    Loader2,
    Package,
    User,
    Phone,
    MapPin,
    ExternalLink,
    AlertCircle,
    Volume2,
} from "lucide-react";

export interface OrderItemSummary {
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string | null;
    status: string;
    total: number;
    shipping_address?: string;
    created?: string;
}

interface BarcodeScanDispatchModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preselectedOrder?: OrderItemSummary | null;
    onDispatched?: () => void;
}

export function BarcodeScanDispatchModal({
    open,
    onOpenChange,
    preselectedOrder,
    onDispatched,
}: BarcodeScanDispatchModalProps) {
    const barcodeInputRef = useRef<HTMLInputElement>(null);
    const [barcode, setBarcode] = useState("");
    const [carrier, setCarrier] = useState<CourierCarrier>("st_courier");
    const [orders, setOrders] = useState<OrderItemSummary[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<OrderItemSummary | null>(preselectedOrder || null);
    const [searchQuery, setSearchQuery] = useState("");
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [dispatching, setDispatching] = useState(false);
    const [checkingTracking, setCheckingTracking] = useState(false);
    const [trackingPreview, setTrackingPreview] = useState<{
        statusText: string;
        origin?: string;
        destination?: string;
        isValid: boolean;
    } | null>(null);

    // Audio chime tone generator on successful scan
    const playSuccessTone = () => {
        try {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.22);
        } catch {
            // Audio optional
        }
    };

    // Auto-focus barcode input when modal opens
    useEffect(() => {
        if (open) {
            setTimeout(() => {
                barcodeInputRef.current?.focus();
            }, 100);
            fetchPendingOrders();
        } else {
            setBarcode("");
            setTrackingPreview(null);
        }
    }, [open]);

    // High-priority hardware scanner listener: strictly intercepts courier AWBs when dispatch modal is active
    useEffect(() => {
        if (!open) return;
        const unregister = MobileScanner.registerContext("shipping_awb", (result) => {
            handleBarcodeChange(result.barcode);
            playSuccessTone();
            return true; // Stop propagation: prevent billing or catalog interference
        }, 100);
        return () => unregister();
    }, [open]);

    // Keep preselected order in sync if passed
    useEffect(() => {
        if (preselectedOrder) {
            setSelectedOrder(preselectedOrder);
        }
    }, [preselectedOrder]);

    const fetchPendingOrders = async () => {
        setLoadingOrders(true);
        try {
            const records = await pb.collection("sales_orders").getList(1, 30, {
                filter: 'status != "delivered" && status != "cancelled"',
                sort: "-created",
            });
            const mapped = records.items.map((r) => ({
                id: r.id,
                order_number: r.order_number || r.id.slice(0, 8),
                customer_name: r.customer_name || "Valued Customer",
                customer_phone: r.customer_phone || null,
                status: r.status,
                total: r.total || 0,
                shipping_address: r.shipping_address,
                created: r.created,
            }));
            setOrders(mapped);
        } catch (err) {
            console.error("Error fetching pending orders for barcode scanning:", err);
        } finally {
            setLoadingOrders(false);
        }
    };

    // Intelligent Carrier Detection & Live Reverse-Engineered Preview
    const handleBarcodeChange = (val: string) => {
        const clean = val.trim().replace(/[*]/g, "");
        setBarcode(clean);

        // Auto-detect carrier
        if (/^\d{11}$/.test(clean)) {
            setCarrier("st_courier");
            fetchStCourierPreview(clean);
        } else if (/^DLV/i.test(clean) || (clean.length === 12 && /^\d+$/.test(clean))) {
            setCarrier("delhivery");
            setTrackingPreview(null);
        } else if (/^SR/i.test(clean)) {
            setCarrier("shiprocket");
            setTrackingPreview(null);
        } else if (/^BLD/i.test(clean) || (clean.length === 8 && /^\d+$/.test(clean))) {
            setCarrier("bluedart");
            setTrackingPreview(null);
        } else if (/^DTDC/i.test(clean)) {
            setCarrier("dtdc");
            setTrackingPreview(null);
        } else {
            setTrackingPreview(null);
        }
    };

    const fetchStCourierPreview = async (awb: string) => {
        setCheckingTracking(true);
        try {
            const data = await fetchStCourierLiveTracking(awb);
            if (data.isValid) {
                playSuccessTone();
                setTrackingPreview({
                    statusText: data.statusText || data.summary?.currentStatus || "Registered",
                    origin: data.summary?.origin,
                    destination: data.summary?.destination,
                    isValid: true,
                });
            } else {
                setTrackingPreview({
                    statusText: "New / Unindexed AWB (Fresh Offline Booking)",
                    isValid: true,
                });
            }
        } catch {
            setTrackingPreview({
                statusText: "Live Check Pending (Offline Booking)",
                isValid: true,
            });
        } finally {
            setCheckingTracking(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const clean = barcode.trim().replace(/[*]/g, "");
            if (clean.length >= 8) {
                playSuccessTone();
                toast.success(`AWB Barcode Scanned: ${clean}`);
            }
        }
    };

    const handleTagAndDispatch = async () => {
        const cleanAwb = barcode.trim().replace(/[*]/g, "");
        if (!cleanAwb) {
            toast.error("Please scan or enter an AWB tracking number");
            barcodeInputRef.current?.focus();
            return;
        }

        if (carrier === "st_courier" && !/^\d{11}$/.test(cleanAwb)) {
            toast.error(`ST Courier AWB must be exactly 11 digits (Current: ${cleanAwb.length} digits)`);
            return;
        }

        if (!selectedOrder) {
            toast.error("Please select a customer order to tag this shipment to");
            return;
        }

        if (!selectedOrder.customer_phone) {
            toast.error(`Order #${selectedOrder.order_number} has no customer phone number on file`);
            return;
        }

        setDispatching(true);
        try {
            // Generate live tracking link
            const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
            let trackingUrl = `${baseUrl}/tracking/st-courier?awb=${cleanAwb}`;
            let carrierTitle = "ST Courier";

            if (carrier === "delhivery") {
                trackingUrl = `https://www.delhivery.com/track/package/${cleanAwb}`;
                carrierTitle = "Delhivery Express";
            } else if (carrier === "shiprocket") {
                trackingUrl = `https://shiprocket.co/tracking/${cleanAwb}`;
                carrierTitle = "Shiprocket";
            } else if (carrier === "bluedart") {
                trackingUrl = `https://www.bluedart.com/tracking?handler=trak&numbers=${cleanAwb}`;
                carrierTitle = "Blue Dart Express";
            } else if (carrier === "dtdc") {
                trackingUrl = `https://www.dtdc.in/tracking/shipment-tracking.asp?awb=${cleanAwb}`;
                carrierTitle = "DTDC Courier";
            }

            // 1. Dispatch VIP WhatsApp notification with live link
            const waRes = await dispatchOrderMilestoneWhatsApp({
                orderId: selectedOrder.id,
                orderNumber: selectedOrder.order_number,
                customerName: selectedOrder.customer_name,
                customerPhone: selectedOrder.customer_phone,
                milestone: "shipped",
                courierName: carrierTitle,
                trackingNumber: cleanAwb,
                trackingUrl,
                notes: "Dispatched via Barcode Scan Station",
            });

            // 2. Update order status to 'shipped' in PocketBase
            try {
                await pb.collection("sales_orders").update(selectedOrder.id, {
                    status: "shipped",
                });
            } catch (updateErr) {
                console.warn("Could not update sales_orders status directly:", updateErr);
            }

            // 3. Register shipment in shipments collection if exists
            try {
                await pb.collection("shipments").create({
                    order_id: selectedOrder.id,
                    carrier,
                    awb_number: cleanAwb,
                    shipping_status: "manifested",
                    tracking_url: trackingUrl,
                    cod_amount: 0,
                    weight_grams: 100,
                });
            } catch {
                // shipments collection optional
            }

            playSuccessTone();

            if (waRes.success) {
                toast.success(`✨ WhatsApp tracking sent to ${selectedOrder.customer_name} (${selectedOrder.customer_phone})!`);
            } else {
                toast.warning(`Order marked shipped. WhatsApp warning: ${waRes.error || "Failed to deliver"}`);
            }

            onDispatched?.();

            // Reset barcode for next parcel scan
            setBarcode("");
            setTrackingPreview(null);
            if (!preselectedOrder) {
                setSelectedOrder(null);
            }
            setTimeout(() => {
                barcodeInputRef.current?.focus();
            }, 200);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`Dispatch failed: ${message}`);
        } finally {
            setDispatching(false);
        }
    };

    const filteredOrders = orders.filter(
        (o) =>
            o.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            o.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (o.customer_phone && o.customer_phone.includes(searchQuery))
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl bg-surface-navy border border-surface-hover text-white p-6 shadow-2xl">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                        <ScanBarcode className="text-emerald-400 w-5 h-5" />
                        Quick Barcode Scan & WhatsApp Dispatch
                    </DialogTitle>
                    <DialogDescription className="text-xs text-moonstone">
                        Scan physical AWB docket barcode, match to customer order, and fire 1-click WhatsApp live tracking.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 my-2">
                    {/* Scanner Input Station */}
                    <div className="bg-bg-navy/80 border-2 border-emerald-500/40 rounded-xl p-4 space-y-3 relative overflow-hidden group">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-emerald-400 uppercase flex items-center gap-1.5 tracking-wider">
                                <ScanBarcode size={16} className="animate-pulse" />
                                Scan AWB Barcode (USB / Wireless Scanner)
                            </label>
                            <span className="text-[10px] text-moonstone font-mono flex items-center gap-1">
                                <Volume2 size={12} className="text-emerald-400" /> Auto-Chime Active
                            </span>
                        </div>

                        <div className="relative">
                            <Input
                                ref={barcodeInputRef}
                                value={barcode}
                                onChange={(e) => handleBarcodeChange(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Scan barcode or enter 11-digit AWB (e.g. 64437374632)..."
                                className="bg-surface-navy border border-emerald-500/50 text-white font-mono text-base font-bold pl-10 pr-24 h-12 rounded-lg focus-visible:ring-emerald-400"
                            />
                            <ScanBarcode size={18} className="absolute left-3.5 top-3.5 text-emerald-400" />
                            {checkingTracking ? (
                                <div className="absolute right-3 top-3.5 flex items-center gap-1.5 text-xs text-amber-400">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>Verifying</span>
                                </div>
                            ) : barcode.length === 11 && /^\d+$/.test(barcode) ? (
                                <Badge className="absolute right-2.5 top-3 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono">
                                    ST Courier 11D
                                </Badge>
                            ) : null}
                        </div>

                        {/* Carrier Selector & Detected Pill */}
                        <div className="flex items-center justify-between pt-1">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-moonstone font-medium">Carrier:</span>
                                <select
                                    value={carrier}
                                    onChange={(e) => setCarrier(e.target.value as CourierCarrier)}
                                    className="bg-surface-navy border border-surface-hover rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-400"
                                >
                                    <option value="st_courier">ST Courier (Tamil Nadu / South)</option>
                                    <option value="delhivery">Delhivery Express</option>
                                    <option value="shiprocket">Shiprocket Multi-Carrier</option>
                                    <option value="bluedart">Blue Dart Express</option>
                                    <option value="dtdc">DTDC Express</option>
                                </select>
                            </div>

                            {carrier === "st_courier" && (
                                <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-300 border-amber-500/30">
                                    Reverse-Engineered 1-Click Link
                                </Badge>
                            )}
                        </div>

                        {/* Live ST Courier Intelligence Card */}
                        {trackingPreview && (
                            <div className="bg-surface-navy border border-emerald-500/30 rounded-lg p-2.5 text-xs space-y-1">
                                <div className="flex items-center justify-between font-semibold text-white">
                                    <span className="flex items-center gap-1.5 text-emerald-400">
                                        <CheckCircle2 size={14} />
                                        ST Courier Live Status: {trackingPreview.statusText}
                                    </span>
                                    <a
                                        href={`/tracking/st-courier?awb=${barcode}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                                    >
                                        Open Tracking Page <ExternalLink size={10} />
                                    </a>
                                </div>
                                {trackingPreview.origin && trackingPreview.destination && (
                                    <p className="text-[11px] text-moonstone">
                                        Transit Route: <strong className="text-white">{trackingPreview.origin}</strong> → <strong className="text-white">{trackingPreview.destination}</strong>
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Customer & Order Matcher */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-moonstone uppercase tracking-wide flex items-center gap-1">
                                <User size={13} className="text-primary" />
                                Tag to Customer Order
                            </label>
                            {selectedOrder && (
                                <button
                                    onClick={() => setSelectedOrder(null)}
                                    className="text-[11px] text-destructive hover:underline"
                                >
                                    Change Order
                                </button>
                            )}
                        </div>

                        {selectedOrder ? (
                            <div className="bg-surface-navy border border-primary/40 rounded-lg p-3 flex items-start justify-between">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-white text-sm">
                                            #{selectedOrder.order_number} — {selectedOrder.customer_name}
                                        </span>
                                        <Badge variant="outline" className="text-[10px] uppercase">
                                            {selectedOrder.status}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-moonstone">
                                        <span className="flex items-center gap-1 text-emerald-400">
                                            <Phone size={12} /> {selectedOrder.customer_phone || "No Phone"}
                                        </span>
                                        {selectedOrder.shipping_address && (
                                            <span className="flex items-center gap-1 truncate max-w-xs">
                                                <MapPin size={12} /> {selectedOrder.shipping_address}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <CheckCircle2 className="text-primary w-5 h-5 shrink-0" />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-3 text-moonstone" />
                                    <Input
                                        placeholder="Search by customer name, phone, or order #..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="bg-bg-navy border border-surface-hover pl-9 h-9 text-xs text-white"
                                    />
                                </div>

                                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                                    {loadingOrders ? (
                                        <div className="p-4 text-center text-xs text-moonstone">
                                            <Loader2 size={16} className="animate-spin mx-auto mb-1 text-primary" />
                                            Loading open orders...
                                        </div>
                                    ) : filteredOrders.length === 0 ? (
                                        <div className="p-4 text-center text-xs text-moonstone">
                                            No matching orders found.
                                        </div>
                                    ) : (
                                        filteredOrders.map((o) => (
                                            <div
                                                key={o.id}
                                                onClick={() => setSelectedOrder(o)}
                                                className="p-2.5 rounded-lg border border-surface-hover hover:border-primary/50 bg-bg-navy/40 hover:bg-bg-navy cursor-pointer flex items-center justify-between transition-colors"
                                            >
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-xs text-white">#{o.order_number}</span>
                                                        <span className="text-xs text-white">{o.customer_name}</span>
                                                    </div>
                                                    <span className="text-[11px] text-moonstone">{o.customer_phone || "No Phone"}</span>
                                                </div>
                                                <Badge variant="outline" className="text-[10px] font-mono">
                                                    ₹{o.total.toLocaleString("en-IN")}
                                                </Badge>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Action */}
                <div className="flex items-center justify-between pt-2 border-t border-surface-hover">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-moonstone hover:text-white text-xs"
                    >
                        Close
                    </Button>

                    <Button
                        onClick={handleTagAndDispatch}
                        disabled={dispatching || !barcode.trim() || !selectedOrder}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 h-10 shadow-lg shadow-emerald-900/30"
                    >
                        {dispatching ? (
                            <Loader2 size={14} className="animate-spin mr-1.5" />
                        ) : (
                            <Send size={14} className="mr-1.5" />
                        )}
                        Tag AWB & Send WhatsApp Tracking
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
