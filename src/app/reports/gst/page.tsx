"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
    ArrowLeft,
    Download,

    FileText,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { getGSTR1Report, generateGSTR1JSON, exportToJSON, exportToCSV, type GSTR1Row } from "@/lib/reports";
import { formatINR } from "@/lib/gst";

// GSTR-1 period totals as returned by getGSTR1Report; fields absent until the report loads
interface GSTR1Summary {
    totalB2B?: number;
    totalB2C?: number;
    totalCGST?: number;
    totalSGST?: number;
    totalIGST?: number;
    invoiceCount?: number;
}

export default function GSTReportPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [b2b, setB2B] = useState<GSTR1Row[]>([]);
    const [b2c, setB2C] = useState<GSTR1Row[]>([]);
    const [summary, setSummary] = useState<GSTR1Summary>({});
    const [gstin, setGstin] = useState("");
    const [activeGstTab, setActiveGstTab] = useState<"b2b" | "b2c">("b2b");

    // Default to current month
    const [startDate, setStartDate] = useState(
        format(startOfMonth(new Date()), "yyyy-MM-dd")
    );
    const [endDate, setEndDate] = useState(
        format(endOfMonth(new Date()), "yyyy-MM-dd")
    );

    const loadReport = async () => {
        setLoading(true);
        const { b2b, b2c, summary } = await getGSTR1Report(startDate, endDate);
        setB2B(b2b);
        setB2C(b2c);
        setSummary(summary);
        setLoading(false);
    };

    useEffect(() => {
        loadReport();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- loadReport is recreated every render and closes over startDate/endDate; adding it would refetch on every render, the date deps already reload exactly when the range changes
    }, [startDate, endDate]);

    const handleExportB2B = () => {
        exportToCSV(b2b, "gstr1_b2b");
    };

    const handleExportB2C = () => {
        exportToCSV(b2c, "gstr1_b2c");
    };

    const handleExportJSON = async () => {
        if (!gstin) {
            alert("Please enter Organization GSTIN");
            return;
        }
        try {
            setLoading(true);
            const jsonData = await generateGSTR1JSON(startDate, endDate, gstin);
            exportToJSON(jsonData, `GSTR1_${format(new Date(), 'MMMyyyy')}`);
        } catch (error) {
            console.error(error);
            alert("Failed to generate JSON");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="GST Report (GSTR-1)" subtitle="B2B and B2C invoices for filing" />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Actions */}
                <div className="flex items-center justify-between mb-6">
                    <Button variant="ghost" onClick={() => router.push("/reports")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Reports
                    </Button>

                    <div className="flex items-center gap-4">
                        <Input
                            placeholder="Org GSTIN"
                            value={gstin}
                            onChange={(e) => setGstin(e.target.value)}
                            className="w-40 bg-card uppercase font-mono"
                            maxLength={15}
                        />
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
                        <Button onClick={handleExportJSON} className="bg-green-600 hover:bg-green-700">
                            <FileText className="w-4 h-4 mr-2" />
                            Export JSON
                        </Button>
                    </div>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">B2B Sales</p>
                            <p className="text-xl font-semibold text-green-400">
                                {formatINR(summary.totalB2B || 0)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">B2C Sales</p>
                            <p className="text-xl font-semibold text-blue-400">
                                {formatINR(summary.totalB2C || 0)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">CGST</p>
                            <p className="text-xl font-semibold">
                                {formatINR(summary.totalCGST || 0)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">SGST</p>
                            <p className="text-xl font-semibold">
                                {formatINR(summary.totalSGST || 0)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <p className="text-sm text-muted-foreground">IGST</p>
                            <p className="text-xl font-semibold">
                                {formatINR(summary.totalIGST || 0)}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Tabs */}
                <Tabs value={activeGstTab} onValueChange={(v) => setActiveGstTab(v as any)} className="w-full">
                    {/* Mobile / Narrow Viewport: Dropdown */}
                    <div className="block sm:hidden w-full mb-3">
                        <Select value={activeGstTab} onValueChange={(v) => v && setActiveGstTab(v as any)}>
                            <SelectTrigger className="w-full h-10 bg-card border-border text-xs font-semibold px-3 rounded-xl flex items-center justify-between shadow-xs">
                                <span className="text-xs font-semibold text-foreground">
                                    {activeGstTab === "b2b" ? `B2B Invoices (${b2b.length})` : `B2C Invoices (${b2c.length})`}
                                </span>
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border">
                                <SelectItem value="b2b" className="text-xs font-medium py-2">
                                    B2B Invoices ({b2b.length})
                                </SelectItem>
                                <SelectItem value="b2c" className="text-xs font-medium py-2">
                                    B2C Invoices ({b2c.length})
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="hidden sm:flex items-center justify-between mb-4">
                        <TabsList>
                            <TabsTrigger value="b2b">B2B Invoices ({b2b.length})</TabsTrigger>
                            <TabsTrigger value="b2c">B2C Invoices ({b2c.length})</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="b2b">
                        <Card className="bg-card border-border">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle className="text-sm">B2B Invoices (Registered Buyers)</CardTitle>
                                <Button variant="outline" size="sm" onClick={handleExportB2B}>
                                    <Download className="w-3 h-3 mr-2" />
                                    Export
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {loading ? (
                                    <div className="text-center py-8 text-muted-foreground">Loading...</div>
                                ) : b2b.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">
                                        No B2B invoices for this period
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-border">
                                                    <TableHead>Invoice No</TableHead>
                                                    <TableHead>Date</TableHead>
                                                    <TableHead>Buyer GSTIN</TableHead>
                                                    <TableHead>Buyer Name</TableHead>
                                                    <TableHead>Place</TableHead>
                                                    <TableHead className="text-right">Taxable</TableHead>
                                                    <TableHead className="text-right">CGST</TableHead>
                                                    <TableHead className="text-right">SGST</TableHead>
                                                    <TableHead className="text-right">IGST</TableHead>
                                                    <TableHead className="text-right">Total</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {b2b.map((row, index) => (
                                                    <TableRow key={index} className="border-border">
                                                        <TableCell className="font-mono text-sm">{row.invoiceNumber}</TableCell>
                                                        <TableCell>{row.invoiceDate}</TableCell>
                                                        <TableCell className="font-mono text-xs">{row.buyerGstin}</TableCell>
                                                        <TableCell>{row.buyerName}</TableCell>
                                                        <TableCell>{row.placeOfSupply}</TableCell>
                                                        <TableCell className="text-right font-mono">{formatINR(row.taxableValue)}</TableCell>
                                                        <TableCell className="text-right font-mono text-muted-foreground">{formatINR(row.cgstAmount)}</TableCell>
                                                        <TableCell className="text-right font-mono text-muted-foreground">{formatINR(row.sgstAmount)}</TableCell>
                                                        <TableCell className="text-right font-mono text-muted-foreground">{formatINR(row.igstAmount)}</TableCell>
                                                        <TableCell className="text-right font-mono font-semibold">{formatINR(row.invoiceValue)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="b2c">
                        <Card className="bg-card border-border">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle className="text-sm">B2C Invoices (Unregistered Buyers)</CardTitle>
                                <Button variant="outline" size="sm" onClick={handleExportB2C}>
                                    <Download className="w-3 h-3 mr-2" />
                                    Export
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {loading ? (
                                    <div className="text-center py-8 text-muted-foreground">Loading...</div>
                                ) : b2c.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">
                                        No B2C invoices for this period
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-border">
                                                    <TableHead>Invoice No</TableHead>
                                                    <TableHead>Date</TableHead>
                                                    <TableHead>Buyer Name</TableHead>
                                                    <TableHead>Place</TableHead>
                                                    <TableHead className="text-right">Taxable</TableHead>
                                                    <TableHead className="text-right">CGST</TableHead>
                                                    <TableHead className="text-right">SGST</TableHead>
                                                    <TableHead className="text-right">Total</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {b2c.map((row, index) => (
                                                    <TableRow key={index} className="border-border">
                                                        <TableCell className="font-mono text-sm">{row.invoiceNumber}</TableCell>
                                                        <TableCell>{row.invoiceDate}</TableCell>
                                                        <TableCell>{row.buyerName}</TableCell>
                                                        <TableCell>{row.placeOfSupply}</TableCell>
                                                        <TableCell className="text-right font-mono">{formatINR(row.taxableValue)}</TableCell>
                                                        <TableCell className="text-right font-mono text-muted-foreground">{formatINR(row.cgstAmount)}</TableCell>
                                                        <TableCell className="text-right font-mono text-muted-foreground">{formatINR(row.sgstAmount)}</TableCell>
                                                        <TableCell className="text-right font-mono font-semibold">{formatINR(row.invoiceValue)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}


