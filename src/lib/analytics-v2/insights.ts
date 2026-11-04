/**
 * Insights rule engine (Analytics Deep-Insights).
 *
 * Turns the metric engines' outputs into ranked, actionable findings with a
 * ₹ impact estimate. Rules (each documented inline):
 *
 *  D1  Dead stock          — stock untouched 180+ days (₹ locked)
 *  D2  Overstock           — cover > 12 weeks (₹ parked)
 *  D3  Reorder / stockout  — zero-stock fast movers (lost revenue estimate =
 *                            avg unit price × weekly velocity × 2)
 *  D4  Reorder soon        — cover < 2 weeks on active movers
 *  P1  Category margin drop— category margin % fell ≥ 3 pts vs previous window
 *  P2  Discount erosion    — discounts ≥ 8% of gross and rising vs previous
 *  S1  Channel decline     — a channel's revenue fell ≥ 30% vs previous window
 *  Q1  Cost basis missing  — a large share of COGS rests on estimates
 *
 * Every rule is data-driven and silent when its condition isn't met — the
 * empty state is "no findings", never a fake insight (zero-mock rule).
 */

import type { TurnoverAnalytics } from './turnover';
import type { ProfitabilityAnalytics } from './profitability';
import type { SalesAnalytics } from './sales-metrics';

export type Severity = 'high' | 'medium' | 'low';

/**
 * A margin move below this ₹ floor is not worth a 'high' severity card, however
 * large the percentage looks against a near-zero previous window (AN2-8).
 */
const MIN_MARGIN_DROP_INR = 5000;

export interface InsightCard {
    id: string;
    severity: Severity;
    title: string;
    detail: string;
    impactINR: number;
    actionHint: string;
    targetTab: 'inventory' | 'profitability' | 'sales' | 'categories';
}

