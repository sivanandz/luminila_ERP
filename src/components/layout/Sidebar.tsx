"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
// import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
    LayoutDashboard,
    Package,
    ShoppingCart,
    MessageCircle,
    Settings,
    BarChart3,
    Printer,
    Tags,
    HelpCircle,
    Diamond,
    Users,
    Undo2,
    Activity,
    Truck,
    Wallet,
    Tag,
    ChevronDown,
    ChevronRight,
    Store,
    FileText,
    TrendingUp,
    Headphones,
    UserCog,
    Landmark,
    CreditCard,
    LogOut,
    LogIn,
    ChevronsDown,
    ChevronsUp,
} from "lucide-react";

interface NavItem {
    href?: string;
    icon: React.ReactNode;
    label: string;
    children?: NavItem[];
}

const navGroups: NavItem[] = [
    { href: "/", icon: <LayoutDashboard size={20} />, label: "Dashboard" },
    {
        icon: <Store size={20} />,
        label: "Sales",
        children: [
            { href: "/pos", icon: <ShoppingCart size={18} />, label: "Point of Sale" },
            { href: "/orders", icon: <Tags size={18} />, label: "Orders & Estimates" },
            { href: "/invoices", icon: <FileText size={18} />, label: "Invoices" },
            { href: "/challan", icon: <Truck size={18} />, label: "Delivery Challan" },
            { href: "/returns", icon: <Undo2 size={18} />, label: "Returns" },
        ],
    },
    {
        icon: <Package size={20} />,
        label: "Purchases",
        children: [
            { href: "/purchase", icon: <Package size={18} />, label: "Purchase Orders" },
            { href: "/vendors", icon: <Users size={18} />, label: "Vendors" },
        ],
    },
    {
        icon: <Package size={20} />,
        label: "Inventory",
        children: [
            { href: "/inventory", icon: <Package size={18} />, label: "Stock Management" },
            { href: "/labels", icon: <Printer size={18} />, label: "Print Labels" },
        ],
    },
    {
        icon: <Wallet size={20} />,
        label: "Finance",
        children: [
            { href: "/banking", icon: <Landmark size={18} />, label: "Banking & Ledger" },
            { href: "/expenses", icon: <CreditCard size={18} />, label: "Expenses" },
            { href: "/expenses/categories", icon: <Tag size={18} />, label: "Expense Categories" },
        ],
    },
    {
        icon: <Users size={20} />,
        label: "CRM",
        children: [
            { href: "/customers", icon: <Users size={18} />, label: "Customers" },
            { href: "/whatsapp", icon: <MessageCircle size={18} />, label: "WhatsApp" },
        ],
    },
    {
        icon: <TrendingUp size={20} />,
        label: "Reports",
        children: [
            { href: "/reports", icon: <BarChart3 size={18} />, label: "Business Reports" },
            { href: "/activity", icon: <Activity size={18} />, label: "Activity Log" },
        ],
    },
];

const systemItems: NavItem[] = [
    { href: "/users", icon: <UserCog size={20} />, label: "User Management" },
    { href: "/settings", icon: <Settings size={20} />, label: "Settings" },
    { href: "/support", icon: <Headphones size={20} />, label: "Support" },
];

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
    if (!item.href) return null;
    const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
    return (
        <Link
            href={item.href}
            className={cn(
                buttonVariants({ variant: isActive ? "secondary" : "ghost" }),
                "w-full justify-start gap-3 h-10 text-sm",
                isActive && "font-semibold text-primary bg-primary/10"
            )}
        >
            {item.icon}
            {item.label}
        </Link>
    );
}

