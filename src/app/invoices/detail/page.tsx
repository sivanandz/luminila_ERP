"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    FileText,
    Printer,
    Download,
    Share2,
    CheckCircle,
    Copy,
    Receipt,
    Truck,
    Trash2,
    CreditCard,
    Building2,
    ReceiptText,
    FileSpreadsheet,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import {
    getInvoice,
    recordPayment,
    cloneInvoice,
    trashInvoice,
    getStoreSettings,
    type Invoice,
    type StoreSettings,
} from "@/lib/invoice";
import { exportToJSON } from "@/lib/reports";
import { formatINR, generateEWayBillJSON, type EWayBillDetails } from "@/lib/gst";
import { escapeHtml } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
    InvoiceTemplateRenderer,
    type InvoiceTemplateType,
} from "@/components/invoices/InvoiceTemplateRenderer";

function InvoiceDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { user } = useAuth();
    const id = searchParams.get("id");
    const autoPrint = searchParams.get("print") === "true";

    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplateType>("retail");

    // Payment Dialog State
    const [showPaymentDialog, setShowPaymentDialog] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState<string>("");
    const [paymentMethod, setPaymentMethod] = useState("cash");
    const [paymentReference, setPaymentReference] = useState("");
    const [processing, setProcessing] = useState(false);
    const [showQRPopup, setShowQRPopup] = useState(false);
    const [upiId, setUpiId] = useState<string>("");

    // E-Way Bill State
    const [showEwayDialog, setShowEwayDialog] = useState(false);
    const [ewayDetails, setEwayDetails] = useState<EWayBillDetails>({
        distance: 0,
        vehicleType: "R",
    });
    const [supplierGstin, setSupplierGstin] = useState("");

    const loadInvoice = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        try {
            const [data, settings] = await Promise.all([
                getInvoice(id),
                getStoreSettings().catch(() => null),
            ]);
            setInvoice(data);
            setStoreSettings(settings);

            if (data) {
                const balance = data.balance_due !== undefined
                    ? data.balance_due
                    : Math.max(0, (data.grand_total || data.total || 0) - (data.paid_amount || 0));
                setPaymentAmount(balance > 0 ? balance.toString() : "0");
                setSupplierGstin(settings?.store_gstin || "29AAACN1234F1Z8");
            }
        } catch (error) {
            console.error("Error loading invoice:", error);
            toast.error("Failed to load invoice");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        loadInvoice();
    }, [id, loadInvoice]);

    // Clones the invoice preview into an isolated window together with the app's live
    // stylesheets, so the printed output keeps its Tailwind styling (printReport only
    // copies innerHTML into a bare window and loses every Tailwind rule).
    const handlePrint = useCallback(() => {
        const element = document.getElementById("invoice-preview-container");
        if (!element) return;

        const printWindow = window.open("", "_blank");
        if (!printWindow) return;

        const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
            .map((node) => node.outerHTML)
            .join("\n");

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Invoice #${escapeHtml(invoice?.invoice_number || "")}</title>
                <base href="${window.location.origin}/">
                ${styles}
            </head>
            <body>
                ${element.innerHTML}
                <script>
                    window.addEventListener("load", function () {
                        setTimeout(function () { window.print(); window.close(); }, 100);
                    });
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
    }, [invoice]);

    useEffect(() => {
        if (invoice && autoPrint) {
            setTimeout(() => {
                handlePrint();
                const params = new URLSearchParams(searchParams.toString());
                params.delete("print");
                router.replace(`/invoices/detail?${params.toString()}`);
            }, 500);
        }
    }, [invoice, autoPrint, searchParams, router, handlePrint]);

    const handleRecordPayment = async () => {
        if (!invoice) return;

        const amount = parseFloat(paymentAmount);
        if (isNaN(amount) || amount <= 0) {
            toast.error("Please enter a valid positive amount");
            return;
        }

        setProcessing(true);
        try {
            await recordPayment({
                invoice_id: invoice.id!,
                amount: amount,
                payment_method: paymentMethod,
                reference: paymentReference || undefined,
                payment_date: new Date().toISOString(),
                recorded_by: user?.name || user?.email || "Admin",
            });

            toast.success(`Recorded payment of ₹${formatINR(amount)} successfully!`);
            setShowPaymentDialog(false);
            setPaymentReference("");
            await loadInvoice();
        } catch (error) {
            console.error("Error confirming payment:", error);
            toast.error("Failed to record payment");
        } finally {
            setProcessing(false);
        }
    };

    const handleClone = async () => {
        if (!invoice?.id) return;
        try {
            toast.loading(`Cloning #${invoice.invoice_number}...`, { id: "clone-op" });
            const cloned = await cloneInvoice(invoice.id);
            toast.success(`Cloned as draft #${cloned.invoice_number}!`, { id: "clone-op" });
            router.push(`/invoices/detail?id=${cloned.id}`);
        } catch (error) {
            console.error("Clone failed:", error);
            toast.error("Failed to clone invoice", { id: "clone-op" });
        }
    };

    const handleTrash = async () => {
        if (!invoice?.id) return;
        if (!confirm(`Move invoice #${invoice.invoice_number} to Trash?`)) return;
        try {
            await trashInvoice(invoice.id);
            toast.success(`Invoice #${invoice.invoice_number} moved to Trash`);
            router.push("/invoices");
        } catch (error) {
            console.error("Trash failed:", error);
            toast.error("Failed to move invoice to trash");
        }
    };

    // No UPI/VPA field exists on StoreSettings yet, so the merchant's UPI ID is kept in
    // localStorage; the QR dialog renders a live scannable code from it.
    const handleGenerateQR = () => {
        if (!invoice) return;
        setUpiId(window.localStorage.getItem("merchant_upi_id") || "");
        setShowQRPopup(true);
    };

    const handleGenerateEWayBill = () => {
        if (!invoice || !supplierGstin) {
            toast.error("Please enter Supplier GSTIN");
            return;
        }
        try {
            const json = generateEWayBillJSON(invoice, supplierGstin, ewayDetails);
            exportToJSON(json, `EWB_${invoice.invoice_number}`);
            setShowEwayDialog(false);
            toast.success("E-Way bill exported as JSON!");
        } catch (error) {
            console.error(error);
            toast.error("Failed to generate E-Way Bill JSON");
        }
    };

    const printPaymentVoucher = (payment: NonNullable<Invoice["payments"]>[number]) => {
        const voucherWindow = window.open("", "_blank");
        if (!voucherWindow) return;
        voucherWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Payment Receipt - Voucher #${escapeHtml(payment.id || "")}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 30px; color: #1e293b; max-width: 500px; margin: auto; }
                    .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 16px; }
                    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dotted #cbd5e1; font-size: 13px; }
                    .total { font-size: 18px; font-weight: bold; margin-top: 16px; text-align: right; color: #059669; }
                    .stamp { border: 2px solid #059669; color: #059669; font-weight: 800; padding: 4px 10px; display: inline-block; border-radius: 4px; margin-top: 12px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>${escapeHtml(storeSettings?.store_name || "Luminila Jewelry")}</h2>
                    <p style="font-size:12px;color:#64748b;">OFFICIAL PAYMENT RECEIPT VOUCHER</p>
                </div>
                <div class="row"><span>Invoice Ref:</span><strong>#${escapeHtml(invoice?.invoice_number || "")}</strong></div>
                <div class="row"><span>Customer:</span><span>${escapeHtml(invoice?.buyer_name || "Walk-in")}</span></div>
                <div class="row"><span>Date:</span><span>${format(new Date(payment.date), "dd MMMM yyyy HH:mm")}</span></div>
                <div class="row"><span>Payment Method:</span><strong style="text-transform:uppercase;">${escapeHtml(payment.method || "")}</strong></div>
                ${payment.reference ? `<div class="row"><span>Reference ID:</span><span>${escapeHtml(payment.reference)}</span></div>` : ""}
                <div class="total">Amount Received: ₹${formatINR(payment.amount)}</div>
                <div style="text-align:center;"><div class="stamp">PAYMENT CONFIRMED</div></div>
                <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:24px;">Thank you for your payment!</p>
            </body>
            </html>
        `);
        voucherWindow.document.close();
        voucherWindow.focus();
        setTimeout(() => {
            voucherWindow.print();
            voucherWindow.close();
        }, 300);
    };

    if (!id) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Invalid Invoice ID</p>
                <Button variant="link" onClick={() => router.push("/invoices")}>
                    Back to Invoices
                </Button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">Loading invoice...</p>
            </div>
        );
    }

    if (!invoice) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Invoice not found</p>
                <Button variant="link" onClick={() => router.push("/invoices")}>
                    Back to Invoices
                </Button>
            </div>
        );
    }

    const isPaid = invoice.is_paid || (invoice.balance_due !== undefined && invoice.balance_due === 0);
    const balanceDue = invoice.balance_due !== undefined
        ? invoice.balance_due
        : Math.max(0, (invoice.grand_total || invoice.total || 0) - (invoice.paid_amount || 0));

    // Live UPI deep-link from the merchant's VPA; rendered as a scannable QR in the dialog.
    const merchantVpa = upiId.trim();
    const upiUri = merchantVpa
        ? `upi://pay?pa=${encodeURIComponent(merchantVpa)}&pn=${encodeURIComponent(storeSettings?.store_name || "Luminila")}&am=${balanceDue.toFixed(2)}&cu=INR`
        : null;
    const qrImageUrl = upiUri
        ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUri)}`
        : null;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title={`Invoice ${invoice.invoice_number}`}
                subtitle={invoice.invoice_date && format(new Date(invoice.invoice_date), "dd MMMM yyyy")}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-6xl mx-auto space-y-6">
                    {/* Top Action Toolbar */}
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <Button variant="ghost" onClick={() => router.push("/invoices")}>
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Invoices
                        </Button>

                        <div className="flex flex-wrap items-center gap-2">
                            {/* Payment Actions */}
                            {!isPaid && (
                                <div className="flex gap-2 mr-2 border-r border-border pr-3">
                                    <Button
                                        onClick={() => setShowPaymentDialog(true)}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                                    >
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                        Record Payment
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={handleGenerateQR}
                                        className="border-primary/50 text-primary"
                                    >
                                        <Receipt className="w-4 h-4 mr-2" />
                                        UPI QR
                                    </Button>
                                </div>
                            )}

                            {/* Clone Button */}
                            <Button variant="outline" onClick={handleClone} title="Duplicate Invoice">
                                <Copy className="w-4 h-4 mr-2 text-primary" />
                                Clone
                            </Button>

                            {/* Document Actions */}
                            <Button variant="outline" onClick={() => setShowEwayDialog(true)}>
                                <Truck className="w-4 h-4 mr-2" />
                                E-Way Bill
                            </Button>
                            <Button variant="outline" onClick={handlePrint}>
                                <Printer className="w-4 h-4 mr-2" />
                                Print
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handlePrint}
                                title="Opens the invoice in a print window — choose 'Save as PDF' to download"
                            >
                                <Download className="w-4 h-4 mr-2" />
                                PDF
                            </Button>

                            {/* Move to Trash */}
                            <Button
                                variant="outline"
                                onClick={handleTrash}
                                title="Move to Trash"
                                className="hover:text-destructive hover:border-destructive/50"
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>

                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground size-9 text-sm font-medium transition-colors cursor-pointer"
                                    title="Share Invoice"
                                >
                                    <Share2 className="w-4 h-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => {
                                        const text = `Invoice ${invoice.invoice_number} from Luminila. Total: ₹${formatINR(invoice.grand_total)}`;
                                        window.open(`https://wa.me/${invoice.buyer_phone || ""}?text=${encodeURIComponent(text)}`);
                                    }}>
                                        Share on WhatsApp
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => {
                                        const subject = `Invoice ${invoice.invoice_number} - Luminila`;
                                        const body = `Please find attached the invoice ${invoice.invoice_number}.`;
                                        window.open(`mailto:${invoice.buyer_email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
                                    }}>
                                        Share via Email
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    {/* Template Switcher Tabs */}
                    <div className="flex items-center justify-between bg-card/60 p-2 rounded-xl border border-border">
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground mr-2 px-2">
                                Template Style:
                            </span>
                            <Button
                                size="sm"
                                variant={selectedTemplate === "retail" ? "default" : "ghost"}
                                onClick={() => setSelectedTemplate("retail")}
                                className="gap-1.5 h-8 text-xs font-medium"
                            >
                                <ReceiptText className="w-3.5 h-3.5" />
                                Retail GST
                            </Button>
                            <Button
                                size="sm"
                                variant={selectedTemplate === "wholesale" ? "default" : "ghost"}
                                onClick={() => setSelectedTemplate("wholesale")}
                                className="gap-1.5 h-8 text-xs font-medium"
                            >
                                <Building2 className="w-3.5 h-3.5" />
                                Wholesale B2B
                            </Button>
                            <Button
                                size="sm"
                                variant={selectedTemplate === "estimate" ? "default" : "ghost"}
                                onClick={() => setSelectedTemplate("estimate")}
                                className="gap-1.5 h-8 text-xs font-medium"
                            >
                                <FileSpreadsheet className="w-3.5 h-3.5" />
                                Estimation Slip
                            </Button>
                            <Button
                                size="sm"
                                variant={selectedTemplate === "thermal" ? "default" : "ghost"}
                                onClick={() => setSelectedTemplate("thermal")}
                                className="gap-1.5 h-8 text-xs font-medium"
                            >
                                <Receipt className="w-3.5 h-3.5" />
                                3&quot; Thermal Roll
                            </Button>
                        </div>

                        <div className="text-xs text-muted-foreground hidden sm:block pr-2">
                            Live Multi-Format Invoicing Suite
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Invoice Preview Container */}
                        <div className="lg:col-span-2">
                            <div id="invoice-preview-container" className="rounded-xl overflow-hidden shadow-2xl">
                                <InvoiceTemplateRenderer
                                    invoice={invoice}
                                    template={selectedTemplate}
                                    storeSettings={storeSettings}
                                />
                            </div>
                        </div>

                        {/* Right Sidebar: Payment Installment Ledger & Financial Meta */}
                        <div className="space-y-6">
                            {/* Payment Balance Card */}
                            <Card className="bg-card border-border">
                                <CardHeader className="pb-3">
                                    <div className="flex justify-between items-center">
                                        <CardTitle className="text-base font-bold">Payment Status</CardTitle>
                                        {isPaid ? (
                                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                                Paid in Full
                                            </Badge>
                                        ) : invoice.paid_amount > 0 ? (
                                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                                                Partial Payment
                                            </Badge>
                                        ) : (
                                            <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">
                                                Unpaid
                                            </Badge>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Total Bill:</span>
                                            <span className="font-mono font-bold text-foreground">
                                                ₹{formatINR(invoice.grand_total)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Paid Amount:</span>
                                            <span className="font-mono font-semibold text-emerald-400">
                                                ₹{formatINR(invoice.paid_amount || 0)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm border-t border-border pt-2">
                                            <span className="font-semibold text-foreground">Remaining Balance:</span>
                                            <span className="font-mono font-bold text-amber-400">
                                                ₹{formatINR(balanceDue)}
                                            </span>
                                        </div>
                                    </div>

                                    {!isPaid && (
                                        <Button
                                            onClick={() => setShowPaymentDialog(true)}
                                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                                        >
                                            <CreditCard className="w-4 h-4 mr-2" />
                                            Record Installment
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Installments History Ledger */}
                            <Card className="bg-card border-border">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                                        <span>Installments Ledger</span>
                                        <span className="text-xs text-muted-foreground">
                                            {invoice.payments?.length || 0} entries
                                        </span>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {invoice.payments && invoice.payments.length > 0 ? (
                                        <div className="space-y-3">
                                            {invoice.payments.map((p, idx) => (
                                                <div
                                                    key={idx}
                                                    className="p-3 bg-muted/40 rounded-lg border border-border/70 flex flex-col gap-1 text-xs"
                                                >
                                                    <div className="flex justify-between items-center">
                                                        <span className="font-bold text-foreground font-mono">
                                                            ₹{formatINR(p.amount)}
                                                        </span>
                                                        <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                                                            {p.method}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex justify-between text-muted-foreground text-[11px]">
                                                        <span>{p.date ? format(new Date(p.date), "dd MMM yyyy, HH:mm") : "-"}</span>
                                                        {p.recorded_by && <span>by {p.recorded_by}</span>}
                                                    </div>
                                                    {p.reference && (
                                                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                                                            Ref: {p.reference}
                                                        </div>
                                                    )}
                                                    <div className="pt-1.5 flex justify-end">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-6 text-[10px] px-2 text-primary"
                                                            onClick={() => printPaymentVoucher(p)}
                                                        >
                                                            <Receipt className="w-3 h-3 mr-1" />
                                                            Print Voucher
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-6 text-xs text-muted-foreground">
                                            No payment installments recorded yet.
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Customer Contact & Meta Card */}
                            <Card className="bg-card border-border">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-semibold">Customer Information</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-xs">
                                    <div>
                                        <span className="text-muted-foreground">Name:</span>{" "}
                                        <span className="font-semibold text-foreground">{invoice.buyer_name || "Walk-in Customer"}</span>
                                    </div>
                                    {invoice.buyer_phone && (
                                        <div>
                                            <span className="text-muted-foreground">Phone:</span>{" "}
                                            <span className="font-mono text-foreground">{invoice.buyer_phone}</span>
                                        </div>
                                    )}
                                    {invoice.buyer_gstin && (
                                        <div>
                                            <span className="text-muted-foreground">GSTIN:</span>{" "}
                                            <span className="font-mono font-semibold text-foreground">{invoice.buyer_gstin}</span>
                                        </div>
                                    )}
                                    {invoice.buyer_address && (
                                        <div>
                                            <span className="text-muted-foreground">Address:</span>{" "}
                                            <span className="text-foreground">{invoice.buyer_address}</span>
                                        </div>
                                    )}
                                    {invoice.notes && (
                                        <div className="pt-2 border-t border-border text-muted-foreground italic">
                                            Notes: {invoice.notes}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>

            {/* Record Payment Dialog */}
            <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Record Payment Installment</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        <div className="p-3 bg-muted/40 rounded-lg border border-border flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">Current Balance Due:</span>
                            <span className="font-mono font-bold text-amber-400 text-sm">₹{formatINR(balanceDue)}</span>
                        </div>

                        <div className="space-y-2">
                            <Label>Amount Received (₹)</Label>
                            <Input
                                type="number"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                                placeholder="Enter amount in ₹"
                                autoFocus
                            />
                            <div className="flex gap-2 pt-1">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    type="button"
                                    className="text-xs h-7"
                                    onClick={() => setPaymentAmount(balanceDue.toString())}
                                >
                                    Pay Remaining (₹{formatINR(balanceDue)})
                                </Button>
                                {balanceDue > 1000 && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        type="button"
                                        className="text-xs h-7"
                                        onClick={() => setPaymentAmount(Math.round(balanceDue / 2).toString())}
                                    >
                                        50% (₹{formatINR(Math.round(balanceDue / 2))})
                                    </Button>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Payment Mode</Label>
                            <Select value={paymentMethod} onValueChange={(val) => val && setPaymentMethod(val)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash">Cash</SelectItem>
                                    <SelectItem value="upi">UPI / QR Code</SelectItem>
                                    <SelectItem value="card">Card POS</SelectItem>
                                    <SelectItem value="bank">Bank Transfer / NEFT</SelectItem>
                                    <SelectItem value="cheque">Cheque</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Reference ID / Transaction No. (Optional)</Label>
                            <Input
                                value={paymentReference}
                                onChange={(e) => setPaymentReference(e.target.value)}
                                placeholder="e.g. UPI Ref, Bank UTR, Cheque No"
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleRecordPayment}
                                disabled={processing}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                {processing ? "Recording..." : "Confirm & Update Ledger"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* UPI QR Dialog */}
            <Dialog open={showQRPopup} onOpenChange={setShowQRPopup}>
                <DialogContent className="max-w-xs text-center">
                    <DialogHeader>
                        <DialogTitle>Scan to Pay via UPI</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col items-center justify-center p-4 space-y-4">
                        <div className="w-48 h-48 bg-white p-2 rounded-xl border border-border shadow-inner flex flex-col items-center justify-center">
                            <div className="text-slate-800 font-mono text-xs mb-2">
                                {storeSettings?.store_name || "Luminila Jewelry"} UPI
                            </div>
                            {qrImageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={qrImageUrl}
                                    alt={`UPI QR code for ₹${formatINR(balanceDue)}`}
                                    className="w-36 h-36"
                                />
                            ) : (
                                <div className="w-36 h-36 flex items-center justify-center rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs text-center p-2">
                                    Enter your UPI ID below to generate the QR
                                </div>
                            )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Merchant VPA: <span className="font-mono font-semibold text-foreground">{merchantVpa || "not set"}</span>
                            <br />
                            Amount: <span className="font-bold text-foreground">₹{formatINR(balanceDue)}</span>
                        </div>
                        <div className="w-full space-y-1.5">
                            <Label htmlFor="merchant-upi-id" className="text-xs">
                                Store UPI ID (VPA)
                            </Label>
                            <Input
                                id="merchant-upi-id"
                                value={upiId}
                                onChange={(e) => {
                                    setUpiId(e.target.value);
                                    window.localStorage.setItem("merchant_upi_id", e.target.value);
                                }}
                                placeholder="e.g. yourstore@okicici"
                                className="h-8 text-xs font-mono"
                            />
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* E-Way Bill Dialog */}
            <Dialog open={showEwayDialog} onOpenChange={setShowEwayDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Generate E-Way Bill JSON</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label>Supplier GSTIN</Label>
                            <Input
                                placeholder="Your Organization GSTIN"
                                value={supplierGstin}
                                onChange={(e) => setSupplierGstin(e.target.value)}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Approx. Distance (km)</Label>
                                <Input
                                    type="number"
                                    value={ewayDetails.distance || ""}
                                    onChange={(e) => setEwayDetails({ ...ewayDetails, distance: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Vehicle Type</Label>
                                <Select
                                    value={ewayDetails.vehicleType}
                                    onValueChange={(val) => setEwayDetails({ ...ewayDetails, vehicleType: val === "O" ? "O" : "R" })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="R">Regular (Road)</SelectItem>
                                        <SelectItem value="O">Over Dimensional Cargo</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowEwayDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleGenerateEWayBill} className="bg-primary">
                                Download EWB JSON
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function InvoiceDetailPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading Invoice...</div>}>
            <InvoiceDetailContent />
        </Suspense>
    );
}
