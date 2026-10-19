"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
    Truck,
    PackageCheck,
    Clock,
    Plus,
    ExternalLink,
    Loader2,
    Calendar,
    User,
    CheckCircle2,
    AlertCircle,
    ArrowUpRight,
} from "lucide-react";
import {
    getProductPurchaseHistory,
    type ProductPurchaseHistory,
} from "@/lib/purchase";
import { formatINR } from "@/lib/gst";

interface ProductPurchaseHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: {
        id: string;
        name: string;
        sku: string;
        stock: number;
        category?: string;
        location?: string;
    } | null;
}

export function ProductPurchaseHistoryModal({
    isOpen,
    onClose,
    product,
}: ProductPurchaseHistoryModalProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState<ProductPurchaseHistory | null>(null);
    const [activeTab, setActiveTab] = useState<"incoming" | "deliveries">("incoming");

    useEffect(() => {
        if (!isOpen || !product?.id) return;

        let cancelled = false;
        setLoading(true);

        getProductPurchaseHistory(product.id)
            .then((data) => {
                if (!cancelled) {
                    setHistory(data);
                    // Default to deliveries if no incoming orders exist
                    if (data.incomingPOs.length === 0 && data.deliveries.length > 0) {
                        setActiveTab("deliveries");
                    } else {
                        setActiveTab("incoming");
                    }
                }
            })
            .catch((err) => {
                console.error("Failed to load product purchase history:", err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, product?.id]);

    if (!product) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="bg-surface-navy/98 backdrop-blur-2xl border-surface-hover/80 text-white max-w-4xl max-h-[88vh] overflow-y-auto p-6 shadow-2xl custom-scrollbar">
                <DialogHeader className="border-b border-surface-hover/50 pb-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                            <Truck className="size-5 text-emerald-400" />
                            <span>Purchase Order & Intake History</span>
                        </DialogTitle>
                        <Badge variant="outline" className="font-mono text-xs border-primary/40 text-primary">
                            SKU: {product.sku}
                        </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-moonstone mt-1">
                        <span className="font-medium text-white">{product.name}</span>
                        <span>Location: {product.location || 'Showcase Tray A'}</span>
                    </div>
                </DialogHeader>

                {/* Metrics Summary Strip */}
                <div className="grid grid-cols-3 gap-3 my-4">
                    <div className="bg-bg-navy/60 border border-surface-hover/60 rounded-xl p-3 flex flex-col justify-between">
                        <span className="text-[11px] font-medium text-moonstone uppercase tracking-wider">
                            Current On-Hand
                        </span>
                        <div className="flex items-baseline gap-1 mt-1">
                            <span className="text-xl font-bold font-mono text-white">
                                {product.stock}
                            </span>
                            <span className="text-xs text-moonstone">units</span>
                        </div>
                    </div>

                    <div className="bg-bg-navy/60 border border-amber-500/25 rounded-xl p-3 flex flex-col justify-between">
                        <span className="text-[11px] font-medium text-amber-300 uppercase tracking-wider flex items-center gap-1">
                            <Clock className="size-3" /> Incoming (Ordered)
                        </span>
                        <div className="flex items-baseline gap-1 mt-1">
                            <span className="text-xl font-bold font-mono text-amber-300">
                                {loading ? "..." : (history?.totalPendingArrival || 0)}
                            </span>
                            <span className="text-xs text-moonstone">units</span>
                        </div>
                    </div>

                    <div className="bg-bg-navy/60 border border-emerald-500/25 rounded-xl p-3 flex flex-col justify-between">
                        <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="size-3" /> Lifetime Received
                        </span>
                        <div className="flex items-baseline gap-1 mt-1">
                            <span className="text-xl font-bold font-mono text-emerald-400">
                                {loading ? "..." : (history?.totalLifetimeReceived || 0)}
                            </span>
                            <span className="text-xs text-moonstone">units</span>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-2 border-b border-surface-hover/50 pb-2 mb-4">
                    <button
                        onClick={() => setActiveTab("incoming")}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                            activeTab === "incoming"
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                : "text-moonstone hover:text-white"
                        }`}
                    >
                        <Clock className="size-3.5" />
                        <span>Incoming POs</span>
                        {history && history.incomingPOs.length > 0 && (
                            <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded-full ml-1">
                                {history.incomingPOs.length}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => setActiveTab("deliveries")}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                            activeTab === "deliveries"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "text-moonstone hover:text-white"
                        }`}
                    >
                        <PackageCheck className="size-3.5" />
                        <span>Stock Intake History (GRNs)</span>
                        {history && history.deliveries.length > 0 && (
                            <span className="bg-emerald-400 text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded-full ml-1">
                                {history.deliveries.length}
                            </span>
                        )}
                    </button>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-moonstone">
                        <Loader2 className="size-7 animate-spin text-primary" />
                        <span className="text-xs">Fetching PO and delivery records...</span>
                    </div>
                ) : activeTab === "incoming" ? (
                    /* Incoming POs Tab */
                    <div className="space-y-4">
                        {(!history || history.incomingPOs.length === 0) ? (
                            <div className="text-center py-10 border border-dashed border-surface-hover/60 rounded-xl bg-bg-navy/30 space-y-3">
                                <AlertCircle className="size-8 mx-auto text-moonstone/50" />
                                <p className="text-sm text-moonstone">No pending Purchase Orders for this item.</p>
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        onClose();
                                        router.push("/purchase/create");
                                    }}
                                    className="bg-primary text-primary-foreground text-xs"
                                >
                                    <Plus className="size-3.5 mr-1" /> Create Purchase Order
                                </Button>
                            </div>
                        ) : (
                            <div className="border border-surface-hover/60 rounded-xl overflow-hidden bg-bg-navy/40">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-surface-hover/50 text-xs bg-surface-navy/70">
                                            <TableHead className="text-moonstone font-semibold">PO #</TableHead>
                                            <TableHead className="text-moonstone font-semibold">Vendor</TableHead>
                                            <TableHead className="text-moonstone font-semibold">Ordered Date</TableHead>
                                            <TableHead className="text-moonstone font-semibold text-center">Ordered</TableHead>
                                            <TableHead className="text-moonstone font-semibold text-center">Received</TableHead>
                                            <TableHead className="text-moonstone font-semibold text-center">Pending</TableHead>
                                            <TableHead className="text-moonstone font-semibold text-right">Unit Cost</TableHead>
                                            <TableHead className="text-moonstone font-semibold text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {history.incomingPOs.map((po, idx) => (
                                            <TableRow key={`${po.poId}-${idx}`} className="border-surface-hover/30 text-xs hover:bg-surface-navy/50">
                                                <TableCell className="font-mono font-semibold text-white">
                                                    {po.poNumber}
                                                </TableCell>
                                                <TableCell className="text-moonstone">{po.vendorName}</TableCell>
                                                <TableCell className="text-moonstone">
                                                    {po.orderDate ? format(new Date(po.orderDate), "dd MMM yyyy") : "-"}
                                                </TableCell>
                                                <TableCell className="text-center font-mono">{po.quantityOrdered}</TableCell>
                                                <TableCell className="text-center font-mono text-emerald-400">
                                                    {po.quantityReceived}
                                                </TableCell>
                                                <TableCell className="text-center font-mono font-bold text-amber-300">
                                                    {po.quantityPending}
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatINR(po.unitPrice)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        onClick={() => {
                                                            onClose();
                                                            router.push(`/purchase/detail?id=${po.poId}`);
                                                        }}
                                                        className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white px-2.5"
                                                    >
                                                        Take Delivery <ArrowUpRight className="size-3 ml-1" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Stock Intake History Tab */
                    <div className="space-y-4">
                        {(!history || history.deliveries.length === 0) ? (
                            <div className="text-center py-10 border border-dashed border-surface-hover/60 rounded-xl bg-bg-navy/30 space-y-2">
                                <PackageCheck className="size-8 mx-auto text-moonstone/50" />
                                <p className="text-sm text-moonstone">No delivery intakes recorded for this product yet.</p>
                            </div>
                        ) : (
                            <div className="border border-surface-hover/60 rounded-xl overflow-hidden bg-bg-navy/40">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-surface-hover/50 text-xs bg-surface-navy/70">
                                            <TableHead className="text-moonstone font-semibold">GRN #</TableHead>
                                            <TableHead className="text-moonstone font-semibold">Received Date</TableHead>
                                            <TableHead className="text-moonstone font-semibold">PO #</TableHead>
                                            <TableHead className="text-moonstone font-semibold">Vendor</TableHead>
                                            <TableHead className="text-moonstone font-semibold text-center">Qty Added</TableHead>
                                            <TableHead className="text-moonstone font-semibold">Receiver / Notes</TableHead>
                                            <TableHead className="text-moonstone font-semibold text-right">View PO</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {history.deliveries.map((delivery, idx) => (
                                            <TableRow key={`${delivery.grnId}-${idx}`} className="border-surface-hover/30 text-xs hover:bg-surface-navy/50">
                                                <TableCell className="font-mono font-semibold text-emerald-400">
                                                    {delivery.grnNumber}
                                                </TableCell>
                                                <TableCell className="text-moonstone">
                                                    {delivery.receivedDate ? format(new Date(delivery.receivedDate), "dd MMM yyyy, HH:mm") : "-"}
                                                </TableCell>
                                                <TableCell className="font-mono text-white">
                                                    {delivery.poNumber}
                                                </TableCell>
                                                <TableCell className="text-moonstone">{delivery.vendorName}</TableCell>
                                                <TableCell className="text-center font-mono font-bold text-emerald-400">
                                                    +{delivery.quantityReceived}
                                                </TableCell>
                                                <TableCell className="text-moonstone text-[11px]">
                                                    {delivery.receivedBy ? (
                                                        <span className="text-white font-medium">{delivery.receivedBy}</span>
                                                    ) : (
                                                        <span className="italic text-moonstone/60">System</span>
                                                    )}
                                                    {delivery.notes && (
                                                        <span className="block text-[10px] text-moonstone truncate max-w-[150px]">
                                                            {delivery.notes}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {delivery.poId ? (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => {
                                                                onClose();
                                                                router.push(`/purchase/detail?id=${delivery.poId}`);
                                                            }}
                                                            className="h-7 text-[11px] text-moonstone hover:text-white px-2"
                                                        >
                                                            <ExternalLink className="size-3 mr-1" /> Open
                                                        </Button>
                                                    ) : (
                                                        <span className="text-moonstone/40">-</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-surface-hover/50 text-xs text-moonstone">
                    <span>
                        All inventory intake movements are timestamped and tied to PO/GRN audit trails.
                    </span>
                    <Button variant="outline" size="sm" onClick={onClose} className="border-surface-hover text-white">
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
