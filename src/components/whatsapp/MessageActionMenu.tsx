"use client";

import React, { useEffect, useRef } from "react";
import {
    ShoppingCart,
    CreditCard,
    FileText,
    Image as ImageIcon,
    Package,
    PackagePlus,
    Tag,
    Quote,
    Copy,
    Check,
    X,
} from "lucide-react";
import { useViewport } from "@/hooks/use-viewport";
import type { ContactType } from "@/lib/whatsapp-crm";

export interface MessageAction {
    key: string;
    label: string;
    icon: React.ReactNode;
    accent?: string; // tailwind text color class
    handler: () => void;
}

export interface MessageActionMenuProps {
    isOpen: boolean;
    onClose: () => void;
    contactType: ContactType;
    /** Anchor point for the desktop popover (clientX/clientY). */
    position?: { x: number; y: number } | null;
    /** Pre-extracted amount/SKU shown as chips in the header. */
    detectedAmount?: number;
    detectedSku?: string | null;
    /** Customer commerce suite (spec §8.3). */
    onAddToCart?: () => void;
    onCreateQuote?: () => void;
    onSendPaymentLink?: () => void;
    onSendProductCard?: () => void;
    /** Vendor ingestion suite (spec §8.2). */
    onAddExistingInventory?: () => void;
    onCreateProduct?: () => void;
    onAutoBarcodeTag?: () => void;
    /** Common actions. */
    onQuoteReply?: () => void;
}

/**
 * Context Action Engine (spec §8 / §8.4):
 * - Desktop: glassmorphic popover at the right-click point, keyboard navigable.
 * - Mobile: haptic bottom-sheet with thumb-friendly buttons (pair with useLongPress).
 * Actions are filtered by the chat contact type (customer vs vendor).
 */
