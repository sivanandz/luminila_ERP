"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Phone,
    Mail,
    ShoppingBag,
    History,
    Edit,
    Trash2,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
    getCustomer,
    updateCustomer,
    deleteCustomer,
    type Customer,
    type CustomerType,
} from "@/lib/customers";
import { formatINR } from "@/lib/gst";

// Helper for type colors, reused from listing
const typeConfig: Record<CustomerType, { label: string; color: string }> = {
    retail: { label: "Retail", color: "bg-blue-500/20 text-blue-400" },
    wholesale: { label: "Wholesale", color: "bg-green-500/20 text-green-400" },
    vip: { label: "VIP", color: "bg-champagne/20 text-champagne" },
};

function CustomerDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get("id");

    const [customer, setCustomer] = useState<Customer | null>(null);
    const [loading, setLoading] = useState(true);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    // Edit form state
    const [editForm, setEditForm] = useState({
        name: "",
        phone: "",
        email: "",
        customer_type: "retail" as CustomerType,
        gstin: "",
        address: "",
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadCustomer();
    }, [id]);

    const loadCustomer = async () => {
        if (!id) return;
        setLoading(true);
        const data = await getCustomer(id);
        setCustomer(data);

        if (data) {
            setEditForm({
                name: data.name,
                phone: data.phone || "",
                email: data.email || "",
                customer_type: data.customer_type,
                gstin: data.gstin || "",
                address: data.billing_address || "",
            });
        }
        setLoading(false);
    };

    const handleUpdate = async () => {
        if (!id) return;
        if (!editForm.name.trim()) return alert("Name is required");

        setSaving(true);
        try {
            await updateCustomer(id, {
                name: editForm.name,
                phone: editForm.phone || undefined,
                email: editForm.email || undefined,
                customer_type: editForm.customer_type,
                gstin: editForm.gstin || undefined,
                billing_address: editForm.address || undefined,
                shipping_address: editForm.address || undefined, // Sync for now
            });
            setShowEditDialog(false);
            loadCustomer();
        } catch (error) {
            console.error("Error updating:", error);
            alert("Failed to update customer");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!id) return;
        setSaving(true);
        try {
            await deleteCustomer(id);
            router.push("/customers");
        } catch (error) {
            console.error("Error deleting:", error);
            alert("Failed to delete customer");
            setSaving(false);
        }
    };

    if (!id) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <p className="text-muted-foreground">Invalid Customer ID</p>
                <Button variant="link" onClick={() => router.push("/customers")}>
                    Back to Customers
                </Button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">Loading customer...</p>
            </div>
        );
    }

    if (!customer) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <p className="text-muted-foreground">Customer not found</p>
                <Button variant="link" onClick={() => router.push("/customers")}>
                    Back to Customers
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title={customer.name}
                subtitle={`Customer since ${customer.created ? format(new Date(customer.created), "MMM yyyy") : "-"}`}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Toolbar */}
                    <div className="flex justify-between items-center">
                        <Button variant="ghost" onClick={() => router.push("/customers")}>
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back
                        </Button>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setShowEditDialog(true)}
                            >
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                            </Button>
                            <Button
                                variant="ghost"
                                className="text-red-400 hover:text-red-300 hover:bg-red-900/10"
                                onClick={() => setShowDeleteDialog(true)}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Sidebar Info */}
                        <div className="space-y-6">
                            <Card className="bg-card border-border">
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-lg">Contact Info</CardTitle>
                                        <Badge className={typeConfig[customer.customer_type].color}>
                                            {typeConfig[customer.customer_type].label}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-3">
                                        {customer.phone && (
                                            <div className="flex items-center gap-3 text-sm">
                                                <Phone className="w-4 h-4 text-muted-foreground" />
                                                <a href={`tel:${customer.phone}`} className="hover:text-primary transition-colors">
                                                    {customer.phone}
                                                </a>
                                            </div>
                                        )}
                                        {customer.email && (
                                            <div className="flex items-center gap-3 text-sm">
                                                <Mail className="w-4 h-4 text-muted-foreground" />
                                                <a href={`mailto:${customer.email}`} className="hover:text-primary transition-colors">
                                                    {customer.email}
                                                </a>
                                            </div>
                                        )}
                                    </div>

                                    {(customer.billing_address || customer.gstin) && (
                                        <div className="pt-4 border-t border-border space-y-3">
                                            {customer.gstin && (
                                                <div>
                                                    <p className="text-xs text-muted-foreground">GSTIN</p>
                                                    <p className="font-mono text-sm">{customer.gstin}</p>
                                                </div>
                                            )}
                                            {customer.billing_address && (
                                                <div>
                                                    <p className="text-xs text-muted-foreground">Address</p>
                                                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                                                        {customer.billing_address}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Summary Stats */}
                            <Card className="bg-card border-border">
                                <CardContent className="pt-6 grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-muted-foreground">Total Spent</p>
                                        <p className="text-xl font-bold font-mono text-primary">
                                            {formatINR(customer.total_spent)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Total Orders</p>
                                        <p className="text-xl font-bold">{customer.total_orders}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Store Credit</p>
                                        <p className="text-lg font-mono text-green-400">
                                            {formatINR(customer.store_credit)}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Main Interaction Area */}
                        <div className="lg:col-span-2">
                            <Tabs defaultValue="orders">
                                <TabsList className="bg-card border border-border">
                                    <TabsTrigger value="orders">Orders</TabsTrigger>
                                    <TabsTrigger value="history">Interactions</TabsTrigger>
                                </TabsList>
                                <TabsContent value="orders" className="mt-4">
                                    <Card className="bg-card border-border">
                                        <CardHeader>
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <ShoppingBag className="w-5 h-5 text-primary" />
                                                Recent Orders
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {/* We can fetch orders here if we add that relation or api
                                                For now, placeholder or basic list if available on customer object
                                             */}
                                            <div className="text-center py-8 text-muted-foreground text-sm">
                                                Order history list will appear here.
                                                <br />
                                                (Integration pending with order table)
                                            </div>
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                                <TabsContent value="history" className="mt-4">
                                    <Card className="bg-card border-border">
                                        <CardHeader>
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <History className="w-5 h-5 text-primary" />
                                                History
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-center py-8 text-muted-foreground text-sm">
                                                Interaction logs (calls, emails, visits) will appear here.
                                            </div>
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                            </Tabs>
                        </div>
                    </div>
                </div>
            </div>

            {/* Edit Dialog */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Customer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Name *</Label>
                            <Input
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={editForm.phone}
                                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    value={editForm.email}
                                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select
                                value={editForm.customer_type}
                                onValueChange={(v) => setEditForm({ ...editForm, customer_type: v as CustomerType })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="retail">Retail</SelectItem>
                                    <SelectItem value="wholesale">Wholesale</SelectItem>
                                    <SelectItem value="vip">VIP</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>GSTIN</Label>
                            <Input
                                value={editForm.gstin}
                                onChange={(e) => setEditForm({ ...editForm, gstin: e.target.value.toUpperCase() })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Input
                                value={editForm.address}
                                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleUpdate} disabled={saving}>
                                {saving ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete Alert */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Customer?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete {customer.name}? This cannot be undone.
                            Note: You cannot delete customers with existing orders.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} disabled={saving} className="bg-red-600">
                            {saving ? "Deleting..." : "Delete Customer"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default function CustomerDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
            <CustomerDetailContent />
        </Suspense>
    );
}
