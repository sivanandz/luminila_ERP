"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Plus,
    Trash2,
    Search,
    Calculator,
    Save,
    FileText,
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
import { Switch } from "@/components/ui/switch";

import {
    createInvoice,
    getStoreSettings,
    calculateInvoiceTotals,
    type Invoice,
    type InvoiceItem,
    type StoreSettings,
} from "@/lib/invoice";
import {
    STATE_CODES,
    getStateCode,
    validateGSTIN,
    formatINR,
    GST_RATES,
    HSN_CODES,
} from "@/lib/gst";
import { supabase } from "@/lib/supabase";

interface ProductVariant {
    id: string;
    variant_name: string;
    sku_suffix: string;
    material?: string;
    stock_level: number;
    product: {
        id: string;
        name: string;
        sku: string;
        base_price: number;
        category?: string;
    };
}

export default function CreateInvoicePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
    const [products, setProducts] = useState<ProductVariant[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);

    // Invoice state
    const [invoiceType, setInvoiceType] = useState<"regular" | "credit_note" | "debit_note">("regular");
    const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [dueDate, setDueDate] = useState("");

    // Buyer state
    const [buyerName, setBuyerName] = useState("");
    const [buyerGstin, setBuyerGstin] = useState("");
    const [buyerPhone, setBuyerPhone] = useState("");
    const [buyerEmail, setBuyerEmail] = useState("");
    const [buyerAddress, setBuyerAddress] = useState("");
    const [buyerState, setBuyerState] = useState("");
    const [placeOfSupply, setPlaceOfSupply] = useState("");

    // Items
    const [items, setItems] = useState<Omit<InvoiceItem, "id" | "invoice_id">[]>([]);

    // Additional
    const [isReverseCharge, setIsReverseCharge] = useState(false);
    const [notes, setNotes] = useState("");
    const [paymentTerms, setPaymentTerms] = useState("");

    // Calculated totals
    const [totals, setTotals] = useState({
        taxableValue: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        totalTax: 0,
        grandTotal: 0,
    });

    // Load store settings and products
    useEffect(() => {
        async function loadData() {
            const settings = await getStoreSettings();
            setStoreSettings(settings);
            setPaymentTerms(settings.invoice_terms || "");

            // Load products for search
            const { data } = await supabase
                .from("product_variants")
                .select(`
                    id,
                    variant_name,
                    sku_suffix,
                    material,
                    stock_level,
                    product:products(id, name, sku, base_price, category)
                `)
                .gt("stock_level", 0)
                .order("variant_name");

            if (data) {
                setProducts(data as unknown as ProductVariant[]);
            }
        }
        loadData();
    }, []);

    // Recalculate totals when items change
    useEffect(() => {
        if (!storeSettings || items.length === 0) {
            setTotals({
                taxableValue: 0,
                cgstAmount: 0,
                sgstAmount: 0,
                igstAmount: 0,
                totalTax: 0,
                grandTotal: 0,
            });
            return;
        }

        const sellerStateCode = storeSettings.store_state_code || "";
        const buyerStateCode = getStateCode(buyerState) || placeOfSupply || sellerStateCode;

        const calculated = calculateInvoiceTotals(items, sellerStateCode, buyerStateCode);
        setItems(calculated.items);
        setTotals({
            taxableValue: calculated.taxableValue,
            cgstAmount: calculated.cgstAmount,
            sgstAmount: calculated.sgstAmount,
            igstAmount: calculated.igstAmount,
            totalTax: calculated.totalTax,
            grandTotal: calculated.grandTotal,
        });
    }, [items.length, buyerState, placeOfSupply, storeSettings]);

    // Filter products for search
    const filteredProducts = products.filter((p) => {
        const query = searchQuery.toLowerCase();
        return (
            p.product.name.toLowerCase().includes(query) ||
            p.product.sku.toLowerCase().includes(query) ||
            p.variant_name.toLowerCase().includes(query)
        );
    });

    // Add item from product search
    const addItemFromProduct = (variant: ProductVariant) => {
        const newItem: Omit<InvoiceItem, "id" | "invoice_id"> = {
            sr_no: items.length + 1,
            variant_id: variant.id,
            description: `${variant.product.name}${variant.variant_name ? ` - ${variant.variant_name}` : ""}`,
            hsn_code: HSN_CODES.DEFAULT,
            quantity: 1,
            unit: "PCS",
            unit_price: variant.product.base_price,
            discount_percent: 0,
            discount_amount: 0,
            taxable_amount: variant.product.base_price,
            gst_rate: GST_RATES.JEWELRY,
            cgst_rate: 1.5,
            cgst_amount: 0,
            sgst_rate: 1.5,
            sgst_amount: 0,
            igst_rate: 0,
            igst_amount: 0,
            cess_rate: 0,
            cess_amount: 0,
            total_amount: variant.product.base_price,
        };

        setItems([...items, newItem]);
        setShowSearch(false);
        setSearchQuery("");
    };

    // Add blank item
    const addBlankItem = () => {
        const newItem: Omit<InvoiceItem, "id" | "invoice_id"> = {
            sr_no: items.length + 1,
            description: "",
            hsn_code: HSN_CODES.DEFAULT,
            quantity: 1,
            unit: "PCS",
            unit_price: 0,
            discount_percent: 0,
            discount_amount: 0,
            taxable_amount: 0,
            gst_rate: GST_RATES.JEWELRY,
            cgst_rate: 1.5,
            cgst_amount: 0,
            sgst_rate: 1.5,
            sgst_amount: 0,
            igst_rate: 0,
            igst_amount: 0,
            cess_rate: 0,
            cess_amount: 0,
            total_amount: 0,
        };

        setItems([...items, newItem]);
    };

    // Update item
    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...items];
        (newItems[index] as any)[field] = value;

        // Recalculate line totals
        const item = newItems[index];
        const lineTotal = item.quantity * item.unit_price;
        item.discount_amount = lineTotal * (item.discount_percent / 100);
        item.taxable_amount = lineTotal - item.discount_amount;

        setItems(newItems);
    };

    // Remove item
    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    // Submit invoice
    const handleSubmit = async () => {
        if (!storeSettings) return;

        if (!buyerName) {
            alert("Please enter buyer name");
            return;
        }

        if (items.length === 0) {
            alert("Please add at least one item");
            return;
        }

        // Validate GSTIN if provided
        if (buyerGstin) {
            const validation = validateGSTIN(buyerGstin);
            if (!validation.valid) {
                alert(validation.message);
                return;
            }
        }

        setLoading(true);

        try {
            const sellerStateCode = storeSettings.store_state_code || "";
            const buyerStateCode = getStateCode(buyerState) || placeOfSupply || sellerStateCode;

            const invoice: Omit<Invoice, "id" | "invoice_number" | "created_at" | "updated_at"> = {
                invoice_date: new Date(invoiceDate).toISOString(),
                invoice_type: invoiceType,

                seller_gstin: storeSettings.store_gstin,
                seller_name: storeSettings.store_name,
                seller_address: `${storeSettings.store_address}, ${storeSettings.store_city}, ${storeSettings.store_state} - ${storeSettings.store_pincode}`,
                seller_state_code: sellerStateCode,

                buyer_name: buyerName,
                buyer_gstin: buyerGstin,
                buyer_phone: buyerPhone,
                buyer_email: buyerEmail,
                buyer_address: buyerAddress,
                buyer_state_code: buyerStateCode,
                place_of_supply: placeOfSupply || buyerStateCode,

                taxable_value: totals.taxableValue,
                cgst_amount: totals.cgstAmount,
                sgst_amount: totals.sgstAmount,
                igst_amount: totals.igstAmount,
                cess_amount: 0,
                total_tax: totals.totalTax,
                discount_amount: 0,
                shipping_charges: 0,
                grand_total: totals.grandTotal,
                amount_in_words: "",

                is_reverse_charge: isReverseCharge,
                payment_terms: paymentTerms,
                due_date: dueDate || undefined,
                is_paid: false,
                paid_amount: 0,
                notes,

                items: items as InvoiceItem[],
            };

            const created = await createInvoice(invoice);
            router.push(`/invoices/${created.id}`);
        } catch (error) {
            console.error("Error creating invoice:", error);
            alert("Failed to create invoice. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const isInterState = storeSettings?.store_state_code !== (getStateCode(buyerState) || placeOfSupply);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Create Invoice"
                subtitle="New GST compliant tax invoice"
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Back Button */}
                    <Button variant="ghost" onClick={() => router.push("/invoices")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Invoices
                    </Button>

                    {/* Invoice Details */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle className="text-primary">Invoice Details</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="space-y-2">
                                <Label>Invoice Type</Label>
                                <Select value={invoiceType} onValueChange={(v: any) => setInvoiceType(v)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="regular">Tax Invoice</SelectItem>
                                        <SelectItem value="credit_note">Credit Note</SelectItem>
                                        <SelectItem value="debit_note">Debit Note</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Invoice Date</Label>
                                <Input
                                    type="date"
                                    value={invoiceDate}
                                    onChange={(e) => setInvoiceDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Due Date (Optional)</Label>
                                <Input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Place of Supply</Label>
                                <Select value={placeOfSupply} onValueChange={setPlaceOfSupply}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select state" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(STATE_CODES).map(([name, code]) => (
                                            <SelectItem key={code} value={code}>
                                                {name} ({code})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Buyer Details */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle>Bill To</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Customer Name *</Label>
                                <Input
                                    value={buyerName}
                                    onChange={(e) => setBuyerName(e.target.value)}
                                    placeholder="Enter customer name"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>GSTIN (Optional)</Label>
                                <Input
                                    value={buyerGstin}
                                    onChange={(e) => setBuyerGstin(e.target.value.toUpperCase())}
                                    placeholder="22AAAAA0000A1Z5"
                                    maxLength={15}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={buyerPhone}
                                    onChange={(e) => setBuyerPhone(e.target.value)}
                                    placeholder="Phone number"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    type="email"
                                    value={buyerEmail}
                                    onChange={(e) => setBuyerEmail(e.target.value)}
                                    placeholder="Email address"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label>Address</Label>
                                <Textarea
                                    value={buyerAddress}
                                    onChange={(e) => setBuyerAddress(e.target.value)}
                                    placeholder="Full address"
                                    rows={2}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>State</Label>
                                <Select value={buyerState} onValueChange={setBuyerState}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select state" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.keys(STATE_CODES).map((name) => (
                                            <SelectItem key={name} value={name}>
                                                {name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="reverse-charge"
                                    checked={isReverseCharge}
                                    onCheckedChange={setIsReverseCharge}
                                />
                                <Label htmlFor="reverse-charge">Reverse Charge Applicable</Label>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Items */}
                    <Card className="bg-card border-border">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Items</CardTitle>
                            <div className="flex gap-2">
                                <div className="relative">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowSearch(!showSearch)}
                                    >
                                        <Search className="w-4 h-4 mr-2" />
                                        Add Product
                                    </Button>
                                    {showSearch && (
                                        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50">
                                            <div className="p-3 border-b border-border">
                                                <Input
                                                    autoFocus
                                                    placeholder="Search products..."
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                />
                                            </div>
                                            <div className="max-h-60 overflow-y-auto">
                                                {filteredProducts.slice(0, 10).map((variant) => (
                                                    <div
                                                        key={variant.id}
                                                        className="p-3 hover:bg-muted cursor-pointer border-b border-border"
                                                        onClick={() => addItemFromProduct(variant)}
                                                    >
                                                        <div className="font-medium">{variant.product.name}</div>
                                                        <div className="text-sm text-muted-foreground flex justify-between">
                                                            <span>{variant.variant_name}</span>
                                                            <span>{formatINR(variant.product.base_price)}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <Button variant="outline" size="sm" onClick={addBlankItem}>
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Custom Item
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-border">
                                        <TableHead className="w-10">#</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead className="w-24">HSN</TableHead>
                                        <TableHead className="w-20">Qty</TableHead>
                                        <TableHead className="w-28">Rate</TableHead>
                                        <TableHead className="w-20">Disc %</TableHead>
                                        <TableHead className="w-28 text-right">Total</TableHead>
                                        <TableHead className="w-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                                No items added. Click "Add Product" or "Add Custom Item" to begin.
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
                                                        placeholder="Item description"
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={item.hsn_code}
                                                        onChange={(e) => updateItem(index, "hsn_code", e.target.value)}
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={item.quantity}
                                                        onChange={(e) => updateItem(index, "quantity", parseInt(e.target.value) || 1)}
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
                                                        max="100"
                                                        value={item.discount_percent}
                                                        onChange={(e) => updateItem(index, "discount_percent", parseFloat(e.target.value) || 0)}
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatINR(item.total_amount)}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-red-400 hover:text-red-300"
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
                                            <span className="text-muted-foreground">Taxable Value</span>
                                            <span className="font-mono">{formatINR(totals.taxableValue)}</span>
                                        </div>
                                        {isInterState ? (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">IGST (3%)</span>
                                                <span className="font-mono">{formatINR(totals.igstAmount)}</span>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">CGST (1.5%)</span>
                                                    <span className="font-mono">{formatINR(totals.cgstAmount)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">SGST (1.5%)</span>
                                                    <span className="font-mono">{formatINR(totals.sgstAmount)}</span>
                                                </div>
                                            </>
                                        )}
                                        <div className="border-t border-border pt-2 flex justify-between font-semibold text-lg">
                                            <span>Grand Total</span>
                                            <span className="font-mono text-primary">
                                                {formatINR(totals.grandTotal)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Notes */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle>Additional Information</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Payment Terms</Label>
                                <Input
                                    value={paymentTerms}
                                    onChange={(e) => setPaymentTerms(e.target.value)}
                                    placeholder="e.g., Payment due within 30 days"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Notes</Label>
                                <Textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Any additional notes..."
                                    rows={2}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Actions */}
                    <div className="flex justify-end gap-3">
                        <Button variant="outline" onClick={() => router.push("/invoices")}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={loading || items.length === 0}
                            className="bg-primary text-midnight hover:bg-primary/90"
                        >
                            {loading ? (
                                "Creating..."
                            ) : (
                                <>
                                    <FileText className="w-4 h-4 mr-2" />
                                    Create Invoice
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}


