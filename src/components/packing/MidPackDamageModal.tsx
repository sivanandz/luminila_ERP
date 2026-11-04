"use client";

import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    AlertTriangle,
    CheckCircle2,
    Copy,
    ExternalLink,
    Loader2,
    MessageCircle,
    PackageX,
    Sparkles,
} from "lucide-react";
import {
    handleMidPackDamage,
    type PackingLine,
    type PackingSession,
} from "@/lib/packing";

interface MidPackDamageModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    line: PackingLine | null;
    session: PackingSession | null;
    customerName?: string;
    customerPhone?: string;
    onResolved: (updatedSession: PackingSession) => void;
}

const COMMON_REASONS = [
    "Missing center stone / fallen crystal",
    "Broken hook clasp / lock defect",
    "Tarnished plating / surface blemish",
    "Physical item missing from tray",
    "Wrong color or size on tag",
];

export function MidPackDamageModal({
    open,
    onOpenChange,
    line,
    session,
    customerName,
    customerPhone,
    onResolved,
}: MidPackDamageModalProps) {
    const [reason, setReason] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [resolutionResult, setResolutionResult] = useState<{
        action: "spare_allocated" | "short_ship_required";
        availableStock: number;
    } | null>(null);

    // Editable WhatsApp customer message
    const [customerMessage, setCustomerMessage] = useState("");

    if (!line || !session) return null;

    const handleConfirmDamage = async () => {
        const cleanReason = reason.trim() || "Defect found during packing audit";
        setSubmitting(true);
        try {
            const res = await handleMidPackDamage(session, line, cleanReason, "Packer");
            setResolutionResult({
                action: res.action,
                availableStock: res.availableStock,
            });

            if (res.action === "spare_allocated") {
                toast.success(
                    `Spare unit found! 1 unit quarantined. Please pull a replacement piece from ${line.location || "the tray"}.`
                );
            } else {
                toast.warning(
                    `Zero spares remaining. Order line marked as Short-Shipped.`
                );

                // Prepare pre-filled, fully editable WhatsApp customer message
                const name = customerName || session.customer_name || "Valued Customer";
                const phone = customerPhone || session.customer_phone || "";
                const draft = `Hello ${name}, while carefully inspecting your jewellery parcel for Order #${session.order_number}, our packing team found that ${line.sku} (${line.description}) did not meet our quality standards (${cleanReason}).

As this was the last handcrafted unit in this batch, we want to ensure you are taken care of right away:
1️⃣ We can dispatch the rest of your parcel and refund this item immediately.
2️⃣ Or our stylist can share photos of matching alternative pieces you may prefer.

Please let us know your preference! We sincerely apologize for this inconvenience. — Luminila Jewellery`;

                setCustomerMessage(draft);
            }

            onResolved(res.updatedSession);
        } catch (err) {
            console.error("Failed to record mid-pack damage:", err);
            toast.error("Could not process discrepancy record.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleCopyMessage = () => {
        if (!customerMessage) return;
        navigator.clipboard.writeText(customerMessage);
        toast.success("Customer message copied to clipboard!");
    };

    const handleOpenWhatsApp = () => {
        if (!customerMessage) return;
        const phone = (customerPhone || session.customer_phone || "").replace(/\D/g, "");
        const url = phone
            ? `https://wa.me/${phone}?text=${encodeURIComponent(customerMessage)}`
            : `https://web.whatsapp.com/send?text=${encodeURIComponent(customerMessage)}`;
        window.open(url, "_blank");
    };

    const handleClose = () => {
        setResolutionResult(null);
        setReason("");
        setCustomerMessage("");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg bg-surface-navy border-surface-hover text-white">
                <DialogHeader className="border-b border-surface-hover pb-3">
                    <DialogTitle className="text-base font-bold flex items-center gap-2 text-white">
                        <AlertTriangle className="size-5 text-amber-400" />
                        Mid-Pack Exception: Flag Damaged / Missing Piece
                    </DialogTitle>
                    <DialogDescription className="text-xs text-moonstone mt-0.5">
                        Item: <span className="font-mono text-white font-bold">{line.sku}</span> · {line.description}
                    </DialogDescription>
                </DialogHeader>

                {!resolutionResult ? (
                    <div className="space-y-4 py-2">
                        <div className="p-3 rounded-lg bg-bg-navy/80 border border-surface-hover space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-moonstone">Assigned Location:</span>
                                <Badge variant="outline" className="text-white border-surface-hover">
                                    {line.location || "Showcase Tray A"}
                                </Badge>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-moonstone">Current Shelf Stock:</span>
                                <span className="font-mono font-bold text-primary">
                                    {line.stock_level ?? "Checking…"} pcs
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs text-moonstone">Select or Enter Reason for Defect:</Label>
                            <div className="flex flex-wrap gap-1.5">
                                {COMMON_REASONS.map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setReason(r)}
                                        className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                                            reason === r
                                                ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                                                : "bg-surface-navy border-surface-hover text-moonstone hover:text-white"
                                        }`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
                            <Input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Describe defect (e.g. missing stones, oxidized clasp)…"
                                className="h-9 bg-bg-navy border-surface-hover text-xs font-sans text-white mt-1.5"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-surface-hover">
                            <Button variant="ghost" size="sm" onClick={handleClose} className="h-9 text-xs text-moonstone hover:text-white">
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleConfirmDamage}
                                disabled={submitting}
                                className="h-9 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white"
                            >
                                {submitting ? <Loader2 size={13} className="animate-spin mr-1" /> : <PackageX size={13} className="mr-1" />}
                                Check Spare &amp; Quarantine
                            </Button>
                        </div>
                    </div>
                ) : resolutionResult.action === "spare_allocated" ? (
                    <div className="space-y-4 py-2">
                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                            <CheckCircle2 className="size-6 text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-bold text-emerald-300">Spare Unit Available on Shelf!</p>
                                <p className="text-xs text-moonstone mt-1 leading-relaxed">
                                    The defective unit has been deducted and quarantined in{" "}
                                    <span className="text-white font-mono">stock_discrepancies</span>.
                                    There are{" "}
                                    <span className="text-white font-bold">{resolutionResult.availableStock}</span> spare
                                    pieces available.
                                </p>
                                <p className="text-xs text-white font-semibold mt-2">
                                    👉 Action: Fetch a replacement unit from {line.location || "Showcase Tray A"} and scan it to complete the line.
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button onClick={handleClose} className="h-9 text-xs font-bold bg-primary text-primary-foreground">
                                Back to Packing Station
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 py-2">
                        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                            <p className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
                                <PackageX className="size-4" />
                                Zero Shelf Spares — Line Marked Short-Shipped
                            </p>
                            <p className="text-xs text-moonstone leading-relaxed">
                                The unit was quarantined into discrepancies. The packing line is marked short-shipped so the remaining order can be packed and dispatched without blocking.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-bold text-white flex items-center gap-1.5">
                                    <MessageCircle className="size-3.5 text-emerald-400" />
                                    Editable WhatsApp Apology &amp; Substitution Message:
                                </Label>
                                <span className="text-[10px] text-moonstone">Review &amp; Edit before sending</span>
                            </div>
                            <textarea
                                value={customerMessage}
                                onChange={(e) => setCustomerMessage(e.target.value)}
                                rows={6}
                                className="w-full rounded-lg bg-bg-navy border border-surface-hover p-2.5 text-xs text-white font-sans leading-relaxed focus:outline-none focus:border-primary resize-none"
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-surface-hover">
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCopyMessage}
                                    className="h-8 text-xs border-surface-hover text-white hover:bg-bg-navy"
                                >
                                    <Copy className="size-3.5 mr-1" /> Copy
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleOpenWhatsApp}
                                    className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
                                >
                                    <ExternalLink className="size-3.5 mr-1" /> Open in WhatsApp
                                </Button>
                            </div>
                            <Button size="sm" onClick={handleClose} className="h-8 text-xs bg-surface-navy border border-surface-hover text-white">
                                Done
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
