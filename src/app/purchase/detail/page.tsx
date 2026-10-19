"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
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
    Send,
    PackageCheck,
    Printer,
    Tag,
    ExternalLink,
    Sparkles,
    Check,
    AlertTriangle,
    Loader2,
    Coins,
    ShieldAlert,
    ShieldCheck,
    FileSpreadsheet,
    type LucideIcon,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    DialogDescription,
    DialogFooter,
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    getPurchaseOrder,
    updatePOStatus,
    cancelPurchaseOrder,
    createGRN,
    getGRNsForPO,
    quickCreateInventoryProductForPOItem,
    linkPOItemToVariant,
    approvePODiscrepancy,
    type PurchaseOrder,
    type POStatus,
    type GRNItem,
    type GoodsReceivedNote,
    type PurchaseOrderItem,
} from "@/lib/purchase";
import { pb } from "@/lib/pocketbase";
import { formatINR } from "@/lib/gst";
import { toast } from "sonner";
import { QuickProductModal, type QuickProductCreatedResult } from "@/components/inventory";

const statusConfig: Record<POStatus, { label: string; icon: LucideIcon; color: string }> = {
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
    const [grns, setGrns] = useState<GoodsReceivedNote[]>([]);
    const [availableVariants, setAvailableVariants] = useState<Array<{ id: string; name: string; sku: string; stock_level: number }>>([]);
    const [matchedVariants, setMatchedVariants] = useState<Record<string, string>>({});
    const [creatingSkuForItemId, setCreatingSkuForItemId] = useState<string | null>(null);

    // Modal state for registering uncataloged vendor items into inventory with specs
    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [registerTargetItem, setRegisterTargetItem] = useState<PurchaseOrderItem | null>(null);

    const [loading, setLoading] = useState(true);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [receivingQuantities, setReceivingQuantities] = useState<Record<string, number>>({});
    const [receivedBy, setReceivedBy] = useState("");
    const [grnNotes, setGrnNotes] = useState("");
    const [processing, setProcessing] = useState(false);

    // Discrepancy approval modal state
    const [showApprovalModal, setShowApprovalModal] = useState(false);
    const [approvalRemarks, setApprovalRemarks] = useState("");
    const [approverName, setApproverName] = useState("");
    const [approving, setApproving] = useState(false);

    const handleApproveDiscrepancy = async () => {
        if (!approvalRemarks.trim()) {
            toast.error("Manager remarks are strictly required to approve this discrepancy.");
            return;
        }
        if (!po?.id) return;
        setApproving(true);
        try {
            const updated = await approvePODiscrepancy(po.id, approvalRemarks, approverName);
            setPo(updated);
            setShowApprovalModal(false);
            setApprovalRemarks("");
            toast.success("PO cost discrepancy approved successfully!");
        } catch (err: any) {
            console.error("Discrepancy approval error:", err);
            toast.error(err.message || "Failed to approve discrepancy");
        } finally {
            setApproving(false);
        }
    };

    const fetchPO = useCallback(async () => {
        if (!poId) return;
        setLoading(true);
        try {
            const [data, grnList] = await Promise.all([
                getPurchaseOrder(poId),
                getGRNsForPO(poId),
            ]);
            setPo(data);
            setGrns(grnList);

            // Initialize receiving quantities and variant linkages
            if (data?.items) {
                const initial: Record<string, number> = {};
                const linkages: Record<string, string> = {};
                data.items.forEach((item) => {
                    const remaining = item.quantity_ordered - item.quantity_received;
                    initial[item.id!] = remaining > 0 ? remaining : 0;
                    if (item.variant_id) {
                        linkages[item.id!] = item.variant_id;
                    }
                });
                setReceivingQuantities(initial);
                setMatchedVariants(linkages);
            }
        } catch (err) {
            console.error("Error loading PO or GRNs:", err);
            toast.error("Failed to load purchase order details");
        } finally {
            setLoading(false);
        }
    }, [poId]);

    useEffect(() => {
        fetchPO();
    }, [fetchPO]);

    useEffect(() => {
        const loadVariants = async () => {
            try {
                const vars = await pb.collection('product_variants').getFullList({
                    expand: 'product',
                    sort: 'product.name',
                });
                setAvailableVariants(
                    vars.map((v: any) => ({
                        id: v.id,
                        name: v.expand?.product?.name ? `${v.expand.product.name} (${v.variant_name})` : v.variant_name,
                        sku: v.expand?.product?.sku ? (v.sku_suffix ? `${v.expand.product.sku}-${v.sku_suffix}` : v.expand.product.sku) : v.id,
                        stock_level: v.stock_level || 0,
                    }))
                );
            } catch (err) {
                console.error("Failed to load variants:", err);
            }
        };
        loadVariants();
    }, []);

    const handleAutoCreateSKU = async (item: PurchaseOrderItem) => {
        if (!item.id) return;
        setCreatingSkuForItemId(item.id);
        try {
            const result = await quickCreateInventoryProductForPOItem(item.id, {
                name: item.description,
                cost_price: item.unit_price,
                hsn_code: item.hsn_code,
            });
            setMatchedVariants(prev => ({ ...prev, [item.id!]: result.variantId }));
            toast.success(`Created SKU ${result.sku} and linked to this PO line!`);
            fetchPO();
        } catch (err) {
            console.error("Error auto-creating SKU:", err);
            toast.error("Failed to create SKU in inventory");
        } finally {
            setCreatingSkuForItemId(null);
        }
    };

    const openRegisterModalForPOItem = (item: PurchaseOrderItem) => {
        setRegisterTargetItem(item);
        setShowRegisterModal(true);
    };

    const handleRegisterSuccess = (result: QuickProductCreatedResult) => {
        if (registerTargetItem?.id) {
            setMatchedVariants(prev => ({ ...prev, [registerTargetItem.id!]: result.variantId }));
            fetchPO();
        }
    };

    const handleSelectVariant = async (itemId: string, variantId: string) => {
        setMatchedVariants(prev => ({ ...prev, [itemId]: variantId }));
        try {
            await linkPOItemToVariant(itemId, variantId);
            toast.success("Linked item to inventory SKU");
            fetchPO();
        } catch (err) {
            console.error("Error linking item to variant:", err);
            toast.error("Failed to link item");
        }
    };

    const handleSendPO = async () => {
        if (!po) return;
        setProcessing(true);
        try {
            await updatePOStatus(po.id!, "sent");
            toast.success("Purchase order marked as Sent");
            fetchPO();
        } catch (error) {
            console.error("Error:", error);
            toast.error("Failed to update status");
        } finally {
            setProcessing(false);
        }
    };

    const handleCancel = async () => {
        if (!po) return;
        try {
            await cancelPurchaseOrder(po.id!);
            toast.success("Purchase order cancelled");
            fetchPO();
        } catch (error) {
            console.error("Error:", error);
            toast.error("Failed to cancel purchase order");
        }
        setShowCancelConfirm(false);
    };

    const handleReceiveGoods = async () => {
        if (!po) return;

        const grnItems: GRNItem[] = po.items
            .filter((item) => (receivingQuantities[item.id!] || 0) > 0)
            .map((item) => ({
                po_item_id: item.id,
                variant_id: matchedVariants[item.id!] || item.variant_id,
                quantity_received: receivingQuantities[item.id!] || 0,
                quantity_rejected: 0,
            }));

        if (grnItems.length === 0) {
            toast.error("Please enter at least one quantity to receive");
            return;
        }

        const unlinked = grnItems.filter(i => !i.variant_id);
        if (unlinked.length > 0) {
            const proceed = confirm(
                `${unlinked.length} item(s) are not matched to an Inventory SKU. Their delivery will be recorded on the PO, but stock won't be incremented in Inventory until matched. Continue?`
            );
            if (!proceed) return;
        }

        setProcessing(true);
        try {
            const grn = await createGRN({
                po_id: po.id,
                vendor_id: po.vendor_id,
                received_date: new Date().toISOString(),
                received_by: receivedBy || undefined,
                notes: grnNotes || undefined,
                items: grnItems,
            });

            toast.success(`Receipt confirmed! GRN #${grn.grn_number} created and inventory stock updated.`);
            setShowReceiveModal(false);
            fetchPO();
        } catch (error) {
            console.error("Error creating GRN:", error);
            toast.error("Failed to receive goods");
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

                            <Button
                                variant="outline"
                                onClick={() => {
                                    const firstItem = po.items?.[0];
                                    if (firstItem) {
                                        const sku = firstItem.variant?.product?.sku || 'SKU-INWARD';
                                        const name = firstItem.variant?.product?.name || firstItem.description || 'Jewelry Item';
                                        const qty = firstItem.quantity_received || firstItem.quantity_ordered || 1;
                                        router.push(`/labels?sku=${encodeURIComponent(sku)}&name=${encodeURIComponent(name)}&price=${firstItem.unit_price}&qty=${qty}`);
                                    } else {
                                        router.push('/labels');
                                    }
                                }}
                                className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 font-bold"
                            >
                                <Tag className="w-4 h-4 mr-2 text-emerald-400" />
                                Print Inward Barcode Labels
                            </Button>

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

                    {/* Blanket PO Value-Based Banner & Discrepancy Gate */}
                    {po.po_type === 'blanket' && (
                        <Card className={`border ${
                            po.discrepancy_status === 'over_budget'
                                ? 'bg-red-500/10 border-red-500/40'
                                : po.discrepancy_status === 'under_budget'
                                ? 'bg-amber-500/10 border-amber-500/40'
                                : 'bg-card border-border'
                        }`}>
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2">
                                        <Coins className="w-5 h-5 text-amber-500" />
                                        <CardTitle className="text-base font-semibold">Blanket / Budget Procurement PO</CardTitle>
                                        <Badge variant="outline" className="font-mono text-xs border-amber-500/30 text-amber-500">
                                            Value-Based
                                        </Badge>
                                    </div>

                                    {/* Discrepancy Badges & Approval Trigger */}
                                    <div className="flex items-center gap-2">
                                        {po.discrepancy_status === 'over_budget' && (
                                            <Badge className="bg-red-500/20 text-red-400 border border-red-500/30">
                                                Over Budget by {formatINR(Math.abs(po.discrepancy_amount || 0))}
                                            </Badge>
                                        )}
                                        {po.discrepancy_status === 'under_budget' && (
                                            <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                                Under Budget by {formatINR(Math.abs(po.discrepancy_amount || 0))}
                                            </Badge>
                                        )}
                                        {po.discrepancy_status === 'balanced' && (
                                            <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                Balanced
                                            </Badge>
                                        )}

                                        {po.approval_status === 'pending_approval' && (
                                            <Button
                                                size="sm"
                                                onClick={() => setShowApprovalModal(true)}
                                                className="h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white font-bold"
                                            >
                                                <ShieldAlert className="w-3.5 h-3.5 mr-1" />
                                                Approve Discrepancy
                                            </Button>
                                        )}
                                        {po.approval_status === 'approved' && (
                                            <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 text-xs">
                                                <ShieldCheck className="w-3.5 h-3.5" />
                                                Approved
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                <CardDescription className="text-xs">
                                    Budgeted procurement commitment for stock intake with timestamp reference <span className="font-mono text-primary font-semibold">{po.po_number}</span>.
                                </CardDescription>
                            </CardHeader>

                            <CardContent className="space-y-4 pt-1">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-muted/20 border border-border/50 text-sm font-mono">
                                    <div>
                                        <span className="text-xs text-muted-foreground block">Budgeted Value</span>
                                        <span className="text-lg font-bold text-foreground">{formatINR(po.budget_amount || po.subtotal)}</span>
                                    </div>
                                    <div>
                                        <span className="text-xs text-muted-foreground block">Inward Goods Received</span>
                                        <span className="text-lg font-bold text-primary">{formatINR(po.inward_goods_cost || 0)}</span>
                                    </div>
                                    <div>
                                        <span className="text-xs text-muted-foreground block">Overheads (GST + Ship)</span>
                                        <span className="text-base font-semibold text-foreground">
                                            {formatINR((po.gst_paid_overhead || 0) + (po.shipping_overhead || 0))}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground block font-sans">
                                            {po.absorb_overhead ? "✓ Absorbed into Unit Cost" : "Separate PO Expense"}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-xs text-muted-foreground block">Cost Variance</span>
                                        <span className={`text-lg font-bold ${
                                            (po.discrepancy_amount || 0) > 0 ? "text-red-400" : (po.discrepancy_amount || 0) < 0 ? "text-amber-400" : "text-emerald-400"
                                        }`}>
                                            {(po.discrepancy_amount || 0) > 0 ? "+" : ""}{formatINR(po.discrepancy_amount || 0)}
                                        </span>
                                    </div>
                                </div>

                                {/* Approval History Audit Box */}
                                {po.approval_status === 'approved' && (
                                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 space-y-1">
                                        <div className="flex items-center gap-2 font-medium">
                                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                            <span>Discrepancy Authorized &amp; Approved by {po.approved_by || 'Store Manager'}</span>
                                            {po.approved_at && (
                                                <span className="text-muted-foreground text-[11px]">
                                                    ({format(new Date(po.approved_at), "dd MMM yyyy, HH:mm")})
                                                </span>
                                            )}
                                        </div>
                                        {po.approval_remarks && (
                                            <p className="italic text-muted-foreground pl-6">
                                                Remarks: &ldquo;{po.approval_remarks}&rdquo;
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Intake Action Helpers */}
                                <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border/40">
                                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                        <span>Seller Tax Profile:</span>
                                        <Badge variant="outline" className="text-[10px]">
                                            {po.is_unregistered_seller ? "Unregistered (No GST Refund)" : "Registered GST Vendor"}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => router.push(`/inventory?inwardPo=${encodeURIComponent(po.po_number || '')}`)}
                                            className="h-8 text-xs border-primary/40 text-primary hover:bg-primary/10"
                                        >
                                            <Package className="w-3.5 h-3.5 mr-1" />
                                            Scan / Inward Items under this PO
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

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
                                                                {item.variant ? (
                                                                    <p className="text-xs text-muted-foreground font-mono">
                                                                        SKU: {item.variant.product?.sku}-{item.variant.sku_suffix}
                                                                    </p>
                                                                ) : (
                                                                    <div className="flex items-center gap-2 mt-1">
                                                                        <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px]">
                                                                            <Sparkles className="size-2.5 mr-1" />
                                                                            Fresh Vendor Item (Uncataloged)
                                                                        </Badge>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => openRegisterModalForPOItem(item)}
                                                                            className="text-[10px] text-amber-400 hover:text-amber-300 underline font-medium"
                                                                        >
                                                                            + Register in Catalog
                                                                        </button>
                                                                    </div>
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

                            {/* Delivered Shipments & Stock Intake History */}
                            <Card className="bg-card/50 border-border/50">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2">
                                        <Truck className="w-5 h-5 text-emerald-400" />
                                        <span>Delivered Shipments & Stock Intake (GRNs)</span>
                                    </CardTitle>
                                    <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400 font-mono">
                                        {grns.length} {grns.length === 1 ? 'Shipment' : 'Shipments'}
                                    </Badge>
                                </CardHeader>
                                <CardContent>
                                    {grns.length === 0 ? (
                                        <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border/50 rounded-lg">
                                            <PackageCheck className="w-8 h-8 mx-auto mb-2 opacity-40 text-muted-foreground" />
                                            <p>No goods have been received for this Purchase Order yet.</p>
                                            {canReceive && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="mt-3 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                                    onClick={() => setShowReceiveModal(true)}
                                                >
                                                    <PackageCheck className="w-4 h-4 mr-1.5" />
                                                    Take First Delivery
                                                </Button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {grns.map((grn) => (
                                                <div key={grn.id} className="border border-border/50 rounded-lg p-4 bg-bg-navy/40 space-y-3">
                                                    <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border/40 text-xs">
                                                        <div className="flex items-center gap-2">
                                                            <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono font-bold">
                                                                {grn.grn_number}
                                                            </Badge>
                                                            <span className="text-muted-foreground">
                                                                Received: {format(new Date(grn.received_date), "dd MMM yyyy, HH:mm")}
                                                            </span>
                                                        </div>
                                                        {grn.received_by && (
                                                            <span className="text-muted-foreground">
                                                                Receiver: <strong className="text-white">{grn.received_by}</strong>
                                                            </span>
                                                        )}
                                                    </div>

                                                    {grn.notes && (
                                                        <p className="text-xs italic text-muted-foreground bg-surface-navy/40 px-2.5 py-1 rounded">
                                                            &ldquo;{grn.notes}&rdquo;
                                                        </p>
                                                    )}

                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow className="border-border/30 text-xs">
                                                                <TableHead className="py-1">Received Item</TableHead>
                                                                <TableHead className="py-1">Matched SKU</TableHead>
                                                                <TableHead className="py-1 text-center">Qty Added</TableHead>
                                                                <TableHead className="py-1 text-right">Inventory Action</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {grn.items.map((item, idx) => {
                                                                const variantSku = item.variant?.product?.sku
                                                                    ? (item.variant.sku_suffix ? `${item.variant.product.sku}-${item.variant.sku_suffix}` : item.variant.product.sku)
                                                                    : null;
                                                                return (
                                                                    <TableRow key={item.id || idx} className="border-border/20 text-xs">
                                                                        <TableCell className="py-2 font-medium">
                                                                            {item.po_item?.description || "PO Line Item"}
                                                                        </TableCell>
                                                                        <TableCell className="py-2 font-mono">
                                                                            {variantSku ? (
                                                                                <Badge variant="outline" className="border-primary/40 text-primary text-[11px]">
                                                                                    {variantSku}
                                                                                </Badge>
                                                                            ) : (
                                                                                <span className="text-amber-400 text-xs">Unlinked</span>
                                                                            )}
                                                                        </TableCell>
                                                                        <TableCell className="py-2 text-center font-mono font-bold text-emerald-400">
                                                                            +{item.quantity_received} units
                                                                        </TableCell>
                                                                        <TableCell className="py-2 text-right">
                                                                            {variantSku && (
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant="ghost"
                                                                                    className="h-7 text-xs text-moonstone hover:text-white px-2"
                                                                                    onClick={() => router.push(`/inventory?search=${encodeURIComponent(item.variant?.product?.sku || variantSku)}`)}
                                                                                >
                                                                                    <ExternalLink className="w-3 h-3 mr-1" /> View Stock
                                                                                </Button>
                                                                            )}
                                                                        </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            ))}
                                        </div>
                                    )}
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
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <PackageCheck className="w-5 h-5 text-emerald-400" />
                            <span>Take Delivery & Match Inventory Intake</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-xs text-muted-foreground">
                            Specify received quantities below. Each item will be added to its matched Inventory SKU and recorded in stock movement audit logs.
                        </p>

                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Line Item & Inventory Match</TableHead>
                                    <TableHead className="text-center w-24">Pending</TableHead>
                                    <TableHead className="text-center w-28">Receive Qty</TableHead>
                                    <TableHead className="text-center w-36">Projected Stock</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {po.items?.map((item) => {
                                    const pending = item.quantity_ordered - item.quantity_received;
                                    if (pending <= 0) return null;

                                    const currentVariantId = matchedVariants[item.id!] || item.variant_id;
                                    const currentVariant = availableVariants.find(v => v.id === currentVariantId);
                                    const hasMatch = Boolean(currentVariantId && currentVariant);
                                    const receivingQty = receivingQuantities[item.id!] || 0;
                                    const onHandStock = currentVariant?.stock_level ?? ((item.variant as any)?.stock_level || 0);

                                    return (
                                        <TableRow key={item.id} className="align-top">
                                            <TableCell className="space-y-1.5 py-3">
                                                <div className="font-medium text-sm text-white">{item.description}</div>
                                                <div className="text-xs text-muted-foreground font-mono">
                                                    Rate: {formatINR(item.unit_price)}/unit
                                                </div>

                                                {hasMatch ? (
                                                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                                                        <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-mono">
                                                            <Check className="w-3 h-3 mr-1" />
                                                            {currentVariant?.sku}
                                                        </Badge>
                                                        <span className="text-[11px] text-moonstone">
                                                            (On-hand: <strong className="text-white">{onHandStock}</strong>)
                                                        </span>
                                                        <Select
                                                            value={currentVariantId}
                                                            onValueChange={(val) => val && handleSelectVariant(item.id!, val)}
                                                        >
                                                            <SelectTrigger className="h-6 text-[10px] px-2 w-auto bg-transparent border-border/40 text-muted-foreground hover:text-white">
                                                                <SelectValue placeholder="Change SKU" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {availableVariants.map(v => (
                                                                    <SelectItem key={v.id} value={v.id}>
                                                                        {v.sku} - {v.name} (Stock: {v.stock_level})
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2 pt-1">
                                                        <div className="flex items-center gap-2">
                                                            <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[11px]">
                                                                <AlertTriangle className="w-3 h-3 mr-1" />
                                                                Unlinked (No Inventory SKU)
                                                            </Badge>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Select
                                                                value=""
                                                                onValueChange={(val) => val && handleSelectVariant(item.id!, val)}
                                                            >
                                                                <SelectTrigger className="h-7 text-xs bg-bg-navy/80 border-border/60 flex-1">
                                                                    <SelectValue placeholder="Match to existing SKU..." />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {availableVariants.map(v => (
                                                                        <SelectItem key={v.id} value={v.id}>
                                                                            {v.sku} - {v.name} (Stock: {v.stock_level})
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => openRegisterModalForPOItem(item)}
                                                                className="h-7 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/20 shrink-0"
                                                            >
                                                                <Sparkles className="w-3 h-3 mr-1 text-amber-400" />
                                                                Register with Specs
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={creatingSkuForItemId === item.id}
                                                                onClick={() => handleAutoCreateSKU(item)}
                                                                className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/20 shrink-0"
                                                            >
                                                                {creatingSkuForItemId === item.id ? (
                                                                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                                                ) : (
                                                                    <Sparkles className="w-3 h-3 mr-1 text-gold" />
                                                                )}
                                                                Auto-Create SKU
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center font-mono py-3 font-semibold text-yellow-400">
                                                {pending}
                                            </TableCell>
                                            <TableCell className="text-center py-3">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max={pending}
                                                    value={receivingQuantities[item.id!] ?? pending}
                                                    onChange={(e) =>
                                                        setReceivingQuantities({
                                                            ...receivingQuantities,
                                                            [item.id!]: Math.min(Math.max(0, parseInt(e.target.value) || 0), pending),
                                                        })
                                                    }
                                                    className="w-20 mx-auto text-center font-mono"
                                                />
                                            </TableCell>
                                            <TableCell className="text-center py-3 font-mono text-xs">
                                                <div className="text-muted-foreground">
                                                    {onHandStock} <span className="text-emerald-400">+{receivingQty}</span>
                                                </div>
                                                <div className="font-bold text-emerald-400 mt-0.5">
                                                    = {onHandStock + receivingQty} units
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>

                        <div className="grid grid-cols-2 gap-4 pt-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Received By</Label>
                                <Input
                                    value={receivedBy}
                                    onChange={(e) => setReceivedBy(e.target.value)}
                                    placeholder="Name of receiver or staff"
                                    className="h-9 text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Intake Notes / Inspection</Label>
                                <Input
                                    value={grnNotes}
                                    onChange={(e) => setGrnNotes(e.target.value)}
                                    placeholder="e.g. Inspected 100% fine, box intact"
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-3 border-t border-border/40">
                            <Button variant="outline" onClick={() => setShowReceiveModal(false)} disabled={processing}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleReceiveGoods}
                                disabled={processing}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                            >
                                {processing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Updating Stock...
                                    </>
                                ) : (
                                    <>
                                        <PackageCheck className="w-4 h-4 mr-2" />
                                        Confirm Receipt & Update Inventory
                                    </>
                                )}
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

            {/* Quick Product Modal for registering uncataloged items with specs */}
            <QuickProductModal
                isOpen={showRegisterModal}
                onClose={() => setShowRegisterModal(false)}
                onSuccess={handleRegisterSuccess}
                poItemId={registerTargetItem?.id}
                initialData={
                    registerTargetItem
                        ? {
                              name: registerTargetItem.description,
                              cost_price: registerTargetItem.unit_price,
                              hsn_code: registerTargetItem.hsn_code,
                          }
                        : undefined
                }
            />

            {/* Discrepancy Approval Modal */}
            <Dialog open={showApprovalModal} onOpenChange={setShowApprovalModal}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-500">
                            <ShieldAlert className="w-5 h-5 text-amber-500" />
                            <span>Approve Blanket PO Discrepancy</span>
                        </DialogTitle>
                        <DialogDescription>
                            A cost discrepancy has been detected between the inward goods and the budgeted allocation. Management approval with remarks is required.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-1.5 text-xs font-mono">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">PO Reference:</span>
                                <span className="font-bold text-foreground">{po.po_number}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Budgeted Allocation:</span>
                                <span>{formatINR(po.budget_amount || po.subtotal)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Actual Inward Cost:</span>
                                <span>{formatINR(po.inward_goods_cost || 0)}</span>
                            </div>
                            <div className="flex justify-between font-bold border-t border-border pt-1">
                                <span className="text-muted-foreground">Discrepancy:</span>
                                <span className={(po.discrepancy_amount || 0) > 0 ? "text-red-400" : "text-amber-400"}>
                                    {(po.discrepancy_amount || 0) > 0 ? "+" : ""}{formatINR(po.discrepancy_amount || 0)} ({(po.discrepancy_status || '').toUpperCase()})
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs font-semibold">Approver Name</Label>
                            <Input
                                placeholder="Store Manager / Admin"
                                value={approverName}
                                onChange={(e) => setApproverName(e.target.value)}
                                className="h-8 text-xs"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs font-semibold">
                                Approval Remarks * <span className="text-red-400 font-normal">(Mandatory reason for deviation)</span>
                            </Label>
                            <Textarea
                                placeholder="Explain why the cost differed (e.g. Rate variance, extra weight received, MOQ adjustment)..."
                                value={approvalRemarks}
                                onChange={(e) => setApprovalRemarks(e.target.value)}
                                rows={3}
                                className="text-xs"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowApprovalModal(false)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="bg-amber-600 hover:bg-amber-500 text-white"
                            onClick={handleApproveDiscrepancy}
                            disabled={approving || !approvalRemarks.trim()}
                        >
                            {approving ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                    Approving...
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                                    Authorize &amp; Approve
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
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
