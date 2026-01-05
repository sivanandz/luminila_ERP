"use client";

import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { KPICards } from "@/components/dashboard/KPICards";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { TopProducts } from "@/components/dashboard/TopProducts";
import { ChannelBreakdown } from "@/components/dashboard/ChannelBreakdown";
import { RecentActivity } from "@/components/dashboard/RecentActivity";

import {
    getDashboardStats,
    getSalesTrend,
    getTopProducts,
    getChannelBreakdown,
    getRecentActivity,
    type DashboardStats,
    type SalesDataPoint,
    type TopProduct,
    type ChannelBreakdown as ChannelData,
    type RecentActivity as ActivityData,
} from "@/lib/analytics";

export default function DashboardPage() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [salesTrend, setSalesTrend] = useState<SalesDataPoint[]>([]);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [channelData, setChannelData] = useState<ChannelData[]>([]);
    const [activities, setActivities] = useState<ActivityData[]>([]);

    const loadDashboard = async (showRefresh = false) => {
        if (showRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const [statsData, trendData, productsData, channelsData, activityData] = await Promise.all([
                getDashboardStats(),
                getSalesTrend(30),
                getTopProducts(5),
                getChannelBreakdown(),
                getRecentActivity(8),
            ]);

            setStats(statsData);
            setSalesTrend(trendData);
            setTopProducts(productsData);
            setChannelData(channelsData);
            setActivities(activityData);
        } catch (error) {
            console.error("Error loading dashboard:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadDashboard();

        // Auto-refresh every 5 minutes
        const interval = setInterval(() => loadDashboard(true), 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const handleRefresh = () => {
        loadDashboard(true);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-4">
                    <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto" />
                    <p className="text-muted-foreground">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Dashboard"
                subtitle="Real-time business overview"
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto space-y-6">
                    {/* Actions Bar */}
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">
                                Last 30 days performance
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRefresh}
                            disabled={refreshing}
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                            {refreshing ? "Refreshing..." : "Refresh"}
                        </Button>
                    </div>

                    {/* KPI Cards */}
                    {stats && <KPICards stats={stats} />}

                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2">
                            <SalesChart data={salesTrend} title="Revenue Trend (30 Days)" />
                        </div>
                        <div>
                            <ChannelBreakdown data={channelData} />
                        </div>
                    </div>

                    {/* Bottom Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <TopProducts products={topProducts} />
                        <RecentActivity activities={activities} />
                    </div>
                </div>
            </div>
        </div>
    );
}

