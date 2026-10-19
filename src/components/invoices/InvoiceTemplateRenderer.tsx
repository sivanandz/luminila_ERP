"use client";

import React from "react";
import { format } from "date-fns";
import { formatINR } from "@/lib/gst";
import type { Invoice, StoreSettings } from "@/lib/invoice";
import { ShieldCheck } from "lucide-react";

export type InvoiceTemplateType = "retail" | "wholesale" | "estimate" | "thermal";

interface InvoiceTemplateRendererProps {
    invoice: Invoice;
    template: InvoiceTemplateType;
    storeSettings?: StoreSettings | null;
}

// Legacy camelCase field names found in older store-settings records (localStorage
// blobs saved before the snake_case StoreSettings shape); read below as fallbacks.
interface LegacyStoreSettings {
    isGstRegistered?: boolean;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    storeName?: string;
    stateCode?: string;
    whatsappPhone?: string;
    phone?: string;
    email?: string;
    gstin?: string;
    pan?: string;
    bankName?: string;
    accountNumber?: string;
    ifsc?: string;
    branch?: string;
    invoiceTerms?: string;
    invoiceFooter?: string;
    companyLogo?: string | null;
}

function isInvalidOrDummyAddress(addr?: string | null): boolean {
    if (!addr) return true;
    const lower = addr.toLowerCase().trim();
    return (
        lower === "" ||
        lower.includes("14, car street") ||
        lower.includes("commercial complex") ||
        lower.includes("undefined") ||
        lower.includes("main street")
    );
}

