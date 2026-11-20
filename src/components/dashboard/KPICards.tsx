"use client";

import { TrendingUp, TrendingDown, Package, ShoppingCart, DollarSign, AlertTriangle, Percent, PiggyBank } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";
import { pluralize } from "@/lib/utils";

interface KPICardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    change?: number;
    icon: React.ReactNode;
    iconColor?: string;
}

function KPICard({ title, value, subtitle, change, icon, iconColor = "text-primary" }: KPICardProps) {
    const validChange = change !== undefined && Number.isFinite(change);
    return (
        <Card className="bg-card border-border hover:bg-card/80 transition-colors">
            <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-2">
                    <div className="space-y-2 min-w-0 flex-1">
                        <p className="text-sm text-muted-foreground truncate">{title}</p>
                        <p className="text-lg sm:text-2xl font-semibold tracking-tight tabular-nums break-words">{value}</p>
                        {subtitle && (
                            <p className="text-xs text-muted-foreground break-words">{subtitle}</p>
                        )}
                        {validChange && (
                            <div className={`flex items-center gap-1 text-xs tabular-nums ${change! >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {change! >= 0 ? <TrendingUp className="w-3 h-3 shrink-0" /> : <TrendingDown className="w-3 h-3 shrink-0" />}
                                <span>{Math.round(Math.abs(change!) * 10) / 10}% vs last period</span>
                            </div>
                        )}
                    </div>
                    <div className={`p-2.5 sm:p-3 rounded-lg bg-muted/20 shrink-0 ${iconColor}`}>
                        {icon}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

interface KPICardsProps {
    stats: {
        totalRevenue: number;
        totalOrders: number;
        totalProducts: number;
        lowStockCount: number;
        todayRevenue: number;
        todayOrders: number;
        pendingOrders: number;
        revenueChange: number;
        grossMargin: number;
        aov: number;
        marginChange: { current: number; previous: number; deltaPct: number | null };
    };
    degraded?: boolean;
}

export function KPICards({ stats, degraded }: KPICardsProps) {
    return (
        <div className="space-y-3">
            {degraded && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Figures unavailable — the latest data refresh failed. Values below are not reliable.</span>
                </div>
            )}
        <div className={`grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5 md:gap-4 ${degraded ? "opacity-50 grayscale" : ""}`}>
            <KPICard
                title="Revenue (30d)"
                value={formatINR(stats.totalRevenue)}
                subtitle={`Today: ${formatINR(stats.todayRevenue)}`}
                change={stats.revenueChange}
                icon={<DollarSign className="w-5 h-5" />}
                iconColor="text-green-400"
            />
            <KPICard
                title="Total Orders"
                value={stats.totalOrders.toLocaleString()}
                subtitle={`Today: ${stats.todayOrders} · ${pluralize(stats.pendingOrders, "pending order")}`}
                icon={<ShoppingCart className="w-5 h-5" />}
                iconColor="text-blue-400"
            />
            <KPICard
                title="Avg Order Value"
                value={formatINR(stats.aov)}
                subtitle="30-day average"
                icon={<Percent className="w-5 h-5" />}
                iconColor="text-sky-400"
            />
            <KPICard
                title="Gross Margin"
                value={formatINR(stats.grossMargin)}
                subtitle={stats.totalRevenue > 0 ? `${Math.round((stats.grossMargin / Math.max(stats.totalRevenue, 1)) * 1000) / 10}% of revenue` : undefined}
                change={stats.marginChange.deltaPct ?? undefined}
                icon={<PiggyBank className="w-5 h-5" />}
                iconColor="text-purple-400"
            />
            <KPICard
                title="Products"
                value={stats.totalProducts.toLocaleString()}
                icon={<Package className="w-5 h-5" />}
                iconColor="text-primary"
            />
            <KPICard
                title="Low Stock Items"
                value={stats.lowStockCount}
                subtitle="Below variant threshold"
                icon={<AlertTriangle className="w-5 h-5" />}
                iconColor={stats.lowStockCount > 0 ? "text-yellow-400" : "text-green-400"}
            />
        </div>
        </div>
    );
}


