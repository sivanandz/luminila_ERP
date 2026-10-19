"use client";

import React from "react";
import { Truck, Shield, Sparkles, RotateCcw, Award } from "lucide-react";

export interface TrustStripItem {
    icon: "truck" | "shield" | "sparkles" | "rotate-ccw";
    title: string;
    subtitle: string;
}

interface TrustStripProps {
    items?: TrustStripItem[];
}

const ICON_MAP = {
    truck: Truck,
    shield: Shield,
    sparkles: Sparkles,
    "rotate-ccw": RotateCcw,
};

export default function TrustStrip({ items }: TrustStripProps) {
    if (!items || items.length === 0) return null;

    return (
        <section className="w-full border-y border-neutral-200 bg-neutral-50/60 py-8">
            <div className="max-w-[1440px] mx-auto px-6 sm:px-12">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
                    {items.map((item, idx) => {
                        const Icon = ICON_MAP[item.icon] || Award;
                        return (
                            <div
                                key={idx}
                                className="flex items-start gap-4 p-2 transition-transform duration-160 ease-emil-out hover:-translate-y-0.5"
                            >
                                <div className="p-2.5 rounded-full bg-black text-white shrink-0 mt-0.5">
                                    <Icon className="w-4 h-4 stroke-[1.75]" />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-xs font-bold tracking-tight text-black uppercase">
                                        {item.title}
                                    </h4>
                                    <p className="text-[11px] leading-relaxed text-neutral-600">
                                        {item.subtitle}
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
