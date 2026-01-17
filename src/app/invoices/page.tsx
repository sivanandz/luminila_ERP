"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    FileText,
    Plus,
    Search,
    Filter,
    Download,
    Printer,
    Eye,
    CheckCircle,
    Clock,
    IndianRupee,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getInvoices, type Invoice } from "@/lib/invoice";
import { formatINR } from "@/lib/gst";

export default function InvoicesPage() {
    const router = useRouter();
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [paidFilter, setPaidFilter] = useState<string>("all");

    const fetchInvoices = useCallback(async () => {
        setLoading(true);
        try {
            const filters: any = {};

            if (typeFilter !== "all") {
                filters.invoiceType = typeFilter;
            }
            if (paidFilter !== "all") {
                filters.isPaid = paidFilter === "paid";
            }
            if (searchQuery) {
                filters.buyerName = searchQuery;
            }

            const data = await getInvoices(filters);
            setInvoices(data);
        } catch (error) {
            console.error("Error fetching invoices:", error);
        } finally {
            setLoading(false);
        }
    }, [typeFilter, paidFilter, searchQuery]);

    useEffect(() => {
        fetchInvoices();
    }, [fetchInvoices]);

    // Calculate totals
    const totalRevenue = invoices.reduce((sum, inv) => sum + inv.grand_total, 0);
    const paidAmount = invoices.filter(inv => inv.is_paid).reduce((sum, inv) => sum + inv.grand_total, 0);
    const pendingAmount = totalRevenue - paidAmount;
    const invoiceCount = invoices.length;

    const getStatusBadge = (invoice: Invoice) => {
        if (invoice.is_paid) {
            return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Paid</Badge>;
        }
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>;
    };

    const getTypeBadge = (type: string) => {
        switch (type) {
            case 'credit_note':
                return <Badge variant="outline" className="border-red-500/50 text-red-400">Credit Note</Badge>;
            case 'debit_note':
                return <Badge variant="outline" className="border-blue-500/50 text-blue-400">Debit Note</Badge>;
            default:
                return <Badge variant="outline" className="border-moonstone/50 text-moonstone">Invoice</Badge>;
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Invoices"
                subtitle={`${invoiceCount} GST invoices`}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <FileText className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Total Invoices</p>
                                    <p className="text-2xl font-semibold">{invoiceCount}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-500/10">
                                    <IndianRupee className="w-5 h-5 text-green-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                                    <p className="text-2xl font-semibold">{formatINR(totalRevenue)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-500/10">
                                    <CheckCircle className="w-5 h-5 text-green-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Collected</p>
                                    <p className="text-2xl font-semibold">{formatINR(paidAmount)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-yellow-500/10">
                                    <Clock className="w-5 h-5 text-yellow-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Pending</p>
                                    <p className="text-2xl font-semibold">{formatINR(pendingAmount)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters & Actions */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="relative flex-1 md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by customer name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-card border-border"
                            />
                        </div>

                        <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
                            <SelectTrigger className="w-40 bg-card border-border">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="regular">Invoice</SelectItem>
                                <SelectItem value="credit_note">Credit Note</SelectItem>
                                <SelectItem value="debit_note">Debit Note</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={paidFilter} onValueChange={(v) => v && setPaidFilter(v)}>
                            <SelectTrigger className="w-32 bg-card border-border">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="paid">Paid</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="border-border"
                            onClick={() => {
                                // Export to CSV
                                const csv = invoices.map(inv =>
                                    `${inv.invoice_number},${inv.invoice_date},${inv.buyer_name},${inv.grand_total},${inv.is_paid ? 'Paid' : 'Pending'}`
                                ).join('\n');
                                const blob = new Blob([`Invoice No,Date,Customer,Amount,Status\n${csv}`], { type: 'text/csv' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `invoices_${format(new Date(), 'yyyy-MM-dd')}.csv`;
                                a.click();
                            }}
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Export
                        </Button>

                        <Button
                            onClick={() => router.push("/invoices/create")}
                            className=""
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            New Invoice
                        </Button>
                    </div>
                </div>

                {/* Invoice Table */}
                <Card className="bg-card border-border">
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-border hover:bg-transparent">
                                    <TableHead className="text-muted-foreground">Invoice No.</TableHead>
                                    <TableHead className="text-muted-foreground">Date</TableHead>
                                    <TableHead className="text-muted-foreground">Customer</TableHead>
                                    <TableHead className="text-muted-foreground">Type</TableHead>
                                    <TableHead className="text-muted-foreground text-right">Taxable</TableHead>
                                    <TableHead className="text-muted-foreground text-right">Tax</TableHead>
                                    <TableHead className="text-muted-foreground text-right">Total</TableHead>
                                    <TableHead className="text-muted-foreground">Status</TableHead>
                                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                                            Loading invoices...
                                        </TableCell>
                                    </TableRow>
                                ) : invoices.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-12">
                                            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                                            <p className="text-muted-foreground">No invoices found</p>
                                            <Button
                                                variant="link"
                                                className="text-primary mt-2"
                                                onClick={() => router.push("/invoices/create")}
                                            >
                                                Create your first invoice
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    invoices.map((invoice) => (
                                        <TableRow
                                            key={invoice.id}
                                            className="border-border hover:bg-muted/50 cursor-pointer"
                                            onClick={() => router.push(`/invoices/detail?id=${invoice.id}`)}
                                        >
                                            <TableCell className="font-mono text-primary">
                                                {invoice.invoice_number}
                                            </TableCell>
                                            <TableCell>
                                                {format(new Date(invoice.invoice_date), "dd MMM yyyy")}
                                            </TableCell>
                                            <TableCell>
                                                <div>
                                                    <p className="font-medium">{invoice.buyer_name}</p>
                                                    {invoice.buyer_gstin && (
                                                        <p className="text-xs text-muted-foreground">{invoice.buyer_gstin}</p>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>{getTypeBadge(invoice.invoice_type)}</TableCell>
                                            <TableCell className="text-right font-mono">
                                                {formatINR(invoice.taxable_value)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">
                                                {formatINR(invoice.total_tax)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-semibold">
                                                {formatINR(invoice.grand_total)}
                                            </TableCell>
                                            <TableCell>{getStatusBadge(invoice)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            router.push(`/invoices/detail?id=${invoice.id}`);
                                                        }}
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            router.push(`/invoices/detail?id=${invoice.id}&print=true`);
                                                        }}
                                                    >
                                                        <Printer className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}


