"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Plus,
    Trash2,
    Search,
    Save,
    Send,
    PackagePlus,
    Sparkles,
    Package,
    FilePlus2,
    RefreshCw,
    Receipt,
    Truck,
    Info,
    Coins,
    Sliders,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { QuickProductModal, type QuickProductCreatedResult } from "@/components/inventory";

import {
    createPurchaseOrder,
    calculatePOItemTotals,
    calculatePOTotals,
    generateTimestampPONumber,
    type PurchaseOrderItem,
    type POStatus,
    type POType,
} from "@/lib/purchase";
import { getVendors, type Vendor } from "@/lib/vendors";
import { formatINR, GST_RATES, HSN_CODES } from "@/lib/gst";
import { pb } from "@/lib/pocketbase";
import type { ProductVariant as ProductVariantRecord } from "@/types/database";
import { toast } from "sonner";

interface ProductVariant {
    id: string;
    variant_name: string;
    sku_suffix?: string;
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

    // Quick Product Modal state for new/unlisted items
    const [showQuickProductModal, setShowQuickProductModal] = useState(false);
    const [quickProductTargetIndex, setQuickProductTargetIndex] = useState<number | null>(null);
    const [quickProductInitial, setQuickProductInitial] = useState<{
        name?: string;
        cost_price?: number;
        base_price?: number;
        category?: string;
        hsn_code?: string;
    }>({});

    // PO Type & Blanket Budget state
    const [poType, setPoType] = useState<POType>("itemized"); // 'itemized' | 'blanket'
    const [poReference, setPoReference] = useState("");
    const [budgetAmount, setBudgetAmount] = useState<number>(0);
    const [gstPaidOverhead, setGstPaidOverhead] = useState<number>(0);
    const [shippingOverhead, setShippingOverhead] = useState<number>(0);
    const [isUnregisteredSeller, setIsUnregisteredSeller] = useState(false);
    const [absorbOverhead, setAbsorbOverhead] = useState(false);

    // Form state
    const [vendorId, setVendorId] = useState("");
    const [orderDate, setOrderDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [expectedDate, setExpectedDate] = useState("");
    const [shippingAddress, setShippingAddress] = useState("");
    const [shippingCost, setShippingCost] = useState(0);
    const [discountAmount, setDiscountAmount] = useState(0);
    const [notes, setNotes] = useState("");
    const [items, setItems] = useState<Omit<PurchaseOrderItem, 'id' | 'po_id'>[]>([]);

    // Function to generate/refresh timestamped reference number
    const refreshPoReference = useCallback((vId?: string) => {
        const targetId = vId || vendorId;
        const v = vendors.find(item => item.id === targetId);
        const ref = generateTimestampPONumber(v?.name, new Date());
        setPoReference(ref);
        return ref;
    }, [vendorId, vendors]);

    // Handle vendor change
    const handleVendorChange = (newVendorId: string | null) => {
        if (!newVendorId) return;
        setVendorId(newVendorId);
        refreshPoReference(newVendorId);
    };

    const loadProducts = useCallback(async () => {
        try {
            const variants = await pb.collection('product_variants').getFullList<ProductVariantRecord>({
                sort: 'variant_name',
                expand: 'product',
            });
            const productList: ProductVariant[] = variants.map((v) => ({
                id: v.id,
                variant_name: v.variant_name,
                sku_suffix: v.sku_suffix,
                product: v.expand?.product ? {
                    id: v.expand.product.id,
                    name: v.expand.product.name,
                    sku: v.expand.product.sku,
                    base_price: v.expand.product.base_price,
                } : { id: '', name: '', sku: '', base_price: 0 },
            }));
            setProducts(productList);
        } catch (e) {
            console.error('Failed to load products:', e);
        }
    }, []);

    // Load vendors and products
    useEffect(() => {
        async function loadData() {
            const vendorData = await getVendors();
            setVendors(vendorData);
            setPoReference(prev => prev || generateTimestampPONumber('GEN', new Date()));
            await loadProducts();
        }
        loadData();
    }, [loadProducts]);

    // Filter products for search
    const filteredProducts = products.filter((p) => {
        const query = productSearch.toLowerCase();
        return (
            p.product.name.toLowerCase().includes(query) ||
            p.product.sku.toLowerCase().includes(query)
        );
    });

    // Add item from catalog
    const addCatalogItem = (variant: ProductVariant) => {
        const unitPrice = variant.product.base_price * 0.6; // Default to 60% of retail as estimated procurement cost
        const { gstAmount, totalPrice } = calculatePOItemTotals(1, unitPrice, GST_RATES.JEWELRY);

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
            variant: {
                id: variant.id,
                variant_name: variant.variant_name,
                sku_suffix: variant.sku_suffix || 'STD',
                product: {
                    id: variant.product.id,
                    name: variant.product.name,
                    sku: variant.product.sku,
                },
            },
        };

        setItems([...items, newItem]);
        setShowProductSearch(false);
        setProductSearch("");
    };

