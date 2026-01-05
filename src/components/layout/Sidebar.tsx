"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
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
    Diamond
} from "lucide-react";

interface NavItem {
    href: string;
    icon: React.ReactNode;
    label: string;
}

const navItems: NavItem[] = [
    { href: "/", icon: <LayoutDashboard size={20} />, label: "Dashboard" },
    { href: "/inventory", icon: <Package size={20} />, label: "Inventory" },
    { href: "/orders", icon: <Tags size={20} />, label: "Sales & Orders" },
    { href: "/pos", icon: <ShoppingCart size={20} />, label: "Point of Sale" },
    { href: "/whatsapp", icon: <MessageCircle size={20} />, label: "WhatsApp" },
    { href: "/labels", icon: <Printer size={20} />, label: "Print Labels" },
    { href: "/analytics", icon: <BarChart3 size={20} />, label: "Analytics" },
];

const bottomNavItems: NavItem[] = [
    { href: "/settings", icon: <Settings size={20} />, label: "Settings" },
    { href: "/support", icon: <HelpCircle size={20} />, label: "Support" },
];

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter(); // Hook added

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

            <ScrollArea className="flex-1 px-4">
                <div className="space-y-1 py-2">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                buttonVariants({ variant: pathname === item.href ? "secondary" : "ghost" }),
                                "w-full justify-start gap-3 h-11",
                                pathname === item.href && "font-bold text-primary bg-secondary/80"
                            )}
                        >
                            {item.icon}
                            {item.label}
                        </Link>
                    ))}
                </div>

                <Separator className="my-4 opacity-50" />

                <div className="py-2">
                    <h4 className="mb-2 px-4 text-xs font-semibold tracking-wider text-muted-foreground/70 uppercase">System</h4>
                    <div className="space-y-1">
                        {bottomNavItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    buttonVariants({ variant: pathname === item.href ? "secondary" : "ghost" }),
                                    "w-full justify-start gap-3 h-11",
                                    pathname === item.href && "font-bold text-primary"
                                )}
                            >
                                {item.icon}
                                {item.label}
                            </Link>
                        ))}
                    </div>
                </div>
            </ScrollArea>

            {/* User Profile */}
            <div className="p-4 border-t bg-muted/20">
                <div
                    className="flex items-center gap-3 text-left px-2 py-3 rounded-lg hover:bg-accent cursor-pointer group transition-colors"
                    onClick={() => router.push('/settings')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && router.push('/settings')}
                >
                    <Avatar className="size-9 border border-border">
                        <AvatarImage src="" />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">SR</AvatarFallback>
                    </Avatar>
                    <div className="grid gap-0.5">
                        <p className="text-sm font-bold leading-none group-hover:text-primary transition-colors">Sophia R.</p>
                        <p className="text-xs text-muted-foreground font-medium">Store Manager</p>
                    </div>
                </div>
            </div>
        </aside>
    );
}


