"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    FileText,
    Tags,
    Truck,
    Undo2,
    Users,
    Printer,
    Wallet,
    Landmark,
    BarChart3,
    MessageCircle,
    Settings,
    Activity,
    UserCog,
    X,
    LogOut,
    LogIn,
    ChevronRight,
    Wifi,
    Cloud,
    Smartphone
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface MobileDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenServerConfig?: () => void;
    onOpenDriveSync?: () => void;
}

const navSections = [
    {
        title: "Sales & POS",
        items: [
            { href: "/pos", label: "Point of Sale", icon: ShoppingCart },
            { href: "/orders", label: "Orders & Estimates", icon: Tags },
            { href: "/invoices", label: "GST Invoices", icon: FileText },
            { href: "/challan", label: "Delivery Challan", icon: Truck },
            { href: "/returns", label: "Returns & Credit", icon: Undo2 },
        ],
    },
    {
        title: "Inventory & Catalog",
        items: [
            { href: "/inventory", label: "Products & Stock", icon: Package },
            { href: "/labels", label: "Barcode Labels", icon: Printer },
            { href: "/purchase", label: "Purchase Orders", icon: Package },
            { href: "/vendors", label: "Suppliers & Vendors", icon: Users },
        ],
    },
    {
        title: "Finance & Accounts",
        items: [
            { href: "/banking", label: "Banking & Ledger", icon: Landmark },
            { href: "/expenses", label: "Expense Vouchers", icon: Wallet },
            { href: "/reports", label: "Reports & GST", icon: BarChart3 },
        ],
    },
    {
        title: "Showroom & System",
        items: [
            { href: "/customers", label: "Customer CRM", icon: Users },
            { href: "/whatsapp", label: "WhatsApp Status", icon: MessageCircle },
            { href: "/activity", label: "Audit Timeline", icon: Activity },
            { href: "/users", label: "Staff & Roles", icon: UserCog },
            { href: "/settings", label: "Store Settings", icon: Settings },
        ],
    },
];

export function MobileDrawer({
    isOpen,
    onClose,
    onOpenServerConfig,
    onOpenDriveSync,
}: MobileDrawerProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, isValid, logout } = useAuth();

    if (!isOpen) return null;

    const handleNavigate = (href: string) => {
        router.push(href);
        onClose();
    };

    const handleLogout = async () => {
        await logout();
        onClose();
        router.push("/login");
    };

    return (
        <div className="fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Slide-over panel */}
            <div className="relative ml-auto flex h-full w-full max-w-xs flex-col bg-card border-l border-border shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2.5">
                        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <Smartphone size={18} />
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-foreground">Luminila Mobile</h3>
                            <p className="text-xs text-muted-foreground">Showroom ERP & POS</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
                        <X size={18} />
                    </Button>
                </div>

                {/* Cloud & Server Sync Shortcuts */}
                <div className="p-3 border-b border-border bg-accent/20 grid grid-cols-2 gap-2">
                    <button
                        onClick={() => {
                            onClose();
                            onOpenServerConfig?.();
                        }}
                        className="flex items-center gap-2 p-2 rounded-md bg-card border border-border/80 hover:border-primary text-left text-xs transition-colors"
                    >
                        <Wifi size={14} className="text-primary shrink-0" />
                        <span className="truncate font-medium">Server Host</span>
                    </button>
                    <button
                        onClick={() => {
                            onClose();
                            onOpenDriveSync?.();
                        }}
                        className="flex items-center gap-2 p-2 rounded-md bg-card border border-border/80 hover:border-primary text-left text-xs transition-colors"
                    >
                        <Cloud size={14} className="text-primary shrink-0" />
                        <span className="truncate font-medium">Drive Sync</span>
                    </button>
                </div>

                {/* Navigation Sections */}
                <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
                    {navSections.map((section) => (
                        <div key={section.title} className="space-y-1">
                            <p className="px-3 text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
                                {section.title}
                            </p>
                            <div className="space-y-0.5">
                                {section.items.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = pathname === item.href;
                                    return (
                                        <button
                                            key={item.href}
                                            onClick={() => handleNavigate(item.href)}
                                            className={cn(
                                                "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left",
                                                isActive
                                                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                                                    : "text-foreground hover:bg-muted"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Icon size={16} className={cn(isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                                                <span>{item.label}</span>
                                            </div>
                                            <ChevronRight size={14} className="opacity-40" />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* User & Logout Footer */}
                <div className="p-4 border-t border-border bg-muted/20">
                    {isValid && user ? (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Avatar className="size-8 border border-border">
                                    <AvatarImage src={user.avatar || ""} />
                                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                                        {(user.name || user.email || "U").slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                    <p className="text-xs font-bold truncate text-foreground">
                                        {user.name || user.email?.split("@")[0]}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground truncate capitalize">
                                        {user.role || "Staff"}
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleLogout}
                                className="size-8 p-0 text-muted-foreground hover:text-destructive"
                                title="Sign out"
                            >
                                <LogOut size={16} />
                            </Button>
                        </div>
                    ) : (
                        <Link
                            href="/login"
                            onClick={onClose}
                            className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground"
                        >
                            <LogIn size={14} />
                            Sign In
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
