"use client";

import React, { useState, useMemo } from "react";
import { CreditCard, X, ExternalLink, Copy, Check, Send, Loader2, Sparkles, ShieldCheck, Percent } from "lucide-react";
import { createPaymentLink } from "@/lib/razorpay";
import { createPaymentLinkLedger } from "@/lib/payment-links";
import {
    calculateGatewayMarkup,
    calculateUpiSurchargeDiscount,
    isUpiDiscountEnabled,
    setUpiDiscountEnabled,
    DEFAULT_RAZORPAY_FEE_PERCENT,
    DEFAULT_UPI_DISCOUNT_THRESHOLD,
} from "@/lib/channel-pricing";

export interface RazorpayPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    customerName?: string;
    customerPhone?: string;
    customerId?: string;
    defaultAmount?: number;
    defaultOrderId?: string;
    onSendPaymentLinkToChat: (linkUrl: string, amount: number) => void;
}

export function RazorpayPaymentModal({
    isOpen,
    onClose,
    customerName = "",
    customerPhone = "",
    customerId,
    defaultAmount = 0,
    defaultOrderId = "",
    onSendPaymentLinkToChat,
}: RazorpayPaymentModalProps) {
    const [amount, setAmount] = useState<number>(defaultAmount);
    const [includeMarkup, setIncludeMarkup] = useState<boolean>(true);
    const [upiDiscountEnabled, setUpiDiscountState] = useState<boolean>(() => isUpiDiscountEnabled());
    const [name, setName] = useState(customerName);
    const [phone, setPhone] = useState(customerPhone);
    const [description, setDescription] = useState("Luminila Jewels Order Payment");
    const [isLoading, setIsLoading] = useState(false);
    const [generatedLink, setGeneratedLink] = useState<{ url: string; id: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Sync external toggle events (e.g. from Settings or other modals)
    React.useEffect(() => {
        const handler = (e: Event) => {
            const custom = e as CustomEvent<{ enabled: boolean }>;
            if (custom.detail) setUpiDiscountState(custom.detail.enabled);
        };
        window.addEventListener("luminila:upi-discount-toggled", handler);
        return () => window.removeEventListener("luminila:upi-discount-toggled", handler);
    }, []);

    const handleToggleUpiDiscount = (checked: boolean) => {
        setUpiDiscountState(checked);
        setUpiDiscountEnabled(checked);
    };

    // Calculate 2.2% gateway markup to preserve razor-thin imitation jewelry margins
    const markupInfo = useMemo(() => {
        return calculateGatewayMarkup(amount, DEFAULT_RAZORPAY_FEE_PERCENT);
    }, [amount]);

    // Calculate UPI < 2,000 Surcharge Discount (0% MDR waiver under RBI/NPCI rules)
    const isUpiEligible = amount > 0 && amount < DEFAULT_UPI_DISCOUNT_THRESHOLD;
    const upiDiscountInfo = useMemo(() => {
        return calculateUpiSurchargeDiscount(
            amount,
            true,
            upiDiscountEnabled,
            DEFAULT_UPI_DISCOUNT_THRESHOLD,
            DEFAULT_RAZORPAY_FEE_PERCENT
        );
    }, [amount, upiDiscountEnabled]);

    const isDiscountApplied = includeMarkup && upiDiscountInfo.applicable;
    const finalChargeAmount = isDiscountApplied
        ? upiDiscountInfo.finalCustomerCharge
        : (includeMarkup ? markupInfo.grossAmount : amount);

    // Sync defaults when modal opens
    React.useEffect(() => {
        if (isOpen) {
            setAmount(defaultAmount);
            setIncludeMarkup(true);
            setName(customerName);
            setPhone(customerPhone);
            setGeneratedLink(null);
            setError(null);
        }
    }, [isOpen, defaultAmount, customerName, customerPhone]);

    if (!isOpen) return null;

    const handleCreateLink = async () => {
        if (!amount || amount <= 0) {
            setError("Please enter a valid payment amount");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const orderRef = defaultOrderId || `WA-${Date.now().toString().slice(-6)}`;
            const linkDesc = isDiscountApplied
                ? `${description} (UPI < ₹2k: 0% MDR Surcharge Waived)`
                : (includeMarkup ? `${description} (incl. 2.2% PG fee)` : description);

            const res = await createPaymentLink({
                orderId: orderRef,
                amount: finalChargeAmount,
                customerName: name,
                customerPhone: phone,
                description: linkDesc,
                notes: {
                    net_order_amount: String(amount),
                    gateway_fee_amount: String(includeMarkup ? markupInfo.feeAmount : 0),
                    markup_applied: String(includeMarkup),
                    upi_surcharge_discount_applied: String(isDiscountApplied),
                    discount_amount: String(isDiscountApplied ? upiDiscountInfo.discountAmount : 0),
                },
            });

            if (res.success && res.data?.short_url) {
                setGeneratedLink({
                    url: res.data.short_url,
                    id: res.data.id,
                });

                // Ledger link in PocketBase (spec §12.1 payment_links) for reconciler
                try {
                    const payload: Record<string, unknown> = {
                        provider: 'razorpay',
                        link_id: res.data.id,
                        short_url: res.data.short_url,
                        amount: finalChargeAmount,
                        currency: 'INR',
                        status: 'created',
                        notes: {
                            source: 'whatsapp_chat_modal',
                            customer_name: name,
                            customer_phone: phone,
                            order_ref: orderRef,
                            net_target_amount: String(amount),
                            gateway_fee: String(includeMarkup ? markupInfo.feeAmount : 0),
                            markup_applied: String(includeMarkup),
                            upi_surcharge_discount_applied: String(isDiscountApplied),
                            discount_amount: String(isDiscountApplied ? upiDiscountInfo.discountAmount : 0),
                        },
                    };
                    if (customerId) payload.customer = customerId;
                    if (defaultOrderId && !defaultOrderId.startsWith('WA-')) {
                        payload.order = defaultOrderId;
                    }
                    await createPaymentLinkLedger(payload);
                } catch (ledgerErr) {
                    console.warn('[RazorpayPaymentModal] payment_links ledger failed:', ledgerErr);
                }
            } else {
                setError(res.error || "Failed to generate Razorpay link");
            }
        } catch (err) {
            setError((err instanceof Error ? err.message : String(err)) || "Network error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = () => {
        if (generatedLink) {
            navigator.clipboard.writeText(generatedLink.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleSendToChat = () => {
        if (generatedLink) {
            onSendPaymentLinkToChat(generatedLink.url, finalChargeAmount);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 text-foreground space-y-5 animate-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border pb-3">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
                            ₹
                        </div>
                        <div>
                            <h3 className="font-bold text-base">Razorpay Payment Link</h3>
                            <p className="text-xs text-muted-foreground">Instant UPI / Card Payment Link for WhatsApp</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                    >
                        <X size={18} />
                    </button>
                </div>

                {error && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-xs">
                        ⚠️ {error}
                    </div>
                )}

                {!generatedLink ? (
                    <div className="space-y-4">
                        {/* Amount */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                Net Target Amount (₹)
                            </label>
                            <div className="relative">
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-base text-muted-foreground">
                                    ₹
                                </span>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={amount || ""}
                                    onChange={(e) => setAmount(Number(e.target.value))}
                                    placeholder="2,500"
                                    className="w-full bg-muted/40 border border-border rounded-xl pl-8 pr-4 py-2.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                                />
                            </div>
                        </div>

                        {/* 2.2% Razorpay Fee Markup Protection */}
                        <div className="p-3 bg-muted/30 border border-border/80 rounded-xl space-y-2.5">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold select-none">
                                    <input
                                        type="checkbox"
                                        checked={includeMarkup}
                                        onChange={(e) => setIncludeMarkup(e.target.checked)}
                                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 accent-blue-600 cursor-pointer"
                                    />
                                    <span className="flex items-center gap-1.5">
                                        <ShieldCheck size={14} className="text-emerald-500" />
                                        Include 2.2% Gateway Markup (MDR Protection)
                                    </span>
                                </label>
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">
                                    2.2% MDR
                                </span>
                            </div>

                            {/* UPI < ₹2,000 Zero-MDR Surcharge Discount Option */}
                            {isUpiEligible && includeMarkup && (
                                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-1.5 animate-in fade-in">
                                    <div className="flex items-center justify-between">
                                        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold select-none text-emerald-400">
                                            <input
                                                type="checkbox"
                                                checked={upiDiscountEnabled}
                                                onChange={(e) => handleToggleUpiDiscount(e.target.checked)}
                                                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                                            />
                                            <span className="flex items-center gap-1.5">
                                                <Sparkles size={13} className="text-emerald-400" />
                                                UPI &lt; ₹2k Surcharge Discount (0% MDR)
                                            </span>
                                        </label>
                                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                            {upiDiscountEnabled ? `-${markupInfo.feeAmount} (Waived)` : "OFF"}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-tight">
                                        {upiDiscountEnabled
                                            ? `✓ Under RBI/NPCI guidelines, UPI < ₹2,000 carries 0% MDR. 100% surcharge discount applied for customer.`
                                            : `⚠️ Discount disabled: Customer will be charged full markup gross of ₹${markupInfo.grossAmount.toLocaleString('en-IN')}.`}
                                    </p>
                                </div>
                            )}

                            {amount > 0 && (
                                <div className={`grid ${isDiscountApplied ? 'grid-cols-4' : 'grid-cols-3'} gap-2 pt-2 border-t border-border/50 text-[11px]`}>
                                    <div>
                                        <span className="text-muted-foreground block text-[10px]">Net Payout:</span>
                                        <span className="font-mono font-bold text-foreground">₹{amount.toLocaleString('en-IN')}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block text-[10px]">Gateway Fee:</span>
                                        <span className={`font-mono font-bold ${includeMarkup ? "text-amber-500" : "text-destructive"}`}>
                                            {includeMarkup ? `+₹${markupInfo.feeAmount}` : `-₹${Math.round(amount * 0.022)}`}
                                        </span>
                                    </div>
                                    {isDiscountApplied && (
                                        <div>
                                            <span className="text-muted-foreground block text-[10px]">UPI Discount:</span>
                                            <span className="font-mono font-bold text-emerald-400">
                                                -₹{markupInfo.feeAmount}
                                            </span>
                                        </div>
                                    )}
                                    <div className="text-right">
                                        <span className="text-muted-foreground block text-[10px]">Customer Pays:</span>
                                        <span className="font-mono font-bold text-blue-500 text-xs">
                                            ₹{finalChargeAmount.toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <p className="text-[10px] text-muted-foreground leading-tight">
                                {isDiscountApplied
                                    ? "✓ 0% MDR surcharge waiver active for UPI under ₹2,000. Customer pays net amount, zero margin loss."
                                    : includeMarkup 
                                    ? "✓ Customer pays the 2.2% gateway fee. You receive your full desired profit without margin leakage."
                                    : "⚠️ 2.2% fee will be deducted from your payout. Your net realized receipt will be lower."}
                            </p>
                        </div>

                        {/* Customer Info */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-xs text-muted-foreground font-medium">Customer Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Name"
                                    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-muted-foreground font-medium">WhatsApp Phone</label>
                                <input
                                    type="text"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="9876543210"
                                    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                                />
                            </div>
                        </div>

                        {/* Description */}
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground font-medium">Payment Description</label>
                            <input
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Order notes or items description"
                                className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>

                        {/* Generate Action Button */}
                        <button
                            onClick={handleCreateLink}
                            disabled={isLoading}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50 text-sm"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Creating Razorpay Link...
                                </>
                            ) : (
                                <>
                                    <CreditCard size={16} />
                                    Generate Payment Link ({finalChargeAmount > 0 ? `₹${finalChargeAmount.toLocaleString('en-IN')}` : '₹0'})
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    /* Link Generated Success View */
                    <div className="space-y-4 animate-in fade-in duration-150">
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2 text-center">
                            <div className="inline-flex p-2 bg-emerald-500/20 text-emerald-500 rounded-full mb-1">
                                <Sparkles size={20} />
                            </div>
                            <h4 className="font-bold text-sm text-foreground">Razorpay Payment Link Ready!</h4>
                            <div className="flex items-center justify-center gap-4 text-xs">
                                <div>
                                    <span className="text-muted-foreground">Customer Pays: </span>
                                    <span className="font-bold text-blue-500 font-mono">₹{finalChargeAmount.toLocaleString('en-IN')}</span>
                                </div>
                                {includeMarkup && (
                                    <div className="text-emerald-500 font-medium">
                                        (Net settlement: ₹{amount.toLocaleString('en-IN')})
                                    </div>
                                )}
                            </div>
                            <div className="mt-2 p-2.5 bg-background rounded-lg border border-border/80 flex items-center justify-between text-xs font-mono break-all select-all">
                                <span className="text-blue-500 truncate mr-2">{generatedLink.url}</span>
                                <button
                                    onClick={handleCopy}
                                    className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground shrink-0"
                                    title="Copy Link"
                                >
                                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSendToChat}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs shadow-md transition-all"
                            >
                                <Send size={14} />
                                Send into WhatsApp Chat
                            </button>
                            <button
                                onClick={() => window.open(generatedLink.url, "_blank")}
                                className="p-2.5 bg-muted hover:bg-muted/80 rounded-xl border border-border text-xs flex items-center gap-1.5 font-medium"
                                title="Open in browser"
                            >
                                <ExternalLink size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
