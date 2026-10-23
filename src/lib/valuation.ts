/**
 * Landed-cost allocation for inventory valuation.
 *
 * Stock was valued at the bare purchase price, so freight, duty and other
 * receipt overheads never reached the balance sheet. This module spreads a
 * receipt's overhead across its lines by value, in paise, with the rounding
 * remainder forced onto the last line so the allocated total always equals the
 * overhead exactly.
 */

export interface ValuationLine {
    /** Variant id or any stable key the caller wants back. */
    key: string;
    quantity: number;
    unitCost: number;
}

export interface LandedLine extends ValuationLine {
    allocatedOverhead: number;
    landedUnitCost: number;
}

function toPaise(value: number): number {
    return Math.round((Number(value) || 0) * 100);
}

function fromPaise(value: number): number {
    return Math.round(value) / 100;
}

/**
 * Allocate `overhead` across lines proportionally to line value.
 * Lines with no quantity receive nothing. A non-positive overhead returns the
 * unit costs unchanged, which is the correct behaviour for a discount that
 * fully offsets the charges.
 */
export function allocateLandedCosts(lines: ValuationLine[], overhead: number): LandedLine[] {
    const safeLines = lines.map((line) => ({
        key: line.key,
        quantity: Math.max(0, Number(line.quantity) || 0),
        unitCost: Math.max(0, Number(line.unitCost) || 0),
    }));

    const overheadPaise = Math.max(0, toPaise(overhead));
    if (overheadPaise === 0) {
        return safeLines.map((line) => ({
            ...line,
            allocatedOverhead: 0,
            landedUnitCost: line.unitCost,
        }));
    }

    const lineValuePaise = safeLines.map((line) => toPaise(line.unitCost) * line.quantity);
    const totalValuePaise = lineValuePaise.reduce((sum, value) => sum + value, 0);

    // With no monetary basis, spread by quantity; with neither, spread evenly
    // over the lines that have a quantity, and leave the rest untouched.
    const activeIndexes = safeLines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.quantity > 0)
        .map(({ index }) => index);

    const allocated = new Array<number>(safeLines.length).fill(0);

    if (activeIndexes.length === 0) {
        return safeLines.map((line) => ({ ...line, allocatedOverhead: 0, landedUnitCost: line.unitCost }));
    }

    if (totalValuePaise > 0) {
        let assigned = 0;
        activeIndexes.forEach((index, position) => {
            if (position === activeIndexes.length - 1) {
                allocated[index] = overheadPaise - assigned;
            } else {
                const share = Math.floor((overheadPaise * lineValuePaise[index]) / totalValuePaise);
                allocated[index] = share;
                assigned += share;
            }
        });
    } else {
        const base = Math.floor(overheadPaise / activeIndexes.length);
        let assigned = 0;
        activeIndexes.forEach((index, position) => {
            if (position === activeIndexes.length - 1) {
                allocated[index] = overheadPaise - assigned;
            } else {
                allocated[index] = base;
                assigned += base;
            }
        });
    }

    return safeLines.map((line, index) => {
        const overheadForLine = allocated[index] || 0;
        const landedUnitCost = line.quantity > 0
            ? fromPaise(toPaise(line.unitCost) + Math.round(overheadForLine / line.quantity))
            : line.unitCost;
        return {
            ...line,
            allocatedOverhead: fromPaise(overheadForLine),
            landedUnitCost,
        };
    });
}

export interface LandedSummary {
    totalUnits: number;
    goodsValue: number;
    landedValue: number;
    allocatedOverhead: number;
}

export function summariseLanded(lines: LandedLine[]): LandedSummary {
    return lines.reduce<LandedSummary>((summary, line) => {
        summary.totalUnits += line.quantity;
        summary.goodsValue += line.quantity * line.unitCost;
        summary.landedValue += line.quantity * line.landedUnitCost;
        summary.allocatedOverhead += line.allocatedOverhead;
        return summary;
    }, { totalUnits: 0, goodsValue: 0, landedValue: 0, allocatedOverhead: 0 });
}
