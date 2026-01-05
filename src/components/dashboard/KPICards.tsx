"use client";

import { TrendingUp, TrendingDown, Package, ShoppingCart, DollarSign, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";

interface KPICardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    change?: number;
    icon: React.ReactNode;
    iconColor?: string;
}

function KPICard({ title, value, subtitle, change, icon, iconColor = "text-primary" }: KPICardProps) {
    return (
        <Card className="bg-card border-border hover:bg-card/80 transition-colors">
            <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">{title}</p>
                        <p className="text-2xl font-semibold tracking-tight">{value}</p>
                        {subtitle && (
                            <p className="text-xs text-muted-foreground">{subtitle}</p>
                        )}
                        {change !== undefined && (
                            <div className={`flex items-center gap-1 text-xs ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                <span>{Math.abs(change)}% vs last period</span>
                            </div>
                        )}
                    </div>
                    <div className={`p-3 rounded-lg bg-muted/20 ${iconColor}`}>
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
    };
}

export function KPICards({ stats }: KPICardsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
                title="Monthly Revenue"
                value={formatINR(stats.totalRevenue)}
                subtitle={`Today: ${formatINR(stats.todayRevenue)}`}
                change={stats.revenueChange}
                icon={<DollarSign className="w-5 h-5" />}
                iconColor="text-green-400"
            />
            <KPICard
                title="Total Orders"
                value={stats.totalOrders.toLocaleString()}
                subtitle={`Today: ${stats.todayOrders}`}
                icon={<ShoppingCart className="w-5 h-5" />}
                iconColor="text-blue-400"
            />
            <KPICard
                title="Products"
                value={stats.totalProducts.toLocaleString()}
                subtitle={`${stats.pendingOrders} pending orders`}
                icon={<Package className="w-5 h-5" />}
                iconColor="text-primary"
            />
            <KPICard
                title="Low Stock Items"
                value={stats.lowStockCount}
                subtitle="Below threshold"
                icon={<AlertTriangle className="w-5 h-5" />}
                iconColor={stats.lowStockCount > 0 ? "text-yellow-400" : "text-green-400"}
            />
        </div>
    );
}


