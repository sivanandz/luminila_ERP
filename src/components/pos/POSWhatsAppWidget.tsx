"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Loader2, BadgeCheck, CreditCard, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { pb } from "@/lib/pocketbase";
import { whatsappManager, checkNumberStatus } from "@/lib/whatsapp";
import { createPaymentLink, isRazorpayConfigured } from "@/lib/razorpay";
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

    const lines = [
        '✨ *LUMINILA JEWELRY* ✨',
        '',
        `Dear ${customer.name}, thank you for your purchase! 🙏`,
        '',
        `🧾 Document: *${input.invoiceNumber || 'POS Sale'}*`,
        `📅 ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        `💰 Total: *₹${input.total.toLocaleString('en-IN')}*`,
        input.paymentMethod ? `💳 Paid via ${input.paymentMethod.toUpperCase()}` : '',
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
    const [sendingLink, setSendingLink] = useState(false);
    const [sendingReceipt, setSendingReceipt] = useState(false);
    const sentRef = useRef(false);

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
            const result = await createPaymentLink({
                orderId,
                amount: total,
                customerName: customer.name,
                customerPhone: customer.phone,
                description: `Luminila POS checkout${invoiceNumber ? ` ${invoiceNumber}` : ''}`,
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
                    amount: total,
                    currency: 'INR',
                    customer: customerId || '',
                    status: 'created',
                    notes: { source: 'pos_checkout', order_ref: orderId },
                });
            } catch (err) {
                console.warn('payment_links record failed:', err);
            }

            const message = [
                '✨ *LUMINILA JEWELRY* ✨',
                '',
                `Dear ${customer.name}, here is your secure payment link:`,
                '',
                `💰 Amount: *₹${total.toLocaleString('en-IN')}*`,
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
                    defaultChecked
                />
                <span className="text-xs text-moonstone">Send Tax Invoice &amp; Receipt via WhatsApp on checkout</span>
            </label>

            <button
                onClick={handleSendPaymentLink}
                disabled={sendingLink || total <= 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
                {sendingLink ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                Send {formatPrice(total)} Payment Link to Customer&apos;s Phone
            </button>
            {!isRazorpayConfigured() && (
                <p className="text-[10px] text-amber-400/80 mt-1">
                    Razorpay keys not configured — enable in Settings to use payment links.
                </p>
            )}
        </div>
    );
}
