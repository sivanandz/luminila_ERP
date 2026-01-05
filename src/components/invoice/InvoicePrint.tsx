"use client";

import { useRef, forwardRef, useImperativeHandle } from "react";
import { format } from "date-fns";
import { formatINR, amountToWords } from "@/lib/gst";
import type { Invoice } from "@/lib/invoice";

export type PrintMode = "regular" | "thermal58" | "thermal80";

interface InvoicePrintProps {
    invoice: Invoice;
    mode?: PrintMode;
    storeSettings?: {
        store_name?: string;
        store_phone?: string;
        store_email?: string;
        store_logo?: string; // Base64 encoded logo
        bank_name?: string;
        bank_account_no?: string;
        bank_ifsc?: string;
        bank_branch?: string;
        invoice_footer?: string;
    };
}

export interface InvoicePrintRef {
    print: () => void;
}

// CSS for Regular A4 Print
const regularStyles = `
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }
    body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        font-size: 12px;
        line-height: 1.4;
        color: #333;
        padding: 20px;
    }
    .invoice-container {
        max-width: 800px;
        margin: 0 auto;
        border: 1px solid #ddd;
        padding: 20px;
    }
    .header {
        display: flex;
        justify-content: space-between;
        border-bottom: 2px solid #333;
        padding-bottom: 15px;
        margin-bottom: 15px;
    }
    .logo { max-height: 60px; max-width: 150px; margin-bottom: 8px; }
    .company-name { font-size: 24px; font-weight: bold; color: #1a1a2e; }
    .invoice-title { font-size: 18px; font-weight: bold; text-align: right; color: #b8860b; }
    .invoice-number { font-size: 14px; font-family: monospace; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .party { width: 48%; }
    .party-title { font-weight: bold; background: #f5f5f5; padding: 5px; margin-bottom: 5px; }
    .party-details { padding: 5px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #1a1a2e; color: white; font-weight: 500; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .totals { display: flex; justify-content: flex-end; }
    .totals-table { width: 300px; }
    .totals-table td { padding: 5px 10px; }
    .grand-total { font-weight: bold; font-size: 14px; background: #f5f5f5; }
    .amount-words { background: #f9f9f9; padding: 10px; margin-bottom: 15px; font-style: italic; }
    .bank-details { border: 1px solid #ddd; padding: 10px; margin-bottom: 15px; }
    .bank-title { font-weight: bold; margin-bottom: 5px; }
    .footer { display: flex; justify-content: space-between; margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; }
    .signature { text-align: center; }
    .signature-line { border-top: 1px solid #333; width: 200px; margin-top: 50px; padding-top: 5px; }
    @media print {
        body { padding: 0; }
        .invoice-container { border: none; }
    }
`;

