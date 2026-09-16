"use client";

import React, { useEffect, useRef } from "react";
import {
    ShoppingCart,
    CreditCard,
    FileText,
    User,
    Tag,
    Quote,
    Copy,
    Check,
    Sparkles,
    ChevronRight,
} from "lucide-react";
import { WPPMessage } from "@/lib/whatsapp";

export interface ChatContextMenuProps {
    message: WPPMessage | null;
    position: { x: number; y: number } | null;
    isOpen: boolean;
    onClose: () => void;
    onAddToCart?: (skuOrName: string) => void;
    onGeneratePayLink?: (detectedAmount?: number) => void;
    onConvertToOrder?: (message: WPPMessage) => void;
    onSetLeadStatus?: (status: 'new_lead' | 'contacted' | 'quoted' | 'awaiting_payment' | 'won' | 'vip') => void;
    onOpenCustomerCRM?: () => void;
    onQuoteReply?: (message: WPPMessage) => void;
}

export function ChatContextMenu({
    message,
    position,
    isOpen,
    onClose,
    onAddToCart,
    onGeneratePayLink,
    onConvertToOrder,
    onSetLeadStatus,
    onOpenCustomerCRM,
    onQuoteReply,
}: ChatContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = React.useState(false);
    const [showLeadSubmenu, setShowLeadSubmenu] = React.useState(false);

    // Close on click outside or escape key
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            document.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen || !position || !message) return null;

    // Detect price or amount in message
    const priceMatch = message.body?.match(/₹?\s*(\d{2,6})/);
    const detectedAmount = priceMatch ? parseInt(priceMatch[1], 10) : undefined;

    // Detect potential SKU or item in message
    const skuMatch = message.body?.match(/LUM-[A-Z0-9-]+/i) || message.body?.match(/[A-Z]{3}-[A-Z0-9-]+/i);
    const detectedSku = skuMatch ? skuMatch[0].toUpperCase() : null;

    const handleCopy = () => {
        if (message.body) {
            navigator.clipboard.writeText(message.body);
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
                onClose();
            }, 500);
        }
    };

    // Calculate clamped screen position so menu never clips offscreen
    const menuWidth = 240;
    const menuHeight = 310;
    const screenX = typeof window !== "undefined" ? window.innerWidth : 1200;
    const screenY = typeof window !== "undefined" ? window.innerHeight : 800;

    const clampedX = Math.min(position.x, screenX - menuWidth - 16);
    const clampedY = Math.min(position.y, screenY - menuHeight - 16);

    return (
        <div
            ref={menuRef}
            style={{ top: `${clampedY}px`, left: `${clampedX}px` }}
            className="fixed z-[9999] w-60 rounded-xl bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl p-1.5 text-xs text-foreground animate-in fade-in zoom-in-95 duration-100 select-none"
        >
            <div className="px-2.5 py-1.5 font-semibold text-[10px] tracking-wider text-muted-foreground uppercase border-b border-border/50 mb-1 flex items-center justify-between">
                <span>Message Actions</span>
                {detectedAmount && (
                    <span className="text-emerald-500 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        ₹{detectedAmount.toLocaleString('en-IN')}
                    </span>
                )}
            </div>

            {/* Extract Item & Add to Cart */}
            <button
                onClick={() => {
                    if (onAddToCart) onAddToCart(detectedSku || message.body);
                    onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors text-left font-medium"
            >
                <ShoppingCart size={14} className="text-primary" />
                <div className="flex-1 truncate">
                    <span>{detectedSku ? `Add SKU "${detectedSku}" to Cart` : "Add Item to Cart"}</span>
                </div>
            </button>

            {/* Generate Razorpay Payment Link */}
            <button
                onClick={() => {
                    if (onGeneratePayLink) onGeneratePayLink(detectedAmount);
                    onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-blue-600/10 hover:text-blue-500 transition-colors text-left font-medium"
            >
                <CreditCard size={14} className="text-blue-500" />
                <div className="flex-1 truncate">
                    <span>{detectedAmount ? `Pay Link for ₹${detectedAmount.toLocaleString('en-IN')}` : "Create Razorpay Link"}</span>
                </div>
            </button>

            {/* Convert to Draft Sales Order */}
            <button
                onClick={() => {
                    if (onConvertToOrder) onConvertToOrder(message);
                    onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-amber-500/10 hover:text-amber-500 transition-colors text-left font-medium"
            >
                <FileText size={14} className="text-amber-500" />
                <div className="flex-1 truncate">
                    <span>Convert to Sales Order</span>
                </div>
            </button>

            {/* Lead Status Submenu */}
            <div
                className="relative"
                onMouseEnter={() => setShowLeadSubmenu(true)}
                onMouseLeave={() => setShowLeadSubmenu(false)}
            >
                <button
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-muted/80 transition-colors text-left font-medium"
                >
                    <div className="flex items-center gap-2.5">
                        <Tag size={14} className="text-purple-500" />
                        <span>Set Lead Status</span>
                    </div>
                    <ChevronRight size={12} className="text-muted-foreground" />
                </button>

                {showLeadSubmenu && (
                    <div className="absolute left-full top-0 ml-1 w-44 rounded-xl bg-card border border-border shadow-xl p-1 text-xs space-y-0.5">
                        <button
                            onClick={() => { onSetLeadStatus?.('new_lead'); onClose(); }}
                            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-muted text-sky-500 font-medium"
                        >
                            ● New Lead
                        </button>
                        <button
                            onClick={() => { onSetLeadStatus?.('contacted'); onClose(); }}
                            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-muted text-indigo-500 font-medium"
                        >
                            ● Contacted
                        </button>
                        <button
                            onClick={() => { onSetLeadStatus?.('quoted'); onClose(); }}
                            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-muted text-amber-500 font-medium"
                        >
                            ● Quoted
                        </button>
                        <button
                            onClick={() => { onSetLeadStatus?.('awaiting_payment'); onClose(); }}
                            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-muted text-orange-500 font-medium"
                        >
                            ● Awaiting Payment
                        </button>
                        <button
                            onClick={() => { onSetLeadStatus?.('won'); onClose(); }}
                            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-muted text-emerald-500 font-medium"
                        >
                            ● Deal Won
                        </button>
                        <button
                            onClick={() => { onSetLeadStatus?.('vip'); onClose(); }}
                            className="w-full text-left px-2.5 py-1.5 rounded hover:bg-muted text-pink-500 font-bold"
                        >
                            ★ VIP Customer
                        </button>
                    </div>
                )}
            </div>

            {/* View 360 CRM Profile */}
            <button
                onClick={() => {
                    if (onOpenCustomerCRM) onOpenCustomerCRM();
                    onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/80 transition-colors text-left font-medium"
            >
                <User size={14} className="text-emerald-500" />
                <span>360° Jewelry Profile</span>
            </button>

            {/* Quote / Reply */}
            <button
                onClick={() => {
                    if (onQuoteReply) onQuoteReply(message);
                    onClose();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/80 transition-colors text-left font-medium"
            >
                <Quote size={14} className="text-muted-foreground" />
                <span>Quote & Reply</span>
            </button>

            {/* Copy Message */}
            <button
                onClick={handleCopy}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/80 transition-colors text-left font-medium"
            >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-muted-foreground" />}
                <span>{copied ? "Copied to Clipboard!" : "Copy Text"}</span>
            </button>
        </div>
    );
}
