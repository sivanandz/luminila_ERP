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
    Loader2,
    ArrowUpRight,
    AlertCircle,
} from "lucide-react";
import { getOpenPurchaseOrders, type PurchaseOrder } from "@/lib/purchase";
import { formatINR } from "@/lib/gst";

interface QuickReceivePOModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function QuickReceivePOModal({ isOpen, onClose }: QuickReceivePOModalProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState<PurchaseOrder[]>([]);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        getOpenPurchaseOrders()
            .then(setOrders)
            .catch((err) => console.error("Error loading open POs:", err))
            .finally(() => setLoading(false));
    }, [isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="bg-surface-navy/98 backdrop-blur-2xl border-surface-hover/80 text-white max-w-3xl max-h-[85vh] overflow-y-auto p-6 shadow-2xl custom-scrollbar">
                <DialogHeader className="border-b border-surface-hover/50 pb-4">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                            <Truck className="size-5 text-emerald-400" />
                            <span>Receive Inventory from Purchase Orders</span>
                        </DialogTitle>
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs font-mono">
                            {orders.length} Open {orders.length === 1 ? 'Order' : 'Orders'}
                        </Badge>
                    </div>
                    <p className="text-xs text-moonstone mt-1">
                        Select an active Purchase Order to inspect line items, match incoming goods to SKUs, and take delivery.
                    </p>
                </DialogHeader>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-moonstone">
                        <Loader2 className="size-7 animate-spin text-primary" />
                        <span className="text-xs">Loading open purchase orders...</span>
                    </div>
                ) : orders.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-surface-hover/60 rounded-xl bg-bg-navy/30 space-y-3">
                        <PackageCheck className="size-8 mx-auto text-moonstone/50" />
                        <p className="text-sm text-moonstone">No open purchase orders currently awaiting delivery.</p>
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
                    <div className="border border-surface-hover/60 rounded-xl overflow-hidden bg-bg-navy/40 my-3">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-surface-hover/50 text-xs bg-surface-navy/70">
                                    <TableHead className="text-moonstone font-semibold">PO #</TableHead>
                                    <TableHead className="text-moonstone font-semibold">Vendor</TableHead>
                                    <TableHead className="text-moonstone font-semibold">Order Date</TableHead>
                                    <TableHead className="text-moonstone font-semibold text-center">Status</TableHead>
                                    <TableHead className="text-moonstone font-semibold text-right">Total Amount</TableHead>
                                    <TableHead className="text-moonstone font-semibold text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {orders.map((po) => {
                                    const statusBadge =
                                        po.status === "sent"
                                            ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                            : po.status === "partial"
                                            ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
                                            : "bg-gray-500/15 text-gray-400 border-gray-500/30";

                                    return (
                                        <TableRow key={po.id} className="border-surface-hover/30 text-xs hover:bg-surface-navy/50">
                                            <TableCell className="font-mono font-semibold text-white">
                                                {po.po_number}
                                            </TableCell>
                                            <TableCell className="text-moonstone font-medium">
                                                {po.vendor?.name || "Vendor"}
                                            </TableCell>
                                            <TableCell className="text-moonstone">
                                                {po.order_date ? format(new Date(po.order_date), "dd MMM yyyy") : "-"}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge className={`${statusBadge} uppercase text-[10px] tracking-wider font-bold`}>
                                                    {po.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-semibold text-champagne">
                                                {formatINR(po.total)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    onClick={() => {
                                                        onClose();
                                                        router.push(`/purchase/detail?id=${po.id}`);
                                                    }}
                                                    className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2.5"
                                                >
                                                    Take Delivery <ArrowUpRight className="size-3 ml-1" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-surface-hover/50 text-xs">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            onClose();
                            router.push("/purchase");
                        }}
                        className="text-moonstone hover:text-white"
                    >
                        View All Purchase Orders &rarr;
                    </Button>
                    <Button variant="outline" size="sm" onClick={onClose} className="border-surface-hover text-white">
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
