"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Edit,
    Trash2,
    Phone,
    Mail,
    MapPin,
    Building2,
    Crown,
    User,
    Gift,
    Calendar,
    ShoppingBag,
    MessageSquare,
    Plus,
    Star,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    getCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerPurchases,
    getCustomerInteractions,
    addInteraction,
    type Customer,
    type CustomerType,
    type CustomerPurchase,
    type CustomerInteraction,
} from "@/lib/customers";
import { formatINR } from "@/lib/gst";

const typeConfig: Record<CustomerType, { label: string; icon: any; color: string }> = {
    retail: { label: "Retail", icon: User, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    wholesale: { label: "Wholesale", icon: Building2, color: "bg-green-500/20 text-green-400 border-green-500/30" },
    vip: { label: "VIP", icon: Crown, color: "bg-champagne/20 text-champagne border-champagne/30" },
};

export default function CustomerDetailPage() {
    const params = useParams();
    const router = useRouter();
    const customerId = params.id as string;

    const [customer, setCustomer] = useState<Customer | null>(null);
    const [purchases, setPurchases] = useState<CustomerPurchase[]>([]);
    const [interactions, setInteractions] = useState<CustomerInteraction[]>([]);
    const [loading, setLoading] = useState(true);

    const [showEditDialog, setShowEditDialog] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
    const [saving, setSaving] = useState(false);

    const [editForm, setEditForm] = useState<Partial<Customer>>({});
    const [noteText, setNoteText] = useState("");

    const loadData = async () => {
        setLoading(true);
        const [customerData, purchasesData, interactionsData] = await Promise.all([
            getCustomer(customerId),
            getCustomerPurchases(customerId),
            getCustomerInteractions(customerId),
        ]);
        setCustomer(customerData);
        setPurchases(purchasesData);
        setInteractions(interactionsData);
        setEditForm(customerData || {});
        setLoading(false);
    };

    useEffect(() => {
        loadData();
    }, [customerId]);

    const handleUpdate = async () => {
        if (!customer) return;
        setSaving(true);
        try {
            await updateCustomer(customer.id!, editForm);
            setShowEditDialog(false);
            loadData();
        } catch (error) {
            console.error("Error:", error);
            alert("Failed to update customer");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!customer) return;
        try {
            await deleteCustomer(customer.id!);
            router.push("/customers");
        } catch (error) {
            console.error("Error:", error);
            alert("Failed to delete customer");
        }
    };

    const handleAddNote = async () => {
        if (!customer || !noteText.trim()) return;
        setSaving(true);
        try {
            await addInteraction({
                customer_id: customer.id!,
                interaction_type: "note",
                description: noteText,
            });
            setNoteText("");
            setShowAddNoteDialog(false);
            loadData();
        } catch (error) {
            console.error("Error:", error);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-muted-foreground">Loading customer...</div>
            </div>
        );
    }

    if (!customer) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-muted-foreground">Customer not found</div>
                <Button variant="outline" onClick={() => router.push("/customers")}>
                    Back to Customers
                </Button>
            </div>
        );
    }

    const config = typeConfig[customer.customer_type];
    const TypeIcon = config.icon;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title={customer.name} subtitle={`${config.label} Customer`} />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Actions Bar */}
                <div className="flex items-center justify-between mb-6">
                    <Button variant="ghost" onClick={() => router.push("/customers")}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Customers
                    </Button>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => setShowEditDialog(true)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                        </Button>
                        <Button
                            variant="outline"
                            className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                            onClick={() => setShowDeleteDialog(true)}
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Customer Info Card */}
                    <Card className="bg-card/50 border-border/50">
                        <CardContent className="pt-6 space-y-6">
                            {/* Profile */}
                            <div className="flex items-center gap-4">
                                <div className={`p-4 rounded-xl ${config.color.split(' ')[0]}`}>
                                    <TypeIcon className={`w-8 h-8 ${config.color.split(' ')[1]}`} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold">{customer.name}</h2>
                                    <Badge variant="outline" className={config.color}>
                                        {config.label}
                                    </Badge>
                                </div>
                            </div>

                            {/* Contact */}
                            <div className="space-y-3">
                                {customer.phone && (
                                    <div className="flex items-center gap-3">
                                        <Phone className="w-4 h-4 text-muted-foreground" />
                                        <span>{customer.phone}</span>
                                    </div>
                                )}
                                {customer.email && (
                                    <div className="flex items-center gap-3">
                                        <Mail className="w-4 h-4 text-muted-foreground" />
                                        <span>{customer.email}</span>
                                    </div>
                                )}
                                {customer.address && (
                                    <div className="flex items-start gap-3">
                                        <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                                        <span className="text-sm text-muted-foreground">
                                            {customer.address}
                                            {customer.city && `, ${customer.city}`}
                                            {customer.state && `, ${customer.state}`}
                                            {customer.pincode && ` - ${customer.pincode}`}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
                                <div>
                                    <p className="text-xs text-muted-foreground">Total Spent</p>
                                    <p className="text-lg font-semibold text-champagne">
                                        {formatINR(customer.total_spent)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Orders</p>
                                    <p className="text-lg font-semibold">{customer.total_orders}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Loyalty Points</p>
                                    <p className="text-lg font-semibold text-yellow-400">
                                        {customer.loyalty_points}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Since</p>
                                    <p className="text-sm">
                                        {customer.created_at && format(new Date(customer.created_at), "MMM yyyy")}
                                    </p>
                                </div>
                            </div>

                            {/* Special Dates */}
                            {(customer.date_of_birth || customer.anniversary) && (
                                <div className="pt-4 border-t border-border/50 space-y-2">
                                    {customer.date_of_birth && (
                                        <div className="flex items-center gap-2 text-sm">
                                            <Gift className="w-4 h-4 text-pink-400" />
                                            <span className="text-muted-foreground">Birthday:</span>
                                            <span>{format(new Date(customer.date_of_birth), "dd MMM")}</span>
                                        </div>
                                    )}
                                    {customer.anniversary && (
                                        <div className="flex items-center gap-2 text-sm">
                                            <Calendar className="w-4 h-4 text-red-400" />
                                            <span className="text-muted-foreground">Anniversary:</span>
                                            <span>{format(new Date(customer.anniversary), "dd MMM")}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* GST Info */}
                            {customer.gstin && (
                                <div className="pt-4 border-t border-border/50">
                                    <p className="text-xs text-muted-foreground mb-1">GSTIN</p>
                                    <p className="font-mono">{customer.gstin}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Tabs Card */}
                    <div className="lg:col-span-2">
                        <Tabs defaultValue="purchases" className="w-full">
                            <TabsList className="mb-4">
                                <TabsTrigger value="purchases">
                                    <ShoppingBag className="w-4 h-4 mr-2" />
                                    Purchase History
                                </TabsTrigger>
                                <TabsTrigger value="activity">
                                    <MessageSquare className="w-4 h-4 mr-2" />
                                    Activity
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="purchases">
                                <Card className="bg-card/50 border-border/50">
                                    <CardContent className="pt-6">
                                        {purchases.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground">
                                                No purchases yet
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {purchases.map((purchase) => (
                                                    <div
                                                        key={purchase.id}
                                                        className="flex items-center justify-between p-3 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors"
                                                    >
                                                        <div>
                                                            <p className="font-medium">
                                                                {format(new Date(purchase.created_at), "dd MMM yyyy")}
                                                            </p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {purchase.items_count} items · {purchase.payment_method || "Cash"}
                                                            </p>
                                                        </div>
                                                        <p className="font-mono font-semibold text-champagne">
                                                            {formatINR(purchase.total)}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            <TabsContent value="activity">
                                <Card className="bg-card/50 border-border/50">
                                    <CardHeader className="flex flex-row items-center justify-between">
                                        <CardTitle className="text-sm">Activity Timeline</CardTitle>
                                        <Button size="sm" variant="outline" onClick={() => setShowAddNoteDialog(true)}>
                                            <Plus className="w-3 h-3 mr-1" />
                                            Add Note
                                        </Button>
                                    </CardHeader>
                                    <CardContent>
                                        {interactions.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground">
                                                No activity yet
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                {interactions.map((interaction) => (
                                                    <div
                                                        key={interaction.id}
                                                        className="flex gap-3 pb-4 border-b border-border/50 last:border-0"
                                                    >
                                                        <div className="w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center flex-shrink-0">
                                                            {interaction.interaction_type === "purchase" ? (
                                                                <ShoppingBag className="w-4 h-4 text-green-400" />
                                                            ) : (
                                                                <MessageSquare className="w-4 h-4 text-blue-400" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="flex items-center justify-between">
                                                                <p className="font-medium text-sm capitalize">
                                                                    {interaction.interaction_type}
                                                                </p>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {interaction.created_at && format(new Date(interaction.created_at), "dd MMM, h:mm a")}
                                                                </span>
                                                            </div>
                                                            {interaction.description && (
                                                                <p className="text-sm text-muted-foreground mt-1">
                                                                    {interaction.description}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </div>

            {/* Edit Dialog */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Customer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2 space-y-2">
                                <Label>Name</Label>
                                <Input
                                    value={editForm.name || ""}
                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={editForm.phone || ""}
                                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    type="email"
                                    value={editForm.email || ""}
                                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select
                                    value={editForm.customer_type || "retail"}
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
                                    value={editForm.gstin || ""}
                                    onChange={(e) => setEditForm({ ...editForm, gstin: e.target.value.toUpperCase() })}
                                    maxLength={15}
                                />
                            </div>
                            <div className="col-span-2 space-y-2">
                                <Label>Address</Label>
                                <Textarea
                                    value={editForm.address || ""}
                                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                                    rows={2}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>City</Label>
                                <Input
                                    value={editForm.city || ""}
                                    onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>State</Label>
                                <Input
                                    value={editForm.state || ""}
                                    onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Birthday</Label>
                                <Input
                                    type="date"
                                    value={editForm.date_of_birth || ""}
                                    onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Anniversary</Label>
                                <Input
                                    type="date"
                                    value={editForm.anniversary || ""}
                                    onChange={(e) => setEditForm({ ...editForm, anniversary: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleUpdate} disabled={saving} className="bg-champagne text-midnight">
                                {saving ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Add Note Dialog */}
            <Dialog open={showAddNoteDialog} onOpenChange={setShowAddNoteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Note</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <Textarea
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="Enter note..."
                            rows={4}
                        />
                        <div className="flex justify-end gap-3">
                            <Button variant="outline" onClick={() => setShowAddNoteDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddNote} disabled={saving} className="bg-champagne text-midnight">
                                {saving ? "Adding..." : "Add Note"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Customer?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete {customer.name} and all their data. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
