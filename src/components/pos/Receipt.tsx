"use client";

import { forwardRef } from "react";
import { formatPrice, formatDate } from "@/lib/utils";

interface ReceiptItem {
    name: string;
    variant: string;
    quantity: number;
    unitPrice: number;
    remarks?: string;
}

interface ReceiptProps {
    transactionId: string;
    items: ReceiptItem[];
    subtotal: number;
    discount: number;
    total: number;
    paymentMethod: string;
    cashierName?: string;
    storeName?: string;
    storeAddress?: string;
    storePhone?: string;
}

export const Receipt = forwardRef<HTMLDivElement, ReceiptProps>(
    function Receipt(
        {
            transactionId,
            items,
            subtotal,
            discount,
            total,
            paymentMethod,
            cashierName = "Staff",
            storeName = "Zennila",
            storeAddress = "Mumbai, Maharashtra",
            storePhone = "+91 98765 43210",
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
                    <h1 className="text-lg font-bold">{storeName}</h1>
                    <p className="text-[10px]">{storeAddress}</p>
                    <p className="text-[10px]">{storePhone}</p>
                </div>

                {/* Divider */}
                <div className="border-t border-dashed border-black my-2" />

                {/* Transaction Info */}
                <div className="flex justify-between text-[10px] mb-2">
                    <span>Receipt #: {transactionId}</span>
                </div>
                <div className="flex justify-between text-[10px] mb-2">
                    <span>{formatDate(new Date())}</span>
                    <span>Cashier: {cashierName}</span>
                </div>

                {/* Divider */}
                <div className="border-t border-dashed border-black my-2" />

                {/* Items */}
                <div className="space-y-1 mb-2">
                    {items.map((item, index) => (
                        <div key={index}>
                            <div className="flex justify-between">
                                <span className="flex-1 truncate pr-2">
                                    {item.name}
                                </span>
                                <span>{formatPrice(item.unitPrice * item.quantity)}</span>
                            </div>
                            <div className="text-[10px] text-gray-600 pl-2">
                                {item.variant} × {item.quantity} @ {formatPrice(item.unitPrice)}
                            </div>
                            {item.remarks && (
                                <div className="text-[10px] text-gray-500 pl-2 italic">
                                    Note: {item.remarks}
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
                        <span>{formatPrice(subtotal)}</span>
                    </div>
                    {discount > 0 && (
                        <div className="flex justify-between text-green-700">
                            <span>Discount:</span>
                            <span>-{formatPrice(discount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-sm border-t border-black pt-1 mt-1">
                        <span>TOTAL:</span>
                        <span>{formatPrice(total)}</span>
                    </div>
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
                    <p className="mt-2">www.zennila.com</p>
                </div>

                {/* Barcode placeholder */}
                <div className="mt-3 text-center">
                    <div className="inline-block bg-gray-200 px-4 py-1 text-[10px]">
                        {transactionId}
                    </div>
                </div>
            </div>
        );
    }
);


