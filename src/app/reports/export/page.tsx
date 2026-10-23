"use client";

import { useMemo, useState } from "react";
import { Download, Globe, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatINR } from "@/lib/gst";
import {
    SUPPORTED_CURRENCIES,
    compileLutExportInvoice,
    type ForeignCurrency,
} from "@/lib/cross-border-engine";

interface ItemRow {
    sku: string;
    description: string;
    hsnCode: string;
    quantity: string;
    unitPriceInr: string;
}

const EMPTY_ITEM: ItemRow = { sku: "", description: "", hsnCode: "7113", quantity: "1", unitPriceInr: "" };

function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function stamp(): string {
    return today().replace(/-/g, "");
}

export default function ExportInvoicePage() {
    const [invoiceNumber, setInvoiceNumber] = useState(`EXP-${stamp()}-001`);
    const [invoiceDate, setInvoiceDate] = useState(today());
    const [buyerName, setBuyerName] = useState("");
    const [buyerCountry, setBuyerCountry] = useState("United States");
    const [buyerAddress, setBuyerAddress] = useState("");
    const [currency, setCurrency] = useState<ForeignCurrency>("USD");
    const [fxRate, setFxRate] = useState("");
    const [isLut, setIsLut] = useState(true);
    const [lutArn, setLutArn] = useState("");
    const [portCode, setPortCode] = useState("INBLR4");
    const [shippingBill, setShippingBill] = useState("");
    const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

    const defaultRate = SUPPORTED_CURRENCIES[currency].defaultExchangeRateToInr;
    const effectiveRate = Number(fxRate) > 0 ? Number(fxRate) : defaultRate;

    const invoice = useMemo(() => compileLutExportInvoice({
        invoiceNumber,
        invoiceDate,
        buyerName: buyerName || "Buyer",
        buyerCountry,
        buyerAddress,
        currency,
        exchangeRateToInr: effectiveRate,
        isLutExport: isLut,
        lutArnNumber: lutArn,
        portCode,
        shippingBillNumber: shippingBill,
        items: items.map((item) => ({
            sku: item.sku || "SKU",
            description: item.description || "Jewellery item",
            hsnCode: item.hsnCode || "7113",
            quantity: Number(item.quantity) || 0,
            unitPriceInr: Number(item.unitPriceInr) || 0,
        })),
    }), [invoiceNumber, invoiceDate, buyerName, buyerCountry, buyerAddress, currency, effectiveRate, isLut, lutArn, portCode, shippingBill, items]);

    const validItems = items.filter((item) => Number(item.quantity) > 0 && Number(item.unitPriceInr) > 0);

    const updateItem = (index: number, patch: Partial<ItemRow>) => {
        setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    };

    const handleDownload = () => {
        if (!buyerName.trim()) {
            toast.error("Buyer name is required");
            return;
        }
        if (validItems.length === 0) {
            toast.error("Add at least one line with quantity and price");
            return;
        }
        const blob = new Blob([JSON.stringify(invoice, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${invoice.invoiceNumber || "export-invoice"}.json`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success("Export invoice downloaded");
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Export Invoice" subtitle="LUT zero-rated or IGST-paid export with live FX" />

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <Card className="bg-card">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Globe className="w-4 h-4" /> Shipment and buyer
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label>Invoice number</Label>
                                    <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="font-mono" />
                                </div>
                                <div className="space-y-1">
                                    <Label>Invoice date</Label>
                                    <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label>Buyer name</Label>
                                    <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Aurora Gems LLC" />
                                </div>
                                <div className="space-y-1">
                                    <Label>Country</Label>
                                    <Input value={buyerCountry} onChange={(e) => setBuyerCountry(e.target.value)} />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <Label>Buyer address</Label>
                                <Input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} placeholder="Street, city, postal code" />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-1">
                                    <Label>Currency</Label>
                                    <Select value={currency} onValueChange={(value) => setCurrency((value ?? "USD") as ForeignCurrency)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.keys(SUPPORTED_CURRENCIES).map((code) => (
                                                <SelectItem key={code} value={code}>{code}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>FX rate (INR per unit)</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={fxRate}
                                        onChange={(e) => setFxRate(e.target.value)}
                                        placeholder={String(defaultRate)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Port code</Label>
                                    <Input value={portCode} onChange={(e) => setPortCode(e.target.value)} className="font-mono" />
                                </div>
                            </div>

                            <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={isLut} onChange={(e) => setIsLut(e.target.checked)} className="accent-primary" />
                                Supply under LUT (zero-rated). Uncheck to charge IGST at 3%.
                            </label>

                            {isLut && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <Label>LUT ARN</Label>
                                        <Input value={lutArn} onChange={(e) => setLutArn(e.target.value)} className="font-mono" placeholder="AD1234567890123" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Shipping bill</Label>
                                        <Input value={shippingBill} onChange={(e) => setShippingBill(e.target.value)} className="font-mono" placeholder="Optional" />
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end">
                                <Button onClick={handleDownload}>
                                    <Download className="w-4 h-4 mr-2" /> Download JSON
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card">
                        <CardHeader>
                            <CardTitle className="text-base">Statutory invoice preview</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{invoice.exportType}</p>
                            <p className="text-xs leading-relaxed">{invoice.declarationText}</p>

                            <div className="rounded-lg border p-3 space-y-1 text-xs">
                                <p className="font-semibold">{invoice.buyerDetails.name}</p>
                                <p className="text-muted-foreground">{invoice.buyerDetails.address}</p>
                                <p className="text-muted-foreground">{invoice.buyerDetails.country}</p>
                                <p className="font-mono text-[11px] pt-1">FX {invoice.exchangeRate} INR / {invoice.currency}</p>
                                {invoice.lutDetails && (
                                    <p className="font-mono text-[11px]">
                                        LUT {invoice.lutDetails.arnNumber} · port {invoice.lutDetails.portCode}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Foreign subtotal</span>
                                    <span className="font-mono">{invoice.totals.foreignSubtotal.toFixed(2)} {invoice.currency}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">INR subtotal</span>
                                    <span className="font-mono">{formatINR(invoice.totals.inrSubtotal)}</span>
                                </div>
                                {!isLut && (
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">IGST 3%</span>
                                        <span className="font-mono">{formatINR(invoice.totals.inrGstTotal)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between border-t pt-2 font-semibold">
                                    <span>Grand total</span>
                                    <span className="font-mono">{formatINR(invoice.totals.inrGrandTotal)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="bg-card">
                    <CardHeader>
                        <CardTitle className="text-base">Line items</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>HSN</TableHead>
                                    <TableHead className="w-24 text-right">Qty</TableHead>
                                    <TableHead className="w-36 text-right">Unit price (INR)</TableHead>
                                    <TableHead className="text-right">Foreign total</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item, index) => (
                                    <TableRow key={index}>
                                        <TableCell>
                                            <Input value={item.sku} onChange={(e) => updateItem(index, { sku: e.target.value })} className="h-8 font-mono text-xs" />
                                        </TableCell>
                                        <TableCell>
                                            <Input value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} className="h-8 text-xs" />
                                        </TableCell>
                                        <TableCell>
                                            <Input value={item.hsnCode} onChange={(e) => updateItem(index, { hsnCode: e.target.value })} className="h-8 w-20 font-mono text-xs" />
                                        </TableCell>
                                        <TableCell>
                                            <Input type="number" min="0" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} className="h-8 text-right font-mono text-xs" />
                                        </TableCell>
                                        <TableCell>
                                            <Input type="number" step="0.01" value={item.unitPriceInr} onChange={(e) => updateItem(index, { unitPriceInr: e.target.value })} className="h-8 text-right font-mono text-xs" />
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs">
                                            {invoice.lineItems[index]
                                                ? `${invoice.lineItems[index].totalForeign.toFixed(2)} ${currency}`
                                                : "-"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={items.length === 1}
                                                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        <Button variant="outline" size="sm" onClick={() => setItems((current) => [...current, { ...EMPTY_ITEM }])}>
                            <Plus className="w-4 h-4 mr-2" /> Add line
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
