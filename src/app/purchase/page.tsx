"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    Package,
    Plus,
    Search,
    Filter,
    Truck,
    AlertCircle,
    CheckCircle,
    Clock,
    XCircle,
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";

import { getPurchaseOrders, type PurchaseOrder, type POStatus } from "@/lib/purchase";
import { formatINR } from "@/lib/gst";

const statusConfig: Record<POStatus, { label: string; icon: any; color: string }> = {
    draft: { label: "Draft", icon: Clock, color: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    sent: { label: "Sent", icon: Truck, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    partial: { label: "Partial", icon: AlertCircle, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    received: { label: "Received", icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30" },
    cancelled: { label: "Cancelled", icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

export default function PurchaseOrdersPage() {
    const router = useRouter();
    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");

    const fetchOrders = async () => {
        setLoading(true);
        const filters: any = {};
        if (statusFilter !== "all") {
            filters.status = statusFilter;
        }
        const data = await getPurchaseOrders(filters);
        setOrders(data);
        setLoading(false);
    };

    useEffect(() => {
        fetchOrders();
    }, [statusFilter]);

    const filteredOrders = orders.filter((o) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            o.po_number?.toLowerCase().includes(query) ||
            o.vendor?.name?.toLowerCase().includes(query)
        );
    });

    // Stats
    const totalOrders = orders.length;
    const pendingValue = orders
        .filter((o) => o.status === "sent" || o.status === "partial")
        .reduce((sum, o) => sum + o.total, 0);
    const draftCount = orders.filter((o) => o.status === "draft").length;

    const getStatusBadge = (status: POStatus) => {
        const config = statusConfig[status];
        const Icon = config.icon;
        return (
            <Badge className={config.color}>
                <Icon className="w-3 h-3 mr-1" />
                {config.label}
            </Badge>
        );
    };

    const getReceiptProgress = (order: PurchaseOrder) => {
        const items = order.items || [];
        const totalOrdered = items.reduce((sum, i) => sum + (i.quantity_ordered || 0), 0);
        const totalReceived = items.reduce((sum, i) => sum + (i.quantity_received || 0), 0);

        if (totalOrdered === 0) return null;

        const percent = Math.round((totalReceived / totalOrdered) * 100);
        return (
            <div className="flex items-center gap-2">
                <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${percent}%` }}
                    />
                </div>
                <span className="text-xs text-muted-foreground">{percent}%</span>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Purchase Orders"
                subtitle={`${totalOrders} orders`}
                action={
                    <Button
                        onClick={() => router.push("/purchase/create")}
                        className="bg-primary text-midnight hover:bg-primary/90"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Purchase Order
                    </Button>
                }
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <Package className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Total Orders</p>
                                    <p className="text-2xl font-semibold">{totalOrders}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-yellow-500/10">
                                    <Truck className="w-5 h-5 text-yellow-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Pending Value</p>
                                    <p className="text-2xl font-semibold">{formatINR(pendingValue)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-gray-500/10">
                                    <Clock className="w-5 h-5 text-gray-400" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Drafts</p>
                                    <p className="text-2xl font-semibold">{draftCount}</p>
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
                                placeholder="Search PO number or vendor..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-card border-border"
                            />
                        </div>

                        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
                            <SelectTrigger className="w-40 bg-card border-border">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="sent">Sent</SelectItem>
                                <SelectItem value="partial">Partial</SelectItem>
                                <SelectItem value="received">Received</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Table */}
                <Card className="bg-card border-border">
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-border hover:bg-transparent">
                                    <TableHead>PO Number</TableHead>
                                    <TableHead>Vendor</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Expected</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Receipt</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                            Loading orders...
                                        </TableCell>
                                    </TableRow>
                                ) : filteredOrders.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-12">
                                            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                                            <p className="text-muted-foreground">No purchase orders found</p>
                                            <Button
                                                variant="link"
                                                className="text-primary mt-2"
                                                onClick={() => router.push("/purchase/create")}
                                            >
                                                Create your first PO
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredOrders.map((order) => (
                                        <TableRow
                                            key={order.id}
                                            className="border-border hover:bg-muted/50 cursor-pointer"
                                            onClick={() => router.push(`/purchase/detail?id=${order.id}`)}
                                        >
                                            <TableCell className="font-mono text-primary">
                                                {order.po_number}
                                            </TableCell>
                                            <TableCell>
                                                <div>
                                                    <p className="font-medium">{order.vendor?.name || "—"}</p>
                                                    {order.vendor?.phone && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {order.vendor.phone}
                                                        </p>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {format(new Date(order.order_date), "dd MMM yyyy")}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {order.expected_date
                                                    ? format(new Date(order.expected_date), "dd MMM yyyy")
                                                    : "—"}
                                            </TableCell>
                                            <TableCell>{getStatusBadge(order.status)}</TableCell>
                                            <TableCell>{getReceiptProgress(order)}</TableCell>
                                            <TableCell className="text-right font-mono font-semibold">
                                                {formatINR(order.total)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}


