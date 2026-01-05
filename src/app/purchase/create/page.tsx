"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Plus,
    Trash2,
    Search,
    Save,
    Send,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
    createPurchaseOrder,
    calculatePOItemTotals,
    calculatePOTotals,
    type PurchaseOrderItem,
    type POStatus,
} from "@/lib/purchase";
import { getVendors, type Vendor } from "@/lib/vendors";
import { formatINR, GST_RATES, HSN_CODES } from "@/lib/gst";
import { supabase } from "@/lib/supabase";

interface ProductVariant {
    id: string;
    variant_name: string;
    sku_suffix: string;
    product: {
        id: string;
        name: string;
        sku: string;
        base_price: number;
    };
}

export default function CreatePurchaseOrderPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [products, setProducts] = useState<ProductVariant[]>([]);
    const [showProductSearch, setShowProductSearch] = useState(false);
    const [productSearch, setProductSearch] = useState("");

    // Form state
    const [vendorId, setVendorId] = useState("");
    const [orderDate, setOrderDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [expectedDate, setExpectedDate] = useState("");
    const [shippingAddress, setShippingAddress] = useState("");
    const [shippingCost, setShippingCost] = useState(0);
    const [discountAmount, setDiscountAmount] = useState(0);
    const [notes, setNotes] = useState("");
    const [items, setItems] = useState<Omit<PurchaseOrderItem, 'id' | 'po_id'>[]>([]);

    // Load vendors and products
    useEffect(() => {
        async function loadData() {
            const vendorData = await getVendors();
            setVendors(vendorData);

            const { data } = await supabase
                .from("product_variants")
                .select(`
                    id,
                    variant_name,
                    sku_suffix,
                    product:products(id, name, sku, base_price)
                `)
                .order("variant_name");

            if (data) {
                setProducts(data as unknown as ProductVariant[]);
            }
        }
        loadData();
    }, []);

    // Filter products for search
    const filteredProducts = products.filter((p) => {
        const query = productSearch.toLowerCase();
        return (
            p.product.name.toLowerCase().includes(query) ||
            p.product.sku.toLowerCase().includes(query)
        );
    });

    // Add item from product
    const addItem = (variant: ProductVariant) => {
        const unitPrice = variant.product.base_price * 0.6; // Assume 60% of retail as cost
        const { taxableAmount, gstAmount, totalPrice } = calculatePOItemTotals(1, unitPrice, GST_RATES.JEWELRY);

        const newItem: Omit<PurchaseOrderItem, 'id' | 'po_id'> = {
            variant_id: variant.id,
            description: `${variant.product.name} - ${variant.variant_name}`,
            hsn_code: HSN_CODES.DEFAULT,
            quantity_ordered: 1,
            quantity_received: 0,
            unit: "PCS",
            unit_price: unitPrice,
            gst_rate: GST_RATES.JEWELRY,
            gst_amount: gstAmount,
            total_price: totalPrice,
        };

        setItems([...items, newItem]);
        setShowProductSearch(false);
        setProductSearch("");
    };

    // Update item
    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...items];
        (newItems[index] as any)[field] = value;

        // Recalculate totals
        const item = newItems[index];
        const { gstAmount, totalPrice } = calculatePOItemTotals(
            item.quantity_ordered,
            item.unit_price,
            item.gst_rate
        );
        item.gst_amount = gstAmount;
        item.total_price = totalPrice;

        setItems(newItems);
    };

    // Remove item
    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    // Calculate totals
    const totals = calculatePOTotals(items as PurchaseOrderItem[], shippingCost, discountAmount);

    // Submit PO
    const handleSubmit = async (status: POStatus = 'draft') => {
        if (!vendorId) {
            alert("Please select a vendor");
            return;
        }

        if (items.length === 0) {
            alert("Please add at least one item");
            return;
        }

        setLoading(true);

        try {
            const po = await createPurchaseOrder({
                vendor_id: vendorId,
                status,
                order_date: orderDate,
                expected_date: expectedDate || undefined,
                subtotal: totals.subtotal,
                gst_amount: totals.gstAmount,
                shipping_cost: shippingCost,
                discount_amount: discountAmount,
                total: totals.total,
                shipping_address: shippingAddress || undefined,
                notes: notes || undefined,
                items: items as PurchaseOrderItem[],
            });

            router.push(`/purchase/${po.id}`);
        } catch (error) {
            console.error("Error creating PO:", error);
            alert("Failed to create purchase order");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="New Purchase Order"
                subtitle="Create order for vendor"
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Back */}
                    <Button variant="ghost" onClick={() => router.push("/purchase")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Purchase Orders
                    </Button>

                    {/* Vendor & Dates */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle className="text-primary">Order Details</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="space-y-2 md:col-span-2">
                                <Label>Vendor *</Label>
                                <Select value={vendorId} onValueChange={setVendorId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select vendor" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {vendors.map((v) => (
                                            <SelectItem key={v.id} value={v.id}>
                                                {v.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Order Date</Label>
                                <Input
                                    type="date"
                                    value={orderDate}
                                    onChange={(e) => setOrderDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Expected Delivery</Label>
                                <Input
                                    type="date"
                                    value={expectedDate}
                                    onChange={(e) => setExpectedDate(e.target.value)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Items */}
                    <Card className="bg-card border-border">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Items</CardTitle>
                            <div className="relative">
                                <Button
                                    size="sm"
                                    onClick={() => setShowProductSearch(!showProductSearch)}
                                    className="bg-primary text-midnight hover:bg-primary/90"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Item
                                </Button>
                                {showProductSearch && (
                                    <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50">
                                        <div className="p-3 border-b border-border">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                                <Input
                                                    autoFocus
                                                    placeholder="Search products..."
                                                    value={productSearch}
                                                    onChange={(e) => setProductSearch(e.target.value)}
                                                    className="pl-10"
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-60 overflow-y-auto">
                                            {filteredProducts.slice(0, 10).map((v) => (
                                                <div
                                                    key={v.id}
                                                    className="p-3 hover:bg-muted cursor-pointer border-b border-border"
                                                    onClick={() => addItem(v)}
                                                >
                                                    <div className="font-medium">{v.product.name}</div>
                                                    <div className="text-sm text-muted-foreground">
                                                        {v.variant_name} ({v.product.sku}-{v.sku_suffix})
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-border">
                                        <TableHead className="w-10">#</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead className="w-20">Qty</TableHead>
                                        <TableHead className="w-28">Unit Price</TableHead>
                                        <TableHead className="w-20">GST %</TableHead>
                                        <TableHead className="w-24 text-right">Total</TableHead>
                                        <TableHead className="w-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                No items added. Click "Add Item" to begin.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        items.map((item, index) => (
                                            <TableRow key={index} className="border-border">
                                                <TableCell>{index + 1}</TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={item.description}
                                                        onChange={(e) => updateItem(index, "description", e.target.value)}
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={item.quantity_ordered}
                                                        onChange={(e) => updateItem(index, "quantity_ordered", parseInt(e.target.value) || 1)}
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.unit_price}
                                                        onChange={(e) => updateItem(index, "unit_price", parseFloat(e.target.value) || 0)}
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        max="28"
                                                        value={item.gst_rate}
                                                        onChange={(e) => updateItem(index, "gst_rate", parseFloat(e.target.value) || 0)}
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatINR(item.total_price)}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-red-400"
                                                        onClick={() => removeItem(index)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>

                            {/* Totals */}
                            {items.length > 0 && (
                                <div className="flex justify-end mt-6">
                                    <div className="w-80 space-y-2 bg-muted/20 rounded-lg p-4">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Subtotal</span>
                                            <span className="font-mono">{formatINR(totals.subtotal)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">GST</span>
                                            <span className="font-mono">{formatINR(totals.gstAmount)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm items-center">
                                            <span className="text-muted-foreground">Shipping</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                value={shippingCost}
                                                onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                                                className="w-24 h-7 text-right"
                                            />
                                        </div>
                                        <div className="flex justify-between text-sm items-center">
                                            <span className="text-muted-foreground">Discount</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                value={discountAmount}
                                                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                                                className="w-24 h-7 text-right"
                                            />
                                        </div>
                                        <div className="border-t border-border pt-2 flex justify-between font-semibold text-lg">
                                            <span>Total</span>
                                            <span className="font-mono text-primary">{formatINR(totals.total)}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Additional */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle>Additional Information</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Shipping Address</Label>
                                <Textarea
                                    value={shippingAddress}
                                    onChange={(e) => setShippingAddress(e.target.value)}
                                    placeholder="Delivery address (if different from store)"
                                    rows={2}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Notes</Label>
                                <Textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Special instructions..."
                                    rows={2}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Actions */}
                    <div className="flex justify-end gap-3">
                        <Button variant="outline" onClick={() => router.push("/purchase")}>
                            Cancel
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => handleSubmit('draft')}
                            disabled={loading}
                        >
                            <Save className="w-4 h-4 mr-2" />
                            Save as Draft
                        </Button>
                        <Button
                            onClick={() => handleSubmit('sent')}
                            disabled={loading || items.length === 0}
                            className="bg-primary text-midnight hover:bg-primary/90"
                        >
                            <Send className="w-4 h-4 mr-2" />
                            {loading ? "Creating..." : "Create & Send"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}


