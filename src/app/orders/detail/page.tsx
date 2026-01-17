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
    User,
    Calendar,
    MapPin,
    CreditCard
} from "lucide-react";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getOrderDetails, convertEstimateToOrder, generateInvoiceFromOrder } from "@/lib/orders";
import { toast } from "sonner";

function OrderDetailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const id = searchParams.get("id");

    const [order, setOrder] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        if (id) {
            fetchOrder();
        }
    }, [id]);

    async function fetchOrder() {
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
    }

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

    if (loading) {
        return <div className="p-12 text-center text-moonstone">Loading order details...</div>;
    }

    if (!order) return null;

    const isEstimate = order.order_type === 'estimate';

    return (
        <div className="flex flex-col h-full overflow-hidden bg-bg-navy">
            <Header
                title={`${isEstimate ? 'Estimate' : 'Order'} #${order.order_number}`}
                subtitle={`Created on ${formatDate(order.created_at)}`}
                action={
                    <div className="flex items-center gap-3">
                        <Button
                            variant="outline"
                            onClick={() => router.back()}
                        >
                            <ArrowLeft size={18} className="mr-2" />
                            Back
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
                                        {order.items?.map((item: any) => (
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
                            </div>
                        </div>

                    </div>
                </div>
            </div>
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
