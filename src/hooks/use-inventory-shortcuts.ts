"use client";

import { useEffect } from "react";

export interface InventoryShortcutsHandlers {
    onQuickAdd?: () => void;
}

/**
 * Inventory-level keyboard shortcuts, mirroring the POS F-key hook:
 * Alt+N opens the Quick add dialog when no other modal is grabbing focus.
 */
export function useInventoryShortcuts(handlers: InventoryShortcutsHandlers, enabled = true) {
    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Avoid triggering during input composition
            if (e.isComposing) return;

            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyN") {
                e.preventDefault();
                handlers.onQuickAdd?.();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handlers, enabled]);
}
