"use client";

import { useEffect, useRef } from "react";

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
    const handlersRef = useRef(handlers);
    useEffect(() => {
        handlersRef.current = handlers;
    });

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Avoid triggering during input composition
            if (e.isComposing) return;

            switch (e.key) {
                case "F2":
                    e.preventDefault();
                    handlersRef.current.onSearchFocus?.();
                    break;
                case "F3":
                    e.preventDefault();
                    handlersRef.current.onCustomerModal?.();
                    break;
                case "F4":
                    e.preventDefault();
                    handlersRef.current.onPriceOverride?.();
                    break;
                case "F8":
                    e.preventDefault();
                    handlersRef.current.onHoldCart?.();
                    break;
                case "F9":
                    e.preventDefault();
                    handlersRef.current.onTenderPay?.();
                    break;
                case "F12":
                    e.preventDefault();
                    handlersRef.current.onPrintComplete?.();
                    break;
                case "Escape":
                    handlersRef.current.onEscape?.();
                    break;
                default:
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [enabled]);
}
