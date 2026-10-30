"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Download,
    Printer,
    Package,
    AlertTriangle,
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

import { getStockReport, exportToCSV, printReport, type StockReportRow } from "@/lib/reports";
import { formatINR } from "@/lib/gst";

// Summary shape returned by getStockReport(); fields are optional because the
// state starts empty before the report loads.
interface StockReportSummary {
    totalProducts?: number;
    lowStock?: number;
    totalValue?: number;
    landedCount?: number;
}

export default function StockReportPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<StockReportRow[]>([]);
    const [summary, setSummary] = useState<StockReportSummary>({});
    const [search, setSearch] = useState("");
    const [showLowStock, setShowLowStock] = useState(false);

    const loadReport = async () => {
        setLoading(true);
        const { rows, summary } = await getStockReport();
        setRows(rows);
        setSummary(summary);
        setLoading(false);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- loadReport deliberately flips `loading` synchronously to start the loading lifecycle before the fetch resolves; the report fetch is a side effect on an external system, not derivable state.
        loadReport();
    }, []);

    const filteredRows = rows.filter((row) => {
        if (showLowStock && row.currentStock >= row.reorderLevel) return false;
        if (search) {
            const query = search.toLowerCase();
            return (
                row.productName.toLowerCase().includes(query) ||
                row.sku.toLowerCase().includes(query) ||
                row.category?.toLowerCase().includes(query)
            );
        }
        return true;
    });

    const handleExport = () => {
        exportToCSV(filteredRows, "stock_report");
    };

    const handlePrint = () => {
        printReport("stock-report-table", "Stock Report");
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Stock Report" subtitle="Inventory levels and valuation" />

            <div className="flex-1 overflow-y-auto p-4 sm:p-8 scroll-smooth">
                {/* Actions */}
                <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
                    <Button
                        variant="ghost"
                        onClick={() => router.push("/reports")}
                        className="h-9 justify-start sm:h-8"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Reports
                    </Button>

                    <div className="flex flex-wrap items-center gap-2 lg:gap-4">
                        <Input
                            placeholder="Search products..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-card sm:w-64"
                        />
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                            <Button
                                variant={showLowStock ? "default" : "outline"}
                                onClick={() => setShowLowStock(!showLowStock)}
                                className={`h-9 w-full sm:h-8 sm:w-auto ${showLowStock ? "bg-yellow-600" : ""}`}
                            >
                                <AlertTriangle className="w-4 h-4 mr-2" />
                                Low Stock Only
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleExport}
                                className="h-9 w-full sm:h-8 sm:w-auto"
                            >
                                <Download className="w-4 h-4 mr-2" />
                                Export
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handlePrint}
                                className="h-9 w-full sm:h-8 sm:w-auto"
                            >
                                <Printer className="w-4 h-4 mr-2" />
                                Print
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-3 xl:gap-4">
                            <div className="p-3 rounded-lg bg-blue-500/10">
                                <Package className="w-6 h-6 text-blue-400" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Total Products</p>
                                <p className="text-lg font-semibold lg:text-xl xl:text-2xl break-words">{summary.totalProducts || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-3 xl:gap-4">
                            <div className="p-3 rounded-lg bg-yellow-500/10">
                                <AlertTriangle className="w-6 h-6 text-yellow-400" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Low Stock Items</p>
                                <p className="text-lg font-semibold text-yellow-400 lg:text-xl xl:text-2xl break-words">{summary.lowStock || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-3 xl:gap-4">
                            <div className="p-3 rounded-lg bg-primary/10">
                                <Package className="w-6 h-6 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">Total Value</p>
                                <p className="text-lg font-semibold text-primary lg:text-xl xl:text-2xl break-words">
                                    {formatINR(summary.totalValue || 0)}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                    {summary.landedCount || 0} of {summary.totalProducts || 0} variants at landed cost
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Table */}
                <Card className="bg-card border-border">
                    <CardContent className="pt-6">
                        <div id="stock-report-table">
                            {loading ? (
                                <div className="text-center py-12 text-muted-foreground">Loading...</div>
                            ) : filteredRows.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    No products found
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-border">
                                            <TableHead>SKU</TableHead>
                                            <TableHead>Product</TableHead>
                                            <TableHead>Variant</TableHead>
                                            <TableHead>Category</TableHead>
                                            <TableHead className="text-right">Stock</TableHead>
                                            <TableHead className="text-right">Reorder Level</TableHead>
                                            <TableHead className="text-right">Unit cost</TableHead>
                                            <TableHead>Basis</TableHead>
                                            <TableHead className="text-right">Value</TableHead>
                                            <TableHead>Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredRows.map((row, index) => {
                                            const isLow = row.currentStock < row.reorderLevel;
                                            const isOut = row.currentStock === 0;
                                            return (
                                                <TableRow key={index} className="border-border">
                                                    <TableCell className="font-mono text-sm">{row.sku}</TableCell>
                                                    <TableCell className="font-medium">{row.productName}</TableCell>
                                                    <TableCell className="text-muted-foreground">{row.variantName}</TableCell>
                                                    <TableCell className="text-muted-foreground">{row.category || '-'}</TableCell>
                                                    <TableCell className={`text-right font-mono ${isLow ? 'text-yellow-400' : ''} ${isOut ? 'text-red-400' : ''}`}>
                                                        {row.currentStock}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-muted-foreground">
                                                        {row.reorderLevel}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">
                                                        {formatINR(row.unitCost)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge
                                                            variant="outline"
                                                            className={row.costBasis === "landed"
                                                                ? "border-emerald-600/40 text-emerald-400"
                                                                : "text-muted-foreground"}
                                                        >
                                                            {row.costBasis === "landed" ? "landed" : "purchase"}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">
                                                        {formatINR(row.stockValue)}
                                                    </TableCell>
                                                    <TableCell>
                                                        {isOut ? (
                                                            <Badge className="bg-red-500/20 text-red-400">Out of Stock</Badge>
                                                        ) : isLow ? (
                                                            <Badge className="bg-yellow-500/20 text-yellow-400">Low Stock</Badge>
                                                        ) : (
                                                            <Badge className="bg-green-500/20 text-green-400">In Stock</Badge>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
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


