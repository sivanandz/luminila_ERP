"use client";

/**
 * Analytics hub (Analytics Deep-Insights, 2026-11-02).
 * Five sections over the shared range state:
 *   Sales · Inventory & Turnover · Categories · Profitability · Insights
 * Range presets + period-over-period compare drive every tab. On narrow
 * viewports the tab bar collapses into a themed dropdown (project convention:
 * no horizontal-scroll tab bars).
 */

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { CalendarDays, RefreshCw, LayoutDashboard } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Header } from "@/components/layout/Header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAnalyticsRange } from "@/lib/analytics-v2/range-store";
import { rangeLabel, type RangePreset } from "@/lib/analytics-v2/range";
import { SalesTab } from "@/components/analytics/SalesTab";
import { InventoryTab } from "@/components/analytics/InventoryTab";
import { CategoriesTab } from "@/components/analytics/CategoriesTab";
import { ProfitabilityTab } from "@/components/analytics/ProfitabilityTab";
import { InsightsTab } from "@/components/analytics/InsightsTab";

const TAB_IDS = ["sales", "inventory", "categories", "profitability", "insights"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABEL: Record<TabId, string> = {
    sales: "Sales",
    inventory: "Inventory & Turnover",
    categories: "Categories",
    profitability: "Profitability",
    insights: "Insights",
};

const PRESETS: Array<{ id: RangePreset; label: string }> = [
    { id: "7d", label: "7 days" },
    { id: "30d", label: "30 days" },
    { id: "90d", label: "90 days" },
    { id: "12m", label: "12 months" },
];

export default function AnalyticsPage() {
    // useSearchParams (inside the inner component) requires a Suspense
    // boundary for static prerendering.
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full"><RefreshCw className="w-8 h-8 text-primary animate-spin" /></div>}>
            <AnalyticsPageInner />
        </Suspense>
    );
}

function AnalyticsPageInner() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const range = useAnalyticsRange((s) => s.range);
    const setPreset = useAnalyticsRange((s) => s.setPreset);
    const setCustom = useAnalyticsRange((s) => s.setCustom);

    const tabFromUrl = TAB_IDS.includes(searchParams.get("tab") as TabId)
        ? (searchParams.get("tab") as TabId)
        : "sales";
    const [tab, setTab] = useState<TabId>(tabFromUrl);
    // Keep ?tab= in sync so Back from an Insights deep-link returns to the tab
    // that was actually showing (audit AN-29).
    const selectTab = (v: string | null) => {
        if (!v) return;
        const next = v as TabId;
        setTab(next);
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", next);
        router.replace(`/analytics?${params.toString()}`, { scroll: false });
    };
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");
    const [customOpen, setCustomOpen] = useState(range.preset === "custom");
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        setTab(tabFromUrl);
    }, [tabFromUrl]);

    const applyCustom = () => {
        if (customStart && customEnd) setCustom(customStart, customEnd);
    };

    return (
        <ProtectedRoute resource="reports" action="read">
            <div className="flex flex-col h-full overflow-hidden">
                <Header title="Analytics" subtitle="Deep business insights — sales, turnover, margins, categories" />

                <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-8 scroll-smooth">
                    <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
                        {/* Range header */}
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                                <div className="flex items-center rounded-lg border border-border overflow-hidden">
                                    {PRESETS.map((p) => (
                                        <button
                                            key={p.id}
                                            onClick={() => {
                                                setPreset(p.id);
                                                setCustomOpen(false);
                                            }}
                                            className={cn(
                                                "px-3 py-1.5 text-xs font-medium transition-colors",
                                                range.preset === p.id
                                                    ? "bg-primary/15 text-primary font-semibold"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                            )}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => setCustomOpen((o) => !o)}
                                        className={cn(
                                            "px-3 py-1.5 text-xs font-medium transition-colors border-l border-border",
                                            range.preset === "custom"
                                                ? "bg-primary/15 text-primary font-semibold"
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                        )}
                                    >
                                        Custom
                                    </button>
                                </div>
                                <span className="text-sm text-muted-foreground">{rangeLabel(range)} · every metric compares against the previous equal-length window</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Link
                                    href="/"
                                    className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                                >
                                    <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
                                </Link>
                                <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                                    <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
                                </Button>
                            </div>
                        </div>

                        {customOpen && (
                            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3">
                                <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-40" />
                                <span className="text-muted-foreground text-sm">to</span>
                                <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-40" />
                                <Button size="sm" onClick={applyCustom} disabled={!customStart || !customEnd}>
                                    Apply
                                </Button>
                            </div>
                        )}

                        {/* Tab bar: segmented control on wide screens, themed
                            dropdown on narrow viewports (project convention). */}
                        <div className="hidden md:block">
                            <Tabs value={tab} onValueChange={selectTab}>
                                <TabsList>
                                    {TAB_IDS.map((id) => (
                                        <TabsTrigger key={id} value={id}>
                                            {TAB_LABEL[id]}
                                            {id === "insights" && " ✦"}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                        </div>
                        <div className="md:hidden">
                            <Select value={tab} onValueChange={selectTab}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Choose a section" />
                                </SelectTrigger>
                                <SelectContent>
                                    {TAB_IDS.map((id) => (
                                        <SelectItem key={id} value={id}>
                                            {TAB_LABEL[id]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Sections keyed by reloadKey so Refresh recomputes */}
                        {tab === "sales" && <SalesTab key={`sales-${reloadKey}`} />}
                        {tab === "inventory" && <InventoryTab key={`inv-${reloadKey}`} />}
                        {tab === "categories" && <CategoriesTab key={`cat-${reloadKey}`} />}
                        {tab === "profitability" && <ProfitabilityTab key={`profit-${reloadKey}`} />}
                        {tab === "insights" && <InsightsTab key={`ins-${reloadKey}`} />}
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
