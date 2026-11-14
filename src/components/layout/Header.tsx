"use client";

import { useState, useEffect, type FormEvent } from "react";
import {
    Bell,
    Search,
    RefreshCw,
    Plus,
    Wifi,
    ShieldCheck,
    Command as CommandIcon,
    Package,
    ShoppingBag,
    FileText,
    Users,
    Truck,
    AlertTriangle,
    PackageCheck,
    ArrowRight,
} from "lucide-react";
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ServerConfigModal } from "@/components/settings/ServerConfigModal";
import { checkServerStatus, ServerHealthResult, pb, accountScopeEmail, sanitizeFilter } from "@/lib/pocketbase";

interface CommandResult {
    id: string;
    group: "Product" | "Order" | "Invoice" | "Customer" | "Vendor";
    label: string;
    sublabel?: string;
    href: string;
}

const QUICK_ROUTES: Array<{ label: string; keywords: string; href: string }> = [
    { label: "Point of Sale (POS)", keywords: "pos billing register checkout cart", href: "/pos" },
    { label: "Orders & Estimates", keywords: "orders sales estimate b2b", href: "/orders" },
    { label: "Packing Station", keywords: "packing dispatch scan station", href: "/packing" },
    { label: "Invoices", keywords: "invoices gst billing pdf", href: "/invoices" },
    { label: "Stock Management", keywords: "inventory stock products sku", href: "/inventory" },
    { label: "Customers & Promos", keywords: "customers crm loyalty promo coupon", href: "/customers" },
    { label: "WhatsApp Console", keywords: "whatsapp chat broadcast flash drop", href: "/whatsapp" },
    { label: "Purchase Orders", keywords: "purchase po grn intake", href: "/purchase" },
    { label: "Vendors", keywords: "vendors suppliers karigar", href: "/vendors" },
    { label: "Returns & Credit Notes", keywords: "returns credit note qc refund", href: "/returns" },
    { label: "Analytics & Reports", keywords: "analytics profit revenue reports", href: "/analytics" },
    { label: "Karigar Jobs", keywords: "manufacturing karigar workshop", href: "/manufacturing" },
];

interface HeaderProps {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
    children?: React.ReactNode;
    /** Hide the global search on pages that render their own search field. */
    hideSearch?: boolean;
}

