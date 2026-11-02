"use client";

/**
 * Shared analytics UI primitives (Analytics Deep-Insights).
 * Zero-mock rule: every list/number renders from live data; empty data shows
 * the empty state, never placeholder figures.
 */

import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, Download, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { exportToCSV } from "@/lib/reports";
import { cn } from "@/lib/utils";

export function DeltaBadge({ deltaPct, invert = false }: { deltaPct: number | null; invert?: boolean }) {
    if (deltaPct === null || deltaPct === undefined) return <span className="text-xs text-muted-foreground">—</span>;
    const good = invert ? deltaPct <= 0 : deltaPct >= 0;
    const neutral = deltaPct === 0;
    const Icon = neutral ? Minus : deltaPct > 0 ? TrendingUp : TrendingDown;
    return (
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium", neutral ? "text-muted-foreground" : good ? "text-green-400" : "text-red-400")}>
            <Icon className="w-3 h-3" />
            {Math.abs(deltaPct)}%
        </span>
    );
}

export interface KpiItem {
    label: string;
    value: string;
    deltaPct?: number | null;
    sub?: string;
    invertDelta?: boolean;
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 md:gap-4">
            {items.map((item) => (
                <Card key={item.label} className="bg-card border-border">
                    <CardContent className="p-4 space-y-1.5">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-xl font-semibold tracking-tight">{item.value}</p>
                        <div className="flex items-center gap-2">
                            {item.deltaPct !== undefined && <DeltaBadge deltaPct={item.deltaPct} invert={item.invertDelta} />}
                            {item.sub && <span className="text-xs text-muted-foreground truncate">{item.sub}</span>}
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
    return (
        <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Inbox className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">{title}</p>
                {hint && <p className="text-xs text-muted-foreground max-w-sm">{hint}</p>}
            </CardContent>
        </Card>
    );
}

/** Sortable table with CSV export; rows are plain records (index signature). */
export interface AnalyticsTableColumn<R> {
    key: string;
    header: string;
    align?: 'left' | 'right';
    render?: (row: R) => React.ReactNode;
    /** raw value for sorting/export */
    value?: (row: R) => string | number | null;
}

export function AnalyticsTable<R extends Record<string, unknown>>({
    title,
    rows,
    columns,
    exportName,
    initialSortKey,
    emptyTitle = "No data for this range",
    emptyHint,
    maxHeight = 'max-h-[420px]',
}: {
    title: string;
    rows: R[];
    columns: AnalyticsTableColumn<R>[];
    exportName: string;
    initialSortKey?: string;
    emptyTitle?: string;
    emptyHint?: string;
    maxHeight?: string;
}) {
    const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
    const [sortDesc, setSortDesc] = useState(true);

    const sorted = useMemo(() => {
        if (!sortKey) return rows;
        const col = columns.find((c) => c.key === sortKey);
        if (!col) return rows;
        const val = (r: R) => {
            const v = col.value ? col.value(r) : (r[sortKey] as string | number | null | undefined);
            return typeof v === 'number' ? v : Number(v) || 0;
        };
        return [...rows].sort((a, b) => (sortDesc ? val(b) - val(a) : val(a) - val(b)));
    }, [rows, sortKey, sortDesc, columns]);

    const csvRows = useMemo(
        () =>
            sorted.map((row) => {
                const obj: Record<string, unknown> = {};
                for (const col of columns) {
                    obj[col.header] = col.value ? col.value(row) : row[col.key];
                }
                return obj;
            }),
        [sorted, columns]
    );

    if (rows.length === 0) {
        return <EmptyState title={emptyTitle} hint={emptyHint} />;
    }

    return (
        <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-semibold">{title}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => exportToCSV(csvRows, exportName)}>
                    <Download className="w-4 h-4 mr-1.5" /> CSV
                </Button>
            </CardHeader>
            <CardContent className={cn("overflow-auto", maxHeight)}>
                <Table>
                    <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                            {columns.map((col) => (
                                <TableHead
                                    key={col.key}
                                    className={cn(col.align === 'right' && 'text-right', 'cursor-pointer select-none hover:text-primary')}
                                    onClick={() => {
                                        if (sortKey === col.key) setSortDesc((d) => !d);
                                        else {
                                            setSortKey(col.key);
                                            setSortDesc(true);
                                        }
                                    }}
                                >
                                    {col.header}
                                    {sortKey === col.key && (sortDesc ? ' ↓' : ' ↑')}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sorted.map((row, i) => (
                            <TableRow key={String(row.id ?? row.key ?? i)}>
                                {columns.map((col) => (
                                    <TableCell key={col.key} className={cn(col.align === 'right' && 'text-right')}>
                                        {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

/** Format a possibly-null metric as an em dash (undefined ≠ zero). */
export function fmtMetric(value: number | null | undefined, fmt: (v: number) => string): string {
    return value === null || value === undefined ? '—' : fmt(value);
}
