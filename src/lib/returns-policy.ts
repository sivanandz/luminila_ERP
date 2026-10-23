/**
 * Return quantity policy.
 *
 * A return is legal only up to what is left on the invoice line after every
 * previous non-cancelled return for that same line. Two visits against the same
 * invoice must not be able to credit more than was sold, which is what the old
 * per-form cap allowed.
 */

export interface ReturnableLine {
    invoiceItemId: string;
    description?: string;
    /** Quantity on the original invoice line. */
    ordered: number;
    /** Sum of quantities already returned on earlier, non-cancelled credit notes. */
    alreadyReturned: number;
    /** Quantity requested in this return. */
    requested: number;
}

export interface ReturnValidation {
    ok: boolean;
    errors: string[];
    /** Remaining returnable quantity per invoice item id. */
    remaining: Record<string, number>;
}

export function validateReturnQuantities(lines: ReturnableLine[]): ReturnValidation {
    const errors: string[] = [];
    const remaining: Record<string, number> = {};

    if (!lines.length) {
        errors.push('A return must contain at least one line.');
        return { ok: false, errors, remaining };
    }

    for (const line of lines) {
        const ordered = Number(line.ordered);
        const prior = Number(line.alreadyReturned) || 0;
        const requested = Number(line.requested);
        const left = Number.isFinite(ordered) ? Math.max(0, ordered - prior) : 0;
        remaining[line.invoiceItemId] = left;

        const label = line.description || line.invoiceItemId;

        if (!Number.isFinite(ordered) || ordered <= 0) {
            errors.push(`"${label}" does not belong to this invoice.`);
            continue;
        }
        if (prior < 0) {
            errors.push(`"${label}" has an invalid prior return quantity.`);
        }
        if (!Number.isFinite(requested) || requested <= 0) {
            errors.push(`"${label}": return quantity must be greater than zero.`);
            continue;
        }
        if (!Number.isInteger(requested)) {
            errors.push(`"${label}": return quantity must be a whole number.`);
        }
        if (prior > ordered) {
            errors.push(`"${label}": previous returns (${prior}) already exceed the invoiced quantity (${ordered}).`);
        }
        if (requested > left) {
            errors.push(`"${label}": only ${left} of ${ordered} remain returnable.`);
        }
    }

    return { ok: errors.length === 0, errors, remaining };
}