export function Header({ title, subtitle, action, children, hideSearch }: HeaderProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [notifications, setNotifications] = useState<{
        lowStock: number;
        openPacking: number;
        activeDiscrepancies: number;
    }>({ lowStock: 0, openPacking: 0, activeDiscrepancies: 0 });
    const [isServerModalOpen, setIsServerModalOpen] = useState(false);
    const [serverStatus, setServerStatus] = useState<ServerHealthResult | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [commandOpen, setCommandOpen] = useState(false);
    const [commandQuery, setCommandQuery] = useState("");
    const [commandResults, setCommandResults] = useState<CommandResult[]>([]);
    const [searchingPalette, setSearchingPalette] = useState(false);
    const [paletteIndex, setPaletteIndex] = useState(0);
    const router = useRouter();

    const notificationCount =
        notifications.lowStock + notifications.openPacking + notifications.activeDiscrepancies;

    // The global field is a shortcut into the inventory search, the only list
    // that already understands `?search=`. Pages with their own search pass
    // hideSearch (AI-SYS-23).
    const submitSearch = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const query = searchQuery.trim();
        if (!query) return;
        router.push(`/inventory?search=${encodeURIComponent(query)}`);
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        // Give the spin one frame before the reload replaces the document.
        window.setTimeout(() => window.location.reload(), 60);
    };

    // Global Cmd+K / Ctrl+K shortcut for Command Palette
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setCommandOpen((prev) => !prev);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    // Debounced cross-collection search inside Command Palette
    useEffect(() => {
        if (!commandOpen) return;
        const term = commandQuery.trim();
        if (term.length < 2) {
            return;
        }
        const tenant = accountScopeEmail();
        if (!pb.authStore.isValid || !tenant) return;

        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setSearchingPalette(true);
            const safeTerm = sanitizeFilter(term);
            const scope = `account_email="${sanitizeFilter(tenant)}"`;
            const [prodRes, ordRes, invRes, custRes, vendRes] = await Promise.allSettled([
                pb.collection("products").getList<{ id: string; name?: string; sku?: string }>(1, 4, {
                    filter: `(name~"${safeTerm}" || sku~"${safeTerm}") && ${scope}`,
                    requestKey: null,
                }),
                pb.collection("sales_orders").getList<{ id: string; order_number?: string; customer_name?: string; status?: string }>(1, 4, {
                    filter: `(order_number~"${safeTerm}" || customer_name~"${safeTerm}") && ${scope}`,
                    requestKey: null,
                }),
                pb.collection("invoices").getList<{ id: string; invoice_number?: string; buyer_name?: string }>(1, 4, {
                    filter: `(invoice_number~"${safeTerm}" || buyer_name~"${safeTerm}") && ${scope}`,
                    requestKey: null,
                }),
                pb.collection("customers").getList<{ id: string; name?: string; phone?: string }>(1, 4, {
                    filter: `(name~"${safeTerm}" || phone~"${safeTerm}") && ${scope}`,
                    requestKey: null,
                }),
                pb.collection("vendors").getList<{ id: string; name?: string; phone?: string }>(1, 4, {
                    filter: `(name~"${safeTerm}" || contact_name~"${safeTerm}" || phone~"${safeTerm}") && ${scope}`,
                    requestKey: null,
                }),
            ]);

            if (cancelled) return;
            const merged: CommandResult[] = [];
            if (prodRes.status === "fulfilled") {
                for (const p of prodRes.value.items) {
                    merged.push({
                        id: `prod-${p.id}`,
                        group: "Product",
                        label: p.name || p.sku || p.id,
                        sublabel: p.sku,
                        href: `/inventory?search=${encodeURIComponent(p.sku || p.name || "")}`,
                    });
                }
            }
            if (ordRes.status === "fulfilled") {
                for (const o of ordRes.value.items) {
                    merged.push({
                        id: `ord-${o.id}`,
                        group: "Order",
                        label: `#${o.order_number || o.id}`,
                        sublabel: `${o.customer_name || "Customer"}${o.status ? ` · ${o.status}` : ""}`,
                        href: `/orders/detail?id=${o.id}`,
                    });
                }
            }
            if (invRes.status === "fulfilled") {
                for (const inv of invRes.value.items) {
                    merged.push({
                        id: `inv-${inv.id}`,
                        group: "Invoice",
                        label: inv.invoice_number || inv.id,
                        sublabel: inv.buyer_name || "Walk-in",
                        href: `/invoices/detail?id=${inv.id}`,
                    });
                }
            }
            if (custRes.status === "fulfilled") {
                for (const c of custRes.value.items) {
                    merged.push({
                        id: `cust-${c.id}`,
                        group: "Customer",
                        label: c.name || c.phone || c.id,
                        sublabel: c.phone,
                        href: `/customers/detail?id=${c.id}`,
                    });
                }
            }
            if (vendRes.status === "fulfilled") {
                for (const v of vendRes.value.items) {
                    merged.push({
                        id: `vend-${v.id}`,
                        group: "Vendor",
                        label: v.name || v.id,
                        sublabel: v.phone,
                        href: `/vendors`,
                    });
                }
            }
            setCommandResults(merged);
            setSearchingPalette(false);
        }, 220);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [commandOpen, commandQuery]);

    useEffect(() => {
        const verifyConnection = async () => {
            const status = await checkServerStatus();
            setServerStatus(status);
        };

        const loadNotifications = async () => {
            const tenant = accountScopeEmail();
            if (!pb.authStore.isValid || !tenant) return;
            const scope = `account_email="${sanitizeFilter(tenant)}"`;
            const [lowStockRes, packingRes, discRes] = await Promise.allSettled([
                pb.collection("product_variants").getList(1, 1, {
                    filter: `stock_level <= 5 && ${scope}`,
                    fields: "id",
                    requestKey: null,
                }),
                pb.collection("order_packing").getList(1, 1, {
                    filter: `status="in_progress" && ${scope}`,
                    fields: "id",
                    requestKey: null,
                }),
                pb.collection("stock_discrepancies").getList(1, 1, {
                    filter: `status="active" && ${scope}`,
                    fields: "id",
                    requestKey: null,
                }),
            ]);
            setNotifications({
                lowStock: lowStockRes.status === "fulfilled" ? lowStockRes.value.totalItems : 0,
                openPacking: packingRes.status === "fulfilled" ? packingRes.value.totalItems : 0,
                activeDiscrepancies: discRes.status === "fulfilled" ? discRes.value.totalItems : 0,
            });
        };

        verifyConnection();
        void loadNotifications();

        // Listen for server changed events
        const handleServerChange = () => {
            verifyConnection();
            void loadNotifications();
        };

        window.addEventListener("pb:server-changed", handleServerChange);
        // Periodic health & alert check
        const interval = setInterval(() => {
            verifyConnection();
            void loadNotifications();
        }, 45000);

        return () => {
            window.removeEventListener("pb:server-changed", handleServerChange);
            clearInterval(interval);
        };
    }, []);

    const normalizedPaletteQuery = commandQuery.trim().toLowerCase();
    const filteredRoutes = QUICK_ROUTES.filter(
        (r) =>
            !normalizedPaletteQuery ||
            r.label.toLowerCase().includes(normalizedPaletteQuery) ||
            r.keywords.includes(normalizedPaletteQuery)
    );
    const activeSearchResults = commandQuery.trim().length >= 2 ? commandResults : [];
    const paletteHrefs = [
        ...activeSearchResults.map((r) => r.href),
        ...filteredRoutes.map((r) => r.href),
    ];
    const safePaletteIndex =
        paletteHrefs.length > 0 ? Math.min(Math.max(paletteIndex, 0), paletteHrefs.length - 1) : 0;

    const navigateFromPalette = (href: string) => {
        setCommandOpen(false);
        setCommandQuery("");
        setPaletteIndex(0);
        router.push(href);
    };

    const renderGroupIcon = (group: CommandResult["group"]) => {
        switch (group) {
            case "Product":
                return <Package size={14} className="text-primary shrink-0" />;
            case "Order":
                return <ShoppingBag size={14} className="text-emerald-400 shrink-0" />;
            case "Invoice":
                return <FileText size={14} className="text-amber-400 shrink-0" />;
            case "Customer":
                return <Users size={14} className="text-cyan-400 shrink-0" />;
            case "Vendor":
                return <Truck size={14} className="text-purple-400 shrink-0" />;
        }
    };

    return (
        <>
            <header className="border-b border-border bg-background sticky top-0 z-20 px-4 py-3 md:px-8 md:py-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:gap-x-6">
                    <div className="order-1 min-w-0 flex-1 md:flex-none">
                        <h2 className="text-foreground text-lg md:text-xl font-bold tracking-tight truncate">{title}</h2>
                        {subtitle && <p className="text-muted-foreground text-xs hidden lg:block truncate">{subtitle}</p>}
                    </div>

                    {/*
                      Phones: title and actions share the first line (the actions may
                      wrap internally), the search takes a full-width second line.
                      Desktop: title, flexible search, then the action cluster.
                    */}
                    {!hideSearch && (
                    <form onSubmit={submitSearch} className="relative group order-3 w-full min-w-0 md:order-2 md:w-auto md:max-w-md md:flex-1">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground group-focus-within:text-primary">
                            <Search size={18} />
                        </div>
                        <input
                            suppressHydrationWarning
                            className="bg-card border border-border text-foreground text-base md:text-sm rounded-lg block w-full pl-9 py-2 md:py-2.5 pr-16 focus:ring-1 focus:ring-primary placeholder-muted-foreground transition-all"
                            placeholder="Search products or press ⌘K..."
                            type="search"
                            enterKeyHint="search"
                            aria-label="Search products"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={() => setCommandOpen(true)}
                            title="Open Quick Command Palette (Cmd+K / Ctrl+K)"
                            className="absolute inset-y-1.5 right-1.5 px-2 rounded bg-muted/80 hover:bg-muted text-[11px] font-mono text-muted-foreground hover:text-foreground border border-border/70 flex items-center gap-1"
                        >
                            <CommandIcon size={11} />K
                        </button>
                    </form>
                    )}
                    <div className="order-2 flex min-w-0 flex-wrap items-center justify-end gap-1.5 md:order-3 md:gap-3">
                    {hideSearch && (
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setCommandOpen(true)}
                            title="Command Palette (Cmd+K / Ctrl+K)"
                            aria-label="Open Command Palette"
                            className="size-9 md:size-10"
                        >
                            <Search size={16} />
                        </Button>
                    )}
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
                        <DropdownMenuTrigger
                            aria-label="Operational Notifications"
                            className="bg-card hover:bg-muted text-foreground size-9 md:size-10 rounded-lg transition-colors relative flex items-center justify-center border border-border cursor-pointer"
                        >
                            <Bell size={18} />
                            {notificationCount > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center tabular-nums border border-background">
                                    {notificationCount > 99 ? "99+" : notificationCount}
                                </span>
                            )}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80 bg-card border-border">
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="flex items-center justify-between">
                                    <span>Operations Alerts</span>
                                    <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                                        {notificationCount} active
                                    </span>
                                </DropdownMenuLabel>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            {notificationCount === 0 ? (
                                <div className="py-8 text-center text-muted-foreground text-sm">
                                    <Bell className="mx-auto mb-2 opacity-20" size={32} />
                                    <p>All clear — no active alerts</p>
                                </div>
                            ) : (
                                <div className="py-1 space-y-0.5">
                                    {notifications.lowStock > 0 && (
                                        <DropdownMenuItem onClick={() => router.push("/inventory")} className="cursor-pointer py-2.5">
                                            <Package size={15} className="mr-2.5 text-amber-400 shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-semibold text-foreground">
                                                    {notifications.lowStock} Low-Stock Variant{notifications.lowStock === 1 ? "" : "s"}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground">5 units or fewer remaining</p>
                                            </div>
                                        </DropdownMenuItem>
                                    )}
                                    {notifications.openPacking > 0 && (
                                        <DropdownMenuItem onClick={() => router.push("/packing")} className="cursor-pointer py-2.5">
                                            <PackageCheck size={15} className="mr-2.5 text-emerald-400 shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-semibold text-foreground">
                                                    {notifications.openPacking} Open Packing Session{notifications.openPacking === 1 ? "" : "s"}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground">Orders waiting at packing station</p>
                                            </div>
                                        </DropdownMenuItem>
                                    )}
                                    {notifications.activeDiscrepancies > 0 && (
                                        <DropdownMenuItem onClick={() => router.push("/inventory")} className="cursor-pointer py-2.5">
                                            <AlertTriangle size={15} className="mr-2.5 text-red-400 shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-semibold text-foreground">
                                                    {notifications.activeDiscrepancies} Active Discrepanc{notifications.activeDiscrepancies === 1 ? "y" : "ies"}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground">Damaged / missing items flagged</p>
                                            </div>
                                        </DropdownMenuItem>
                                    )}
                                </div>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Refresh Button */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        title="Click to Refresh Data"
                        aria-label="Refresh data"
                        className="size-9 md:size-10"
                    >
                        <RefreshCw size={16} className={isRefreshing ? "animate-spin" : undefined} />
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
                </div>
            </header>

            {/* Server Configuration Modal */}
            <ServerConfigModal
                isOpen={isServerModalOpen}
                onClose={() => setIsServerModalOpen(false)}
            />

            {/* Global Cmd+K Command Palette */}
            <Dialog open={commandOpen} onOpenChange={(open) => {
                setCommandOpen(open);
                if (!open) {
                    setCommandQuery("");
                    setCommandResults([]);
                }
            }}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white max-w-xl p-0 overflow-hidden gap-0">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Quick Command &amp; Search Palette</DialogTitle>
                    </DialogHeader>
                    <div className="flex items-center gap-2.5 border-b border-surface-hover px-4 py-3">
                        <Search size={17} className="text-moonstone shrink-0" />
                        <input
                            autoFocus
                            value={commandQuery}
                            onChange={(e) => {
                                const val = e.target.value;
                                setCommandQuery(val);
                                setPaletteIndex(0);
                                if (val.trim().length < 2) {
                                    setCommandResults([]);
                                    setSearchingPalette(false);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (paletteHrefs.length === 0) return;
                                if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setPaletteIndex((prev) => (prev + 1) % paletteHrefs.length);
                                } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setPaletteIndex((prev) => (prev - 1 + paletteHrefs.length) % paletteHrefs.length);
                                } else if (e.key === "Enter") {
                                    const targetHref = paletteHrefs[safePaletteIndex];
                                    if (targetHref) {
                                        e.preventDefault();
                                        navigateFromPalette(targetHref);
                                    }
                                }
                            }}
                            placeholder="Search products, orders, invoices, customers, vendors or jump to page..."
                            className="w-full bg-transparent text-sm text-white placeholder-moonstone focus:outline-none"
                        />
                        <kbd className="rounded border border-surface-hover bg-bg-navy px-1.5 py-0.5 text-[10px] font-mono text-moonstone shrink-0">ESC</kbd>
                    </div>
                    <div className="max-h-96 overflow-y-auto p-2 space-y-3">
                        {commandQuery.trim().length >= 2 && (
                            <div>
                                <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-moonstone">
                                    {searchingPalette ? "Searching store records..." : `Matches (${commandResults.length})`}
                                </p>
                                {commandResults.length === 0 && !searchingPalette ? (
                                    <p className="px-2.5 py-2 text-xs text-moonstone">No matching records found.</p>
                                ) : (
                                    <div className="space-y-0.5">
                                        {commandResults.map((item, idx) => {
                                            const active = safePaletteIndex === idx;
                                            return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onMouseEnter={() => setPaletteIndex(idx)}
                                                onClick={() => navigateFromPalette(item.href)}
                                                className={`w-full flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                                    active ? "bg-primary/20 ring-1 ring-primary/50" : "hover:bg-bg-navy/80"
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    {renderGroupIcon(item.group)}
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-semibold text-white truncate">{item.label}</p>
                                                        {item.sublabel && (
                                                            <p className="text-[11px] text-moonstone truncate">{item.sublabel}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <span className="text-[10px] font-semibold uppercase tracking-wider text-moonstone shrink-0">
                                                    {item.group}
                                                </span>
                                            </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {filteredRoutes.length > 0 && (
                            <div>
                                <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-moonstone">
                                    Quick Navigation
                                </p>
                                <div className="space-y-0.5">
                                    {filteredRoutes.map((route, idx) => {
                                        const flatIdx = activeSearchResults.length + idx;
                                        const active = safePaletteIndex === flatIdx;
                                        return (
                                        <button
                                            key={route.href}
                                            type="button"
                                            onMouseEnter={() => setPaletteIndex(flatIdx)}
                                            onClick={() => navigateFromPalette(route.href)}
                                            className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium text-white transition-colors ${
                                                active ? "bg-primary/20 ring-1 ring-primary/50" : "hover:bg-bg-navy/80"
                                            }`}
                                        >
                                            <span>{route.label}</span>
                                            <ArrowRight size={13} className="text-moonstone" />
                                        </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
