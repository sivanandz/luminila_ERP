"use client";

import React, { useEffect, useState } from "react";
import {
    CreditCard,
    Building2,
    Sparkles,
    RefreshCw,
    Ruler,
    FileText,
    Truck,
    Package,
    Command,
} from "lucide-react";

export interface SlashCommand {
    id: string;
    command: string;
    label: string;
    description: string;
    category: "payment" | "template" | "catalog" | "logistics";
    icon: React.ReactNode;
    snippet: string;
    action?: (params?: string) => void;
}

export interface SlashCommandPaletteProps {
    query: string; // The text typed after /
    isOpen: boolean;
    onClose: () => void;
    onSelectSnippet: (snippet: string) => void;
    onTriggerAction?: (actionId: string, param?: string) => void;
}

export function SlashCommandPalette({
    query,
    isOpen,
    onClose,
    onSelectSnippet,
    onTriggerAction,
}: SlashCommandPaletteProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const commands: SlashCommand[] = [
        {
            id: "pay",
            command: "/pay",
            label: "Create Razorpay Payment Link",
            description: "Generates instant payment link for specified amount",
            category: "payment",
            icon: <CreditCard size={15} className="text-blue-500" />,
            snippet: "",
        },
        {
            id: "bank",
            command: "/bank",
            label: "Showroom Bank & UPI Details",
            description: "Inserts Current Account, IFSC, and UPI VPA",
            category: "template",
            icon: <Building2 size={15} className="text-emerald-500" />,
            snippet: `🏦 *Luminila Jewels — Official Bank Details*

• *Bank:* HDFC Bank
• *Account Name:* Luminila Jewels Private Limited
• *Account No:* 50200088991122
• *IFSC Code:* HDFC0001234
• *UPI ID:* luminila@hdfcbank

_Kindly share a screenshot or UTR number once payment is processed for instant reconciliation._ ✨`,
        },
        {
            id: "care",
            command: "/care",
            label: "Jewelry Care & Anti-Tarnish Guide",
            description: "Tips for preserving gold plating & cubic zirconia",
            category: "template",
            icon: <Sparkles size={15} className="text-amber-500" />,
            snippet: `✨ *Jewelry Care Guidelines — Luminila Jewels*

To maintain the brilliant luster and premium finish of your handcrafted pieces:
1. 🚫 *Avoid Moisture:* Keep away from water, perfumes, lotions, and sanitizers.
2. 📦 *Proper Storage:* Store in individual airtight zip-locks or our velvet jewelry box.
3. 🧼 *Gentle Cleaning:* Wipe gently with a soft micro-fiber cloth after each wear.

_All Luminila pieces include a 6-month anti-tarnish plating warranty!_ 💎`,
        },
        {
            id: "exchange",
            command: "/exchange",
            label: "Return & Lifetime Exchange Terms",
            description: "7-day return window and lifetime exchange terms",
            category: "template",
            icon: <RefreshCw size={15} className="text-indigo-500" />,
            snippet: `🔄 *Luminila Exchange & Return Policy*

• *7-Day Easy Return:* Eligible for unworn items in original packaging with security tag intact.
• *Lifetime Exchange:* Get up to 70% value exchange on precious brass/silver collections at our showroom anytime.
• *Free Sizing:* First ring resizing or minor adjustment is on us!

_We ensure 100% satisfaction with every sparkle._ 💫`,
        },
        {
            id: "sizes",
            command: "/sizes",
            label: "Ring & Bangle Sizing Chart",
            description: "Indian sizing conversions (Circumference / Diameter)",
            category: "template",
            icon: <Ruler size={15} className="text-purple-500" />,
            snippet: `📏 *Indian Ring & Bangle Size Guide*

💍 *Ring Sizes (Indian Standard):*
• Size 10: 16.0 mm diameter
• Size 12: 16.5 mm diameter
• Size 14: 17.2 mm diameter
• Size 16: 17.8 mm diameter
• Size 18: 18.5 mm diameter

✨ *Bangle Sizes:*
• 2-4: 2.25 inch (Small)
• 2-6: 2.375 inch (Medium)
• 2-8: 2.50 inch (Standard)
• 2-10: 2.625 inch (Large)

_Not sure? You can measure inner diameter with a ruler or request an adjustable free-size piece!_`,
        },
        {
            id: "invoice",
            command: "/invoice",
            label: "Dispatch GST Tax Invoice PDF",
            description: "Triggers official GST invoice generation & send",
            category: "payment",
            icon: <FileText size={15} className="text-rose-500" />,
            snippet: "",
        },
        {
            id: "tracking",
            command: "/tracking",
            label: "Dispatch Courier Tracking Link",
            description: "Sends live AWB tracking info to customer",
            category: "logistics",
            icon: <Truck size={15} className="text-teal-500" />,
            snippet: "",
        },
        {
            id: "product",
            command: "/product",
            label: "Browse & Send Product Card",
            description: "Pick from catalog to send rich photo, price & stock",
            category: "catalog",
            icon: <Package size={15} className="text-primary" />,
            snippet: "",
        },
    ];

    // Filter by typed command query
    const cleanQuery = query.toLowerCase().replace(/^\//, "");
    const filtered = commands.filter(
        (c) =>
            c.command.toLowerCase().includes(cleanQuery) ||
            c.label.toLowerCase().includes(cleanQuery) ||
            c.id.toLowerCase().includes(cleanQuery)
    );

    // Keep selected index valid
    useEffect(() => {
        setSelectedIndex(0);
    }, [cleanQuery]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen || filtered.length === 0) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % filtered.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const chosen = filtered[selectedIndex];
                if (chosen) {
                    executeCommand(chosen);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, filtered, selectedIndex]);

    if (!isOpen || filtered.length === 0) return null;

    const executeCommand = (cmd: SlashCommand) => {
        if (cmd.snippet) {
            onSelectSnippet(cmd.snippet);
        } else if (onTriggerAction) {
            onTriggerAction(cmd.id);
        }
        onClose();
    };

    return (
        <div className="absolute bottom-full mb-2 left-0 w-80 max-h-72 rounded-xl bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl p-1.5 z-50 overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between border-b border-border/50 mb-1">
                <span className="flex items-center gap-1.5">
                    <Command size={11} className="text-primary" />
                    Slash Commands
                </span>
                <span className="text-[9px] text-muted-foreground">↑↓ to navigate, ↵ to pick</span>
            </div>

            <div className="space-y-0.5">
                {filtered.map((cmd, idx) => {
                    const isSelected = idx === selectedIndex;
                    return (
                        <div
                            key={cmd.id}
                            onClick={() => executeCommand(cmd)}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "hover:bg-muted/80 text-foreground"
                            }`}
                        >
                            <div className={`mt-0.5 p-1 rounded-md ${isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted"}`}>
                                {cmd.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-bold ${isSelected ? "text-primary-foreground" : "text-foreground"}`}>
                                        {cmd.label}
                                    </span>
                                    <span className={`text-[10px] font-mono px-1 rounded ${isSelected ? "bg-primary-foreground/25 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                        {cmd.command}
                                    </span>
                                </div>
                                <p className={`text-[10px] truncate ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                                    {cmd.description}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