    // Add uncataloged custom/new line item
    const addCustomItem = (initialName?: string) => {
        const unitPrice = 1000;
        const { gstAmount, totalPrice } = calculatePOItemTotals(1, unitPrice, GST_RATES.JEWELRY);

        const newItem: Omit<PurchaseOrderItem, 'id' | 'po_id'> = {
            description: initialName?.trim() || "New Procured Item",
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
        toast.info("Added custom unlisted line item. You can edit price, qty or register it to catalog.");
    };

    // Open Quick Product Modal
    const openRegisterProductModal = (targetIndex?: number, customName?: string) => {
        if (typeof targetIndex === "number") {
            setQuickProductTargetIndex(targetIndex);
            const target = items[targetIndex];
            setQuickProductInitial({
                name: target.description,
                cost_price: target.unit_price,
                hsn_code: target.hsn_code,
            });
        } else {
            setQuickProductTargetIndex(null);
            setQuickProductInitial({
                name: customName || productSearch || "",
                cost_price: 1000,
            });
        }
        setShowQuickProductModal(true);
        setShowProductSearch(false);
        setProductSearch("");
    };

    // When product is created via QuickProductModal
    const handleQuickProductSuccess = (result: QuickProductCreatedResult) => {
        if (quickProductTargetIndex !== null && items[quickProductTargetIndex]) {
            // Update existing row
            const newItems = [...items];
            const target = newItems[quickProductTargetIndex];
            target.variant_id = result.variantId;
            target.description = result.name;
            target.unit_price = result.costPrice;
            const { gstAmount, totalPrice } = calculatePOItemTotals(
                target.quantity_ordered,
                result.costPrice,
                target.gst_rate
            );
            target.gst_amount = gstAmount;
            target.total_price = totalPrice;
            target.variant = {
                id: result.variantId,
                variant_name: "Standard",
                sku_suffix: "STD",
                product: {
                    id: result.productId,
                    name: result.name,
                    sku: result.sku.replace(/-STD$/, ""),
                },
            };
            setItems(newItems);
        } else {
            // Add as new row
            const unitPrice = result.costPrice;
            const { gstAmount, totalPrice } = calculatePOItemTotals(1, unitPrice, GST_RATES.JEWELRY);
            const newItem: Omit<PurchaseOrderItem, 'id' | 'po_id'> = {
                variant_id: result.variantId,
                description: result.name,
                hsn_code: HSN_CODES.DEFAULT,
                quantity_ordered: 1,
                quantity_received: 0,
                unit: "PCS",
                unit_price: unitPrice,
                gst_rate: GST_RATES.JEWELRY,
                gst_amount: gstAmount,
                total_price: totalPrice,
                variant: {
                    id: result.variantId,
                    variant_name: "Standard",
                    sku_suffix: "STD",
                    product: {
                        id: result.productId,
                        name: result.name,
                        sku: result.sku.replace(/-STD$/, ""),
                    },
                },
            };
            setItems([...items, newItem]);
        }
        loadProducts();
    };

    // Update item
    const updateItem = <K extends keyof Omit<PurchaseOrderItem, 'id' | 'po_id'>>(
        index: number,
        field: K,
        value: Omit<PurchaseOrderItem, 'id' | 'po_id'>[K]
    ) => {
        const newItems = [...items];
        newItems[index][field] = value;

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
            toast.error("Please select a vendor");
            return;
        }

        if (poType === 'blanket') {
            if (!budgetAmount || budgetAmount <= 0) {
                toast.error("Please enter a valid budgeted monetary value (> ₹0)");
                return;
            }
        } else {
            if (items.length === 0) {
                toast.error("Please add at least one item to this purchase order");
                return;
            }
        }

        setLoading(true);

        try {
            const finalPoNumber = poReference.trim() || undefined;

            let poPayload: any;
            if (poType === 'blanket') {
                const total = budgetAmount + gstPaidOverhead + shippingOverhead - discountAmount;
                poPayload = {
                    po_number: finalPoNumber,
                    po_type: 'blanket',
                    vendor_id: vendorId,
                    status,
                    order_date: orderDate,
                    expected_date: expectedDate || undefined,
                    subtotal: budgetAmount,
                    budget_amount: budgetAmount,
                    gst_amount: gstPaidOverhead,
                    gst_paid_overhead: gstPaidOverhead,
                    shipping_cost: shippingOverhead,
                    shipping_overhead: shippingOverhead,
                    discount_amount: discountAmount,
                    total,
                    absorb_overhead: absorbOverhead,
                    is_unregistered_seller: isUnregisteredSeller,
                    shipping_address: shippingAddress || undefined,
                    notes: notes || undefined,
                    items: [],
                };
            } else {
                poPayload = {
                    po_number: finalPoNumber,
                    po_type: 'itemized',
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
                };
            }

            const po = await createPurchaseOrder(poPayload);

            toast.success(`Purchase order ${po.po_number} created successfully!`);
            router.push(`/purchase/detail?id=${po.id}`);
        } catch (error) {
            console.error("Error creating PO:", error);
            toast.error("Failed to create purchase order");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="New Purchase Order"
                subtitle="Create procurement order for vendor (supports existing catalog & fresh unlisted items)"
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Back */}
                    <Button variant="ghost" onClick={() => router.push("/purchase")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Purchase Orders
                    </Button>

                    {/* PO Mode Selector */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            type="button"
                            onClick={() => setPoType('itemized')}
                            className={`p-4 rounded-xl border text-left transition-all ${
                                poType === 'itemized'
                                    ? 'bg-primary/10 border-primary shadow-sm ring-1 ring-primary/30'
                                    : 'bg-card border-border hover:border-border/80'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-lg ${poType === 'itemized' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                    <Package className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-foreground">Standard Itemized PO</h3>
                                        {poType === 'itemized' && <Badge className="text-[10px]">Active</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Specify exact products, catalog variants, and line quantities upfront.
                                    </p>
                                </div>
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setPoType('blanket');
                                if (!poReference) refreshPoReference();
                            }}
                            className={`p-4 rounded-xl border text-left transition-all ${
                                poType === 'blanket'
                                    ? 'bg-amber-500/10 border-amber-500/80 shadow-sm ring-1 ring-amber-500/30'
                                    : 'bg-card border-border hover:border-border/80'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-lg ${poType === 'blanket' ? 'bg-amber-500 text-black font-bold' : 'bg-muted text-muted-foreground'}`}>
                                    <Coins className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                                            <span>Blanket / Budget PO</span>
                                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">Value-Based</Badge>
                                        </h3>
                                        {poType === 'blanket' && <Badge className="text-[10px] bg-amber-500 text-black hover:bg-amber-600">Active</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Create PO with lump-sum budget without adding products upfront. Scan or import items upon arrival.
                                    </p>
                                </div>
                            </div>
                        </button>
                    </div>

                    {/* Order Details & Timestamped Reference */}
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle className="text-primary flex items-center justify-between">
                                <span>Order Details</span>
                                <Badge variant="outline" className="font-mono text-xs">
                                    Ref: {poReference || 'Generating...'}
                                </Badge>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="space-y-2 md:col-span-2">
                                <Label>Vendor *</Label>
                                <Select value={vendorId} onValueChange={handleVendorChange}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Vendor" />
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

                            <div className="space-y-2 md:col-span-2">
                                <div className="flex items-center justify-between">
                                    <Label>PO Reference Number *</Label>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => refreshPoReference()}
                                        className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                                        title="Regenerate timestamp based on current time"
                                    >
                                        <RefreshCw className="w-3 h-3 mr-1" />
                                        Refresh Timestamp
                                    </Button>
                                </div>
                                <Input
                                    value={poReference}
                                    onChange={(e) => setPoReference(e.target.value)}
                                    placeholder="PO-[VENDOR]-[YYYYMMDD]-[HHmmss]"
                                    className="font-mono text-sm tracking-wide bg-muted/20"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Generated automatically from creation date, timestamp &amp; vendor code.
                                </p>
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <Label>Order Date</Label>
                                <Input
                                    type="date"
                                    value={orderDate}
                                    onChange={(e) => setOrderDate(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <Label>Expected Delivery</Label>
                                <Input
                                    type="date"
                                    value={expectedDate}
                                    onChange={(e) => setExpectedDate(e.target.value)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Mode-Dependent Body: Blanket Budget Card vs Itemized Items Section */}
                    {poType === 'blanket' ? (
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-primary flex items-center gap-2">
                                    <Coins className="w-5 h-5 text-amber-500" />
                                    <span>Blanket Budget &amp; Overheads Allocation</span>
                                </CardTitle>
                                <CardDescription>
                                    Allocate lump-sum procurement capital. Individual product lines do NOT need to be listed now; you will scan or import stock items against Reference #{poReference} when goods physically arrive.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                                            <span>Budgeted Stock Value (₹) *</span>
                                        </Label>
                                        <Input
                                            type="number"
                                            min="1"
                                            step="100"
                                            placeholder="e.g. 500000"
                                            value={budgetAmount || ''}
                                            onChange={(e) => setBudgetAmount(parseFloat(e.target.value) || 0)}
                                            className="text-lg font-mono font-bold"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Base goods allocation value planned with vendor.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                                            <Receipt className="w-4 h-4 text-primary" />
                                            <span>GST Paid to Vendor (₹)</span>
                                        </Label>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="1"
                                            placeholder="e.g. 15000"
                                            value={gstPaidOverhead || ''}
                                            onChange={(e) => setGstPaidOverhead(parseFloat(e.target.value) || 0)}
                                            className="text-lg font-mono"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Tax paid on invoice (Overhead item).
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                                            <Truck className="w-4 h-4 text-primary" />
                                            <span>Shipping &amp; Logistics (₹)</span>
                                        </Label>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="1"
                                            placeholder="e.g. 2500"
                                            value={shippingOverhead || ''}
                                            onChange={(e) => setShippingOverhead(parseFloat(e.target.value) || 0)}
                                            className="text-lg font-mono"
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Freight, insurance &amp; transit overheads.
                                        </p>
                                    </div>
                                </div>

                                {/* Overheads & GST Credit Treatment Switches */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/60">
                                    <div className="flex items-start space-x-3 p-4 rounded-xl border border-border/80 bg-muted/10">
                                        <Switch
                                            id="unregistered-seller-toggle"
                                            checked={isUnregisteredSeller}
                                            onCheckedChange={(val) => {
                                                setIsUnregisteredSeller(val);
                                                if (val) setAbsorbOverhead(true);
                                            }}
                                        />
                                        <div className="space-y-1">
                                            <Label htmlFor="unregistered-seller-toggle" className="text-sm font-semibold cursor-pointer">
                                                Unregistered / Non-GST Seller
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Seller account cannot issue a valid GST tax credit. Unclaimed GST &amp; shipping will be non-creditable overheads.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start space-x-3 p-4 rounded-xl border border-border/80 bg-muted/10">
                                        <Switch
                                            id="absorb-overhead-toggle"
                                            checked={absorbOverhead}
                                            onCheckedChange={setAbsorbOverhead}
                                        />
                                        <div className="space-y-1">
                                            <Label htmlFor="absorb-overhead-toggle" className="text-sm font-semibold cursor-pointer">
                                                Absorb Overheads into Landed Unit Cost
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                Inflates each received unit&apos;s cost price proportionately by (GST Paid + Shipping), reflecting true inventory acquisition cost.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Blanket PO Financial Commitment Summary */}
                                <div className="rounded-xl p-5 bg-gradient-to-r from-muted/30 to-muted/10 border border-border flex flex-col md:flex-row items-center justify-between gap-4">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Info className="w-4 h-4 text-primary" />
                                            <span className="text-sm font-medium">Inward Goods Discrepancy Guard</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground max-w-xl">
                                            When items are received (via barcode scan or bulk Excel upload using PO Ref <span className="font-mono text-primary font-semibold">{poReference}</span>), any deviation between inward stock cost and the budgeted ₹{budgetAmount.toLocaleString('en-IN')} will trigger a strict approval gate.
                                        </p>
                                    </div>

                                    <div className="w-full md:w-64 space-y-1.5 text-sm font-mono border-t md:border-t-0 md:border-l border-border md:pl-5 pt-3 md:pt-0">
                                        <div className="flex justify-between text-muted-foreground text-xs">
                                            <span>Budget Stock:</span>
                                            <span>{formatINR(budgetAmount)}</span>
                                        </div>
                                        <div className="flex justify-between text-muted-foreground text-xs">
                                            <span>GST Paid:</span>
                                            <span>{formatINR(gstPaidOverhead)}</span>
                                        </div>
                                        <div className="flex justify-between text-muted-foreground text-xs">
                                            <span>Shipping:</span>
                                            <span>{formatINR(shippingOverhead)}</span>
                                        </div>
                                        <div className="flex justify-between text-foreground font-bold text-base pt-1.5 border-t border-border">
                                            <span>Total Outlay:</span>
                                            <span className="text-primary font-bold">{formatINR(budgetAmount + gstPaidOverhead + shippingOverhead - discountAmount)}</span>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="bg-card border-border">
                        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <span>Order Items</span>
                                    <Badge variant="outline" className="font-mono text-xs">
                                        {items.length} {items.length === 1 ? 'Item' : 'Items'}
                                    </Badge>
                                </CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Add items from catalog or create fresh uncataloged vendor items directly.
                                </p>
                            </div>

                            {/* Item Actions Toolbar */}
                            <div className="flex items-center gap-2 flex-wrap">
                                {/* Search Catalog Popover */}
                                <div className="relative">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setShowProductSearch(!showProductSearch)}
                                        className="h-8 text-xs border-border/80"
                                    >
                                        <Search className="w-3.5 h-3.5 mr-1.5 text-primary" />
                                        Search Catalog
                                    </Button>
                                    {showProductSearch && (
                                        <div className="absolute right-0 top-full mt-2 w-88 bg-surface-navy border border-surface-hover/80 rounded-xl shadow-2xl z-50 overflow-hidden">
                                            <div className="p-3 border-b border-surface-hover/50 bg-bg-navy/60">
                                                <div className="relative">
                                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-moonstone" />
                                                    <Input
                                                        autoFocus
                                                        placeholder="Search catalog by name or SKU..."
                                                        value={productSearch}
                                                        onChange={(e) => setProductSearch(e.target.value)}
                                                        className="pl-9 h-8 text-xs bg-bg-navy border-surface-hover text-white"
                                                    />
                                                </div>
                                            </div>
                                            <div className="max-h-60 overflow-y-auto divide-y divide-surface-hover/30">
                                                {filteredProducts.length === 0 ? (
                                                    <div className="p-4 text-center text-xs text-moonstone">
                                                        No existing products matched &ldquo;{productSearch}&rdquo;.
                                                    </div>
                                                ) : (
                                                    filteredProducts.slice(0, 8).map((v) => (
                                                        <div
                                                            key={v.id}
                                                            className="p-2.5 hover:bg-surface-hover/50 cursor-pointer text-xs transition-colors"
                                                            onClick={() => addCatalogItem(v)}
                                                        >
                                                            <div className="font-medium text-white flex items-center justify-between">
                                                                <span>{v.product.name}</span>
                                                                <span className="font-mono text-champagne text-[11px]">
                                                                    ₹{v.product.base_price}
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] text-moonstone font-mono mt-0.5">
                                                                {v.variant_name} ({v.product.sku}-{v.sku_suffix})
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            {/* Quick Actions at bottom of Search Dropdown */}
                                            <div className="p-2 border-t border-surface-hover/50 bg-bg-navy/80 space-y-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => addCustomItem(productSearch)}
                                                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-amber-400 hover:bg-amber-500/10 flex items-center justify-between transition-colors"
                                                >
                                                    <span className="truncate">
                                                        + Add &ldquo;{productSearch || "new item"}&rdquo; as unlisted line
                                                    </span>
                                                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 shrink-0 ml-1">
                                                        Uncataloged
                                                    </Badge>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openRegisterProductModal(undefined, productSearch)}
                                                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-primary hover:bg-primary/10 flex items-center justify-between transition-colors"
                                                >
                                                    <span className="truncate">
                                                        + Register &ldquo;{productSearch || "new item"}&rdquo; to catalog now
                                                    </span>
                                                    <Sparkles className="size-3 text-primary shrink-0 ml-1" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Direct Add Custom Line Button */}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => addCustomItem()}
                                    className="h-8 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                                >
                                    <FilePlus2 className="w-3.5 h-3.5 mr-1 text-amber-400" />
                                    + Add Custom Line
                                </Button>

                                {/* Quick New Product Modal Button */}
                                <Button
                                    size="sm"
                                    onClick={() => openRegisterProductModal()}
                                    className="h-8 text-xs bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold"
                                >
                                    <PackagePlus className="w-3.5 h-3.5 mr-1" />
                                    + New Product
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-border">
                                        <TableHead className="w-10">#</TableHead>
                                        <TableHead>Item & Catalog Status</TableHead>
                                        <TableHead className="w-24">Unit</TableHead>
                                        <TableHead className="w-20">Qty</TableHead>
                                        <TableHead className="w-28">Unit Cost (₹)</TableHead>
                                        <TableHead className="w-20">GST %</TableHead>
                                        <TableHead className="w-24 text-right">Total (₹)</TableHead>
                                        <TableHead className="w-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                                                <div className="space-y-2">
                                                    <PackagePlus className="size-8 mx-auto text-muted-foreground/40" />
                                                    <p className="text-sm">No items in this purchase order yet.</p>
                                                    <div className="flex items-center justify-center gap-2 pt-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => setShowProductSearch(true)}
                                                            className="text-xs"
                                                        >
                                                            <Search className="size-3.5 mr-1" /> Search Catalog
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => addCustomItem()}
                                                            className="text-xs text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
                                                        >
                                                            <FilePlus2 className="size-3.5 mr-1" /> Add Unlisted Item
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            onClick={() => openRegisterProductModal()}
                                                            className="text-xs bg-amber-500 hover:bg-amber-600 text-white"
                                                        >
                                                            <PackagePlus className="size-3.5 mr-1" /> Register New Product
                                                        </Button>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        items.map((item, index) => {
                                            const isLinked = Boolean(item.variant_id);
                                            const variantSku = item.variant?.product?.sku
                                                ? (item.variant.sku_suffix ? `${item.variant.product.sku}-${item.variant.sku_suffix}` : item.variant.product.sku)
                                                : null;

                                            return (
                                                <TableRow key={index} className="border-border">
                                                    <TableCell className="text-muted-foreground text-xs font-mono">
                                                        {index + 1}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="space-y-1">
                                                            <Input
                                                                value={item.description}
                                                                onChange={(e) => updateItem(index, "description", e.target.value)}
                                                                placeholder="Item description / jewelry name"
                                                                className="h-8 text-sm"
                                                            />
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {isLinked ? (
                                                                    <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono">
                                                                        <Package className="size-2.5 mr-1" />
                                                                        Catalog: {variantSku || 'Linked SKU'}
                                                                    </Badge>
                                                                ) : (
                                                                    <>
                                                                        <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px]">
                                                                            <Sparkles className="size-2.5 mr-1" />
                                                                            Fresh Vendor Item (Uncataloged)
                                                                        </Badge>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => openRegisterProductModal(index)}
                                                                            className="text-[10px] text-amber-400 hover:text-amber-300 underline font-medium"
                                                                        >
                                                                            + Register in Catalog
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Select
                                                            value={item.unit || "PCS"}
                                                            onValueChange={(val) => val && updateItem(index, "unit", val)}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="PCS">PCS</SelectItem>
                                                                <SelectItem value="GMS">GMS</SelectItem>
                                                                <SelectItem value="SET">SET</SelectItem>
                                                                <SelectItem value="PAIR">PAIR</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Input
                                                            type="number"
                                                            min="1"
                                                            value={item.quantity_ordered}
                                                            onChange={(e) => updateItem(index, "quantity_ordered", parseInt(e.target.value) || 1)}
                                                            className="h-8 font-mono text-center"
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={item.unit_price}
                                                            onChange={(e) => updateItem(index, "unit_price", parseFloat(e.target.value) || 0)}
                                                            className="h-8 font-mono"
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            max="28"
                                                            value={item.gst_rate}
                                                            onChange={(e) => updateItem(index, "gst_rate", parseFloat(e.target.value) || 0)}
                                                            className="h-8 font-mono text-center"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono font-semibold">
                                                        {formatINR(item.total_price)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-red-400 hover:bg-red-500/10"
                                                            onClick={() => removeItem(index)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
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
                    )}

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
                                    placeholder="Special procurement instructions..."
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
                            disabled={loading || (poType === 'blanket' ? (!vendorId || budgetAmount <= 0) : items.length === 0)}
                            className=""
                        >
                            <Send className="w-4 h-4 mr-2" />
                            {loading
                                ? "Creating..."
                                : poType === 'blanket'
                                ? "Create Blanket PO"
                                : "Create & Send PO"}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Quick Product Modal for new vendor items */}
            <QuickProductModal
                isOpen={showQuickProductModal}
                onClose={() => setShowQuickProductModal(false)}
                onSuccess={handleQuickProductSuccess}
                initialData={quickProductInitial}
            />
        </div>
    );
}
