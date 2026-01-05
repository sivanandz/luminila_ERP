"use client";

import { useState, useEffect } from "react";
import { Bell, Search, RefreshCw, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}

export function Header({ title, subtitle, action }: HeaderProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const router = useRouter();

    return (
        <header className="flex items-center justify-between px-8 py-6 border-b border-border bg-background sticky top-0 z-20 gap-8">
            <div className="flex items-center gap-6 flex-1 max-w-3xl">
                <div>
                    <h2 className="text-foreground text-xl font-bold tracking-tight whitespace-nowrap">{title}</h2>
                    {subtitle && <p className="text-muted-foreground text-sm hidden lg:block">{subtitle}</p>}
                </div>

                <div className="relative group flex-1 max-w-md ml-4">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground group-focus-within:text-primary">
                        <Search size={20} />
                    </div>
                    <input
                        className="bg-card border border-border text-foreground text-sm rounded-lg block w-full pl-10 py-3 pr-4 focus:ring-1 focus:ring-primary placeholder-muted-foreground transition-all"
                        placeholder="Search..."
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <DropdownMenu>
                    <DropdownMenuTrigger className="bg-card hover:bg-muted text-foreground size-11 rounded-lg transition-colors relative flex items-center justify-center border border-border cursor-pointer">
                        <Bell size={22} />
                        <span className="absolute top-2.5 right-3 size-2 bg-destructive rounded-full border border-background"></span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80 bg-card border-border">
                        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <div className="py-8 text-center text-muted-foreground text-sm">
                            <Bell className="mx-auto mb-2 opacity-20" size={32} />
                            <p>No new notifications</p>
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>

                <button
                    onClick={() => window.location.reload()}
                    className="bg-card hover:bg-muted text-foreground h-11 px-4 rounded-lg transition-colors flex items-center gap-2.5 border border-border"
                    title="Click to Refresh Data"
                >
                    <RefreshCw size={22} className="animate-spin-slow" style={{ animationDuration: '3s' }} />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide hidden xl:block">Synced</span>
                </button>

                {action || (
                    <button
                        onClick={() => router.push('/pos')}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground h-11 px-5 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ml-1"
                    >
                        <Plus size={20} />
                        <span>New Sale</span>
                    </button>
                )}
            </div>
        </header>
    );
}


