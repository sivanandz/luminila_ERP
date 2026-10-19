"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { submitStorefrontOrder, formatWhatsAppCartMessage } from "@/lib/pocketbase";
import { checkShiprocketPincode, CourierServiceability } from "@/lib/shiprocket";
import { openRazorpayCheckout } from "@/lib/razorpay";
import {
    ArrowLeft,
    CheckCircle2,
    Shield,
    Truck,
    CreditCard,
    MessageCircle,
    ShoppingBag,
    Loader2,
    Tag,
    X,
    Lock,
    Award,
    AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getStorefrontApiUrl } from "@/lib/api";
import { useCustomerAuth } from "@/context/CustomerAuthContext";

export default function CheckoutPage() {
    const { cart, cartSubtotal, cartCount, clearCart } = useCart();
    const { customer, isAuthenticated, openAuthModal } = useCustomerAuth();

    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [customerEmail, setCustomerEmail] = useState("");
    const [shippingAddress, setShippingAddress] = useState("");
    const [city, setCity] = useState("");
    const [stateVal, setStateVal] = useState("Tamil Nadu");
    const [pincode, setPincode] = useState("");

    // Auto-fill customer details if logged in via WhatsApp OTP
    useEffect(() => {
        if (customer) {
            if (customer.name && !customerName) setCustomerName(customer.name);
            if (customer.phone && !customerPhone) setCustomerPhone(customer.phone);
            if (customer.email && !customerEmail) setCustomerEmail(customer.email);
            if (customer.address && !shippingAddress) setShippingAddress(customer.address);
            if (customer.city && !city) setCity(customer.city);
            if (customer.state && !stateVal) setStateVal(customer.state);
            if (customer.pincode && !pincode) setPincode(customer.pincode);
        }
    }, [customer]);

    // Coupons
    const [couponInput, setCouponInput] = useState("");
    const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number } | null>(null);

    // Shiprocket courier estimation
    const [shiprocketInfo, setShiprocketInfo] = useState<CourierServiceability | null>(null);
    const [isCheckingCourier, setIsCheckingCourier] = useState(false);

    // Payment Selection
    const [paymentMethod, setPaymentMethod] = useState<"razorpay_online" | "whatsapp_concierge" | "cod">("razorpay_online");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [completedOrder, setCompletedOrder] = useState<{ txnId: string; courier: string } | null>(null);

    // Dynamic CMS Branding & Config
    const [cmsConfig, setCmsConfig] = useState<{
        brandName: string;
        whatsappPhone: string;
        razorpayKey?: string;
        themeColor?: string;
    }>({
        brandName: "Fashion Atelier",
        whatsappPhone: process.env.NEXT_PUBLIC_WHATSAPP_PHONE || "919876543210",
    });

    useEffect(() => {
        fetch(getStorefrontApiUrl("/api/storefront/content"))
            .then((r) => r.json())
            .then((data) => {
                if (data) {
                    setCmsConfig({
                        brandName: data.branding?.wordmark?.text || data.hero?.brandName || "Fashion Atelier",
                        whatsappPhone: data.socialAndContact?.whatsappPhone?.replace(/\D/g, "") || process.env.NEXT_PUBLIC_WHATSAPP_PHONE || "919876543210",
                        razorpayKey: data.paymentGateway?.razorpayKeyId,
                        themeColor: data.theme?.colors?.primary || "#000000",
                    });
                }
            })
            .catch(() => {});
    }, []);

    // Auto-check Shiprocket when 6 digits are typed
    useEffect(() => {
        const cleanPin = pincode.trim().replace(/\D/g, "");
        if (cleanPin.length === 6) {
            setIsCheckingCourier(true);
            checkShiprocketPincode(cleanPin).then((res) => {
                setShiprocketInfo(res);
                if (res.city && res.city !== "Unknown") setCity(res.city);
                if (res.state && res.state !== "India") setStateVal(res.state);
                setIsCheckingCourier(false);
            });
        } else {
            setShiprocketInfo(null);
        }
    }, [pincode]);

    const handleApplyCoupon = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const code = couponInput.trim().toUpperCase();
        if (code === "FESTIVE10") {
            if (cartSubtotal < 1499) {
                toast.error("Code FESTIVE10 requires a minimum cart value of ₹1,499.");
                return;
            }
            const disc = Math.round(cartSubtotal * 0.1);
            setAppliedCoupon({ code: "FESTIVE10", discount: disc });
            toast.success(`Coupon FESTIVE10 applied! You saved ₹${disc}`);
        } else if (code === "MYCART49") {
            if (cartSubtotal < 799) {
                toast.error("Code MYCART49 requires a minimum cart value of ₹799.");
                return;
            }
            setAppliedCoupon({ code: "MYCART49", discount: 49 });
            toast.success("Coupon MYCART49 applied! ₹49 discount added.");
        } else {
            toast.error("Invalid coupon code. Try FESTIVE10 or MYCART49.");
        }
    };

    const handleRemoveCoupon = () => {
        setAppliedCoupon(null);
        setCouponInput("");
        toast.info("Coupon removed.");
    };

    const shippingFee = cartSubtotal >= 799 ? 0 : 99;
    const codFee = paymentMethod === "cod" ? 99 : 0;
    const discountAmount = appliedCoupon ? appliedCoupon.discount : 0;
    const finalTotal = Math.max(0, cartSubtotal - discountAmount + shippingFee + codFee);

    const handleSubmitOrder = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!customerName.trim() || !customerPhone.trim() || !shippingAddress.trim() || !pincode.trim()) {
            toast.error("Please fill in all required delivery details.");
            return;
        }

        const assignedCourier = shiprocketInfo
            ? `${shiprocketInfo.primaryCourier} (Shiprocket Express)`
            : "Shiprocket Express Multi-Courier";

        // Case 1: Razorpay Online Payment
        if (paymentMethod === "razorpay_online") {
            setIsSubmitting(true);
            try {
                await openRazorpayCheckout({
                    amount: finalTotal,
                    customerName,
                    customerPhone,
                    customerEmail,
                    brandName: cmsConfig.brandName,
                    razorpayKey: cmsConfig.razorpayKey,
                    themeColor: cmsConfig.themeColor,
                    description: `${cmsConfig.brandName} Order (${cartCount} items)`,
                    onSuccess: async (paymentId: string) => {
                        const result = await submitStorefrontOrder({
                            customerName,
                            customerPhone,
                            shippingAddress,
                            city: `${city}, ${stateVal}`,
                            pincode,
                            items: cart.map((c) => ({
                                productId: c.product.id,
                                sku: c.product.sku,
                                name: c.product.name,
                                price: c.product.website_price,
                                quantity: c.quantity,
                            })),
                            total: finalTotal,
                            discountAmount,
                            couponCode: appliedCoupon?.code,
                            paymentMethod: "razorpay_online",
                            razorpayPaymentId: paymentId,
                            assignedCourier,
                        });

                        setCompletedOrder({ txnId: result.txnId, courier: assignedCourier });
                        clearCart();
                        toast.success(`Payment verified! Order Reference: ${result.txnId}`);
                        setIsSubmitting(false);
                    },
                    onFailure: (err: any) => {
                        setIsSubmitting(false);
                        toast.error(err.message || "Razorpay transaction was cancelled or failed.");
                    },
                });
            } catch (err: any) {
                setIsSubmitting(false);
                toast.error(err.message || "Failed to initialize Razorpay.");
            }
            return;
        }

        // Case 2: WhatsApp Concierge or COD
        setIsSubmitting(true);
        try {
            const result = await submitStorefrontOrder({
                customerName,
                customerPhone,
                shippingAddress,
                city: `${city}, ${stateVal}`,
                pincode,
                items: cart.map((c) => ({
                    productId: c.product.id,
                    sku: c.product.sku,
                    name: c.product.name,
                    price: c.product.website_price,
                    quantity: c.quantity,
                })),
                total: finalTotal,
                discountAmount,
                couponCode: appliedCoupon?.code,
                paymentMethod,
                assignedCourier,
            });

            if (result.success) {
                setCompletedOrder({ txnId: result.txnId, courier: assignedCourier });

                if (paymentMethod === "whatsapp_concierge") {
                    const text = formatWhatsAppCartMessage(
                        cart,
                        { name: customerName, phone: customerPhone, address: shippingAddress, city: `${city}, ${stateVal}`, pincode },
                        finalTotal,
                        appliedCoupon?.code,
                        cmsConfig.brandName
                    );
                    window.open(`https://wa.me/${cmsConfig.whatsappPhone}?text=${text}`, "_blank");
                }

                clearCart();
                toast.success(`Order placed successfully! Reference: ${result.txnId}`);
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to place order.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // If order was placed successfully
    if (completedOrder) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-md border border-emerald-300">
                    <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                    <span className="text-xs uppercase tracking-widest text-[#524a2c] font-bold">
                        Order Confirmed
                    </span>
                    <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#1f2649]">
                        Thank You, {customerName}!
                    </h1>
                    <p className="text-sm text-slate-600 max-w-md mx-auto">
                        Your order with {cmsConfig.brandName} has been received and allocated for express courier dispatch.
                    </p>
                </div>

                <div className="bg-white border border-[#eae5de] rounded-2xl p-6 text-left max-w-md mx-auto space-y-3 font-mono text-xs shadow-md">
                    <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Order Reference:</span>
                        <span className="text-[#1f2649] font-bold">{completedOrder.txnId}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Courier Partner:</span>
                        <span className="text-emerald-700 font-semibold">{completedOrder.courier}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Payment Status:</span>
                        <span className="text-[#1f2649] font-bold">
                            {paymentMethod === "razorpay_online"
                                ? "Paid via Razorpay UPI/Card"
                                : paymentMethod === "whatsapp_concierge"
                                ? "WhatsApp Direct Confirmation"
                                : "Cash on Delivery"}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-500">Total Amount:</span>
                        <span className="text-[#1f2649] font-bold text-sm">₹{finalTotal.toLocaleString("en-IN")}</span>
                    </div>
                </div>

                <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        href="/"
                        className="px-6 py-2.5 rounded-xl bg-[#1f2649] text-white font-bold text-xs hover:bg-[#524a2c] transition shadow-md"
                    >
                        Continue Shopping
                    </Link>
                    <a
                        href={`https://wa.me/${cmsConfig.whatsappPhone}?text=${encodeURIComponent(
                            `Hi ${cmsConfig.brandName} Team, regarding my order ${completedOrder.txnId}, please share tracking updates! 💖`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-6 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-xs"
                    >
                        <MessageCircle className="w-4 h-4 text-emerald-600" />
                        <span>Chat on WhatsApp</span>
                    </a>
                </div>
            </div>
        );
    }

    // Empty Cart
    if (cart.length === 0) {
        return (
            <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
                <ShoppingBag className="w-12 h-12 text-slate-400 mx-auto" />
                <h2 className="text-lg font-bold text-[#1f2649]">Your Shopping Bag is Empty</h2>
                <p className="text-xs text-slate-500">
                    Add designer necklaces, kadas, or jhumkas before heading to checkout.
                </p>
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1f2649] text-white text-xs font-semibold transition"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Return to Store</span>
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
            {/* Back button */}
            <div className="mb-6">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-[#1f2649] transition font-medium"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Collection</span>
                </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left Column: Form & Payment Selection */}
                <form onSubmit={handleSubmitOrder} className="lg:col-span-7 space-y-6">
                    {/* Customer & Shipping Section */}
                    <div className="bg-white border border-[#eae5de] rounded-2xl p-6 space-y-4 shadow-sm">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                            <Truck className="w-4 h-4 text-[#524a2c]" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-[#1f2649]">
                                1. Delivery & Contact Details
                            </h2>
                        </div>

                        {/* WhatsApp Account / Fast Autofill Banner */}
                        {isAuthenticated && customer ? (
                            <div className="flex items-center justify-between p-3 bg-emerald-50/70 border border-emerald-200/60 rounded-xl text-emerald-950">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span className="text-xs">
                                        Logged in as <strong>{customer.name}</strong> (+91 {customer.phone})
                                    </span>
                                </div>
                                {customer.loyalty_points !== undefined && customer.loyalty_points > 0 && (
                                    <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full">
                                        💎 {customer.loyalty_points} Points
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center justify-between p-3 bg-neutral-50 border border-neutral-200/70 rounded-xl text-neutral-800">
                                <div className="flex items-center gap-2">
                                    <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span className="text-xs text-neutral-600">
                                        Have a WhatsApp account? Autofill your saved delivery address.
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={openAuthModal}
                                    className="text-xs font-semibold text-black underline hover:text-neutral-700 cursor-pointer shrink-0"
                                >
                                    Log In with OTP
                                </button>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                    Full Name *
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Priyadharshini K."
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                    className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-2 text-xs text-[#292a2f] focus:outline-none focus:border-[#524a2c]"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                    WhatsApp / Mobile Number *
                                </label>
                                <input
                                    type="tel"
                                    required
                                    placeholder="e.g. 9876543210"
                                    value={customerPhone}
                                    onChange={(e) => setCustomerPhone(e.target.value)}
                                    className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-2 text-xs text-[#292a2f] focus:outline-none focus:border-[#524a2c] font-mono"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                Email Address (Optional for E-Invoice & Shiprocket SMS)
                            </label>
                            <input
                                type="email"
                                placeholder="e.g. priya@gmail.com"
                                value={customerEmail}
                                onChange={(e) => setCustomerEmail(e.target.value)}
                                className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-2 text-xs text-[#292a2f] focus:outline-none focus:border-[#524a2c]"
                            />
                        </div>

                        <div>
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                Flat / Door No, Street & Landmark *
                            </label>
                            <textarea
                                required
                                rows={2}
                                placeholder="Door No. 4A, Green Meadows Apartments, 2nd Cross Street, Gandhipuram"
                                value={shippingAddress}
                                onChange={(e) => setShippingAddress(e.target.value)}
                                className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-2 text-xs text-[#292a2f] focus:outline-none focus:border-[#524a2c] resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                    Pincode *
                                </label>
                                <input
                                    type="text"
                                    maxLength={6}
                                    required
                                    placeholder="600001"
                                    value={pincode}
                                    onChange={(e) => setPincode(e.target.value)}
                                    className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-2 text-xs text-[#292a2f] focus:outline-none focus:border-[#524a2c] font-mono"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                    City *
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Chennai"
                                    value={city}
                                    onChange={(e) => setCity(e.target.value)}
                                    className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-2 text-xs text-[#292a2f] focus:outline-none focus:border-[#524a2c]"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                    State *
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={stateVal}
                                    onChange={(e) => setStateVal(e.target.value)}
                                    className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-2 text-xs text-[#292a2f] focus:outline-none focus:border-[#524a2c]"
                                />
                            </div>
                        </div>

                        {/* Shiprocket Live Detection Indicator */}
                        {shiprocketInfo && (
                            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Truck className="w-4 h-4 text-emerald-600" />
                                    <span>
                                        Express Delivery to <strong>{shiprocketInfo.pincode}</strong>: Approx{" "}
                                        <strong>{shiprocketInfo.estimatedDeliveryDate}</strong>
                                    </span>
                                </div>
                                <span className="font-bold text-[11px] bg-emerald-200 px-2 py-0.5 rounded-full text-emerald-900">
                                    {shiprocketInfo.primaryCourier}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Payment Options Section */}
                    <div className="bg-white border border-[#eae5de] rounded-2xl p-6 space-y-4 shadow-sm">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                            <CreditCard className="w-4 h-4 text-[#524a2c]" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-[#1f2649]">
                                2. Select Payment Method
                            </h2>
                        </div>

                        <div className="space-y-3">
                            {/* Option 1: Razorpay Instant UPI & Cards */}
                            <label
                                className={`flex items-start gap-3.5 p-3.5 rounded-xl border cursor-pointer transition ${
                                    paymentMethod === "razorpay_online"
                                        ? "bg-blue-50/50 border-[#1f2649] text-[#1f2649]"
                                        : "bg-white border-[#eae5de] text-slate-700 hover:border-slate-300"
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="paymentMethod"
                                    value="razorpay_online"
                                    checked={paymentMethod === "razorpay_online"}
                                    onChange={() => setPaymentMethod("razorpay_online")}
                                    className="mt-1 text-[#1f2649] focus:ring-0"
                                />
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold">Razorpay Online Payment (UPI, GPay, PhonePe, Cards)</span>
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                            Instant Dispatch
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500">
                                        Secure 256-bit encrypted checkout via Razorpay. All Indian UPI apps, RuPay, Visa, Mastercard supported.
                                    </p>
                                </div>
                            </label>

                            {/* Option 2: WhatsApp Concierge */}
                            <label
                                className={`flex items-start gap-3.5 p-3.5 rounded-xl border cursor-pointer transition ${
                                    paymentMethod === "whatsapp_concierge"
                                        ? "bg-emerald-50/50 border-emerald-600 text-emerald-950"
                                        : "bg-white border-[#eae5de] text-slate-700 hover:border-slate-300"
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="paymentMethod"
                                    value="whatsapp_concierge"
                                    checked={paymentMethod === "whatsapp_concierge"}
                                    onChange={() => setPaymentMethod("whatsapp_concierge")}
                                    className="mt-1 text-emerald-600 focus:ring-0"
                                />
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold">Order on WhatsApp (Pay via QR / Stylist Confirmation)</span>
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                            Assisted Shopping
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500">
                                        Connect directly with our jewelry stylist on WhatsApp to request product videos and pay via verified business UPI.
                                    </p>
                                </div>
                            </label>

                            {/* Option 3: COD */}
                            <label
                                className={`flex items-start gap-3.5 p-3.5 rounded-xl border cursor-pointer transition ${
                                    paymentMethod === "cod"
                                        ? "bg-amber-50/50 border-[#524a2c] text-[#524a2c]"
                                        : "bg-white border-[#eae5de] text-slate-700 hover:border-slate-300"
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="paymentMethod"
                                    value="cod"
                                    checked={paymentMethod === "cod"}
                                    onChange={() => setPaymentMethod("cod")}
                                    className="mt-1 text-[#524a2c] focus:ring-0"
                                />
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold">Cash On Delivery (COD)</span>
                                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px]">
                                            +₹99 Verification
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500">
                                        Pay in cash at your doorstep when the Shiprocket delivery agent arrives.
                                    </p>
                                </div>
                            </label>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3.5 px-6 rounded-xl bg-[#1f2649] hover:bg-[#524a2c] text-white font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg cursor-pointer disabled:opacity-50"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Processing Your Order...</span>
                            </>
                        ) : paymentMethod === "razorpay_online" ? (
                            <>
                                <Lock className="w-4 h-4 text-amber-300" />
                                <span>Pay with Razorpay • ₹{finalTotal.toLocaleString("en-IN")}</span>
                            </>
                        ) : paymentMethod === "whatsapp_concierge" ? (
                            <>
                                <MessageCircle className="w-4 h-4 text-emerald-400" />
                                <span>Confirm on WhatsApp • ₹{finalTotal.toLocaleString("en-IN")}</span>
                            </>
                        ) : (
                            <>
                                <Truck className="w-4 h-4" />
                                <span>Place COD Order • ₹{finalTotal.toLocaleString("en-IN")}</span>
                            </>
                        )}
                    </button>
                </form>

                {/* Right Column: Order Summary & Coupons */}
                <div className="lg:col-span-5 bg-white border border-[#eae5de] rounded-2xl p-6 space-y-4 shadow-sm sticky top-24">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                            <ShoppingBag className="w-4 h-4 text-[#524a2c]" />
                            <h3 className="text-sm font-bold uppercase tracking-wider text-[#1f2649]">
                                Order Summary ({cartCount})
                            </h3>
                        </div>
                        <span className="text-[11px] text-emerald-700 font-semibold">Live Stock Sync</span>
                    </div>

                    {/* Items List */}
                    <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                        {cart.map((item) => (
                            <div key={item.product.id} className="flex gap-3 text-xs border-b border-slate-50 pb-2.5">
                                <div className="w-12 h-12 rounded-lg bg-[#efeae4] border border-[#d1c7bc] flex items-center justify-center shrink-0 overflow-hidden text-lg">
                                    {item.product.image_url ? (
                                        <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover" />
                                    ) : (
                                        "✨"
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-[#1f2649] truncate">{item.product.name}</div>
                                    <div className="text-[10px] text-slate-500 font-mono">
                                        Qty: {item.quantity} × ₹{item.product.website_price.toLocaleString("en-IN")}
                                    </div>
                                    <div className="text-[10px] text-[#524a2c] font-semibold">
                                        {item.product.plating_type}
                                    </div>
                                </div>
                                <div className="font-mono font-bold text-[#1f2649]">
                                    ₹{(item.product.website_price * item.quantity).toLocaleString("en-IN")}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Coupon Input Box */}
                    <div className="pt-2 border-t border-slate-100">
                        {appliedCoupon ? (
                            <div className="flex items-center justify-between p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs">
                                <div className="flex items-center gap-1.5 text-emerald-900 font-bold">
                                    <Tag className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>Code {appliedCoupon.code} Applied (-₹{appliedCoupon.discount})</span>
                                </div>
                                <button
                                    onClick={handleRemoveCoupon}
                                    className="text-red-500 hover:text-red-700 p-1"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Enter Coupon (e.g. FESTIVE10)"
                                    value={couponInput}
                                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                                    className="w-full bg-[#fbf9f6] border border-[#d1c7bc] rounded-xl px-3 py-1.5 text-xs text-[#292a2f] uppercase font-mono focus:outline-none focus:border-[#524a2c]"
                                />
                                <button
                                    onClick={() => handleApplyCoupon()}
                                    className="px-3.5 py-1.5 rounded-xl bg-[#524a2c] text-white text-xs font-bold hover:opacity-90 transition shrink-0"
                                >
                                    Apply
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Breakdown Calculation */}
                    <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
                        <div className="flex justify-between text-slate-600">
                            <span>Subtotal</span>
                            <span className="font-mono text-[#292a2f]">₹{cartSubtotal.toLocaleString("en-IN")}</span>
                        </div>

                        {appliedCoupon && (
                            <div className="flex justify-between text-emerald-700 font-semibold">
                                <span>Coupon Discount</span>
                                <span className="font-mono">-₹{appliedCoupon.discount}</span>
                            </div>
                        )}

                        <div className="flex justify-between text-slate-600">
                            <span>Shiprocket Express Delivery</span>
                            {shippingFee === 0 ? (
                                <span className="text-emerald-700 font-semibold">FREE (Order &gt; ₹799)</span>
                            ) : (
                                <span className="font-mono text-[#292a2f]">₹{shippingFee}</span>
                            )}
                        </div>

                        {codFee > 0 && (
                            <div className="flex justify-between text-slate-600">
                                <span>COD Verification Fee</span>
                                <span className="font-mono text-[#292a2f]">₹{codFee}</span>
                            </div>
                        )}

                        <div className="flex justify-between text-sm font-bold text-[#1f2649] pt-2 border-t border-slate-200">
                            <span>Total Payable</span>
                            <span className="font-mono text-lg text-[#1f2649]">
                                ₹{finalTotal.toLocaleString("en-IN")}
                            </span>
                        </div>
                    </div>

                    {/* Imitation Jewellery Guarantees */}
                    <div className="p-3.5 bg-[#fbf9f6] border border-[#eae5de] rounded-xl space-y-2 text-[11px] text-slate-600">
                        <div className="flex items-center gap-2 text-slate-700">
                            <Shield className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>100% Skin-Friendly Lead & Nickel Free Alloy</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-700">
                            <Award className="w-4 h-4 text-[#524a2c] shrink-0" />
                            <span>Premium 22K Micro Gold Plating with Anti-Tarnish Coat</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-700">
                            <Truck className="w-4 h-4 text-blue-600 shrink-0" />
                            <span>Multi-Courier Tracked Dispatch via Shiprocket</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
