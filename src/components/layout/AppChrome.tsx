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
import { Sidebar, MobileBottomNav } from "@/components/layout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WhatsAppEventSyncProvider } from "@/components/whatsapp/WhatsAppEventSyncProvider";
import { WhatsAppDrawer } from "@/components/whatsapp/WhatsAppDrawer";
import { OfflineSync } from "@/components/system/OfflineSync";
import { isPublicAppPath } from "@/lib/public-surfaces";

export function AppChrome({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isPublic = isPublicAppPath(pathname);

    if (isPublic) {
        return (
            <div className="flex-1 w-full h-full overflow-y-auto bg-background">
                <ErrorBoundary>{children}</ErrorBoundary>
            </div>
        );
    }

    return (
        <>
            <WhatsAppEventSyncProvider />
            <OfflineSync />
            <Sidebar />
            <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
                <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <MobileBottomNav />
            <WhatsAppDrawer />
        </>
    );
}
