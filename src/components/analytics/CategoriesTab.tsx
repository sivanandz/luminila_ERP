"use client";

/**
 * Categories tab: leaderboard (revenue/margin/turnover/GMROI), monthly mix
 * shift, price-band performance, purity split, making-charge share.
 */

import { useEffect, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { formatINR } from "@/lib/gst";
import { useAnalyticsRange } from "@/lib/analytics-v2/range-store";
import { getTurnoverAnalytics, type TurnoverAnalytics } from "@/lib/analytics-v2/turnover";
import { getCategoryDeepDive, type CategoryDeepDive } from "@/lib/analytics-v2/category-metrics";
import { AnalyticsTable, EmptyState, fmtMetric, type AnalyticsTableColumn } from "./shared";
import { LoadingBlock } from "./SalesTab";

type CatRow = TurnoverAnalytics["byCategory"][number];

const MIX_COLORS = ["#eab308", "#f97316", "#22c55e", "#38bdf8", "#a78bfa", "#f43f5e", "#14b8a6", "#e2e8f0"];

export function CategoriesTab() {
    const range = useAnalyticsRange((s) => s.range);
    const [turnover, setTurnover] = useState<TurnoverAnalytics | null>(null);
    const [deep, setDeep] = useState<CategoryDeepDive | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        Promise.all([getTurnoverAnalytics(range), getCategoryDeepDive(range)])
            .then(([t, d]) => {
                if (!cancelled) {
                    setTurnover(t);
                    setDeep(d);
                }
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load category analytics');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [range]);

    if (loading) return <LoadingBlock />;
    if (error) return <EmptyState title="Category analytics unavailable" hint={error} />;
    if (!turnover || !deep) return null;

    if (turnover.byCategory.length === 0) {
        return (
            <EmptyState
                title="No category sales in this range"
                hint="Categorize products in Inventory to unlock per-category turnover, price bands and purity splits."
            />
        );
    }

    const catColumns: AnalyticsTableColumn<CatRow>[] = [
        { key: "categoryName", header: "Category", value: (r) => String(r.categoryName) },
        { key: "unitsSold", header: "Units", align: "right", value: (r) => Number(r.unitsSold) },
        { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
        { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
        { key: "avgStockValue", header: "Avg Stock ₹", align: "right", value: (r) => Number(r.avgStockValue), render: (r) => formatINR(Number(r.avgStockValue)) },
        { key: "turnover", header: "Turnover", align: "right", value: (r) => (r.turnover === null ? -1 : Number(r.turnover)), render: (r) => fmtMetric(r.turnover as number | null, (v) => `${v.toFixed(2)}×`) },
        { key: "gmroi", header: "GMROI", align: "right", value: (r) => (r.gmroi === null ? -1 : Number(r.gmroi)), render: (r) => fmtMetric(r.gmroi as number | null, (v) => `₹${v.toFixed(2)}`) },
        { key: "weeksCover", header: "Cover (wks)", align: "right", value: (r) => (r.weeksCover === null ? -1 : Number(r.weeksCover)), render: (r) => fmtMetric(r.weeksCover as number | null, (v) => `${v}`) },
    ];

    return (
        <div className="space-y-4 md:space-y-6">
            <AnalyticsTable<CatRow>
                title="Category Leaderboard"
                rows={turnover.byCategory}
                columns={catColumns}
                exportName="category-leaderboard"
                initialSortKey="revenue"
                maxHeight="max-h-[340px]"
            />

            {deep.mixShift.length > 1 && deep.topCategories.length > 0 && (
                <CategoryMixChart data={deep} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <AnalyticsTable<CategoryDeepDive["priceBands"][number]>
                    title="Price Band Performance"
                    rows={deep.priceBands}
                    columns={[
                        { key: "band", header: "Band", value: (r) => String(r.band) },
                        { key: "units", header: "Units", align: "right", value: (r) => Number(r.units) },
                        { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
                        { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
                    ]}
                    exportName="price-bands"
                    initialSortKey="revenue"
                    emptyTitle="No sales in this range"
                />

                <AnalyticsTable<CategoryDeepDive["purity"][number]>
                    title="Purity Split"
                    rows={deep.purity}
                    columns={[
                        { key: "purity", header: "Purity", value: (r) => String(r.purity) },
                        { key: "units", header: "Units", align: "right", value: (r) => Number(r.units) },
                        { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
                        { key: "revenueSharePct", header: "Share %", align: "right", value: (r) => Number(r.revenueSharePct), render: (r) => `${r.revenueSharePct}%` },
                        { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
                        { key: "makingChargeSharePct", header: "Making Ch. %", align: "right", value: (r) => Number(r.makingChargeSharePct), render: (r) => `${r.makingChargeSharePct}%` },
                    ]}
                    exportName="purity-split"
                    initialSortKey="revenue"
                    emptyTitle="No tagged purity on sold items"
                />
            </div>

            {deep.makingCharges.length > 0 && (
                <AnalyticsTable<CategoryDeepDive["makingCharges"][number]>
                    title="Making-Charge Share by Category"
                    rows={deep.makingCharges}
                    columns={[
                        { key: "categoryName", header: "Category", value: (r) => String(r.categoryName) },
                        { key: "makingCharges", header: "Making Charges ₹", align: "right", value: (r) => Number(r.makingCharges), render: (r) => formatINR(Number(r.makingCharges)) },
                        { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
                        { key: "sharePct", header: "Labour Share %", align: "right", value: (r) => Number(r.sharePct), render: (r) => `${r.sharePct}%` },
                    ]}
                    exportName="making-charge-share"
                    initialSortKey="makingCharges"
                    maxHeight="max-h-[300px]"
                    emptyTitle="No making charges recorded"
                />
            )}
        </div>
    );
}

function CategoryMixChart({ data }: { data: CategoryDeepDive }) {
    return (
        <div className="rounded-xl border bg-card border-border">
            <div className="px-4 pt-4 pb-1 text-base font-semibold">Revenue Mix by Month <span className="text-muted-foreground text-xs font-normal">— top categories, stacked</span></div>
            <div className="h-72 px-2 pb-3">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.mixShift} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(0)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)} />
                        <Tooltip formatter={(v?: number | string, name?: string) => [formatINR(Number(v ?? 0)), name ?? '']} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {data.topCategories.map((cat, i) => (
                            <Area
                                key={cat}
                                type="monotone"
                                dataKey={cat}
                                stackId="mix"
                                stroke={MIX_COLORS[i % MIX_COLORS.length]}
                                fill={MIX_COLORS[i % MIX_COLORS.length]}
                                fillOpacity={0.45}
                            />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
