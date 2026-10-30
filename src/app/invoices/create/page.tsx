"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Plus,
    Trash2,
    Search,
    FileText,
    ScanBarcode,
} from "lucide-react";
import { toast } from "sonner";
import { QuickBarcodeScanModal, type ScannedItemPayload } from "@/components/common/QuickBarcodeScanModal";
import { MobileScanner } from "@/lib/mobile-scanner";

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
import { getSellableVariants, resolveBarcodeProduct } from "@/lib/products";

interface ProductVariant {
    id: string;
    variant_name: string;
    sku_suffix: string;
    material?: string;
    stock_level: number;
    price_adjustment: number;
    product: {
        id: string;
        name: string;
        sku: string;
        base_price: number;
        category?: string;
    };
}

// Raw product_variants PocketBase record as fetched with expand=product
interface ProductVariantRecord {
    id: string;
    variant_name: string;
    sku_suffix: string;
    material?: string;
    stock_level: number;
    price_adjustment?: number;
    expand?: {
        product?: {
            id: string;
            name: string;
            sku: string;
            base_price: number;
            category?: string;
        };
    };
}

export default function CreateInvoicePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
    const [products, setProducts] = useState<ProductVariant[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);
    const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);

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
            try {
                setProducts((await getSellableVariants()).map((v) => ({
                    id: v.id,
                    variant_name: v.variant_name || '',
                    sku_suffix: v.sku_suffix || '',
                    material: v.material,
                    stock_level: v.stock_level || 0,
                    price_adjustment: v.price_adjustment,
                    product: v.product,
                })));
            } catch (e) {
                console.error('Failed to load products:', e);
            }
        }
        loadData();
    }, []);

    // Recalculate totals helper
    const recalculateTotals = useCallback((currentItems: Omit<InvoiceItem, "id" | "invoice_id">[]) => {
        if (!storeSettings || currentItems.length === 0) {
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
        const isGstRegistered = storeSettings.is_gst_registered !== false && Boolean(storeSettings.store_gstin);

        const calculated = calculateInvoiceTotals(currentItems, sellerStateCode, buyerStateCode, isGstRegistered);
        setTotals({
            taxableValue: calculated.taxableValue,
            cgstAmount: calculated.cgstAmount,
            sgstAmount: calculated.sgstAmount,
            igstAmount: calculated.igstAmount,
            totalTax: calculated.totalTax,
            grandTotal: calculated.grandTotal,
        });
    }, [storeSettings, buyerState, placeOfSupply]);

    // Recalculate totals when settings or state codes change
    useEffect(() => {
        recalculateTotals(items);
    }, [recalculateTotals, items, buyerState, placeOfSupply, storeSettings]);

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
        if (variant.stock_level !== undefined && variant.stock_level <= 0) {
            alert(`"${variant.product.name}" is out of stock (0 available).`);
            return;
        }

        const existingIndex = items.findIndex((i) => i.variant_id === variant.id);
        if (existingIndex !== -1) {
            const existing = items[existingIndex];
            const maxStock = variant.stock_level ?? existing.stock_level;
            if (maxStock !== undefined && existing.quantity >= maxStock) {
                alert(`Maximum available stock reached for "${variant.product.name}" (${maxStock} available).`);
                return;
            }
            updateItem(existingIndex, "quantity", existing.quantity + 1);
            setShowSearch(false);
            setSearchQuery("");
            return;
        }

        const isGstRegistered = storeSettings?.is_gst_registered !== false && Boolean(storeSettings?.store_gstin);
        const effectiveGstRate = isGstRegistered ? GST_RATES.JEWELRY : 0;
        const unitPrice = (variant.product.base_price || 0) + (variant.price_adjustment || 0);
        const newItem: Omit<InvoiceItem, "id" | "invoice_id"> = {
            sr_no: items.length + 1,
            variant_id: variant.id,
            stock_level: variant.stock_level,
            description: `${variant.product.name}${variant.variant_name ? ` - ${variant.variant_name}` : ""}`,
            hsn_code: HSN_CODES.DEFAULT,
            quantity: 1,
            unit: "PCS",
            unit_price: unitPrice,
            discount_percent: 0,
            discount_amount: 0,
            taxable_amount: unitPrice,
            gst_rate: effectiveGstRate,
            cgst_rate: isGstRegistered ? 1.5 : 0,
            cgst_amount: 0,
            sgst_rate: isGstRegistered ? 1.5 : 0,
            sgst_amount: 0,
            igst_rate: 0,
            igst_amount: 0,
            cess_rate: 0,
            cess_amount: 0,
            total_amount: unitPrice,
        };

        const updated = [...items, newItem];
        setItems(updated);
        recalculateTotals(updated);
        setShowSearch(false);
        setSearchQuery("");
    };

    const handleScannedItem = (payload: ScannedItemPayload) => {
        if (!payload.product) {
            toast.error(`Barcode "${payload.barcode}" not found in catalog`);
            return;
        }

        const matchingVariant = products.find(p =>
            (payload.variant && p.id === payload.variant.id) ||
            p.product.id === payload.product?.id
        );

        if (matchingVariant) {
            addItemFromProduct(matchingVariant);
            toast.success(`Scanned: ${matchingVariant.product.name}`);
        } else {
            const syntheticVariant: ProductVariant = {
                id: payload.variant?.id || payload.product.id,
                variant_name: payload.variant?.size || payload.variant?.color || "Standard",
                sku_suffix: "",
                price_adjustment: payload.variant?.price_adjustment || 0,
                stock_level: payload.product.stock ?? 999,
                product: {
                    id: payload.product.id,
                    name: payload.product.name,
                    sku: payload.product.sku,
                    base_price: payload.product.base_price,
                }
            };
            addItemFromProduct(syntheticVariant);
            toast.success(`Scanned: ${payload.product.name}`);
        }
    };

    // Scoped scanner listener: directly adds scanned items to this invoice
    useEffect(() => {
        const unregister = MobileScanner.registerContext("invoice_entry", async (result) => {
            try {
                const resolved = await resolveBarcodeProduct(result.barcode);
                if (resolved) {
                    const { product: prod, variant: v } = resolved;
                    handleScannedItem({
                        barcode: result.barcode,
                        product: {
                            id: prod.id,
                            name: prod.name,
                            sku: prod.sku,
                            base_price: prod.base_price,
                            stock: v?.stock_level ?? 999,
                        },
                        variant: v ? {
                            id: v.id,
                            size: v.size,
                            color: v.color,
                            price_adjustment: v.price_adjustment || 0,
                        } : undefined
                    });
                } else {
                    toast.error(`Barcode "${result.barcode}" not found in catalog`);
                }
            } catch {
                toast.error(`Barcode "${result.barcode}" not found in catalog`);
            }
            return true; // Stop propagation
        }, 60);
        return () => unregister();
    }, [items, products]);

    // Add blank item
    const addBlankItem = () => {
        const isGstRegistered = storeSettings?.is_gst_registered !== false && Boolean(storeSettings?.store_gstin);
        const effectiveGstRate = isGstRegistered ? GST_RATES.JEWELRY : 0;
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
            gst_rate: effectiveGstRate,
            cgst_rate: isGstRegistered ? 1.5 : 0,
            cgst_amount: 0,
            sgst_rate: isGstRegistered ? 1.5 : 0,
            sgst_amount: 0,
            igst_rate: 0,
            igst_amount: 0,
            cess_rate: 0,
            cess_amount: 0,
            total_amount: 0,
        };

        const updated = [...items, newItem];
        setItems(updated);
        recalculateTotals(updated);
    };

    // Update item
    const updateItem = (index: number, field: string, value: string | number) => {
        const newItems = [...items];
        const item = newItems[index];

        if (field === "quantity") {
            const requestedQty = parseInt(String(value)) || 1;
            if (item.stock_level !== undefined && requestedQty > item.stock_level) {
                alert(`Cannot exceed available stock (${item.stock_level} available).`);
                item.quantity = Math.max(1, item.stock_level);
            } else {
                item.quantity = Math.max(1, requestedQty);
            }
        } else if (field === "description" || field === "hsn_code") {
            item[field] = String(value);
        } else if (field === "unit_price" || field === "discount_percent") {
            item[field] = Number(value);
        }

        // Recalculate line totals
        const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
        item.discount_amount = lineTotal * ((item.discount_percent || 0) / 100);
        item.taxable_amount = lineTotal - item.discount_amount;
        item.total_amount = item.taxable_amount;

        setItems(newItems);
        recalculateTotals(newItems);
    };

    // Remove item
    const removeItem = (index: number) => {
        const updated = items.filter((_, i) => i !== index);
        setItems(updated);
        recalculateTotals(updated);
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

        // Check for oversold items
        const oversoldItem = items.find(item => item.stock_level !== undefined && item.quantity > item.stock_level);
        if (oversoldItem) {
            alert(`Cannot create invoice: "${oversoldItem.description}" exceeds available stock (${oversoldItem.quantity} requested, ${oversoldItem.stock_level} available).`);
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
            const isGstRegistered = storeSettings.is_gst_registered !== false && Boolean(storeSettings.store_gstin);
            const sellerStateCode = storeSettings.store_state_code || "";
            const buyerStateCode = getStateCode(buyerState) || placeOfSupply || sellerStateCode;

            const sellerStatePin = [storeSettings.store_state, storeSettings.store_pincode].filter(Boolean).join(" - ");
            const formattedSellerAddress = [storeSettings.store_address, storeSettings.store_city, sellerStatePin].filter(Boolean).join(", ");

            const invoice: Omit<Invoice, "id" | "invoice_number" | "created_at" | "updated_at"> = {
                invoice_date: new Date(invoiceDate).toISOString(),
                invoice_type: invoiceType,

                seller_gstin: isGstRegistered ? (storeSettings.store_gstin || '') : '',
                seller_name: storeSettings.store_name,
                seller_address: formattedSellerAddress,
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
            router.push(`/invoices/detail?id=${created.id}`);
        } catch (error) {
            console.error("Error creating invoice:", error);
            alert("Failed to create invoice. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const isGstActive = storeSettings?.is_gst_registered !== false && Boolean(storeSettings?.store_gstin);
    // Mirror recalculateTotals: an unset buyer state / place of supply falls back to the seller code,
    // so the transaction is intra-state and the panel must show CGST/SGST, not IGST.
    const sellerStateCode = storeSettings?.store_state_code || "";
    const effectiveBuyerStateCode = getStateCode(buyerState) || placeOfSupply || sellerStateCode;
    const isInterState = sellerStateCode !== effectiveBuyerStateCode;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Create Invoice"
                subtitle={isGstActive ? "New GST compliant tax invoice" : "Bill of Supply (Unregistered Business • 0% GST)"}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Back Button */}
                    <div className="flex justify-between items-center">
                        <Button variant="ghost" onClick={() => router.push("/invoices")}>
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Invoices
                        </Button>
                        {!isGstActive && (
                            <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs px-3 py-1 rounded-full font-medium">
                                Unregistered Mode • 0% GST (Bill of Supply)
                            </span>
                        )}
                    </div>

                    {/* Invoice Details */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle className="text-primary">Invoice Details</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="space-y-2">
                                <Label>Invoice Type</Label>
                                <Select value={invoiceType} onValueChange={(v) => v && setInvoiceType(v as "regular" | "credit_note" | "debit_note")}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="regular">{isGstActive ? "Tax Invoice" : "Bill of Supply / Invoice"}</SelectItem>
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
                                <Select value={placeOfSupply} onValueChange={(v) => v && setPlaceOfSupply(v)}>
                                    <SelectTrigger>
                                        <SelectValue />
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
                                <Select value={buyerState} onValueChange={(v) => v && setBuyerState(v)}>
                                    <SelectTrigger>
                                        <SelectValue />
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
                        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <CardTitle>Items</CardTitle>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-primary/40 text-primary hover:bg-primary/10"
                                    onClick={() => setShowBarcodeScanner(true)}
                                >
                                    <ScanBarcode className="w-4 h-4 mr-2" />
                                    Scan Barcode
                                </Button>
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
                                                {filteredProducts.slice(0, 10).map((variant) => {
                                                    const isOutOfStock = variant.stock_level <= 0;
                                                    return (
                                                        <div
                                                            key={variant.id}
                                                            className={`p-3 border-b border-border transition-colors ${
                                                                isOutOfStock
                                                                    ? "opacity-50 cursor-not-allowed bg-muted/20"
                                                                    : "hover:bg-muted cursor-pointer"
                                                            }`}
                                                            onClick={() => addItemFromProduct(variant)}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div className="font-medium">{variant.product.name}</div>
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                                                    isOutOfStock
                                                                        ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                                                        : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                                                }`}>
                                                                    {isOutOfStock ? "0 in stock" : `${variant.stock_level} in stock`}
                                                                </span>
                                                            </div>
                                                            <div className="text-sm text-muted-foreground flex justify-between mt-1">
                                                                <span>{variant.variant_name}</span>
                                                                <span className="font-mono">{formatINR((variant.product.base_price || 0) + (variant.price_adjustment || 0))}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
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
                                                No items added. Click &quot;Add Product&quot; or &quot;Add Custom Item&quot; to begin.
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
                                                        max={item.stock_level}
                                                        value={item.quantity}
                                                        onChange={(e) => updateItem(index, "quantity", e.target.value)}
                                                        className="h-8"
                                                    />
                                                    {item.stock_level !== undefined && (
                                                        <span className="text-[10px] text-muted-foreground block mt-0.5 whitespace-nowrap">
                                                            Max: {item.stock_level}
                                                        </span>
                                                    )}
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
                                        {isGstActive ? (
                                            isInterState ? (
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
                                            )
                                        ) : (
                                            <div className="flex justify-between text-sm text-amber-500/90 font-medium">
                                                <span>GST (0% - Bill of Supply)</span>
                                                <span className="font-mono">₹0.00</span>
                                            </div>
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
                            className=""
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

            <QuickBarcodeScanModal
                open={showBarcodeScanner}
                onOpenChange={setShowBarcodeScanner}
                title="Scan Invoice Line Item"
                onItemScanned={handleScannedItem}
            />
        </div>
    );
}


