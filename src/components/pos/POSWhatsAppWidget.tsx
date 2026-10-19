"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Loader2, BadgeCheck, CreditCard, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { pb } from "@/lib/pocketbase";
import { whatsappManager, checkNumberStatus } from "@/lib/whatsapp";
import { createPaymentLink, isRazorpayConfigured } from "@/lib/razorpay";
import {
    calculateGatewayMarkup,
    calculateUpiSurchargeDiscount,
    isUpiDiscountEnabled,
    setUpiDiscountEnabled,
    DEFAULT_UPI_DISCOUNT_THRESHOLD,
} from "@/lib/channel-pricing";
import { formatPrice } from "@/lib/utils";

// ============================================
// Shared receipt dispatcher (spec §5 format)
// ============================================

async function fetchCustomerPhone(customerId: string): Promise<{ name: string; phone: string } | null> {
    try {
        const c = await pb.collection('customers').getOne(customerId);
        return { name: c.name || 'Customer', phone: (c as { phone?: string }).phone || '' };
    } catch {
        return null;
    }
}

export async function sendPOSReceiptViaWhatsApp(input: {
    customerId: string;
    invoiceNumber?: string;
    total: number;
    paymentMethod?: string;
    pointsEarned?: number;
}): Promise<boolean> {
    const customer = await fetchCustomerPhone(input.customerId);
    if (!customer?.phone) {
        toast.error('Customer has no phone number on file');
        return false;
    }

    const isUpiUnder2k = (input.paymentMethod === 'upi' || input.paymentMethod === 'phonepe') &&
        input.total < DEFAULT_UPI_DISCOUNT_THRESHOLD &&
        isUpiDiscountEnabled();

    const lines = [
        '✨ *LUMINILA JEWELRY* ✨',
        '',
        `Dear ${customer.name}, thank you for your purchase! 🙏`,
        '',
        `🧾 Document: *${input.invoiceNumber || 'POS Sale'}*`,
        `📅 ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        `💰 Total: *₹${input.total.toLocaleString('en-IN')}*`,
        input.paymentMethod
            ? `💳 Paid via ${input.paymentMethod.toUpperCase()}${isUpiUnder2k ? ' (0% Surcharge / UPI Discount)' : ''}`
            : '',
        input.pointsEarned ? `\n⭐ You earned *${input.pointsEarned} points* with this purchase!` : '',
        '',
        '_Your official GST invoice is available at the counter. Visit us again soon!_',
    ].filter(Boolean);

    return whatsappManager.sendMessage(customer.phone, lines.join('\n'));
}

// ============================================
// Checkout Messenger Widget (spec §3.3)
// ============================================

export interface POSWhatsAppWidgetProps {
    customerId?: string | null;
    total: number;
    invoiceNumber?: string;
    paymentMethod?: string;
    mode: 'pre-sale' | 'receipt';
    /** Pre-sale mode: reflects the "send on checkout" checkbox to the POS page. */
    autoSendRef?: React.MutableRefObject<boolean>;
    onSent?: () => void;
}

export function POSWhatsAppWidget({
    customerId,
    total,
    invoiceNumber,
    paymentMethod,
    mode,
    autoSendRef,
    onSent,
}: POSWhatsAppWidgetProps) {
    const [customer, setCustomer] = useState<{ name: string; phone: string } | null>(null);
    const [waVerified, setWaVerified] = useState<boolean | null>(null);
    const [autoSend, setAutoSend] = useState(true);
    const [includeGatewayMarkup, setIncludeGatewayMarkup] = useState(true);
    const [upiDiscountEnabled, setUpiDiscountState] = useState<boolean>(() => isUpiDiscountEnabled());
    const [sendingLink, setSendingLink] = useState(false);
    const [sendingReceipt, setSendingReceipt] = useState(false);
    const sentRef = useRef(false);

    // Sync external toggle events (e.g. from Settings or other modals)
    useEffect(() => {
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

    const markupInfo = calculateGatewayMarkup(total, 2.2);

    // Evaluate UPI < 2,000 Surcharge Discount (0% MDR waiver)
    const isUpiEligible = (!paymentMethod || paymentMethod === 'upi' || paymentMethod === 'phonepe') &&
        total > 0 &&
        total < DEFAULT_UPI_DISCOUNT_THRESHOLD;

    const upiDiscountInfo = calculateUpiSurchargeDiscount(
        total,
        isUpiEligible,
        upiDiscountEnabled,
        DEFAULT_UPI_DISCOUNT_THRESHOLD,
        2.2
    );

    const isDiscountApplied = includeGatewayMarkup && upiDiscountInfo.applicable;
    const chargeAmount = isDiscountApplied
        ? upiDiscountInfo.finalCustomerCharge
        : (includeGatewayMarkup ? markupInfo.grossAmount : total);

    useEffect(() => {
        let cancelled = false;
        if (!customerId) {
            setCustomer(null);
            setWaVerified(null);
            return;
        }
        fetchCustomerPhone(customerId).then((c) => {
            if (!cancelled) setCustomer(c);
        });
        return () => { cancelled = true; };
    }, [customerId]);

    // WhatsApp account verification indicator (spec: "Verified WhatsApp account indicator")
    useEffect(() => {
        let cancelled = false;
        const phone = customer?.phone;
        if (!phone) { setWaVerified(null); return; }
        (async () => {
            try {
                const sessionId = localStorage.getItem('wpp_session_id') || 'luminila';
                const { exists } = await checkNumberStatus(sessionId, phone);
                if (!cancelled) setWaVerified(exists);
            } catch {
                if (!cancelled) setWaVerified(null);
            }
        })();
        return () => { cancelled = true; };
    }, [customer?.phone]);

    // Report the auto-send preference up to the POS page
    useEffect(() => {
        if (autoSendRef) autoSendRef.current = autoSend && !!customer?.phone;
    }, [autoSend, customer?.phone, autoSendRef]);

    const handleSendPaymentLink = async () => {
        if (!customer?.phone) return;
        setSendingLink(true);
        try {
            const orderId = `POS-${Date.now().toString(36).toUpperCase()}`;
            const linkDesc = `Luminila POS checkout${invoiceNumber ? ` ${invoiceNumber}` : ''}${
                isDiscountApplied
                    ? ' (UPI < ₹2k 0% MDR Surcharge Waived)'
                    : (includeGatewayMarkup ? ' (incl. 2.2% PG fee)' : '')
            }`;

            const result = await createPaymentLink({
                orderId,
                amount: chargeAmount,
                customerName: customer.name,
                customerPhone: customer.phone,
                description: linkDesc,
            });

            if (!result.success || !result.data) {
                toast.error(result.error || 'Failed to create payment link');
                return;
            }

            // Ledger the link in PocketBase (spec §12.1 payment_links)
            try {
                await pb.collection('payment_links').create({
                    provider: 'razorpay',
                    link_id: result.data.id,
                    short_url: result.data.short_url,
                    amount: chargeAmount,
                    currency: 'INR',
                    customer: customerId || '',
                    status: 'created',
                    notes: {
                        source: 'pos_checkout',
                        order_ref: orderId,
                        net_amount: String(total),
                        gateway_fee: String(includeGatewayMarkup ? markupInfo.feeAmount : 0),
                        markup_applied: String(includeGatewayMarkup),
                        upi_surcharge_discount_applied: String(isDiscountApplied),
                        discount_amount: String(isDiscountApplied ? upiDiscountInfo.discountAmount : 0),
                    },
                });
            } catch (err) {
                console.warn('payment_links record failed:', err);
            }

            const feeNote = isDiscountApplied
                ? ` _(UPI < ₹2k Zero-MDR Surcharge Discount: -₹${markupInfo.feeAmount})_`
                : (includeGatewayMarkup ? ' _(incl. 2.2% gateway fee)_' : '');

            const message = [
                '✨ *LUMINILA JEWELRY* ✨',
                '',
                `Dear ${customer.name}, here is your secure payment link:`,
                '',
                `💰 Amount: *₹${chargeAmount.toLocaleString('en-IN')}*${feeNote}`,
                `🔗 ${result.data.short_url}`,
                '',
                'Tap to pay via UPI, PhonePe, GPay, Cards or NetBanking.',
            ].join('\n');

            const ok = await whatsappManager.sendMessage(customer.phone, message);
            if (ok) {
                toast.success('Payment link sent to WhatsApp');
                onSent?.();
            } else {
                toast.error('Could not reach WhatsApp sidecar — link not sent');
            }
        } finally {
            setSendingLink(false);
        }
    };

    const handleSendReceipt = async () => {
        if (!customerId || sentRef.current) return;
        setSendingReceipt(true);
        try {
            const ok = await sendPOSReceiptViaWhatsApp({
                customerId,
                invoiceNumber,
                total,
                paymentMethod,
            });
            if (ok) {
                sentRef.current = true;
                toast.success('Receipt sent via WhatsApp');
                onSent?.();
            } else {
                toast.error('Failed to send receipt');
            }
        } finally {
            setSendingReceipt(false);
        }
    };

    if (!customerId || !customer) return null;

    if (mode === 'receipt') {
        return (
            <button
                onClick={handleSendReceipt}
                disabled={sendingReceipt || sentRef.current}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
                {sendingReceipt ? <Loader2 size={14} className="animate-spin" /> : sentRef.current ? <BadgeCheck size={14} /> : <Send size={14} />}
                {sentRef.current ? 'Receipt Sent' : 'Send via WhatsApp'}
            </button>
        );
    }

    return (
        <div className="mt-4 pt-4 border-t border-surface-hover">
            <p className="text-xs font-bold text-moonstone uppercase mb-2 flex items-center gap-1.5">
                <MessageCircle size={13} className="text-emerald-400" />
                WhatsApp Checkout
                {waVerified === true && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 normal-case">
                        <BadgeCheck size={12} /> Verified
                    </span>
                )}
                {waVerified === false && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 normal-case">
                        <AlertTriangle size={12} /> Not on WhatsApp
                    </span>
                )}
            </p>

            <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={autoSend}
                    onChange={(e) => setAutoSend(e.target.checked)}
                    className="accent-emerald-500"
                />
                <span className="text-xs text-moonstone">Send Tax Invoice &amp; Receipt via WhatsApp on checkout</span>
            </label>

            <label className="flex items-center justify-between gap-2 mb-2 p-2 rounded-lg bg-bg-navy/80 border border-surface-hover cursor-pointer text-xs select-none">
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={includeGatewayMarkup}
                        onChange={(e) => setIncludeGatewayMarkup(e.target.checked)}
                        className="accent-emerald-500 rounded"
                    />
                    <span className="text-silver-light font-medium">Add 2.2% Razorpay Fee (MDR Markup)</span>
                </div>
                <span className="font-mono text-emerald-400 font-bold text-xs">
                    {includeGatewayMarkup ? `${formatPrice(markupInfo.grossAmount)} (+${formatPrice(markupInfo.feeAmount)})` : formatPrice(total)}
                </span>
            </label>

            {/* UPI < ₹2,000 Surcharge Discount Option (0% MDR Policy) */}
            {isUpiEligible && includeGatewayMarkup && (
                <div className="mb-2.5 p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs space-y-1.5 animate-in fade-in">
                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={upiDiscountEnabled}
                                onChange={(e) => handleToggleUpiDiscount(e.target.checked)}
                                className="accent-emerald-500 rounded"
                            />
                            <span className="text-emerald-300 font-semibold flex items-center gap-1">
                                ⚡ UPI &lt; ₹2k Surcharge Waiver Discount (0% MDR)
                            </span>
                        </label>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                            {upiDiscountEnabled ? `-${formatPrice(markupInfo.feeAmount)} (Waived)` : "Disabled"}
                        </span>
                    </div>
                    <div className="text-[10px] text-moonstone flex justify-between items-center pt-0.5 border-t border-emerald-500/20">
                        <span>Net: <b className="text-silver-light">{formatPrice(total)}</b> + Fee: <b className="text-amber-400">+{formatPrice(markupInfo.feeAmount)}</b> {upiDiscountEnabled && <span className="text-emerald-400">- Disc: <b>-{formatPrice(markupInfo.feeAmount)}</b></span>}</span>
                        <span className="font-bold text-emerald-400 font-mono">Charge: {formatPrice(chargeAmount)}</span>
                    </div>
                    <p className="text-[10px] text-emerald-400/80 leading-tight">
                        {upiDiscountEnabled
                            ? "✓ RBI/NPCI 0% MDR applied: Surcharge is 100% discounted for customer paying via UPI."
                            : "⚠️ Feature disabled: Customer will pay the 2.2% gateway fee."}
                    </p>
                </div>
            )}

            <button
                onClick={handleSendPaymentLink}
                disabled={sendingLink || total <= 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
                {sendingLink ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                Send {formatPrice(chargeAmount)} Payment Link to WhatsApp
            </button>
            {!isRazorpayConfigured() && (
                <p className="text-[10px] text-amber-400/80 mt-1">
                    Razorpay keys not configured — enable in Settings to use payment links.
                </p>
            )}
        </div>
    );
}
