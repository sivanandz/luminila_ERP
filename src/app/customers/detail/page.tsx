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
    MessageCircle,
    Sparkles,
    Calendar,
    Package,
    ArrowUpRight,
    Loader2,
    ExternalLink,
    Tag,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { pb } from "@/lib/pocketbase";

import {
    getCustomer,
    updateCustomer,
    deleteCustomer,
    type Customer,
    type CustomerType,
} from "@/lib/customers";
import { formatINR } from "@/lib/gst";

const typeConfig: Record<CustomerType, { label: string; color: string }> = {
    retail: { label: "Retail", color: "bg-blue-500/20 text-blue-400" },
    wholesale: { label: "Wholesale", color: "bg-green-500/20 text-green-400" },
    vip: { label: "VIP", color: "bg-amber-500/20 text-amber-400" },
};

interface CustomerOrderHistoryItem {
    id: string;
    order_number: string;
    total: number;
    status: string;
    channel: string;
    date: string;
}

function CustomerDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const id = searchParams.get("id");

    const [customer, setCustomer] = useState<Customer | null>(null);
    const [loading, setLoading] = useState(true);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    // Live Orders & Interactions
    const [orders, setOrders] = useState<CustomerOrderHistoryItem[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [activeCustomerTab, setActiveCustomerTab] = useState<"orders" | "history">("orders");

    // Edit form state
    const [editForm, setEditForm] = useState({
        name: "",
        phone: "",
        email: "",
        customer_type: "retail" as CustomerType,
        gstin: "",
        address: "",
        ring_size: "",
        bangle_size: "",
        preferred_metal: "Rose Gold",
        date_of_birth: "",
        anniversary: "",
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
                ring_size: (data as any).ring_size || "",
                bangle_size: (data as any).bangle_size || "",
                preferred_metal: (data as any).preferred_metal || "Rose Gold",
                date_of_birth: data.date_of_birth || (data as any).birthday_date || "",
                anniversary: data.anniversary || (data as any).anniversary_date || "",
            });

            // Fetch live order history from sales and sales_orders
            setLoadingOrders(true);
            try {
                const [salesRes, ordersRes] = await Promise.all([
                    pb.collection("sales").getList(1, 25, {
                        filter: `customer="${id}" || customer_phone="${data.phone}"`,
                        sort: "-created",
                    }).catch(() => ({ items: [] })),
                    pb.collection("sales_orders").getList(1, 25, {
                        filter: `customer="${id}" || customer_phone="${data.phone}"`,
                        sort: "-created",
                    }).catch(() => ({ items: [] })),
                ]);

                const historyItems: CustomerOrderHistoryItem[] = [
                    ...salesRes.items.map((s: any) => ({
                        id: s.id,
                        order_number: s.channel_order_id || `SALE-${s.id.slice(0, 6).toUpperCase()}`,
                        total: Number(s.total) || 0,
                        status: s.status || "confirmed",
                        channel: s.channel || "pos",
                        date: s.created,
                    })),
                    ...ordersRes.items.map((o: any) => ({
                        id: o.id,
                        order_number: o.order_number || `ORD-${o.id.slice(0, 6).toUpperCase()}`,
                        total: Number(o.total) || 0,
                        status: o.status || "draft",
                        channel: o.order_type || "sales_order",
                        date: o.order_date || o.created,
                    })),
                ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                setOrders(historyItems);
            } catch (err) {
                console.warn("Could not load customer purchase records:", err);
            } finally {
                setLoadingOrders(false);
            }
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
                shipping_address: editForm.address || undefined,
                date_of_birth: editForm.date_of_birth || undefined,
                anniversary: editForm.anniversary || undefined,
            });

            // Also patch jewelry CRM fields into record
            try {
                await pb.collection("customers").update(id, {
                    ring_size: editForm.ring_size || null,
                    bangle_size: editForm.bangle_size || null,
                    preferred_metal: editForm.preferred_metal || null,
                    birthday_date: editForm.date_of_birth || null,
                    anniversary_date: editForm.anniversary || null,
                });
            } catch {
                // ignore
            }

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
        try {
            await deleteCustomer(id);
            router.push("/customers");
        } catch (error) {
            console.error("Error deleting:", error);
            alert("Failed to delete customer");
        }
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!customer) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <p className="text-muted-foreground mb-4">Customer not found</p>
                <Button onClick={() => router.push("/customers")}>Back to Customers</Button>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-background">
            <Header
                title={customer.name}
                subtitle="Customer 360° Profile & Lifetime Value"
                action={
                    <div className="flex items-center gap-2">
                        {customer.phone && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push(`/whatsapp?chatId=${encodeURIComponent(customer.phone!)}`)}
                                className="h-9 gap-1.5 font-bold text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 shadow-sm"
                            >
                                <MessageCircle className="w-4 h-4" /> Chat on WhatsApp
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowEditDialog(true)}
                            className="h-9 gap-1.5 text-xs font-semibold"
                        >
                            <Edit className="w-3.5 h-3.5" /> Edit Profile
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowDeleteDialog(true)}
                            className="h-9 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Back link */}
                    <div>
                        <Button variant="ghost" size="sm" onClick={() => router.push("/customers")} className="text-xs text-muted-foreground gap-1.5">
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to Customers Directory
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Sidebar Info */}
                        <div className="space-y-6">
                            {/* Contact Card */}
                            <Card className="bg-card border-border shadow-sm">
                                <CardHeader className="pb-3">
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-sm font-bold">Contact Info</CardTitle>
                                        <Badge className={(typeConfig[customer.customer_type] || typeConfig.retail).color}>
                                            {(typeConfig[customer.customer_type] || typeConfig.retail).label}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2.5">
                                        {customer.phone && (
                                            <div className="flex items-center gap-3 text-xs">
                                                <Phone className="w-4 h-4 text-muted-foreground" />
                                                <a href={`tel:${customer.phone}`} className="hover:text-primary transition-colors font-mono font-semibold">
                                                    {customer.phone}
                                                </a>
                                            </div>
                                        )}
                                        {customer.email && (
                                            <div className="flex items-center gap-3 text-xs">
                                                <Mail className="w-4 h-4 text-muted-foreground" />
                                                <a href={`mailto:${customer.email}`} className="hover:text-primary transition-colors">
                                                    {customer.email}
                                                </a>
                                            </div>
                                        )}
                                    </div>

                                    {(customer.billing_address || customer.gstin) && (
                                        <div className="pt-3 border-t border-border space-y-2 text-xs">
                                            {customer.gstin && (
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">GSTIN</p>
                                                    <p className="font-mono">{customer.gstin}</p>
                                                </div>
                                            )}
                                            {customer.billing_address && (
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Address</p>
                                                    <p className="text-muted-foreground whitespace-pre-line">{customer.billing_address}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Jewelry Specs & Preferences */}
                            <Card className="bg-card border-border shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-primary" /> Jewelry Specifications
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-xs">
                                    <div className="flex justify-between items-center py-1 border-b border-border">
                                        <span className="text-muted-foreground">Ring Size</span>
                                        <span className="font-bold text-foreground">{(customer as any).ring_size || "Not set"}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-1 border-b border-border">
                                        <span className="text-muted-foreground">Bangle Size</span>
                                        <span className="font-bold text-foreground">{(customer as any).bangle_size || "Not set"}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-1 border-b border-border">
                                        <span className="text-muted-foreground">Preferred Metal</span>
                                        <span className="font-bold text-primary">{(customer as any).preferred_metal || "Rose Gold"}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-1 border-b border-border">
                                        <span className="text-muted-foreground">Date of Birth</span>
                                        <span className="font-semibold text-foreground">
                                            {customer.date_of_birth || (customer as any).birthday_date || "—"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center py-1">
                                        <span className="text-muted-foreground">Anniversary</span>
                                        <span className="font-semibold text-foreground">
                                            {customer.anniversary || (customer as any).anniversary_date || "—"}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Financial Summary */}
                            <Card className="bg-card border-border shadow-sm">
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
                                        <p className="text-xs text-muted-foreground">Loyalty Points</p>
                                        <p className="text-lg font-bold text-amber-500">
                                            {customer.loyalty_points || 0} pts
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Store Credit</p>
                                        <p className="text-lg font-mono text-emerald-500">
                                            {formatINR(customer.store_credit || 0)}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Main Interaction Area */}
                        <div className="lg:col-span-2 space-y-4">
                            <Tabs value={activeCustomerTab} onValueChange={(v) => setActiveCustomerTab(v as any)}>
                                {/* Mobile / Narrow Viewport: Dropdown */}
                                <div className="block sm:hidden w-full mb-3">
                                    <Select value={activeCustomerTab} onValueChange={(v) => v && setActiveCustomerTab(v as any)}>
                                        <SelectTrigger className="w-full h-10 bg-card border-border text-xs font-semibold px-3 rounded-xl flex items-center justify-between shadow-xs">
                                            <div className="flex items-center gap-2">
                                                {activeCustomerTab === "orders" ? (
                                                    <>
                                                        <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                                                        <span className="font-semibold text-xs text-foreground">Purchase History ({orders.length})</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <History className="w-3.5 h-3.5 text-primary" />
                                                        <span className="font-semibold text-xs text-foreground">Notes &amp; Activity</span>
                                                    </>
                                                )}
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent className="bg-popover border-border">
                                            <SelectItem value="orders" className="text-xs font-medium py-2">
                                                <div className="flex items-center gap-2">
                                                    <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                                                    <span>Purchase History ({orders.length})</span>
                                                </div>
                                            </SelectItem>
                                            <SelectItem value="history" className="text-xs font-medium py-2">
                                                <div className="flex items-center gap-2">
                                                    <History className="w-3.5 h-3.5 text-primary" />
                                                    <span>Notes &amp; Activity</span>
                                                </div>
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="hidden sm:inline-flex">
                                    <TabsList className="bg-card border border-border">
                                        <TabsTrigger value="orders" className="text-xs font-semibold gap-1.5">
                                            <ShoppingBag className="w-3.5 h-3.5" /> Purchase History ({orders.length})
                                        </TabsTrigger>
                                        <TabsTrigger value="history" className="text-xs font-semibold gap-1.5">
                                            <History className="w-3.5 h-3.5" /> Notes &amp; Activity
                                        </TabsTrigger>
                                    </TabsList>
                                </div>

                                <TabsContent value="orders" className="mt-4">
                                    <Card className="bg-card border-border shadow-sm">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-sm font-bold flex items-center justify-between">
                                                <span>Orders &amp; Sales Invoices</span>
                                                <span className="text-xs text-muted-foreground font-normal">Real-time sync across POS and WhatsApp</span>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {loadingOrders ? (
                                                <div className="py-8 text-center text-muted-foreground">
                                                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
                                                    Loading purchase records...
                                                </div>
                                            ) : orders.length === 0 ? (
                                                <div className="text-center py-8 text-muted-foreground text-xs">
                                                    No past orders recorded for this customer.
                                                </div>
                                            ) : (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-left text-xs">
                                                        <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] border-b border-border">
                                                            <tr>
                                                                <th className="py-2.5 px-3">Order Number</th>
                                                                <th className="py-2.5 px-3">Date</th>
                                                                <th className="py-2.5 px-3">Channel</th>
                                                                <th className="py-2.5 px-3">Total Amount</th>
                                                                <th className="py-2.5 px-3 text-right">Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border">
                                                            {orders.map((ord) => (
                                                                <tr key={ord.id} className="hover:bg-muted/20">
                                                                    <td className="py-2.5 px-3 font-mono font-bold text-foreground">
                                                                        {ord.order_number}
                                                                    </td>
                                                                    <td className="py-2.5 px-3 text-muted-foreground">
                                                                        {ord.date ? format(new Date(ord.date), "dd MMM yyyy") : "—"}
                                                                    </td>
                                                                    <td className="py-2.5 px-3">
                                                                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                                                            {ord.channel}
                                                                        </Badge>
                                                                    </td>
                                                                    <td className="py-2.5 px-3 font-bold text-foreground">
                                                                        {formatINR(ord.total)}
                                                                    </td>
                                                                    <td className="py-2.5 px-3 text-right">
                                                                        <Badge variant="secondary" className="text-[10px] capitalize">
                                                                            {ord.status}
                                                                        </Badge>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="history" className="mt-4">
                                    <Card className="bg-card border-border shadow-sm">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-sm font-bold">Customer Notes &amp; Timeline</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="p-4 rounded-xl bg-muted/30 border border-border text-xs text-muted-foreground">
                                                {customer.notes ? (
                                                    <p className="whitespace-pre-line text-foreground">{customer.notes}</p>
                                                ) : (
                                                    <p className="italic">No customer notes recorded yet.</p>
                                                )}
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
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit Customer 360° Profile</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Name *</Label>
                            <Input
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                className="h-9 text-xs"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Phone</Label>
                                <Input
                                    value={editForm.phone}
                                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Email</Label>
                                <Input
                                    value={editForm.email}
                                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Type</Label>
                                <Select
                                    value={editForm.customer_type}
                                    onValueChange={(v) => setEditForm({ ...editForm, customer_type: v as CustomerType })}
                                >
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="retail">Retail</SelectItem>
                                        <SelectItem value="wholesale">Wholesale</SelectItem>
                                        <SelectItem value="vip">VIP</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Ring Size</Label>
                                <Input
                                    value={editForm.ring_size}
                                    onChange={(e) => setEditForm({ ...editForm, ring_size: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Metal</Label>
                                <Select
                                    value={editForm.preferred_metal}
                                    onValueChange={(v) => setEditForm({ ...editForm, preferred_metal: v || "Rose Gold" })}
                                >
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Rose Gold">Rose Gold</SelectItem>
                                        <SelectItem value="Yellow Gold">Yellow Gold</SelectItem>
                                        <SelectItem value="Platinum">Platinum</SelectItem>
                                        <SelectItem value="Silver">Silver</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Date of Birth</Label>
                                <Input
                                    type="date"
                                    value={editForm.date_of_birth}
                                    onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Anniversary</Label>
                                <Input
                                    type="date"
                                    value={editForm.anniversary}
                                    onChange={(e) => setEditForm({ ...editForm, anniversary: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Address</Label>
                            <Input
                                value={editForm.address}
                                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                                className="h-9 text-xs"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-border">
                            <Button variant="outline" size="sm" onClick={() => setShowEditDialog(false)} className="h-8 text-xs">
                                Cancel
                            </Button>
                            <Button size="sm" onClick={handleUpdate} disabled={saving} className="h-8 text-xs font-semibold">
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
                        <AlertDialogDescription className="text-xs">
                            Are you sure you want to delete {customer.name}? This will permanently remove their CRM profile.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="h-8 text-xs bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default function CustomerDetailPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div>}>
            <CustomerDetailContent />
        </Suspense>
    );
}
