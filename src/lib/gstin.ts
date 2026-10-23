/**
 * GSTIN validation, including the official check digit.
 *
 * The app validated shape only (15 characters, state code, PAN pattern), so a
 * mistyped GSTIN with a valid-looking structure was accepted and printed on
 * invoices. The fifteenth character is a mod-36 check digit; this module
 * computes it.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function charValue(char: string): number {
    return ALPHABET.indexOf(char.toUpperCase());
}

/**
 * Check digit for the first 14 characters, per the GSTN algorithm:
 * multiply by 1,2 alternately, sum quotient and remainder of each product
 * divided by 36, then take (36 - sum % 36) % 36.
 */
export function gstinCheckDigit(first14: string): string | null {
    const value = (first14 || '').toUpperCase().trim();
    if (value.length !== 14) return null;
    if ([...value].some((char) => charValue(char) < 0)) return null;

    let sum = 0;
    for (let i = 0; i < value.length; i += 1) {
        const product = charValue(value[i]) * (i % 2 === 0 ? 1 : 2);
        sum += Math.floor(product / 36) + (product % 36);
    }

    const remainder = sum % 36;
    const checkValue = (36 - remainder) % 36;
    return ALPHABET[checkValue];
}

/** True only when shape and check digit both pass. */
export function isValidGstin(gstin?: string): boolean {
    const value = (gstin || '').toUpperCase().trim();
    if (value.length !== 15 || !SHAPE.test(value)) return false;
    return gstinCheckDigit(value.slice(0, 14)) === value[14];
}

/** Two-digit state code, or empty when the value is not a GSTIN shape. */
export function gstinStateCode(gstin?: string): string {
    const value = (gstin || '').trim();
    return /^\d{2}/.test(value) ? value.slice(0, 2) : '';
}
