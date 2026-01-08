"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    Search,
    Plus,
    Minus,
    RotateCcw,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

import { getInvoice, type Invoice } from "@/lib/invoice";
import { createReturnFromInvoice, type ReturnReason } from "@/lib/returns";
import { formatINR } from "@/lib/gst";

interface ReturnItem {
    invoice_item_id: string;
    description: string;
    max_qty: number;
    quantity: number;
    unit_price: number;
}

const reasons: { value: ReturnReason; label: string }[] = [
    { value: "defective", label: "Defective Product" },
    { value: "wrong_item", label: "Wrong Item Delivered" },
    { value: "size_exchange", label: "Size/Fit Issue" },
    { value: "customer_request", label: "Customer Request" },
    { value: "quality_issue", label: "Quality Issue" },
    { value: "other", label: "Other" },
];

function CreateReturnContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const invoiceId = searchParams.get("invoice");

    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState(invoiceId || "");
    const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
    const [reason, setReason] = useState<ReturnReason>("customer_request");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (invoiceId) {
            loadInvoice(invoiceId);
        }
    }, [invoiceId]);

    const loadInvoice = async (id: string) => {
        setLoading(true);
        try {
            const data = await getInvoice(id);
            setInvoice(data);

            // Initialize return items from invoice items
            if (data?.items) {
                setReturnItems(
                    data.items.map((item: any) => ({
                        invoice_item_id: item.id,
                        description: item.description,
                        max_qty: item.quantity,
                        quantity: 0,
                        unit_price: item.unit_price,
                    }))
                );
            }
        } catch (error) {
            console.error("Error loading invoice:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = () => {
        if (searchQuery) {
            loadInvoice(searchQuery);
        }
    };

    const updateQuantity = (index: number, delta: number) => {
        setReturnItems((prev) =>
            prev.map((item, i) => {
                if (i !== index) return item;
                const newQty = Math.max(0, Math.min(item.max_qty, item.quantity + delta));
                return { ...item, quantity: newQty };
            })
        );
    };

    const selectedItems = returnItems.filter((item) => item.quantity > 0);
    const totalValue = selectedItems.reduce(
        (sum, item) => sum + item.unit_price * item.quantity * 1.03, // Include 3% GST estimate
        0
    );

    const handleSubmit = async () => {
        if (!invoice?.id || selectedItems.length === 0) {
            alert("Please select at least one item to return");
            return;
        }

        setSubmitting(true);
        try {
            const creditNote = await createReturnFromInvoice(
                invoice.id,
                selectedItems.map((item) => ({
                    invoice_item_id: item.invoice_item_id,
                    quantity: item.quantity,
                })),
                reason,
                notes || undefined
            );
            router.push(`/returns/${creditNote.id}`);
        } catch (error) {
            console.error("Error creating return:", error);
            alert("Failed to create return. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Create Return" subtitle="Process product return" />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <Button variant="ghost" onClick={() => router.push("/returns")} className="mb-6">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Returns
                </Button>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Main Form */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Invoice Search */}
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-lg">Find Invoice</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Enter Invoice Number or ID..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                            className="pl-10"
                                        />
                                    </div>
                                    <Button onClick={handleSearch} disabled={loading}>
                                        {loading ? "Searching..." : "Search"}
                                    </Button>
                                </div>

                                {invoice && (
                                    <div className="mt-4 p-4 bg-muted/20 rounded-lg">
                                        <div className="flex justify-between">
                                            <div>
                                                <p className="font-semibold">{invoice.invoice_number}</p>
                                                <p className="text-sm text-muted-foreground">{invoice.buyer_name}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-mono font-semibold">{formatINR(invoice.grand_total)}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {invoice.invoice_date && new Date(invoice.invoice_date).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Return Items */}
                        {invoice && returnItems.length > 0 && (
                            <Card className="bg-card border-border">
                                <CardHeader>
                                    <CardTitle className="text-lg">Select Items to Return</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-border">
                                                <TableHead>Item</TableHead>
                                                <TableHead className="text-center">Original Qty</TableHead>
                                                <TableHead className="text-center">Return Qty</TableHead>
                                                <TableHead className="text-right">Value</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {returnItems.map((item, index) => (
                                                <TableRow key={item.invoice_item_id} className="border-border">
                                                    <TableCell>
                                                        <p className="font-medium">{item.description}</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            @ {formatINR(item.unit_price)}
                                                        </p>
                                                    </TableCell>
                                                    <TableCell className="text-center">{item.max_qty}</TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center justify-center gap-2">
                                                            <Button
                                                                variant="outline"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => updateQuantity(index, -1)}
                                                            >
                                                                <Minus className="w-3 h-3" />
                                                            </Button>
                                                            <span className="w-8 text-center font-mono">
                                                                {item.quantity}
                                                            </span>
                                                            <Button
                                                                variant="outline"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => updateQuantity(index, 1)}
                                                            >
                                                                <Plus className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">
                                                        {formatINR(item.unit_price * item.quantity)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        )}

                        {/* Return Details */}
                        {invoice && (
                            <Card className="bg-card border-border">
                                <CardHeader>
                                    <CardTitle className="text-lg">Return Details</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Reason for Return</Label>
                                        <Select value={reason} onValueChange={(v) => setReason(v as ReturnReason)}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {reasons.map((r) => (
                                                    <SelectItem key={r.value} value={r.value}>
                                                        {r.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Additional Notes</Label>
                                        <Textarea
                                            placeholder="Any additional details about the return..."
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            rows={3}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Summary Sidebar */}
                    <div className="space-y-6">
                        <Card className="bg-card border-border sticky top-0">
                            <CardHeader>
                                <CardTitle className="text-lg">Return Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Items Selected</span>
                                        <span>{selectedItems.length}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Total Quantity</span>
                                        <span>
                                            {selectedItems.reduce((sum, item) => sum + item.quantity, 0)}
                                        </span>
                                    </div>
                                </div>

                                <div className="border-t border-border pt-4">
                                    <div className="flex justify-between font-semibold text-lg">
                                        <span>Estimated Refund</span>
                                        <span className="font-mono">{formatINR(totalValue)}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Final amount calculated after approval
                                    </p>
                                </div>

                                <Button
                                    className="w-full bg-primary text-midnight hover:bg-primary/90"
                                    disabled={selectedItems.length === 0 || submitting}
                                    onClick={handleSubmit}
                                >
                                    <RotateCcw className="w-4 h-4 mr-2" />
                                    {submitting ? "Creating..." : "Create Return Request"}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function CreateReturnPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading return form...</div>}>
            <CreateReturnContent />
        </Suspense>
    );
}


