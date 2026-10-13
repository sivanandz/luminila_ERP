/**
 * Jewelry Calculation & Verification Engine
 * Reverse-engineered from jewelry ERP standards & Vyapar Gold/Jewellery logic.
 * 
 * Features:
 * - Legal Metrology 3-decimal gram precision (0.001g)
 * - Carat to Gram stone weight normalization (1 ct = 0.20g)
 * - Net Weight = Gross Weight - Stone Weight
 * - Wastage (Tunch / Melting Loss) weight adjustments
 * - Flexible Making Charges: 'per_gram', 'percent', or 'fixed'
 * - Bureau of Indian Standards (BIS) 6-digit HUID validation
 * - Standardized specification formatting for Invoices & Thermal Receipts
 */

export type PurityCode =
    | '24K'
    | '22K'
    | '18K'
    | '14K'
    | '9K'
    | 'SILVER_999'
    | 'SILVER_925'
    | 'PLATINUM_950'
    | 'FASHION_ALLOY'
    | (string & {});

export interface PurityDefinition {
    code: string;
    label: string;
    purityPercentage: number;
    metalType: 'gold' | 'silver' | 'platinum' | 'imitation' | 'other';
}

export const JEWELRY_PURITIES: Record<string, PurityDefinition> = {
    '24K': {
        code: '24K',
        label: '24K (999 Pure Gold)',
        purityPercentage: 99.9,
        metalType: 'gold',
    },
    '22K': {
        code: '22K',
        label: '22K (916 BIS Hallmark)',
        purityPercentage: 91.6,
        metalType: 'gold',
    },
    '18K': {
        code: '18K',
        label: '18K (750 BIS Hallmark)',
        purityPercentage: 75.0,
        metalType: 'gold',
    },
    '14K': {
        code: '14K',
        label: '14K (585 BIS Hallmark)',
        purityPercentage: 58.5,
        metalType: 'gold',
    },
    '9K': {
        code: '9K',
        label: '9K (375 Fine Gold)',
        purityPercentage: 37.5,
        metalType: 'gold',
    },
    'SILVER_999': {
        code: 'SILVER_999',
        label: '999 Fine Silver',
        purityPercentage: 99.9,
        metalType: 'silver',
    },
    'SILVER_925': {
        code: 'SILVER_925',
        label: '925 Sterling Silver',
        purityPercentage: 92.5,
        metalType: 'silver',
    },
    'PLATINUM_950': {
        code: 'PLATINUM_950',
        label: '950 Platinum',
        purityPercentage: 95.0,
        metalType: 'platinum',
    },
    'FASHION_ALLOY': {
        code: 'FASHION_ALLOY',
        label: 'Fashion / Brass Alloy',
        purityPercentage: 100.0,
        metalType: 'imitation',
    },
};

/**
 * Rounds a number to a specific number of decimal places with floating point safety
 */
export function roundDecimal(num: number, decimals: number = 3): number {
    const factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
}

export const roundGrams = (w: number): number => roundDecimal(w, 3);

/**
 * Normalizes stone weight to grams (1 Carat = 0.20 Grams)
 */
export function stoneWeightToGrams(weight: number, unit: 'grams' | 'carats' = 'grams'): number {
    if (!weight || weight < 0) return 0;
    return unit === 'carats' ? roundDecimal(weight * 0.2, 3) : roundDecimal(weight, 3);
}

/**
 * Computes net weight with strict non-negative clamping and 3-decimal precision
 */
export function calculateNetWeight(
    grossWeight: number,
    stoneWeight: number = 0,
    stoneWeightUnit: 'grams' | 'carats' = 'grams'
): number {
    const gross = Math.max(0, Number(grossWeight) || 0);
    const stoneGrams = stoneWeightToGrams(stoneWeight, stoneWeightUnit);
    return Math.max(0, roundDecimal(gross - stoneGrams, 3));
}

export type MakingChargesType = 'per_gram' | 'percent' | 'fixed';

export interface JewelryPricingInput {
    grossWeight: number;
    stoneWeight?: number;
    stoneWeightUnit?: 'grams' | 'carats';
    stoneAmount?: number;
    spotRatePerGram?: number;
    wastagePercent?: number;
    makingCharges?: number;
    makingChargesType?: MakingChargesType;
    fixedPiecePrice?: number;
}

