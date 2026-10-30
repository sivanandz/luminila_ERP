"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    LayoutDashboard,
    Package,
    ShoppingCart,
    FileText,
    Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileDrawer } from "./MobileDrawer";
import { ServerConfigModal } from "@/components/settings/ServerConfigModal";

interface MobileBottomNavProps {
    onOpenServerConfig?: () => void;
}

export function MobileBottomNav({
    onOpenServerConfig,
}: MobileBottomNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [serverModalOpen, setServerModalOpen] = useState(false);

    // Hide bottom nav on specific fullscreen pages like login or setup
    const isAuthOrSetup = pathname === "/login" || pathname === "/setup" || pathname?.startsWith("/login/") || pathname?.startsWith("/setup/");
    if (isAuthOrSetup) return null;

    // The selected tab gets an iOS-style filled pill behind its icon and label.
    const tabClass = (active: boolean) =>
        cn(
            "group flex flex-1 items-center justify-center transition-colors duration-200",
            active ? "text-primary" : "text-muted-foreground hover:text-foreground"
        );

    const pillClass = (active: boolean) =>
        cn(
            "flex flex-col items-center justify-center gap-0.5 rounded-[18px] px-3 py-1.5 transition-all duration-200 active:scale-[0.96]",
            active && "bg-primary/10"
        );

    return (
        <>
            {/*
              Floating glass dock. It sits above the page with a safe-area aware
              gap, so the main column reserves extra bottom padding in AppChrome.
            */}
            <nav
                aria-label="Primary"
                className="no-print md:hidden fixed inset-x-3 z-40 mx-auto max-w-md"
                style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
            >
                <div className="relative rounded-[28px] border border-white/60 bg-card/45 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.65),0_8px_24px_-12px_rgba(0,0,0,0.45)] backdrop-blur-[28px] backdrop-saturate-[1.8] dark:border-white/15 dark:bg-card/35 dark:shadow-[0_28px_70px_-18px_rgba(0,0,0,0.85),0_10px_28px_-12px_rgba(0,0,0,0.65)]">
                    {/* Frosted sheen, specular top edge and hairline rim. Decorative only. */}
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-[28px] bg-gradient-to-b from-white/45 via-white/10 to-transparent dark:from-white/12 dark:via-white/[0.04]"
                    />
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/40"
                    />
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),inset_0_-1px_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),inset_0_-1px_1px_rgba(0,0,0,0.35)]"
                    />

                    <div className="relative z-10 flex items-center justify-around h-16 px-1.5">
                        {/* Home Tab */}
                        <Link
                            href="/"
                            aria-current={pathname === "/" ? "page" : undefined}
                            className={tabClass(pathname === "/")}
                        >
                            <span className={pillClass(pathname === "/")}>
                                <LayoutDashboard size={20} className={pathname === "/" ? "stroke-[2.5]" : "stroke-2"} />
                                <span className="text-[10px] font-semibold tracking-tight">Home</span>
                            </span>
                        </Link>

                        {/* Stock Tab */}
                        <Link
                            href="/inventory"
                            aria-current={pathname.startsWith("/inventory") ? "page" : undefined}
                            className={tabClass(pathname.startsWith("/inventory"))}
                        >
                            <span className={pillClass(pathname.startsWith("/inventory"))}>
                                <Package size={20} className={pathname.startsWith("/inventory") ? "stroke-[2.5]" : "stroke-2"} />
                                <span className="text-[10px] font-semibold tracking-tight">Stock</span>
                            </span>
                        </Link>

                        {/* Center Elevated FAB for POS / Quick Sale */}
                        <div className="flex flex-1 items-center justify-center">
                            <button
                                onClick={() => router.push("/pos")}
                                aria-current={pathname === "/pos" ? "page" : undefined}
                                className={cn(
                                    "size-14 rounded-full flex flex-col items-center justify-center text-white shadow-lg transition-transform active:scale-95 border-[3px] border-background -mt-5",
                                    pathname === "/pos"
                                        ? "bg-amber-500 shadow-amber-500/40 ring-2 ring-amber-400/50"
                                        : "bg-primary shadow-primary/40"
                                )}
                                title="Open Point of Sale"
                            >
                                <ShoppingCart size={22} className="stroke-[2.5]" />
                                <span className="text-[9px] font-bold tracking-tight uppercase">POS</span>
                            </button>
                        </div>

                        {/* Invoices Tab */}
                        <Link
                            href="/invoices"
                            aria-current={pathname.startsWith("/invoices") ? "page" : undefined}
                            className={tabClass(pathname.startsWith("/invoices"))}
                        >
                            <span className={pillClass(pathname.startsWith("/invoices"))}>
                                <FileText size={20} className={pathname.startsWith("/invoices") ? "stroke-[2.5]" : "stroke-2"} />
                                <span className="text-[10px] font-semibold tracking-tight">Invoices</span>
                            </span>
                        </Link>

                        {/* More / Menu Drawer Toggle */}
                        <button
                            onClick={() => setIsDrawerOpen(true)}
                            className={tabClass(isDrawerOpen)}
                        >
                            <span className={pillClass(isDrawerOpen)}>
                                <Menu size={20} className="stroke-2" />
                                <span className="text-[10px] font-semibold tracking-tight">Menu</span>
                            </span>
                        </button>
                    </div>
                </div>
            </nav>

            {/* Slide-over Drawer for all ERP modules */}
            <MobileDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                onOpenServerConfig={() => (onOpenServerConfig ? onOpenServerConfig() : setServerModalOpen(true))}
            />

            {/* Server Configuration Modal */}
            <ServerConfigModal
                isOpen={serverModalOpen}
                onClose={() => setServerModalOpen(false)}
            />
        </>
    );
}