export function InvoiceTemplateRenderer({
    invoice,
    template,
    storeSettings,
}: InvoiceTemplateRendererProps) {
    const legacySettings = storeSettings as LegacyStoreSettings | null;
    const isGstRegistered = storeSettings?.is_gst_registered !== undefined
        ? Boolean(storeSettings.is_gst_registered)
        : legacySettings?.isGstRegistered !== undefined
        ? Boolean(legacySettings?.isGstRegistered)
        : Boolean((invoice.seller_gstin || storeSettings?.store_gstin) && String(invoice.seller_gstin || storeSettings?.store_gstin || "").trim() !== "" && (invoice.seller_gstin || storeSettings?.store_gstin) !== "URP");

    const rawInvoiceAddr = !isInvalidOrDummyAddress(invoice.seller_address) ? String(invoice.seller_address || "").trim() : "";
    const rawSettingsAddr = String(storeSettings?.store_address || legacySettings?.address || "").trim();
    const cleanSettingsAddr = !isInvalidOrDummyAddress(rawSettingsAddr) ? rawSettingsAddr : "";

    const activeBaseAddress = rawInvoiceAddr || cleanSettingsAddr;
    const storeCity = String(storeSettings?.store_city || legacySettings?.city || "").trim();
    const storeState = String(storeSettings?.store_state || legacySettings?.state || "").trim();
    const storePincode = String(storeSettings?.store_pincode || legacySettings?.pincode || "").trim();

    let formattedStoreAddress = activeBaseAddress;
    if (activeBaseAddress) {
        const parts = [activeBaseAddress];
        if (storeCity && !activeBaseAddress.toLowerCase().includes(storeCity.toLowerCase())) {
            parts.push(storeCity);
        }
        const statePin = [
            (storeState && !activeBaseAddress.toLowerCase().includes(storeState.toLowerCase())) ? storeState : "",
            (storePincode && !activeBaseAddress.includes(storePincode)) ? storePincode : ""
        ].filter(Boolean).join(" - ");
        if (statePin) parts.push(statePin);
        formattedStoreAddress = parts.join(", ");
    } else {
        const statePin = [storeState, storePincode].filter(Boolean).join(" - ");
        formattedStoreAddress = [storeCity, statePin].filter(Boolean).join(", ");
    }

    const s = {
        store_name: invoice.seller_name || storeSettings?.store_name || legacySettings?.storeName || "Jewellery Store",
        store_address: activeBaseAddress,
        store_city: storeCity,
        store_state: storeState,
        store_state_code: storeSettings?.store_state_code || legacySettings?.stateCode || "",
        store_pincode: storePincode,
        store_phone: storeSettings?.store_phone || legacySettings?.whatsappPhone || legacySettings?.phone || "",
        store_email: storeSettings?.store_email || legacySettings?.email || "",
        store_gstin: isGstRegistered ? (invoice.seller_gstin || storeSettings?.store_gstin || legacySettings?.gstin || "") : "",
        store_pan: storeSettings?.store_pan || legacySettings?.pan || "",
        bank_name: storeSettings?.bank_name || legacySettings?.bankName || "",
        bank_account_no: storeSettings?.bank_account_no || legacySettings?.accountNumber || "",
        bank_ifsc: storeSettings?.bank_ifsc || legacySettings?.ifsc || "",
        bank_branch: storeSettings?.bank_branch || legacySettings?.branch || "",
        invoice_terms: storeSettings?.invoice_terms || legacySettings?.invoiceTerms || "",
        invoice_footer: storeSettings?.invoice_footer || legacySettings?.invoiceFooter || "Thank you for your business!",
        store_logo: storeSettings?.companyLogo || legacySettings?.companyLogo || storeSettings?.store_logo || "",
        is_gst_registered: isGstRegistered,
    };

    const grandTotal = invoice.grand_total || invoice.total || 0;
    const paidAmount = invoice.paid_amount || 0;
    const balanceDue = Math.max(0, grandTotal - paidAmount);
    const isPaid = invoice.is_paid || balanceDue === 0;
    const cgstAmt = invoice.cgst_amount || 0;
    const sgstAmt = invoice.sgst_amount || 0;
    const igstAmt = invoice.igst_amount || 0;
    const totalTaxAmt = invoice.total_tax || invoice.tax || 0;
    // Inter-state supplies carry IGST only (calculateGST in @/lib/gst); detect from the
    // recorded IGST amount, falling back to seller/buyer state codes for legacy records.
    const isInterState = igstAmt > 0 || Boolean(
        invoice.buyer_state_code && invoice.seller_state_code &&
        invoice.buyer_state_code !== invoice.seller_state_code
    );

    const renderPaymentStamp = () => {
        if (invoice.invoice_type === "credit_note") {
            return (
                <div className="border-4 border-rose-500 text-rose-600 font-extrabold tracking-widest text-sm px-3 py-1 rounded-md rotate-[-8deg] uppercase select-none shadow-sm">
                    CREDIT NOTE
                </div>
            );
        }
        if (template === "estimate") {
            return (
                <div className="border-4 border-indigo-500 text-indigo-600 font-extrabold tracking-widest text-xs px-3 py-1 rounded-md rotate-[-6deg] uppercase select-none shadow-sm">
                    ESTIMATE ONLY
                </div>
            );
        }
        if (isPaid) {
            return (
                <div className="border-4 border-emerald-600 text-emerald-700 font-black tracking-widest text-base px-4 py-1.5 rounded-lg rotate-[-12deg] uppercase select-none shadow-sm flex items-center gap-1.5">
                    <ShieldCheck className="w-5 h-5 inline-block text-emerald-600" />
                    PAID IN FULL
                </div>
            );
        }
        if (paidAmount > 0 && balanceDue > 0) {
            return (
                <div className="border-4 border-amber-600 text-amber-700 font-black tracking-widest text-xs px-3 py-1 rounded-lg rotate-[-10deg] uppercase select-none shadow-sm text-center">
                    <div>PARTIAL PAYMENT</div>
                    <div className="text-[10px] tracking-normal font-bold">{formatINR(balanceDue)} DUE</div>
                </div>
            );
        }
        return (
            <div className="border-4 border-rose-600 text-rose-700 font-black tracking-widest text-xs px-3 py-1 rounded-lg rotate-[-10deg] uppercase select-none shadow-sm text-center">
                <div>UNPAID</div>
                <div className="text-[10px] tracking-normal font-bold">{formatINR(balanceDue)} DUE</div>
            </div>
        );
    };

    // ==========================================
    // 1. THERMAL 3-INCH (80mm) RECEIPT
    // ==========================================
    if (template === "thermal") {
        return (
            <div className="bg-white text-black p-4 font-mono text-[11px] leading-tight max-w-[320px] mx-auto shadow-md border border-slate-200 printable-thermal">
                <div className="text-center pb-2 border-b border-dashed border-slate-400">
                    {s.store_logo && (
                        <div className="flex justify-center mb-1">
                            {/* eslint-disable-next-line @next/next/no-img-element -- store logo is a data URL of unknown natural size in a print receipt, so next/image fixed dimensions or lazy loading could break the render */}
                            <img src={s.store_logo} alt={s.store_name} className="h-8 max-w-[140px] object-contain" />
                        </div>
                    )}
                    <div className="font-bold text-sm tracking-wide uppercase">{s.store_name}</div>
                    {formattedStoreAddress && <div>{formattedStoreAddress}</div>}
                    <div>
                        {isGstRegistered && s.store_gstin ? `GSTIN: ${s.store_gstin} | ` : ""}
                        {s.store_phone ? `Tel: ${s.store_phone}` : ""}
                        {!isGstRegistered && <span className="text-[9px] text-slate-500"> (Unregistered)</span>}
                    </div>
                </div>

                <div className="py-2 border-b border-dashed border-slate-400 space-y-0.5">
                    <div className="flex justify-between font-bold">
                        <span>RCV: #{invoice.invoice_number}</span>
                        <span>{invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd/MM/yy HH:mm") : "-"}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Customer: {invoice.buyer_name || "Walk-in"}</span>
                        <span>{invoice.buyer_phone ? invoice.buyer_phone.slice(-10) : ""}</span>
                    </div>
                </div>

                {/* Items */}
                <table className="w-full my-2 border-collapse">
                    <thead>
                        <tr className="border-b border-dashed border-slate-400 text-left font-bold">
                            <th className="py-1">ITEM</th>
                            <th className="text-center py-1">QTY</th>
                            <th className="text-right py-1">RATE</th>
                            <th className="text-right py-1">AMT</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoice.items.map((item, i) => (
                            <tr key={i} className="border-b border-dotted border-slate-200">
                                <td className="py-1 pr-1">
                                    <div className="font-semibold">{item.description}</div>
                                    {item.hsn_code && <div className="text-[9px] text-slate-500">HSN: {item.hsn_code}</div>}
                                </td>
                                <td className="text-center py-1">{item.quantity}</td>
                                <td className="text-right py-1">₹{item.unit_price}</td>
                                <td className="text-right py-1 font-semibold">₹{item.total_amount || (item.quantity * item.unit_price)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Totals */}
                <div className="pt-2 border-t border-dashed border-slate-400 space-y-1">
                    <div className="flex justify-between">
                        <span>Taxable Value:</span>
                        <span>{formatINR(invoice.taxable_value || invoice.subtotal || 0)}</span>
                    </div>
                    {isGstRegistered ? (
                        <div className="flex justify-between">
                            <span>Total GST:</span>
                            <span>{formatINR(invoice.total_tax || invoice.tax || 0)}</span>
                        </div>
                    ) : (
                        <div className="flex justify-between text-slate-500">
                            <span>GST (0% - Bill of Supply):</span>
                            <span>₹0.00</span>
                        </div>
                    )}
                    {Boolean(invoice.discount_amount || invoice.discount) && (
                        <div className="flex justify-between text-slate-600">
                            <span>Discount:</span>
                            <span>-{formatINR(invoice.discount_amount || invoice.discount || 0)}</span>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-xs pt-1 border-t border-slate-300">
                        <span>NET TOTAL:</span>
                        <span>{formatINR(grandTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Paid:</span>
                        <span>{formatINR(paidAmount)}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                        <span>Balance Due:</span>
                        <span>{formatINR(balanceDue)}</span>
                    </div>
                </div>

                <div className="my-3 flex justify-center">{renderPaymentStamp()}</div>

                <div className="text-center pt-2 border-t border-dashed border-slate-400 space-y-1 text-[10px]">
                    <div className="font-bold">*** THANK YOU - VISIT AGAIN ***</div>
                    <div>Computer Generated Invoice</div>
                </div>
            </div>
        );
    }

    // ==========================================
    // 2. WHOLESALE B2B TAX INVOICE
    // ==========================================
    if (template === "wholesale") {
        return (
            <div className="bg-white text-slate-900 p-8 min-h-[900px] shadow-lg border border-slate-200 font-sans printable-invoice">
                {/* Header */}
                <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
                    <div>
                        {s.store_logo && (
                            /* eslint-disable-next-line @next/next/no-img-element -- store logo is a data URL of unknown natural size in a print layout, so next/image fixed dimensions or lazy loading could break the render */
                            <img src={s.store_logo} alt={s.store_name} className="h-10 max-w-[180px] object-contain mb-2" />
                        )}
                        <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                            {isGstRegistered ? "GST TAX INVOICE (B2B COMMERCIAL)" : "BILL OF SUPPLY (COMMERCIAL INVOICE)"}
                        </span>
                        <h1 className="text-2xl font-black text-slate-950 mt-1 uppercase tracking-tight">{s.store_name}</h1>
                        {formattedStoreAddress && <p className="text-xs text-slate-600 mt-1">{formattedStoreAddress}</p>}
                        {isGstRegistered && s.store_gstin ? (
                            <p className="text-xs text-slate-600">GSTIN: <span className="font-bold text-slate-900">{s.store_gstin}</span>{s.store_state ? ` | State: ${s.store_state} (${s.store_state_code})` : ""}</p>
                        ) : (
                            <p className="text-xs text-slate-600"><span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 mr-1.5">Bill of Supply (0% Tax)</span>{s.store_state ? `State: ${s.store_state} (${s.store_state_code})` : ""}</p>
                        )}
                        {(s.store_email || s.store_phone) && (
                            <p className="text-xs text-slate-600">{[s.store_email ? `Email: ${s.store_email}` : null, s.store_phone ? `Phone: ${s.store_phone}` : null].filter(Boolean).join(" | ")}</p>
                        )}
                    </div>
                    <div className="text-right">
                        <div className="border border-slate-900 px-3 py-1 bg-slate-900 text-white font-mono font-bold text-sm tracking-wider inline-block">
                            INVOICE #{invoice.invoice_number}
                        </div>
                        <div className="mt-2 text-xs space-y-0.5 text-slate-700">
                            <div><span className="text-slate-500">Date:</span> <span className="font-semibold">{invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd-MMM-yyyy") : "-"}</span></div>
                            <div><span className="text-slate-500">Place of Supply:</span> <span className="font-semibold">{invoice.place_of_supply || s.store_state} ({invoice.buyer_state_code || s.store_state_code})</span></div>
                            <div><span className="text-slate-500">Reverse Charge:</span> <span className="font-semibold">{invoice.is_reverse_charge ? "Yes" : "No"}</span></div>
                        </div>
                        <div className="mt-2">{renderPaymentStamp()}</div>
                    </div>
                </div>

                {/* Buyer / Consignee Block */}
                <div className="grid grid-cols-2 gap-4 my-4 p-3 border border-slate-300 rounded bg-slate-50/70 text-xs">
                    <div>
                        <div className="font-bold text-slate-900 uppercase tracking-wide border-b border-slate-200 pb-1 mb-1">Details of Receiver / Billed To:</div>
                        <p className="font-bold text-sm text-slate-950">{invoice.buyer_name || "Counter Walk-in Customer"}</p>
                        {invoice.buyer_address ? (
                            <p className="text-slate-600 mt-0.5">{invoice.buyer_address}</p>
                        ) : (
                            <p className="text-slate-400 italic text-[11px] mt-0.5">In-Store Counter Delivery</p>
                        )}
                        {invoice.buyer_gstin ? (
                            <p className="mt-1">
                                <span className="font-semibold text-slate-800">GSTIN: </span>
                                <span className="font-bold text-slate-950 bg-yellow-100 px-1 py-0.5 rounded border border-yellow-300">{invoice.buyer_gstin}</span>
                            </p>
                        ) : (
                            <p className="text-[11px] text-slate-500 mt-0.5 font-medium">B2C Retail Buyer (Unregistered)</p>
                        )}
                        <p className="text-slate-600">
                            {invoice.buyer_phone ? `Phone: ${invoice.buyer_phone}` : ""}
                            {invoice.buyer_phone && invoice.buyer_email ? " | " : ""}
                            {invoice.buyer_email ? `Email: ${invoice.buyer_email}` : ""}
                        </p>
                    </div>
                    <div>
                        <div className="font-bold text-slate-900 uppercase tracking-wide border-b border-slate-200 pb-1 mb-1">Dispatch & Transport Details:</div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                            <div><span className="text-slate-500">Transport:</span> <span className="font-semibold">{invoice.transport_mode || "In-Store / Direct Delivery"}</span></div>
                            <div><span className="text-slate-500">Vehicle No:</span> <span className="font-semibold">{invoice.vehicle_number || "NA"}</span></div>
                            <div><span className="text-slate-500">E-Way Bill:</span> <span className="font-semibold">{invoice.eway_bill_no || "Exempt / NA"}</span></div>
                            <div><span className="text-slate-500">Credit Terms:</span> <span className="font-semibold">{invoice.payment_terms || "Immediate"}</span></div>
                        </div>
                    </div>
                </div>

                {/* Line Items Table */}
                <table className="w-full text-xs border border-slate-300 border-collapse my-3">
                    <thead>
                        <tr className="bg-slate-900 text-white font-semibold text-left">
                            <th className="p-2 border border-slate-300 text-center w-8">#</th>
                            <th className="p-2 border border-slate-300">Description of Goods</th>
                            <th className="p-2 border border-slate-300 text-center">HSN/SAC</th>
                            <th className="p-2 border border-slate-300 text-center">Qty</th>
                            <th className="p-2 border border-slate-300 text-right">Wholesale Rate</th>
                            <th className="p-2 border border-slate-300 text-right">Taxable Val</th>
                            <th className="p-2 border border-slate-300 text-center">{isGstRegistered ? (isInterState ? "IGST %" : "CGST %") : "Tax"}</th>
                            {isGstRegistered && !isInterState && <th className="p-2 border border-slate-300 text-center">SGST %</th>}
                            <th className="p-2 border border-slate-300 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoice.items.map((item, index) => (
                            <tr key={index} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                <td className="p-2 border border-slate-300 text-center">{index + 1}</td>
                                <td className="p-2 border border-slate-300 font-semibold">{item.description}</td>
                                <td className="p-2 border border-slate-300 text-center font-mono">{item.hsn_code || "7113"}</td>
                                <td className="p-2 border border-slate-300 text-center">{item.quantity} {item.unit || "PCS"}</td>
                                <td className="p-2 border border-slate-300 text-right">{formatINR(item.unit_price)}</td>
                                <td className="p-2 border border-slate-300 text-right font-medium">{formatINR(item.taxable_amount || (item.quantity * item.unit_price))}</td>
                                <td className="p-2 border border-slate-300 text-center">{isGstRegistered ? (isInterState ? `${item.igst_rate || 3}%` : `${item.cgst_rate || 1.5}%`) : "0% (Exempt)"}</td>
                                {isGstRegistered && !isInterState && <td className="p-2 border border-slate-300 text-center">{item.sgst_rate || 1.5}%</td>}
                                <td className="p-2 border border-slate-300 text-right font-bold">{formatINR(item.total_amount || (item.quantity * item.unit_price))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* HSN Tax Summary */}
                <div className="grid grid-cols-2 gap-4 my-3 text-xs">
                    <div>
                        {isGstRegistered ? (
                            <>
                                <div className="font-bold text-slate-800 mb-1">HSN/SAC Tax Breakdown</div>
                                <table className="w-full text-[11px] border border-slate-200">
                                    <thead className="bg-slate-100">
                                        <tr>
                                            <th className="p-1 border border-slate-200 text-left">HSN</th>
                                            <th className="p-1 border border-slate-200 text-right">Taxable</th>
                                            {isInterState ? (
                                                <th className="p-1 border border-slate-200 text-right">IGST</th>
                                            ) : (
                                                <>
                                                    <th className="p-1 border border-slate-200 text-right">CGST</th>
                                                    <th className="p-1 border border-slate-200 text-right">SGST</th>
                                                </>
                                            )}
                                            <th className="p-1 border border-slate-200 text-right">Total Tax</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="p-1 border border-slate-200 font-mono">7113</td>
                                            <td className="p-1 border border-slate-200 text-right">{formatINR(invoice.taxable_value || invoice.subtotal || 0)}</td>
                                            {isInterState ? (
                                                <td className="p-1 border border-slate-200 text-right">{formatINR(igstAmt || totalTaxAmt)}</td>
                                            ) : (
                                                <>
                                                    <td className="p-1 border border-slate-200 text-right">{formatINR(invoice.cgst_amount || 0)}</td>
                                                    <td className="p-1 border border-slate-200 text-right">{formatINR(invoice.sgst_amount || 0)}</td>
                                                </>
                                            )}
                                            <td className="p-1 border border-slate-200 text-right font-semibold">{formatINR(invoice.total_tax || invoice.tax || 0)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </>
                        ) : (
                            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600 space-y-1">
                                <div className="font-bold text-slate-900">Tax Exemption / Bill of Supply:</div>
                                <div>Unregistered artisan / composition dealer. Not eligible to collect tax on supplies. Total tax: ₹0.00.</div>
                            </div>
                        )}

                        <div className="mt-3 p-2 bg-slate-50 border border-slate-200 rounded text-[11px] space-y-0.5">
                            <div className="font-bold text-slate-900">Bank Transfer Details:</div>
                            <div>Bank: <span className="font-semibold">{s.bank_name}</span> | A/C: <span className="font-mono font-semibold">{s.bank_account_no}</span></div>
                            <div>IFSC: <span className="font-mono font-semibold">{s.bank_ifsc}</span> | Branch: {s.bank_branch}</div>
                        </div>
                    </div>

                    <div className="p-3 bg-slate-50 border border-slate-300 rounded space-y-1.5 text-xs">
                        <div className="flex justify-between">
                            <span className="text-slate-600">Total Taxable Value:</span>
                            <span className="font-semibold">{formatINR(invoice.taxable_value || invoice.subtotal || 0)}</span>
                        </div>
                        {isInterState ? (
                            <div className="flex justify-between">
                                <span className="text-slate-600">IGST Amount:</span>
                                <span className="font-semibold">{formatINR(igstAmt || totalTaxAmt)}</span>
                            </div>
                        ) : (
                            <>
                                <div className="flex justify-between">
                                    <span className="text-slate-600">CGST Amount:</span>
                                    <span className="font-semibold">{formatINR(cgstAmt)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-600">SGST Amount:</span>
                                    <span className="font-semibold">{formatINR(sgstAmt)}</span>
                                </div>
                            </>
                        )}
                        {Boolean(invoice.discount_amount || invoice.discount) && (
                            <div className="flex justify-between text-rose-600">
                                <span>Wholesale Tier Discount:</span>
                                <span>-{formatINR(invoice.discount_amount || invoice.discount || 0)}</span>
                            </div>
                        )}
                        <div className="border-t-2 border-slate-900 pt-2 flex justify-between font-black text-sm text-slate-950">
                            <span>TOTAL INVOICE VALUE:</span>
                            <span>{formatINR(grandTotal)}</span>
                        </div>
                        <div className="flex justify-between text-emerald-700 font-semibold pt-1 border-t border-slate-200">
                            <span>Amount Received:</span>
                            <span>{formatINR(paidAmount)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-slate-900">
                            <span>Net Balance Due:</span>
                            <span>{formatINR(balanceDue)}</span>
                        </div>
                    </div>
                </div>

                <div className="text-xs text-slate-700 italic border-t border-slate-200 pt-2 mb-6">
                    <span className="font-semibold not-italic">Amount in Words: </span>
                    {invoice.amount_in_words || "Rupees Only"}
                </div>

                {/* Footer Signatures */}
                <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-300 text-xs">
                    <div>
                        <p className="font-bold mb-10 text-slate-600">Received Goods in Good Condition</p>
                        <p className="border-t border-slate-400 pt-1 font-semibold text-slate-800">Receiver&apos;s Signature & Stamp</p>
                    </div>
                    <div className="text-right">
                        <p className="font-bold mb-10 text-slate-900">For {s.store_name}</p>
                        <p className="border-t border-slate-400 pt-1 font-semibold text-slate-800">Authorized Signatory</p>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // 3. ESTIMATION SLIP / QUOTATION
    // ==========================================
    if (template === "estimate") {
        return (
            <div className="bg-amber-50/20 text-slate-900 p-8 min-h-[900px] shadow-lg border border-amber-200/80 font-sans printable-invoice">
                <div className="flex justify-between items-start border-b-2 border-amber-800/40 pb-4">
                    <div>
                        {s.store_logo && (
                            /* eslint-disable-next-line @next/next/no-img-element -- store logo is a data URL of unknown natural size in a print layout, so next/image fixed dimensions or lazy loading could break the render */
                            <img src={s.store_logo} alt={s.store_name} className="h-9 max-w-[170px] object-contain mb-2" />
                        )}
                        <div className="inline-block bg-amber-100 text-amber-900 font-bold px-2.5 py-0.5 rounded text-[11px] uppercase tracking-wider mb-1 border border-amber-300">
                            ESTIMATION SLIP / PROFORMA QUOTATION (NON-TAXABLE)
                        </div>
                        <h1 className="text-2xl font-serif font-black text-slate-950 mt-1">{s.store_name}</h1>
                        {formattedStoreAddress && <p className="text-xs text-slate-600">{formattedStoreAddress}</p>}
                        {s.store_phone && <p className="text-xs text-slate-600">Contact: {s.store_phone}</p>}
                    </div>
                    <div className="text-right">
                        <div className="font-mono text-sm font-bold text-amber-950">EST-#{invoice.invoice_number}</div>
                        <p className="text-xs text-slate-600 mt-1">Date: {invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd-MMM-yyyy") : "-"}</p>
                        <p className="text-xs text-amber-800 font-semibold">Valid for: 7 Days (Subject to Gold Rate)</p>
                        <div className="mt-2">{renderPaymentStamp()}</div>
                    </div>
                </div>

                <div className="my-4 p-3 bg-white border border-amber-200 rounded text-xs">
                    <span className="font-bold text-slate-700">Prepared for: </span>
                    <span className="font-semibold text-slate-950">{invoice.buyer_name || "Valued Customer"}</span>
                    {invoice.buyer_phone && <span className="text-slate-600"> ({invoice.buyer_phone})</span>}
                </div>

                <table className="w-full text-xs border border-amber-200 border-collapse my-3">
                    <thead>
                        <tr className="bg-amber-900/10 text-amber-950 font-semibold text-left">
                            <th className="p-2 border border-amber-200 text-center w-8">#</th>
                            <th className="p-2 border border-amber-200">Ornament Description</th>
                            <th className="p-2 border border-amber-200 text-center">Purity / Metal</th>
                            <th className="p-2 border border-amber-200 text-center">Qty</th>
                            <th className="p-2 border border-amber-200 text-right">Est. Unit Rate</th>
                            <th className="p-2 border border-amber-200 text-right">Est. Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoice.items.map((item, index) => (
                            <tr key={index} className="bg-white">
                                <td className="p-2 border border-amber-200 text-center">{index + 1}</td>
                                <td className="p-2 border border-amber-200 font-medium">{item.description}</td>
                                <td className="p-2 border border-amber-200 text-center font-mono text-slate-600">—</td>
                                <td className="p-2 border border-amber-200 text-center">{item.quantity}</td>
                                <td className="p-2 border border-amber-200 text-right">{formatINR(item.unit_price)}</td>
                                <td className="p-2 border border-amber-200 text-right font-bold text-slate-950">{formatINR(item.total_amount || (item.quantity * item.unit_price))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="flex justify-end my-4">
                    <div className="w-64 p-3 bg-white border border-amber-300 rounded space-y-1.5 text-xs">
                        <div className="flex justify-between">
                            <span className="text-slate-600">Items Total:</span>
                            <span className="font-semibold">{formatINR(invoice.taxable_value || invoice.subtotal || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-600">{isGstRegistered ? "Est. Tax (3% GST):" : "Est. Tax (0% - Unregistered):"}</span>
                            <span className="font-semibold">{formatINR(invoice.total_tax || invoice.tax || 0)}</span>
                        </div>
                        <div className="border-t border-amber-400 pt-1.5 flex justify-between font-bold text-sm text-amber-950">
                            <span>ESTIMATED VALUE:</span>
                            <span>{formatINR(grandTotal)}</span>
                        </div>
                    </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-950 space-y-1">
                    <div className="font-bold">Notice & Validity:</div>
                    <div>• This estimation slip is not a tax invoice and cannot be used for GST input tax credit.</div>
                    <div>• Prices quoted are indicative and subject to prevailing precious metal bullion rates on the date of final billing.</div>
                </div>

                <div className="flex justify-end pt-12 text-xs">
                    <div className="text-right">
                        <p className="font-bold text-slate-900">For {s.store_name}</p>
                        <p className="mt-8 border-t border-slate-400 pt-1 text-slate-600">Prepared by Staff</p>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // 4. RETAIL GST TAX INVOICE (DEFAULT)
    // ==========================================
    return (
        <div className="bg-white text-slate-900 p-8 min-h-[900px] shadow-lg border border-slate-200 font-sans printable-invoice">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-slate-200 pb-6">
                <div>
                    {s.store_logo && (
                        /* eslint-disable-next-line @next/next/no-img-element -- store logo is a data URL of unknown natural size in a print layout, so next/image fixed dimensions or lazy loading could break the render */
                        <img src={s.store_logo} alt={s.store_name} className="h-10 max-w-[180px] object-contain mb-2" />
                    )}
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-black text-slate-950 tracking-tight">{s.store_name}</h1>
                        <span className="bg-slate-900 text-white text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded">
                            {isGstRegistered ? "TAX INVOICE" : "BILL OF SUPPLY"}
                        </span>
                        {!isGstRegistered && (
                            <span className="bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-semibold px-2 py-0.5 rounded">
                                0% Tax (Composition / Unregistered)
                            </span>
                        )}
                    </div>
                    {formattedStoreAddress && <p className="text-xs text-slate-600 mt-1 max-w-sm">{formattedStoreAddress}</p>}
                    <div className="mt-2 text-xs space-y-0.5 text-slate-600">
                        {isGstRegistered && s.store_gstin ? (
                            <p>GSTIN: <span className="font-bold text-slate-900">{s.store_gstin}</span></p>
                        ) : (
                            <p className="text-slate-500 italic">GST Status: <span className="font-medium text-slate-700">Unregistered Dealer (Not eligible to collect tax)</span></p>
                        )}
                        {(s.store_phone || s.store_email) && (
                            <p>{[s.store_phone ? `Tel: ${s.store_phone}` : null, s.store_email ? `Email: ${s.store_email}` : null].filter(Boolean).join(" | ")}</p>
                        )}
                    </div>
                </div>
                <div className="text-right flex flex-col items-end">
                    <div className="bg-slate-100 border border-slate-300 rounded px-3 py-1 font-mono font-bold text-slate-900 text-sm">
                        #{invoice.invoice_number}
                    </div>
                    <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                        <p><span className="text-slate-500">Date:</span> <span className="font-semibold text-slate-900">{invoice.invoice_date ? format(new Date(invoice.invoice_date), "dd MMM yyyy") : "-"}</span></p>
                        <p><span className="text-slate-500">State Code:</span> <span className="font-semibold text-slate-900">{s.store_state_code} ({s.store_state})</span></p>
                    </div>
                    <div className="mt-3">{renderPaymentStamp()}</div>
                </div>
            </div>

            {/* Billed To */}
            <div className="grid grid-cols-2 gap-6 my-6 border-b border-slate-200 pb-6 text-xs">
                <div>
                    <p className="font-bold uppercase tracking-wider text-slate-400 text-[10px] mb-1">Customer / Billed To</p>
                    <p className="font-bold text-sm text-slate-950">{invoice.buyer_name || "Walk-in Customer"}</p>
                    {invoice.buyer_phone && <p className="text-slate-600 mt-0.5">Mobile: {invoice.buyer_phone}</p>}
                    {invoice.buyer_address && <p className="text-slate-600 mt-0.5">{invoice.buyer_address}</p>}
                    {invoice.buyer_gstin && <p className="text-slate-900 font-semibold mt-1">GSTIN: {invoice.buyer_gstin}</p>}
                </div>
                <div className="text-right space-y-1">
                    <p className="font-bold uppercase tracking-wider text-slate-400 text-[10px] mb-1">Invoice Summary</p>
                    <p><span className="text-slate-500">Invoice Type:</span> <span className="font-semibold uppercase text-slate-900">{invoice.invoice_type}</span></p>
                    <p><span className="text-slate-500">Payment Status:</span> <span className="font-semibold text-slate-900 uppercase">{isPaid ? "Paid" : "Pending"}</span></p>
                    <p><span className="text-slate-500">Place of Supply:</span> <span className="font-semibold text-slate-900">{invoice.place_of_supply || s.store_state}</span></p>
                </div>
            </div>

            {/* Table */}
            <table className="w-full text-xs border-collapse my-4">
                <thead>
                    <tr className="border-b-2 border-slate-900 text-slate-900 text-left font-bold">
                        <th className="py-2 text-center w-8">#</th>
                        <th className="py-2">Item Description</th>
                        <th className="py-2 text-center">HSN</th>
                        <th className="py-2 text-center">Qty</th>
                        <th className="py-2 text-right">Rate</th>
                        <th className="py-2 text-right">Taxable Amt</th>
                        <th className="py-2 text-right">{isGstRegistered ? "GST" : "Tax"}</th>
                        <th className="py-2 text-right">Total</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {invoice.items.map((item, i) => (
                        <tr key={i}>
                            <td className="py-2.5 text-center text-slate-500">{i + 1}</td>
                            <td className="py-2.5">
                                <div className="font-semibold text-slate-900">{item.description}</div>
                            </td>
                            <td className="py-2.5 text-center font-mono text-slate-600">{item.hsn_code || "7113"}</td>
                            <td className="py-2.5 text-center font-medium">{item.quantity}</td>
                            <td className="py-2.5 text-right font-medium">{formatINR(item.unit_price)}</td>
                            <td className="py-2.5 text-right">{formatINR(item.taxable_amount || (item.quantity * item.unit_price))}</td>
                            <td className="py-2.5 text-right text-slate-600">
                                {isGstRegistered
                                    ? ((item.cgst_amount || item.sgst_amount) ? formatINR((item.cgst_amount || 0) + (item.sgst_amount || 0)) : `${((item.cgst_rate || 0) + (item.sgst_rate || 0)) || 3}%`)
                                    : "0%"}
                            </td>
                            <td className="py-2.5 text-right font-bold text-slate-900">
                                {formatINR(item.total_amount || (item.quantity * item.unit_price))}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Totals & Financials */}
            <div className="grid grid-cols-2 gap-8 my-6 pt-4 border-t border-slate-200 text-xs">
                <div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded text-[11px] space-y-1">
                        <div className="font-bold text-slate-800">Bank Details for Payment:</div>
                        <div>Bank: <span className="font-semibold">{s.bank_name}</span></div>
                        <div>A/C Number: <span className="font-mono font-semibold">{s.bank_account_no}</span></div>
                        <div>IFSC: <span className="font-mono font-semibold">{s.bank_ifsc}</span> | Branch: {s.bank_branch}</div>
                    </div>

                    {/* Installments History Preview if any */}
                    {Boolean(invoice.payments && invoice.payments.length > 0) && (
                        <div className="mt-3 p-3 bg-emerald-50/50 border border-emerald-200 rounded text-[11px]">
                            <div className="font-bold text-emerald-900 mb-1">Payments Received ({invoice.payments?.length}):</div>
                            <div className="space-y-0.5">
                                {invoice.payments?.map((pm, idx) => (
                                    <div key={idx} className="flex justify-between text-emerald-800">
                                        <span>{pm.date ? format(new Date(pm.date), "dd/MM/yy") : "-"} ({pm.method.toUpperCase()}):</span>
                                        <span className="font-semibold">{formatINR(pm.amount)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between text-slate-600">
                        <span>Taxable Amount:</span>
                        <span className="font-medium text-slate-900">{formatINR(invoice.taxable_value || invoice.subtotal || 0)}</span>
                    </div>
                    {isGstRegistered ? (
                        isInterState ? (
                            <div className="flex justify-between text-slate-600">
                                <span>IGST (3%):</span>
                                <span className="font-medium text-slate-900">{formatINR(igstAmt || totalTaxAmt)}</span>
                            </div>
                        ) : (
                            <>
                                <div className="flex justify-between text-slate-600">
                                    <span>CGST (1.5%):</span>
                                    <span className="font-medium text-slate-900">{formatINR(cgstAmt || (totalTaxAmt / 2))}</span>
                                </div>
                                <div className="flex justify-between text-slate-600">
                                    <span>SGST (1.5%):</span>
                                    <span className="font-medium text-slate-900">{formatINR(sgstAmt || (totalTaxAmt / 2))}</span>
                                </div>
                            </>
                        )
                    ) : (
                        <div className="flex justify-between text-slate-500 text-[11px] italic">
                            <span>GST (0% - Bill of Supply):</span>
                            <span className="font-medium text-slate-700">₹0.00</span>
                        </div>
                    )}
                    {Boolean(invoice.discount_amount || invoice.discount) && (
                        <div className="flex justify-between text-rose-600">
                            <span>Discount:</span>
                            <span className="font-medium">-{formatINR(invoice.discount_amount || invoice.discount || 0)}</span>
                        </div>
                    )}
                    <div className="border-t-2 border-slate-900 pt-2 flex justify-between font-black text-base text-slate-950">
                        <span>GRAND TOTAL:</span>
                        <span>{formatINR(grandTotal)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 font-semibold pt-1">
                        <span>Amount Paid:</span>
                        <span>{formatINR(paidAmount)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900">
                        <span>Balance Due:</span>
                        <span>{formatINR(balanceDue)}</span>
                    </div>
                </div>
            </div>

            <div className="text-xs text-slate-600 italic border-t border-slate-100 pt-2 mb-8">
                <span className="font-semibold not-italic">Amount in Words: </span>
                {invoice.amount_in_words || "Rupees Only"}
            </div>

            {/* Terms and Signatory */}
            <div className="grid grid-cols-2 gap-8 border-t border-slate-200 pt-6 text-[11px] text-slate-600">
                <div>
                    <p className="font-bold text-slate-800 mb-1">Terms & Conditions:</p>
                    <p className="whitespace-pre-line leading-relaxed">{s.invoice_terms}</p>
                </div>
                <div className="text-right flex flex-col justify-between items-end">
                    <p className="font-bold text-slate-900">For {s.store_name}</p>
                    <div className="mt-12 border-t border-slate-400 pt-1 w-48 text-center font-medium text-slate-700">
                        Authorized Signatory
                    </div>
                </div>
            </div>
        </div>
    );
}
