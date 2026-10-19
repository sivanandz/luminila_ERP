"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
    ArrowLeft,
    Download,
    Printer,


} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { getSalesReport, exportToCSV, printReport, type SalesReportRow, type ReportSummary } from "@/lib/reports";
import { formatINR } from "@/lib/gst";

export default function SalesReportPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<SalesReportRow[]>([]);
    const [summary, setSummary] = useState<ReportSummary>({
        totalSales: 0,
        totalTax: 0,
        totalOrders: 0,
        totalItems: 0,
    });

    // Default to current month
    const [startDate, setStartDate] = useState(
        format(startOfMonth(new Date()), "yyyy-MM-dd")
    );
    const [endDate, setEndDate] = useState(
        format(endOfMonth(new Date()), "yyyy-MM-dd")
    );

    const loadReport = useCallback(async () => {
        setLoading(true);
        const { rows, summary } = await getSalesReport(startDate, endDate);
        setRows(rows);
        setSummary(summary);
        setLoading(false);
    }, [startDate, endDate]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- setLoading(true) must run synchronously before the async fetch so the Loading UI appears when the date range changes; the remaining setStates happen after awaits
        loadReport();
    }, [loadReport]);

    const handleExport = () => {
        exportToCSV(rows, "sales_report");
    };

    const handlePrint = () => {
        printReport("sales-report-table", "Sales Report");
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Sales Report" subtitle="Invoice and revenue summary" />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Actions */}
                <div className="flex items-center justify-between mb-6">
                    <Button variant="ghost" onClick={() => router.push("/reports")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Reports
                    </Button>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-40 bg-card"
                            />
                            <span className="text-muted-foreground">to</span>
                            <Input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-40 bg-card"
                            />
                        </div>

                        <Button variant="outline" onClick={handleExport}>
                            <Download className="w-4 h-4 mr-2" />
                            Export CSV
                        </Button>
                        <Button variant="outline" onClick={handlePrint}>
                            <Printer className="w-4 h-4 mr-2" />
                            Print
                        </Button>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">Total Sales</p>
                            <p className="text-2xl font-semibold text-primary">
                                {formatINR(summary.totalSales || 0)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">Total Tax</p>
                            <p className="text-2xl font-semibold">
                                {formatINR(summary.totalTax || 0)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">Invoices</p>
                            <p className="text-2xl font-semibold">{summary.totalOrders || 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">Avg. Order</p>
                            <p className="text-2xl font-semibold">
                                {formatINR(
                                    summary.totalOrders > 0
                                        ? summary.totalSales / summary.totalOrders
                                        : 0
                                )}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Report Table */}
                <Card className="bg-card border-border">
                    <CardContent className="pt-6">
                        <div id="sales-report-table">
                            {loading ? (
                                <div className="text-center py-12 text-muted-foreground">Loading...</div>
                            ) : rows.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    No sales data for selected period
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-border">
                                            <TableHead>Date</TableHead>
                                            <TableHead>Invoice #</TableHead>
                                            <TableHead>Customer</TableHead>
                                            <TableHead className="text-right">Taxable</TableHead>
                                            <TableHead className="text-right">CGST</TableHead>
                                            <TableHead className="text-right">SGST</TableHead>
                                            <TableHead className="text-right">IGST</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.map((row, index) => (
                                            <TableRow key={index} className="border-border">
                                                <TableCell>{row.date}</TableCell>
                                                <TableCell className="font-mono text-sm">
                                                    {row.invoiceNumber}
                                                </TableCell>
                                                <TableCell>{row.customerName}</TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatINR(row.taxableValue)}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-muted-foreground">
                                                    {formatINR(row.cgst)}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-muted-foreground">
                                                    {formatINR(row.sgst)}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-muted-foreground">
                                                    {formatINR(row.igst)}
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-semibold">
                                                    {formatINR(row.total)}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        className={
                                                            row.isPaid
                                                                ? "bg-green-500/20 text-green-400"
                                                                : "bg-yellow-500/20 text-yellow-400"
                                                        }
                                                    >
                                                        {row.isPaid ? "Paid" : "Pending"}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}


