"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    ArrowLeft,
    Package,
    Truck,
    CheckCircle,
    Clock,
    XCircle,
    AlertCircle,
    Printer,
    Send,
    PackageCheck,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
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

import {
    getPurchaseOrder,
    updatePOStatus,
    cancelPurchaseOrder,
    createGRN,
    type PurchaseOrder,
    type POStatus,
    type GRNItem,
} from "@/lib/purchase";
import { formatINR } from "@/lib/gst";

const statusConfig: Record<POStatus, { label: string; icon: any; color: string }> = {
    draft: { label: "Draft", icon: Clock, color: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    sent: { label: "Sent", icon: Truck, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    partial: { label: "Partial", icon: AlertCircle, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    received: { label: "Received", icon: CheckCircle, color: "bg-green-500/20 text-green-400 border-green-500/30" },
    cancelled: { label: "Cancelled", icon: XCircle, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

function PurchaseOrderDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const poId = searchParams.get("id");

    const [po, setPo] = useState<PurchaseOrder | null>(null);
    const [loading, setLoading] = useState(true);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [receivingQuantities, setReceivingQuantities] = useState<Record<string, number>>({});
    const [receivedBy, setReceivedBy] = useState("");
    const [grnNotes, setGrnNotes] = useState("");
    const [processing, setProcessing] = useState(false);

    const fetchPO = async () => {
        if (!poId) return;
        setLoading(true);
        const data = await getPurchaseOrder(poId);
        setPo(data);
        setLoading(false);

        // Initialize receiving quantities
        if (data?.items) {
            const initial: Record<string, number> = {};
            data.items.forEach((item) => {
                const remaining = item.quantity_ordered - item.quantity_received;
                initial[item.id!] = remaining > 0 ? remaining : 0;
            });
            setReceivingQuantities(initial);
        }
    };

    useEffect(() => {
        fetchPO();
    }, [poId]);

    const handleSendPO = async () => {
        if (!po) return;
        setProcessing(true);
        try {
            await updatePOStatus(po.id!, "sent");
            fetchPO();
        } catch (error) {
            console.error("Error:", error);
        } finally {
            setProcessing(false);
        }
    };

    const handleCancel = async () => {
        if (!po) return;
        try {
            await cancelPurchaseOrder(po.id!);
            fetchPO();
        } catch (error) {
            console.error("Error:", error);
        }
        setShowCancelConfirm(false);
    };

    const handleReceiveGoods = async () => {
        if (!po) return;

        const grnItems: GRNItem[] = po.items
            .filter((item) => receivingQuantities[item.id!] > 0)
            .map((item) => ({
                po_item_id: item.id,
                variant_id: item.variant_id,
                quantity_received: receivingQuantities[item.id!] || 0,
                quantity_rejected: 0,
            }));

        if (grnItems.length === 0) {
            alert("Please enter quantities to receive");
            return;
        }

        setProcessing(true);
        try {
            await createGRN({
                po_id: po.id,
                vendor_id: po.vendor_id,
                received_date: new Date().toISOString(),
                received_by: receivedBy || undefined,
                notes: grnNotes || undefined,
                items: grnItems,
            });

            setShowReceiveModal(false);
            fetchPO();
        } catch (error) {
            console.error("Error creating GRN:", error);
            alert("Failed to receive goods");
        } finally {
            setProcessing(false);
        }
    };

    if (!poId) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-muted-foreground">Invalid Order ID</div>
                <Button variant="outline" onClick={() => router.push("/purchase")}>
                    Back to Purchase Orders
                </Button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    if (!po) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="text-muted-foreground">Purchase order not found</div>
                <Button variant="outline" onClick={() => router.push("/purchase")}>
                    Back to Purchase Orders
                </Button>
            </div>
        );
    }

    const StatusIcon = statusConfig[po.status].icon;
    const canReceive = po.status === "sent" || po.status === "partial";
    const canCancel = po.status === "draft" || po.status === "sent";
    const canSend = po.status === "draft";

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title={po.po_number || "Purchase Order"}
                subtitle={po.vendor?.name}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Actions Bar */}
                    <div className="flex items-center justify-between">
                        <Button variant="ghost" onClick={() => router.push("/purchase")}>
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back
                        </Button>

                        <div className="flex items-center gap-2">
                            {canSend && (
                                <Button
                                    variant="outline"
                                    onClick={handleSendPO}
                                    disabled={processing}
                                >
                                    <Send className="w-4 h-4 mr-2" />
                                    Mark as Sent
                                </Button>
                            )}

                            {canReceive && (
                                <Button
                                    onClick={() => setShowReceiveModal(true)}
                                    className=""
                                >
                                    <PackageCheck className="w-4 h-4 mr-2" />
                                    Receive Goods
                                </Button>
                            )}

                            {canCancel && (
                                <Button
                                    variant="outline"
                                    className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                                    onClick={() => setShowCancelConfirm(true)}
                                >
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Cancel PO
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Content */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Items */}
                            <Card className="bg-card/50 border-border/50">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Package className="w-5 h-5" />
                                        Order Items
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-border/50">
                                                <TableHead>Item</TableHead>
                                                <TableHead className="text-center">Ordered</TableHead>
                                                <TableHead className="text-center">Received</TableHead>
                                                <TableHead className="text-right">Unit Price</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {po.items?.map((item) => {
                                                const pending = item.quantity_ordered - item.quantity_received;
                                                return (
                                                    <TableRow key={item.id} className="border-border/50">
                                                        <TableCell>
                                                            <div>
                                                                <p className="font-medium">{item.description}</p>
                                                                {item.variant && (
                                                                    <p className="text-xs text-muted-foreground">
                                                                        {item.variant.product?.sku}-{item.variant.sku_suffix}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-center font-mono">
                                                            {item.quantity_ordered}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <span className="font-mono">{item.quantity_received}</span>
                                                                {pending > 0 && (
                                                                    <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-400">
                                                                        {pending} pending
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono">
                                                            {formatINR(item.unit_price)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono font-semibold">
                                                            {formatINR(item.total_price)}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>

                                    {/* Totals */}
                                    <div className="flex justify-end mt-4 pt-4 border-t border-border/50">
                                        <div className="w-64 space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">Subtotal</span>
                                                <span className="font-mono">{formatINR(po.subtotal)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">GST</span>
                                                <span className="font-mono">{formatINR(po.gst_amount)}</span>
                                            </div>
                                            {po.shipping_cost > 0 && (
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">Shipping</span>
                                                    <span className="font-mono">{formatINR(po.shipping_cost)}</span>
                                                </div>
                                            )}
                                            {po.discount_amount > 0 && (
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">Discount</span>
                                                    <span className="font-mono text-green-400">-{formatINR(po.discount_amount)}</span>
                                                </div>
                                            )}
                                            <div className="border-t border-border/50 pt-2 flex justify-between font-semibold">
                                                <span>Total</span>
                                                <span className="font-mono text-champagne">{formatINR(po.total)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-6">
                            {/* Status */}
                            <Card className="bg-card/50 border-border/50">
                                <CardHeader>
                                    <CardTitle className="text-sm">Order Status</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Badge className={`${statusConfig[po.status].color} text-sm`}>
                                        <StatusIcon className="w-4 h-4 mr-1" />
                                        {statusConfig[po.status].label}
                                    </Badge>

                                    <div className="mt-4 space-y-3 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Order Date</span>
                                            <span>{format(new Date(po.order_date), "dd MMM yyyy")}</span>
                                        </div>
                                        {po.expected_date && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Expected</span>
                                                <span>{format(new Date(po.expected_date), "dd MMM yyyy")}</span>
                                            </div>
                                        )}
                                        {po.received_date && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Received</span>
                                                <span className="text-green-400">
                                                    {format(new Date(po.received_date), "dd MMM yyyy")}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Vendor */}
                            <Card className="bg-card/50 border-border/50">
                                <CardHeader>
                                    <CardTitle className="text-sm">Vendor</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <p className="font-semibold">{po.vendor?.name}</p>
                                    {po.vendor?.phone && (
                                        <p className="text-sm text-muted-foreground">{po.vendor.phone}</p>
                                    )}
                                    {po.vendor?.email && (
                                        <p className="text-sm text-muted-foreground">{po.vendor.email}</p>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Notes */}
                            {po.notes && (
                                <Card className="bg-card/50 border-border/50">
                                    <CardHeader>
                                        <CardTitle className="text-sm">Notes</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">{po.notes}</p>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Receive Goods Modal */}
            <Dialog open={showReceiveModal} onOpenChange={setShowReceiveModal}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Receive Goods - GRN</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Item</TableHead>
                                    <TableHead className="text-center">Pending</TableHead>
                                    <TableHead className="text-center">Receive Qty</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {po.items?.map((item) => {
                                    const pending = item.quantity_ordered - item.quantity_received;
                                    if (pending <= 0) return null;
                                    return (
                                        <TableRow key={item.id}>
                                            <TableCell>{item.description}</TableCell>
                                            <TableCell className="text-center font-mono">{pending}</TableCell>
                                            <TableCell className="text-center">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max={pending}
                                                    value={receivingQuantities[item.id!] || 0}
                                                    onChange={(e) =>
                                                        setReceivingQuantities({
                                                            ...receivingQuantities,
                                                            [item.id!]: Math.min(parseInt(e.target.value) || 0, pending),
                                                        })
                                                    }
                                                    className="w-20 mx-auto"
                                                />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Received By</Label>
                                <Input
                                    value={receivedBy}
                                    onChange={(e) => setReceivedBy(e.target.value)}
                                    placeholder="Name of receiver"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Notes</Label>
                                <Input
                                    value={grnNotes}
                                    onChange={(e) => setGrnNotes(e.target.value)}
                                    placeholder="GRN notes"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <Button variant="outline" onClick={() => setShowReceiveModal(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleReceiveGoods}
                                disabled={processing}
                                className=""
                            >
                                {processing ? "Processing..." : "Confirm Receipt"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Cancel Confirmation */}
            <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Purchase Order?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will cancel {po.po_number}. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep PO</AlertDialogCancel>
                        <AlertDialogAction onClick={handleCancel} className="bg-red-600">
                            Cancel PO
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default function PurchaseOrderDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
            <PurchaseOrderDetailContent />
        </Suspense>
    );
}
