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
import { GoogleDriveSyncModal } from "@/components/settings/GoogleDriveSyncModal";

interface MobileBottomNavProps {
    onOpenServerConfig?: () => void;
    onOpenDriveSync?: () => void;
}

export function MobileBottomNav({
    onOpenServerConfig,
    onOpenDriveSync,
}: MobileBottomNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [serverModalOpen, setServerModalOpen] = useState(false);
    const [driveModalOpen, setDriveModalOpen] = useState(false);

    // Hide bottom nav on specific fullscreen pages like login or full pos camera modal if needed
    const isLoginPage = pathname === "/login";
    if (isLoginPage) return null;

    const navTabs = [
        { href: "/", label: "Home", icon: LayoutDashboard },
        { href: "/inventory", label: "Stock", icon: Package },
        // Center FAB is POS
        { href: "/invoices", label: "Invoices", icon: FileText },
    ];

    return (
        <>
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom,0px)]">
                <div className="flex items-center justify-around h-16 px-2 relative">
                    {/* Home Tab */}
                    <Link
                        href="/"
                        className={cn(
                            "flex flex-col items-center justify-center flex-1 py-1 transition-colors",
                            pathname === "/" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <LayoutDashboard size={20} className={pathname === "/" ? "stroke-[2.5]" : "stroke-2"} />
                        <span className="text-[10px] font-semibold mt-1">Home</span>
                    </Link>

                    {/* Stock Tab */}
                    <Link
                        href="/inventory"
                        className={cn(
                            "flex flex-col items-center justify-center flex-1 py-1 transition-colors",
                            pathname.startsWith("/inventory") ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Package size={20} className={pathname.startsWith("/inventory") ? "stroke-[2.5]" : "stroke-2"} />
                        <span className="text-[10px] font-semibold mt-1">Stock</span>
                    </Link>

                    {/* Center Elevated FAB for POS / Quick Sale */}
                    <div className="flex-1 flex justify-center -mt-6">
                        <button
                            onClick={() => router.push("/pos")}
                            className={cn(
                                "size-14 rounded-full flex flex-col items-center justify-center text-white shadow-lg transition-transform active:scale-95 border-4 border-background",
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
                        className={cn(
                            "flex flex-col items-center justify-center flex-1 py-1 transition-colors",
                            pathname.startsWith("/invoices") ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <FileText size={20} className={pathname.startsWith("/invoices") ? "stroke-[2.5]" : "stroke-2"} />
                        <span className="text-[10px] font-semibold mt-1">Invoices</span>
                    </Link>

                    {/* More / Menu Drawer Toggle */}
                    <button
                        onClick={() => setIsDrawerOpen(true)}
                        className={cn(
                            "flex flex-col items-center justify-center flex-1 py-1 transition-colors",
                            isDrawerOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Menu size={20} className="stroke-2" />
                        <span className="text-[10px] font-semibold mt-1">Menu</span>
                    </button>
                </div>
            </nav>

            {/* Slide-over Drawer for all ERP modules */}
            <MobileDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                onOpenServerConfig={() => (onOpenServerConfig ? onOpenServerConfig() : setServerModalOpen(true))}
                onOpenDriveSync={() => (onOpenDriveSync ? onOpenDriveSync() : setDriveModalOpen(true))}
            />

            {/* Server Configuration Modal */}
            <ServerConfigModal
                isOpen={serverModalOpen}
                onClose={() => setServerModalOpen(false)}
            />

            {/* Google Drive Sync Modal */}
            <GoogleDriveSyncModal
                isOpen={driveModalOpen}
                onClose={() => setDriveModalOpen(false)}
            />
        </>
    );
}
