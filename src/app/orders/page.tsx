
"use client";

import { Header } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { formatPrice, formatDate } from "@/lib/utils";
import {
    Filter,
    Download,
    Search,
    Eye,
    Truck,
    CheckCircle,
    Clock,
    XCircle,
    ShoppingBag,
    FileText,
    Plus
} from "lucide-react";
import { useEffect, useState } from "react";
import { getOrders, OrderType } from "@/lib/orders";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// Define the Order interface locally matching the DB response
interface Order {
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string | null;
    order_type: OrderType;
    status: string;
    total: number;
    created_at: string;
    items?: any[]; // We only fetch basic info here
}

function getStatusBadge(status: string) {
    const badges: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
        draft: { icon: <FileText size={14} />, className: "bg-gray-500/10 text-gray-400 border border-gray-500/20", label: "Draft" },
        sent: { icon: <CheckCircle size={14} />, className: "bg-blue-500/10 text-blue-400 border border-blue-500/20", label: "Sent" },
        pending: { icon: <Clock size={14} />, className: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20", label: "Pending" },
        confirmed: { icon: <CheckCircle size={14} />, className: "bg-green-500/10 text-green-400 border border-green-500/20", label: "Confirmed" },
        shipped: { icon: <Truck size={14} />, className: "bg-purple-500/10 text-purple-400 border border-purple-500/20", label: "Shipped" },
        delivered: { icon: <CheckCircle size={14} />, className: "bg-green-500/10 text-green-400 border border-green-500/20", label: "Delivered" },
        cancelled: { icon: <XCircle size={14} />, className: "bg-red-500/10 text-red-400 border border-red-500/20", label: "Cancelled" },
        invoiced: { icon: <CheckCircle size={14} />, className: "bg-primary/10 text-primary border border-primary/20", label: "Invoiced" },
    };
    return badges[status] || badges.pending;
}

function getTypeBadge(type: string) {
    if (type === 'estimate') {
        return { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20", label: "Estimate" };
    }
    return { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", label: "Order" };
}

export default function OrdersPage() {
    const router = useRouter();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<OrderType | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        fetchOrders();
    }, [activeTab]);

    async function fetchOrders() {
        setLoading(true);
        try {
            const data = await getOrders(activeTab === 'all' ? undefined : activeTab);
            setOrders(data as unknown as Order[]);
        } catch (error) {
            toast.error("Failed to load orders");
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    const filteredOrders = orders.filter(order =>
        order.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.order_number?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Sales & Estimates"
                subtitle="Manage customer orders and quotations"
            >
                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => router.push('/orders/create')}
                    >
                        <Plus size={16} className="mr-2" />
                        New Order / Estimate
                    </Button>
                </div>
            </Header>

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Tabs & Filters */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-1 bg-surface-navy p-1 rounded-lg border border-surface-hover">
                        {['all', 'sales_order', 'estimate'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === tab
                                    ? 'bg-primary text-primary-foreground shadow-lg'
                                    : 'text-moonstone hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {tab === 'all' ? 'All' : tab === 'sales_order' ? 'Orders' : 'Estimates'}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="relative group w-full md:w-64">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone group-focus-within:text-primary">
                                <Search size={18} />
                            </div>
                            <input
                                type="text"
                                placeholder="Search orders..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="bg-surface-navy border border-surface-hover text-white text-sm rounded-lg block w-full pl-10 h-11 focus:ring-1 focus:ring-primary focus:border-primary placeholder-moonstone transition-all"
                            />
                        </div>
                    </div>
                </div>

                {/* Orders Table */}
                <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden">
                    {loading ? (
                        <div className="p-8 text-center text-moonstone">Loading orders...</div>
                    ) : filteredOrders.length === 0 ? (
                        <div className="p-12 text-center flex flex-col items-center justify-center gap-4">
                            <div className="w-16 h-16 bg-surface-hover rounded-full flex items-center justify-center text-moonstone">
                                <ShoppingBag size={32} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">No orders found</h3>
                                <p className="text-moonstone text-sm">Create a new estimate or sales order to get started</p>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-surface-hover bg-bg-navy/50">
                                        <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Order #</th>
                                        <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Type</th>
                                        <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Customer</th>
                                        <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Total</th>
                                        <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Status</th>
                                        <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Date</th>
                                        <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-hover">
                                    {filteredOrders.map((order) => {
                                        const statusBadge = getStatusBadge(order.status);
                                        const typeBadge = getTypeBadge(order.order_type);
                                        return (
                                            <tr key={order.id} className="hover:bg-bg-navy/30 transition-colors group">
                                                <td className="py-4 px-6">
                                                    <div className="flex items-center gap-2">
                                                        <div className="p-2 rounded bg-bg-navy border border-surface-hover text-moonstone">
                                                            <ShoppingBag size={16} />
                                                        </div>
                                                        <span className="font-mono font-bold text-sm text-white">{order.order_number}</span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-6">
                                                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${typeBadge.bg} ${typeBadge.text} ${typeBadge.border}`}>
                                                        {typeBadge.label}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-6">
                                                    <div>
                                                        <p className="font-bold text-sm text-white">{order.customer_name}</p>
                                                        {order.customer_phone && (
                                                            <p className="text-xs text-moonstone mt-0.5">{order.customer_phone}</p>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-4 px-6 font-bold text-primary text-sm">
                                                    {formatPrice(order.total)}
                                                </td>
                                                <td className="py-4 px-6">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${statusBadge.className}`}>
                                                        {statusBadge.icon}
                                                        {statusBadge.label}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-6 text-xs text-moonstone font-medium">
                                                    {formatDate(order.created_at)}
                                                </td>
                                                <td className="py-4 px-6 text-right">
                                                    <button
                                                        onClick={() => router.push(`/orders/detail?id=${order.id}`)}
                                                        className="text-moonstone hover:text-white p-2 hover:bg-bg-navy rounded-lg transition-colors"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