export function MessageActionMenu({
    isOpen,
    onClose,
    contactType,
    position,
    detectedAmount,
    detectedSku,
    onAddToCart,
    onCreateQuote,
    onSendPaymentLink,
    onSendProductCard,
    onAddExistingInventory,
    onCreateProduct,
    onAutoBarcodeTag,
    onQuoteReply,
}: MessageActionMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = React.useState(false);
    const { isDesktop } = useViewport();

    // Dismiss on outside click / Escape (both surfaces)
    useEffect(() => {
        if (!isOpen) return;
        const handlePointer = (e: MouseEvent | TouchEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                const buttons = Array.from(
                    menuRef.current?.querySelectorAll<HTMLButtonElement>("button[data-action]") ?? []
                );
                if (!buttons.length) return;
                e.preventDefault();
                const idx = buttons.findIndex((b) => b === document.activeElement);
                const next = e.key === "ArrowDown"
                    ? buttons[(idx + 1) % buttons.length]
                    : buttons[(idx - 1 + buttons.length) % buttons.length];
                next?.focus();
            }
        };
        document.addEventListener("mousedown", handlePointer);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handlePointer);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, onClose]);

    // Auto-focus first action for keyboard navigation
    useEffect(() => {
        if (!isOpen) return;
        const t = setTimeout(() => {
            menuRef.current?.querySelector<HTMLButtonElement>("button[data-action]")?.focus();
        }, 30);
        return () => clearTimeout(t);
    }, [isOpen]);

    if (!isOpen) return null;

    const isVendor = contactType === 'vendor';

    const actions: MessageAction[] = isVendor
        ? [
            onAddExistingInventory && {
                key: 'add-inventory',
                label: 'Add to Existing Inventory',
                icon: <PackagePlus size={15} />,
                accent: 'text-indigo-500',
                handler: onAddExistingInventory,
            },
            onCreateProduct && {
                key: 'new-product',
                label: 'Create New Product from Message',
                icon: <Package size={15} />,
                accent: 'text-emerald-500',
                handler: onCreateProduct,
            },
            onAutoBarcodeTag && {
                key: 'auto-tag',
                label: 'Auto Barcode Tag',
                icon: <Tag size={15} />,
                accent: 'text-amber-500',
                handler: onAutoBarcodeTag,
            },
        ].filter(Boolean) as MessageAction[]
        : [
            onAddToCart && {
                key: 'add-cart',
                label: detectedSku ? `Add ${detectedSku} to POS Cart` : 'Add to POS Cart',
                icon: <ShoppingCart size={15} />,
                accent: 'text-primary',
                handler: onAddToCart,
            },
            onCreateQuote && {
                key: 'quote',
                label: 'Create Quote / Estimate',
                icon: <FileText size={15} />,
                accent: 'text-amber-500',
                handler: onCreateQuote,
            },
            onSendPaymentLink && {
                key: 'pay-link',
                label: detectedAmount
                    ? `Send Payment Link (₹${detectedAmount.toLocaleString('en-IN')})`
                    : 'Send Razorpay Payment Link',
                icon: <CreditCard size={15} />,
                accent: 'text-blue-500',
                handler: onSendPaymentLink,
            },
            onSendProductCard && {
                key: 'product-card',
                label: 'Send Product Card',
                icon: <ImageIcon size={15} />,
                accent: 'text-pink-500',
                handler: onSendProductCard,
            },
        ].filter(Boolean) as MessageAction[];

    const commonActions: MessageAction[] = [
        onQuoteReply && {
            key: 'quote-reply',
            label: 'Quote & Reply',
            icon: <Quote size={15} />,
            accent: 'text-muted-foreground',
            handler: onQuoteReply,
        },
        {
            key: 'copy',
            label: copied ? 'Copied!' : 'Copy Text',
            icon: copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />,
            accent: 'text-muted-foreground',
            handler: () => {
                navigator.clipboard?.writeText(window.getSelection()?.toString() || '');
                setCopied(true);
                setTimeout(() => { setCopied(false); onClose(); }, 500);
            },
        },
    ].filter(Boolean) as MessageAction[];

    const renderButton = (action: MessageAction) => (
        <button
            key={action.key}
            data-action
            onClick={() => { action.handler(); onClose(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-primary/10 hover:text-primary active:bg-primary/20 transition-colors text-left font-medium text-foreground"
        >
            <span className={action.accent}>{action.icon}</span>
            <span className="flex-1 truncate text-xs">{action.label}</span>
        </button>
    );

    const header = (
        <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    isVendor ? 'bg-indigo-500/15 text-indigo-400' : 'bg-emerald-500/15 text-emerald-400'
                }`}>
                    {isVendor ? 'Vendor' : contactType === 'lead' ? 'Lead' : 'Customer'}
                </span>
                {detectedAmount && (
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        ₹{detectedAmount.toLocaleString('en-IN')}
                    </span>
                )}
                {detectedSku && (
                    <span className="text-[10px] font-mono text-muted-foreground truncate">{detectedSku}</span>
                )}
            </div>
            <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close actions"
            >
                <X size={14} />
            </button>
        </div>
    );

    // ---- Desktop: glassmorphic popover anchored at the right-click point ----
    if (isDesktop) {
        const menuWidth = 260;
        const menuHeight = 340;
        const x = Math.min(position?.x ?? 0, (typeof window !== 'undefined' ? window.innerWidth : 1200) - menuWidth - 16);
        const y = Math.min(position?.y ?? 0, (typeof window !== 'undefined' ? window.innerHeight : 800) - menuHeight - 16);

        return (
            <div
                ref={menuRef}
                style={{ top: `${y}px`, left: `${x}px` }}
                className="fixed z-[9999] w-65 rounded-xl bg-card/90 backdrop-blur-xl border border-border/70 shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none"
                role="menu"
            >
                {header}
                {actions.map(renderButton)}
                {actions.length > 0 && commonActions.length > 0 && (
                    <div className="my-1 border-t border-border/50" />
                )}
                {commonActions.map(renderButton)}
            </div>
        );
    }

    // ---- Mobile: bottom sheet with thumb-friendly actions ----
    return (
        <div className="fixed inset-0 z-[9999] flex items-end" role="dialog">
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150"
                onClick={onClose}
            />
            <div
                ref={menuRef}
                className="relative w-full bg-card border-t border-border rounded-t-2xl shadow-2xl p-2 pb-6 animate-in slide-in-from-bottom duration-200 max-h-[70vh] overflow-y-auto"
            >
                <div className="w-10 h-1 rounded-full bg-border mx-auto mt-1 mb-2" />
                {header}
                <div className="mt-1 space-y-0.5">
                    {actions.map((a) => (
                        <button
                            key={a.key}
                            data-action
                            onClick={() => { a.handler(); onClose(); }}
                            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-muted/40 hover:bg-primary/10 active:bg-primary/20 transition-colors text-left"
                        >
                            <span className={`p-2 rounded-lg bg-background border border-border/60 ${a.accent}`}>
                                {a.icon}
                            </span>
                            <span className="flex-1 text-sm font-semibold">{a.label}</span>
                        </button>
                    ))}
                    {actions.length > 0 && commonActions.length > 0 && (
                        <div className="my-1.5 border-t border-border/50" />
                    )}
                    {commonActions.map((a) => (
                        <button
                            key={a.key}
                            data-action
                            onClick={() => { a.handler(); onClose(); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-muted/60 active:bg-muted transition-colors text-left"
                        >
                            <span className={a.accent}>{a.icon}</span>
                            <span className="flex-1 text-xs font-medium text-muted-foreground">{a.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
