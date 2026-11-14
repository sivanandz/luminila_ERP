"use client";

import { forwardRef } from "react";
import { formatPrice, formatDate } from "@/lib/utils";

interface ReceiptItem {
    name: string;
    variant: string;
    quantity: number;
    unitPrice: number;
    remarks?: string;
    gross_weight?: number;
    purity_karat?: string;
    huid_code?: string;
}

interface ReceiptProps {
    transactionId: string;
    invoiceNumber?: string;
    items: ReceiptItem[];
    subtotal: number;
    discount: number;
    total: number;
    paymentMethod: string;
    cashierName?: string;
    storeName?: string;
    storeAddress?: string;
    storePhone?: string;
    storeGstin?: string;
    gstIncluded?: number;
    cashTendered?: number;
    changeGiven?: number;
    couponCode?: string;
}

export const Receipt = forwardRef<HTMLDivElement, ReceiptProps>(
    function Receipt(
        {
            transactionId,
            invoiceNumber,
            items,
            subtotal,
            discount,
            total,
            paymentMethod,
            cashierName = "Staff",
            storeName = "Store Receipt",
            storeAddress = "",
            storePhone = "",
            storeGstin = "",
            gstIncluded = 0,
            cashTendered,
            changeGiven,
            couponCode,
        },
        ref
    ) {
        return (
            <div
                ref={ref}
                className="bg-white text-black p-4 font-mono text-xs"
                style={{ width: "58mm", minHeight: "100mm" }}
            >
                {/* Store Header */}
                <div className="text-center mb-4">
                    <h1 className="text-lg font-bold break-words">{storeName}</h1>
                    {storeAddress ? <p className="text-[10px] break-words [overflow-wrap:anywhere]">{storeAddress}</p> : null}
                    {storePhone ? <p className="text-[10px] break-words">{storePhone}</p> : null}
                </div>

                {/* Divider */}
                <div className="border-t border-dashed border-black my-2" />

                {/* Transaction Info */}
                <div className="flex justify-between text-[10px] mb-2 font-bold">
                    <span className="break-all">{invoiceNumber ? `Invoice #: ${invoiceNumber}` : `Receipt #: ${transactionId}`}</span>
                </div>
                {storeGstin && (
                    <div className="text-[10px] text-gray-700 mb-2 break-all">
                        <span>GSTIN: {storeGstin}</span>
                    </div>
                )}
                <div className="flex justify-between gap-2 text-[10px] mb-2">
                    <span className="shrink-0">{formatDate(new Date())}</span>
                    <span className="truncate max-w-[115px] text-right">Cashier: {cashierName}</span>
                </div>

                {/* Divider */}
                <div className="border-t border-dashed border-black my-2" />

                {/* Items */}
                <div className="space-y-1 mb-2">
                    {items.map((item, index) => (
                        <div key={index}>
                            <div className="flex justify-between gap-2">
                                <span className="flex-1 min-w-0 truncate">
                                    {item.name}
                                </span>
                                <span className="shrink-0 tabular-nums">{formatPrice(item.unitPrice * item.quantity)}</span>
                            </div>
                            <div className="text-[10px] text-gray-600 pl-2 break-words [overflow-wrap:anywhere]">
                                {item.variant} × {item.quantity} @ {formatPrice(item.unitPrice)}
                            </div>
                            {item.remarks && (
                                <div className="text-[10px] text-gray-500 pl-2 italic break-words [overflow-wrap:anywhere]">
                                    Note: {item.remarks}
                                </div>
                            )}
                            {(item.gross_weight || item.purity_karat || item.huid_code) && (
                                <div className="text-[9px] text-gray-600 pl-2 font-mono break-words">
                                    {[
                                        item.purity_karat,
                                        item.gross_weight ? `${item.gross_weight}g` : null,
                                        item.huid_code ? `HUID: ${item.huid_code}` : null
                                    ].filter(Boolean).join(' • ')}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Divider */}
                <div className="border-t border-dashed border-black my-2" />

                {/* Totals */}
                <div className="space-y-1">
                    <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span className="tabular-nums">{formatPrice(subtotal)}</span>
                    </div>
                    {discount > 0 && (
                        <div className="flex justify-between text-green-700">
                            <span className="truncate pr-2">Discount{couponCode ? ` (${couponCode})` : ""}:</span>
                            <span className="shrink-0 tabular-nums">-{formatPrice(discount)}</span>
                        </div>
                    )}
                    {gstIncluded > 0 && (
                        <div className="flex justify-between text-[10px] text-gray-700">
                            <span>Incl. GST:</span>
                            <span className="tabular-nums">{formatPrice(gstIncluded)}</span>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-sm border-t border-black pt-1 mt-1">
                        <span>TOTAL:</span>
                        <span className="tabular-nums">{formatPrice(total)}</span>
                    </div>
                    {cashTendered !== undefined && cashTendered > 0 && (
                        <>
                            <div className="flex justify-between text-[10px] text-gray-700 pt-0.5">
                                <span>Cash Tendered:</span>
                                <span className="tabular-nums">{formatPrice(cashTendered)}</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-gray-700">
                                <span>Change Given:</span>
                                <span className="tabular-nums">{formatPrice(changeGiven ?? 0)}</span>
                            </div>
                        </>
                    )}
                </div>

                {/* Payment Method */}
                <div className="mt-2 text-center text-[10px]">
                    Paid by: {paymentMethod.toUpperCase()}
                </div>

                {/* Divider */}
                <div className="border-t border-dashed border-black my-3" />

                {/* Footer */}
                <div className="text-center text-[10px]">
                    <p className="font-bold">Thank you for shopping!</p>
                    <p className="mt-1">Visit us again</p>
                </div>

                {/* Barcode placeholder */}
                <div className="mt-3 text-center">
                    <div className="inline-block max-w-full bg-gray-200 px-2 py-1 text-[9px] break-all">
                        {transactionId}
                    </div>
                </div>
            </div>
        );
    }
);


