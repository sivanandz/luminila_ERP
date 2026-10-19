"use client";

import React, { useState, useEffect } from "react";
import { MessageCircle, ShoppingBag } from "lucide-react";
import { useCart } from "@/context/CartContext";

interface StickyMobileBarProps {
    whatsappPhone?: string;
    whatsappMessage?: string;
    enabled?: boolean;
}

export default function StickyMobileBar({
    whatsappPhone = "+917092122334",
    whatsappMessage = "Hi Niththigal Craftisans! I'm browsing your mobile store and want to inquire about custom orders ✨",
    enabled = true,
}: StickyMobileBarProps) {
    const { cartCount, setIsCartOpen, cartSubtotal } = useCart();
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            // Show after scrolling past initial hero (200px)
            if (window.scrollY > 200) {
                setIsVisible(true);
            } else {
                setIsVisible(false);
            }
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    if (!enabled || !isVisible) return null;

    const cleanPhone = whatsappPhone.replace(/[^0-9]/g, "");
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappMessage)}`;

    return (
        <aside
            aria-label="Mobile quick actions"
            className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-neutral-200 p-3 shadow-lg animate-in slide-in-from-bottom duration-300 ease-emil-drawer"
        >
            <div className="flex items-center gap-2 max-w-md mx-auto">
                {/* WhatsApp Concierge */}
                <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs tracking-wider uppercase shadow-xs active:scale-97 transition-[background-color,transform] duration-140 ease-emil-out"
                >
                    <MessageCircle className="w-4 h-4 fill-white" />
                    <span>WhatsApp Order</span>
                </a>

                {/* View Bag / Checkout */}
                <button
                    onClick={() => setIsCartOpen(true)}
                    className="flex-1 flex items-center justify-between py-2.5 px-4 rounded bg-black hover:bg-neutral-800 text-white font-medium text-xs tracking-wider uppercase shadow-xs active:scale-97 transition-[background-color,transform] duration-140 ease-emil-out cursor-pointer"
                >
                    <div className="flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4" />
                        <span>Bag ({cartCount})</span>
                    </div>
                    {cartSubtotal > 0 && (
                        <span className="font-mono text-[11px] text-neutral-300">
                            ₹{cartSubtotal.toLocaleString("en-IN")}
                        </span>
                    )}
                </button>
            </div>
        </aside>
    );
}
