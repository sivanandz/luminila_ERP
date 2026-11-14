"use client";

import { Header } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatPrice, safeFormatDate, sanitizeExternalUrl } from "@/lib/utils";
import {
    ArrowLeft,
    Printer,
    Mail,
    FileText,
    CheckCircle,
    XCircle,
    User,
    Calendar,
    MapPin,
    Truck,
    PackageCheck,
    GitBranch,
} from "lucide-react";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    getOrderDetails,
    convertEstimateToOrder,
    confirmSalesOrder,
    generateInvoiceFromOrder,
    cancelSalesOrder,
    canCancelSalesOrder,
    splitOrderForBackorder,
    type OrderDetail,
} from "@/lib/orders";
import { getStoreSettings, type StoreSettings } from "@/lib/settings";
import { toast } from "sonner";
import { OrderMilestoneBar } from "@/components/orders/OrderMilestoneBar";
import { ShippingLabelPrintModal } from "@/components/shipping/ShippingLabelPrintModal";
import { pb, getCurrentTenantEmail } from "@/lib/pocketbase";
import {
    listShipmentsForOrder,
    createShipmentForOrder,
    updateShipmentStatus,
    settleCodOrder,
    setExpectedDelivery,
    type ShipmentRow,
} from "@/lib/shipments";

function OrderDetailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const id = searchParams.get("id");

    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [settings, setSettings] = useState<StoreSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [showShippingLabel, setShowShippingLabel] = useState(false);
    const [shipments, setShipments] = useState<ShipmentRow[]>([]);
    const [expectedDelivery, setEtaDraft] = useState("");
    const [showShipmentDialog, setShowShipmentDialog] = useState(false);
    const [shipmentForm, setShipmentForm] = useState({ carrier: "", awbNumber: "", trackingUrl: "" });
    const [showCodDialog, setShowCodDialog] = useState(false);
    const [codReference, setCodReference] = useState("");
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [cancelReason, setCancelReason] = useState("");
    const [cancelRefundRef, setCancelRefundRef] = useState("");
    const [showSplitDialog, setShowSplitDialog] = useState(false);
    const [splitQuantities, setSplitQuantities] = useState<Record<string, number>>({});
    const [splitReason, setSplitReason] = useState("");

    useEffect(() => {
        getStoreSettings().then(setSettings).catch(() => {});
    }, []);

    const fetchOrder = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        const data = await getOrderDetails(id);
        if (data) {
            setOrder(data);
        } else {
            toast.error("Order not found");
            router.push('/orders');
        }
        setLoading(false);
    }, [id, router]);

    const fetchShipments = useCallback(async () => {
        if (!id) return;
        setShipments(await listShipmentsForOrder(pb, id));
    }, [id]);

    useEffect(() => {
        if (id) {
            fetchOrder();
            fetchShipments();
        }
    }, [id, fetchOrder, fetchShipments]);

    const handleConvert = async () => {
        if (!order) return;
        setActionLoading(true);
        const success = await convertEstimateToOrder(order.id);
        if (success) {
            fetchOrder(); // Refresh to show new status
        }
        setActionLoading(false);
    };

    const handleConfirm = async () => {
        if (!order) return;
        setActionLoading(true);
        const success = await confirmSalesOrder(order.id);
        if (success) {
            fetchOrder();
        }
        setActionLoading(false);
    };

    const handleInvoice = async () => {
        if (!order) return;
        setActionLoading(true);
        const result = await generateInvoiceFromOrder(order.id);
        if (result.success) {
            toast.success("Invoice generated successfully");
            fetchOrder();
            // Optionally redirect to invoice detail if we had the invoice ID
            // router.push(`/invoices/detail?id=${result.invoiceId}`);
        }
        setActionLoading(false);
    };

    const handleExpectedDelivery = async () => {
        if (!order || !expectedDelivery) return;
        setActionLoading(true);
        const result = await setExpectedDelivery(pb, order.id, expectedDelivery);
        if (result.success) {
            toast.success("Expected delivery updated");
            fetchOrder();
        } else {
            toast.error(result.error || "Could not update the expected delivery date");
        }
        setActionLoading(false);
    };

    const handleCreateShipment = () => {
        if (!order) return;
        setShipmentForm({ carrier: "", awbNumber: "", trackingUrl: "" });
        setShowShipmentDialog(true);
    };

    const submitCreateShipment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!order) return;
        if (!shipmentForm.carrier.trim() || !shipmentForm.awbNumber.trim()) {
            toast.error("Carrier name and AWB / tracking number are required.");
            return;
        }
        const safeUrl = shipmentForm.trackingUrl.trim()
            ? sanitizeExternalUrl(shipmentForm.trackingUrl.trim())
            : "";
        if (shipmentForm.trackingUrl.trim() && !safeUrl) {
            toast.error("Enter a valid http(s) tracking URL.");
            return;
        }
        setActionLoading(true);
        const result = await createShipmentForOrder(pb, getCurrentTenantEmail(), {
            orderId: order.id,
            carrier: shipmentForm.carrier.trim(),
            awbNumber: shipmentForm.awbNumber.trim(),
            trackingUrl: safeUrl || "",
            expectedDeliveryDate: expectedDelivery || undefined,
            codAmount:
                String((order as { payment_method?: string }).payment_method || "").toLowerCase() === "cod"
                    ? Number(order.total || 0)
                    : 0,
        });
        if (result.success) {
            toast.success("Shipment recorded and customer notified");
            setShowShipmentDialog(false);
            fetchOrder();
            fetchShipments();
        } else {
            toast.error(result.error || "Could not record the shipment");
        }
        setActionLoading(false);
    };

    const handleMarkDelivered = async (shipmentId: string) => {
        const result = await updateShipmentStatus(pb, shipmentId, "delivered");
        if (result.success) {
            toast.success("Shipment marked delivered");
            fetchOrder();
            fetchShipments();
        } else {
            toast.error(result.error || "Could not update the shipment");
        }
    };

    const handleCodCollected = () => {
        if (!order) return;
        setCodReference("");
        setShowCodDialog(true);
    };

    const submitCodCollected = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!order) return;
        if (!codReference.trim()) {
            toast.error("A collection reference is required to settle COD.");
            return;
        }
        setActionLoading(true);
        const result = await settleCodOrder(pb, getCurrentTenantEmail(), order.id, {
            reference: codReference.trim(),
            collectedBy: getCurrentTenantEmail(),
        });
        if (result.success) {
            toast.success("COD settled — order marked PAID and delivered");
            setShowCodDialog(false);
            fetchOrder();
        } else {
            toast.error(result.error || "Could not settle the COD order");
        }
        setActionLoading(false);
    };

    const canSplitOrder =
        !!order &&
        order.order_type !== "estimate" &&
        ["draft", "sent", "confirmed"].includes(order.status) &&
        ((order.items?.length ?? 0) > 1 || (order.items?.some((item) => item.quantity > 1) ?? false));

    const handleOpenSplitDialog = () => {
        if (!order?.items) return;
        const init: Record<string, number> = {};
        for (const item of order.items) {
            init[item.id] = 0;
        }
        setSplitQuantities(init);
        setSplitReason("");
        setShowSplitDialog(true);
    };

    const handleSplitOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!order?.items) return;
        const payload = order.items
            .map((item) => ({
                orderItemId: item.id,
                splitQuantity: splitQuantities[item.id] || 0,
            }))
            .filter((entry) => entry.splitQuantity > 0);
        if (payload.length === 0) {
            toast.error("Select at least 1 quantity to move into a backorder.");
            return;
        }
        setActionLoading(true);
        try {
            const res = await splitOrderForBackorder(order.id, payload, splitReason.trim() || undefined);
            toast.success(`Backorder #${res.backorderNumber} created`);
            setShowSplitDialog(false);
            await fetchOrder();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to split order");
        } finally {
            setActionLoading(false);
        }
    };

    const handleCancel = () => {
        if (!order) return;
        setCancelReason("");
        setCancelRefundRef("");
        setShowCancelDialog(true);
    };

    const submitCancelOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!order) return;
        // CO-15: a paid order can only be cancelled together with a refund
        // reference; otherwise stock would be restored while the CRM still
        // reports paid revenue for a cancelled order.
        const isPaid = String((order as { payment_status?: string }).payment_status || '').toUpperCase() === 'PAID';
        const refundReference = isPaid ? cancelRefundRef.trim() : undefined;
        if (isPaid && !refundReference) {
            toast.error("A refund reference (Razorpay refund ID / UTR) is required for a PAID order.");
            return;
        }
        setActionLoading(true);
        try {
            const result = await cancelSalesOrder(order.id, {
                reason: cancelReason.trim() || undefined,
                refundReference,
            });
            if (result.alreadyCancelled) {
                toast.info("This order is already cancelled");
            } else if (result.restored > 0) {
                toast.success(`Order cancelled — ${result.restored} stock line${result.restored === 1 ? "" : "s"} restored`);
            } else {
                toast.success("Order cancelled");
            }
            setShowCancelDialog(false);
            fetchOrder();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not cancel this order");
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return <div className="p-12 text-center text-moonstone">Loading order details...</div>;
    }

    if (!order) return null;

    const isEstimate = order.order_type === 'estimate';
    const hasDispatchedShipment = shipments.some(
        (s) => s.shipping_status === "in_transit" || s.shipping_status === "delivered"
    );
    const isPaidOrder = String((order as { payment_status?: string }).payment_status || "").toUpperCase() === "PAID";
    const shippingCharges = Number((order as { shipping_charges?: number }).shipping_charges) || 0;

    return (
        <div className="flex flex-col h-full overflow-hidden bg-bg-navy">
            <Header
                title={`${isEstimate ? 'Estimate' : 'Order'} #${order.order_number}`}
                subtitle={`Created on ${safeFormatDate(order.created || order.created_at, formatDate)}`}
                action={
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <Button
                            variant="outline"
                            onClick={() => router.back()}
                        >
                            <ArrowLeft size={18} className="mr-2" />
                            Back
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setShowShippingLabel(true)}
                            className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 font-bold"
                        >
                            <Truck size={18} className="mr-2 text-emerald-400" />
                            4×6″ Shipping Label
                        </Button>
                        <Button variant="outline" onClick={() => window.print()}>
                            <Printer size={18} className="mr-2" />
                            Print
                        </Button>
                        <Button variant="outline" onClick={() => window.open(`mailto:${order.customer_email}?subject=${encodeURIComponent(`Order #${order.order_number}`)}`)}>
                            <Mail size={18} className="mr-2" />
                            Email
                        </Button>

                        {/* Actions based on Status */}
                        {isEstimate && order.status === 'draft' && (
                            <Button
                                onClick={handleConvert}
                                disabled={actionLoading}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                <CheckCircle size={18} className="mr-2" />
                                Convert to Order
                            </Button>
                        )}

                        {!isEstimate && order.status === 'draft' && (
                            <Button
                                onClick={handleConfirm}
                                disabled={actionLoading}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                <CheckCircle size={18} className="mr-2" />
                                Confirm Order
                            </Button>
                        )}

                        {!isEstimate && order.status === 'confirmed' && (
                            <Button
                                onClick={handleInvoice}
                                disabled={actionLoading}
                            >
                                <FileText size={18} className="mr-2" />
                                Generate Invoice
                            </Button>
                        )}

                        {!isEstimate && (order.status === 'confirmed' || order.status === 'invoiced') && (
                            <Button
                                variant="outline"
                                onClick={() => router.push(`/packing?order=${order.id}`)}
                                className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                title="Verify the pieces at the packing station"
                            >
                                <PackageCheck size={18} className="mr-2 text-emerald-400" />
                                Pack this order
                            </Button>
                        )}

                        {canSplitOrder && (
                            <Button
                                variant="outline"
                                onClick={handleOpenSplitDialog}
                                disabled={actionLoading}
                                className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                                title="Split out-of-stock or delayed items into a linked backorder"
                            >
                                <GitBranch size={17} className="mr-2" />
                                Split / Backorder
                            </Button>
                        )}

                        {canCancelSalesOrder(order.status) && !(order.status === 'invoiced' && hasDispatchedShipment) && (
                            <Button
                                variant="outline"
                                onClick={handleCancel}
                                disabled={actionLoading}
                                className="border-red-500/40 text-red-400 hover:bg-red-500/10 font-bold"
                            >
                                <XCircle size={18} className="mr-2" />
                                {isEstimate ? 'Cancel Estimate' : 'Cancel Order'}
                            </Button>
                        )}
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

                    {/* LEFT: Details */}
                    <div className="xl:col-span-2 space-y-8">

                        {/* Items Table */}
                        <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden">
                            <div className="p-6 border-b border-surface-hover">
                                <h3 className="text-white font-bold text-lg">Order Items</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-bg-navy/50">
                                        <tr>
                                            <th className="py-3 px-6 text-xs font-bold text-moonstone uppercase">Item Description</th>
                                            <th className="py-3 px-6 text-right text-xs font-bold text-moonstone uppercase">Qty</th>
                                            <th className="py-3 px-6 text-right text-xs font-bold text-moonstone uppercase">Unit Price</th>
                                            <th className="py-3 px-6 text-right text-xs font-bold text-moonstone uppercase">Tax</th>
                                            <th className="py-3 px-6 text-right text-xs font-bold text-moonstone uppercase">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-surface-hover">
                                        {order.items?.map((item) => {
                                            const variantObj =
                                                (item as { expand?: { variant?: typeof item.variant } }).expand?.variant ??
                                                (item.variant && typeof item.variant === "object" ? item.variant : undefined);
                                            const variantMeta = variantObj
                                                ? [variantObj.size, variantObj.color, variantObj.material].filter(Boolean).join(" · ")
                                                : "";
                                            return (
                                            <tr key={item.id} className="hover:bg-bg-navy/30">
                                                <td className="py-4 px-6">
                                                    <p className="font-bold text-white text-sm break-words">{item.description}</p>
                                                    {variantMeta && (
                                                        <p className="text-xs text-moonstone mt-0.5">{variantMeta}</p>
                                                    )}
                                                </td>
                                                <td className="py-4 px-6 text-right text-white font-mono tabular-nums">{item.quantity}</td>
                                                <td className="py-4 px-6 text-right text-white font-mono tabular-nums">{formatPrice(item.unit_price)}</td>
                                                <td className="py-4 px-6 text-right text-moonstone text-xs tabular-nums">
                                                    {item.tax_rate}%
                                                </td>
                                                <td className="py-4 px-6 text-right font-bold text-primary font-mono tabular-nums">{formatPrice(item.total)}</td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-bg-navy/50 border-t border-surface-hover">
                                        <tr>
                                            <td colSpan={4} className="py-3 px-6 text-right text-sm font-medium text-moonstone">Subtotal</td>
                                            <td className="py-3 px-6 text-right text-sm font-medium text-white tabular-nums">{formatPrice(order.subtotal)}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan={4} className="py-3 px-6 text-right text-sm font-medium text-moonstone">Tax</td>
                                            <td className="py-3 px-6 text-right text-sm font-medium text-green-400 tabular-nums">+{formatPrice(order.tax_total)}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan={4} className="py-3 px-6 text-right text-sm font-medium text-moonstone">Discount</td>
                                            <td className="py-3 px-6 text-right text-sm font-medium text-red-400 tabular-nums">-{formatPrice(order.discount_total)}</td>
                                        </tr>
                                        {shippingCharges > 0 && (
                                            <tr>
                                                <td colSpan={4} className="py-3 px-6 text-right text-sm font-medium text-moonstone">Shipping</td>
                                                <td className="py-3 px-6 text-right text-sm font-medium text-white tabular-nums">+{formatPrice(shippingCharges)}</td>
                                            </tr>
                                        )}
                                        <tr className="border-t border-surface-hover bg-primary/5">
                                            <td colSpan={4} className="py-4 px-6 text-right text-lg font-bold text-primary">Grand Total</td>
                                            <td className="py-4 px-6 text-right text-lg font-bold text-primary tabular-nums">{formatPrice(order.total)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>

                        {/* Notes */}
                        {order.notes && (
                            <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                                <h4 className="text-moonstone uppercase text-xs font-bold mb-2">Notes</h4>
                                <p className="text-white text-sm whitespace-pre-line">{order.notes}</p>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Customer & Info */}
                    <div className="xl:col-span-1 space-y-6">

                        {/* Status Card */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <div className="flex items-center justify-between mb-4">
                                <p className="text-moonstone text-sm">Status</p>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${order.status === 'confirmed' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                    order.status === 'invoiced' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                        'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                    }`}>
                                    {order.status}
                                </span>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 text-sm">
                                    <Calendar className="text-primary w-4 h-4" />
                                    <div>
                                        <p className="text-moonstone text-xs">Order Date</p>
                                        <p className="text-white font-medium">{safeFormatDate(order.order_date, formatDate)}</p>
                                    </div>
                                </div>
                                {order.valid_until && (
                                    <div className="flex items-center gap-3 text-sm">
                                        <Calendar className="text-orange-400 w-4 h-4" />
                                        <div>
                                            <p className="text-moonstone text-xs">Valid Until</p>
                                            <p className="text-white font-medium">{safeFormatDate(order.valid_until, formatDate)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Dispatch & Delivery (C2/C3/D2) */}
                        {!isEstimate && (
                            <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover space-y-3">
                                <h3 className="text-white font-bold flex items-center gap-2">
                                    <Truck size={18} className="text-primary" />
                                    Dispatch &amp; Delivery
                                </h3>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={expectedDelivery || String((order as { expected_delivery_date?: string }).expected_delivery_date || "").slice(0, 10)}
                                        onChange={(e) => setEtaDraft(e.target.value)}
                                        className="bg-bg-navy border border-surface-hover rounded-lg px-2 py-1.5 text-xs text-white"
                                    />
                                    <Button variant="outline" onClick={handleExpectedDelivery} disabled={actionLoading}>
                                        Save ETA
                                    </Button>
                                </div>
                                {shipments.length === 0 && (
                                    <p className="text-moonstone text-xs">No shipment recorded yet.</p>
                                )}
                                {shipments.map((shipment) => {
                                    const safeTrackingUrl = sanitizeExternalUrl(shipment.tracking_url);
                                    return (
                                    <div key={shipment.id} className="text-xs border-t border-surface-hover pt-2 space-y-1">
                                        <p className="text-white font-medium break-words">
                                            {shipment.carrier || "Carrier"} · {shipment.awb_number || "no AWB"}
                                        </p>
                                        <p className="text-moonstone uppercase tracking-wide">
                                            {shipment.shipping_status || "unknown"}
                                        </p>
                                        {safeTrackingUrl && (
                                            <a
                                                href={safeTrackingUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary underline break-all"
                                            >
                                                Tracking link
                                            </a>
                                        )}
                                        {shipment.shipping_status !== "delivered" && (
                                            <button
                                                type="button"
                                                onClick={() => handleMarkDelivered(shipment.id)}
                                                className="text-emerald-400 underline block"
                                            >
                                                Mark delivered
                                            </button>
                                        )}
                                    </div>
                                    );
                                })}
                                <div className="flex flex-wrap gap-2 pt-2">
                                    <Button variant="outline" onClick={handleCreateShipment} disabled={actionLoading}>
                                        <Truck size={16} className="mr-1.5" />
                                        Record Dispatch
                                    </Button>
                                    {String((order as { payment_method?: string }).payment_method || "").toLowerCase() === "cod" &&
                                        String((order as { payment_status?: string }).payment_status || "").toUpperCase() !== "PAID" &&
                                        order.status !== "cancelled" && (
                                            <Button
                                                variant="outline"
                                                onClick={handleCodCollected}
                                                disabled={actionLoading}
                                                className="border-emerald-500/40 text-emerald-400"
                                            >
                                                Mark COD Collected
                                            </Button>
                                        )}
                                </div>
                                {Boolean((order as { cod_settled_at?: string }).cod_settled_at) && (
                                    <p className="text-xs text-emerald-400">
                                        COD settled {safeFormatDate((order as { cod_settled_at?: string }).cod_settled_at || "", formatDate)}
                                        {Boolean((order as { cod_reference?: string }).cod_reference) &&
                                            ` · ref ${(order as { cod_reference?: string }).cod_reference}`}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Customer Card */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                <User size={18} className="text-primary" />
                                Customer Details
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-lg font-bold text-white">{order.customer_name}</p>
                                    <p className="text-moonstone text-sm">{order.customer_email}</p>
                                    <p className="text-moonstone text-sm">{order.customer_phone}</p>
                                </div>

                                {order.billing_address && (
                                    <div className="pt-4 border-t border-surface-hover">
                                        <div className="flex items-start gap-2">
                                            <MapPin size={16} className="text-moonstone mt-0.5 shrink-0" />
                                            <div>
                                                <p className="text-xs font-bold text-moonstone uppercase mb-1">Billing Address</p>
                                                <p className="text-white text-sm">{order.billing_address}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {Boolean((order as { buyer_gstin?: string }).buyer_gstin) && (
                                    <div className="pt-4 border-t border-surface-hover">
                                        <p className="text-xs font-bold text-moonstone uppercase mb-1">GST Invoice</p>
                                        <p className="text-white text-sm">
                                            {(order as { buyer_company?: string }).buyer_company || order.customer_name}
                                        </p>
                                        <p className="text-moonstone text-xs font-mono">
                                            {(order as { buyer_gstin?: string }).buyer_gstin}
                                        </p>
                                    </div>
                                )}

                                {Boolean((order as { campaign?: string }).campaign) && (
                                    <div className="pt-4 border-t border-surface-hover">
                                        <p className="text-xs font-bold text-moonstone uppercase mb-1">Campaign</p>
                                        <p className="text-white text-sm">{(order as { campaign?: string }).campaign}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* VIP WhatsApp Order Milestones (Option B) */}
                        <OrderMilestoneBar
                            orderId={order.id}
                            orderNumber={order.order_number || order.id}
                            customerName={order.customer_name || 'Valued Customer'}
                            customerPhone={order.customer_phone}
                            initialStatus={order.status}
                            onMilestoneDispatched={fetchOrder}
                        />

                    </div>
                </div>
            </div>

            {/* 4x6 Thermal Shipping Parcel Label Modal */}
            {(() => {
                const legacyOrder = order as unknown as {
                    tracking_id?: string;
                    awb_number?: string;
                    shipping_city?: string;
                    city?: string;
                    shipping_state?: string;
                    state?: string;
                    shipping_pincode?: string;
                    pincode?: string;
                };
                const legacySettings = settings as unknown as {
                    store_name?: string;
                    store_address?: string;
                    store_city?: string;
                    store_state?: string;
                    store_pincode?: string;
                    store_phone?: string;
                } | null;
                return (
                    <ShippingLabelPrintModal
                        open={showShippingLabel}
                        onOpenChange={setShowShippingLabel}
                        labelData={{
                            orderNumber: order.order_number || order.id,
                            carrier: 'st_courier',
                            awbNumber: shipments[0]?.awb_number || legacyOrder.tracking_id || legacyOrder.awb_number || '',
                            isCod: order.payment_method === 'cod',
                            codAmount: order.payment_method === 'cod' ? order.total : 0,
                            weightGrams: 250,
                            orderDate: order.order_date,
                            sender: {
                                companyName: settings?.storeName || legacySettings?.store_name || "Store",
                                address: settings?.address || legacySettings?.store_address || "",
                                city: settings?.city || legacySettings?.store_city || "",
                                state: settings?.state || legacySettings?.store_state || "",
                                pincode: settings?.pincode || legacySettings?.store_pincode || "",
                                phone: settings?.whatsappPhone || settings?.phone || legacySettings?.store_phone || "",
                            },
                            consignee: {
                                name: order.customer_name || "Valued Customer",
                                address: order.shipping_address || order.billing_address || "Delivery Address On Record",
                                city: legacyOrder.shipping_city || legacyOrder.city || "",
                                state: legacyOrder.shipping_state || legacyOrder.state || "",
                                pincode: legacyOrder.shipping_pincode || legacyOrder.pincode || "",
                                phone: order.customer_phone || "",
                            },
                            routingCode: "",
                        }}
                    />
                );
            })()}

            {/* Record Dispatch / Shipment Dialog */}
            <Dialog open={showShipmentDialog} onOpenChange={setShowShipmentDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle>Record Dispatch &amp; Tracking</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submitCreateShipment} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Courier / Carrier Name *</Label>
                            <Input
                                required
                                placeholder="e.g. ST Courier, Delhivery, BlueDart"
                                value={shipmentForm.carrier}
                                onChange={(e) => setShipmentForm((p) => ({ ...p, carrier: e.target.value }))}
                                className="bg-bg-navy border-surface-hover"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>AWB / Tracking Number *</Label>
                            <Input
                                required
                                placeholder="e.g. DLV84729104"
                                value={shipmentForm.awbNumber}
                                onChange={(e) => setShipmentForm((p) => ({ ...p, awbNumber: e.target.value }))}
                                className="bg-bg-navy border-surface-hover font-mono"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Tracking URL (optional)</Label>
                            <Input
                                type="url"
                                placeholder="https://..."
                                value={shipmentForm.trackingUrl}
                                onChange={(e) => setShipmentForm((p) => ({ ...p, trackingUrl: e.target.value }))}
                                className="bg-bg-navy border-surface-hover"
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowShipmentDialog(false)}>Cancel</Button>
                            <Button type="submit" disabled={actionLoading}>Save Shipment</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Settle COD Dialog */}
            <Dialog open={showCodDialog} onOpenChange={setShowCodDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle>Mark COD Collected</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submitCodCollected} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Collection Reference (Cash Receipt / Courier UTR) *</Label>
                            <Input
                                required
                                placeholder="e.g. UTR-491827 or Courier Remittance #12"
                                value={codReference}
                                onChange={(e) => setCodReference(e.target.value)}
                                className="bg-bg-navy border-surface-hover font-mono"
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowCodDialog(false)}>Cancel</Button>
                            <Button type="submit" disabled={actionLoading} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                                Settle COD ({formatPrice(order.total)})
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Cancel Order Dialog */}
            <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            Cancel {isEstimate ? "Estimate" : "Order"} #{order.order_number}?
                        </DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submitCancelOrder} className="space-y-4">
                        <p className="text-xs text-moonstone leading-relaxed">
                            Any stock deducted by this order will be restored to inventory.
                            {order.status === "invoiced" && " Linked pre-dispatch invoices and packing sessions will also be voided."}
                            {isPaidOrder && " Because this order is PAID, a refund reference is required."}
                        </p>
                        <div className="space-y-1.5">
                            <Label>Cancellation Reason (optional)</Label>
                            <Input
                                placeholder="e.g. Customer requested cancellation"
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                className="bg-bg-navy border-surface-hover"
                            />
                        </div>
                        {isPaidOrder && (
                            <div className="space-y-1.5">
                                <Label>Refund Reference (Razorpay Refund ID / UTR) *</Label>
                                <Input
                                    required
                                    placeholder="e.g. rfnd_Pq81... or UTR..."
                                    value={cancelRefundRef}
                                    onChange={(e) => setCancelRefundRef(e.target.value)}
                                    className="bg-bg-navy border-surface-hover font-mono"
                                />
                            </div>
                        )}
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowCancelDialog(false)}>Keep Order</Button>
                            <Button type="submit" disabled={actionLoading} className="bg-red-600 hover:bg-red-700 text-white">
                                {actionLoading ? "Cancelling..." : "Confirm Cancellation"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Split / Backorder Dialog */}
            <Dialog open={showSplitDialog} onOpenChange={setShowSplitDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white">
                            <GitBranch className="w-5 h-5 text-amber-300" />
                            Split Order into Backorder
                        </DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSplitOrder} className="space-y-4">
                        <p className="text-xs text-moonstone">
                            Choose quantities to defer to a separate backorder ({order.order_number}-BO). Remaining quantities stay on this order for immediate dispatch.
                        </p>
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                            {order.items?.map((item) => {
                                const cur = splitQuantities[item.id] || 0;
                                return (
                                    <div
                                        key={item.id}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-surface-hover bg-bg-navy/50 p-2.5"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-medium text-white truncate">
                                                {item.description}
                                            </div>
                                            <div className="text-[11px] text-moonstone font-mono">
                                                Ordered: {item.quantity} × {formatPrice(item.unit_price)}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <Label className="text-xs text-moonstone">Move qty</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={item.quantity}
                                                value={cur}
                                                onChange={(e) => {
                                                    const val = Math.max(0, Math.min(item.quantity, parseInt(e.target.value, 10) || 0));
                                                    setSplitQuantities((prev) => ({ ...prev, [item.id]: val }));
                                                }}
                                                className="w-20 h-8 bg-surface-navy border-surface-hover text-white text-center font-mono text-xs"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-moonstone">Backorder Reason (optional)</Label>
                            <Input
                                placeholder="e.g. Awaiting vendor restock on temple bangles"
                                value={splitReason}
                                onChange={(e) => setSplitReason(e.target.value)}
                                className="bg-bg-navy border-surface-hover text-white"
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowSplitDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={actionLoading}
                                className="bg-amber-500 hover:bg-amber-400 text-navy-dark font-semibold"
                            >
                                {actionLoading ? "Splitting..." : "Create Backorder"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function OrderDetailPage() {
    return (
        <Suspense fallback={<div className="p-12 text-center text-moonstone">Loading...</div>}>
            <OrderDetailContent />
        </Suspense>
    )
}
