"use client";

import { useState, useEffect } from "react";
import { Bell, Search, RefreshCw, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}

export function Header({ title, subtitle, action }: HeaderProps) {
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <header className="flex items-center justify-between px-8 py-6 border-b border-surface-hover bg-bg-navy sticky top-0 z-20 gap-8">
            <div className="flex items-center gap-6 flex-1 max-w-3xl">
                <div>
                    <h2 className="text-white text-xl font-bold tracking-tight whitespace-nowrap">{title}</h2>
                    {subtitle && <p className="text-moonstone text-sm hidden lg:block">{subtitle}</p>}
                </div>

                <div className="relative group flex-1 max-w-md ml-4">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone group-focus-within:text-primary">
                        <Search size={20} />
                    </div>
                    <input
                        className="bg-surface-navy border-none text-white text-sm rounded-lg block w-full pl-10 py-3 pr-4 focus:ring-1 focus:ring-primary placeholder-moonstone transition-all"
                        placeholder="Search..."
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button className="bg-surface-navy hover:bg-surface-hover text-white size-11 rounded-lg transition-colors relative flex items-center justify-center">
                    <Bell size={22} />
                    <span className="absolute top-2.5 right-3 size-2 bg-red-500 rounded-full border border-bg-navy"></span>
                </button>

                <button className="bg-surface-navy hover:bg-surface-hover text-white h-11 px-4 rounded-lg transition-colors flex items-center gap-2.5">
                    <RefreshCw size={22} className="animate-spin-slow" style={{ animationDuration: '3s' }} />
                    <span className="text-xs font-bold text-moonstone uppercase tracking-wide hidden xl:block">Synced</span>
                </button>

                {action || (
                    <button className="bg-primary hover:bg-primary/90 text-bg-navy h-11 px-5 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ml-1">
                        <Plus size={20} />
                        <span>New Sale</span>
                    </button>
                )}
            </div>
        </header>
    );
}