// CSS for Thermal 58mm Receipt
const thermal58Styles = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Courier New', monospace;
        font-size: 10px;
        line-height: 1.3;
        color: #000;
        width: 58mm;
        padding: 3mm;
    }
    .receipt { width: 100%; }
    .center { text-align: center; }
    .logo { max-height: 40px; max-width: 50mm; margin-bottom: 5px; }
    .store-name { font-size: 14px; font-weight: bold; margin-bottom: 3px; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    .bold { font-weight: bold; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
    .item { margin: 3px 0; border-bottom: 1px dotted #ccc; padding-bottom: 3px; }
    .item-name { font-size: 9px; }
    .item-details { display: flex; justify-content: space-between; font-size: 9px; }
    .total-section { margin-top: 5px; }
    .grand-total { font-size: 12px; font-weight: bold; }
    .footer-text { font-size: 8px; margin-top: 8px; text-align: center; font-style: italic; }
    @media print {
        @page { size: 58mm auto; margin: 0; }
        body { padding: 2mm; }
    }
`;

// CSS for Thermal 80mm Receipt
const thermal80Styles = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Courier New', monospace;
        font-size: 11px;
        line-height: 1.4;
        color: #000;
        width: 80mm;
        padding: 4mm;
    }
    .receipt { width: 100%; }
    .center { text-align: center; }
    .logo { max-height: 50px; max-width: 70mm; margin-bottom: 8px; }
    .store-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .bold { font-weight: bold; }
    .row { display: flex; justify-content: space-between; margin: 3px 0; }
    .item { margin: 4px 0; border-bottom: 1px dotted #ccc; padding-bottom: 4px; }
    .item-name { font-size: 10px; }
    .item-details { display: flex; justify-content: space-between; font-size: 10px; }
    .total-section { margin-top: 6px; }
    .grand-total { font-size: 14px; font-weight: bold; }
    .footer-text { font-size: 9px; margin-top: 10px; text-align: center; font-style: italic; }
    @media print {
        @page { size: 80mm auto; margin: 0; }
        body { padding: 3mm; }
    }
`;

export const InvoicePrint = forwardRef<InvoicePrintRef, InvoicePrintProps>(
    ({ invoice, mode = "regular", storeSettings }, ref) => {
        const printRef = useRef<HTMLDivElement>(null);

        useImperativeHandle(ref, () => ({
            print: () => {
                const content = printRef.current;
                if (!content) return;

                const printWindow = window.open("", "_blank");
                if (!printWindow) return;

                const styles = mode === "thermal58"
                    ? thermal58Styles
                    : mode === "thermal80"
                        ? thermal80Styles
                        : regularStyles;

                printWindow.document.write(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Invoice ${invoice.invoice_number}</title>
                        <style>${styles}</style>
                    </head>
                    <body>
                        ${content.innerHTML}
                    </body>
                    </html>
                `);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => {
                    printWindow.print();
                    printWindow.close();
                }, 250);
            },
        }));

        const isInterState = invoice.igst_amount > 0;
        const isThermal = mode === "thermal58" || mode === "thermal80";

        // Thermal Receipt Format
        if (isThermal) {
            return (
                <div ref={printRef}>
                    <div className="receipt">
                        {/* Header */}
                        <div className="center">
                            {storeSettings?.store_logo && (
                                <img src={storeSettings.store_logo} alt="Logo" className="logo" />
                            )}
                            <div className="store-name">{invoice.seller_name}</div>
                            {storeSettings?.store_phone && (
                                <div>Tel: {storeSettings.store_phone}</div>
                            )}
                        </div>

                        <div className="divider"></div>

                        <div className="center bold">
                            {invoice.invoice_type === "credit_note"
                                ? "CREDIT NOTE"
                                : invoice.invoice_type === "debit_note"
                                    ? "DEBIT NOTE"
                                    : "TAX INVOICE"}
                        </div>

                        <div className="row">
                            <span>No: {invoice.invoice_number}</span>
                        </div>
                        <div className="row">
                            <span>Date: {format(new Date(invoice.invoice_date), "dd/MM/yyyy HH:mm")}</span>
                        </div>

                        <div className="divider"></div>

                        {/* Customer */}
                        <div className="row">
                            <span className="bold">Customer:</span>
                        </div>
                        <div>{invoice.buyer_name}</div>
                        {invoice.buyer_phone && <div>Ph: {invoice.buyer_phone}</div>}
                        {invoice.buyer_gstin && <div>GSTIN: {invoice.buyer_gstin}</div>}

                        <div className="divider"></div>

                        {/* Items */}
                        {invoice.items?.map((item, index) => (
                            <div key={item.id || index} className="item">
                                <div className="item-name">{item.description}</div>
                                <div className="item-details">
                                    <span>{item.quantity} x {formatINR(item.unit_price)}</span>
                                    <span>{formatINR(item.total_amount)}</span>
                                </div>
                            </div>
                        ))}

                        <div className="divider"></div>

                        {/* Totals */}
                        <div className="total-section">
                            <div className="row">
                                <span>Subtotal:</span>
                                <span>{formatINR(invoice.taxable_value)}</span>
                            </div>
                            {isInterState ? (
                                <div className="row">
                                    <span>IGST:</span>
                                    <span>{formatINR(invoice.igst_amount)}</span>
                                </div>
                            ) : (
                                <>
                                    <div className="row">
                                        <span>CGST:</span>
                                        <span>{formatINR(invoice.cgst_amount)}</span>
                                    </div>
                                    <div className="row">
                                        <span>SGST:</span>
                                        <span>{formatINR(invoice.sgst_amount)}</span>
                                    </div>
                                </>
                            )}
                            {invoice.discount_amount > 0 && (
                                <div className="row">
                                    <span>Discount:</span>
                                    <span>-{formatINR(invoice.discount_amount)}</span>
                                </div>
                            )}
                        </div>

                        <div className="divider"></div>

                        <div className="row grand-total">
                            <span>TOTAL:</span>
                            <span>{formatINR(invoice.grand_total)}</span>
                        </div>

                        {invoice.seller_gstin && (
                            <>
                                <div className="divider"></div>
                                <div style={{ fontSize: "9px" }}>
                                    GSTIN: {invoice.seller_gstin}
                                </div>
                            </>
                        )}

                        <div className="divider"></div>

                        <div className="footer-text">
                            {storeSettings?.invoice_footer || "Thank you for your purchase!"}
                        </div>

                        <div className="center" style={{ marginTop: "10px", fontSize: "8px" }}>
                            *** End of Receipt ***
                        </div>
                    </div>
                </div>
            );
        }

        // Regular A4 Format
        return (
            <div ref={printRef} className="bg-white text-black p-6 rounded-lg">
                <div className="invoice-container">
                    {/* Header */}
                    <div className="header">
                        <div>
                            {storeSettings?.store_logo && (
                                <img src={storeSettings.store_logo} alt="Logo" className="logo" />
                            )}
                            <div className="company-name">{invoice.seller_name}</div>
                            <div style={{ fontSize: "11px", maxWidth: "300px" }}>
                                {invoice.seller_address}
                            </div>
                            {invoice.seller_gstin && (
                                <div style={{ marginTop: "5px" }}>
                                    <strong>GSTIN:</strong> {invoice.seller_gstin}
                                </div>
                            )}
                            {storeSettings?.store_phone && (
                                <div>Phone: {storeSettings.store_phone}</div>
                            )}
                            {storeSettings?.store_email && (
                                <div>Email: {storeSettings.store_email}</div>
                            )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div className="invoice-title">
                                {invoice.invoice_type === "credit_note"
                                    ? "CREDIT NOTE"
                                    : invoice.invoice_type === "debit_note"
                                        ? "DEBIT NOTE"
                                        : "TAX INVOICE"}
                            </div>
                            <div className="invoice-number">{invoice.invoice_number}</div>
                            <div style={{ marginTop: "10px" }}>
                                <strong>Date:</strong>{" "}
                                {format(new Date(invoice.invoice_date), "dd/MM/yyyy")}
                            </div>
                            {invoice.due_date && (
                                <div>
                                    <strong>Due Date:</strong>{" "}
                                    {format(new Date(invoice.due_date), "dd/MM/yyyy")}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bill To / Ship To */}
                    <div className="parties">
                        <div className="party">
                            <div className="party-title">Bill To</div>
                            <div className="party-details">
                                <strong>{invoice.buyer_name}</strong>
                                {invoice.buyer_address && <div>{invoice.buyer_address}</div>}
                                {invoice.buyer_gstin && (
                                    <div>
                                        <strong>GSTIN:</strong> {invoice.buyer_gstin}
                                    </div>
                                )}
                                {invoice.buyer_phone && <div>Phone: {invoice.buyer_phone}</div>}
                                {invoice.buyer_email && <div>Email: {invoice.buyer_email}</div>}
                            </div>
                        </div>
                        <div className="party">
                            <div className="party-title">Details</div>
                            <div className="party-details">
                                <div>
                                    <strong>Place of Supply:</strong> {invoice.place_of_supply}
                                </div>
                                <div>
                                    <strong>Reverse Charge:</strong>{" "}
                                    {invoice.is_reverse_charge ? "Yes" : "No"}
                                </div>
                                {invoice.transport_mode && (
                                    <div>
                                        <strong>Transport:</strong> {invoice.transport_mode}
                                    </div>
                                )}
                                {invoice.vehicle_number && (
                                    <div>
                                        <strong>Vehicle:</strong> {invoice.vehicle_number}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Items Table */}
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: "30px" }}>#</th>
                                <th>Description</th>
                                <th style={{ width: "70px" }}>HSN</th>
                                <th style={{ width: "50px" }} className="text-center">
                                    Qty
                                </th>
                                <th style={{ width: "80px" }} className="text-right">
                                    Rate
                                </th>
                                <th style={{ width: "80px" }} className="text-right">
                                    Taxable
                                </th>
                                {isInterState ? (
                                    <th style={{ width: "80px" }} className="text-right">
                                        IGST
                                    </th>
                                ) : (
                                    <>
                                        <th style={{ width: "70px" }} className="text-right">
                                            CGST
                                        </th>
                                        <th style={{ width: "70px" }} className="text-right">
                                            SGST
                                        </th>
                                    </>
                                )}
                                <th style={{ width: "90px" }} className="text-right">
                                    Total
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoice.items?.map((item, index) => (
                                <tr key={item.id || index}>
                                    <td className="text-center">{index + 1}</td>
                                    <td>{item.description}</td>
                                    <td>{item.hsn_code}</td>
                                    <td className="text-center">
                                        {item.quantity} {item.unit}
                                    </td>
                                    <td className="text-right">{formatINR(item.unit_price)}</td>
                                    <td className="text-right">{formatINR(item.taxable_amount)}</td>
                                    {isInterState ? (
                                        <td className="text-right">
                                            {formatINR(item.igst_amount)}
                                            <br />
                                            <small>@{item.igst_rate}%</small>
                                        </td>
                                    ) : (
                                        <>
                                            <td className="text-right">
                                                {formatINR(item.cgst_amount)}
                                                <br />
                                                <small>@{item.cgst_rate}%</small>
                                            </td>
                                            <td className="text-right">
                                                {formatINR(item.sgst_amount)}
                                                <br />
                                                <small>@{item.sgst_rate}%</small>
                                            </td>
                                        </>
                                    )}
                                    <td className="text-right">{formatINR(item.total_amount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Totals */}
                    <div className="totals">
                        <table className="totals-table">
                            <tbody>
                                <tr>
                                    <td>Taxable Value</td>
                                    <td className="text-right">{formatINR(invoice.taxable_value)}</td>
                                </tr>
                                {isInterState ? (
                                    <tr>
                                        <td>IGST</td>
                                        <td className="text-right">{formatINR(invoice.igst_amount)}</td>
                                    </tr>
                                ) : (
                                    <>
                                        <tr>
                                            <td>CGST</td>
                                            <td className="text-right">
                                                {formatINR(invoice.cgst_amount)}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>SGST</td>
                                            <td className="text-right">
                                                {formatINR(invoice.sgst_amount)}
                                            </td>
                                        </tr>
                                    </>
                                )}
                                {invoice.discount_amount > 0 && (
                                    <tr>
                                        <td>Discount</td>
                                        <td className="text-right">
                                            -{formatINR(invoice.discount_amount)}
                                        </td>
                                    </tr>
                                )}
                                {invoice.shipping_charges > 0 && (
                                    <tr>
                                        <td>Shipping</td>
                                        <td className="text-right">
                                            {formatINR(invoice.shipping_charges)}
                                        </td>
                                    </tr>
                                )}
                                <tr className="grand-total">
                                    <td>
                                        <strong>Grand Total</strong>
                                    </td>
                                    <td className="text-right">
                                        <strong>{formatINR(invoice.grand_total)}</strong>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Amount in Words */}
                    <div className="amount-words">
                        <strong>Amount in Words:</strong> {invoice.amount_in_words}
                    </div>

                    {/* Bank Details */}
                    {storeSettings?.bank_account_no && (
                        <div className="bank-details">
                            <div className="bank-title">Bank Details</div>
                            <div>
                                <strong>Bank:</strong> {storeSettings.bank_name}
                            </div>
                            <div>
                                <strong>Account No:</strong> {storeSettings.bank_account_no}
                            </div>
                            <div>
                                <strong>IFSC:</strong> {storeSettings.bank_ifsc}
                            </div>
                            {storeSettings.bank_branch && (
                                <div>
                                    <strong>Branch:</strong> {storeSettings.bank_branch}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Terms & Signature */}
                    <div className="footer">
                        <div style={{ maxWidth: "400px" }}>
                            {invoice.payment_terms && (
                                <div>
                                    <strong>Terms:</strong> {invoice.payment_terms}
                                </div>
                            )}
                            {invoice.notes && (
                                <div style={{ marginTop: "5px" }}>
                                    <strong>Notes:</strong> {invoice.notes}
                                </div>
                            )}
                            {storeSettings?.invoice_footer && (
                                <div style={{ marginTop: "10px", fontStyle: "italic" }}>
                                    {storeSettings.invoice_footer}
                                </div>
                            )}
                        </div>
                        <div className="signature">
                            <div>For {invoice.seller_name}</div>
                            <div className="signature-line">Authorized Signatory</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
);

InvoicePrint.displayName = "InvoicePrint";

export default InvoicePrint;


