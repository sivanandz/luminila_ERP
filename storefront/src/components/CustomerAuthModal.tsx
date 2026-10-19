"use client";

import React, { useState, useEffect, useRef } from "react";
import { useCustomerAuth } from "@/context/CustomerAuthContext";
import { getStorefrontApiUrl } from "@/lib/api";
import { MessageCircle, X, ArrowRight, Loader2, ShieldCheck, Sparkles, Phone, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function CustomerAuthModal() {
    const { isAuthModalOpen, closeAuthModal, login, customer } = useCustomerAuth();

    const [step, setStep] = useState<"phone" | "otp">("phone");
    const [phone, setPhone] = useState("");
    const [name, setName] = useState("");
    const [otp, setOtp] = useState(["", "", "", "", "", ""]);
    const [isLoading, setIsLoading] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [devOtp, setDevOtp] = useState<string | null>(null);

    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        if (!isAuthModalOpen) {
            // Reset modal on close
            setStep("phone");
            setOtp(["", "", "", "", "", ""]);
            setDevOtp(null);
            setIsLoading(false);
        }
    }, [isAuthModalOpen]);

    // Handle cooldown timer countdown
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setTimeout(() => {
            setCooldown((prev) => prev - 1);
        }, 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isAuthModalOpen) {
                closeAuthModal();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isAuthModalOpen, closeAuthModal]);

    if (!isAuthModalOpen) return null;

    const handleSendOtp = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const cleanDigits = phone.replace(/\D/g, "");
        if (cleanDigits.length < 10) {
            toast.error("Please enter a valid 10-digit mobile number.");
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch(getStorefrontApiUrl("/api/storefront/auth/send-otp"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: cleanDigits }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                toast.error(data.error || "Failed to send WhatsApp verification code.");
                if (data.cooldownRemaining) setCooldown(data.cooldownRemaining);
                return;
            }

            toast.success(data.message || "OTP sent to your WhatsApp!");
            if (data.devOtp) {
                setDevOtp(data.devOtp);
            }
            setCooldown(45);
            setStep("otp");
            // Focus first OTP field on next tick
            setTimeout(() => {
                inputRefs.current[0]?.focus();
            }, 100);
        } catch (err: any) {
            toast.error("Network error. Please ensure ERP backend is reachable.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleOtpChange = (index: number, val: string) => {
        const digits = val.replace(/\D/g, "");
        const newOtp = [...otp];

        if (digits.length > 1) {
            // Pasting full 6-digit code
            const pasted = digits.slice(0, 6).split("");
            pasted.forEach((ch, i) => {
                newOtp[i] = ch;
            });
            setOtp(newOtp);
            const nextIdx = Math.min(pasted.length, 5);
            inputRefs.current[nextIdx]?.focus();

            if (pasted.length === 6) {
                triggerVerify(pasted.join(""));
            }
            return;
        }

        newOtp[index] = digits;
        setOtp(newOtp);

        if (digits && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }

        const completed = newOtp.join("");
        if (completed.length === 6) {
            triggerVerify(completed);
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const triggerVerify = async (codeToVerify?: string) => {
        const finalOtp = codeToVerify || otp.join("");
        if (finalOtp.length < 6) {
            toast.error("Please enter the complete 6-digit code.");
            return;
        }

        setIsLoading(true);
        try {
            const cleanDigits = phone.replace(/\D/g, "");
            const res = await fetch(getStorefrontApiUrl("/api/storefront/auth/verify-otp"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone: cleanDigits,
                    otp: finalOtp,
                    name: name.trim() || undefined,
                }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                toast.error(data.error || "Incorrect code. Please try again.");
                return;
            }

            toast.success(`Welcome back, ${data.customer.name}!`);
            login(data.customer, data.token);
        } catch (err: any) {
            toast.error("Verification failed. Please check connection.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity duration-200">
            {/* Modal Backdrop click */}
            <div className="absolute inset-0" onClick={closeAuthModal} />

            {/* Modal Card */}
            <div className="relative z-10 w-full max-w-[420px] bg-white rounded-xl shadow-2xl border border-neutral-100 overflow-hidden text-neutral-900 transition-all duration-300">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-neutral-100">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <MessageCircle className="w-4 h-4 fill-emerald-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base tracking-tight text-neutral-900">
                                {step === "phone" ? "WhatsApp Sign In" : "Verify WhatsApp Code"}
                            </h3>
                            <p className="text-[11px] text-neutral-500">
                                {step === "phone" ? "Fast, passwordless account access" : `Sent to +91 ${phone}`}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={closeAuthModal}
                        className="p-1.5 text-neutral-400 hover:text-black rounded-lg transition-colors cursor-pointer"
                        aria-label="Close dialog"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {step === "phone" ? (
                        <form onSubmit={handleSendOtp} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1.5">
                                    Mobile Number
                                </label>
                                <div className="flex items-center rounded-lg border border-neutral-200 focus-within:border-black focus-within:ring-1 focus-within:ring-black overflow-hidden transition-all">
                                    <div className="px-3 py-2.5 bg-neutral-50 text-neutral-600 text-xs font-medium border-r border-neutral-200 select-none">
                                        🇮🇳 +91
                                    </div>
                                    <input
                                        type="tel"
                                        placeholder="98765 43210"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        maxLength={10}
                                        autoFocus
                                        className="w-full px-3 py-2.5 text-sm bg-white text-neutral-900 focus:outline-hidden"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1.5">
                                    Your Name <span className="text-neutral-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Priya Sharma"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-neutral-200 focus:border-black focus:ring-1 focus:ring-black focus:outline-hidden transition-all"
                                />
                            </div>

                            {/* Loyalty perk banner */}
                            <div className="flex items-start gap-2.5 p-3 bg-amber-50/70 border border-amber-200/60 rounded-lg text-amber-900">
                                <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <div className="text-[11.5px] leading-relaxed">
                                    <span className="font-semibold">50 Bonus Points:</span> Sign in to unlock loyalty rewards, 1-click address autofill, and live order tracking.
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading || phone.replace(/\D/g, "").length < 10}
                                className="w-full py-3 bg-neutral-900 hover:bg-black text-white text-xs font-semibold tracking-wider uppercase rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Sending OTP...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Get WhatsApp Code</span>
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-5">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
                                        Enter 6-Digit Code
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setStep("phone")}
                                        className="text-[11px] text-neutral-500 hover:text-black underline cursor-pointer"
                                    >
                                        Change number
                                    </button>
                                </div>

                                <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                                    {otp.map((digit, idx) => (
                                        <input
                                            key={idx}
                                            ref={(el) => {
                                                inputRefs.current[idx] = el;
                                            }}
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={1}
                                            value={digit}
                                            onChange={(e) => handleOtpChange(idx, e.target.value)}
                                            onKeyDown={(e) => handleKeyDown(idx, e)}
                                            className="w-11 h-12 sm:w-12 sm:h-13 text-center text-lg font-bold border border-neutral-200 rounded-lg focus:border-black focus:ring-1 focus:ring-black focus:outline-hidden bg-neutral-50/50 transition-all"
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Dev Quick-Fill Helper if WPP is in sandbox / dev */}
                            {devOtp && (
                                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-900">
                                    <span>Dev OTP: <strong>{devOtp}</strong></span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const parts = devOtp.split("");
                                            setOtp(parts);
                                            triggerVerify(devOtp);
                                        }}
                                        className="text-[11px] font-semibold underline text-emerald-800 hover:text-emerald-950 cursor-pointer"
                                    >
                                        Auto Fill
                                    </button>
                                </div>
                            )}

                            <div className="flex items-center justify-between text-xs text-neutral-500">
                                {cooldown > 0 ? (
                                    <span>Resend code in {cooldown}s</span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleSendOtp()}
                                        className="font-medium text-black underline cursor-pointer hover:text-neutral-700"
                                    >
                                        Resend code via WhatsApp
                                    </button>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => triggerVerify()}
                                disabled={isLoading || otp.join("").length < 6}
                                className="w-full py-3 bg-neutral-900 hover:bg-black text-white text-xs font-semibold tracking-wider uppercase rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Verifying...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Verify & Sign In</span>
                                        <CheckCircle2 className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer Security Badges */}
                <div className="px-6 py-3 bg-neutral-50 border-t border-neutral-100 flex items-center justify-center gap-4 text-[10.5px] text-neutral-400">
                    <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> End-to-end encrypted
                    </span>
                    <span>•</span>
                    <span>Zero spam guarantee</span>
                </div>
            </div>
        </div>
    );
}
