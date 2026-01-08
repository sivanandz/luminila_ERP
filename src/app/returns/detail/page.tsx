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

import {
    getCreditNote,
    approveCreditNote,
    processRefund,
    cancelCreditNote,
    type CreditNote,
    type CreditNoteStatus,
} from "@/lib/returns";
import { formatINR } from "@/lib/gst";

const statusConfig: Record<CreditNoteStatus, { label: string; color: string; icon: any }> = {
    pending: { label: "Pending Approval", color: "bg-yellow-500/20 text-yellow-400", icon: Clock },
    approved: { label: "Approved", color: "bg-blue-500/20 text-blue-400", icon: CheckCircle },
    refunded: { label: "Refunded", color: "bg-green-500/20 text-green-400", icon: DollarSign },
    exchanged: { label: "Exchanged", color: "bg-purple-500/20 text-purple-400", icon: RotateCcw },
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

    useEffect(() => {
        loadCreditNote();
    }, [id]);

    const loadCreditNote = async () => {
        if (!id) return;
        setLoading(true);
        const data = await getCreditNote(id);
        setCreditNote(data);
        setLoading(false);
    };

    const handleApprove = async () => {
        if (!id) return;
        setProcessing(true);
        try {
            await approveCreditNote(id);
            loadCreditNote();
            setShowApproveDialog(false);
        } catch (error) {
            console.error("Error approving:", error);
            alert("Failed to approve credit note");
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
        } catch (error) {
            console.error("Error processing refund:", error);
            alert("Failed to process refund");
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

    const config = statusConfig[creditNote.status];
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
                            <Button
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() => setShowRefundDialog(true)}
                            >
                                <DollarSign className="w-4 h-4 mr-2" />
                                Process Refund
                            </Button>
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
                    </div>
                </div>
            </div>

            {/* Dialogs */}
            <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Approve Credit Note?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will approve the credit note and restore stock for returned items.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleApprove}
                            disabled={processing}
                            className="bg-green-600"
                        >
                            {processing ? "Approving..." : "Approve"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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
                                className="bg-green-600"
                            >
                                {processing ? "Processing..." : "Complete Refund"}
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
