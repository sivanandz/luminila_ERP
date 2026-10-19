"use client";

import React, { useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download, Truck, PackageCheck, AlertCircle } from "lucide-react";
import { CourierCarrier } from "@/lib/logistics-engine";
import { escapeHtml } from "@/lib/utils";

export interface ShippingLabelData {
    orderNumber: string;
    invoiceNumber?: string;
    carrier: CourierCarrier | string;
    carrierName?: string;
    awbNumber: string;
    isCod: boolean;
    codAmount?: number;
    weightGrams: number;
    orderDate?: string;
    sender: {
        companyName: string;
        address: string;
        city: string;
        state: string;
        pincode: string;
        phone: string;
        gstin?: string;
    };
    consignee: {
        name: string;
        address: string;
        city: string;
        state: string;
        pincode: string;
        phone: string;
    };
    routingCode?: string;
}

interface ShippingLabelPrintModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    labelData: ShippingLabelData | null;
}

export function ShippingLabelPrintModal({
    open,
    onOpenChange,
    labelData,
}: ShippingLabelPrintModalProps) {
    const printAreaRef = useRef<HTMLDivElement>(null);

    if (!labelData) return null;

    const carrierTitle = labelData.carrierName || (
        labelData.carrier === "st_courier" ? "ST COURIER EXPRESS" :
        labelData.carrier === "delhivery" ? "DELHIVERY SURFACE / AIR" :
        labelData.carrier === "shiprocket" ? "SHIPROCKET EXPRESS" :
        labelData.carrier === "bluedart" ? "BLUE DART APEX" :
        labelData.carrier === "dtdc" ? "DTDC EXPRESS" :
        String(labelData.carrier).toUpperCase()
    );

    const handlePrint = () => {
        const content = printAreaRef.current;
        if (!content) return;

        const printWindow = window.open("", "_blank");
        if (!printWindow) return;

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Shipping Label - ${escapeHtml(labelData.awbNumber || "")}</title>
                <style>
                    @page {
                        size: 4in 6in;
                        margin: 0;
                    }
                    * {
                        box-sizing: border-box;
                        margin: 0;
                        padding: 0;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    }
                    body {
                        width: 4in;
                        height: 6in;
                        padding: 0.15in;
                        background: #fff;
                        color: #000;
                    }
                    .label-container {
                        border: 2px solid #000;
                        height: 100%;
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                        padding: 8px;
                    }
                    .header-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 2px solid #000;
                        padding-bottom: 6px;
                    }
                    .carrier-title {
                        font-size: 16px;
                        font-weight: 900;
                        letter-spacing: 0.5px;
                    }
                    .routing-box {
                        font-size: 18px;
                        font-weight: 900;
                        border: 2px solid #000;
                        padding: 2px 6px;
                        background: #eee;
                    }
                    .barcode-section {
                        text-align: center;
                        padding: 10px 0;
                        border-bottom: 2px solid #000;
                    }
                    .barcode-image {
                        max-height: 48px;
                        max-width: 90%;
                    }
                    .awb-text {
                        font-family: monospace;
                        font-size: 14px;
                        font-weight: 800;
                        letter-spacing: 2px;
                        margin-top: 4px;
                    }
                    .destination-section {
                        border-bottom: 2px solid #000;
                        padding: 8px 4px;
                    }
                    .section-label {
                        font-size: 9px;
                        font-weight: 800;
                        text-transform: uppercase;
                        margin-bottom: 2px;
                    }
                    .consignee-name {
                        font-size: 15px;
                        font-weight: 800;
                    }
                    .address-text {
                        font-size: 12px;
                        line-height: 1.3;
                        margin-top: 2px;
                    }
                    .consignee-phone {
                        font-size: 13px;
                        font-weight: 800;
                        margin-top: 4px;
                    }
                    .pincode-highlight {
                        font-size: 18px;
                        font-weight: 900;
                        display: inline-block;
                        border: 1px solid #000;
                        padding: 1px 4px;
                        margin-top: 2px;
                    }
                    .meta-row {
                        display: flex;
                        justify-content: space-between;
                        border-bottom: 2px solid #000;
                        padding: 6px 0;
                    }
                    .meta-col {
                        font-size: 11px;
                        width: 50%;
                    }
                    .cod-banner {
                        border: 2px solid #000;
                        padding: 6px;
                        text-align: center;
                        margin: 6px 0;
                        font-weight: 900;
                        font-size: 14px;
                    }
                    .cod-banner.is-cod {
                        background: #000;
                        color: #fff;
                    }
                    .sender-footer {
                        font-size: 10px;
                        line-height: 1.25;
                        padding-top: 4px;
                    }
                    .security-notice {
                        font-size: 8px;
                        text-align: center;
                        font-weight: 700;
                        text-transform: uppercase;
                        margin-top: 4px;
                        border-top: 1px dashed #666;
                        padding-top: 3px;
                    }
                </style>
            </head>
            <body>
                ${content.innerHTML}
                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() { window.close(); }, 500);
                    };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    };

    // Construct Code128 barcode URL via standard open API
    const barcodeUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(labelData.awbNumber)}&scale=2&height=12&includetext=false`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md bg-surface-navy border border-surface-hover text-white p-5">
                <DialogHeader>
                    <DialogTitle className="text-base font-bold flex items-center gap-2">
                        <Printer size={18} className="text-emerald-400" />
                        4×6″ Thermal Shipping Parcel Label
                    </DialogTitle>
                </DialogHeader>

                {/* Printable Label Preview Area */}
                <div className="bg-white text-black p-3 rounded-lg border shadow-inner my-2 select-none overflow-hidden">
                    <div ref={printAreaRef} className="label-container" style={{ border: "2px solid #000", padding: "8px" }}>
                        {/* Header: Carrier Title & Hub Routing Code */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #000", paddingBottom: "4px" }}>
                            <div>
                                <div style={{ fontSize: "14px", fontWeight: "900", letterSpacing: "0.5px" }}>
                                    {carrierTitle}
                                </div>
                                <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase" }}>
                                    Standard Insured Parcel
                                </div>
                            </div>
                            <div style={{ fontSize: "16px", fontWeight: "900", border: "2px solid #000", padding: "2px 6px", background: "#f0f0f0" }}>
                                {labelData.routingCode || labelData.consignee.pincode.slice(0, 3)}
                            </div>
                        </div>

                        {/* Barcode Section */}
                        <div style={{ textAlign: "center", padding: "8px 0", borderBottom: "2px solid #000" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={barcodeUrl}
                                alt={labelData.awbNumber}
                                style={{ maxHeight: "44px", maxWidth: "90%", margin: "0 auto", display: "block" }}
                            />
                            <div style={{ fontFamily: "monospace", fontSize: "13px", fontWeight: "800", letterSpacing: "2px", marginTop: "3px" }}>
                                *{labelData.awbNumber}*
                            </div>
                        </div>

                        {/* Consignee Section */}
                        <div style={{ borderBottom: "2px solid #000", padding: "6px 2px" }}>
                            <div style={{ fontSize: "8px", fontWeight: "800", textTransform: "uppercase", color: "#555" }}>
                                Deliver To (Consignee):
                            </div>
                            <div style={{ fontSize: "14px", fontWeight: "800" }}>
                                {labelData.consignee.name}
                            </div>
                            <div style={{ fontSize: "11px", lineHeight: "1.25", marginTop: "2px" }}>
                                {labelData.consignee.address}, {labelData.consignee.city}, {labelData.consignee.state}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "3px" }}>
                                <div style={{ fontSize: "12px", fontWeight: "800" }}>
                                    📞 {labelData.consignee.phone}
                                </div>
                                <div style={{ fontSize: "15px", fontWeight: "900", border: "1px solid #000", padding: "1px 4px", background: "#f9f9f9" }}>
                                    PIN: {labelData.consignee.pincode}
                                </div>
                            </div>
                        </div>

                        {/* Order & Weight Metadata */}
                        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #000", padding: "4px 0", fontSize: "10px" }}>
                            <div>
                                <div>Order: <strong>{labelData.orderNumber}</strong></div>
                                {labelData.invoiceNumber && <div>Inv: <strong>{labelData.invoiceNumber}</strong></div>}
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <div>Weight: <strong>{labelData.weightGrams}g</strong></div>
                                <div>Date: <strong>{labelData.orderDate || new Date().toISOString().slice(0, 10)}</strong></div>
                            </div>
                        </div>

                        {/* COD / Prepaid Indicator Box */}
                        {labelData.isCod ? (
                            <div style={{ border: "2px solid #000", padding: "5px", textAlign: "center", margin: "4px 0", fontWeight: "900", fontSize: "13px", background: "#000", color: "#fff" }}>
                                CASH ON DELIVERY (COD): COLLECT ₹{(labelData.codAmount || 0).toLocaleString("en-IN")}
                            </div>
                        ) : (
                            <div style={{ border: "2px solid #000", padding: "5px", textAlign: "center", margin: "4px 0", fontWeight: "900", fontSize: "12px" }}>
                                PREPAID PARCEL — DO NOT COLLECT CASH
                            </div>
                        )}

                        {/* Return / Shipper Address */}
                        <div style={{ fontSize: "9px", lineHeight: "1.2", paddingTop: "2px" }}>
                            <div style={{ fontWeight: "800", textTransform: "uppercase" }}>Return Address If Undelivered:</div>
                            <div><strong>{labelData.sender.companyName}</strong>, {labelData.sender.address}, {labelData.sender.city} - {labelData.sender.pincode} (Ph: {labelData.sender.phone})</div>
                        </div>

                        {/* Security Notice */}
                        <div style={{ fontSize: "7.5px", textAlign: "center", fontWeight: "700", textTransform: "uppercase", borderTop: "1px dashed #888", marginTop: "3px", paddingTop: "2px", color: "#444" }}>
                            Tamper-Evident Precious Seal • Record Unboxing Video
                        </div>
                    </div>
                </div>

                {/* Print Control Actions */}
                <div className="flex items-center justify-between pt-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-moonstone text-xs">
                        Cancel
                    </Button>
                    <Button onClick={handlePrint} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-9 px-5">
                        <Printer size={15} className="mr-1.5" />
                        Print 4×6″ Thermal Label
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
