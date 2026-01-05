"use client";

import { Header } from "@/components/layout";
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
    ShoppingBag
} from "lucide-react";

// Mock orders data
const mockOrders = [
    {
        id: "ORD-001",
        channel: "shopify",
        customer: "Priya Sharma",
        phone: "+91 98765 43210",
        items: 3,
        total: 4580,
        status: "confirmed",
        createdAt: "2024-12-20T10:30:00",
    },
    {
        id: "ORD-002",
        channel: "whatsapp",
        customer: "Rahul Verma",
        phone: "+91 87654 32109",
        items: 5,
        total: 12450,
        status: "shipped",
        createdAt: "2024-12-19T15:45:00",
    },
    {
        id: "ORD-003",
        channel: "pos",
        customer: "Walk-in Customer",
        phone: null,
        items: 2,
        total: 2890,
        status: "delivered",
        createdAt: "2024-12-19T11:20:00",
    },
    {
        id: "ORD-004",
        channel: "shopify",
        customer: "Anita Desai",
        phone: "+91 76543 21098",
        items: 1,
        total: 1490,
        status: "pending",
        createdAt: "2024-12-20T09:15:00",
    },
    {
        id: "ORD-005",
        channel: "whatsapp",
        customer: "Suresh Kumar",
        phone: "+91 65432 10987",
        items: 4,
        total: 6780,
        status: "cancelled",
        createdAt: "2024-12-18T14:00:00",
    },
];

function getStatusBadge(status: string) {
    const badges: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
        pending: { icon: <Clock size={14} />, className: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20", label: "Pending" },
        confirmed: { icon: <CheckCircle size={14} />, className: "bg-blue-500/10 text-blue-400 border border-blue-500/20", label: "Confirmed" },
        shipped: { icon: <Truck size={14} />, className: "bg-purple-500/10 text-purple-400 border border-purple-500/20", label: "Shipped" },
        delivered: { icon: <CheckCircle size={14} />, className: "bg-green-500/10 text-green-400 border border-green-500/20", label: "Delivered" },
        cancelled: { icon: <XCircle size={14} />, className: "bg-red-500/10 text-red-400 border border-red-500/20", label: "Cancelled" },
    };
    return badges[status] || badges.pending;
}

function getChannelBadge(channel: string) {
    const badges: Record<string, { bg: string; text: string; border: string }> = {
        pos: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" },
        shopify: { bg: "bg-[#96bf48]/10", text: "text-[#96bf48]", border: "border-[#96bf48]/20" },
        whatsapp: { bg: "bg-[#25D366]/10", text: "text-[#25D366]", border: "border-[#25D366]/20" },
    };
    return badges[channel] || badges.pos;
}

export default function OrdersPage() {
    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Orders"
                subtitle={`${mockOrders.length} orders this week`}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Filters */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="relative group w-full md:w-80">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone group-focus-within:text-primary">
                                <Search size={18} />
                            </div>
                            <input
                                type="text"
                                placeholder="Search by order ID, customer..."
                                className="bg-surface-navy border border-surface-hover text-white text-sm rounded-lg block w-full pl-10 h-11 focus:ring-1 focus:ring-primary focus:border-primary placeholder-moonstone transition-all"
                            />
                        </div>
                        <button className="h-11 px-4 bg-surface-navy text-moonstone hover:text-white border border-surface-hover rounded-lg font-bold text-sm flex items-center gap-2 transition-colors">
                            <Filter size={18} />
                            Filter
                        </button>
                    </div>
                    <button className="h-11 px-4 bg-primary hover:bg-primary/90 text-bg-navy rounded-lg font-bold text-sm flex items-center gap-2 transition-colors">
                        <Download size={18} />
                        Export Report
                    </button>
                </div>

                {/* Orders Table */}
                <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-surface-hover bg-bg-navy/50">
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Order ID</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Channel</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Customer</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Items</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Total</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Status</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider">Date</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-hover">
                                {mockOrders.map((order) => {
                                    const statusBadge = getStatusBadge(order.status);
                                    const channelBadge = getChannelBadge(order.channel);
                                    return (
                                        <tr key={order.id} className="hover:bg-bg-navy/30 transition-colors group">
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-2 rounded bg-bg-navy border border-surface-hover text-moonstone">
                                                        <ShoppingBag size={16} />
                                                    </div>
                                                    <span className="font-mono font-bold text-sm text-white">{order.id}</span>
                                                </div>
                                            </td>
                                            <td className="py-4 px-6">
                                                <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${channelBadge.bg} ${channelBadge.text} ${channelBadge.border}`}>
                                                    {order.channel}
                                                </span>
                                            </td>
                                            <td className="py-4 px-6">
                                                <div>
                                                    <p className="font-bold text-sm text-white">{order.customer}</p>
                                                    {order.phone ? (
                                                        <p className="text-xs text-moonstone mt-0.5">{order.phone}</p>
                                                    ) : (
                                                        <p className="text-xs text-moonstone/50 italic mt-0.5">No contact info</p>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 text-sm text-moonstone font-medium">
                                                {order.items} items
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
                                                {formatDate(order.createdAt)}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <button className="text-moonstone hover:text-white p-2 hover:bg-bg-navy rounded-lg transition-colors">
                                                    <Eye size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination (Visual only) */}
                    <div className="border-t border-surface-hover bg-bg-navy/30 py-3 px-6 flex items-center justify-between">
                        <p className="text-xs text-moonstone">Showing <span className="text-white font-bold">1-5</span> of <span className="text-white font-bold">128</span> orders</p>
                        <div className="flex gap-2">
                            <button className="px-3 py-1 rounded-lg bg-surface-navy border border-surface-hover text-xs font-bold text-moonstone disabled:opacity-50">Prev</button>
                            <button className="px-3 py-1 rounded-lg bg-surface-navy border border-surface-hover text-xs font-bold text-white hover:text-primary transition-colors">Next</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
