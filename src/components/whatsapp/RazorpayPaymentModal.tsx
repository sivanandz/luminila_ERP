"use client";

import React, { useState } from "react";
import { CreditCard, X, ExternalLink, Copy, Check, Send, Loader2, Sparkles } from "lucide-react";
import { createPaymentLink, isRazorpayConfigured } from "@/lib/razorpay";
import { pb } from "@/lib/pocketbase";

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
    const [name, setName] = useState(customerName);
    const [phone, setPhone] = useState(customerPhone);
    const [description, setDescription] = useState("Luminila Jewels Order Payment");
    const [isLoading, setIsLoading] = useState(false);
    const [generatedLink, setGeneratedLink] = useState<{ url: string; id: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Sync defaults when modal opens
    React.useEffect(() => {
        if (isOpen) {
            setAmount(defaultAmount);
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
            const res = await createPaymentLink({
                orderId: orderRef,
                amount,
                customerName: name,
                customerPhone: phone,
                description,
            });

            if (res.success && res.data?.short_url) {
                setGeneratedLink({
                    url: res.data.short_url,
                    id: res.data.id,
                });

                // Ledger link in PocketBase (spec §12.1 payment_links) for reconciler
                try {
                    const payload: Record<string, any> = {
                        provider: 'razorpay',
                        link_id: res.data.id,
                        short_url: res.data.short_url,
                        amount,
                        currency: 'INR',
                        status: 'created',
                        notes: {
                            source: 'whatsapp_chat_modal',
                            customer_name: name,
                            customer_phone: phone,
                            order_ref: orderRef,
                        },
                    };
                    if (customerId) payload.customer = customerId;
                    if (defaultOrderId && !defaultOrderId.startsWith('WA-')) {
                        payload.order = defaultOrderId;
                    }
                    await pb.collection('payment_links').create(payload);
                } catch (ledgerErr) {
                    console.warn('[RazorpayPaymentModal] payment_links ledger failed:', ledgerErr);
                }
            } else {
                setError(res.error || "Failed to generate Razorpay link");
            }
        } catch (err: any) {
            setError(err.message || "Network error");
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
            onSendPaymentLinkToChat(generatedLink.url, amount);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
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
                                Payable Amount (₹)
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
                                    className="w-full bg-muted/40 border border-border rounded-xl pl-8 pr-4 py-2.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
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
                                    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
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
                                    Generate Payment Link
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
                            <p className="text-xs text-muted-foreground">
                                Amount: <span className="font-bold text-foreground">₹{amount.toLocaleString('en-IN')}</span>
                            </p>
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
