"use client";

/**
 * Application chrome split.
 *
 * Public surfaces (storefront checkout, tracking, login, first-run setup) must
 * not render the operations sidebar, the WhatsApp drawer or the realtime sync
 * providers: those belong to an authenticated ERP session. The root layout used
 * to render them for every visitor, which also meant customers on a public host
 * would mount admin-only providers.
 */

import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Sidebar, MobileBottomNav } from "@/components/layout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WhatsAppEventSyncProvider } from "@/components/whatsapp/WhatsAppEventSyncProvider";
import { WhatsAppDrawer } from "@/components/whatsapp/WhatsAppDrawer";
import { OfflineSync } from "@/components/system/OfflineSync";
import { isPublicAppPath } from "@/lib/public-surfaces";

export function AppChrome({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { isValid, isLoading } = useAuth();
    const isPublic = isPublicAppPath(pathname);

    if (isPublic) {
        return (
            <div className="flex-1 w-full h-full overflow-y-auto bg-background">
                <ErrorBoundary>{children}</ErrorBoundary>
            </div>
        );
    }

    // Defense-in-depth: Never mount operations sidebar or realtime background
    // sync providers if the session is still loading or unauthenticated.
    if (!isValid || isLoading) {
        return null;
    }

    return (
        <>
            <WhatsAppEventSyncProvider />
            <OfflineSync />
            <Sidebar />
            <main className="app-main flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
                <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <MobileBottomNav />
            <WhatsAppDrawer />
        </>
    );
}
