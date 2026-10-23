/**
 * Invoice and cart tax arithmetic.
 *
 * One place decides how a rupee becomes a taxable value, two tax halves, and a
 * total. POS prices are tax-inclusive because the cashier collects the number
 * the customer was quoted; order and B2B prices are tax-exclusive because the
 * invoice is raised before payment. Both paths funnel through this module so
 * they can never disagree about rounding or the tax base.
 *
 * Everything is computed in integer paise. Floating point rupees are only used
 * at the boundary (input and output), which is where the old code leaked
 * paise-sized inconsistencies between line items and invoice headers.
 */

export interface TaxLineInput {
    /** Line amount in paise, before any order-level discount. */
    grossPaise: number;
    /** GST percentage for the line, for example 3 or 18. */
    gstRate: number;
    /** Compensation cess percentage, normally 0. */
    cessRate?: number;
}

export interface TaxLineResult {
    gstRate: number;
    cessRate: number;
    /** Taxable value in paise, net of tax. */
    taxablePaise: number;
    cgstRate: number;
    cgstPaise: number;
    sgstRate: number;
    sgstPaise: number;
    igstRate: number;
    igstPaise: number;
    cessPaise: number;
    /** Total tax in paise. taxablePaise + taxPaise === totalPaise. */
    taxPaise: number;
    /** Line total in paise. */
    totalPaise: number;
    isInterState: boolean;
}

export interface TaxedLine extends TaxLineResult {
    /** Discount share allocated to this line in paise. */
    discountPaise: number;
    /** Gross before discount in paise. */
    grossPaise: number;
}

/** Convert rupees to integer paise without accumulating float error. */
export function toPaise(value: number | null | undefined): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
}

/** Convert integer paise back to rupees, rounded to two decimals. */
export function toRupees(paise: number): number {
    return Math.round(paise) / 100;
}

/**
 * Allocate an order-level discount across lines in proportion to their gross
 * value, using the largest-remainder method so the shares add up to exactly the
 * discount requested. Allocating in paise is what keeps the sum of discounted
 * lines equal to the amount the customer actually paid.
 */
