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
    Clock,
    AlertCircle,
    Copy,
    Receipt,
    XCircle,
    Truck,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

import { getInvoice, recordPayment, type Invoice } from "@/lib/invoice";
import { printInvoice, downloadInvoicePDF, exportToJSON } from "@/lib/reports";
import { formatINR, toWords, generateEWayBillJSON, type EWayBillDetails } from "@/lib/gst";

function InvoiceDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get("id");
    const autoPrint = searchParams.get("print") === "true";

    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [loading, setLoading] = useState(true);
    const [showPaymentDialog, setShowPaymentDialog] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState<string>("");
    const [paymentMethod, setPaymentMethod] = useState("cash");
    const [paymentReference, setPaymentReference] = useState("");
    const [processing, setProcessing] = useState(false);
    const [showQRPopup, setShowQRPopup] = useState(false);
    const [qrCodeData, setQrCodeData] = useState<string | null>(null);

    // E-Way Bill State
    const [showEwayDialog, setShowEwayDialog] = useState(false);
    const [ewayDetails, setEwayDetails] = useState<EWayBillDetails>({
        distance: 0,
        vehicleType: 'R'
    });
    const [supplierGstin, setSupplierGstin] = useState("");

    const loadInvoice = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        const data = await getInvoice(id);
        setInvoice(data);
        setLoading(false);

        if (data && !data.is_paid) {
            setPaymentAmount(data.grand_total.toString());
        }
    }, [id]);

    useEffect(() => {
        loadInvoice();
    }, [id, loadInvoice]);

    useEffect(() => {
        if (invoice && autoPrint) {
            // Slight delay to ensure render
            setTimeout(() => {
                printInvoice(invoice.id!);
                // Remove print param
                const params = new URLSearchParams(searchParams.toString());
                params.delete("print");
                router.replace(`/invoices/detail?${params.toString()}`);
            }, 500);
        }
    }, [invoice, autoPrint, searchParams, router]);

    const handleRecordPayment = async () => {
        if (!invoice) return;

        const amount = parseFloat(paymentAmount);
        if (isNaN(amount) || amount <= 0) {
            alert("Please enter a valid amount");
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
                recorded_by: "Admin", // TODO: Get from auth
            });

            setShowPaymentDialog(false);
            loadInvoice();
        } catch (error) {
            console.error("Error confirming payment:", error);
            alert("Failed to record payment");
        } finally {
            setProcessing(false);
        }
    };

    const handleGenerateQR = async () => {
        if (!invoice) return;
        setProcessing(true);
        setTimeout(() => {
            setQrCodeData("upi://pay?pa=merchant@upi&pn=Luminila&am=" + invoice.grand_total);
            setShowQRPopup(true);
            setProcessing(false);
        }, 1000);
    };

    const handleGenerateEWayBill = () => {
        if (!invoice || !supplierGstin) {
            alert("Please enter Supplier GSTIN");
            return;
        }
        try {
            const json = generateEWayBillJSON(invoice, supplierGstin, ewayDetails);
            exportToJSON(json, `EWB_${invoice.invoice_number}`);
            setShowEwayDialog(false);
        } catch (error) {
            console.error(error);
            alert("Failed to generate E-Way Bill JSON");
        }
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

    const isPaid = invoice.is_paid;
    const isCancelled = invoice.invoice_status === "cancelled";

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title={`Invoice ${invoice.invoice_number}`}
                subtitle={invoice.invoice_date && format(new Date(invoice.invoice_date), "dd MMMM yyyy")}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Toolbar */}
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <Button variant="ghost" onClick={() => router.push("/invoices")}>
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Invoices
                        </Button>

                        <div className="flex items-center gap-2">
                            {/* Payment Actions */}
                            {!isPaid && !isCancelled && (
                                <div className="flex gap-2 mr-2 border-r border-border pr-4">
                                    <Button
                                        onClick={() => setShowPaymentDialog(true)}
                                        className="bg-green-600 hover:bg-green-700"
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
                                        Show QR
                                    </Button>
                                </div>
                            )}

                            {/* Document Actions */}
                            <Button variant="outline" onClick={() => setShowEwayDialog(true)}>
                                <Truck className="w-4 h-4 mr-2" />
                                E-Way Bill
                            </Button>
                            <Button variant="outline" onClick={() => invoice && printInvoice(invoice.id!)}>
                                <Printer className="w-4 h-4 mr-2" />
                                Print
                            </Button>
                            <Button variant="outline" onClick={() => invoice && downloadInvoicePDF(invoice.id!)}>
                                <Download className="w-4 h-4 mr-2" />
                                Download PDF
                            </Button>

                            <DropdownMenu>
                                <DropdownMenuTrigger>
                                    <Button variant="outline" size="icon">
                                        <Share2 className="w-4 h-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => {
                                        const text = `Invoice ${invoice.invoice_number} from Luminila. Total: ${formatINR(invoice.grand_total)}`;
                                        window.open(`https://wa.me/${invoice.customer_phone}?text=${encodeURIComponent(text)}`);
                                    }}>
                                        Share on WhatsApp
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => {
                                        const subject = `Invoice ${invoice.invoice_number} - Luminila`;
                                        const body = `Please find attached the invoice ${invoice.invoice_number}.`;
                                        window.open(`mailto:${invoice.customer_email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
                                    }}>
                                        Share via Email
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Invoice View - A4 Ratio approximation */}
                        <div className="lg:col-span-2">
                            <Card className="bg-white text-black overflow-hidden shadow-lg border-none" style={{ minHeight: '800px' }}>
                                <CardContent className="p-8 space-y-8">
                                    {/* Header */}
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h1 className="text-2xl font-bold text-slate-900">INVOICE</h1>
                                            <p className="text-slate-500 font-mono mt-1">#{invoice.invoice_number}</p>
                                            {isCancelled && <Badge variant="destructive" className="mt-2 text-xs">CANCELLED</Badge>}
                                            {isPaid && <Badge className="mt-2 bg-green-600 hover:bg-green-700 text-xs text-white">PAID</Badge>}
                                        </div>
                                        <div className="text-right">
                                            <h3 className="font-bold text-slate-900">Luminila Innovations</h3>
                                            <p className="text-sm text-slate-600">123 Business Street</p>
                                            <p className="text-sm text-slate-600">Tech Park, Bengaluru, KA</p>
                                            <p className="text-sm text-slate-600">GSTIN: 29ABCDE1234F1Z5</p>
                                        </div>
                                    </div>

                                    {/* Parties */}
                                    <div className="grid grid-cols-2 gap-8 border-t border-slate-100 pt-8">
                                        <div>
                                            <p className="text-xs uppercase font-bold text-slate-400 mb-2">Billed To</p>
                                            <p className="font-bold text-slate-900">{invoice.buyer_name}</p>
                                            {invoice.buyer_address && (
                                                <p className="text-sm text-slate-600 whitespace-pre-line">{invoice.buyer_address}</p>
                                            )}
                                            {invoice.buyer_gstin && (
                                                <p className="text-sm text-slate-600 mt-1">GSTIN: {invoice.buyer_gstin}</p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <div className="space-y-1">
                                                <div className="flex justify-between">
                                                    <span className="text-slate-500 text-sm">Invoice Date:</span>
                                                    <span className="font-medium text-slate-900">
                                                        {invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd MMM yyyy") : "-"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-slate-500 text-sm">Due Date:</span>
                                                    <span className="font-medium text-slate-900">
                                                        {invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd MMM yyyy") : "-"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-slate-500 text-sm">Place of Supply:</span>
                                                    <span className="font-medium text-slate-900">{invoice.place_of_supply || "Karnataka"}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Items Table */}
                                    <div className="min-h-[300px]">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b-2 border-slate-900">
                                                    <th className="text-left py-3 font-bold text-slate-900">Item Description</th>
                                                    <th className="text-center py-3 font-bold text-slate-900 w-24">HSN</th>
                                                    <th className="text-center py-3 font-bold text-slate-900 w-16">Qty</th>
                                                    <th className="text-right py-3 font-bold text-slate-900 w-28">Price</th>
                                                    <th className="text-right py-3 font-bold text-slate-900 w-24">Tax</th>
                                                    <th className="text-right py-3 font-bold text-slate-900 w-32">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {invoice.items?.map((item, idx) => {
                                                    const taxAmount = item.cgst_amount + item.sgst_amount + item.igst_amount;
                                                    return (
                                                        <tr key={idx}>
                                                            <td className="py-3 text-slate-900">
                                                                <p className="font-medium">{item.description}</p>
                                                                {item.discount_amount > 0 && <p className="text-xs text-slate-500">Disc: -{formatINR(item.discount_amount)}</p>}
                                                            </td>
                                                            <td className="py-3 text-center text-slate-600 font-mono text-xs">{item.hsn_code}</td>
                                                            <td className="py-3 text-center text-slate-900">{item.quantity}</td>
                                                            <td className="py-3 text-right text-slate-900 font-mono">{formatINR(item.unit_price)}</td>
                                                            <td className="py-3 text-right text-slate-600 font-mono text-xs">{formatINR(taxAmount)}</td>
                                                            <td className="py-3 text-right text-slate-900 font-bold font-mono">{formatINR(item.total_amount)}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Totals */}
                                    <div className="flex justify-end border-t border-slate-900 pt-4">
                                        <div className="w-72 space-y-2">
                                            <div className="flex justify-between text-slate-600 text-sm">
                                                <span>Taxable Amount</span>
                                                <span className="font-mono">{formatINR(invoice.taxable_value)}</span>
                                            </div>
                                            {invoice.total_tax > 0 && (
                                                <div className="flex justify-between text-slate-600 text-sm">
                                                    <span>Total Tax (GST)</span>
                                                    <span className="font-mono">{formatINR(invoice.total_tax)}</span>
                                                </div>
                                            )}
                                            {invoice.round_off !== undefined && invoice.round_off !== 0 && (
                                                <div className="flex justify-between text-slate-600 text-sm">
                                                    <span>Round Off</span>
                                                    <span className="font-mono">{invoice.round_off > 0 ? '+' : ''}{invoice.round_off.toFixed(2)}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between items-end border-t border-slate-200 pt-2 mt-2">
                                                <span className="font-bold text-slate-900">Grand Total</span>
                                                <span className="font-bold text-2xl text-slate-900 font-mono">{formatINR(invoice.grand_total)}</span>
                                            </div>
                                            <p className="text-xs text-right text-slate-500 italic mt-1">
                                                ({toWords(invoice.grand_total)})
                                            </p>
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="border-t border-slate-100 pt-8 mt-auto">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-xs font-bold text-slate-400 uppercase">Bank Details</p>
                                                <p className="text-sm text-slate-600">Bank: HDFC Bank</p>
                                                <p className="text-sm text-slate-600">Acct: 1234567890</p>
                                                <p className="text-sm text-slate-600">IFSC: HDFC0001234</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-slate-400 mb-8">Authorised Signatory</p>
                                                <p className="font-bold text-slate-900">Luminila Innovations</p>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Sidebar Info */}
                        <div className="space-y-6">
                            {/* Payment Status */}
                            <Card className="bg-card border-border">
                                <CardHeader>
                                    <CardTitle className="text-sm">Payment Status</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {invoice.is_paid ? (
                                        <div className="flex items-center gap-2 text-green-400">
                                            <CheckCircle className="w-5 h-5" />
                                            <span className="font-semibold">Paid Completed</span>
                                        </div>
                                    ) : invoice.invoice_status === "cancelled" ? (
                                        <div className="flex items-center gap-2 text-red-400">
                                            <XCircle className="w-5 h-5" />
                                            <span className="font-semibold">Cancelled</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-yellow-400">
                                            <Clock className="w-5 h-5" />
                                            <span className="font-semibold">Payment Pending</span>
                                        </div>
                                    )}

                                    {/* Payment History */}
                                    {invoice.payments && invoice.payments.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-border">
                                            <p className="text-xs text-muted-foreground mb-2">History</p>
                                            {invoice.payments.map((p, i) => (
                                                <div key={i} className="text-sm flex justify-between mb-1">
                                                    <span>{format(new Date(p.date), "dd MMM")}</span>
                                                    <span className="font-mono">{formatINR(p.amount)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Activity/Audit Log */}
                            <Card className="bg-card border-border">
                                <CardHeader>
                                    <CardTitle className="text-sm">Activity</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex gap-3 text-sm">
                                            <div className="mt-0.5">
                                                <div className="w-2 h-2 rounded-full bg-primary" />
                                            </div>
                                            <div>
                                                <p className="text-foreground">Invoice created</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {invoice.created_at ? format(new Date(invoice.created_at), "dd MMM HH:mm") : "-"}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
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
                        <DialogTitle>Record Payment</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Amount Received</Label>
                            <Input
                                type="number"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                                placeholder="Enter amount"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Payment Mode</Label>
                            <Select value={paymentMethod} onValueChange={(val) => val && setPaymentMethod(val)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash">Cash</SelectItem>
                                    <SelectItem value="upi">UPI / QR</SelectItem>
                                    <SelectItem value="card">Card</SelectItem>
                                    <SelectItem value="bank">Bank Transfer</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Reference ID (Optional)</Label>
                            <Input
                                value={paymentReference}
                                onChange={(e) => setPaymentReference(e.target.value)}
                                placeholder="Txn ID, Check No, etc."
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleRecordPayment}
                                disabled={processing}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                {processing ? "Recording..." : "Confirm Payment"}
                            </Button>
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
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Supplier GSTIN</Label>
                            <Input
                                placeholder="Your Organization GSTIN"
                                value={supplierGstin}
                                onChange={(e) => setSupplierGstin(e.target.value)}
                                className="uppercase"
                                maxLength={15}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Approx Distance (km)</Label>
                            <Input
                                type="number"
                                value={ewayDetails.distance}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, distance: parseFloat(e.target.value) || 0 })}
                                placeholder="e.g. 50"
                            />
                        </div>
                        <Separator />
                        <div className="space-y-2">
                            <Label>Transporter ID (Optional)</Label>
                            <Input
                                placeholder="GSTIN of Transporter"
                                value={ewayDetails.transporterId || ''}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, transporterId: e.target.value })}
                                className="uppercase"
                                maxLength={15}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Transporter Name (Optional)</Label>
                            <Input
                                placeholder="Name of Transporter"
                                value={ewayDetails.transporterName || ''}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, transporterName: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Vehicle Number (Optional)</Label>
                            <Input
                                placeholder="e.g. KA01AB1234"
                                value={ewayDetails.vehicleNo || ''}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, vehicleNo: e.target.value })}
                                className="uppercase"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowEwayDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleGenerateEWayBill}
                                className="bg-primary text-midnight hover:bg-primary/90"
                            >
                                <FileText className="w-4 h-4 mr-2" />
                                Download JSON
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* QR Code Popup */}
            <Dialog open={showQRPopup} onOpenChange={setShowQRPopup}>
                <DialogContent className="max-w-sm text-center">
                    <DialogHeader>
                        <DialogTitle>Scan to Pay</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col items-center justify-center p-6 space-y-4">
                        <div className="w-48 h-48 bg-white p-2 rounded-lg flex items-center justify-center border-2 border-slate-900">
                            <div className="w-full h-full bg-slate-900/10 flex items-center justify-center text-xs text-muted-foreground">
                                [QR Code Placeholder]
                                <br />
                                {invoice && formatINR(invoice.grand_total)}
                            </div>
                        </div>
                        <p className="text-sm font-medium">Luminila Innovations</p>
                        <p className="text-xs text-muted-foreground">Scan with any UPI app</p>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function InvoiceDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
            <InvoiceDetailContent />
        </Suspense>
    );
}
