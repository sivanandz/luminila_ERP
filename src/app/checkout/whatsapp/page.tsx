"use client";

import React, { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
    Flame,
    Clock,
    ShieldCheck,
    CheckCircle2,
    Lock,
    Truck,
    ArrowRight,
    Loader2,
    Sparkles,
    AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatPrice } from "@/lib/utils";
import {
    getFlashDrop,
    reserveFlashDropStock,
    getReservationCountdown,
    type FlashDropCampaign,
    type FlashDropItem,
    type FlashDropReservation,
} from "@/lib/whatsapp-flash-drops";
import { calculateUpiSurchargeDiscount, isUpiDiscountEnabled } from "@/lib/channel-pricing";

declare global {
    interface Window {
        Razorpay?: new (options: Record<string, unknown>) => {
            open: () => void;
            on: (event: string, handler: (payload: unknown) => void) => void;
        };
    }
}

interface FlashDropApiResponse {
    success?: boolean;
    error?: string;
    paid?: boolean;
    settled?: boolean;
    duplicate?: boolean;
    orderId?: string;
    orderNumber?: string;
    amount?: number;
    drop?: FlashDropCampaign;
    reservation?: FlashDropReservation;
    gateway?: {
        orderId: string;
        amountPaise?: number;
        currency?: string;
        keyId?: string;
    };
}

async function callFlashDropApi(payload: Record<string, unknown>): Promise<FlashDropApiResponse> {
    const res = await fetch("/api/storefront/flash-drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as FlashDropApiResponse | null;
    if (!data) return { success: false, error: "The payment service did not respond." };
    if (!res.ok && !data.error) {
        return { ...data, success: false, error: `Request failed (${res.status}).` };
    }
    return data;
}

function loadRazorpayCheckout(): Promise<boolean> {
    if (typeof window === "undefined") return Promise.resolve(false);
    if (window.Razorpay) return Promise.resolve(true);
    return new Promise((resolve) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout="1"]');
        if (existing) {
            existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)));
            existing.addEventListener("error", () => resolve(false));
            return;
        }
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.dataset.razorpayCheckout = "1";
        script.onload = () => resolve(Boolean(window.Razorpay));
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