export function allocateDiscountPaise(grosses: number[], discountPaise: number): number[] {
    const total = grosses.reduce((sum, g) => sum + Math.max(0, g), 0);
    const discount = Math.min(Math.max(0, Math.round(discountPaise)), total);
    if (total <= 0 || discount <= 0) return grosses.map(() => 0);

    const exact = grosses.map((g) => (Math.max(0, g) * discount) / total);
    const shares = exact.map((v) => Math.floor(v));
    let remainder = discount - shares.reduce((sum, v) => sum + v, 0);

    const order = exact
        .map((v, i) => ({ i, frac: v - shares[i] }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);

    let cursor = 0;
    while (remainder > 0 && order.length > 0) {
        const idx = order[cursor % order.length].i;
        if (shares[idx] < Math.max(0, grosses[idx])) {
            shares[idx] += 1;
            remainder -= 1;
        }
        cursor += 1;
    }
    return shares;
}

function splitIntoComponents(
    taxablePaise: number,
    baseTaxPaise: number,
    gstRate: number,
    cessPaise: number,
    cessRate: number,
    isInterState: boolean
): TaxLineResult {
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (isInterState) {
        igst = baseTaxPaise;
    } else {
        // Floor one half and give the remainder to the other so the two halves
        // always add back to the exact tax amount.
        cgst = Math.floor(baseTaxPaise / 2);
        sgst = baseTaxPaise - cgst;
    }
    return {
        gstRate,
        cessRate,
        taxablePaise,
        cgstRate: isInterState ? 0 : gstRate / 2,
        cgstPaise: cgst,
        sgstRate: isInterState ? 0 : gstRate / 2,
        sgstPaise: sgst,
        igstRate: isInterState ? gstRate : 0,
        igstPaise: igst,
        cessPaise,
        taxPaise: baseTaxPaise + cessPaise,
        totalPaise: taxablePaise + baseTaxPaise + cessPaise,
        isInterState,
    };
}

/**
 * Split a tax-inclusive amount into taxable value and tax.
 * Guarantees taxablePaise + taxPaise === totalPaise for every input.
 */
export function splitInclusiveLine(
    inclusivePaise: number,
    gstRate: number,
    sellerStateCode: string,
    buyerStateCode: string,
    cessRate: number = 0
): TaxLineResult {
    const total = Math.max(0, Math.round(inclusivePaise));
    const rate = Math.max(0, Number(gstRate) || 0);
    const cess = Math.max(0, Number(cessRate) || 0);
    const isInterState = Boolean(sellerStateCode) && Boolean(buyerStateCode) && sellerStateCode !== buyerStateCode;

    if (rate === 0 && cess === 0) {
        return splitIntoComponents(total, 0, 0, 0, 0, isInterState);
    }

    const taxable = Math.round((total * 100) / (100 + rate + cess));
    const cessPaise = cess > 0 ? Math.round((taxable * cess) / 100) : 0;
    const baseTax = Math.max(0, total - taxable - cessPaise);

    return splitIntoComponents(taxable, baseTax, rate, cessPaise, cess, isInterState);
}

/**
 * Apply GST on top of a tax-exclusive amount, as used by orders and B2B
 * invoices where prices are quoted before tax.
 */
export function splitExclusiveLine(
    taxablePaiseIn: number,
    gstRate: number,
    sellerStateCode: string,
    buyerStateCode: string,
    cessRate: number = 0
): TaxLineResult {
    const taxable = Math.max(0, Math.round(taxablePaiseIn));
    const rate = Math.max(0, Number(gstRate) || 0);
    const cess = Math.max(0, Number(cessRate) || 0);
    const isInterState = Boolean(sellerStateCode) && Boolean(buyerStateCode) && sellerStateCode !== buyerStateCode;

    const cessPaise = cess > 0 ? Math.round((taxable * cess) / 100) : 0;
    const baseTax = Math.round((taxable * rate) / 100);

    return splitIntoComponents(taxable, baseTax, rate, cessPaise, cess, isInterState);
}

/**
 * Discount a set of tax-inclusive lines and return per-line tax detail whose
 * totals add up exactly to the sum of the discounted amounts.
 */
export function computeInclusiveLines(
    lines: TaxLineInput[],
    discountPaise: number,
    sellerStateCode: string,
    buyerStateCode: string
): { lines: TaxedLine[]; taxablePaise: number; taxPaise: number; totalPaise: number; discountPaise: number } {
    const grosses = lines.map((l) => Math.max(0, Math.round(l.grossPaise)));
    const shares = allocateDiscountPaise(grosses, discountPaise);
    const out: TaxedLine[] = [];
    let taxable = 0;
    let tax = 0;
    let total = 0;

    lines.forEach((line, i) => {
        const netInclusive = grosses[i] - shares[i];
        const split = splitInclusiveLine(netInclusive, line.gstRate, sellerStateCode, buyerStateCode, line.cessRate ?? 0);
        out.push({ ...split, discountPaise: shares[i], grossPaise: grosses[i] });
        taxable += split.taxablePaise;
        tax += split.taxPaise;
        total += split.totalPaise;
    });

    return {
        lines: out,
        taxablePaise: taxable,
        taxPaise: tax,
        totalPaise: total,
        discountPaise: shares.reduce((s, v) => s + v, 0),
    };
}

/**
 * Tax-inclusive lines with no state split, for cart display.
 * Returns the tax already contained in the amount after discount.
 */
export function includedTaxPaise(lines: TaxLineInput[], discountPaise: number): number {
    return computeInclusiveLines(lines, discountPaise, '', '').taxPaise;
}

/**
 * Resolve the GST rate for a product line. Explicit per-line rates win, then
 * the product's configured rate, then the jewelry default. A store that is not
 * GST registered passes registered=false and gets zero.
 */
export function resolveLineGstRate(
    explicitRate: number | null | undefined,
    productRate: number | null | undefined,
    registered: boolean,
    fallbackRate: number
): number {
    if (!registered) return 0;
    if (typeof explicitRate === 'number' && explicitRate >= 0) return explicitRate;
    if (typeof productRate === 'number' && productRate >= 0) return productRate;
    return fallbackRate;
}
