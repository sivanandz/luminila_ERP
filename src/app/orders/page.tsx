
"use client";

import { Header } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { formatPrice, formatDate } from "@/lib/utils";
import {


    Search,
    Eye,
    Truck,
    CheckCircle,
    Clock,
    XCircle,
    ShoppingBag,
    FileText,
    Plus,
    ScanBarcode,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getOrders, OrderType, SalesOrderItem } from "@/lib/orders";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { BarcodeScanDispatchModal, OrderItemSummary } from "@/components/orders/BarcodeScanDispatchModal";

// Define the Order interface locally matching the DB response
interface Order {
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string | null;
    order_type: OrderType;
    status: string;
    total: number;
    created_at?: string;
    created?: string;
    items?: SalesOrderItem[]; // We only fetch basic info here
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

    const [scanModalOpen, setScanModalOpen] = useState(false);
    const [selectedOrderForScan, setSelectedOrderForScan] = useState<OrderItemSummary | null>(null);

    useEffect(() => {
        fetchOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchOrders is recreated every render and sets state, so adding it to deps would cause an infinite refetch loop; the effect intentionally refetches only when activeTab changes
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
                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setSelectedOrderForScan(null);
                            setScanModalOpen(true);
                        }}
                        className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 font-bold text-xs"
                    >
                        <ScanBarcode size={14} className="mr-1.5 text-emerald-400" />
                        Scan AWB
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => router.push('/orders/create')}
                        className="text-xs"
                    >
                        <Plus size={14} className="mr-1.5" />
                        New Order
                    </Button>
                </div>
            </Header>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-8 scroll-smooth">
                {/* Tabs & Filters */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
                    {/* Order Tabs: Dropdown on Mobile/Narrow, Pill Bar on Desktop */}
                    <div className="block sm:hidden w-full">
                        <Select value={activeTab} onValueChange={(v) => v && setActiveTab(v as any)}>
                            <SelectTrigger className="w-full h-10 bg-card border-border text-xs font-semibold px-3 rounded-xl flex items-center justify-between shadow-xs">
                                <span className="font-semibold text-xs text-foreground">
                                    {activeTab === 'all' ? 'All Orders & Estimates' : activeTab === 'sales_order' ? 'Confirmed Orders' : 'Estimates & Quotes'}
                                </span>
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border">
                                <SelectItem value="all" className="text-xs font-medium py-2">
                                    All Orders &amp; Estimates
                                </SelectItem>
                                <SelectItem value="sales_order" className="text-xs font-medium py-2">
                                    Confirmed Orders
                                </SelectItem>
                                <SelectItem value="estimate" className="text-xs font-medium py-2">
                                    Estimates &amp; Quotes
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="hidden sm:flex items-center gap-1 bg-surface-navy p-1 rounded-lg border border-surface-hover">
                        {(['all', 'sales_order', 'estimate'] as const).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
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
                        <>
                            {/* Mobile Card List View (< md) */}
                            <div className="md:hidden flex flex-col gap-3 p-3">
                                {filteredOrders.map((order) => {
                                    const statusBadge = getStatusBadge(order.status);
                                    const typeBadge = getTypeBadge(order.order_type);
                                    return (
                                        <div
                                            key={order.id}
                                            onClick={() => router.push(`/orders/detail?id=${order.id}`)}
                                            className="bg-bg-navy/80 border border-surface-hover hover:border-primary/50 rounded-xl p-3.5 transition-all shadow-sm active:scale-[0.99] cursor-pointer"
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono font-bold text-sm text-white">#{order.order_number}</span>
                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${typeBadge.bg} ${typeBadge.text} ${typeBadge.border}`}>
                                                        {typeBadge.label}
                                                    </span>
                                                </div>
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadge.className}`}>
                                                    {statusBadge.icon}
                                                    {statusBadge.label}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between text-xs my-1.5">
                                                <div className="min-w-0 pr-2">
                                                    <p className="font-bold text-white truncate">{order.customer_name || 'Walk-in Customer'}</p>
                                                    {order.customer_phone && (
                                                        <p className="text-[11px] text-moonstone truncate font-mono mt-0.5">{order.customer_phone}</p>
                                                    )}
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-bold text-primary text-base font-mono">{formatPrice(order.total)}</p>
                                                    <p className="text-[10px] text-moonstone">{formatDate(order.created || order.created_at)}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-hover/60 mt-2">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedOrderForScan({
                                                            id: order.id,
                                                            order_number: order.order_number,
                                                            customer_name: order.customer_name,
                                                            customer_phone: order.customer_phone,
                                                            status: order.status,
                                                            total: order.total,
                                                        });
                                                        setScanModalOpen(true);
                                                    }}
                                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-lg border border-emerald-500/30 transition-colors"
                                                >
                                                    <ScanBarcode size={13} />
                                                    Dispatch AWB
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        router.push(`/orders/detail?id=${order.id}`);
                                                    }}
                                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-surface-navy hover:bg-surface-hover px-2.5 py-1 rounded-lg border border-surface-hover transition-colors"
                                                >
                                                    <Eye size={13} />
                                                    View
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Desktop Table View (>= md) */}
                            <div className="hidden md:block overflow-x-auto">
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
                                                    {formatDate(order.created || order.created_at)}
                                                </td>
                                                <td className="py-4 px-6 text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={() => {
                                                                setSelectedOrderForScan({
                                                                    id: order.id,
                                                                    order_number: order.order_number,
                                                                    customer_name: order.customer_name,
                                                                    customer_phone: order.customer_phone,
                                                                    status: order.status,
                                                                    total: order.total,
                                                                });
                                                                setScanModalOpen(true);
                                                            }}
                                                            className="text-moonstone hover:text-emerald-400 p-2 hover:bg-bg-navy rounded-lg transition-colors"
                                                            title="Scan AWB Barcode & Send WhatsApp"
                                                        >
                                                            <ScanBarcode size={18} />
                                                        </button>
                                                        <button
                                                            onClick={() => router.push(`/orders/detail?id=${order.id}`)}
                                                            className="text-moonstone hover:text-white p-2 hover:bg-bg-navy rounded-lg transition-colors"
                                                            title="View Order Details"
                                                        >
                                                            <Eye size={18} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                    )}
                </div>
            </div>

            {/* Quick Barcode Scanner Station Modal */}
            <BarcodeScanDispatchModal
                open={scanModalOpen}
                onOpenChange={setScanModalOpen}
                preselectedOrder={selectedOrderForScan}
                onDispatched={fetchOrders}
            />
        </div>
    );
}


