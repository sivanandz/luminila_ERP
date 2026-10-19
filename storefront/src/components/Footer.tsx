"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { MessageCircle, Instagram } from "lucide-react";
import { getStorefrontApiUrl } from "@/lib/api";

export function Footer() {
    const [instagram, setInstagram] = useState("niththigal_craftisans");
    const [whatsappNumber, setWhatsappNumber] = useState("+917092122334");
    const [brandName, setBrandName] = useState("niththigal.");
    const [branding, setBranding] = useState<{
        logoType: "wordmark" | "image";
        wordmark?: {
            text: string;
            fontFamily?: string;
            fontSize?: number;
            letterSpacing?: string;
            textTransform?: "lowercase" | "uppercase" | "capitalize" | "none";
        };
        imageLogo?: {
            url: string;
            alt?: string;
            desktopHeight?: number;
        };
    }>({
        logoType: "wordmark",
        wordmark: {
            text: "niththigal.",
            fontFamily: "Plus Jakarta Sans",
            fontSize: 28,
            letterSpacing: "-0.04em",
            textTransform: "lowercase",
        },
    });

    const [trackingHref, setTrackingHref] = useState("/tracking");

    useEffect(() => {
        setTrackingHref(getStorefrontApiUrl("/tracking"));
        const apiUrl = getStorefrontApiUrl("/api/storefront/content");
        fetch(apiUrl)
            .then((r) => r.json())
            .then((data) => {
                if (data?.socialAndContact?.instagram) {
                    setInstagram(data.socialAndContact.instagram);
                }
                if (data?.socialAndContact?.whatsappPhone) {
                    setWhatsappNumber(data.socialAndContact.whatsappPhone);
                }
                if (data?.hero?.brandName) {
                    setBrandName(data.hero.brandName);
                }
                if (data?.branding) {
                    setBranding(data.branding);
                }
            })
            .catch(() => {});
    }, []);

    const whatsappLink = `https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
        "Hi Niththigal Craftisans, I'm reaching out from your website! I'd like to inquire about your jewellery collection ✨"
    )}`;

    const instagramLink = `https://www.instagram.com/${instagram}/`;

    return (
        <footer className="border-t border-neutral-100 bg-white py-14 px-4 sm:px-8 text-neutral-800">
            <div className="max-w-[1440px] mx-auto flex flex-col items-center text-center space-y-6">
                {/* Social Actions: Follow Instagram & Direct WhatsApp */}
                <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium">
                    <a
                        href={instagramLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 text-neutral-600 hover:text-black hover:border-black transition uppercase tracking-wider"
                    >
                        <Instagram className="w-3.5 h-3.5 text-pink-600" />
                        <span>Follow @{instagram}</span>
                    </a>

                    <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-200 text-emerald-700 hover:text-emerald-900 hover:border-emerald-500 transition uppercase tracking-wider"
                    >
                        <MessageCircle className="w-3.5 h-3.5 fill-emerald-600 text-white" />
                        <span>Chat on WhatsApp</span>
                    </a>
                </div>

                {/* Brand Logo / Wordmark */}
                <Link
                    href="/"
                    className="flex items-center justify-center hover:opacity-85 transition select-none"
                >
                    {branding.logoType === "image" && branding.imageLogo?.url ? (
                        <img
                            src={branding.imageLogo.url}
                            alt={branding.imageLogo.alt || brandName}
                            style={{
                                height: `${branding.imageLogo.desktopHeight || 36}px`,
                            }}
                            className="w-auto object-contain max-h-[50px]"
                        />
                    ) : (
                        <span
                            className="text-3xl font-extrabold tracking-[-0.04em] text-black font-logo"
                            style={{
                                fontFamily: `var(--font-logo, '${branding.wordmark?.fontFamily || "Plus Jakarta Sans"}')`,
                                fontSize: branding.wordmark?.fontSize ? `${branding.wordmark.fontSize}px` : undefined,
                                letterSpacing: branding.wordmark?.letterSpacing || "-0.04em",
                                textTransform: branding.wordmark?.textTransform || "lowercase",
                            }}
                        >
                            {branding.wordmark?.text || brandName}
                        </span>
                    )}
                </Link>

                {/* Policy Links in clean horizontal line */}
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-neutral-500">
                    <Link href="/checkout" className="hover:text-black transition">
                        Shipping policy
                    </Link>
                    <span>·</span>
                    <Link href="/checkout" className="hover:text-black transition">
                        Refund policy
                    </Link>
                    <span>·</span>
                    <Link href="/checkout" className="hover:text-black transition">
                        Privacy policy
                    </Link>
                    <span>·</span>
                    <Link href="/checkout" className="hover:text-black transition">
                        Terms of service
                    </Link>
                    <span>·</span>
                    <a
                        href={trackingHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-black transition"
                        suppressHydrationWarning
                    >
                        Track shipment
                    </a>
                </div>

                {/* Copyright */}
                <div className="pt-4 text-[11px] text-neutral-400 uppercase tracking-widest">
                    © {new Date().getFullYear()} {brandName} all rights reserved.
                </div>
            </div>
        </footer>
    );
}
