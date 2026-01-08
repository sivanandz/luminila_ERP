"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/layout";
import {
    ChevronLeft,
    Truck,
    Package,
    CheckCircle2,
    Clock,
    XCircle,
    Printer,
    FileText,
    Edit,
    ArrowRightLeft
} from "lucide-react";
import { formatDate, formatPrice } from "@/lib/utils";
import {
    getChallan,
    updateChallanStatus,
    type DeliveryChallan,
    type ChallanStatus,
    CHALLAN_TYPE_LABELS,
    CHALLAN_STATUS_LABELS
} from "@/lib/challan";
import { toast } from "sonner";
import { generateEWayBillJSON, type EWayBillDetails } from "@/lib/gst";
import { exportToJSON } from "@/lib/reports";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

function ChallanDetailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const id = searchParams.get("id");

    const [challan, setChallan] = useState<DeliveryChallan | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    // E-Way Bill State
    const [showEwayDialog, setShowEwayDialog] = useState(false);
    const [ewayDetails, setEwayDetails] = useState<EWayBillDetails>({
        distance: 0,
        vehicleType: 'R'
    });
    const [supplierGstin, setSupplierGstin] = useState("");

    const fetchChallan = async () => {
        if (!id) {
            router.push("/challan");
            return;
        }

        setLoading(true);
        const data = await getChallan(id);
        if (data) {
            setChallan(data);
        } else {
            toast.error("Challan not found");
            router.push("/challan");
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchChallan();
    }, [id]);

    const handleStatusUpdate = async (newStatus: ChallanStatus) => {
        if (!challan?.id) return;

        setUpdating(true);
        const success = await updateChallanStatus(challan.id, newStatus);
        if (success) {
            await fetchChallan();
        }
        setUpdating(false);
    };

    const handleGenerateEWayBill = () => {
        if (!challan || !supplierGstin) {
            alert("Please enter Supplier GSTIN");
            return;
        }
        try {
            const json = generateEWayBillJSON(challan, supplierGstin, ewayDetails);
            exportToJSON(json, `EWB_CHL_${challan.challan_number}`);
            setShowEwayDialog(false);
        } catch (error) {
            console.error(error);
            alert("Failed to generate E-Way Bill JSON");
        }
    };

    const getStatusColor = (status: ChallanStatus) => {
        const colors: Record<ChallanStatus, string> = {
            'draft': 'bg-slate-500',
            'issued': 'bg-blue-500',
            'in_transit': 'bg-orange-500',
            'delivered': 'bg-green-500',
            'returned': 'bg-purple-500',
            'cancelled': 'bg-red-500'
        };
        return colors[status];
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!challan) {
        return null;
    }

    const canIssue = challan.status === 'draft';
    const canMarkInTransit = challan.status === 'issued';
    const canMarkDelivered = challan.status === 'in_transit' || challan.status === 'issued';
    const canMarkReturned = challan.status === 'in_transit' || challan.status === 'delivered';
    const canCancel = challan.status !== 'cancelled' && challan.status !== 'delivered';

    return (
        <div className="flex flex-col h-full overflow-hidden bg-bg-navy">
            <Header
                title={`Challan ${challan.challan_number}`}
                subtitle={CHALLAN_TYPE_LABELS[challan.challan_type]}
                action={
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.back()}
                            className="h-11 px-4 text-moonstone hover:text-white font-bold text-sm flex items-center gap-2 transition-colors"
                        >
                            <ChevronLeft size={18} />
                            Back
                        </button>
                        <button
                            onClick={() => setShowEwayDialog(true)}
                            className="h-11 px-4 bg-surface-navy hover:bg-surface-hover text-white rounded-lg font-bold text-sm flex items-center gap-2 border border-surface-hover"
                        >
                            <Truck size={16} />
                            E-Way Bill
                        </button>
                        <button
                            onClick={() => window.print()}
                            className="h-11 px-4 bg-surface-navy hover:bg-surface-hover text-white rounded-lg font-bold text-sm flex items-center gap-2 border border-surface-hover"
                        >
                            <Printer size={16} />
                            Print
                        </button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">

                    {/* Status & Actions Card */}
                    <div className="xl:col-span-1 space-y-6">
                        {/* Status Card */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                <FileText size={18} className="text-primary" />
                                Status
                            </h3>
                            <div className="flex items-center gap-3 mb-6">
                                <div className={`w-3 h-3 rounded-full ${getStatusColor(challan.status)}`} />
                                <span className="text-white font-bold text-lg">
                                    {CHALLAN_STATUS_LABELS[challan.status]}
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="space-y-2">
                                {canIssue && (
                                    <button
                                        onClick={() => handleStatusUpdate('issued')}
                                        disabled={updating}
                                        className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <Clock size={16} />
                                        Issue Challan
                                    </button>
                                )}
                                {canMarkInTransit && (
                                    <button
                                        onClick={() => handleStatusUpdate('in_transit')}
                                        disabled={updating}
                                        className="w-full h-10 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <Truck size={16} />
                                        Mark In Transit
                                    </button>
                                )}
                                {canMarkDelivered && (
                                    <button
                                        onClick={() => handleStatusUpdate('delivered')}
                                        disabled={updating}
                                        className="w-full h-10 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <CheckCircle2 size={16} />
                                        Mark Delivered
                                    </button>
                                )}
                                {canMarkReturned && (
                                    <button
                                        onClick={() => handleStatusUpdate('returned')}
                                        disabled={updating}
                                        className="w-full h-10 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <ArrowRightLeft size={16} />
                                        Mark Returned
                                    </button>
                                )}
                                {canCancel && (
                                    <button
                                        onClick={() => handleStatusUpdate('cancelled')}
                                        disabled={updating}
                                        className="w-full h-10 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <XCircle size={16} />
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Transport Details */}
                        {(challan.vehicle_number || challan.transporter_name || challan.eway_bill_number) && (
                            <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                                <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                    <Truck size={18} className="text-primary" />
                                    Transport Details
                                </h3>
                                <div className="space-y-3 text-sm">
                                    {challan.vehicle_number && (
                                        <div>
                                            <span className="text-moonstone">Vehicle:</span>
                                            <span className="text-white ml-2 font-mono">{challan.vehicle_number}</span>
                                        </div>
                                    )}
                                    {challan.transporter_name && (
                                        <div>
                                            <span className="text-moonstone">Transporter:</span>
                                            <span className="text-white ml-2">{challan.transporter_name}</span>
                                        </div>
                                    )}
                                    {challan.driver_name && (
                                        <div>
                                            <span className="text-moonstone">Driver:</span>
                                            <span className="text-white ml-2">{challan.driver_name}</span>
                                            {challan.driver_phone && (
                                                <span className="text-moonstone ml-2">({challan.driver_phone})</span>
                                            )}
                                        </div>
                                    )}
                                    {challan.eway_bill_number && (
                                        <div>
                                            <span className="text-moonstone">E-Way Bill:</span>
                                            <span className="text-primary ml-2 font-mono">{challan.eway_bill_number}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Main Content */}
                    <div className="xl:col-span-2 space-y-6">
                        {/* Consignor & Consignee */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                                <h4 className="text-xs font-bold text-moonstone uppercase mb-3">From (Consignor)</h4>
                                <p className="text-white font-bold">{challan.consignor_name}</p>
                                {challan.consignor_gstin && (
                                    <p className="text-sm text-moonstone mt-1">GSTIN: {challan.consignor_gstin}</p>
                                )}
                                {challan.consignor_address && (
                                    <p className="text-sm text-moonstone mt-2">{challan.consignor_address}</p>
                                )}
                            </div>
                            <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                                <h4 className="text-xs font-bold text-moonstone uppercase mb-3">To (Consignee)</h4>
                                <p className="text-white font-bold">{challan.consignee_name}</p>
                                {challan.consignee_gstin && (
                                    <p className="text-sm text-moonstone mt-1">GSTIN: {challan.consignee_gstin}</p>
                                )}
                                {challan.consignee_address && (
                                    <p className="text-sm text-moonstone mt-2">{challan.consignee_address}</p>
                                )}
                                {challan.place_of_supply && (
                                    <p className="text-sm text-primary mt-2">Place of Supply: {challan.place_of_supply}</p>
                                )}
                            </div>
                        </div>

                        {/* Items Table */}
                        <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden">
                            <div className="p-4 border-b border-surface-hover">
                                <h3 className="text-white font-bold flex items-center gap-2">
                                    <Package size={18} className="text-primary" />
                                    Items ({challan.items?.length || 0})
                                </h3>
                            </div>
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-surface-hover text-left text-xs font-bold text-moonstone uppercase">
                                        <th className="py-3 px-4">Sr</th>
                                        <th className="py-3 px-4">Description</th>
                                        <th className="py-3 px-4">HSN</th>
                                        <th className="py-3 px-4 text-center">Qty</th>
                                        <th className="py-3 px-4 text-right">Rate</th>
                                        <th className="py-3 px-4 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-hover">
                                    {challan.items?.map((item) => (
                                        <tr key={item.id} className="hover:bg-bg-navy/30">
                                            <td className="py-3 px-4 text-moonstone">{item.sr_no}</td>
                                            <td className="py-3 px-4 text-white">{item.description}</td>
                                            <td className="py-3 px-4 text-moonstone font-mono">{item.hsn_code}</td>
                                            <td className="py-3 px-4 text-center text-white">{item.quantity} {item.unit}</td>
                                            <td className="py-3 px-4 text-right text-white">{formatPrice(item.unit_price)}</td>
                                            <td className="py-3 px-4 text-right font-bold text-white">{formatPrice(item.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-bg-navy/30">
                                    <tr className="border-t border-surface-hover">
                                        <td colSpan={3} className="py-4 px-4"></td>
                                        <td className="py-4 px-4 text-center font-bold text-white">{challan.total_quantity}</td>
                                        <td className="py-4 px-4 text-right text-moonstone">Taxable Value:</td>
                                        <td className="py-4 px-4 text-right font-bold text-white">{formatPrice(challan.taxable_value)}</td>
                                    </tr>
                                    {(challan.cgst_amount > 0 || challan.sgst_amount > 0) && (
                                        <>
                                            <tr>
                                                <td colSpan={5} className="py-2 px-4 text-right text-moonstone text-sm">CGST:</td>
                                                <td className="py-2 px-4 text-right text-green-400 text-sm">{formatPrice(challan.cgst_amount)}</td>
                                            </tr>
                                            <tr>
                                                <td colSpan={5} className="py-2 px-4 text-right text-moonstone text-sm">SGST:</td>
                                                <td className="py-2 px-4 text-right text-green-400 text-sm">{formatPrice(challan.sgst_amount)}</td>
                                            </tr>
                                        </>
                                    )}
                                    {challan.igst_amount > 0 && (
                                        <tr>
                                            <td colSpan={5} className="py-2 px-4 text-right text-moonstone text-sm">IGST:</td>
                                            <td className="py-2 px-4 text-right text-green-400 text-sm">{formatPrice(challan.igst_amount)}</td>
                                        </tr>
                                    )}
                                    <tr className="border-t border-primary/30">
                                        <td colSpan={5} className="py-4 px-4 text-right text-primary font-bold">Grand Total:</td>
                                        <td className="py-4 px-4 text-right text-primary font-bold text-xl">{formatPrice(challan.total_value)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Notes */}
                        {(challan.reason || challan.notes) && (
                            <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                                {challan.reason && (
                                    <div className="mb-4">
                                        <h4 className="text-xs font-bold text-moonstone uppercase mb-2">Reason for Movement</h4>
                                        <p className="text-white">{challan.reason}</p>
                                    </div>
                                )}
                                {challan.notes && (
                                    <div>
                                        <h4 className="text-xs font-bold text-moonstone uppercase mb-2">Notes</h4>
                                        <p className="text-moonstone">{challan.notes}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* E-Way Bill Dialog */}
            <Dialog open={showEwayDialog} onOpenChange={setShowEwayDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white">
                    <DialogHeader>
                        <DialogTitle>Generate E-Way Bill JSON</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Supplier GSTIN</Label>
                            <Input
                                placeholder="Your Organization GSTIN"
                                value={supplierGstin}
                                onChange={(e) => setSupplierGstin(e.target.value)}
                                className="uppercase bg-bg-navy border-surface-hover"
                                maxLength={15}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Approx Distance (km)</Label>
                            <Input
                                type="number"
                                value={ewayDetails.distance}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, distance: parseFloat(e.target.value) || 0 })}
                                placeholder="e.g. 50"
                                className="bg-bg-navy border-surface-hover"
                            />
                        </div>
                        <Separator className="bg-surface-hover" />
                        <div className="space-y-2">
                            <Label>Transporter ID (Optional)</Label>
                            <Input
                                placeholder="GSTIN of Transporter"
                                value={ewayDetails.transporterId || ''}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, transporterId: e.target.value })}
                                className="uppercase bg-bg-navy border-surface-hover"
                                maxLength={15}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Transporter Name (Optional)</Label>
                            <Input
                                placeholder="Name of Transporter"
                                value={ewayDetails.transporterName || ''}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, transporterName: e.target.value })}
                                className="bg-bg-navy border-surface-hover"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Vehicle Number (Optional)</Label>
                            <Input
                                placeholder="e.g. KA01AB1234"
                                value={ewayDetails.vehicleNo || ''}
                                onChange={(e) => setEwayDetails({ ...ewayDetails, vehicleNo: e.target.value })}
                                className="uppercase bg-bg-navy border-surface-hover"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowEwayDialog(false)} className="border-surface-hover hover:bg-surface-hover">
                                Cancel
                            </Button>
                            <Button
                                onClick={handleGenerateEWayBill}
                                className="bg-primary text-midnight hover:bg-primary/90"
                            >
                                <FileText className="w-4 h-4 mr-2" />
                                Download JSON
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function ChallanDetailPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-full bg-bg-navy">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        }>
            <ChallanDetailContent />
        </Suspense>
    );
}
