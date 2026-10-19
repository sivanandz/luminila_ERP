"use client";

import React from "react";
import { Sparkles, Check } from "lucide-react";

export interface BrandStoryProps {
    tagline?: string;
    heading?: string;
    bodyText?: string;
    craftDetails?: string[];
    imageUrl?: string;
}

export default function BrandStory({
    tagline = "THE ATELIER HERITAGE",
    heading = "preserving south indian & jaipur jewellery craftsmanship.",
    bodyText = "Niththigal Craftisans was born out of deep reverence for Indian heirloom jewellery...",
    craftDetails = [
        "22K High-Micron Gold Immersion",
        "Hand-Crimped Foil-Backed Polki",
        "Chettinad Deep Relief Repoussé",
        "100% Skin-Friendly Hypoallergenic Cores",
    ],
    imageUrl = "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=1200&auto=format&fit=crop",
}: BrandStoryProps) {
    return (
        <section id="brand-story" className="w-full py-16 sm:py-24 bg-white border-b border-neutral-200 scroll-mt-24">
            <div className="max-w-[1440px] mx-auto px-6 sm:px-12">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                    {/* Left: Content */}
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <span className="text-[10px] uppercase font-mono tracking-widest text-neutral-500 flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5" />
                                {tagline}
                            </span>
                            <h3 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-black lowercase leading-tight">
                                {heading}
                            </h3>
                        </div>

                        <p className="text-xs sm:text-sm leading-relaxed text-neutral-700 font-normal">
                            {bodyText}
                        </p>

                        {/* Craft Pillars */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-neutral-100">
                            {craftDetails.map((detail, idx) => (
                                <div key={idx} className="flex items-center gap-2.5 text-xs font-semibold text-neutral-900">
                                    <div className="w-4 h-4 rounded-full bg-neutral-900 text-white flex items-center justify-center shrink-0">
                                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                                    </div>
                                    <span>{detail}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: Editorial Image */}
                    <div className="relative aspect-[4/3] rounded-lg overflow-hidden border border-neutral-200 shadow-sm">
                        <div
                            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 hover:scale-105"
                            style={{ backgroundImage: `url(${imageUrl})` }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4 text-white">
                            <p className="text-[10px] uppercase tracking-widest font-mono opacity-80">
                                Atelier Craftsmanship
                            </p>
                            <p className="text-xs font-semibold">
                                Hand-crimped Jadau polki & pure red-copper alloy matrices
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
