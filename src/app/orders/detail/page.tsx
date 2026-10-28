"use client";

import { Header } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { formatPrice, formatDate } from "@/lib/utils";
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
} from "lucide-react";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    getOrderDetails,
    convertEstimateToOrder,
    generateInvoiceFromOrder,
    cancelSalesOrder,
    canCancelSalesOrder,
    type OrderDetail,
} from "@/lib/orders";
import { getStoreSettings, type StoreSettings } from "@/lib/settings";
import { toast } from "sonner";
import { OrderMilestoneBar } from "@/components/orders/OrderMilestoneBar";
import { ShippingLabelPrintModal, type ShippingLabelData } from "@/components/shipping/ShippingLabelPrintModal";
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
            // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchOrder flips `loading` synchronously before its first await so the spinner shows on every refetch, including those triggered by the Convert/Invoice handlers; deferring it past the await would change which screen renders
            fetchOrder();
            // eslint-disable-next-line react-hooks/set-state-in-effect -- same synchronous-refresh rationale as fetchOrder
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

    const handleCreateShipment = async () => {
        if (!order) return;
        const carrier = window.prompt("Courier / carrier name (e.g. ST Courier, Delhivery):");
        if (!carrier?.trim()) return;
        const awbNumber = window.prompt("AWB / tracking number:");
        if (!awbNumber?.trim()) return;
        const trackingUrl = window.prompt("Tracking URL (optional):") || "";
        setActionLoading(true);
        const result = await createShipmentForOrder(pb, getCurrentTenantEmail(), {
            orderId: order.id,
            carrier: carrier.trim(),
            awbNumber: awbNumber.trim(),
            trackingUrl: trackingUrl.trim(),
            expectedDeliveryDate: expectedDelivery || undefined,
            codAmount:
                String((order as { payment_method?: string }).payment_method || "").toLowerCase() === "cod"
                    ? Number(order.total || 0)
                    : 0,
        });
        if (result.success) {
            toast.success("Shipment recorded and customer notified");
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

    const handleCodCollected = async () => {
        if (!order) return;
        const reference = window.prompt("COD collection reference (cash receipt / UTR):");
        if (!reference?.trim()) {
            toast.error("A collection reference is required to settle COD.");
            return;
        }
        setActionLoading(true);
        const result = await settleCodOrder(pb, getCurrentTenantEmail(), order.id, {
            reference: reference.trim(),
            collectedBy: getCurrentTenantEmail(),
        });
        if (result.success) {
            toast.success("COD settled — order marked PAID and delivered");
            fetchOrder();
        } else {
            toast.error(result.error || "Could not settle the COD order");
        }
        setActionLoading(false);
    };

    const handleCancel = async () => {
        if (!order) return;
        // CO-15: a paid order can only be cancelled together with a refund
        // reference; otherwise stock would be restored while the CRM still
        // reports paid revenue for a cancelled order.
        const isPaid = String((order as { payment_status?: string }).payment_status || '').toUpperCase() === 'PAID';
        const confirmed = window.confirm(
            `Cancel ${order.order_type === 'estimate' ? 'estimate' : 'order'} #${order.order_number}? Any stock deducted by this order will be restored.${isPaid ? ' This order is PAID — the refund reference is required.' : ''}`
        );
        if (!confirmed) return;
        const reason = window.prompt("Reason (optional):") || undefined;
        let refundReference: string | undefined;
        if (isPaid) {
            const supplied = window.prompt("Refund reference (Razorpay refund id / UTR). Required for a paid order:");
            if (!supplied || !supplied.trim()) {
                toast.error("Cancellation aborted: a refund reference is required for a paid order.");
                return;
            }
            refundReference = supplied.trim();
        }
        setActionLoading(true);
        try {
            const result = await cancelSalesOrder(order.id, { reason, refundReference });
            if (result.alreadyCancelled) {
                toast.info("This order is already cancelled");
            } else if (result.restored > 0) {
                toast.success(`Order cancelled — ${result.restored} stock line${result.restored === 1 ? "" : "s"} restored`);
            } else {
                toast.success("Order cancelled");
            }
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

    return (
        <div className="flex flex-col h-full overflow-hidden bg-bg-navy">
            <Header
                title={`${isEstimate ? 'Estimate' : 'Order'} #${order.order_number}`}
                subtitle={`Created on ${formatDate(order.created || order.created_at)}`}
                action={
                    <div className="flex items-center gap-3">
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

                        {!isEstimate && order.status === 'confirmed' && (
                            <Button
                                onClick={handleInvoice}
                                disabled={actionLoading}
                            >
                                <FileText size={18} className="mr-2" />
                                Generate Invoice
                            </Button>
                        )}

                        {canCancelSalesOrder(order.status) && (
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
                                        {order.items?.map((item) => (
                                            <tr key={item.id} className="hover:bg-bg-navy/30">
                                                <td className="py-4 px-6">
                                                    <p className="font-bold text-white text-sm">{item.description}</p>
                                                    {item.variant && (
                                                        <p className="text-xs text-moonstone mt-0.5">
                                                            {item.variant.size} {item.variant.color} {item.variant.material}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="py-4 px-6 text-right text-white font-mono">{item.quantity}</td>
                                                <td className="py-4 px-6 text-right text-white font-mono">{formatPrice(item.unit_price)}</td>
                                                <td className="py-4 px-6 text-right text-moonstone text-xs">
                                                    {item.tax_rate}%
                                                </td>
                                                <td className="py-4 px-6 text-right font-bold text-primary font-mono">{formatPrice(item.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-bg-navy/50 border-t border-surface-hover">
                                        <tr>
                                            <td colSpan={4} className="py-3 px-6 text-right text-sm font-medium text-moonstone">Subtotal</td>
                                            <td className="py-3 px-6 text-right text-sm font-medium text-white">{formatPrice(order.subtotal)}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan={4} className="py-3 px-6 text-right text-sm font-medium text-moonstone">Tax</td>
                                            <td className="py-3 px-6 text-right text-sm font-medium text-green-400">+{formatPrice(order.tax_total)}</td>
                                        </tr>
                                        <tr>
                                            <td colSpan={4} className="py-3 px-6 text-right text-sm font-medium text-moonstone">Discount</td>
                                            <td className="py-3 px-6 text-right text-sm font-medium text-red-400">-{formatPrice(order.discount_total)}</td>
                                        </tr>
                                        <tr className="border-t border-surface-hover bg-primary/5">
                                            <td colSpan={4} className="py-4 px-6 text-right text-lg font-bold text-primary">Grand Total</td>
                                            <td className="py-4 px-6 text-right text-lg font-bold text-primary">{formatPrice(order.total)}</td>
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
                                        <p className="text-white font-medium">{formatDate(order.order_date)}</p>
                                    </div>
                                </div>
                                {order.valid_until && (
                                    <div className="flex items-center gap-3 text-sm">
                                        <Calendar className="text-orange-400 w-4 h-4" />
                                        <div>
                                            <p className="text-moonstone text-xs">Valid Until</p>
                                            <p className="text-white font-medium">{formatDate(order.valid_until)}</p>
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
                                {shipments.map((shipment) => (
                                    <div key={shipment.id} className="text-xs border-t border-surface-hover pt-2 space-y-1">
                                        <p className="text-white font-medium">
                                            {shipment.carrier || "Carrier"} · {shipment.awb_number || "no AWB"}
                                        </p>
                                        <p className="text-moonstone uppercase tracking-wide">
                                            {shipment.shipping_status || "unknown"}
                                        </p>
                                        {shipment.tracking_url && (
                                            <a
                                                href={shipment.tracking_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-primary underline"
                                            >
                                                Tracking link
                                            </a>
                                        )}
                                        {shipment.shipping_status !== "delivered" && (
                                            <button
                                                type="button"
                                                onClick={() => handleMarkDelivered(shipment.id)}
                                                className="text-emerald-400 underline"
                                            >
                                                Mark delivered
                                            </button>
                                        )}
                                    </div>
                                ))}
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
                                        COD settled {formatDate((order as { cod_settled_at?: string }).cod_settled_at || "")}
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
            <ShippingLabelPrintModal
                open={showShippingLabel}
                onOpenChange={setShowShippingLabel}
                labelData={{
                    orderNumber: order.order_number || order.id,
                    carrier: 'st_courier',
                    awbNumber: shipments[0]?.awb_number || (order as any).tracking_id || (order as any).awb_number || '',
                    isCod: order.payment_method === 'cod',
                    codAmount: order.payment_method === 'cod' ? order.total : 0,
                    weightGrams: 250,
                    orderDate: order.order_date,
                    sender: {
                        companyName: settings?.storeName || (settings as any)?.store_name || "Store",
                        address: settings?.address || (settings as any)?.store_address || "",
                        city: settings?.city || (settings as any)?.store_city || "",
                        state: settings?.state || (settings as any)?.store_state || "",
                        pincode: settings?.pincode || (settings as any)?.store_pincode || "",
                        phone: settings?.whatsappPhone || settings?.phone || (settings as any)?.store_phone || "",
                    },
                    consignee: {
                        name: order.customer_name || "Valued Customer",
                        address: order.shipping_address || order.billing_address || "Delivery Address On Record",
                        city: (order as any).shipping_city || (order as any).city || "",
                        state: (order as any).shipping_state || (order as any).state || "",
                        pincode: (order as any).shipping_pincode || (order as any).pincode || "",
                        phone: order.customer_phone || "",
                    },
                    routingCode: "",
                }}
            />
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
