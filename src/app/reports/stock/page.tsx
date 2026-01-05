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

export default function StockReportPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<StockReportRow[]>([]);
    const [summary, setSummary] = useState<any>({});
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

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Actions */}
                <div className="flex items-center justify-between mb-6">
                    <Button variant="ghost" onClick={() => router.push("/reports")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Reports
                    </Button>

                    <div className="flex items-center gap-4">
                        <Input
                            placeholder="Search products..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-64 bg-card"
                        />
                        <Button
                            variant={showLowStock ? "default" : "outline"}
                            onClick={() => setShowLowStock(!showLowStock)}
                            className={showLowStock ? "bg-yellow-600" : ""}
                        >
                            <AlertTriangle className="w-4 h-4 mr-2" />
                            Low Stock Only
                        </Button>
                        <Button variant="outline" onClick={handleExport}>
                            <Download className="w-4 h-4 mr-2" />
                            Export
                        </Button>
                        <Button variant="outline" onClick={handlePrint}>
                            <Printer className="w-4 h-4 mr-2" />
                            Print
                        </Button>
                    </div>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-blue-500/10">
                                <Package className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Total Products</p>
                                <p className="text-2xl font-semibold">{summary.totalProducts || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-yellow-500/10">
                                <AlertTriangle className="w-6 h-6 text-yellow-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Low Stock Items</p>
                                <p className="text-2xl font-semibold text-yellow-400">{summary.lowStock || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-primary/10">
                                <Package className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Total Value</p>
                                <p className="text-2xl font-semibold text-primary">
                                    {formatINR(summary.totalValue || 0)}
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


