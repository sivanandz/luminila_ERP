"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    FileText,
    Plus,
    Search,
    Download,
    Printer,
    Eye,
    Copy,
    Trash2,
    RotateCcw,
    AlertTriangle,
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
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

import {
    getInvoices,
    cloneInvoice,
    trashInvoice,
    restoreInvoice,
    deleteInvoicePermanently,
    type Invoice,
} from "@/lib/invoice";
import { formatINR } from "@/lib/gst";

// Quote a value for CSV output when it contains separators, quotes or newlines,
// and neutralize spreadsheet formula characters (=, +, -, @, |, tab, CR)
const escapeCsvField = (value: unknown): string => {
    let str = value === null || value === undefined ? "" : String(value);
    if (/^[=+@-|\t\r]/.test(str)) {
        str = `'${str}`;
    }
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

export default function InvoicesPage() {
    const router = useRouter();
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [paidFilter, setPaidFilter] = useState<string>("all");
    const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const fetchSeq = useRef(0);

    // Debounce the search box so typing does not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const fetchInvoices = useCallback(async () => {
        const seq = ++fetchSeq.current;
        setLoading(true);
        try {
            const filters: NonNullable<Parameters<typeof getInvoices>[0]> = {
                isDeleted: activeTab === "trash",
            };

            if (typeFilter !== "all") {
                filters.invoiceType = typeFilter;
            }
            if (paidFilter !== "all") {
                filters.isPaid = paidFilter === "paid";
            }
            if (debouncedSearch) {
                filters.buyerName = debouncedSearch;
            }

            const data = await getInvoices(filters);
            if (seq !== fetchSeq.current) return; // a newer request superseded this one
            setInvoices(data);
        } catch (error) {
            if (seq !== fetchSeq.current) return;
            console.error("Error fetching invoices:", error);
            toast.error("Failed to load invoices");
        } finally {
            if (seq === fetchSeq.current) {
                setLoading(false);
            }
        }
    }, [activeTab, typeFilter, paidFilter, debouncedSearch]);

    useEffect(() => {
        fetchInvoices();
    }, [fetchInvoices]);

    // Clone Invoice Handler
    const handleClone = async (invoice: Invoice, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!invoice.id) return;
        setActionLoadingId(invoice.id);
        try {
            toast.loading(`Cloning #${invoice.invoice_number}...`, { id: "clone-inv" });
            const cloned = await cloneInvoice(invoice.id);
            toast.success(`Cloned as draft #${cloned.invoice_number}!`, { id: "clone-inv" });
            router.push(`/invoices/detail?id=${cloned.id}`);
        } catch (error) {
            console.error("Clone failed:", error);
            toast.error("Failed to clone invoice", { id: "clone-inv" });
        } finally {
            setActionLoadingId(null);
        }
    };

    // Soft Delete / Move to Trash Handler
    const handleTrash = async (invoice: Invoice, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!invoice.id) return;
        if (!confirm(`Move invoice #${invoice.invoice_number} to Trash?`)) return;

        setActionLoadingId(invoice.id);
        try {
            await trashInvoice(invoice.id);
            toast.success(`Moved #${invoice.invoice_number} to Trash`);
            fetchInvoices();
        } catch (error) {
            console.error("Trash failed:", error);
            toast.error("Failed to move to trash");
        } finally {
            setActionLoadingId(null);
        }
    };

    // Restore from Trash Handler
    const handleRestore = async (invoice: Invoice, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!invoice.id) return;

        setActionLoadingId(invoice.id);
        try {
            await restoreInvoice(invoice.id);
            toast.success(`Restored #${invoice.invoice_number}`);
            fetchInvoices();
        } catch (error) {
            console.error("Restore failed:", error);
            toast.error("Failed to restore invoice");
        } finally {
            setActionLoadingId(null);
        }
    };

    // Permanent Delete Handler
    const handleDeleteForever = async (invoice: Invoice, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!invoice.id) return;
        if (!confirm(`Permanently delete #${invoice.invoice_number}? This cannot be undone.`)) return;

        setActionLoadingId(invoice.id);
        try {
            await deleteInvoicePermanently(invoice.id);
            toast.success(`Permanently deleted #${invoice.invoice_number}`);
            fetchInvoices();
        } catch (error) {
            console.error("Delete failed:", error);
            toast.error("Failed to delete permanently");
        } finally {
            setActionLoadingId(null);
        }
    };

    // Calculate totals
    const totalRevenue = invoices.reduce((sum, inv) => sum + inv.grand_total, 0);
    const paidAmount = invoices.reduce((sum, inv) => sum + (inv.paid_amount || 0), 0);
    const pendingAmount = Math.max(0, totalRevenue - paidAmount);
    const invoiceCount = invoices.length;

    const getStatusBadge = (invoice: Invoice) => {
        if (invoice.is_paid || (invoice.balance_due !== undefined && invoice.balance_due === 0)) {
            return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Paid</Badge>;
        }
        if (invoice.paid_amount && invoice.paid_amount > 0) {
            return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Partial ({formatINR(invoice.balance_due || 0)} due)</Badge>;
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
                return <Badge variant="outline" className="border-primary/50 text-primary">Invoice</Badge>;
        }
    };

    const invoiceTypeLabel = (type: string) =>
        type === 'credit_note' ? 'Credit Note' : type === 'debit_note' ? 'Debit Note' : 'Invoice';

    // Shared row actions so the desktop table and the phone card list stay in step
    const renderRowActions = (invoice: Invoice) => {
        if (activeTab === "active") {
            return (
                <>
                    <Button
                        variant="ghost"
                        size="icon"
                        title="View Invoice"
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
                        title="Clone Invoice"
                        disabled={actionLoadingId === invoice.id}
                        onClick={(e) => handleClone(invoice, e)}
                    >
                        <Copy className="w-4 h-4 text-primary" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Print"
                        onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/invoices/detail?id=${invoice.id}&print=true`);
                        }}
                    >
                        <Printer className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Move to Trash"
                        disabled={actionLoadingId === invoice.id}
                        onClick={(e) => handleTrash(invoice, e)}
                        className="hover:text-destructive"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </>
            );
        }

        return (
            <>
                <Button
                    variant="outline"
                    size="sm"
                    title="Restore Invoice"
                    disabled={actionLoadingId === invoice.id}
                    onClick={(e) => handleRestore(invoice, e)}
                    className="h-8 gap-1 text-emerald-400 border-emerald-500/40"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                </Button>
                <Button
                    variant="destructive"
                    size="sm"
                    title="Delete Permanently"
                    disabled={actionLoadingId === invoice.id}
                    onClick={(e) => handleDeleteForever(invoice, e)}
                    className="h-8"
                >
                    Delete
                </Button>
            </>
        );
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Invoices"
                subtitle={`${invoiceCount} ${activeTab === 'trash' ? 'trashed invoices' : 'GST invoices'}`}
            />

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-8 scroll-smooth">
                {/* Stats Cards */}
                {/* Four-up only on very wide screens: at md/lg the card is too
                    narrow for the rupee totals at text-2xl and the text spilled. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2.5 md:gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                                    <FileText className="w-5 h-5 text-primary" />
                                </div>
                                <p className="min-w-0 text-sm text-muted-foreground break-words">{activeTab === "trash" ? "Trashed Count" : "Total Invoices"}</p>
                            </div>
                            <p className="mt-2 text-xl lg:text-2xl font-bold font-mono break-words">{invoiceCount}</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-emerald-500/10 shrink-0">
                                    <FileText className="w-5 h-5 text-emerald-500" />
                                </div>
                                <p className="min-w-0 text-sm text-muted-foreground break-words">Total Value</p>
                            </div>
                            <p className="mt-2 text-xl lg:text-2xl font-bold font-mono break-words">{formatINR(totalRevenue)}</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-green-500/10 shrink-0">
                                    <FileText className="w-5 h-5 text-green-500" />
                                </div>
                                <p className="min-w-0 text-sm text-muted-foreground break-words">Paid Amount</p>
                            </div>
                            <p className="mt-2 text-xl lg:text-2xl font-bold font-mono break-words">{formatINR(paidAmount)}</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
                                    <FileText className="w-5 h-5 text-amber-500" />
                                </div>
                                <p className="min-w-0 text-sm text-muted-foreground break-words">Balance Due</p>
                            </div>
                            <p className="mt-2 text-xl lg:text-2xl font-bold font-mono break-words">{formatINR(pendingAmount)}</p>
                        </CardContent>
                    </Card>
                </div>

                {/* View Tabs: Active vs Trash */}
                <div className="flex items-center justify-between border-b border-border pb-3 mb-6">
                    <div className="flex items-center gap-2">
                        <Button
                            variant={activeTab === "active" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setActiveTab("active")}
                            className="rounded-full px-4"
                        >
                            Active Invoices
                        </Button>
                        <Button
                            variant={activeTab === "trash" ? "destructive" : "ghost"}
                            size="sm"
                            onClick={() => setActiveTab("trash")}
                            className="rounded-full px-4 gap-1.5"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Trash Bin
                        </Button>
                    </div>

                    {activeTab === "trash" && invoices.length > 0 && (
                        <div className="flex items-center text-xs text-amber-400 gap-1.5">
                            <AlertTriangle className="w-4 h-4" />
                            Items here are archived and excluded from active reports
                        </div>
                    )}
                </div>

                {/* Search & Filters */}
                {/* Filters and actions stack until lg: at md the action pair plus
                    the search field and both selects do not fit on one row. */}
                <div className="flex flex-col lg:flex-row gap-4 justify-between items-center mb-6">
                    <div className="flex flex-1 w-full flex-wrap items-center gap-3 lg:w-auto">
                        <div className="relative w-full md:w-80 md:flex-1">
                            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                            <Input
                                placeholder="Search by customer or buyer..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 bg-card border-border"
                            />
                        </div>

                        <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
                            <SelectTrigger className="w-36 bg-card border-border">
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
                        {activeTab === "active" && (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-border"
                                    onClick={() => {
                                        const csv = invoices.map(inv =>
                                            [
                                                inv.invoice_number,
                                                inv.invoice_date,
                                                inv.buyer_name,
                                                inv.grand_total,
                                                inv.is_paid ? 'Paid' : 'Pending',
                                            ].map(escapeCsvField).join(',')
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
                                    Export CSV
                                </Button>

                                <Button
                                    onClick={() => router.push("/invoices/create")}
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    New Invoice
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Invoice Table */}
                <Card className="bg-card border-border">
                    <CardContent className="p-0">
                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading invoices...</div>
                        ) : invoices.length === 0 ? (
                            <div className="text-center py-12">
                                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                                <p className="text-muted-foreground">
                                    {activeTab === "trash" ? "Trash bin is empty" : "No invoices found"}
                                </p>
                                {activeTab === "active" && (
                                    <Button
                                        variant="link"
                                        className="text-primary mt-2"
                                        onClick={() => router.push("/invoices/create")}
                                    >
                                        Create your first invoice
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <>
                                {/* Phones: stacked cards — the nine-column table cannot fit 360px without sideways scrolling */}
                                <div className="space-y-2 p-3 md:hidden">
                                    {invoices.map((invoice) => (
                                        <div
                                            key={invoice.id}
                                            className="rounded-lg border border-border p-3 cursor-pointer active:bg-muted/50"
                                            onClick={() => router.push(`/invoices/detail?id=${invoice.id}`)}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="min-w-0 truncate font-mono text-sm font-semibold text-primary">
                                                    {invoice.invoice_number}
                                                </p>
                                                <div className="shrink-0">{getStatusBadge(invoice)}</div>
                                            </div>
                                            <div className="mt-2 flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium">{invoice.buyer_name || "Walk-in"}</p>
                                                    <p className="truncate text-xs text-muted-foreground">
                                                        {invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd MMM yyyy") : "-"} · {invoiceTypeLabel(invoice.invoice_type)}
                                                    </p>
                                                </div>
                                                <p className="shrink-0 font-mono text-sm font-bold">{formatINR(invoice.grand_total)}</p>
                                            </div>
                                            <div className="mt-1 flex items-center justify-end gap-1 [&_button]:min-h-9 [&_button]:min-w-9">
                                                {renderRowActions(invoice)}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="hidden md:block">
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
                                            {invoices.map((invoice) => (
                                                <TableRow
                                                    key={invoice.id}
                                                    className="border-border hover:bg-muted/50 cursor-pointer"
                                                    onClick={() => router.push(`/invoices/detail?id=${invoice.id}`)}
                                                >
                                                    <TableCell className="font-mono text-primary font-semibold">
                                                        {invoice.invoice_number}
                                                    </TableCell>
                                                    <TableCell>
                                                        {invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd MMM yyyy") : "-"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div>
                                                            <p className="font-medium">{invoice.buyer_name || "Walk-in"}</p>
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
                                                    <TableCell className="text-right font-mono font-bold">
                                                        {formatINR(invoice.grand_total)}
                                                    </TableCell>
                                                    <TableCell>{getStatusBadge(invoice)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            {renderRowActions(invoice)}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
