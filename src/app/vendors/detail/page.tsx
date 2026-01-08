"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    ArrowLeft,
    Phone,
    Mail,
    MapPin,
    Package,
    Plus,
    Trash2,
    Edit,
    Clock,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    getVendor,
    updateVendor,
    addVendorProduct,
    removeVendorProduct,
    type VendorWithProducts,
} from "@/lib/vendors";
import { formatINR } from "@/lib/gst";
import { pb } from "@/lib/pocketbase";

interface ProductVariant {
    id: string;
    variant_name: string;
    sku_suffix: string;
    product: {
        id: string;
        name: string;
        sku: string;
    };
}

function VendorDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const vendorId = searchParams.get("id");

    const [vendor, setVendor] = useState<VendorWithProducts | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAddProduct, setShowAddProduct] = useState(false);
    const [availableProducts, setAvailableProducts] = useState<ProductVariant[]>([]);
    const [selectedVariant, setSelectedVariant] = useState("");
    const [vendorSku, setVendorSku] = useState("");
    const [vendorPrice, setVendorPrice] = useState("");
    const [leadTime, setLeadTime] = useState("7");
    const [addingProduct, setAddingProduct] = useState(false);

    // Edit vendor state
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [editForm, setEditForm] = useState({
        name: '',
        contact_name: '',
        phone: '',
        email: '',
        address: '',
        gstin: '',
        pan: '',
        payment_terms: '',
        notes: ''
    });
    const [saving, setSaving] = useState(false);

    const fetchVendor = async () => {
        if (!vendorId) return;
        setLoading(true);
        const data = await getVendor(vendorId);
        setVendor(data);
        setLoading(false);
    };

    const fetchProducts = async () => {
        try {
            const variants = await pb.collection('product_variants').getFullList({
                sort: 'variant_name',
                expand: 'product',
            });

            const mappedIds = vendor?.vendor_products?.map((vp) => vp.variant) || [];
            const available: ProductVariant[] = variants
                .filter((v: any) => !mappedIds.includes(v.id))
                .map((v: any) => ({
                    id: v.id,
                    variant_name: v.variant_name,
                    sku_suffix: v.sku_suffix,
                    product: v.expand?.product ? {
                        id: v.expand.product.id,
                        name: v.expand.product.name,
                        sku: v.expand.product.sku,
                    } : { id: '', name: '', sku: '' },
                }));
            setAvailableProducts(available);
        } catch (e) {
            console.error('Failed to load products:', e);
        }
    };

    useEffect(() => {
        fetchVendor();
    }, [vendorId]);

    useEffect(() => {
        if (showAddProduct && vendor) {
            fetchProducts();
        }
    }, [showAddProduct, vendor]);

    const handleAddProduct = async () => {
        if (!selectedVariant || !vendorId) {
            alert("Please select a product");
            return;
        }

        setAddingProduct(true);
        try {
            await addVendorProduct({
                vendor_id: vendorId,
                variant_id: selectedVariant,
                vendor_sku: vendorSku || undefined,
                vendor_price: vendorPrice ? parseFloat(vendorPrice) : undefined,
                lead_time_days: parseInt(leadTime) || 7,
            });

            // Reset form
            setSelectedVariant("");
            setVendorSku("");
            setVendorPrice("");
            setLeadTime("7");
            setShowAddProduct(false);

            // Refresh vendor data
            fetchVendor();
        } catch (error) {
            console.error("Error adding product:", error);
            alert("Failed to add product. It may already be linked.");
        } finally {
            setAddingProduct(false);
        }
    };

    const openEditDialog = () => {
        if (!vendor) return;
        setEditForm({
            name: vendor.name || '',
            contact_name: vendor.contact_name || '',
            phone: vendor.phone || '',
            email: vendor.email || '',
            address: vendor.address || '',
            gstin: vendor.gstin || '',
            pan: vendor.pan || '',
            payment_terms: vendor.payment_terms || '',
            notes: vendor.notes || ''
        });
        setShowEditDialog(true);
    };

    const handleUpdateVendor = async () => {
        if (!vendorId || !editForm.name.trim()) {
            alert('Vendor name is required');
            return;
        }
        setSaving(true);
        try {
            await updateVendor(vendorId, {
                name: editForm.name.trim(),
                contact_name: editForm.contact_name.trim() || null,
                phone: editForm.phone.trim() || null,
                email: editForm.email.trim() || null,
                address: editForm.address.trim() || null,
                gstin: editForm.gstin.trim() || undefined,
                pan: editForm.pan.trim() || undefined,
                payment_terms: editForm.payment_terms.trim() || undefined,
                notes: editForm.notes.trim() || undefined
            });
            setShowEditDialog(false);
            fetchVendor();
        } catch (error) {
            console.error('Error updating vendor:', error);
            alert('Failed to update vendor');
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveProduct = async (vpId: string) => {
        if (!confirm("Remove this product from vendor?")) return;

        try {
            await removeVendorProduct(vpId);
            fetchVendor();
        } catch (error) {
            console.error("Error removing product:", error);
        }
    };

    if (!vendorId) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-muted-foreground">Invalid Vendor ID</div>
                <Button variant="outline" onClick={() => router.push("/vendors")}>
                    Back to Vendors
                </Button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-muted-foreground">Loading vendor...</div>
            </div>
        );
    }

    if (!vendor) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-muted-foreground">Vendor not found</div>
                <Button variant="outline" onClick={() => router.push("/vendors")}>
                    Back to Vendors
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title={vendor.name} subtitle={vendor.contact_name || "Vendor"} />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Back Button */}
                    <Button variant="ghost" onClick={() => router.push("/vendors")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Vendors
                    </Button>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Vendor Info Card */}
                        <Card className="bg-card/50 border-border/50">
                            <CardHeader>
                                <CardTitle className="flex items-center justify-between">
                                    <span>Contact Information</span>
                                    <Button variant="ghost" size="icon" onClick={openEditDialog}>
                                        <Edit className="w-4 h-4" />
                                    </Button>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-full bg-champagne/20 flex items-center justify-center">
                                        <span className="text-champagne font-semibold text-lg">
                                            {vendor.name.charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">{vendor.name}</h3>
                                        {vendor.contact_name && (
                                            <p className="text-sm text-muted-foreground">
                                                {vendor.contact_name}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-3 pt-4 border-t border-border/50">
                                    {vendor.phone && (
                                        <div className="flex items-center gap-3 text-sm">
                                            <Phone className="w-4 h-4 text-muted-foreground" />
                                            <a
                                                href={`tel:${vendor.phone}`}
                                                className="hover:text-champagne"
                                            >
                                                {vendor.phone}
                                            </a>
                                        </div>
                                    )}
                                    {vendor.email && (
                                        <div className="flex items-center gap-3 text-sm">
                                            <Mail className="w-4 h-4 text-muted-foreground" />
                                            <a
                                                href={`mailto:${vendor.email}`}
                                                className="hover:text-champagne"
                                            >
                                                {vendor.email}
                                            </a>
                                        </div>
                                    )}
                                    {vendor.address && (
                                        <div className="flex items-start gap-3 text-sm">
                                            <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                                            <span className="text-muted-foreground">
                                                {vendor.address}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Products Card */}
                        <Card className="bg-card/50 border-border/50 lg:col-span-2">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <Package className="w-5 h-5" />
                                    Linked Products
                                </CardTitle>
                                <Button
                                    size="sm"
                                    onClick={() => setShowAddProduct(true)}
                                    className="bg-champagne text-midnight hover:bg-champagne/90"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Add Product
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {vendor.vendor_products?.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">
                                        No products linked to this vendor yet.
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-border/50">
                                                <TableHead>Product</TableHead>
                                                <TableHead>Vendor SKU</TableHead>
                                                <TableHead className="text-right">Price</TableHead>
                                                <TableHead className="text-center">Lead Time</TableHead>
                                                <TableHead className="w-10"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {vendor.vendor_products?.map((vp) => (
                                                <TableRow key={vp.id} className="border-border/50">
                                                    <TableCell>
                                                        <div>
                                                            <p className="font-medium">
                                                                {vp.expand?.variant?.expand?.product?.name}
                                                            </p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {vp.expand?.variant?.variant_name} (
                                                                {vp.expand?.variant?.expand?.product?.sku}-{vp.expand?.variant?.sku_suffix})
                                                            </p>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-muted-foreground">
                                                        {vp.vendor_sku || "-"}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono">
                                                        {vp.vendor_price ? formatINR(vp.vendor_price) : "-"}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <div className="flex items-center justify-center gap-1 text-muted-foreground">
                                                            <Clock className="w-3 h-3" />
                                                            <span>{vp.lead_time_days} days</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="text-red-400 hover:text-red-300"
                                                            onClick={() => handleRemoveProduct(vp.id)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            {/* Add Product Dialog */}
            <Dialog open={showAddProduct} onOpenChange={setShowAddProduct}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Product to Vendor</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Select Product *</Label>
                            <Select value={selectedVariant} onValueChange={(v) => v && setSelectedVariant(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableProducts.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.product.name} - {p.variant_name} ({p.product.sku}-
                                            {p.sku_suffix})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Vendor SKU</Label>
                                <Input
                                    value={vendorSku}
                                    onChange={(e) => setVendorSku(e.target.value)}
                                    placeholder="Vendor's product code"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Vendor Price (₹)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={vendorPrice}
                                    onChange={(e) => setVendorPrice(e.target.value)}
                                    placeholder="Cost price"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Lead Time (Days)</Label>
                            <Input
                                type="number"
                                min="1"
                                value={leadTime}
                                onChange={(e) => setLeadTime(e.target.value)}
                                placeholder="Days to fulfill"
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowAddProduct(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleAddProduct}
                                disabled={addingProduct || !selectedVariant}
                                className="bg-champagne text-midnight hover:bg-champagne/90"
                            >
                                {addingProduct ? "Adding..." : "Add Product"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Edit Vendor Dialog */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Vendor</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                        <div className="space-y-2">
                            <Label>Vendor Name *</Label>
                            <Input
                                value={editForm.name}
                                onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Company / Vendor name"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Contact Person</Label>
                                <Input
                                    value={editForm.contact_name}
                                    onChange={(e) => setEditForm(f => ({ ...f, contact_name: e.target.value }))}
                                    placeholder="Contact name"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={editForm.phone}
                                    onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))}
                                    placeholder="+91 98765 43210"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                                type="email"
                                value={editForm.email}
                                onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))}
                                placeholder="vendor@example.com"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Input
                                value={editForm.address}
                                onChange={(e) => setEditForm(f => ({ ...f, address: e.target.value }))}
                                placeholder="Full address"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>GSTIN</Label>
                                <Input
                                    value={editForm.gstin}
                                    onChange={(e) => setEditForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                                    placeholder="22AAAAA0000A1Z5"
                                    maxLength={15}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>PAN</Label>
                                <Input
                                    value={editForm.pan}
                                    onChange={(e) => setEditForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))}
                                    placeholder="AAAAA0000A"
                                    maxLength={10}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Payment Terms</Label>
                            <Input
                                value={editForm.payment_terms}
                                onChange={(e) => setEditForm(f => ({ ...f, payment_terms: e.target.value }))}
                                placeholder="e.g., Net 30, COD"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Notes</Label>
                            <Input
                                value={editForm.notes}
                                onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="Additional notes..."
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleUpdateVendor}
                                disabled={saving || !editForm.name.trim()}
                                className="bg-champagne text-midnight hover:bg-champagne/90"
                            >
                                {saving ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function VendorDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
            <VendorDetailContent />
        </Suspense>
    );
}
