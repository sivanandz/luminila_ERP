"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Printer,
    Download,
    CheckCircle,
    Edit,
    Mail,
    MessageSquare,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { getInvoice, markInvoicePaid, getStoreSettings, type Invoice, type StoreSettings } from "@/lib/invoice";
import { formatINR } from "@/lib/gst";
import { InvoicePrint, type InvoicePrintRef, type PrintMode } from "@/components/invoice/InvoicePrint";

export default function InvoiceDetailPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const printRef = useRef<InvoicePrintRef>(null);

    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [markingPaid, setMarkingPaid] = useState(false);
    const [printMode, setPrintMode] = useState<PrintMode>("regular");

    const invoiceId = params.id as string;
    const shouldPrint = searchParams.get("print") === "true";

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            try {
                const [invoiceData, settings] = await Promise.all([
                    getInvoice(invoiceId),
                    getStoreSettings(),
                ]);
                setInvoice(invoiceData);
                setStoreSettings(settings);
                setPrintMode((settings?.default_print_mode || "regular") as PrintMode);

                // Auto-print if requested
                if (shouldPrint && invoiceData) {
                    setTimeout(() => {
                        printRef.current?.print();
                    }, 500);
                }
            } catch (error) {
                console.error("Error loading invoice:", error);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, [invoiceId, shouldPrint]);

    const handleMarkPaid = async () => {
        if (!invoice) return;
        setMarkingPaid(true);
        try {
            await markInvoicePaid(invoice.id!);
            setInvoice({ ...invoice, is_paid: true, paid_amount: invoice.grand_total });
        } catch (error) {
            console.error("Error marking invoice as paid:", error);
        } finally {
            setMarkingPaid(false);
        }
    };

    const handlePrint = () => {
        printRef.current?.print();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-muted-foreground">Loading invoice...</div>
            </div>
        );
    }

    if (!invoice) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-muted-foreground">Invoice not found</div>
                <Button variant="outline" onClick={() => router.push("/invoices")}>
                    Back to Invoices
                </Button>
            </div>
        );
    }

    const isInterState = invoice.igst_amount > 0;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title={`Invoice ${invoice.invoice_number}`}
                subtitle={format(new Date(invoice.invoice_date), "dd MMMM yyyy")}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Actions Bar */}
                <div className="flex items-center justify-between mb-6">
                    <Button variant="ghost" onClick={() => router.push("/invoices")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Invoices
                    </Button>

                    <div className="flex items-center gap-2">
                        {!invoice.is_paid && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" className="border-green-500/50 text-green-400">
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                        Mark as Paid
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Mark Invoice as Paid?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will mark invoice {invoice.invoice_number} as fully paid
                                            ({formatINR(invoice.grand_total)}).
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={handleMarkPaid}
                                            disabled={markingPaid}
                                            className="bg-green-600"
                                        >
                                            {markingPaid ? "Processing..." : "Confirm Payment"}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}

                        <Select value={printMode} onValueChange={(v) => setPrintMode(v as PrintMode)}>
                            <SelectTrigger className="w-36">
                                <SelectValue placeholder="Print mode" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="regular">A4 (Regular)</SelectItem>
                                <SelectItem value="thermal58">Thermal 58mm</SelectItem>
                                <SelectItem value="thermal80">Thermal 80mm</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button variant="outline" onClick={handlePrint}>
                            <Printer className="w-4 h-4 mr-2" />
                            Print
                        </Button>

                        <Button
                            className="bg-champagne text-midnight hover:bg-champagne/90"
                            onClick={handlePrint}
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Download PDF
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Main Invoice Card */}
                    <div className="lg:col-span-2">
                        <Card className="bg-card/50 border-border/50">
                            <CardHeader className="border-b border-border/50">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="text-champagne">
                                            {invoice.invoice_type === "credit_note"
                                                ? "CREDIT NOTE"
                                                : invoice.invoice_type === "debit_note"
                                                    ? "DEBIT NOTE"
                                                    : "TAX INVOICE"}
                                        </CardTitle>
                                        <p className="text-sm text-muted-foreground font-mono mt-1">
                                            {invoice.invoice_number}
                                        </p>
                                    </div>
                                    <Badge
                                        className={
                                            invoice.is_paid
                                                ? "bg-green-500/20 text-green-400 border-green-500/30"
                                                : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                                        }
                                    >
                                        {invoice.is_paid ? "Paid" : "Pending"}
                                    </Badge>
                                </div>
                            </CardHeader>

                            <CardContent className="pt-6 space-y-6">
                                {/* Parties */}
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2">
                                            From
                                        </h4>
                                        <div className="space-y-1">
                                            <p className="font-semibold">{invoice.seller_name}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {invoice.seller_address}
                                            </p>
                                            {invoice.seller_gstin && (
                                                <p className="text-sm">
                                                    <span className="text-muted-foreground">GSTIN:</span>{" "}
                                                    {invoice.seller_gstin}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2">
                                            Bill To
                                        </h4>
                                        <div className="space-y-1">
                                            <p className="font-semibold">{invoice.buyer_name}</p>
                                            {invoice.buyer_address && (
                                                <p className="text-sm text-muted-foreground">
                                                    {invoice.buyer_address}
                                                </p>
                                            )}
                                            {invoice.buyer_gstin && (
                                                <p className="text-sm">
                                                    <span className="text-muted-foreground">GSTIN:</span>{" "}
                                                    {invoice.buyer_gstin}
                                                </p>
                                            )}
                                            {invoice.buyer_phone && (
                                                <p className="text-sm text-muted-foreground">
                                                    {invoice.buyer_phone}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Items Table */}
                                <div>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-border/50">
                                                <TableHead className="w-10">#</TableHead>
                                                <TableHead>Description</TableHead>
                                                <TableHead className="w-20">HSN</TableHead>
                                                <TableHead className="w-16 text-center">Qty</TableHead>
                                                <TableHead className="w-24 text-right">Rate</TableHead>
                                                <TableHead className="w-24 text-right">Taxable</TableHead>
                                                {isInterState ? (
                                                    <TableHead className="w-20 text-right">IGST</TableHead>
                                                ) : (
                                                    <>
                                                        <TableHead className="w-20 text-right">CGST</TableHead>
                                                        <TableHead className="w-20 text-right">SGST</TableHead>
                                                    </>
                                                )}
                                                <TableHead className="w-24 text-right">Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {invoice.items?.map((item, index) => (
                                                <TableRow key={item.id || index} className="border-border/50">
                                                    <TableCell>{index + 1}</TableCell>
                                                    <TableCell>{item.description}</TableCell>
                                                    <TableCell className="text-muted-foreground">
                                                        {item.hsn_code}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        {item.quantity} {item.unit}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">
                                                        {formatINR(item.unit_price)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">
                                                        {formatINR(item.taxable_amount)}
                                                    </TableCell>
                                                    {isInterState ? (
                                                        <TableCell className="text-right font-mono text-muted-foreground">
                                                            {formatINR(item.igst_amount)}
                                                            <br />
                                                            <span className="text-xs">@{item.igst_rate}%</span>
                                                        </TableCell>
                                                    ) : (
                                                        <>
                                                            <TableCell className="text-right font-mono text-muted-foreground">
                                                                {formatINR(item.cgst_amount)}
                                                                <br />
                                                                <span className="text-xs">@{item.cgst_rate}%</span>
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono text-muted-foreground">
                                                                {formatINR(item.sgst_amount)}
                                                                <br />
                                                                <span className="text-xs">@{item.sgst_rate}%</span>
                                                            </TableCell>
                                                        </>
                                                    )}
                                                    <TableCell className="text-right font-mono font-semibold">
                                                        {formatINR(item.total_amount)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>

                                {/* Totals */}
                                <div className="flex justify-end">
                                    <div className="w-72 space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Taxable Value</span>
                                            <span className="font-mono">{formatINR(invoice.taxable_value)}</span>
                                        </div>
                                        {isInterState ? (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">IGST</span>
                                                <span className="font-mono">{formatINR(invoice.igst_amount)}</span>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">CGST</span>
                                                    <span className="font-mono">{formatINR(invoice.cgst_amount)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">SGST</span>
                                                    <span className="font-mono">{formatINR(invoice.sgst_amount)}</span>
                                                </div>
                                            </>
                                        )}
                                        {invoice.discount_amount > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">Discount</span>
                                                <span className="font-mono text-green-400">
                                                    -{formatINR(invoice.discount_amount)}
                                                </span>
                                            </div>
                                        )}
                                        <div className="border-t border-border/50 pt-2 flex justify-between font-semibold">
                                            <span>Grand Total</span>
                                            <span className="font-mono text-champagne text-lg">
                                                {formatINR(invoice.grand_total)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Amount in Words */}
                                <div className="bg-muted/20 rounded-lg p-4">
                                    <p className="text-sm text-muted-foreground">Amount in Words</p>
                                    <p className="font-medium italic">{invoice.amount_in_words}</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Quick Info */}
                        <Card className="bg-card/50 border-border/50">
                            <CardHeader>
                                <CardTitle className="text-sm">Invoice Details</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Invoice Date</span>
                                    <span>{format(new Date(invoice.invoice_date), "dd MMM yyyy")}</span>
                                </div>
                                {invoice.due_date && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Due Date</span>
                                        <span>{format(new Date(invoice.due_date), "dd MMM yyyy")}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Place of Supply</span>
                                    <span>{invoice.place_of_supply}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Reverse Charge</span>
                                    <span>{invoice.is_reverse_charge ? "Yes" : "No"}</span>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Payment Status */}
                        <Card className="bg-card/50 border-border/50">
                            <CardHeader>
                                <CardTitle className="text-sm">Payment</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Status</span>
                                    <Badge
                                        className={
                                            invoice.is_paid
                                                ? "bg-green-500/20 text-green-400"
                                                : "bg-yellow-500/20 text-yellow-400"
                                        }
                                    >
                                        {invoice.is_paid ? "Paid" : "Pending"}
                                    </Badge>
                                </div>
                                {invoice.is_paid && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Paid Amount</span>
                                        <span className="font-mono">{formatINR(invoice.paid_amount)}</span>
                                    </div>
                                )}
                                {invoice.payment_terms && (
                                    <div className="text-sm">
                                        <span className="text-muted-foreground block mb-1">Terms</span>
                                        <span>{invoice.payment_terms}</span>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Notes */}
                        {invoice.notes && (
                            <Card className="bg-card/50 border-border/50">
                                <CardHeader>
                                    <CardTitle className="text-sm">Notes</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">{invoice.notes}</p>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>

                {/* Hidden Print Component */}
                <div className="hidden">
                    <InvoicePrint ref={printRef} invoice={invoice} mode={printMode} storeSettings={storeSettings || undefined} />
                </div>
            </div>
        </div>
    );
}
