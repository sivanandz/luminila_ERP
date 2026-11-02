"use client";

/**
 * Insights tab: ranked, actionable findings from the rule engine
 * (src/lib/analytics-v2/insights.ts). Severity-ranked; ₹ impact where the
 * data supports one; deep-links into the owning tab.
 */

import { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, Info, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAnalyticsRange } from "@/lib/analytics-v2/range-store";
import { getTurnoverAnalytics, type TurnoverAnalytics } from "@/lib/analytics-v2/turnover";
import { getProfitabilityAnalytics, type ProfitabilityAnalytics } from "@/lib/analytics-v2/profitability";
import { getSalesAnalytics, type SalesAnalytics } from "@/lib/analytics-v2/sales-metrics";
import { buildInsights, type InsightCard } from "@/lib/analytics-v2/insights";
import { EmptyState } from "./shared";
import { LoadingBlock } from "./SalesTab";

const SEVERITY_STYLE: Record<InsightCard["severity"], { icon: React.ReactNode; badgeClass: string; label: string }> = {
    high: { icon: <AlertOctagon className="w-5 h-5 text-red-400" />, badgeClass: "bg-red-500/15 text-red-400 border-red-500/30", label: "High" },
    medium: { icon: <AlertTriangle className="w-5 h-5 text-yellow-400" />, badgeClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", label: "Medium" },
    low: { icon: <Info className="w-5 h-5 text-sky-400" />, badgeClass: "bg-sky-500/15 text-sky-400 border-sky-500/30", label: "Info" },
};

const TAB_HREF: Record<InsightCard["targetTab"], string> = {
    inventory: "?tab=inventory",
    profitability: "?tab=profitability",
    sales: "?tab=sales",
    categories: "?tab=categories",
};

export function InsightsTab() {
    const range = useAnalyticsRange((s) => s.range);
    const router = useRouter();
    const [cards, setCards] = useState<InsightCard[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const [turnover, profitability, sales] = await Promise.all([
                    getTurnoverAnalytics(range),
                    getProfitabilityAnalytics(range),
                    getSalesAnalytics(range),
                ]);
                if (cancelled) return;
                setCards(await buildInsights(turnover as TurnoverAnalytics, profitability as ProfitabilityAnalytics, sales as SalesAnalytics));
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to build insights');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [range]);

    if (loading) return <LoadingBlock />;
    if (error) return <EmptyState title="Insights unavailable" hint={error} />;

    if (!cards || cards.length === 0) {
        return (
            <EmptyState
                title="No findings for this range"
                hint="Either the business is running clean this window, or there isn't enough data yet. Widen the range to look further back."
            />
        );
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                {cards.length} finding(s), ranked by severity then ₹ impact. Every card is derived from this window&apos;s data — nothing is hard-coded.
            </p>
            {cards.map((card) => {
                const style = SEVERITY_STYLE[card.severity];
                return (
                    <Card key={card.id} className="bg-card border-border">
                        <CardContent className="flex items-start gap-3 py-4">
                            <div className="mt-0.5">{style.icon}</div>
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className={style.badgeClass}>{style.label}</Badge>
                                    {card.impactINR > 0 && (
                                        <span className="text-xs font-semibold text-foreground">₹{Math.round(card.impactINR).toLocaleString("en-IN")} impact</span>
                                    )}
                                </div>
                                <p className="text-sm font-semibold leading-snug">{card.title}</p>
                                <p className="text-xs text-muted-foreground leading-relaxed">{card.detail}</p>
                                <p className="text-xs text-primary/90">{card.actionHint}</p>
                            </div>
                            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => router.push(`/analytics${TAB_HREF[card.targetTab]}`)}>
                                Review <ArrowRight className="w-3.5 h-3.5 ml-1" />
                            </Button>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
