"use client";

/**
 * Inventory & Turnover tab: turnover/GMROI suite, category + product tables,
 * dead-stock aging, fast-vs-slow quadrant, overstock list.
 */

import { useEffect, useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ZAxis, ReferenceLine, BarChart, Bar, XAxis as X, YAxis as Y } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";
import { useAnalyticsRange } from "@/lib/analytics-v2/range-store";
import { getTurnoverAnalytics, type TurnoverAnalytics } from "@/lib/analytics-v2/turnover";
import { KpiStrip, AnalyticsTable, EmptyState, fmtMetric, type KpiItem, type AnalyticsTableColumn } from "./shared";
import { LoadingBlock } from "./SalesTab";

function inrShort(v: number): string {
    if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
    if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
    return `₹${v}`;
}

type ProductRow = TurnoverAnalytics["byProduct"][number];

export function InventoryTab() {
    const range = useAnalyticsRange((s) => s.range);
    const [data, setData] = useState<TurnoverAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        getTurnoverAnalytics(range)
            .then((d) => {
                if (!cancelled) setData(d);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load turnover analytics');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [range]);

    if (loading) return <LoadingBlock />;
    if (error) return <EmptyState title="Inventory analytics unavailable" hint={error} />;
    if (!data) return null;

    const s = data.suite;
    const kpis: KpiItem[] = [
        { label: "Stock Value (now)", value: formatINR(s.stockValueCurrent), sub: `start of window: ${formatINR(s.stockValueStart)}` },
        { label: "Inventory Turnover", value: fmtMetric(s.turnoverRate, (v) => `${v.toFixed(2)}×`), sub: `annualized ${fmtMetric(s.annualizedTurnover, (v) => `${v.toFixed(1)}×`)}` },
        { label: "Days of Inventory", value: fmtMetric(s.daysOfInventory, (v) => `${Math.round(v)} d`) },
        { label: "GMROI", value: fmtMetric(s.gmroi, (v) => `₹${v.toFixed(2)}`), sub: "margin ₹ per ₹ of stock" },
        { label: "Gross Margin", value: formatINR(s.grossMargin), sub: s.marginPct !== null ? `${s.marginPct}% of revenue` : undefined },
    ];

    const productColumns: AnalyticsTableColumn<ProductRow>[] = [
        { key: "productName", header: "Product", value: (r) => String(r.productName) },
        { key: "categoryName", header: "Category", value: (r) => String(r.categoryName) },
        { key: "unitsSold", header: "Units", align: "right", value: (r) => Number(r.unitsSold) },
        { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
        { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
        { key: "currentStock", header: "Stock", align: "right", value: (r) => Number(r.currentStock) },
        { key: "stockValue", header: "Stock ₹", align: "right", value: (r) => Number(r.stockValue), render: (r) => formatINR(Number(r.stockValue)) },
        { key: "turnover", header: "Turnover", align: "right", value: (r) => (r.turnover === null ? -1 : Number(r.turnover)), render: (r) => fmtMetric(r.turnover as number | null, (v) => `${v.toFixed(2)}×`) },
        { key: "gmroi", header: "GMROI", align: "right", value: (r) => (r.gmroi === null ? -1 : Number(r.gmroi)), render: (r) => fmtMetric(r.gmroi as number | null, (v) => `₹${v.toFixed(2)}`) },
        { key: "weeksCover", header: "Cover (wks)", align: "right", value: (r) => (r.weeksCover === null ? -1 : Number(r.weeksCover)), render: (r) => fmtMetric(r.weeksCover as number | null, (v) => `${v}`) },
        { key: "velocity", header: "Velocity", value: (r) => String(r.velocity), render: (r) => (
            <span className={r.velocity === 'fast' ? 'text-green-400' : r.velocity === 'dead' ? 'text-red-400' : 'text-muted-foreground'}>{String(r.velocity)}</span>
        ) },
    ];

    return (
        <div className="space-y-4 md:space-y-6">
            <KpiStrip items={kpis} />

            {s.costUnknownSharePct > 0 && (
                <Card className="border-yellow-500/40 bg-yellow-500/5">
                    <CardContent className="py-3 text-xs text-muted-foreground">
                        ⚠ {s.costUnknownSharePct}% of sold units in this window have no cost snapshot and no product cost to estimate from — their margin counts as zero. Run <code className="text-foreground">npm run analytics:backfill-costs</code> to backfill.
                    </CardContent>
                </Card>
            )}

            {data.byProduct.length === 0 && data.aging.every((b) => b.products === 0) ? (
                <EmptyState
                    title="No inventory movement in this range"
                    hint="Turnover appears once sales and stock movements fall inside the selected window."
                />
            ) : (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold">Dead Stock Aging <span className="text-muted-foreground text-xs font-normal">— ₹ locked by days since last sale</span></CardTitle>
                            </CardHeader>
                            <CardContent className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.aging} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                        <X dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                                        <Y tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={inrShort} width={60} />
                                        <Tooltip formatter={(v?: number | string) => formatINR(Number(v ?? 0))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                                        <Bar dataKey="stockValue" name="Stock value" radius={[4, 4, 0, 0]} fill="#f97316" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold">Fast vs Slow Movers <span className="text-muted-foreground text-xs font-normal">— cover (wks) vs margin %, bubble = stock ₹</span></CardTitle>
                            </CardHeader>
                            <CardContent className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                        <XAxis type="number" dataKey="weeksCover" name="Cover (wks)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                        <YAxis type="number" dataKey="marginPct" name="Margin %" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                                        <ZAxis type="number" dataKey="stockValue" range={[20, 220]} />
                                        <ReferenceLine x={12} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: "12 wks", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                        <Tooltip
                                            formatter={(v?: number | string, name?: string) => [name === 'Margin %' ? `${v ?? 0}%` : `${v ?? 0}`, name ?? '']}
                                            labelFormatter={() => ''}
                                            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                        />
                                        <Scatter data={data.quadrants} fill="#eab308" fillOpacity={0.6} />
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    <AnalyticsTable<ProductRow>
                        title="Product Turnover"
                        rows={data.byProduct}
                        columns={productColumns}
                        exportName="product-turnover"
                        initialSortKey="revenue"
                    />

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                        <AnalyticsTable<TurnoverAnalytics["byCategory"][number]>
                            title="Category Turnover"
                            rows={data.byCategory}
                            columns={[
                                { key: "categoryName", header: "Category", value: (r) => String(r.categoryName) },
                                { key: "revenue", header: "Revenue", align: "right", value: (r) => Number(r.revenue), render: (r) => formatINR(Number(r.revenue)) },
                                { key: "marginPct", header: "Margin %", align: "right", value: (r) => (r.marginPct === null ? -1 : Number(r.marginPct)), render: (r) => fmtMetric(r.marginPct as number | null, (v) => `${v}%`) },
                                { key: "turnover", header: "Turnover", align: "right", value: (r) => (r.turnover === null ? -1 : Number(r.turnover)), render: (r) => fmtMetric(r.turnover as number | null, (v) => `${v.toFixed(2)}×`) },
                                { key: "gmroi", header: "GMROI", align: "right", value: (r) => (r.gmroi === null ? -1 : Number(r.gmroi)), render: (r) => fmtMetric(r.gmroi as number | null, (v) => `₹${v.toFixed(2)}`) },
                                { key: "weeksCover", header: "Cover (wks)", align: "right", value: (r) => (r.weeksCover === null ? -1 : Number(r.weeksCover)), render: (r) => fmtMetric(r.weeksCover as number | null, (v) => `${v}`) },
                            ]}
                            exportName="category-turnover"
                            initialSortKey="revenue"
                        />

                        <AnalyticsTable<TurnoverAnalytics["overstock"][number]>
                            title="Overstock (12+ weeks of cover)"
                            rows={data.overstock}
                            columns={[
                                { key: "productName", header: "Product", value: (r) => String(r.productName) },
                                { key: "currentStock", header: "Stock", align: "right", value: (r) => Number(r.currentStock) },
                                { key: "weeklyVelocity", header: "Weekly Sales", align: "right", value: (r) => Number(r.weeklyVelocity) },
                                { key: "weeksCover", header: "Cover (wks)", align: "right", value: (r) => Number(r.weeksCover) },
                                { key: "stockValue", header: "Parked ₹", align: "right", value: (r) => Number(r.stockValue), render: (r) => formatINR(Number(r.stockValue)) },
                            ]}
                            exportName="overstock"
                            initialSortKey="stockValue"
                            emptyTitle="No overstock — every product turns faster than 12 weeks"
                        />
                    </div>

                    {data.zeroStockFastMovers.length > 0 && (
                        <AnalyticsTable<TurnoverAnalytics["zeroStockFastMovers"][number]>
                            title="Stocked-Out Fast Movers (lost sales)"
                            rows={data.zeroStockFastMovers}
                            columns={[
                                { key: "productName", header: "Product", value: (r) => String(r.productName) },
                                { key: "weeklyVelocity", header: "Weekly Sales", align: "right", value: (r) => Number(r.weeklyVelocity) },
                                { key: "lastSaleDaysAgo", header: "Last Sale", align: "right", value: (r) => (r.lastSaleDaysAgo === null ? -1 : Number(r.lastSaleDaysAgo)), render: (r) => (r.lastSaleDaysAgo === null ? 'never' : `${r.lastSaleDaysAgo}d ago`) },
                            ]}
                            exportName="stockout-fast-movers"
                            initialSortKey="weeklyVelocity"
                            emptyTitle="No fast movers sitting at zero stock"
                        />
                    )}
                </>
            )}
        </div>
    );
}
