"use client";

/**
 * Sales tab (Analytics Deep-Insights): KPIs w/ period-over-period deltas,
 * revenue trend with previous-window overlay, channel performance, payment
 * mix, weekday×hour heatmap, new-vs-returning split.
 */

import { useEffect, useState } from "react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,
    Bar,
    Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";
import { useAnalyticsRange } from "@/lib/analytics-v2/range-store";
import { getSalesAnalytics, WEEKDAYS, type SalesAnalytics } from "@/lib/analytics-v2/sales-metrics";
import { getProfitabilityAnalytics } from "@/lib/analytics-v2/profitability";
import { KpiStrip, EmptyState, DeltaBadge, type KpiItem } from "./shared";

const CHART_AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function inrShort(v: number): string {
    if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
    if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
    return `₹${v}`;
}

export function SalesTab() {
    const range = useAnalyticsRange((s) => s.range);
    const [data, setData] = useState<SalesAnalytics | null>(null);
    const [margin, setMargin] = useState<{ current: number; previous: number; deltaPct: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const [sales, profit] = await Promise.all([
                    getSalesAnalytics(range),
                    getProfitabilityAnalytics(range),
                ]);
                if (cancelled) return;
                setData(sales);
                setMargin(profit.overallMargin);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load sales analytics');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [range]);

    if (loading) return <LoadingBlock />;
    if (error) return <EmptyState title="Sales analytics unavailable" hint={error} />;
    if (!data) return null;

    const kpis: KpiItem[] = [
        { label: "Revenue", value: formatINR(data.kpis.revenue.current), deltaPct: data.kpis.revenue.deltaPct, sub: `prev ${formatINR(data.kpis.revenue.previous)}` },
        { label: "Orders", value: data.kpis.orders.current.toLocaleString(), deltaPct: data.kpis.orders.deltaPct, sub: `prev ${data.kpis.orders.previous}` },
        { label: "Avg Order Value", value: formatINR(data.kpis.aov.current), deltaPct: data.kpis.aov.deltaPct },
        { label: "Gross Margin", value: formatINR(margin?.current ?? 0), deltaPct: margin?.deltaPct, sub: margin && margin.current !== 0 ? `${Math.round((margin.current / Math.max(data.kpis.revenue.current, 1)) * 1000) / 10}% of revenue` : undefined },
        { label: "Repeat Rate", value: `${data.customerSplit.repeatRatePct}%`, sub: `${data.customerSplit.returningCustomers} returning / ${data.customerSplit.newCustomers} new` },
    ];

    const heatMax = Math.max(...data.heatmap.map((c) => c.revenue), 1);

    return (
        <div className="space-y-4 md:space-y-6">
            <KpiStrip items={kpis} />

            {data.kpis.orders.current === 0 ? (
                <EmptyState
                    title="No sales recorded in this range"
                    hint="Once POS sales or confirmed orders land inside the selected window, the trend, channels and customer split populate here."
                />
            ) : (
                <>
                    <Card className="bg-card border-border">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base font-semibold">Revenue Trend <span className="text-muted-foreground text-xs font-normal">— solid: current window · dashed: previous window (aligned by position)</span></CardTitle>
                        </CardHeader>
                        <CardContent className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#eab308" stopOpacity={0.35} />
                                            <stop offset="100%" stopColor="#eab308" stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                    <XAxis dataKey="label" tick={CHART_AXIS} tickLine={false} axisLine={false} />
                                    <YAxis tick={CHART_AXIS} tickLine={false} axisLine={false} tickFormatter={inrShort} width={64} />
                                    <Tooltip
                                        formatter={(value?: number | string, name?: string) => [
                                            formatINR(Number(value ?? 0)),
                                            name === "revenue" ? "Revenue" : "Previous window",
                                        ]}
                                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                    />
                                    <Area type="monotone" dataKey="revenue" stroke="#eab308" strokeWidth={2} fill="url(#revGrad)" />
                                    <Area type="monotone" dataKey="previousRevenue" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" fill="none" connectNulls />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">Channel Performance</CardTitle></CardHeader>
                            <CardContent className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.channels} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                        <XAxis dataKey="channel" tick={CHART_AXIS} tickLine={false} axisLine={false} />
                                        <YAxis tick={CHART_AXIS} tickLine={false} axisLine={false} tickFormatter={inrShort} width={64} />
                                        <Tooltip formatter={(v?: number | string) => formatINR(Number(v ?? 0))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                                        <Bar dataKey="revenue" fill="#eab308" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="previousRevenue" fill="#64748b" radius={[4, 4, 0, 0]} name="Previous" />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold">New vs Returning</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4 pt-2">
                                <SplitBar label="New customers" count={data.customerSplit.newCustomers} revenue={data.customerSplit.newRevenue} total={data.customerSplit.newCustomers + data.customerSplit.returningCustomers} />
                                <SplitBar label="Returning customers" count={data.customerSplit.returningCustomers} revenue={data.customerSplit.returningRevenue} total={data.customerSplit.newCustomers + data.customerSplit.returningCustomers} />
                                <p className="text-xs text-muted-foreground">
                                    Returning = had any prior purchase before this window. Repeat rate {data.customerSplit.repeatRatePct}%.
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                        <Card className="bg-card border-border">
                            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">Payment Mix</CardTitle></CardHeader>
                            <CardContent className="space-y-2 pt-2">
                                {data.paymentMix.map((p) => (
                                    <div key={p.method} className="flex items-center justify-between gap-3">
                                        <span className="text-sm capitalize">{p.method}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">{p.count} txns</span>
                                            <span className="text-sm font-medium tabular-nums">{formatINR(p.amount)}</span>
                                            <span className="text-xs text-muted-foreground w-12 text-right">{p.percentage}%</span>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold">Peak Hours <span className="text-muted-foreground text-xs font-normal">— weekday × hour revenue</span></CardTitle>
                            </CardHeader>
                            <CardContent className="pt-2">
                                <div className="overflow-x-auto">
                                    <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `48px repeat(24, minmax(10px, 1fr))` }}>
                                        <span />
                                        {Array.from({ length: 24 }, (_, h) => (
                                            <span key={h} className="text-[9px] text-muted-foreground text-center">{h % 3 === 0 ? h : ''}</span>
                                        ))}
                                        {WEEKDAYS.map((day, wd) => (
                                            <DayRow key={day} day={day} wd={wd} data={data.heatmap} heatMax={heatMax} />
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </div>
    );
}

function DayRow({ day, wd, data, heatMax }: { day: string; wd: number; data: Array<{ weekday: number; hour: number; revenue: number; orders?: number }>; heatMax: number }) {
    return (
        <>
            <span className="text-[10px] text-muted-foreground self-center pr-1">{day}</span>
            {Array.from({ length: 24 }, (_, h) => {
                const cell = data.find((c) => c.weekday === wd && c.hour === h);
                const intensity = cell ? cell.revenue / heatMax : 0;
                return (
                    <div
                        key={h}
                        title={cell ? `${day} ${h}:00 — ₹${cell.revenue.toLocaleString('en-IN')} (${cell.orders ?? 0} txns)` : `${day} ${h}:00 — no sales`}
                        className="h-5 rounded-[3px]"
                        style={{ background: intensity > 0 ? `rgba(234, 179, 8, ${0.15 + intensity * 0.85})` : "hsl(var(--muted))" }}
                    />
                );
            })}
        </>
    );
}

function SplitBar({ label, count, revenue, total }: { label: string; count: number; revenue: number; total: number }) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <span className="text-muted-foreground text-xs">{count} ({pct}%) · {formatINR(revenue)}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

export function LoadingBlock() {
    return (
        <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
            <span className="animate-pulse">Crunching the numbers…</span>
        </div>
    );
}
