"use client";

import React, { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

export interface FaqItem {
    question: string;
    answer: string;
}

interface FaqAccordionProps {
    items?: FaqItem[];
}

export default function FaqAccordion({ items = [] }: FaqAccordionProps) {
    const [openIdx, setOpenIdx] = useState<number | null>(0);

    if (!items || items.length === 0) return null;

    return (
        <section id="faq" className="w-full py-16 sm:py-20 bg-neutral-50/50 border-b border-neutral-200 scroll-mt-24">
            <div className="max-w-[1000px] mx-auto px-6 sm:px-12 space-y-10">
                <div className="text-center space-y-2">
                    <span className="text-[10px] uppercase font-mono tracking-widest text-neutral-500 inline-flex items-center gap-1.5">
                        <HelpCircle className="w-3.5 h-3.5" />
                        Customer Care & Logistics
                    </span>
                    <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-black lowercase">
                        frequently asked questions.
                    </h3>
                    <p className="text-xs text-neutral-600 max-w-md mx-auto">
                        Clear answers on express shipping, 22K plating durability, and jewellery maintenance.
                    </p>
                </div>

                <div className="space-y-3">
                    {items.map((item, idx) => {
                        const isOpen = openIdx === idx;
                        return (
                            <div
                                key={idx}
                                className="border border-neutral-200 rounded-lg bg-white overflow-hidden transition-all"
                            >
                                <button
                                    onClick={() => setOpenIdx(isOpen ? null : idx)}
                                    className="w-full p-5 text-left flex items-center justify-between gap-4 font-semibold text-xs sm:text-sm text-neutral-900 cursor-pointer hover:bg-neutral-50/80 transition-colors duration-120"
                                >
                                    <span>{item.question}</span>
                                    <ChevronDown
                                        className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ease-emil-out shrink-0 ${
                                            isOpen ? "rotate-180 text-black" : ""
                                        }`}
                                    />
                                </button>
                                <div
                                    className={`grid transition-[grid-template-rows,opacity] duration-200 ease-emil-out ${
                                        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                                    }`}
                                >
                                    <div className="overflow-hidden">
                                        <div className="px-5 pb-5 pt-1 text-xs leading-relaxed text-neutral-600 border-t border-neutral-100">
                                            {item.answer}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
