"use client";

/**
 * Profitability tab: margin trend w/ previous overlay, margin by category and
 * channel, top-profit vs top-revenue products, discount erosion, expense
 * overlay. Margin caveats shown when cost basis is estimated.
 */

import { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";
import { useAnalyticsRange } from "@/lib/analytics-v2/range-store";
import { getProfitabilityAnalytics, type ProfitabilityAnalytics, type MarginRow } from "@/lib/analytics-v2/profitability";
import { KpiStrip, AnalyticsTable, EmptyState, fmtMetric, type KpiItem, type AnalyticsTableColumn } from "./shared";
import { LoadingBlock } from "./SalesTab";

const productColumns: AnalyticsTableColumn<MarginRow>[] = [
    { key: "label", header: "Product", value: (r) => String(r.label) },
    { key: "units", header: "Units", align: "right", value: (r) => Number(r.units) },
    { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
    { key: "margin", header: "Margin", align: "right", value: (r) => Number(r.margin), render: (r) => formatINR(Number(r.margin)) },
    { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
];

export function ProfitabilityTab() {
    const range = useAnalyticsRange((s) => s.range);
    const [data, setData] = useState<ProfitabilityAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        getProfitabilityAnalytics(range)
            .then((d) => {
                if (!cancelled) setData(d);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load profitability analytics');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [range]);

    if (loading) return <LoadingBlock />;
    if (error) return <EmptyState title="Profitability analytics unavailable" hint={error} />;
    if (!data) return null;

    if (data.byCategory.length === 0 && data.trend.length === 0) {
        return (
            <EmptyState
                title="No margin data in this range"
                hint="Margins appear once sales with cost data (unit_cost snapshots or product cost) land inside the window."
            />
        );
    }

    const kpis: KpiItem[] = [
        { label: "Gross Margin", value: formatINR(data.overallMargin.current), deltaPct: data.overallMargin.deltaPct, sub: data.marginPct !== null ? `${data.marginPct}% of revenue` : undefined },
        { label: "Margin %", value: fmtMetric(data.marginPct, (v) => `${v}%`), sub: `prev ${fmtMetric(data.previousMarginPct, (v) => `${v}%`)}` },
        { label: "Discount Erosion", value: `${data.discountErosion.erosionPct}%`, sub: `${formatINR(data.discountErosion.totalDiscounts)} given away`, invertDelta: true, deltaPct: data.discountErosion.deltaPct },
        { label: "Operating Expenses", value: formatINR(data.expenses.total), sub: data.expenses.total > 0 ? "same window" : "no expenses recorded" },
        { label: "Margin − Expenses", value: formatINR(data.expenses.operatingResult), sub: data.expenses.operatingResult < 0 ? "operating loss" : "operating surplus" },
    ];

    return (
        <div className="space-y-4 md:space-y-6">
            <KpiStrip items={kpis} />

            {data.marginUnknownCostUnits > 0 && (
                <Card className="border-yellow-500/40 bg-yellow-500/5">
                    <CardContent className="py-3 text-xs text-muted-foreground">
                        ⚠ {data.marginUnknownCostUnits} sold unit(s) carry an estimated cost (no snapshot at sale time). Their margins shift if product cost changes — run the backfill script to snapshot historical costs.
                    </CardContent>
                </Card>
            )}

            {data.trend.length > 0 && (
                <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold">Margin Trend <span className="text-muted-foreground text-xs font-normal">— solid: margin · dashed: previous window · area: revenue</span></CardTitle>
                    </CardHeader>
                    <CardContent className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={data.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="profitRev" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.25} />
                                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => (Math.abs(v) >= 100000 ? `₹${(v / 100000).toFixed(0)}L` : Math.abs(v) >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)} />
                                <Tooltip formatter={(v?: number | string, name?: string) => [formatINR(Number(v ?? 0)), name ?? '']} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#38bdf8" fill="url(#profitRev)" strokeWidth={1.5} />
                                <Line type="monotone" dataKey="margin" name="Gross Margin" stroke="#22c55e" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="previousMargin" name="Previous Margin" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <AnalyticsTable<MarginRow>
                    title="Margin by Category"
                    rows={data.byCategory}
                    columns={[
                        { key: "label", header: "Category", value: (r) => String(r.label) },
                        { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
                        { key: "margin", header: "Margin", align: "right", value: (r) => Number(r.margin), render: (r) => formatINR(Number(r.margin)) },
                        { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
                    ]}
                    exportName="margin-by-category"
                    initialSortKey="margin"
                    emptyTitle="No categorized sales in this range"
                />

                <AnalyticsTable<MarginRow>
                    title="Margin by Channel"
                    rows={data.byChannel}
                    columns={[
                        { key: "label", header: "Channel", value: (r) => String(r.label) },
                        { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
                        { key: "margin", header: "Margin", align: "right", value: (r) => Number(r.margin), render: (r) => formatINR(Number(r.margin)) },
                        { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
                    ]}
                    exportName="margin-by-channel"
                    initialSortKey="margin"
                    emptyTitle="No channel sales in this range"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                <AnalyticsTable<MarginRow>
                    title="Top Profit Contributors"
                    rows={data.topByProfit}
                    columns={productColumns}
                    exportName="top-profit-products"
                    initialSortKey="margin"
                    maxHeight="max-h-[340px]"
                    emptyTitle="No product margins in this range"
                />
                <AnalyticsTable<MarginRow>
                    title="Top Revenue Contributors"
                    rows={data.topByRevenue}
                    columns={productColumns}
                    exportName="top-revenue-products"
                    initialSortKey="revenue"
                    maxHeight="max-h-[340px]"
                    emptyTitle="No product revenue in this range"
                />
            </div>

            {data.expenses.byCategory.length > 0 && (
                <AnalyticsTable<{ category: string; amount: number }>
                    title="Expenses in Same Window (overlay)"
                    rows={data.expenses.byCategory}
                    columns={[
                        { key: "category", header: "Category", value: (r) => String(r.category) },
                        { key: "amount", header: "Amount", align: "right", value: (r) => Number(r.amount), render: (r) => formatINR(Number(r.amount)) },
                    ]}
                    exportName="expenses-overlay"
                    initialSortKey="amount"
                    maxHeight="max-h-[300px]"
                />
            )}
        </div>
    );
}
