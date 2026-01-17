"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    Users,
    Plus,
    Search,
    Filter,
    Crown,
    Building2,
    User,
    Phone,
    Mail,
    Gift,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import {
    getCustomers,
    createCustomer,
    getCustomerStats,
    type Customer,
    type CustomerType,
} from "@/lib/customers";
import { formatINR } from "@/lib/gst";

const typeConfig: Record<CustomerType, { label: string; icon: any; color: string }> = {
    retail: { label: "Retail", icon: User, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    wholesale: { label: "Wholesale", icon: Building2, color: "bg-green-500/20 text-green-400 border-green-500/30" },
    vip: { label: "VIP", icon: Crown, color: "bg-primary/20 text-primary border-primary/30" },
};

export default function CustomersPage() {
    const router = useRouter();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [stats, setStats] = useState<any>(null);

    // Form state
    const [formData, setFormData] = useState({
        name: "",
        phone: "",
        email: "",
        customer_type: "retail" as CustomerType,
    });
    const [saving, setSaving] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        const [customersData, statsData] = await Promise.all([
            getCustomers({
                type: typeFilter !== "all" ? typeFilter as CustomerType : undefined,
            }),
            getCustomerStats(),
        ]);
        setCustomers(customersData);
        setStats(statsData);
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, [typeFilter]);

    const filteredCustomers = customers.filter((c) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            c.name?.toLowerCase().includes(query) ||
            c.phone?.includes(query) ||
            c.email?.toLowerCase().includes(query)
        );
    });

    const handleAddCustomer = async () => {
        if (!formData.name.trim()) {
            alert("Name is required");
            return;
        }

        setSaving(true);
        try {
            await createCustomer({
                name: formData.name,
                phone: formData.phone || undefined,
                email: formData.email || undefined,
                customer_type: formData.customer_type,
                store_credit: 0,
                preferred_contact: "phone",
                opt_in_marketing: true,
            });
            setShowAddDialog(false);
            setFormData({ name: "", phone: "", email: "", customer_type: "retail" });
            fetchData();
        } catch (error) {
            console.error("Error:", error);
            alert("Failed to add customer");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Customers"
                subtitle={`${stats?.totalCustomers || 0} registered customers`}
                action={
                    <Button
                        onClick={() => setShowAddDialog(true)}
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Customer
                    </Button>
                }
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <Users className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Total</p>
                                    <p className="text-2xl font-semibold">{stats?.totalCustomers || 0}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-500/10">
                                    <Plus className="w-5 h-5 text-green-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">New This Month</p>
                                    <p className="text-2xl font-semibold">{stats?.newThisMonth || 0}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-yellow-500/10">
                                    <Crown className="w-5 h-5 text-yellow-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">VIP</p>
                                    <p className="text-2xl font-semibold">{stats?.byType?.vip || 0}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-500/10">
                                    <Building2 className="w-5 h-5 text-blue-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Wholesale</p>
                                    <p className="text-2xl font-semibold">{stats?.byType?.wholesale || 0}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters */}
                <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="relative w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="Search name, phone, email..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-card border-border"
                            />
                        </div>

                        <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
                            <SelectTrigger className="w-36 bg-card border-border">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="retail">Retail</SelectItem>
                                <SelectItem value="wholesale">Wholesale</SelectItem>
                                <SelectItem value="vip">VIP</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Customer Grid */}
                {loading ? (
                    <div className="text-center py-12 text-muted-foreground">Loading...</div>
                ) : filteredCustomers.length === 0 ? (
                    <div className="text-center py-12">
                        <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">No customers found</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredCustomers.map((customer) => {
                            const config = typeConfig[customer.customer_type];
                            const TypeIcon = config.icon;
                            return (
                                <Card
                                    key={customer.id}
                                    className="bg-card border-border hover:border-primary/30 cursor-pointer transition-all"
                                    onClick={() => router.push(`/customers/detail?id=${customer.id}`)}
                                >
                                    <CardContent className="pt-6">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-lg ${config.color.split(' ')[0]}`}>
                                                    <TypeIcon className={`w-5 h-5 ${config.color.split(' ')[1]}`} />
                                                </div>
                                                <div>
                                                    <p className="font-semibold">{customer.name}</p>
                                                    <Badge variant="outline" className={`text-xs ${config.color}`}>
                                                        {config.label}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2 text-sm">
                                            {customer.phone && (
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Phone className="w-3 h-3" />
                                                    <span>{customer.phone}</span>
                                                </div>
                                            )}
                                            {customer.email && (
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Mail className="w-3 h-3" />
                                                    <span className="truncate">{customer.email}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                                            <div>
                                                <p className="text-xs text-muted-foreground">Total Spent</p>
                                                <p className="font-mono font-semibold text-primary">
                                                    {formatINR(customer.total_spent)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-muted-foreground">Orders</p>
                                                <p className="font-semibold">{customer.total_orders}</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Add Customer Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Customer</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Name *</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Customer name"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+91 98765 43210"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="email@example.com"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select
                                value={formData.customer_type}
                                onValueChange={(v) => v && setFormData({ ...formData, customer_type: v as CustomerType })}
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
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleAddCustomer}
                                disabled={saving}
                            >
                                {saving ? "Adding..." : "Add Customer"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}


