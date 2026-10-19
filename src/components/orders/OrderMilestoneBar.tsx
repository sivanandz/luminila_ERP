"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
    CheckCircle2,
    Package,
    Truck,
    ShieldCheck,
    Send,
    Camera,
    Loader2,
    MessageCircle,
    ExternalLink,
    Upload,
    Sparkles,
    ScanBarcode,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    dispatchOrderMilestoneWhatsApp,
    type OrderMilestoneType,
} from "@/lib/order-milestones";
import { BarcodeScanDispatchModal } from "@/components/orders/BarcodeScanDispatchModal";

export interface OrderMilestoneBarProps {
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerPhone?: string;
    initialStatus?: string;
    onMilestoneDispatched?: () => void;
}

export function OrderMilestoneBar({
    orderId,
    orderNumber,
    customerName,
    customerPhone,
    initialStatus = "confirmed",
    onMilestoneDispatched,
}: OrderMilestoneBarProps) {
    const [selectedMilestone, setSelectedMilestone] = useState<OrderMilestoneType>("packed");
    const [huid, setHuid] = useState("LUM-QC994");
    const [courierName, setCourierName] = useState("ST Courier");
    const [trackingNumber, setTrackingNumber] = useState("64437374632");
    const [trackingUrl, setTrackingUrl] = useState("/tracking/st-courier?awb=");
    const [photoUrl, setPhotoUrl] = useState<string>("");
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [dispatching, setDispatching] = useState(false);
    const [scanModalOpen, setScanModalOpen] = useState(false);

    const handleTrackingNumberChange = (val: string) => {
        const clean = val.trim().replace(/[*]/g, "");
        setTrackingNumber(clean);
        // Auto-detect ST Courier 11-digit format
        if (/^\d{11}$/.test(clean)) {
            setCourierName("ST Courier");
            setTrackingUrl("/tracking/st-courier?awb=");
        } else if (/^DLV/i.test(clean) || (clean.length === 12 && /^\d+$/.test(clean))) {
            setCourierName("Delhivery Express");
            setTrackingUrl("https://www.delhivery.com/track/package/");
        } else if (/^SR/i.test(clean)) {
            setCourierName("Shiprocket");
            setTrackingUrl("https://shiprocket.co/tracking/");
        } else if (/^BLD/i.test(clean)) {
            setCourierName("Blue Dart");
            setTrackingUrl("https://www.bluedart.com/tracking?handler=trak&numbers=");
        }
    };

    const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            setPhotoPreview(result);
            setPhotoUrl(result);
        };
        reader.readAsDataURL(file);
    };

    const handleDispatch = async () => {
        if (!customerPhone) {
            toast.error("Customer does not have a phone number on file");
            return;
        }

        setDispatching(true);
        try {
            const res = await dispatchOrderMilestoneWhatsApp({
                orderId,
                orderNumber,
                customerName,
                customerPhone,
                milestone: selectedMilestone,
                photoUrl: photoUrl || undefined,
                huid: selectedMilestone === 'quality_checked' ? huid : undefined,
                courierName: selectedMilestone === 'shipped' ? courierName : undefined,
                trackingNumber: selectedMilestone === 'shipped' ? trackingNumber : undefined,
                trackingUrl: selectedMilestone === 'shipped' ? `${trackingUrl}${trackingNumber}` : undefined,
            });

            if (res.success) {
                toast.success(`✨ WhatsApp update dispatched for milestone: ${selectedMilestone.toUpperCase()}`);
                onMilestoneDispatched?.();
            } else {
                toast.error(res.error || "Failed to dispatch milestone update");
            }
        } finally {
            setDispatching(false);
        }
    };

    const milestones: { id: OrderMilestoneType; label: string; icon: React.ElementType }[] = [
        { id: "quality_checked", label: "Quality Check", icon: ShieldCheck },
        { id: "packed", label: "Packed & Gift Boxed", icon: Package },
        { id: "shipped", label: "Shipped & Tracking", icon: Truck },
    ];

    return (
        <div className="bg-surface-navy rounded-xl border border-surface-hover p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-white font-bold text-sm flex items-center gap-2">
                        <MessageCircle size={16} className="text-emerald-400" />
                        VIP WhatsApp Order Milestones
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                            Commerce 2.0
                        </Badge>
                    </h3>
                    <p className="text-moonstone text-xs mt-0.5">
                        Automated multi-stage WhatsApp updates with packaging photo attachments &amp; tracking.
                    </p>
                </div>
            </div>

            {/* Stepper Tabs */}
            <div className="grid grid-cols-3 gap-2">
                {milestones.map(({ id, label, icon: Icon }) => {
                    const isSelected = selectedMilestone === id;
                    return (
                        <button
                            key={id}
                            onClick={() => setSelectedMilestone(id)}
                            className={`p-2.5 rounded-lg border flex items-center gap-2 text-xs font-semibold transition-all ${
                                isSelected
                                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                                    : "bg-bg-navy/70 border-surface-hover text-moonstone hover:text-white"
                            }`}
                        >
                            <Icon size={16} className={isSelected ? "text-emerald-400" : "text-moonstone"} />
                            <span className="truncate">{label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Milestone Customization Details */}
            <div className="p-3.5 bg-bg-navy/90 rounded-lg border border-surface-hover space-y-3 text-xs">
                {selectedMilestone === "quality_checked" && (
                    <div className="space-y-2">
                        <label className="text-[11px] font-bold text-moonstone uppercase">
                            BIS Hallmark / HUID Inspection Tag
                        </label>
                        <input
                            type="text"
                            value={huid}
                            onChange={(e) => setHuid(e.target.value)}
                            placeholder="e.g. LUM-QC994 or 6-digit HUID"
                            className="w-full bg-surface-navy border border-surface-hover rounded-lg px-3 py-2 text-white font-mono"
                        />
                        <p className="text-[10px] text-moonstone">
                            Notifies customer that stone setting, luster, and hallmark have completed inspection.
                        </p>
                    </div>
                )}

                {selectedMilestone === "packed" && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-[11px] font-bold text-moonstone uppercase flex items-center gap-1.5">
                                <Camera size={13} className="text-amber-400" />
                                Packaging Photo Preview (Boxed Parcel)
                            </label>
                            {photoPreview && (
                                <button
                                    onClick={() => { setPhotoPreview(null); setPhotoUrl(""); }}
                                    className="text-[10px] text-destructive hover:underline"
                                >
                                    Clear Photo
                                </button>
                            )}
                        </div>

                        {photoPreview ? (
                            <div className="relative w-full h-32 rounded-lg overflow-hidden border border-emerald-500/30">
                                <Image src={photoPreview} alt="Packed parcel" fill className="object-cover" />
                                <div className="absolute bottom-1 right-1 bg-black/70 px-2 py-0.5 rounded text-[10px] text-emerald-400 font-mono">
                                    Preview Attached
                                </div>
                            </div>
                        ) : (
                            <label className="border-2 border-dashed border-surface-hover hover:border-emerald-500/50 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer transition-colors text-moonstone hover:text-white">
                                <Upload size={20} className="mb-1 text-emerald-400" />
                                <span className="font-semibold text-xs">Upload Packed Parcel Photo</span>
                                <span className="text-[10px] text-moonstone">Snap with phone or select image</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handlePhotoSelect}
                                    className="hidden"
                                />
                            </label>
                        )}
                        <p className="text-[10px] text-moonstone">
                            Customers love seeing their actual jewelry gift box before handover — boosts brand trust.
                        </p>
                    </div>
                )}

                {selectedMilestone === "shipped" && (
                    <div className="space-y-2.5">
                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-moonstone uppercase">Courier Partner</label>
                                <select
                                    value={courierName}
                                    onChange={(e) => {
                                        const c = e.target.value;
                                        setCourierName(c);
                                        if (c === "ST Courier") {
                                            setTrackingUrl("/tracking/st-courier?awb=");
                                        } else if (c === "Delhivery Express") {
                                            setTrackingUrl("https://www.delhivery.com/track/package/");
                                        } else if (c === "Shiprocket") {
                                            setTrackingUrl("https://shiprocket.co/tracking/");
                                        } else if (c === "Blue Dart") {
                                            setTrackingUrl("https://www.bluedart.com/tracking?handler=trak&numbers=");
                                        }
                                    }}
                                    className="w-full bg-surface-navy border border-surface-hover rounded-lg px-2.5 py-1.5 text-white text-xs"
                                >
                                    <option value="ST Courier">ST Courier (11-Digit Standard)</option>
                                    <option value="Delhivery Express">Delhivery Express</option>
                                    <option value="Shiprocket">Shiprocket</option>
                                    <option value="Blue Dart">Blue Dart</option>
                                    <option value="DTDC Express">DTDC Express</option>
                                    <option value="Other Courier">Other Courier</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-moonstone uppercase">AWB Tracking #</label>
                                    {trackingNumber.length === 11 && /^\d+$/.test(trackingNumber) && (
                                        <span className="text-[9px] text-emerald-400 font-mono">ST Courier Valid</span>
                                    )}
                                </div>
                                <div className="flex gap-1.5">
                                    <input
                                        type="text"
                                        value={trackingNumber}
                                        onChange={(e) => handleTrackingNumberChange(e.target.value)}
                                        placeholder="e.g. 64437374632"
                                        className="flex-1 bg-surface-navy border border-surface-hover rounded-lg px-2.5 py-1.5 text-white font-mono text-xs"
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setScanModalOpen(true)}
                                        className="h-8 px-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                        title="Scan Barcode with Handheld Scanner"
                                    >
                                        <ScanBarcode size={14} />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {courierName === "ST Courier" && (
                            <p className="text-[10px] text-amber-300/80 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20">
                                🔗 Generates reverse-engineered 1-click live tracking link for customer WhatsApp.
                            </p>
                        )}
                    </div>
                )}

                {/* Dispatch Button */}
                <Button
                    onClick={handleDispatch}
                    disabled={dispatching || !customerPhone}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-9"
                >
                    {dispatching ? (
                        <Loader2 size={14} className="animate-spin mr-1.5" />
                    ) : (
                        <Send size={14} className="mr-1.5" />
                    )}
                    Send {selectedMilestone.replace('_', ' ').toUpperCase()} Update to Customer ({customerPhone || "No Phone"})
                </Button>
            </div>

            {/* Quick Barcode Scanner Modal */}
            <BarcodeScanDispatchModal
                open={scanModalOpen}
                onOpenChange={setScanModalOpen}
                preselectedOrder={{
                    id: orderId,
                    order_number: orderNumber,
                    customer_name: customerName,
                    customer_phone: customerPhone || null,
                    status: initialStatus,
                    total: 0,
                }}
                onDispatched={onMilestoneDispatched}
            />
        </div>
    );
}
