"use client";

import { useState, useEffect } from "react";
import { Bell, Search, RefreshCw, Plus, Wifi, Cloud, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuGroup,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ServerConfigModal } from "@/components/settings/ServerConfigModal";
import { checkServerStatus, ServerHealthResult } from "@/lib/pocketbase";

interface HeaderProps {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
    children?: React.ReactNode;
}

export function Header({ title, subtitle, action, children }: HeaderProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [hasNotifications, setHasNotifications] = useState(false);
    const [isServerModalOpen, setIsServerModalOpen] = useState(false);
    const [serverStatus, setServerStatus] = useState<ServerHealthResult | null>(null);
    const router = useRouter();

    useEffect(() => {
        const verifyConnection = async () => {
            const status = await checkServerStatus();
            setServerStatus(status);
        };

        verifyConnection();

        // Listen for server changed events
        const handleServerChange = () => {
            verifyConnection();
        };

        window.addEventListener("pb:server-changed", handleServerChange);
        // Periodic health check every 45 seconds
        const interval = setInterval(verifyConnection, 45000);

        return () => {
            window.removeEventListener("pb:server-changed", handleServerChange);
            clearInterval(interval);
        };
    }, []);

    return (
        <>
            <header className="flex items-center justify-between px-4 py-3 md:px-8 md:py-5 border-b border-border bg-background sticky top-0 z-20 gap-3 md:gap-6">
                <div className="flex items-center gap-3 md:gap-6 flex-1 min-w-0">
                    <div className="min-w-0">
                        <h2 className="text-foreground text-lg md:text-xl font-bold tracking-tight truncate">{title}</h2>
                        {subtitle && <p className="text-muted-foreground text-xs hidden lg:block truncate">{subtitle}</p>}
                    </div>

                    {/* Search Bar - hidden on very small phones, visible on sm+ */}
                    <div className="relative group flex-1 max-w-xs md:max-w-md hidden sm:block">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground group-focus-within:text-primary">
                            <Search size={18} />
                        </div>
                        <input
                            className="bg-card border border-border text-foreground text-xs md:text-sm rounded-lg block w-full pl-9 py-2 md:py-2.5 pr-4 focus:ring-1 focus:ring-primary placeholder-muted-foreground transition-all"
                            placeholder="Search..."
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
                    {/* Server Connection Status Pill */}
                    <button
                        onClick={() => setIsServerModalOpen(true)}
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-all hover:scale-105 active:scale-95 cursor-pointer",
                            serverStatus?.ok
                                ? serverStatus.isTunnel
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                    : "bg-primary/10 border-primary/30 text-primary"
                                : "bg-destructive/10 border-destructive/30 text-destructive"
                        )}
                        title="Click to configure Server Host / Cloudflare Tunnel"
                    >
                        <span
                            className={cn(
                                "size-2 rounded-full shrink-0",
                                serverStatus?.ok
                                    ? "bg-emerald-400 animate-pulse"
                                    : "bg-destructive"
                            )}
                        />
                        <span className="hidden xs:inline truncate max-w-[80px] md:max-w-[120px]">
                            {serverStatus?.ok
                                ? serverStatus.isTunnel
                                    ? "Tunnel"
                                    : "Online"
                                : "Offline"}
                        </span>
                        {serverStatus?.isTunnel ? (
                            <ShieldCheck size={13} className="hidden md:inline text-emerald-400 shrink-0" />
                        ) : (
                            <Wifi size={13} className="hidden md:inline shrink-0" />
                        )}
                    </button>

                    {/* Notifications */}
                    <DropdownMenu>
                        <DropdownMenuTrigger className="bg-card hover:bg-muted text-foreground size-9 md:size-10 rounded-lg transition-colors relative flex items-center justify-center border border-border cursor-pointer">
                            <Bell size={18} />
                            {hasNotifications && (
                                <span className="absolute top-2 right-2 size-2 bg-destructive rounded-full border border-background"></span>
                            )}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80 bg-card border-border">
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <div className="py-8 text-center text-muted-foreground text-sm">
                                <Bell className="mx-auto mb-2 opacity-20" size={32} />
                                <p>No new notifications</p>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Refresh Button */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => window.location.reload()}
                        title="Click to Refresh Data"
                        className="size-9 md:size-10"
                    >
                        <RefreshCw size={16} className="animate-spin-slow" style={{ animationDuration: '3s' }} />
                    </Button>

                    {children}

                    {/* Action Button */}
                    {action || (
                        <Button
                            onClick={() => router.push('/pos')}
                            size="sm"
                            className="h-9 md:h-10 text-xs md:text-sm font-semibold gap-1.5 px-3 md:px-4"
                        >
                            <Plus size={16} />
                            <span className="hidden sm:inline">New Sale</span>
                        </Button>
                    )}
                </div>
            </header>

            {/* Server Configuration Modal */}
            <ServerConfigModal
                isOpen={isServerModalOpen}
                onClose={() => setIsServerModalOpen(false)}
            />
        </>
    );
}
