"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    RotateCcw,
    CheckCircle,
    XCircle,
    DollarSign,
    Printer,
    Clock,
    AlertTriangle,

    PackagePlus,
    Trash2,
    Plus,
    type LucideIcon,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { pb } from "@/lib/pocketbase";
import { toast } from "sonner";
import type { ProductVariant } from "@/lib/products";

import {
    getCreditNote,
    approveCreditNote,
    processRefund,
    cancelCreditNote,
    processExchange,
    type CreditNote,
    type CreditNoteStatus,
    type ExchangeItem,
} from "@/lib/returns";
import { formatINR } from "@/lib/gst";

const statusConfig: Record<CreditNoteStatus, { label: string; color: string; icon: LucideIcon }> = {
    pending: { label: "Pending Approval", color: "bg-yellow-500/20 text-yellow-400", icon: Clock },
    approved: { label: "Approved", color: "bg-blue-500/20 text-blue-400", icon: CheckCircle },
    refunded: { label: "Refunded", color: "bg-green-500/20 text-green-400", icon: DollarSign },
    exchanged: { label: "Exchanged / Replacement Issued", color: "bg-purple-500/20 text-purple-400", icon: RotateCcw },
    cancelled: { label: "Cancelled", color: "bg-red-500/20 text-red-400", icon: XCircle },
};

function CreditNoteDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get("id");

    const [creditNote, setCreditNote] = useState<CreditNote | null>(null);
    const [loading, setLoading] = useState(true);
    const [showApproveDialog, setShowApproveDialog] = useState(false);
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [showRefundDialog, setShowRefundDialog] = useState(false);
    const [refundMethod, setRefundMethod] = useState("cash");
    const [refundReference, setRefundReference] = useState("");
    const [processing, setProcessing] = useState(false);

    // Approval condition routing
    const [routeToQuarantine, setRouteToQuarantine] = useState(true);
    const [quarantineType, setQuarantineType] = useState<"damaged" | "vendor_replacement">("damaged");
    const [approvalNotes, setApprovalNotes] = useState("");

    // Exchange & Replacement state
    const [showExchangeDialog, setShowExchangeDialog] = useState(false);
    const [availableVariants, setAvailableVariants] = useState<{
        id: string;
        sku: string;
        name: string;
        price: number;
        stock: number;
    }[]>([]);
    const [exchangeItems, setExchangeItems] = useState<ExchangeItem[]>([]);
    const [selectedVariantId, setSelectedVariantId] = useState("");
    const [selectedVariantQty, setSelectedVariantQty] = useState(1);
    const [exchangePaymentMethod, setExchangePaymentMethod] = useState("cash");
    const [exchangeReference, setExchangeReference] = useState("");
    const [exchangeNotes, setExchangeNotes] = useState("");

    useEffect(() => {
        loadCreditNote();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- loadCreditNote is re-created every render, so adding it to deps would refetch in a loop; the effect intentionally reloads only when id changes
    }, [id]);

    const loadCreditNote = async () => {
        if (!id) return;
        setLoading(true);
        const data = await getCreditNote(id);
        setCreditNote(data);
        if (data) {
            setRouteToQuarantine(data.return_reason === "defective" || data.return_reason === "quality_issue");
        }
        setLoading(false);
    };

    const loadVariants = async () => {
        try {
            const variants = await pb.collection("product_variants").getFullList<ProductVariant>({
                expand: "product",
                filter: "stock_level > 0",
            });
            setAvailableVariants(
                variants
                    .map((v) => {
                        const product = v.expand?.product;
                        const sku = product?.sku
                            ? v.sku_suffix
                                ? `${product.sku}-${v.sku_suffix}`
                                : product.sku
                            : v.sku_suffix || v.id;
                        return {
                            id: v.id,
                            sku,
                            name: product?.name ? `${product.name} (${sku})` : sku,
                            price: (product?.base_price || 0) + (v.price_adjustment || 0),
                            stock: v.stock_level || 0,
                        };
                    })
                    .sort((a, b) => a.sku.localeCompare(b.sku))
            );
        } catch (err) {
            console.error("Failed to load variants:", err);
            toast.error("Could not fetch available products for exchange");
        }
    };

    const handleApprove = async () => {
        if (!id) return;
        setProcessing(true);
        try {
            await approveCreditNote(id, {
                routeDefectiveToQuarantine: routeToQuarantine,
                discrepancyType: quarantineType,
                notes: approvalNotes,
            });
            toast.success(
                routeToQuarantine
                    ? "Credit note approved! Returned items routed to Quarantine / Vendor RMA."
                    : "Credit note approved! Returned items restored to available stock."
            );
            loadCreditNote();
            setShowApproveDialog(false);
        } catch (error) {
            console.error("Error approving:", error);
            toast.error(error instanceof Error && error.message ? error.message : "Failed to approve credit note");
        } finally {
            setProcessing(false);
        }
    };

    const handleAddExchangeItem = () => {
        if (!selectedVariantId) return;
        const v = availableVariants.find((x) => x.id === selectedVariantId);
        if (!v) return;

        if (selectedVariantQty > v.stock) {
            toast.error(`Only ${v.stock} units available in stock`);
            return;
        }

        const existingIdx = exchangeItems.findIndex((it) => it.variant_id === v.id);
        if (existingIdx >= 0) {
            const updated = [...exchangeItems];
            updated[existingIdx].quantity += selectedVariantQty;
            setExchangeItems(updated);
        } else {
            setExchangeItems((prev) => [
                ...prev,
                {
                    variant_id: v.id,
                    description: v.name,
                    sku: v.sku,
                    unit_price: v.price,
                    quantity: selectedVariantQty,
                },
            ]);
        }
        setSelectedVariantId("");
        setSelectedVariantQty(1);
    };

    const handleRemoveExchangeItem = (index: number) => {
        setExchangeItems((prev) => prev.filter((_, i) => i !== index));
    };

    const handleProcessExchange = async () => {
        if (!id || exchangeItems.length === 0) {
            toast.error("Please add at least one replacement item");
            return;
        }
        setProcessing(true);
        try {
            const res = await processExchange(id, exchangeItems, {
                paymentMethod: exchangePaymentMethod,
                paymentReference: exchangeReference,
                notes: exchangeNotes,
            });
            toast.success(
                `Replacement exchange completed! Stock updated and financial balance of ₹${formatINR(Math.abs(res.balanceDue))} recorded.`
            );
            setShowExchangeDialog(false);
            setExchangeItems([]);
            loadCreditNote();
        } catch (err) {
            console.error("Error processing exchange:", err);
            toast.error(err instanceof Error && err.message ? err.message : "Failed to process exchange");
        } finally {
            setProcessing(false);
        }
    };

    const handleRefund = async () => {
        if (!id) return;
        setProcessing(true);
        try {
            await processRefund(id, refundMethod, refundReference || undefined);
            loadCreditNote();
            setShowRefundDialog(false);
            toast.success(
                refundMethod === "cash"
                    ? "Refund recorded in the cash drawer and deducted from the shift total."
                    : `Refund recorded via ${refundMethod.replace("_", " ")}.`
            );
        } catch (error) {
            console.error("Error processing refund:", error);
            toast.error(
                error instanceof Error && error.message ? error.message : "Failed to process refund"
            );
        } finally {
            setProcessing(false);
        }
    };

    const handleCancel = async () => {
        if (!id) return;
        setProcessing(true);
        try {
            await cancelCreditNote(id);
            loadCreditNote();
            setShowCancelDialog(false);
        } catch (error) {
            console.error("Error cancelling:", error);
            alert("Failed to cancel credit note");
        } finally {
            setProcessing(false);
        }
    };

    if (!id) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <RotateCcw className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Invalid Credit Note ID</p>
                <Button variant="link" onClick={() => router.push("/returns")}>
                    Back to Returns
                </Button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">Loading credit note...</p>
            </div>
        );
    }

    if (!creditNote) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <RotateCcw className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Credit note not found</p>
                <Button variant="link" onClick={() => router.push("/returns")}>
                    Back to Returns
                </Button>
            </div>
        );
    }

    const config = statusConfig[creditNote.status] || statusConfig.pending;
    const StatusIcon = config.icon;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title={`Credit Note ${creditNote.credit_note_number}`}
                subtitle={creditNote.created_at && format(new Date(creditNote.created_at), "dd MMMM yyyy")}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Actions */}
                <div className="flex items-center justify-between mb-6">
                    <Button variant="ghost" onClick={() => router.push("/returns")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Returns
                    </Button>

                    <div className="flex items-center gap-2">
                        {creditNote.status === "pending" && (
                            <>
                                <Button
                                    variant="outline"
                                    className="border-green-500/50 text-green-400"
                                    onClick={() => setShowApproveDialog(true)}
                                >
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                    Approve
                                </Button>
                                <Button
                                    variant="outline"
                                    className="border-red-500/50 text-red-400"
                                    onClick={() => setShowCancelDialog(true)}
                                >
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Cancel
                                </Button>
                            </>
                        )}
                        {creditNote.status === "approved" && (
                            <>
                                <Button
                                    className="bg-purple-600 hover:bg-purple-700 text-white gap-2 font-semibold shadow-sm"
                                    onClick={() => {
                                        loadVariants();
                                        setShowExchangeDialog(true);
                                    }}
                                >
                                    <RotateCcw className="w-4 h-4" />
                                    Process Replacement / Exchange
                                </Button>
                                <Button
                                    className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                                    onClick={() => setShowRefundDialog(true)}
                                >
                                    <DollarSign className="w-4 h-4" />
                                    Process Refund
                                </Button>
                            </>
                        )}
                        <Button variant="outline" onClick={() => window.print()}>
                            <Printer className="w-4 h-4 mr-2" />
                            Print
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Main Info */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Status & Summary */}
                        <Card className="bg-card/50 border-border/50">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Badge className={`${config.color} text-lg px-4 py-2`}>
                                            <StatusIcon className="w-4 h-4 mr-2" />
                                            {config.label}
                                        </Badge>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-muted-foreground">Total Refund</p>
                                        <p className="text-3xl font-bold font-mono">
                                            {formatINR(creditNote.grand_total)}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-6 grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-muted-foreground">Return Reason</p>
                                        <p className="font-medium capitalize">
                                            {creditNote.return_reason?.replace("_", " ")}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">Original Invoice</p>
                                        <p className="font-medium font-mono">
                                            {creditNote.original_invoice_id || "N/A"}
                                        </p>
                                    </div>
                                </div>

                                {creditNote.notes && (
                                    <div className="mt-4">
                                        <p className="text-sm text-muted-foreground">Notes</p>
                                        <p className="text-sm">{creditNote.notes}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Items */}
                        <Card className="bg-card/50 border-border/50">
                            <CardHeader>
                                <CardTitle className="text-lg">Returned Items</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-border/50">
                                            <TableHead>Description</TableHead>
                                            <TableHead className="text-center">HSN</TableHead>
                                            <TableHead className="text-center">Qty</TableHead>
                                            <TableHead className="text-right">Price</TableHead>
                                            <TableHead className="text-right">Tax</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {creditNote.items?.map((item, idx) => (
                                            <TableRow key={idx} className="border-border/50">
                                                <TableCell>{item.description}</TableCell>
                                                <TableCell className="text-center font-mono text-sm">
                                                    {item.hsn_code}
                                                </TableCell>
                                                <TableCell className="text-center">{item.quantity}</TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatINR(item.unit_price)}
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatINR(item.cgst_amount + item.sgst_amount + item.igst_amount)}
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-semibold">
                                                    {formatINR(item.total_amount)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Customer */}
                        <Card className="bg-card/50 border-border/50">
                            <CardHeader>
                                <CardTitle className="text-lg">Customer</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <p className="font-medium">{creditNote.buyer_name}</p>
                                {creditNote.buyer_address && (
                                    <p className="text-sm text-muted-foreground">{creditNote.buyer_address}</p>
                                )}
                                {creditNote.buyer_gstin && (
                                    <p className="text-sm font-mono">GSTIN: {creditNote.buyer_gstin}</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Tax Breakdown */}
                        <Card className="bg-card/50 border-border/50">
                            <CardHeader>
                                <CardTitle className="text-lg">Tax Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Taxable Value</span>
                                    <span className="font-mono">{formatINR(creditNote.taxable_value)}</span>
                                </div>
                                {creditNote.cgst_amount > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">CGST</span>
                                        <span className="font-mono">{formatINR(creditNote.cgst_amount)}</span>
                                    </div>
                                )}
                                {creditNote.sgst_amount > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">SGST</span>
                                        <span className="font-mono">{formatINR(creditNote.sgst_amount)}</span>
                                    </div>
                                )}
                                {creditNote.igst_amount > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">IGST</span>
                                        <span className="font-mono">{formatINR(creditNote.igst_amount)}</span>
                                    </div>
                                )}
                                <div className="border-t border-border pt-3 flex justify-between font-semibold">
                                    <span>Grand Total</span>
                                    <span className="font-mono">{formatINR(creditNote.grand_total)}</span>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Refund Info */}
                        {creditNote.status === "refunded" && (
                            <Card className="bg-green-500/10 border-green-500/30">
                                <CardHeader>
                                    <CardTitle className="text-lg text-green-400">Refund Details</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Method</span>
                                        <span className="capitalize">{creditNote.refund_method}</span>
                                    </div>
                                    {creditNote.refund_reference && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Reference</span>
                                            <span className="font-mono">{creditNote.refund_reference}</span>
                                        </div>
                                    )}
                                    {creditNote.refunded_at && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Date</span>
                                            <span>{format(new Date(creditNote.refunded_at), "dd MMM yyyy")}</span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* Exchanged Info */}
                        {creditNote.status === "exchanged" && (
                            <Card className="bg-purple-500/10 border-purple-500/30">
                                <CardHeader>
                                    <CardTitle className="text-base text-purple-400 flex items-center gap-2">
                                        <RotateCcw className="w-4 h-4" />
                                        Exchange & Replacement Settlement
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Settlement Mode</span>
                                        <span className="font-semibold uppercase text-purple-300">{creditNote.refund_method || "Exchange"}</span>
                                    </div>
                                    {creditNote.refund_reference && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Reference</span>
                                            <span className="font-mono text-white">{creditNote.refund_reference}</span>
                                        </div>
                                    )}
                                    {creditNote.refunded_at && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Fulfilled Date</span>
                                            <span className="text-white">{format(new Date(creditNote.refunded_at), "dd MMM yyyy HH:mm")}</span>
                                        </div>
                                    )}
                                    {creditNote.notes && (
                                        <div className="p-3 bg-purple-950/40 rounded-lg border border-purple-800/40 text-[11px] text-purple-200 whitespace-pre-line leading-relaxed font-mono">
                                            {creditNote.notes}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            </div>

            {/* Approval & Inventory Routing Dialog */}
            <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-emerald-500" />
                            Approve Return & Route Inventory
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 text-xs pt-2">
                        <div className="p-3 bg-muted/30 rounded-lg space-y-1">
                            <p className="font-bold text-sm text-foreground">Return #{creditNote.credit_note_number}</p>
                            <p className="text-muted-foreground">Customer: <span className="text-foreground font-semibold">{creditNote.buyer_name}</span></p>
                            <p className="text-muted-foreground">Credit Value: <span className="text-foreground font-bold font-mono">₹{formatINR(creditNote.grand_total)}</span></p>
                            <p className="text-muted-foreground">Reported Reason: <span className="text-amber-400 font-semibold uppercase">{creditNote.return_reason}</span></p>
                        </div>

                        <div className="space-y-2 border border-border/60 p-3 rounded-lg bg-card/60">
                            <Label className="font-bold text-foreground">Inventory Condition & Routing:</Label>
                            <div className="space-y-2 pt-1">
                                <label className="flex items-start gap-2.5 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="routing"
                                        checked={routeToQuarantine}
                                        onChange={() => setRouteToQuarantine(true)}
                                        className="mt-0.5 accent-amber-500"
                                    />
                                    <div>
                                        <span className="font-bold text-amber-300 flex items-center gap-1">
                                            <AlertTriangle className="w-3.5 h-3.5" /> Defective / Damaged (Route to Quarantine)
                                        </span>
                                        <p className="text-[11px] text-muted-foreground">
                                            Does NOT restock into sellable inventory. Flags items in active quarantine / vendor RMA queue.
                                        </p>
                                    </div>
                                </label>

                                <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                                    <input
                                        type="radio"
                                        name="routing"
                                        checked={!routeToQuarantine}
                                        onChange={() => setRouteToQuarantine(false)}
                                        className="mt-0.5 accent-emerald-500"
                                    />
                                    <div>
                                        <span className="font-bold text-emerald-300 flex items-center gap-1">
                                            <PackagePlus className="w-3.5 h-3.5" /> Resellable / Good Condition (Restock)
                                        </span>
                                        <p className="text-[11px] text-muted-foreground">
                                            Adds returned quantity directly back to sellable stock levels.
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {routeToQuarantine && (
                            <div className="space-y-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                <Label className="text-amber-300 font-semibold">Quarantine Ledger Type:</Label>
                                <Select value={quarantineType} onValueChange={(v) => setQuarantineType(v as "damaged" | "vendor_replacement")}>
                                    <SelectTrigger className="bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="damaged">Damaged in Store / By Customer</SelectItem>
                                        <SelectItem value="vendor_replacement">Send to Vendor for Replacement</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="space-y-1">
                            <Label>Approval Audit Notes (Optional)</Label>
                            <Input
                                placeholder="Inspection remarks, QC notes..."
                                value={approvalNotes}
                                onChange={(e) => setApprovalNotes(e.target.value)}
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-3">
                            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleApprove}
                                disabled={processing}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                            >
                                {processing ? "Approving..." : "Confirm & Approve Return"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Cancel Dialog */}
            <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Credit Note?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. The return request will be rejected.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleCancel}
                            disabled={processing}
                            className="bg-red-600"
                        >
                            {processing ? "Cancelling..." : "Cancel Credit Note"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Process Refund Dialog */}
            <Dialog open={showRefundDialog} onOpenChange={setShowRefundDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Process Refund</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="p-4 bg-muted/20 rounded-lg">
                            <p className="text-sm text-muted-foreground">Refund Amount</p>
                            <p className="text-2xl font-bold font-mono">{formatINR(creditNote.grand_total)}</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Refund Method</Label>
                            <Select value={refundMethod} onValueChange={(v) => v && setRefundMethod(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash">Cash</SelectItem>
                                    <SelectItem value="upi">UPI</SelectItem>
                                    <SelectItem value="card">Card</SelectItem>
                                    <SelectItem value="bank">Bank Transfer</SelectItem>
                                    <SelectItem value="credit">Store Credit</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Reference (Optional)</Label>
                            <Input
                                placeholder="Transaction ID, UPI Ref, etc."
                                value={refundReference}
                                onChange={(e) => setRefundReference(e.target.value)}
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowRefundDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleRefund}
                                disabled={processing}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                {processing ? "Processing..." : "Complete Refund"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Process Replacement / Exchange Dialog */}
            <Dialog open={showExchangeDialog} onOpenChange={setShowExchangeDialog}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-purple-400">
                            <RotateCcw className="w-5 h-5" />
                            Process Customer Replacement / Exchange
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5 text-xs pt-2">
                        {/* Financial Ledger Calculation Summary */}
                        {(() => {
                            const replacementTotal = exchangeItems.reduce(
                                (sum, it) => sum + it.unit_price * it.quantity,
                                0
                            );
                            const balanceDue = replacementTotal - creditNote.grand_total;

                            return (
                                <div className="grid grid-cols-3 gap-3 p-4 bg-purple-950/20 border border-purple-800/40 rounded-xl">
                                    <div>
                                        <p className="text-muted-foreground text-[11px]">Return Credit Available</p>
                                        <p className="text-lg font-bold font-mono text-emerald-400">
                                            ₹{formatINR(creditNote.grand_total)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground text-[11px]">Replacement Items Total</p>
                                        <p className="text-lg font-bold font-mono text-purple-300">
                                            ₹{formatINR(replacementTotal)}
                                        </p>
                                    </div>
                                    <div className="border-l border-purple-800/40 pl-3">
                                        <p className="text-muted-foreground text-[11px]">Financial Balance</p>
                                        {balanceDue > 0 ? (
                                            <div>
                                                <p className="text-lg font-bold font-mono text-amber-400">
                                                    +₹{formatINR(balanceDue)}
                                                </p>
                                                <p className="text-[10px] text-amber-300 font-semibold">Collect from Customer</p>
                                            </div>
                                        ) : balanceDue < 0 ? (
                                            <div>
                                                <p className="text-lg font-bold font-mono text-rose-400">
                                                    -₹{formatINR(Math.abs(balanceDue))}
                                                </p>
                                                <p className="text-[10px] text-rose-300 font-semibold">Refund Difference</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-lg font-bold font-mono text-emerald-400">₹0</p>
                                                <p className="text-[10px] text-emerald-300 font-semibold">Even Exchange</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Add Replacement Item Controls */}
                        <div className="p-3 bg-card border border-border rounded-lg space-y-3">
                            <Label className="font-bold text-foreground">Select Replacement Item from Inventory:</Label>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <Select value={selectedVariantId} onValueChange={(val) => val && setSelectedVariantId(val)}>
                                        <SelectTrigger className="bg-background">
                                            <SelectValue placeholder="Choose product variant..." />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-60">
                                            {availableVariants.map((v) => (
                                                <SelectItem key={v.id} value={v.id}>
                                                    {v.name} — ₹{formatINR(v.price)} ({v.stock} in stock)
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="w-20">
                                    <Input
                                        type="number"
                                        min="1"
                                        value={selectedVariantQty}
                                        onChange={(e) => setSelectedVariantQty(Math.max(1, parseInt(e.target.value) || 1))}
                                        placeholder="Qty"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    onClick={handleAddExchangeItem}
                                    className="bg-purple-600 hover:bg-purple-700 text-white gap-1"
                                    disabled={!selectedVariantId}
                                >
                                    <Plus className="w-4 h-4" /> Add
                                </Button>
                            </div>
                        </div>

                        {/* Selected Replacement Items Table */}
                        <div className="border border-border rounded-lg overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/40">
                                        <TableHead>Replacement Item</TableHead>
                                        <TableHead className="text-center w-16">Qty</TableHead>
                                        <TableHead className="text-right w-24">Rate</TableHead>
                                        <TableHead className="text-right w-28">Total</TableHead>
                                        <TableHead className="w-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {exchangeItems.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                                                No replacement items added yet. Select a product above.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        exchangeItems.map((item, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell className="font-medium">{item.description}</TableCell>
                                                <TableCell className="text-center font-mono">{item.quantity}</TableCell>
                                                <TableCell className="text-right font-mono">₹{formatINR(item.unit_price)}</TableCell>
                                                <TableCell className="text-right font-mono font-bold">
                                                    ₹{formatINR(item.unit_price * item.quantity)}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleRemoveExchangeItem(idx)}
                                                        className="text-red-400 hover:text-red-300 p-1 h-7 w-7"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Payment & Bookkeeping Method */}
                        <div className="grid grid-cols-2 gap-3 pt-1">
                            <div className="space-y-1">
                                <Label>Payment / Settlement Mode</Label>
                                <Select value={exchangePaymentMethod} onValueChange={(val) => val && setExchangePaymentMethod(val)}>
                                    <SelectTrigger className="bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="cash">Cash Drawer</SelectItem>
                                        <SelectItem value="upi">UPI / QR Code</SelectItem>
                                        <SelectItem value="card">Card POS Terminal</SelectItem>
                                        <SelectItem value="bank_transfer">Bank Transfer / IMPS</SelectItem>
                                        <SelectItem value="store_credit">Store Credit Account</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label>Transaction Ref / UTR (Optional)</Label>
                                <Input
                                    placeholder="UPI Ref, POS Slip No..."
                                    value={exchangeReference}
                                    onChange={(e) => setExchangeReference(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Exchange Notes & Staff Remarks (Optional)</Label>
                            <Input
                                placeholder="Customer upgraded to heavier necklace, exchange approved by store manager..."
                                value={exchangeNotes}
                                onChange={(e) => setExchangeNotes(e.target.value)}
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-3 border-t border-border">
                            <Button variant="outline" onClick={() => setShowExchangeDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleProcessExchange}
                                disabled={processing || exchangeItems.length === 0}
                                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold"
                            >
                                {processing ? "Processing Exchange..." : "Confirm Replacement & Update Ledger"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function CreditNoteDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
            <CreditNoteDetailContent />
        </Suspense>
    );
}
