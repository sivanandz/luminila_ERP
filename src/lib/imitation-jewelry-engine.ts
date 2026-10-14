/**
 * Fashion & Imitation Jewelry Craft Taxonomy Engine
 * Reverse-engineered from Vasy.ai Imitation Jewellery Software features.
 * 
 * Supports:
 * - High-SKU volume craft categorization (Kundan, Polki, American Diamond CZ, Temple, Meenakari, Filigree)
 * - Specialized plating finishes (1-Gram Micro Gold, Matte, Rhodium, Rose Gold, Oxidized Antique)
 * - Occasion & base metal taxonomy
 * - Multi-tier wholesale & reseller volume discount calculation
 * - Dumbbell & butterfly jewelry tag specification formatting
 */

export type ImitationCraft =
    | 'kundan'
    | 'polki'
    | 'american_diamond'
    | 'meenakari'
    | 'temple'
    | 'filigree'
    | 'beaded_monalisa'
    | 'plain';

export type PlatingType =
    | 'micro_gold_1gm'
    | 'matte_gold_24k'
    | 'rhodium_silver'
    | 'rose_gold'
    | 'oxidized_antique'
    | 'dual_tone';

export type OccasionType =
    | 'bridal'
    | 'festive'
    | 'partywear'
    | 'daily'
    | 'cocktail';

export type BaseMetalType =
    | 'brass'
    | 'copper'
    | 'zinc_alloy'
    | 'silver_925'
    | 'white_metal';

export interface ImitationSpecInput {
    craft?: ImitationCraft | string;
    plating?: PlatingType | string;
    occasion?: OccasionType | string;
    baseMetal?: BaseMetalType | string;
    stoneType?: string;
    sku?: string;
    name?: string;
    mrpPrice?: number;
}

export const CRAFT_DEFINITIONS: Record<string, { label: string; code: string }> = {
    kundan: { label: 'Kundan Jadau', code: 'KND' },
    polki: { label: 'Open Polki', code: 'PLK' },
    american_diamond: { label: 'American Diamond (CZ)', code: 'ADC' },
    meenakari: { label: 'Meenakari Enamel', code: 'MNK' },
    temple: { label: 'Temple Antique', code: 'TMP' },
    filigree: { label: 'Fine Filigree', code: 'FLG' },
    beaded_monalisa: { label: 'Monalisa Beaded', code: 'MNL' },
    plain: { label: 'Classic Plain', code: 'PLN' },
};

export const PLATING_DEFINITIONS: Record<string, { label: string; code: string; durabilityMonths: number }> = {
    micro_gold_1gm: { label: '1-Gram Micro Gold', code: '1MG', durabilityMonths: 18 },
    matte_gold_24k: { label: '24K Matte Gold', code: 'MTG', durabilityMonths: 12 },
    rhodium_silver: { label: 'Rhodium Silver', code: 'RHD', durabilityMonths: 24 },
    rose_gold: { label: 'Rose Gold', code: 'RSG', durabilityMonths: 12 },
    oxidized_antique: { label: 'Oxidized Antique', code: 'OXI', durabilityMonths: 36 },
    dual_tone: { label: 'Dual Tone Gold/Silver', code: 'DLT', durabilityMonths: 18 },
};

export const OCCASION_DEFINITIONS: Record<string, string> = {
    bridal: 'Bridal Trousseau',
    festive: 'Festive & Traditional',
    partywear: 'Party & Evening',
    daily: 'Daily Minimalist',
    cocktail: 'Cocktail Statement',
};

export const BASE_METAL_DEFINITIONS: Record<string, string> = {
    brass: 'Brass Alloy',
    copper: 'Pure Copper',
    zinc_alloy: 'Zinc Alloy',
    silver_925: '925 Sterling Silver',
    white_metal: 'White Metal',
};

/**
 * Generates standardized single-line specification for retail labels and tags
 */
export function formatImitationSpec(spec: ImitationSpecInput): string {
    const parts: string[] = [];

    if (spec.craft) {
        const cDef = CRAFT_DEFINITIONS[spec.craft];
        parts.push(cDef ? cDef.label : spec.craft);
    }
    if (spec.plating) {
        const pDef = PLATING_DEFINITIONS[spec.plating];
        parts.push(pDef ? pDef.label : spec.plating);
    }
    if (spec.baseMetal) {
        const mDef = BASE_METAL_DEFINITIONS[spec.baseMetal];
        parts.push(mDef ? mDef : spec.baseMetal);
    }
    if (spec.occasion) {
        const oDef = OCCASION_DEFINITIONS[spec.occasion];
        parts.push(oDef ? oDef : spec.occasion);
    }

    return parts.length > 0 ? parts.join(' | ') : 'Fashion Jewelry';
}

/**
 * Generates compact butterfly / dumbbell barcode tag payload for thermal printing
 */
export function generateDumbbellTagPayload(spec: ImitationSpecInput) {
    const craftCode = spec.craft && CRAFT_DEFINITIONS[spec.craft] ? CRAFT_DEFINITIONS[spec.craft].code : 'FSH';
    const platingCode = spec.plating && PLATING_DEFINITIONS[spec.plating] ? PLATING_DEFINITIONS[spec.plating].code : 'PLT';

    const wingA = {
        sku: spec.sku || 'SKU-0000',
        mrp: spec.mrpPrice ? `₹${spec.mrpPrice}` : '',
    };

    const wingB = {
        name: (spec.name || 'Imitation Jewellery').substring(0, 18),
        badge: `${craftCode}-${platingCode}`,
        category: spec.occasion ? (OCCASION_DEFINITIONS[spec.occasion] || spec.occasion).substring(0, 10) : '',
    };

    return {
        wingA,
        wingB,
        printableBadge: `${wingB.badge} | ${wingA.sku} | ${wingA.mrp}`,
    };
}

export interface WholesaleTierDiscount {
    minQuantity: number;
    maxQuantity?: number;
    discountPercent: number;
}

export const DEFAULT_WHOLESALE_TIERS: WholesaleTierDiscount[] = [
    { minQuantity: 1, maxQuantity: 9, discountPercent: 0 },
    { minQuantity: 10, maxQuantity: 24, discountPercent: 15 },
    { minQuantity: 25, maxQuantity: 49, discountPercent: 25 },
    { minQuantity: 50, discountPercent: 35 },
];

/**
 * Calculates volume-based wholesale & reseller pricing for fashion jewelry
 */
export function calculateWholesalePrice(
    basePrice: number,
    quantity: number,
    customTiers: WholesaleTierDiscount[] = DEFAULT_WHOLESALE_TIERS
): {
    unitPrice: number;
    totalAmount: number;
    discountPercentApplied: number;
    totalSavings: number;
} {
    const qty = Math.max(1, Math.floor(quantity));
    const base = Math.max(0, Number(basePrice) || 0);

    let discountPercent = 0;
    for (const tier of customTiers) {
        if (qty >= tier.minQuantity) {
            if (!tier.maxQuantity || qty <= tier.maxQuantity) {
                discountPercent = tier.discountPercent;
            }
        }
    }

    const unitPrice = Math.round((base * (1 - discountPercent / 100)) * 100) / 100;
    const totalAmount = Math.round((unitPrice * qty) * 100) / 100;
    const regularTotal = Math.round((base * qty) * 100) / 100;
    const totalSavings = Math.round((regularTotal - totalAmount) * 100) / 100;

    return {
        unitPrice,
        totalAmount,
        discountPercentApplied: discountPercent,
        totalSavings,
    };
}
