"use client";

import { useEffect } from "react";

export interface POSShortcutsHandlers {
    onSearchFocus?: () => void;
    onCustomerModal?: () => void;
    onPriceOverride?: () => void;
    onHoldCart?: () => void;
    onTenderPay?: () => void;
    onPrintComplete?: () => void;
    onEscape?: () => void;
}

export function usePOSShortcuts(handlers: POSShortcutsHandlers, enabled = true) {
    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Avoid triggering during input composition
            if (e.isComposing) return;

            switch (e.key) {
                case "F2":
                    e.preventDefault();
                    handlers.onSearchFocus?.();
                    break;
                case "F3":
                    e.preventDefault();
                    handlers.onCustomerModal?.();
                    break;
                case "F4":
                    e.preventDefault();
                    handlers.onPriceOverride?.();
                    break;
                case "F8":
                    e.preventDefault();
                    handlers.onHoldCart?.();
                    break;
                case "F9":
                    e.preventDefault();
                    handlers.onTenderPay?.();
                    break;
                case "F12":
                    e.preventDefault();
                    handlers.onPrintComplete?.();
                    break;
                case "Escape":
                    handlers.onEscape?.();
                    break;
                default:
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handlers, enabled]);
}
