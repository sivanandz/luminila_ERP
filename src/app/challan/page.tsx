"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout";
import {
    Search,
    Plus,
    Truck,
    Filter,
    Eye,
    Package,
    CheckCircle2,
    Clock,
    XCircle,
    ArrowRightLeft,
    FileText
} from "lucide-react";
import { formatDate, formatPrice } from "@/lib/utils";
import {
    getChallans,
    type DeliveryChallan,
    type ChallanType,
    type ChallanStatus,
    CHALLAN_TYPE_LABELS,
    CHALLAN_STATUS_LABELS
} from "@/lib/challan";
import { toast } from "sonner";

const getStatusBadge = (status: ChallanStatus) => {
    const styles: Record<ChallanStatus, string> = {
        'draft': 'bg-slate-500/20 text-slate-300',
        'issued': 'bg-blue-500/20 text-blue-300',
        'in_transit': 'bg-orange-500/20 text-orange-300',
        'delivered': 'bg-green-500/20 text-green-300',
        'returned': 'bg-purple-500/20 text-purple-300',
        'cancelled': 'bg-red-500/20 text-red-300'
    };
    const icons: Record<ChallanStatus, React.ReactNode> = {
        'draft': <FileText size={12} />,
        'issued': <Clock size={12} />,
        'in_transit': <Truck size={12} />,
        'delivered': <CheckCircle2 size={12} />,
        'returned': <ArrowRightLeft size={12} />,
        'cancelled': <XCircle size={12} />
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${styles[status]}`}>
            {icons[status]}
            {CHALLAN_STATUS_LABELS[status]}
        </span>
    );
};

const getTypeBadge = (type: ChallanType) => {
    const styles: Record<ChallanType, string> = {
        'job_work': 'bg-cyan-500/20 text-cyan-300',
        'stock_transfer': 'bg-indigo-500/20 text-indigo-300',
        'sale_return': 'bg-yellow-500/20 text-yellow-300',
        'exhibition': 'bg-pink-500/20 text-pink-300',
        'approval': 'bg-teal-500/20 text-teal-300',
        'other': 'bg-gray-500/20 text-gray-300'
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${styles[type]}`}>
            {CHALLAN_TYPE_LABELS[type]}
        </span>
    );
};

export default function ChallansPage() {
    const router = useRouter();
    const [challans, setChallans] = useState<DeliveryChallan[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<ChallanType | "">("");
    const [statusFilter, setStatusFilter] = useState<ChallanStatus | "">("");

    const fetchChallans = async () => {
        setLoading(true);
        try {
            const data = await getChallans({
                challanType: typeFilter || undefined,
                status: statusFilter || undefined,
                consigneeName: searchQuery || undefined
            });
            setChallans(data);
        } catch (error) {
            console.error("Error fetching challans:", error);
            toast.error("Failed to load challans");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchChallans();
    }, [typeFilter, statusFilter]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            fetchChallans();
        }, 500);
        return () => clearTimeout(timeout);
    }, [searchQuery]);

    const filteredChallans = challans;

    return (
        <div className="flex flex-col h-full overflow-hidden bg-bg-navy">
            <Header
                title="Delivery Challans"
                subtitle="Track material outward movements"
                action={
                    <button
                        onClick={() => router.push("/challan/create")}
                        className="h-11 px-6 bg-primary hover:bg-primary/90 text-bg-navy rounded-lg font-bold text-sm flex items-center gap-2 transition-colors"
                    >
                        <Plus size={18} />
                        New Challan
                    </button>
                }
            />

            <div className="flex-1 overflow-y-auto p-6">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-4 mb-6">
                    <div className="relative flex-1 max-w-md">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone" />
                        <input
                            type="text"
                            placeholder="Search by consignee name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-11 w-full pl-10 pr-4 bg-surface-navy border border-surface-hover rounded-lg text-white placeholder:text-moonstone focus:outline-none focus:border-primary"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Filter size={16} className="text-moonstone" />
                        <select
                            value={typeFilter}
                            onChange={(e) => setTypeFilter(e.target.value as ChallanType | "")}
                            className="h-11 px-4 bg-surface-navy border border-surface-hover rounded-lg text-white focus:outline-none focus:border-primary"
                        >
                            <option value="">All Types</option>
                            {Object.entries(CHALLAN_TYPE_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>

                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as ChallanStatus | "")}
                            className="h-11 px-4 bg-surface-navy border border-surface-hover rounded-lg text-white focus:outline-none focus:border-primary"
                        >
                            <option value="">All Status</option>
                            {Object.entries(CHALLAN_STATUS_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Challans Table */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                ) : filteredChallans.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Package size={48} className="text-moonstone/30 mb-4" />
                        <p className="text-white font-bold text-lg">No challans found</p>
                        <p className="text-moonstone text-sm mt-1">
                            Create your first delivery challan to track material movements
                        </p>
                        <button
                            onClick={() => router.push("/challan/create")}
                            className="mt-6 h-10 px-6 bg-primary hover:bg-primary/90 text-bg-navy rounded-lg font-bold text-sm flex items-center gap-2"
                        >
                            <Plus size={16} />
                            New Challan
                        </button>
                    </div>
                ) : (
                    <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-surface-hover text-left text-xs font-bold text-moonstone uppercase">
                                    <th className="py-4 px-4">Challan #</th>
                                    <th className="py-4 px-4">Date</th>
                                    <th className="py-4 px-4">Consignee</th>
                                    <th className="py-4 px-4">Type</th>
                                    <th className="py-4 px-4">Status</th>
                                    <th className="py-4 px-4 text-right">Value</th>
                                    <th className="py-4 px-4 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-hover">
                                {filteredChallans.map((challan) => (
                                    <tr
                                        key={challan.id}
                                        className="hover:bg-bg-navy/30 cursor-pointer transition-colors"
                                        onClick={() => router.push(`/challan/detail?id=${challan.id}`)}
                                    >
                                        <td className="py-4 px-4">
                                            <span className="font-mono font-bold text-primary">
                                                {challan.challan_number}
                                            </span>
                                        </td>
                                        <td className="py-4 px-4 text-white">
                                            {formatDate(challan.challan_date)}
                                        </td>
                                        <td className="py-4 px-4">
                                            <p className="text-white font-medium">{challan.consignee_name}</p>
                                            {challan.consignee_address && (
                                                <p className="text-xs text-moonstone truncate max-w-[200px]">
                                                    {challan.consignee_address}
                                                </p>
                                            )}
                                        </td>
                                        <td className="py-4 px-4">
                                            {getTypeBadge(challan.challan_type)}
                                        </td>
                                        <td className="py-4 px-4">
                                            {getStatusBadge(challan.status)}
                                        </td>
                                        <td className="py-4 px-4 text-right font-mono font-bold text-white">
                                            {formatPrice(challan.total_value)}
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    router.push(`/challan/detail?id=${challan.id}`);
                                                }}
                                                className="p-2 rounded-lg hover:bg-surface-hover text-moonstone hover:text-white transition-colors"
                                            >
                                                <Eye size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