export interface JewelryPricingBreakdown {
    grossWeight: number;
    netWeight: number;
    stoneWeightGrams: number;
    effectiveWastageWeight: number;
    metalAmount: number;
    makingChargesAmount: number;
    stoneAmount: number;
    taxableSubtotal: number;
}

/**
 * Calculates item pricing based on weight, wastage, making charges, and stone costs
 */
export function calculateJewelryPrice(input: JewelryPricingInput): JewelryPricingBreakdown {
    const grossWeight = Math.max(0, roundDecimal(input.grossWeight || 0, 3));
    const stoneWeightGrams = stoneWeightToGrams(input.stoneWeight || 0, input.stoneWeightUnit || 'grams');
    const netWeight = calculateNetWeight(grossWeight, input.stoneWeight || 0, input.stoneWeightUnit || 'grams');

    const wastagePercent = Math.max(0, Number(input.wastagePercent) || 0);
    const wastageGrams = roundDecimal(netWeight * (wastagePercent / 100), 3);
    const effectiveWastageWeight = roundDecimal(netWeight + wastageGrams, 3);

    const spotRate = Math.max(0, Number(input.spotRatePerGram) || 0);
    const metalAmount = roundDecimal(effectiveWastageWeight * spotRate, 2);

    const makingRate = Math.max(0, Number(input.makingCharges) || 0);
    const makingType = input.makingChargesType || 'per_gram';

    let makingChargesAmount = 0;
    if (makingType === 'per_gram') {
        makingChargesAmount = roundDecimal(grossWeight * makingRate, 2);
    } else if (makingType === 'percent') {
        makingChargesAmount = roundDecimal(metalAmount * (makingRate / 100), 2);
    } else if (makingType === 'fixed') {
        makingChargesAmount = roundDecimal(makingRate, 2);
    }

    const stoneAmount = Math.max(0, roundDecimal(input.stoneAmount || 0, 2));

    let taxableSubtotal = 0;
    if (metalAmount > 0 || makingChargesAmount > 0 || stoneAmount > 0) {
        taxableSubtotal = roundDecimal(metalAmount + makingChargesAmount + stoneAmount, 2);
    } else {
        // Fallback to fixed piece rate for fashion jewelry
        taxableSubtotal = Math.max(0, roundDecimal(input.fixedPiecePrice || 0, 2));
    }

    return {
        grossWeight,
        netWeight,
        stoneWeightGrams,
        effectiveWastageWeight,
        metalAmount,
        makingChargesAmount,
        stoneAmount,
        taxableSubtotal,
    };
}

/**
 * Validates Bureau of Indian Standards (BIS) 6-character alphanumeric HUID format
 * Standard: 6 alphanumeric characters, strictly uppercase, e.g. 'AB1234'
 */
export function isValidHUID(code?: string): boolean {
    if (!code) return false;
    const sanitized = code.trim().toUpperCase();
    return /^[A-Z0-9]{6}$/.test(sanitized);
}

export const validateHUID = isValidHUID;

/**
 * Formats a clean single-line jewelry specification string for invoices and POS tags
 */
export function formatJewelrySpecs(item: {
    purity_karat?: string;
    gross_weight?: number;
    net_weight?: number;
    stone_weight?: number;
    making_charges?: number;
    making_charges_type?: string;
    huid_code?: string;
}): string {
    const parts: string[] = [];

    if (item.purity_karat) {
        const purityDef = JEWELRY_PURITIES[item.purity_karat];
        parts.push(purityDef ? purityDef.label : item.purity_karat);
    }

    if (item.gross_weight && item.gross_weight > 0) {
        parts.push(`Gr: ${roundDecimal(item.gross_weight, 3)}g`);
    }

    if (item.net_weight && item.net_weight > 0) {
        parts.push(`Nt: ${roundDecimal(item.net_weight, 3)}g`);
    }

    if (item.stone_weight && item.stone_weight > 0) {
        parts.push(`St: ${roundDecimal(item.stone_weight, 3)}g`);
    }

    if (item.making_charges && item.making_charges > 0) {
        const typeSymbol = item.making_charges_type === 'percent' ? '%' : (item.making_charges_type === 'fixed' ? ' (fixed)' : '/g');
        parts.push(`MC: ₹${item.making_charges}${typeSymbol}`);
    }

    if (item.huid_code) {
        parts.push(`HUID: ${item.huid_code.trim().toUpperCase()}`);
    }

    return parts.join(' | ');
}
