/**
 * Order-level discount allocation (Analytics Deep-Insights, audits AN-04/AN-13).
 *
 * POS writes the bill discount on the SALE HEADER (sales.discount, pos-sales.ts)
 * with every item row's discount at 0, while sales_orders carry it as
 * discount_total. The header `revenue` is the post-tax/post-shipping total, so
 * reconstructing the discount as revenue − Σ line net computes the
 * tax+shipping gap instead — that gate was inverted and POS bill discounts
 * were never allocated (per-product/category margins overstated, audit AN-04).
 *
 * The allocation scales off the UNALLOCATED part of the STORED discount: B2B
 * order headers repeat the sum of their line discounts, so subtracting the
 * full header discount a second time understated margin (H-20). Each line's
 * net revenue is multiplied by (Σ line net − unallocated) / Σ line net,
 * clamped so a discount larger than the line sum drives lines to zero.
 *
 * Shared by the Profitability engine and the turnover suite margin so the two
 * tabs report the same margin for the same window (audit AN-13).
 */

import type { UnifiedLine, UnifiedTx } from './load';

/**
 * Pure: allocate each transaction's header-level discount pro-rata across its
 * lines by net revenue; returns the adjusted net revenue per line.
 *
 * O(n): txs and per-tx line sums are indexed in Maps — the previous
 * implementation did a `txs.find()` per line (audit AN-21 residual).
 */
export function adjustedLineRevenues(lines: UnifiedLine[], txs: UnifiedTx[]): Map<UnifiedLine, number> {
    const lineNetByTx = new Map<string, number>();
    const lineDiscountByTx = new Map<string, number>();
    const txById = new Map(txs.map((t) => [t.id, t]));
    for (const l of lines) {
        lineNetByTx.set(l.txId, (lineNetByTx.get(l.txId) || 0) + l.netRevenue);
        lineDiscountByTx.set(l.txId, (lineDiscountByTx.get(l.txId) || 0) + l.lineDiscount);
    }

    const adjusted = new Map<UnifiedLine, number>();
    for (const l of lines) {
        const tx = txById.get(l.txId);
        const lineNetSum = lineNetByTx.get(l.txId) || 0;
        // B2B order headers repeat their line discounts; only a coupon/bill
        // discount that is NOT already on a line still needs allocating.
        const unallocated = tx
            ? Math.max(0, tx.discount - (lineDiscountByTx.get(l.txId) || 0))
            : 0;
        // Lines of transactions missing from the canonical set are untouched.
        const scale =
            unallocated > 0 && lineNetSum > 0
                ? Math.max(0, (lineNetSum - Math.min(unallocated, lineNetSum)) / lineNetSum)
                : 1;
        adjusted.set(l, l.netRevenue * scale);
    }
    return adjusted;
}
