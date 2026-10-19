"use client";

import React, { useState } from "react";
import { Star, ChevronLeft, ChevronRight, CheckCircle2, Quote } from "lucide-react";

export interface ReviewItem {
    id: string;
    customerName: string;
    city: string;
    rating: number;
    reviewText: string;
    itemPurchased: string;
    verifiedBuyer: boolean;
}

interface ReviewsProps {
    heading?: string;
    subheading?: string;
    items?: ReviewItem[];
}

export default function ReviewsCarousel({
    heading = "loved by our craftisan family.",
    subheading = "REAL EXPERIENCES FROM VERIFIED BRIDAL & FESTIVE PATRONS ACROSS INDIA",
    items = [],
}: ReviewsProps) {
    const [activeIndex, setActiveIndex] = useState(0);

    if (!items || items.length === 0) return null;

    const nextReview = () => {
        setActiveIndex((prev) => (prev + 1) % items.length);
    };

    const prevReview = () => {
        setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
    };

    return (
        <section id="reviews" className="w-full py-16 sm:py-20 bg-neutral-900 text-white scroll-mt-24">
            <div className="max-w-[1440px] mx-auto px-6 sm:px-12">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-neutral-800 pb-8 mb-12">
                    <div className="space-y-2 max-w-xl">
                        <span className="text-[10px] uppercase font-mono tracking-widest text-neutral-400">
                            Verified Patron Testimonials
                        </span>
                        <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight lowercase">
                            {heading}
                        </h3>
                        <p className="text-xs uppercase tracking-wider text-neutral-400 font-medium">
                            {subheading}
                        </p>
                    </div>

                    {/* Navigation Buttons */}
                    {items.length > 1 && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={prevReview}
                                aria-label="Previous review"
                                className="p-2.5 rounded-full border border-neutral-700 hover:border-white hover:bg-white hover:text-black transition-[border-color,background-color,color,transform] duration-140 ease-emil-out active:scale-92 cursor-pointer"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="font-mono text-xs text-neutral-400 px-2 select-none">
                                0{activeIndex + 1} / 0{items.length}
                            </span>
                            <button
                                onClick={nextReview}
                                aria-label="Next review"
                                className="p-2.5 rounded-full border border-neutral-700 hover:border-white hover:bg-white hover:text-black transition-[border-color,background-color,color,transform] duration-140 ease-emil-out active:scale-92 cursor-pointer"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>

                {/* Reviews Grid (Desktop 3 cards, Mobile active slide) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {items.map((review, idx) => {
                        const isMobileActive = idx === activeIndex;
                        return (
                            <div
                                key={review.id || idx}
                                className={`p-6 sm:p-8 rounded-lg border border-neutral-800/80 bg-neutral-950 flex flex-col justify-between space-y-6 transition-[border-color,transform] duration-200 ease-emil-out hover:border-neutral-700 hover:-translate-y-1 ${
                                    isMobileActive ? "block" : "hidden md:flex"
                                }`}
                            >
                                <div className="space-y-4">
                                    {/* Stars & Badge */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex gap-1 text-amber-400">
                                            {Array.from({ length: review.rating || 5 }).map((_, i) => (
                                                <Star key={i} className="w-3.5 h-3.5 fill-current" />
                                            ))}
                                        </div>
                                        {review.verifiedBuyer && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-mono tracking-wider text-emerald-400">
                                                <CheckCircle2 className="w-3 h-3" />
                                                VERIFIED PATRON
                                            </span>
                                        )}
                                    </div>

                                    {/* Review Text */}
                                    <p className="text-xs sm:text-sm leading-relaxed text-neutral-300 font-light italic">
                                        "{review.reviewText}"
                                    </p>
                                </div>

                                {/* Author & Item Info */}
                                <div className="pt-4 border-t border-neutral-800 space-y-1">
                                    <p className="text-xs font-semibold tracking-tight text-white">
                                        {review.customerName},{" "}
                                        <span className="font-normal text-neutral-400">{review.city}</span>
                                    </p>
                                    <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                                        Purchased: <span className="text-white">{review.itemPurchased}</span>
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
