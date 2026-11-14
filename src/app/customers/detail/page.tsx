"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { safeFormatDate } from "@/lib/utils";
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
    Loader2,
    Crown,
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
import { Switch } from "@/components/ui/switch";
import { pb } from "@/lib/pocketbase";
import { getConsentState, recordConsentEvent } from "@/lib/consent-ledger";
import { toast } from "sonner";
import {
    getLoyaltyAccount,
    getTransactionHistory,
    adjustPoints,
    type LoyaltyAccount,
    type LoyaltyTransaction,
} from "@/lib/loyalty";


import {
    getCustomer,
    updateCustomer,
    deleteCustomer,
    type Customer,
    type CustomerType,
    getCustomerOrderHistory,
    updateCustomerJewelryProfile,
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

type CustomerTab = "orders" | "history" | "loyalty";

interface CustomerJewelryFields {
    ring_size?: string;
    bangle_size?: string;
    preferred_metal?: string;
    birthday_date?: string;
    anniversary_date?: string;
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
    const [activeCustomerTab, setActiveCustomerTab] = useState<"orders" | "history" | "loyalty">("orders");
    const [loyaltyAccount, setLoyaltyAccount] = useState<LoyaltyAccount | null>(null);
    const [loyaltyTransactions, setLoyaltyTransactions] = useState<LoyaltyTransaction[]>([]);
    const [loadingLoyalty, setLoadingLoyalty] = useState(false);
    const [adjustDelta, setAdjustDelta] = useState("");
    const [adjustReason, setAdjustReason] = useState("");
    const [adjustingPoints, setAdjustingPoints] = useState(false);

    // Edit form state
    const [editForm, setEditForm] = useState({
        name: "",
        phone: "",
        email: "",
        customer_type: "retail" as CustomerType,
        gstin: "",
        address: "",
        shipping_address: "",
        ring_size: "",
        bangle_size: "",
        preferred_metal: "Rose Gold",
        date_of_birth: "",
        anniversary: "",
        opt_in_marketing: true,
    });
    const [saving, setSaving] = useState(false);

    const refreshLoyalty = useCallback(async (customerId: string) => {
        setLoadingLoyalty(true);
        try {
            const [acc, txs] = await Promise.all([
                getLoyaltyAccount(customerId),
                getTransactionHistory(customerId, { limit: 50 }),
            ]);
            setLoyaltyAccount(acc);
            setLoyaltyTransactions(txs);
        } catch (err) {
            console.warn("Could not load loyalty ledger:", err);
        } finally {
            setLoadingLoyalty(false);
        }
    }, []);

    const loadCustomer = useCallback(async () => {
        // Without ?id= there is nothing to fetch — settle into the "not found" state
        // instead of leaving the page on a spinner forever.
        if (!id) {
            setCustomer(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        const data = await getCustomer(id);
        setCustomer(data);

        if (data) {
            const consentState = await getConsentState(pb, { customerId: data.id, phone: data.phone });
            const effectiveMarketingOptIn =
                consentState.marketing !== null
                    ? consentState.marketing
                    : (data as unknown as { opt_in_marketing?: boolean }).opt_in_marketing !== false;

            setEditForm({
                name: data.name,
                phone: data.phone || "",
                email: data.email || "",
                customer_type: data.customer_type,
                gstin: data.gstin || "",
                address: data.billing_address || "",
                shipping_address: data.shipping_address || "",
                ring_size: (data as unknown as CustomerJewelryFields).ring_size || "",
                bangle_size: (data as unknown as CustomerJewelryFields).bangle_size || "",
                preferred_metal: (data as unknown as CustomerJewelryFields).preferred_metal || "Rose Gold",
                date_of_birth: data.date_of_birth || (data as unknown as CustomerJewelryFields).birthday_date || "",
                anniversary: data.anniversary || (data as unknown as CustomerJewelryFields).anniversary_date || "",
                opt_in_marketing: effectiveMarketingOptIn,
            });

            // Fetch live order history from sales and sales_orders
            setLoadingOrders(true);
            try {
                setOrders(await getCustomerOrderHistory(id, data.phone));
            } catch (err) {
                console.warn("Could not load customer purchase records:", err);
            } finally {
                setLoadingOrders(false);
            }

            await refreshLoyalty(id);
        }
        setLoading(false);
    }, [id, refreshLoyalty]);

    useEffect(() => {
        void loadCustomer();
    }, [loadCustomer]);

    const handleAdjustPoints = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id) return;
        const delta = Math.trunc(Number(adjustDelta));
        if (!Number.isFinite(delta) || delta === 0) {
            toast.error("Enter a non-zero points adjustment (+ or -)");
            return;
        }
        if (!adjustReason.trim()) {
            toast.error("Enter a reason for the points adjustment");
            return;
        }
        setAdjustingPoints(true);
        try {
            await adjustPoints(id, delta, adjustReason.trim());
            toast.success(`Adjusted loyalty balance by ${delta > 0 ? `+${delta}` : delta} pts`);
            setAdjustDelta("");
            setAdjustReason("");
            await refreshLoyalty(id);
            const refreshed = await getCustomer(id);
            if (refreshed) setCustomer(refreshed);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to adjust loyalty points");
        } finally {
            setAdjustingPoints(false);
        }
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
                // Keep the shipping address separate; the old code overwrote it
                // with the billing address on every save (CRM-21).
                shipping_address: (editForm.shipping_address || editForm.address) || undefined,
                date_of_birth: editForm.date_of_birth || undefined,
                anniversary: editForm.anniversary || undefined,
            });

            // Also patch jewelry CRM fields & DPDP WhatsApp marketing consent into the record
            try {
                await updateCustomerJewelryProfile(id, {
                    ring_size: editForm.ring_size,
                    bangle_size: editForm.bangle_size,
                    preferred_metal: editForm.preferred_metal,
                    birthday_date: editForm.date_of_birth,
                    anniversary_date: editForm.anniversary,
                });
            } catch {
                // ignore
            }

            await recordConsentEvent(pb, {
                customerId: id,
                phone: editForm.phone || customer?.phone || undefined,
                channel: "pos",
                purpose: "marketing",
                granted: editForm.opt_in_marketing,
                source: "customer_profile_edit",
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
                    <div className="flex flex-wrap items-center gap-2">
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
                                            <div className="flex items-center gap-3 text-xs min-w-0">
                                                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                                                <a href={`mailto:${customer.email}`} className="hover:text-primary transition-colors min-w-0 break-all">
                                                    {customer.email}
                                                </a>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                                            <span className="text-muted-foreground">WhatsApp Offers</span>
                                            <Badge
                                                variant="outline"
                                                className={
                                                    editForm.opt_in_marketing
                                                        ? "text-[10px] border-emerald-500/40 text-emerald-500"
                                                        : "text-[10px] border-border text-muted-foreground"
                                                }
                                            >
                                                {editForm.opt_in_marketing ? "Opted in" : "Opted out"}
                                            </Badge>
                                        </div>
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
                                        <span className="font-bold text-foreground">{(customer as unknown as CustomerJewelryFields).ring_size || "Not set"}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-1 border-b border-border">
                                        <span className="text-muted-foreground">Bangle Size</span>
                                        <span className="font-bold text-foreground">{(customer as unknown as CustomerJewelryFields).bangle_size || "Not set"}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-1 border-b border-border">
                                        <span className="text-muted-foreground">Preferred Metal</span>
                                        <span className="font-bold text-primary">{(customer as unknown as CustomerJewelryFields).preferred_metal || "Rose Gold"}</span>
                                    </div>
                                    <div className="flex justify-between items-center py-1 border-b border-border">
                                        <span className="text-muted-foreground">Date of Birth</span>
                                        <span className="font-semibold text-foreground">
                                            {customer.date_of_birth || (customer as unknown as CustomerJewelryFields).birthday_date || "—"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center py-1">
                                        <span className="text-muted-foreground">Anniversary</span>
                                        <span className="font-semibold text-foreground">
                                            {customer.anniversary || (customer as unknown as CustomerJewelryFields).anniversary_date || "—"}
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
                                            {formatINR(
                                                (customer.total_spent && customer.total_spent > 0)
                                                    ? customer.total_spent
                                                    : orders.reduce((sum, o) => sum + (o.total || 0), 0)
                                            )}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">Total Orders</p>
                                        <p className="text-xl font-bold">
                                            {Math.max(customer.total_orders || 0, orders.length)}
                                        </p>
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
                            <Tabs value={activeCustomerTab} onValueChange={(v) => setActiveCustomerTab(v as CustomerTab)}>
                                {/* Mobile / Narrow Viewport: Dropdown */}
                                <div className="block sm:hidden w-full mb-3">
                                    <Select value={activeCustomerTab} onValueChange={(v) => v && setActiveCustomerTab(v as CustomerTab)}>
                                        <SelectTrigger className="w-full h-10 bg-card border-border text-xs font-semibold px-3 rounded-xl flex items-center justify-between shadow-xs">
                                            <div className="flex items-center gap-2">
                                                {activeCustomerTab === "orders" ? (
                                                    <>
                                                        <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                                                        <span className="font-semibold text-xs text-foreground">Purchase History ({orders.length})</span>
                                                    </>
                                                ) : activeCustomerTab === "loyalty" ? (
                                                    <>
                                                        <Crown className="w-3.5 h-3.5 text-amber-400" />
                                                        <span className="font-semibold text-xs text-foreground">Loyalty Ledger ({loyaltyTransactions.length})</span>
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
                                            <SelectItem value="loyalty" className="text-xs font-medium py-2">
                                                <div className="flex items-center gap-2">
                                                    <Crown className="w-3.5 h-3.5 text-amber-400" />
                                                    <span>Loyalty Ledger ({loyaltyTransactions.length})</span>
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
                                        <TabsTrigger value="loyalty" className="text-xs font-semibold gap-1.5">
                                            <Crown className="w-3.5 h-3.5 text-amber-400" /> Loyalty Ledger ({loyaltyTransactions.length})
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
                                                                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                                                                        {safeFormatDate(ord.date, (d) => format(d, "dd MMM yyyy"), "—")}
                                                                    </td>
                                                                    <td className="py-2.5 px-3">
                                                                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                                                            {ord.channel}
                                                                        </Badge>
                                                                    </td>
                                                                    <td className="py-2.5 px-3 font-bold text-foreground tabular-nums whitespace-nowrap">
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

                                <TabsContent value="loyalty" className="mt-4 space-y-4">
                                    <Card className="bg-card border-border shadow-sm">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-sm font-bold flex items-center justify-between">
                                                <span className="flex items-center gap-2">
                                                    <Crown className="w-4 h-4 text-amber-400" />
                                                    Loyalty Account Summary
                                                </span>
                                                {loyaltyAccount?.expand?.tier && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[11px]"
                                                        style={{
                                                            color: loyaltyAccount.expand.tier.color || undefined,
                                                            borderColor: loyaltyAccount.expand.tier.color || undefined,
                                                        }}
                                                    >
                                                        {loyaltyAccount.expand.tier.name} Tier ({loyaltyAccount.expand.tier.multiplier}x)
                                                    </Badge>
                                                )}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid grid-cols-3 gap-3 text-xs">
                                                <div className="rounded-lg border border-border p-3 bg-muted/20">
                                                    <div className="text-muted-foreground">Current Balance</div>
                                                    <div className="text-base font-bold font-mono text-amber-400 mt-0.5">
                                                        {loyaltyAccount?.current_balance ?? customer.loyalty_points ?? 0} pts
                                                    </div>
                                                </div>
                                                <div className="rounded-lg border border-border p-3 bg-muted/20">
                                                    <div className="text-muted-foreground">Lifetime Earned</div>
                                                    <div className="text-base font-bold font-mono mt-0.5">
                                                        {loyaltyAccount?.total_points_earned ?? 0} pts
                                                    </div>
                                                </div>
                                                <div className="rounded-lg border border-border p-3 bg-muted/20">
                                                    <div className="text-muted-foreground">Redeemed</div>
                                                    <div className="text-base font-bold font-mono mt-0.5">
                                                        {loyaltyAccount?.total_points_redeemed ?? 0} pts
                                                    </div>
                                                </div>
                                            </div>

                                            <form onSubmit={handleAdjustPoints} className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-border">
                                                <Input
                                                    type="number"
                                                    placeholder="Points (+/-)"
                                                    value={adjustDelta}
                                                    onChange={(e) => setAdjustDelta(e.target.value)}
                                                    className="h-9 text-xs font-mono"
                                                />
                                                <Input
                                                    placeholder="Adjustment reason (e.g. Goodwill credit)"
                                                    value={adjustReason}
                                                    onChange={(e) => setAdjustReason(e.target.value)}
                                                    className="h-9 text-xs sm:col-span-2"
                                                />
                                                <Button type="submit" size="sm" disabled={adjustingPoints} className="h-9 text-xs font-semibold">
                                                    {adjustingPoints ? "Saving..." : "Adjust Points"}
                                                </Button>
                                            </form>
                                        </CardContent>
                                    </Card>

                                    <Card className="bg-card border-border shadow-sm">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-sm font-bold">Points Transaction Ledger</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            {loadingLoyalty ? (
                                                <div className="py-6 text-center text-muted-foreground text-xs">
                                                    <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1 text-primary" />
                                                    Loading points history...
                                                </div>
                                            ) : loyaltyTransactions.length === 0 ? (
                                                <div className="text-center py-6 text-muted-foreground text-xs">
                                                    No loyalty point transactions recorded yet.
                                                </div>
                                            ) : (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-left text-xs">
                                                        <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] border-b border-border">
                                                            <tr>
                                                                <th className="py-2 px-3">Date</th>
                                                                <th className="py-2 px-3">Type</th>
                                                                <th className="py-2 px-3">Description</th>
                                                                <th className="py-2 px-3 text-right">Points</th>
                                                                <th className="py-2 px-3 text-right">Balance</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border">
                                                            {loyaltyTransactions.map((tx) => (
                                                                <tr key={tx.id}>
                                                                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                                                                        {safeFormatDate(tx.created, (d) => format(d, "dd MMM yyyy"), "—")}
                                                                    </td>
                                                                    <td className="py-2 px-3">
                                                                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                                                            {tx.type}
                                                                        </Badge>
                                                                    </td>
                                                                    <td className="py-2 px-3 text-foreground">
                                                                        {tx.description || tx.reference_type || "—"}
                                                                    </td>
                                                                    <td
                                                                        className={`py-2 px-3 text-right font-mono font-bold ${
                                                                            tx.points >= 0 ? "text-emerald-400" : "text-rose-400"
                                                                        }`}
                                                                    >
                                                                        {tx.points >= 0 ? `+${tx.points}` : tx.points}
                                                                    </td>
                                                                    <td className="py-2 px-3 text-right font-mono">
                                                                        {tx.balance_after}
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

                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Shipping Address</Label>
                            <Input
                                value={editForm.shipping_address}
                                onChange={(e) => setEditForm({ ...editForm, shipping_address: e.target.value })}
                                className="h-9 text-xs"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">GSTIN</Label>
                                <Input
                                    value={editForm.gstin}
                                    onChange={(e) => setEditForm({ ...editForm, gstin: e.target.value.toUpperCase() })}
                                    className="h-9 text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Bangle Size</Label>
                                <Input
                                    value={editForm.bangle_size}
                                    onChange={(e) => setEditForm({ ...editForm, bangle_size: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
                            <div className="min-w-0">
                                <Label className="text-xs font-semibold">WhatsApp Marketing &amp; Milestone Offers</Label>
                                <p className="text-[11px] text-muted-foreground">
                                    DPDP opt-in for birthday wishes, VIP renewals, and festive drops
                                </p>
                            </div>
                            <Switch
                                checked={editForm.opt_in_marketing}
                                onCheckedChange={(checked) => setEditForm({ ...editForm, opt_in_marketing: checked })}
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