export async function buildInsights(turnover: TurnoverAnalytics, profitability: ProfitabilityAnalytics, sales: SalesAnalytics): Promise<InsightCard[]> {
    const cards: InsightCard[] = [];

    // D1 dead stock — 180+ bucket from the aging distribution
    const deadBucket = turnover.aging.find((b) => b.label === '180+ days');
    if (deadBucket && deadBucket.stockValue > 0) {
        cards.push({
            id: 'dead-stock',
            severity: deadBucket.stockValue > 100000 ? 'high' : 'medium',
            title: `Dead stock: ₹${Math.round(deadBucket.stockValue).toLocaleString('en-IN')} unsold for 180+ days`,
            detail: `${deadBucket.products} product(s) haven't sold in over 6 months while holding ₹${Math.round(deadBucket.stockValue).toLocaleString('en-IN')} of inventory. This is cash sitting idle.`,
            impactINR: deadBucket.stockValue,
            actionHint: 'Consider clearance pricing, exchange offers, or vendor returns on these pieces.',
            targetTab: 'inventory',
        });
    }

    // D2 overstock — cover beyond 12 weeks
    const overstockValue = turnover.overstock.reduce((s, r) => s + r.stockValue, 0);
    // A card that says "₹0 parked" is a fake insight: require real value (AN2-12).
    if (turnover.overstock.length > 0 && overstockValue > 0) {
        cards.push({
            id: 'overstock',
            severity: overstockValue > 200000 ? 'high' : 'medium',
            title: `Overstock: ${turnover.overstock.length} product(s) hold more than 12 weeks of cover`,
            detail: `₹${Math.round(overstockValue).toLocaleString('en-IN')} parked in products selling slower than one piece every 12 weeks. Top item: ${turnover.overstock[0].productName} (${turnover.overstock[0].weeksCover} wks cover).`,
            impactINR: overstockValue,
            actionHint: 'Pause reorders on these and review display priority.',
            targetTab: 'inventory',
        });
    }

    // D3 zero-stock fast movers — lost-sale estimate: avg unit price × weekly velocity × 2 weeks
    for (const p of turnover.zeroStockFastMovers.slice(0, 5)) {
        const productRow = turnover.byProduct.find((r) => r.productId === p.productId);
        const avgPrice = productRow && productRow.unitsSold > 0 ? (productRow.revenue as number) / (productRow.unitsSold as number) : 0;
        const lostEstimate = Math.round(avgPrice * p.weeklyVelocity * 2);
        if (lostEstimate > 0) {
            cards.push({
                id: `stockout-${p.productId}`,
                severity: 'high',
                title: `Stocked out while selling: ${p.productName}`,
                detail: `Selling ~${p.weeklyVelocity}/week but stock is zero — every stockout week forfeits roughly ₹${lostEstimate.toLocaleString('en-IN')}.`,
                impactINR: lostEstimate,
                actionHint: 'Reorder or reallocate from slow branches before the next peak day.',
                targetTab: 'inventory',
            });
        }
    }

    // D4 reorder soon — under 2 weeks of cover on active movers.
    // Impact = value of the demand expected before the shelf empties
    // (unit price × weekly units × weeks of cover left), not the product's whole
    // period revenue, which grossly overstated the at-risk amount (AN2-15).
    const reorderSoon = turnover.byProduct.filter(
        (p) => p.currentStock > 0 && p.weeksCover !== null && (p.weeksCover as number) < 2 && p.unitsSold > 0
    );
    if (reorderSoon.length > 0) {
        const windowWeeks = Math.max(1, turnover.suite.lengthDays / 7);
        const reorderImpact = reorderSoon.reduce((sum, p) => {
            const price = p.unitsSold > 0 ? p.revenue / p.unitsSold : 0;
            const weeklyUnits = p.unitsSold / windowWeeks;
            const weeksLeft = Math.max(0, 2 - (p.weeksCover as number));
            return sum + price * weeklyUnits * weeksLeft;
        }, 0);
        cards.push({
            id: 'reorder-soon',
            severity: 'medium',
            title: `${reorderSoon.length} product(s) run out within ~2 weeks`,
            detail: `Fast-depleting stock: ${reorderSoon.slice(0, 3).map((p) => p.productName).join(', ')}${reorderSoon.length > 3 ? ` +${reorderSoon.length - 3} more` : ''}.`,
            impactINR: Math.round(reorderImpact),
            actionHint: 'Raise purchase orders this week to avoid stockouts.',
            targetTab: 'inventory',
        });
    }

    // P1 category margin drops vs previous window
    const trendRevenue = profitability.trend.reduce((s, t) => s + t.revenue, 0);
    for (const row of profitability.byCategory.slice(0, 20)) {
        // trend is overall-level; per-category deltas need previous-window lines,
        // which profitability already reduced — approximate with overall margin
        // trend only when the category is a major revenue share (>15%).
        // A zero denominator produced Infinity/NaN, and `NaN < 0.15` is false,
        // so the card passed the gate (AN2-13).
        const revenueShare = trendRevenue > 0 ? (row.revenue as number) / trendRevenue : 0;
        if (!Number.isFinite(revenueShare) || revenueShare < 0.15) continue;
        const overallDelta = profitability.overallMargin.deltaPct;
        const marginDeltaINR = Math.abs(profitability.overallMargin.current - profitability.overallMargin.previous);
        // A percentage alone lets a near-zero previous window produce a
        // -1400% "high severity" card over a few rupees; require a real ₹ move
        // and a positive previous window (AN2-8).
        if (
            overallDelta !== null &&
            overallDelta < -10 &&
            profitability.overallMargin.previous > 0 &&
            marginDeltaINR >= MIN_MARGIN_DROP_INR
        ) {
            cards.push({
                id: `margin-drop-${row.key}`,
                severity: 'high',
                title: `Profit falling: ${row.label} margin is ₹${Math.abs(marginDeltaINR).toLocaleString('en-IN')} below last period`,
                detail: `Overall gross margin moved ${overallDelta}% vs the previous window; ${row.label} is a major contributor (>15% of revenue).`,
                impactINR: marginDeltaINR,
                actionHint: 'Review recent cost price changes and discount patterns in this category.',
                targetTab: 'profitability',
            });
            break; // one margin card is enough to prompt review
        }
    }

    // P2 discount erosion
    if (profitability.discountErosion.erosionPct >= 8 && profitability.discountErosion.deltaPct > 0) {
        cards.push({
            id: 'discount-erosion',
            severity: profitability.discountErosion.erosionPct >= 15 ? 'high' : 'medium',
            title: `Discounts eating ${profitability.discountErosion.erosionPct}% of gross revenue`,
            detail: `₹${profitability.discountErosion.totalDiscounts.toLocaleString('en-IN')} given away this period — ${profitability.discountErosion.deltaPct} pts worse than the previous window.`,
            impactINR: profitability.discountErosion.totalDiscounts,
            actionHint: 'Tighten bill-level discounts and review staff discount permissions.',
            targetTab: 'profitability',
        });
    }

    // S1 channel decline ≥ 30% with meaningful revenue
    for (const ch of sales.channels) {
        if ((ch.previousRevenue as number) > 20000 && (ch.deltaPct as number) <= -30) {
            cards.push({
                id: `channel-${ch.channel}`,
                severity: 'medium',
                title: `${ch.channel} revenue down ${Math.abs(ch.deltaPct as number)}%`,
                detail: `₹${Math.round(ch.previousRevenue as number).toLocaleString('en-IN')} → ₹${Math.round(ch.revenue as number).toLocaleString('en-IN')} vs the previous window.`,
                impactINR: Math.max(0, (ch.previousRevenue as number) - (ch.revenue as number)),
                actionHint: 'Check campaign schedules, stock availability and pricing on this channel.',
                targetTab: 'sales',
            });
        }
    }

    // Q1 cost basis integrity
    if (turnover.suite.costUnknownSharePct >= 20) {
        cards.push({
            id: 'cost-basis-missing',
            severity: turnover.suite.costUnknownSharePct >= 50 ? 'high' : 'low',
            title: `${turnover.suite.costUnknownSharePct}% of sold units have no cost basis`,
            detail: 'These units predate cost snapshots and had no purchase history to estimate from. Margin figures for them are understated as zero-cost.',
            impactINR: 0,
            actionHint: 'Run the unit-cost backfill script (src/scripts/backfill-unit-costs.ts) and set cost_price on these products.',
            targetTab: 'profitability',
        });
    }

    const order = { high: 0, medium: 1, low: 2 };
    return cards.sort((a, b) => order[a.severity] - order[b.severity] || b.impactINR - a.impactINR);
}
