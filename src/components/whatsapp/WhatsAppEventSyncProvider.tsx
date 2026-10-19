"use client";

import { useEffect } from "react";
import { initWhatsAppEventSync } from "@/lib/whatsapp-event-sync";

/**
 * Global background provider that keeps the WhatsApp Business Catalog
 * continuously in sync with PocketBase inventory changes and POS sales.
 */
export function WhatsAppEventSyncProvider({ children }: { children?: React.ReactNode }) {
    useEffect(() => {
        const cleanup = initWhatsAppEventSync();
        return () => {
            cleanup();
        };
    }, []);

    return <>{children}</>;
}