// function CollapsibleGroup ... modified to receive props
function CollapsibleGroup({
    group,
    pathname,
    isOpen,
    onToggle,
}: {
    group: NavItem;
    pathname: string;
    isOpen: boolean;
    onToggle: () => void;
}) {
    const isChildActive = group.children?.some(
        (child) => child.href && (pathname === child.href || pathname.startsWith(child.href + "/"))
    );

    return (
        <div className="space-y-0.5">
            <button
                onClick={onToggle}
                className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "w-full justify-between gap-3 h-11 text-sm font-medium",
                    isChildActive && "text-primary"
                )}
            >
                <span className="flex items-center gap-3">
                    {group.icon}
                    {group.label}
                </span>
                {isOpen ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
            </button>
            <div
                className={cn(
                    "overflow-hidden transition-all duration-200 ease-in-out",
                    isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                )}
            >
                <div className="pl-4 border-l border-border/50 ml-3 space-y-0.5 py-1">
                    {group.children?.map((child) => (
                        <NavLink key={child.href} item={child} pathname={pathname} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { user, isValid, logout } = useAuth();

    // Lifted state with initialization function to auto-open active group
    const [openGroups, setOpenGroups] = useState<string[]>(() => {
        return navGroups
            .filter(group => group.children?.some(
                child => child.href && (pathname === child.href || pathname.startsWith(child.href + "/"))
            ))
            .map(group => group.label);
    });

    // Initialize open groups based on active route (run once or effect?)
    // Using effect to ensure it opens on navigation? Or just initial state.
    // Better to use useEffect to auto-open relevant group on mount/nav
    // But user might want to close it.
    // Let's stick to initial state or manual control? 
    // "Expand/Collapse All" implies manual control overwrites.
    // I'll keep it simple: Expand All = add all titles to array. Collapse All = empty array.

    const handleExpandAll = () => {
        const allTitles = navGroups.filter(g => g.children).map(g => g.label);
        setOpenGroups(allTitles);
    };

    const handleCollapseAll = () => {
        setOpenGroups([]);
    };

    const toggleGroup = (label: string) => {
        setOpenGroups(prev =>
            prev.includes(label)
                ? prev.filter(l => l !== label)
                : [...prev, label]
        );
    };

    const handleLogout = () => {
        logout();
        router.push("/login");
    };

    // Get user initials
    const getInitials = (name?: string, email?: string) => {
        if (name) {
            const parts = name.split(" ");
            return parts.map(p => p[0]).slice(0, 2).join("").toUpperCase();
        }
        if (email) {
            return email.slice(0, 2).toUpperCase();
        }
        return "??";
    };

    return (
        <aside className="w-72 bg-card border-r flex flex-col h-full shrink-0 z-30">
            {/* Logo */}
            <div className="p-6 flex items-center gap-3">
                <div className="size-10 bg-primary/10 rounded-lg flex items-center justify-center border border-primary/20">
                    <Diamond className="text-primary" size={20} />
                </div>
                <div>
                    <h1 className="text-lg font-bold tracking-tight">Luminila</h1>
                    <p className="text-xs text-muted-foreground font-medium tracking-widest">JEWELRY</p>
                </div>
            </div>

            {/* Expand/Collapse Controls */}
            <div className="px-4 pb-2 flex items-center justify-end gap-1">
                <button
                    onClick={handleExpandAll}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                    title="Expand All"
                >
                    <ChevronsDown size={14} className="stroke-[3]" />
                </button>
                <button
                    onClick={handleCollapseAll}
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                    title="Collapse All"
                >
                    <ChevronsUp size={14} className="stroke-[3]" />
                </button>
            </div>

            <div className="flex-1 px-4 min-h-0 overflow-y-auto">
                <div className="space-y-1 py-2">
                    {navGroups.map((group) =>
                        group.children ? (
                            <CollapsibleGroup
                                key={group.label}
                                group={group}
                                pathname={pathname}
                                isOpen={openGroups.includes(group.label)}
                                onToggle={() => toggleGroup(group.label)}
                            />
                        ) : (
                            <NavLink key={group.href} item={group} pathname={pathname} />
                        )
                    )}
                </div>

                <Separator className="my-4 opacity-50" />

                <div className="py-2">
                    <h4 className="mb-2 px-4 text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">System</h4>
                    <div className="space-y-1">
                        {systemItems.map((item) => (
                            <NavLink key={item.href} item={item} pathname={pathname} />
                        ))}
                    </div>
                </div>
            </div>

            {/* User Profile */}
            <div className="p-4 border-t bg-muted/20">
                {isValid && user ? (
                    <div className="space-y-3">
                        <div
                            className="flex items-center gap-3 text-left px-2 py-2 rounded-lg hover:bg-accent cursor-pointer group transition-colors"
                            onClick={() => router.push('/settings')}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && router.push('/settings')}
                        >
                            <Avatar className="size-9 border border-border">
                                <AvatarImage src={user.avatar || ""} />
                                <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                                    {getInitials(user.name, user.email)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="grid gap-0.5 flex-1 min-w-0">
                                <p className="text-sm font-bold leading-none group-hover:text-primary transition-colors truncate">
                                    {user.name || user.email?.split("@")[0] || "User"}
                                </p>
                                <p className="text-xs text-muted-foreground font-medium truncate">
                                    {user.email || ""}
                                </p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start gap-2 text-muted-foreground hover:text-red-400"
                            onClick={handleLogout}
                        >
                            <LogOut size={16} />
                            Sign Out
                        </Button>
                    </div>
                ) : (
                    <Link
                        href="/login"
                        className={cn(
                            buttonVariants({ variant: "default" }),
                            "w-full gap-2"
                        )}
                    >
                        <LogIn size={16} />
                        Sign In
                    </Link>
                )}
            </div>
        </aside>
    );
}