function ExpressCheckoutContent() {
    const searchParams = useSearchParams();
    const dropId = searchParams.get("dropId");
    const variantId = searchParams.get("variantId");
    const accountEmail = searchParams.get("account_email") || "";
    const initialPhone = searchParams.get("phone") || "";
    const initialName = searchParams.get("name") || "";

    const [drop, setDrop] = useState<FlashDropCampaign | null>(null);
    const [item, setItem] = useState<FlashDropItem | null>(null);
    const [loading, setLoading] = useState(true);

    // Form inputs
    const [name, setName] = useState(initialName);
    const [phone, setPhone] = useState(initialPhone);
    const [address, setAddress] = useState("");
    const [city, setCity] = useState("");
    const [stateName, setStateName] = useState("");
    const [pincode, setPincode] = useState("");

    // Reservation state
    const [reservation, setReservation] = useState<FlashDropReservation | null>(null);
    const [countdown, setCountdown] = useState<{ isExpired: boolean; remainingSeconds: number; formatted: string }>({
        isExpired: false,
        remainingSeconds: 600,
        formatted: "10:00",
    });
    const [reserving, setReserving] = useState(false);
    const [processingPayment, setProcessingPayment] = useState(false);
    const [orderSuccess, setOrderSuccess] = useState<{ orderNumber: string; amount: number } | null>(null);

    // Load drop and product details through the public server route: the buyer
    // has no ERP session, so PocketBase rules would reject a direct read.
    useEffect(() => {
        if (!dropId) {
            setLoading(false);
            return;
        }

        getFlashDrop(dropId, accountEmail || undefined)
            .then((d) => {
                if (d) {
                    setDrop(d);
                    const foundItem = d.items.find((i) => !variantId || i.variantId === variantId) || d.items[0];
                    setItem(foundItem || null);
                }
            })
            .finally(() => setLoading(false));
    }, [dropId, variantId, accountEmail]);

    // Live countdown timer for reservation
    useEffect(() => {
        if (!reservation || reservation.status !== "active") return;

        const interval = setInterval(() => {
            const cd = getReservationCountdown(reservation.expiresAt);
            setCountdown(cd);
            if (cd.isExpired) {
                toast.error("⚠️ 10-minute reservation hold has expired. Stock released back to pool.");
                clearInterval(interval);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [reservation]);

    const availableStock = item && drop?.availableStock
        ? drop.availableStock[item.variantId]
        : undefined;

    // Reserve stock when customer enters their phone number. The server enforces
    // the hold and the tenant; the browser only carries the phone and variant.
    const handleReserveHold = async (overridePhone?: string) => {
        if (!drop || !item) return;
        const targetPhone = (overridePhone || phone).trim().replace(/\D/g, "");
        if (targetPhone.length < 10) {
            toast.error("Please enter a valid 10-digit WhatsApp phone number to lock reservation");
            return;
        }

        setReserving(true);
        try {
            const res = await reserveFlashDropStock(
                drop.id,
                item.variantId,
                targetPhone,
                name,
                drop.accountEmail || accountEmail || undefined
            );
            if (res.success && res.reservation) {
                setReservation(res.reservation);
                toast.success("🔒 1 piece held exclusively for you for 10 minutes!");
            } else {
                toast.error(res.error || "Could not reserve item");
            }
        } finally {
            setReserving(false);
        }
    };

    // Auto-reserve if phone was pre-filled via WhatsApp URL
    useEffect(() => {
        if (drop && item && !reservation && initialPhone && initialPhone.replace(/\D/g, "").length >= 10) {
            handleReserveHold(initialPhone);
        }
    }, [drop, item]);

    // Calculate pricing and UPI < 2000 surcharge discount
    const itemTotal = item ? item.dropPrice : 0;
    const upiDiscount = useMemo(() => {
        return calculateUpiSurchargeDiscount(itemTotal, true, isUpiDiscountEnabled());
    }, [itemTotal]);

    /** Confirm a Razorpay checkout payment against the server-verified order. */
    const confirmPayment = async (payIntent: FlashDropApiResponse, payment: { razorpay_payment_id?: string; razorpay_order_id?: string; razorpay_signature?: string }) => {
        const paymentId = String(payment.razorpay_payment_id || "");
        if (!payIntent.orderId || !paymentId) {
            setProcessingPayment(false);
            toast.error("Payment was not completed. No order was confirmed.");
            return;
        }
        try {
            const res = await callFlashDropApi({
                action: "order",
                accountEmail: drop?.accountEmail || accountEmail || undefined,
                orderId: payIntent.orderId,
                paymentId,
                signature: payment.razorpay_signature || "",
                phone: phone.replace(/\D/g, ""),
            });
            if (res.success && res.settled) {
                setOrderSuccess({
                    orderNumber: String(res.orderNumber || payIntent.orderNumber || ""),
                    amount: Number(res.amount ?? itemTotal),
                });
            } else {
                // Fail closed: the gateway has the money but the order was not
                // confirmed; surface the reconciliation message instead of a
                // fabricated success screen.
                toast.error(res.error || "Payment received but the order could not be confirmed. Our team will contact you.");
            }
        } catch (err) {
            toast.error("Payment confirmation failed: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setProcessingPayment(false);
        }
    };

    // Handle payment: server creates the ERP order + gateway order, Razorpay
    // collects the money, then the server verifies capture before confirming.
    const handlePayNow = async () => {
        if (!name.trim()) {
            toast.error("Please enter your name");
            return;
        }
        if (!phone.trim() || phone.replace(/\D/g, "").length < 10) {
            toast.error("Please enter a valid WhatsApp phone number");
            return;
        }
        if (!address.trim() || !pincode.trim()) {
            toast.error("Please enter your delivery address and pincode");
            return;
        }
        if (!item || !drop) return;

        // Auto-reserve if not yet reserved
        let currentReservation = reservation;
        if (!currentReservation || countdown.isExpired) {
            const res = await reserveFlashDropStock(
                drop.id,
                item.variantId,
                phone,
                name,
                drop.accountEmail || accountEmail || undefined
            );
            if (!res.success || !res.reservation) {
                toast.error(res.error || "Stock is no longer available.");
                return;
            }
            currentReservation = res.reservation;
            setReservation(res.reservation);
        }

        setProcessingPayment(true);
        try {
            const payIntent = await callFlashDropApi({
                action: "pay-intent",
                accountEmail: drop.accountEmail || accountEmail || undefined,
                dropId: drop.id,
                variantId: item.variantId,
                reservationId: currentReservation?.id || undefined,
                phone: phone.replace(/\D/g, ""),
                name,
                address,
                city,
                state: stateName,
                pincode,
            });

            if (payIntent.paid) {
                setOrderSuccess({
                    orderNumber: String(payIntent.orderNumber || ""),
                    amount: Number(payIntent.amount ?? itemTotal),
                });
                return;
            }
            if (!payIntent.success || !payIntent.gateway?.orderId) {
                toast.error(payIntent.error || "Online payment is unavailable right now. Please retry in a moment.");
                return;
            }

            const ready = await loadRazorpayCheckout();
            if (!ready || !window.Razorpay) {
                toast.error("The secure payment window could not be loaded. Please check your connection and retry.");
                return;
            }

            const checkout = new window.Razorpay({
                key: payIntent.gateway.keyId || "",
                amount: payIntent.gateway.amountPaise,
                currency: payIntent.gateway.currency || "INR",
                name: "Luminila Jewels",
                description: `${item.name} — ${drop.title}`,
                order_id: payIntent.gateway.orderId,
                prefill: { name, contact: phone.replace(/\D/g, "") },
                notes: {
                    drop_id: drop.id,
                    variant_id: item.variantId,
                    source: "whatsapp_flash_drop",
                },
                theme: { color: "#f59e0b" },
                handler: (response: unknown) => {
                    const payment = (response || {}) as {
                        razorpay_payment_id?: string;
                        razorpay_order_id?: string;
                        razorpay_signature?: string;
                    };
                    void confirmPayment(payIntent, payment);
                },
                modal: {
                    ondismiss: () => {
                        setProcessingPayment(false);
                        toast.info("Payment cancelled — your hold is still active until the timer runs out.");
                    },
                },
            });
            checkout.open();
        } catch (err) {
            toast.error("Payment initiation failed: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            // Every early return (sold out, gateway unavailable, script blocked)
            // must re-enable the button; leaving it spinning was a dead end.
            setProcessingPayment(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
                <Loader2 size={32} className="animate-spin text-amber-500 mb-3" />
                <p className="text-slate-400 text-sm">Loading VIP Flash Drop...</p>
            </div>
        );
    }

    if (!drop || !item) {
        return (
            <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 text-center">
                <AlertCircle size={40} className="text-amber-500 mb-3" />
                <h2 className="text-lg font-bold">Flash Drop Not Found</h2>
                <p className="text-slate-400 text-xs mt-1">This drop campaign may have ended or the link is invalid.</p>
            </div>
        );
    }

    if (orderSuccess) {
        return (
            <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
                        <CheckCircle2 size={32} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Order Confirmed! ✨</h2>
                        <p className="text-xs text-slate-400 mt-1">
                            Thank you, <span className="text-white font-semibold">{name}</span>. Your payment was verified and your piece is reserved.
                        </p>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-left space-y-1.5 text-xs font-mono">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Order Ref:</span>
                            <span className="text-amber-400 font-bold">{orderSuccess.orderNumber}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Amount Paid:</span>
                            <span className="text-emerald-400 font-bold">{formatPrice(orderSuccess.amount)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Delivery To:</span>
                            <span className="text-slate-300 truncate max-w-[200px]">{city} ({pincode})</span>
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                        We will send automated WhatsApp milestone photo updates when your piece is Quality Checked, Packed, and Shipped!
                    </p>
                </div>
            </div>
        );
    }

    const soldOut = availableStock !== undefined && availableStock <= 0;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 font-sans">
            <div className="w-full max-w-md mx-auto space-y-4">
                {/* Header Badge */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
                            <Flame size={18} />
                        </div>
                        <div>
                            <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-bold block">
                                VIP FLASH DROP
                            </span>
                            <h1 className="text-xs font-bold text-slate-200 truncate max-w-[200px]">
                                {drop.title}
                            </h1>
                        </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1">
                        <Sparkles size={11} /> 1-Click Checkout
                    </span>
                </div>

                {/* 10-Minute Reservation Guarantee Banner */}
                {reservation && countdown.isExpired ? (
                    <div className="p-3.5 rounded-xl border bg-rose-950/40 border-rose-500/40 text-rose-300 flex items-center justify-between transition-all">
                        <div className="flex items-center gap-2.5">
                            <AlertCircle size={18} className="text-rose-400 shrink-0" />
                            <div>
                                <span className="text-xs font-bold block text-white">
                                    10-Minute Stock Hold Expired
                                </span>
                                <span className="text-[10px] text-rose-300/80">
                                    Reservation released to next buyer. Tap to re-check stock.
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => handleReserveHold()}
                            disabled={reserving}
                            className="px-2.5 py-1 text-[11px] font-bold bg-rose-500 hover:bg-rose-400 text-white rounded-lg transition-colors shrink-0 disabled:opacity-50"
                        >
                            {reserving ? "Checking..." : "Renew Hold"}
                        </button>
                    </div>
                ) : (
                    <div className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
                        reservation && !countdown.isExpired
                            ? "bg-amber-950/40 border-amber-500/50 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                            : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}>
                        <div className="flex items-center gap-2.5">
                            <Clock size={18} className={reservation && !countdown.isExpired ? "text-amber-400 animate-pulse" : "text-amber-400"} />
                            <div>
                                <span className="text-xs font-bold block text-white flex items-center gap-1.5">
                                    {reservation && !countdown.isExpired ? "Stock Held Exclusively For You" : "Strict 10-Minute Hold Policy"}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                    {reservation && !countdown.isExpired
                                        ? "Unpaid orders automatically release at 00:00"
                                        : "Enter WhatsApp phone below to lock your piece for 10 mins"}
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="font-mono font-bold text-sm text-amber-400 block">
                                {reservation ? countdown.formatted : "10:00"}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">
                                {reservation ? "HOLD TIMER" : "HOLD TIME"}
                            </span>
                        </div>
                    </div>
                )}

                {/* Product Card */}
                <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl flex gap-3.5">
                    {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.name} width={72} height={72} className="rounded-xl object-cover shrink-0" />
                    ) : (
                        <div className="w-[72px] h-[72px] rounded-xl bg-slate-800 flex items-center justify-center text-2xl shrink-0">
                            💎
                        </div>
                    )}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                            <h3 className="font-bold text-sm text-white truncate">{item.name}</h3>
                            <p className="text-[11px] font-mono text-slate-400">SKU: {item.sku}</p>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="font-bold text-base text-emerald-400 font-mono">
                                {formatPrice(item.dropPrice)}
                            </span>
                            <span className="text-xs text-slate-500 line-through font-mono">
                                {formatPrice(item.originalPrice)}
                            </span>
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1 rounded">
                                SAVE {item.originalPrice > 0 ? Math.round(((item.originalPrice - item.dropPrice) / item.originalPrice) * 100) : 0}%
                            </span>
                        </div>
                        {availableStock !== undefined && (
                            <span className={`text-[10px] font-semibold ${soldOut ? "text-rose-400" : "text-amber-400"}`}>
                                {soldOut ? "All units claimed" : `${availableStock} unit${availableStock === 1 ? "" : "s"} left in this drop`}
                            </span>
                        )}
                    </div>
                </div>

                {/* Shipping & Contact Form */}
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Truck size={13} className="text-emerald-400" /> Delivery Address
                    </h4>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="space-y-1">
                            <label className="text-[10px] text-slate-400">Full Name</label>
                            <input
                                type="text"
                                placeholder="Priya Sharma"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white focus:outline-none focus:border-amber-500"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] text-slate-400">WhatsApp Phone</label>
                            <div className="relative">
                                <input
                                    type="tel"
                                    placeholder="9876543210"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    onBlur={() => handleReserveHold()}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
                                />
                                {reserving && <Loader2 size={12} className="animate-spin absolute right-2 top-2.5 text-amber-400" />}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1 text-xs">
                        <label className="text-[10px] text-slate-400">Street Address / House No.</label>
                        <input
                            type="text"
                            placeholder="Flat 402, Lotus Residency, MG Road"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white focus:outline-none focus:border-amber-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="space-y-1">
                            <label className="text-[10px] text-slate-400">City</label>
                            <input
                                type="text"
                                placeholder="Mumbai"
                                value={city}
                                onChange={(e) => setCity(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white focus:outline-none focus:border-amber-500"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] text-slate-400">State</label>
                            <input
                                type="text"
                                placeholder="Maharashtra"
                                value={stateName}
                                onChange={(e) => setStateName(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white focus:outline-none focus:border-amber-500"
                            />
                        </div>
                    </div>

                    <div className="space-y-1 text-xs">
                        <label className="text-[10px] text-slate-400">Pincode</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            placeholder="400001"
                            value={pincode}
                            onChange={(e) => setPincode(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
                        />
                    </div>
                </div>

                {/* Explicit 10-Minute Fair-Allocation Notice */}
                <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-start gap-2.5 text-xs">
                    <ShieldCheck size={16} className="text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                        <p className="text-xs font-bold text-amber-300">
                            Strict 10-Minute Hold Policy
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            Due to limited jewelry batch sizes, your piece is held for <strong className="text-white">strictly 10 minutes</strong>. If payment is not completed before the countdown expires, stock is automatically returned to the VIP pool.
                        </p>
                    </div>
                </div>

                {/* Surcharge Waiver Discount Notice (< ₹2,000 Zero-MDR) */}
                {upiDiscount.applicable && (
                    <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs">
                        <span className="text-emerald-400 flex items-center gap-1.5 font-medium">
                            <ShieldCheck size={14} /> 0% UPI Surcharge Waiver Applied
                        </span>
                        <span className="font-mono font-bold text-emerald-400">
                            -₹{upiDiscount.discountAmount} Fee
                        </span>
                    </div>
                )}

                {/* Total & Action */}
                <div className="pt-2">
                    <button
                        onClick={handlePayNow}
                        disabled={Boolean(processingPayment || reserving || soldOut || (reservation && countdown.isExpired))}
                        className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {processingPayment ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : soldOut ? (
                            <span>Sold Out — All Units Claimed</span>
                        ) : reservation && countdown.isExpired ? (
                            <span>Hold Expired — Tap Renew Hold Above</span>
                        ) : (
                            <>
                                <span>
                                    Pay {formatPrice(item.dropPrice)} with UPI {reservation && !countdown.isExpired ? `(${countdown.formatted})` : ''}
                                </span>
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                    <p className="text-[10px] text-slate-500 text-center mt-2 flex items-center justify-center gap-1">
                        <Lock size={10} /> 256-bit Encrypted Bank-Grade UPI Checkout • Free Delivery
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function ExpressWhatsAppCheckoutPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-amber-500" />
            </div>
        }>
            <ExpressCheckoutContent />
        </Suspense>
    );
}
