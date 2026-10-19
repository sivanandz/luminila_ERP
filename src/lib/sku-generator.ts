/**
 * Jewelry Inventory SKU Architecture Engine
 * Implements deterministic Hybrid Hierarchical SKU generation, HSN tax routing,
 * homoglyph sanitization, wholesale packaging multiplier suffixes,
 * and deterministic digital asset naming according to enterprise non-precious jewelry standards.
 * Supports dynamic addition and removal of custom taxonomies with PocketBase & local persistence.
 */

import { pb, getCurrentTenantEmail, getTenantStorageKey } from './pocketbase';

export interface GenreOption {
    code: string;
    label: string;
    description: string;
    isCustom?: boolean;
}

export interface CategoryOption {
    code: string;
    label: string;
    isCustom?: boolean;
}

export interface SubcategoryOption {
    code: string;
    label: string;
    categoryCode?: string;
    isCustom?: boolean;
}

export interface BaseMetalOption {
    code: string;
    label: string;
    isCustom?: boolean;
}

export interface PlatingOption {
    code: string;
    label: string;
    isCustom?: boolean;
}

export interface StoneOption {
    code: string;
    label: string;
    isCustom?: boolean;
}

export interface ColorOption {
    code: string;
    label: string;
    isCustom?: boolean;
}

export interface SizeOption {
    code: string;
    label: string;
    category?: 'bangle' | 'ring' | 'chain' | 'custom' | 'general';
    description?: string;
    isCustom?: boolean;
}

export interface PackagingTierOption {
    suffix: string;
    label: string;
    multiplier: number;
    description: string;
    isCustom?: boolean;
}

export interface SKUTaxonomies {
    genres: GenreOption[];
    categories: CategoryOption[];
    subcategories: SubcategoryOption[];
    baseMetals: BaseMetalOption[];
    platings: PlatingOption[];
    stones: StoneOption[];
    colors: ColorOption[];
    sizes: SizeOption[];
    packagingTiers: PackagingTierOption[];
}

// Master Baseline Dictionaries from Architecture Spec
export const DEFAULT_GENRES: GenreOption[] = [
    { code: "GEN", label: "General / Standard", description: "Standard non-specialized ornamentation or uncategorized stock" },
    { code: "TMP", label: "Temple Jewellery", description: "Sacred iconography (Lakshmi, peacock, mango), coin repoussé (kasumalai)" },
    { code: "KUN", label: "Kundan & Jadau", description: "Foil-backed synthetic stone settings, reverse Meenakari" },
    { code: "POL", label: "Polki", description: "Uncut glass polki silhouettes with vintage foil setting" },
    { code: "ANT", label: "Antique / Oxidized", description: "Vintage tribal filigree, rustic blackened ornamentation" },
    { code: "COV", label: "Micro-Plated / Covering", description: "1-gram gold covering, 24K electroplating (0.5–1.0 µm)" },
    { code: "WST", label: "Western", description: "Geometric linkages, tennis silhouettes, rhodium solitaires" },
    { code: "IND", label: "Indo-Western", description: "Fusion contemporary ethnic and modern silhouettes" },
];

export const DEFAULT_CATEGORIES: CategoryOption[] = [
    { code: "GEN", label: "General / Uncategorized" },
    { code: "NEC", label: "Necklaces" },
    { code: "BAN", label: "Bangles & Kadas" },
    { code: "EAR", label: "Earrings" },
    { code: "SET", label: "Coordinated Sets" },
    { code: "HAR", label: "Harams (Long Chains)" },
    { code: "RIN", label: "Finger Rings" },
    { code: "PAY", label: "Anklets / Payal" },
    { code: "MGT", label: "Maang Tikka" },
    { code: "HIP", label: "Waist Belt / Oddiyanam" },
];

export const DEFAULT_SUBCATEGORIES: SubcategoryOption[] = [
    // GEN (General / Uncategorized)
    { code: "GEN", label: "General / Other", categoryCode: "GEN" },

    // NEC (Necklaces)
    { code: "CHK", label: "Choker", categoryCode: "NEC" },
    { code: "CHA", label: "Chain / Short Chain", categoryCode: "NEC" },
    { code: "MUG", label: "Mugappu Short Chain", categoryCode: "NEC" },
    { code: "COL", label: "Collar Necklace", categoryCode: "NEC" },
    { code: "PEN", label: "Pendant Necklace", categoryCode: "NEC" },

    // EAR (Earrings)
    { code: "JHU", label: "Jhumka", categoryCode: "EAR" },
    { code: "STU", label: "Studs / Tops", categoryCode: "EAR" },
    { code: "BAL", label: "Bali / Hoops", categoryCode: "EAR" },
    { code: "DRP", label: "Drop / Danglers", categoryCode: "EAR" },
    { code: "CHB", label: "Chandbali", categoryCode: "EAR" },
    { code: "SUF", label: "Sui Dhaga / Ear Chain", categoryCode: "EAR" },

    // BAN (Bangles & Kadas)
    { code: "KAD", label: "Kada (Openable/Solid)", categoryCode: "BAN" },
    { code: "SGL", label: "Single Bangle", categoryCode: "BAN" },
    { code: "BNS", label: "Bangle Set (2/4/Set)", categoryCode: "BAN" },
    { code: "BRA", label: "Bracelet / Charm", categoryCode: "BAN" },

    // SET (Coordinated Sets)
    { code: "SET", label: "Matching Full Set", categoryCode: "SET" },
    { code: "BRD", label: "Bridal Full Set", categoryCode: "SET" },
    { code: "MIN", label: "Mini / Pendant Set", categoryCode: "SET" },

    // HAR (Harams - Long Chains)
    { code: "HAR", label: "Haram / Long Necklace", categoryCode: "HAR" },
    { code: "LMU", label: "Mugappu Long Chain", categoryCode: "HAR" },
    { code: "KAS", label: "Kasumalai / Coin Haram", categoryCode: "HAR" },
    { code: "GUT", label: "Guttapusalu Haram", categoryCode: "HAR" },

    // RIN (Finger Rings)
    { code: "ADJ", label: "Adjustable Ring", categoryCode: "RIN" },
    { code: "SOL", label: "Solitaire / Cocktail Ring", categoryCode: "RIN" },
    { code: "RBN", label: "Band Ring", categoryCode: "RIN" },

    // PAY (Anklets / Payal)
    { code: "PAY", label: "Anklet / Payal / Golusu", categoryCode: "PAY" },
    { code: "TOE", label: "Toe Ring / Metti", categoryCode: "PAY" },

    // MGT (Maang Tikka)
    { code: "TIK", label: "Single Maang Tikka", categoryCode: "MGT" },
    { code: "PAS", label: "Passa / Side Tikka", categoryCode: "MGT" },
    { code: "MAT", label: "Matha Patti", categoryCode: "MGT" },

    // HIP (Waist Belt / Oddiyanam)
    { code: "VAD", label: "Oddiyanam / Vaddanam", categoryCode: "HIP" },
    { code: "KAM", label: "Kamarbandh / Waist Chain", categoryCode: "HIP" },
];

export const DEFAULT_BASE_METALS: BaseMetalOption[] = [
    { code: "BR", label: "Brass (BR)" },
    { code: "CP", label: "Copper (CP)" },
    { code: "ZA", label: "Zinc Alloy / Zamak (ZA)" },
    { code: "GS", label: "German Silver (GS)" },
    { code: "IP", label: "Impon / 5-Metal Alloy (IP)" },
];

export const DEFAULT_PLATINGS: PlatingOption[] = [
    { code: "MG", label: "Micro Gold Plated (MG)" },
    { code: "MF", label: "Matte Finish (MF)" },
    { code: "AN", label: "Antique Polish (AN)" },
    { code: "OX", label: "Oxidized Silver/Black (OX)" },
    { code: "RH", label: "Rhodium Silver (RH)" },
    { code: "RG", label: "Rose Gold (RG)" },
    { code: "TT", label: "Two-Tone (TT)" },
];

export const DEFAULT_STONES: StoneOption[] = [
    { code: "PL", label: "Plain / No Stones (PL)" },
    { code: "CZ", label: "American Diamond / CZ (CZ)" },
    { code: "KP", label: "Kempu Synthetic Corundum (KP)" },
    { code: "KD", label: "Foil Kundan (KD)" },
    { code: "PR", label: "Synthetic Pearl (PR)" },
    { code: "GL", label: "Faceted Glass / Beads (GL)" },
];

export const DEFAULT_COLORS: ColorOption[] = [
    { code: "WH", label: "White / Clear (WH)" },
    { code: "RB", label: "Ruby Red (RB)" },
    { code: "EM", label: "Emerald Green (EM)" },
    { code: "ML", label: "Multicolor (ML)" },
    { code: "PK", label: "Baby Pink (PK)" },
    { code: "MN", label: "Mint Green (MN)" },
    { code: "BK", label: "Black Onyx (BK)" },
    { code: "BL", label: "Royal Blue (BL)" },
];

export const DEFAULT_SIZES: SizeOption[] = [
    // Standard
    { code: "STD", label: "Standard / Free Size", category: "general" },
    // Bangles
    { code: "202", label: "Size 2.2 (53.98mm / 2.125 in)", category: "bangle" },
    { code: "204", label: "Size 2.4 (57.15mm / 2.250 in)", category: "bangle" },
    { code: "206", label: "Size 2.6 (60.32mm / 2.375 in)", category: "bangle" },
    { code: "208", label: "Size 2.8 (63.50mm / 2.500 in)", category: "bangle" },
    { code: "210", label: "Size 2.10 (66.68mm / 2.625 in)", category: "bangle" },
    { code: "212", label: "Size 2.12 (69.85mm / 2.750 in)", category: "bangle" },
    // Rings
    { code: "R08", label: "Ring Size 8", category: "ring" },
    { code: "R10", label: "Ring Size 10", category: "ring" },
    { code: "R12", label: "Ring Size 12", category: "ring" },
    { code: "R14", label: "Ring Size 14", category: "ring" },
    { code: "R16", label: "Ring Size 16", category: "ring" },
    { code: "R18", label: "Ring Size 18", category: "ring" },
    { code: "R20", label: "Ring Size 20", category: "ring" },
    { code: "R22", label: "Ring Size 22", category: "ring" },
    { code: "ADJ", label: "Adjustable Ring (ADJ)", category: "ring" },
    // Chains
    { code: "16I", label: "16 Inch (Choker)", category: "chain" },
    { code: "18I", label: "18 Inch (Princess)", category: "chain" },
    { code: "24I", label: "24 Inch (Matinee)", category: "chain" },
    { code: "30I", label: "30 Inch (Opera / Haram)", category: "chain" },
];

export const DEFAULT_PACKAGING_TIERS: PackagingTierOption[] = [
    { suffix: "EA", label: "Retail Single Piece", multiplier: 1, description: "Standard POS retail scan; decrements 1 unit" },
    { suffix: "C12", label: "Wholesale Card (12 Pairs)", multiplier: 12, description: "B2B hanging display card; decrements 12 individual units" },
    { suffix: "A06", label: "Assorted Color Pack (6 Pcs)", multiplier: 6, description: "Pre-packaged card of 6 mixed colorways; decrements 6 units" },
    { suffix: "B06", label: "Wholesale Bangle Box (6 Pcs)", multiplier: 6, description: "Pre-boxed wholesale lot of identical size; decrements 6 units" },
    { suffix: "G01", label: "Wholesale Gross Master (144 Pcs)", multiplier: 144, description: "Bulk master carton; decrements 144 units; triggers tier-3 B2B pricing" },
];

export function getDefaultTaxonomies(): SKUTaxonomies {
    return {
        genres: [...DEFAULT_GENRES],
        categories: [...DEFAULT_CATEGORIES],
        subcategories: [...DEFAULT_SUBCATEGORIES],
        baseMetals: [...DEFAULT_BASE_METALS],
        platings: [...DEFAULT_PLATINGS],
        stones: [...DEFAULT_STONES],
        colors: [...DEFAULT_COLORS],
        sizes: [...DEFAULT_SIZES],
        packagingTiers: [...DEFAULT_PACKAGING_TIERS],
    };
}

const BASE_STORAGE_KEY = "luminila_sku_taxonomies_v1";

function getSKUStorageKey(): string {
    return getTenantStorageKey(BASE_STORAGE_KEY);
}

const PB_KEY = "jewelry_sku_taxonomies";

let currentTaxonomies: SKUTaxonomies = getDefaultTaxonomies();
const listeners = new Set<(taxonomies: SKUTaxonomies) => void>();

// Load cached taxonomies from localStorage immediately if available in browser
if (typeof window !== "undefined") {
    try {
        const cached = localStorage.getItem(getSKUStorageKey());
        if (cached) {
            const parsed = JSON.parse(cached);
            currentTaxonomies = mergeTaxonomiesWithDefaults(parsed);
        }
    } catch (e) {
        console.error("Failed to parse cached SKU taxonomies", e);
    }
}

function dedupeList<T>(list: T[] | undefined, defaultList: T[], keyProp: string = "code"): T[] {
    if (!list || list.length === 0) return [...defaultList];
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of list) {
        const val = ((item as any)[keyProp] || "").toUpperCase().trim();
        if (val && !seen.has(val)) {
            seen.add(val);
            result.push(item);
        }
    }
    return result.length > 0 ? result : [...defaultList];
}

function mergeSubcategories(loaded: SubcategoryOption[] | undefined, defaultList: SubcategoryOption[]): SubcategoryOption[] {
    if (!loaded || loaded.length === 0) return [...defaultList];
    const seen = new Set<string>();
    const result: SubcategoryOption[] = [];

    // 1. Process loaded items; if categoryCode is missing, backfill from defaults
    for (const item of loaded) {
        const code = (item.code || "").toUpperCase().trim();
        const cat = (item.categoryCode || "").toUpperCase().trim();
        const defMatch = defaultList.find(d => d.code.toUpperCase() === code);
        const effectiveCat = cat || defMatch?.categoryCode || "";
        const compositeKey = `${effectiveCat}-${code}`;

        if (code && !seen.has(compositeKey)) {
            seen.add(compositeKey);
            result.push({
                ...item,
                categoryCode: effectiveCat || undefined,
            });
        }
    }

    // 2. Include any defaults not yet in result
    for (const def of defaultList) {
        const code = def.code.toUpperCase().trim();
        const cat = (def.categoryCode || "").toUpperCase().trim();
        const compositeKey = `${cat}-${code}`;
        if (!seen.has(compositeKey)) {
            seen.add(compositeKey);
            result.push(def);
        }
    }

    return result.length > 0 ? result : [...defaultList];
}

function mergeTaxonomiesWithDefaults(loaded: Partial<SKUTaxonomies>): SKUTaxonomies {
    const defaults = getDefaultTaxonomies();
    return {
        genres: dedupeList(loaded.genres, defaults.genres, "code"),
        categories: dedupeList(loaded.categories, defaults.categories, "code"),
        subcategories: mergeSubcategories(loaded.subcategories, defaults.subcategories),
        baseMetals: dedupeList(loaded.baseMetals, defaults.baseMetals, "code"),
        platings: dedupeList(loaded.platings, defaults.platings, "code"),
        stones: dedupeList(loaded.stones, defaults.stones, "code"),
        colors: dedupeList(loaded.colors, defaults.colors, "code"),
        sizes: dedupeList(loaded.sizes, defaults.sizes, "code"),
        packagingTiers: dedupeList(loaded.packagingTiers, defaults.packagingTiers, "suffix"),
    };
}

function notifyListeners() {
    listeners.forEach((listener) => {
        try {
            listener({ ...currentTaxonomies });
        } catch (e) {
            console.error("Error in SKU taxonomy listener", e);
        }
    });
}

/**
 * Returns current in-memory taxonomies synchronously
 */
export function getSKUTaxonomies(): SKUTaxonomies {
    return { ...currentTaxonomies };
}

/**
 * Filters subcategories mapped to a specific Category code.
 * Falls back to all subcategories if none specifically match.
 */
export function getSubcategoriesForCategory(
    categoryCode: string,
    subcategories: SubcategoryOption[] = currentTaxonomies.subcategories
): SubcategoryOption[] {
    if (!categoryCode || categoryCode === "GEN") {
        const genSubcats = subcategories.filter(s => s.categoryCode === "GEN");
        if (genSubcats.length > 0) return genSubcats;
        return [{ code: "GEN", label: "General / Other", categoryCode: "GEN" }];
    }
    const cat = categoryCode.toUpperCase().trim();
    const filtered = subcategories.filter(s => {
        if (!s.categoryCode || s.categoryCode === 'ALL') return true;
        return s.categoryCode.toUpperCase() === cat;
    });
    return filtered.length > 0 ? filtered : [{ code: "GEN", label: "General / Other", categoryCode: cat }];
}

/**
 * Queries PocketBase for existing SKUs with the given prefix
 * and calculates the next gapless sequence counter (e.g. 1 -> 00001).
 */
export async function computeNextSkuSequence(prefix: string, fallbackSeq: number = 1): Promise<number> {
    try {
        let nextSeq = 1;
        const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const rows = await pb.collection('products').getFullList({
            filter: pb.filter("sku ~ {:prefix}", { prefix: cleanPrefix }),
            fields: 'sku',
        });
        const seq5Regex = new RegExp(`^${cleanPrefix}(\\d{5})`);
        const seq4Regex = new RegExp(`^${cleanPrefix}(\\d{4})`);
        rows.forEach(row => {
            const skuStr = String((row as { sku?: string }).sku || '').toUpperCase();
            const match5 = skuStr.match(seq5Regex);
            if (match5) nextSeq = Math.max(nextSeq, parseInt(match5[1], 10) + 1);
            const match4 = skuStr.match(seq4Regex);
            if (match4) nextSeq = Math.max(nextSeq, parseInt(match4[1], 10) + 1);
        });
        return nextSeq;
    } catch (err) {
        console.error("SKU sequence lookup failed, using fallback sequence", err);
        return Math.max(1, fallbackSeq);
    }
}

/**
 * Subscribe to taxonomy changes (for reactive UI updates)
 */
export function subscribeSKUTaxonomies(callback: (taxonomies: SKUTaxonomies) => void): () => void {
    listeners.add(callback);
    callback({ ...currentTaxonomies });
    return () => {
        listeners.delete(callback);
    };
}

/**
 * Loads taxonomies from PocketBase store_settings or local cache
 */
export async function loadSKUTaxonomies(): Promise<SKUTaxonomies> {
    const tenantEmail = getCurrentTenantEmail();
    try {
        const filter = tenantEmail && tenantEmail !== "default"
            ? `key="${PB_KEY}" && account_email="${tenantEmail}"`
            : `key="${PB_KEY}"`;
        const record = await pb.collection("store_settings").getFirstListItem(filter).catch(() => null);
        if (record && record.value) {
            const val = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            currentTaxonomies = mergeTaxonomiesWithDefaults(val);
            if (typeof window !== "undefined") {
                localStorage.setItem(getSKUStorageKey(), JSON.stringify(currentTaxonomies));
            }
            notifyListeners();
            return { ...currentTaxonomies };
        }
    } catch (e) {
        console.warn("Failed to load SKU taxonomies from PocketBase:", e);
    }

    if (typeof window !== "undefined") {
        try {
            const cached = localStorage.getItem(getSKUStorageKey());
            if (cached) {
                currentTaxonomies = mergeTaxonomiesWithDefaults(JSON.parse(cached));
                notifyListeners();
            }
        } catch { /* ignore */ }
    }

    return { ...currentTaxonomies };
}

/**
 * Saves and broadcasts updated taxonomies to PocketBase & localStorage
 */
export async function saveSKUTaxonomies(taxonomies: SKUTaxonomies): Promise<void> {
    currentTaxonomies = { ...taxonomies };

    if (typeof window !== "undefined") {
        localStorage.setItem(getSKUStorageKey(), JSON.stringify(currentTaxonomies));
    }
    notifyListeners();

    try {
        const tenantEmail = getCurrentTenantEmail();
        const filter = tenantEmail && tenantEmail !== "default"
            ? `key="${PB_KEY}" && account_email="${tenantEmail}"`
            : `key="${PB_KEY}"`;
        const existing = await pb.collection("store_settings").getFirstListItem(filter).catch(() => null);
        if (existing) {
            await pb.collection("store_settings").update(existing.id, {
                value: currentTaxonomies,
                category: "sku_taxonomies",
                account_email: tenantEmail && tenantEmail !== "default" ? tenantEmail : (existing.account_email || ""),
            });
        } else {
            await pb.collection("store_settings").create({
                key: PB_KEY,
                value: currentTaxonomies,
                category: "sku_taxonomies",
                account_email: tenantEmail && tenantEmail !== "default" ? tenantEmail : "",
            });
        }
    } catch (e) {
        console.warn("Could not persist SKU taxonomies to PocketBase (local cached):", e);
    }
}

/**
 * Add a custom taxonomy option
 */
export async function addTaxonomyOption<K extends keyof SKUTaxonomies>(
    taxonomyKey: K,
    option: SKUTaxonomies[K][number]
): Promise<SKUTaxonomies> {
    const updated = { ...currentTaxonomies };
    const list = [...(updated[taxonomyKey] as any[])];

    // Clean code / suffix
    const codeKey = taxonomyKey === 'packagingTiers' ? 'suffix' : 'code';
    const codeVal = ((option as any)[codeKey] || '').toUpperCase().trim();
    if (!codeVal) throw new Error("Code / Suffix cannot be empty");

    // Check duplicate
    const existingIndex = list.findIndex(item => (item[codeKey] || '').toUpperCase() === codeVal);
    const enriched = {
        ...option,
        [codeKey]: codeVal,
        isCustom: true,
    };

    if (existingIndex >= 0) {
        list[existingIndex] = enriched;
    } else {
        list.push(enriched);
    }

    updated[taxonomyKey] = list as any;
    await saveSKUTaxonomies(updated);
    return { ...currentTaxonomies };
}

/**
 * Remove an option from a taxonomy
 */
export async function removeTaxonomyOption<K extends keyof SKUTaxonomies>(
    taxonomyKey: K,
    codeOrSuffix: string
): Promise<SKUTaxonomies> {
    const updated = { ...currentTaxonomies };
    const codeKey = taxonomyKey === 'packagingTiers' ? 'suffix' : 'code';
    const cleanTarget = codeOrSuffix.toUpperCase().trim();

    const filtered = (updated[taxonomyKey] as any[]).filter(
        item => (item[codeKey] || '').toUpperCase() !== cleanTarget
    );

    updated[taxonomyKey] = filtered as any;
    await saveSKUTaxonomies(updated);
    return { ...currentTaxonomies };
}

/**
 * Update an existing taxonomy option (supports updating label, description, metadata, or renaming code)
 */
export async function updateTaxonomyOption<K extends keyof SKUTaxonomies>(
    taxonomyKey: K,
    oldCodeOrSuffix: string,
    updatedOption: SKUTaxonomies[K][number]
): Promise<SKUTaxonomies> {
    const updated = { ...currentTaxonomies };
    const list = [...(updated[taxonomyKey] as any[])];
    const codeKey = taxonomyKey === 'packagingTiers' ? 'suffix' : 'code';
    const oldCodeClean = oldCodeOrSuffix.toUpperCase().trim();
    const newCodeClean = ((updatedOption as any)[codeKey] || '').toUpperCase().trim();

    if (!newCodeClean) throw new Error("Code / Suffix cannot be empty");

    const index = list.findIndex(item => (item[codeKey] || '').toUpperCase() === oldCodeClean);
    if (index === -1) {
        throw new Error(`Taxonomy item [${oldCodeOrSuffix}] not found in ${taxonomyKey}`);
    }

    if (newCodeClean !== oldCodeClean) {
        const conflict = list.some((item, idx) => idx !== index && (item[codeKey] || '').toUpperCase() === newCodeClean);
        if (conflict) {
            throw new Error(`A ${taxonomyKey} item with code [${newCodeClean}] already exists`);
        }
    }

    list[index] = {
        ...list[index],
        ...updatedOption,
        [codeKey]: newCodeClean,
        isCustom: true,
    };

    updated[taxonomyKey] = list as any;
    await saveSKUTaxonomies(updated);
    return { ...currentTaxonomies };
}

/**
 * Reset all taxonomies back to factory defaults
 */
export async function resetSKUTaxonomies(): Promise<SKUTaxonomies> {
    const defaults = getDefaultTaxonomies();
    await saveSKUTaxonomies(defaults);
    return { ...defaults };
}

// Dynamic Exports with fallback backwards-compatibility
export const GENRES = currentTaxonomies.genres;
export const CATEGORIES = currentTaxonomies.categories;
export const SUBCATEGORIES = currentTaxonomies.subcategories;
export const BASE_METALS = currentTaxonomies.baseMetals;
export const PLATINGS = currentTaxonomies.platings;
export const STONES = currentTaxonomies.stones;
export const COLORS = currentTaxonomies.colors;
export const PACKAGING_TIERS = currentTaxonomies.packagingTiers;

export const BANGLE_SIZES = currentTaxonomies.sizes.filter(s => s.category === 'bangle' || /^\d{3}$/.test(s.code));
export const RING_SIZES = currentTaxonomies.sizes.filter(s => s.category === 'ring' || s.code.startsWith('R') || s.code === 'ADJ');
export const CHAIN_LENGTHS = currentTaxonomies.sizes.filter(s => s.category === 'chain' || s.code.endsWith('I'));

/**
 * Sanitizes string by stripping homoglyphs and forbidden characters
 * Forbidden: slashes (/), colons (:), spaces, ampersands (&), underscores (_)
 */
export function sanitizeSKUSegment(input: string): string {
    return input
        .toUpperCase()
        .replace(/[\/\s:&_]/g, "")
        .replace(/[^A-Z0-9\-]/g, "");
}

/**
 * Derives Statutory HSN code (Chapter 7117 - 3% GST rate)
 */
export function deriveHSNCode(categoryCode: string, baseMetalCode?: string, stoneCode?: string): string {
    if (!categoryCode || categoryCode === "GEN") {
        return "71179090";
    }
    // 1. Bangles: 7117 19 10
    if (categoryCode === "BAN") {
        return "71171910";
    }
    // 2. German Silver jewelry: 7117 19 20
    if (baseMetalCode === "GS") {
        return "71171920";
    }
    // 3. Studded with synthetic stones, glass, pearls: 7117 90 10
    if (stoneCode && stoneCode !== "PL") {
        return "71179010";
    }
    // 4. Cufflinks / base studs: 7117 11 00
    if (categoryCode === "EAR" && stoneCode === "PL") {
        return "71171100";
    }
    // 5. Miscellaneous fashion jewelry: 7117 90 90
    return "71179090";
}

export interface SKUBuildParams {
    genre: string; // e.g. TMP
    category: string; // e.g. NEC
    subcategory: string; // e.g. CHK
    sequence: number; // e.g. 4821 -> 04821
    plating?: string; // e.g. MG
    color?: string; // e.g. RB
    size?: string; // e.g. STD or 206
    packagingTier?: string; // EA, C12, A06, B06, G01
}

/**
 * Generates the 14-character Parent Style SKU
 * Formula: Genre(3) + Category(3) + Subcategory(3) + ZeroPad(Seq, 5)
 * Example: TMPNECCHK04821
 */
export function generateParentSKU(genre: string, category: string, subcategory: string, sequence: number): string {
    const g = (genre || "GEN").substring(0, 3).toUpperCase();
    const c = (category || "GEN").substring(0, 3).toUpperCase();
    const s = (subcategory || "GEN").substring(0, 3).toUpperCase();
    const seqStr = String(sequence || 1).padStart(5, "0").slice(-5);
    return sanitizeSKUSegment(`${g}${c}${s}${seqStr}`);
}

/**
 * Generates the 21-character Child Variant SKU
 * Formula: ParentSKU + "-" + Plating(2) + Color(2) + Size(3)
 * Example: TMPNECCHK04821-MGRBSTD
 */
export function generateChildSKU(parentSKU: string, plating: string = "MG", color: string = "WH", size: string = "STD"): string {
    const p = (plating || "MG").substring(0, 2).toUpperCase();
    const col = (color || "WH").substring(0, 2).toUpperCase();
    const sz = (size || "STD").substring(0, 3).toUpperCase().padStart(3, "0");
    return sanitizeSKUSegment(`${parentSKU}-${p}${col}${sz}`);
}

/**
 * Appends wholesale packaging suffix if applicable
 * Example: TMPNECCHK04821-MGRBSTD-C12
 */
export function generateWholesaleSKU(childSKU: string, packagingTier: string = "EA"): string {
    if (!packagingTier || packagingTier === "EA") {
        return childSKU;
    }
    return sanitizeSKUSegment(`${childSKU}-${packagingTier}`);
}

/**
 * Generates deterministic digital asset file name
 * Formula: ParentSKU + "_" + PlatingColorCode + "_" + ShotType + "_" + Sequence + ".webp"
 * Example: TMPNECCHK04821_MGRB_HERO_01.webp
 */
export function generateDeterministicImageFilename(
    parentSKU: string,
    plating: string,
    color: string,
    shotType: "HERO" | "MACR" | "REVR" | "SCAL" = "HERO",
    sequence: number = 1
): string {
    const p = (plating || "MG").substring(0, 2).toUpperCase();
    const col = (color || "WH").substring(0, 2).toUpperCase();
    const seq = String(sequence).padStart(2, "0");
    return `${parentSKU}_${p}${col}_${shotType}_${seq}.webp`;
}

/**
 * Helper to parse SKU to determine if it is 1D pointer, Parent, Child, or Wholesale
 */
export function parseSKUType(sku: string): {
    is1DPointer: boolean;
    isParent: boolean;
    isChild: boolean;
    isWholesale: boolean;
    multiplier: number;
} {
    const clean = sku.trim().toUpperCase();
    if (/^\d{8,10}$/.test(clean)) {
        return { is1DPointer: true, isParent: false, isChild: false, isWholesale: false, multiplier: 1 };
    }

    const parts = clean.split("-");
    if (parts.length === 1 && clean.length === 14) {
        return { is1DPointer: false, isParent: true, isChild: false, isWholesale: false, multiplier: 1 };
    }
    if (parts.length === 2 && clean.length === 22) {
        return { is1DPointer: false, isParent: false, isChild: true, isWholesale: false, multiplier: 1 };
    }
    if (parts.length >= 3) {
        const suffix = parts[parts.length - 1];
        const matchTier = currentTaxonomies.packagingTiers.find(t => t.suffix === suffix);
        return {
            is1DPointer: false,
            isParent: false,
            isChild: false,
            isWholesale: true,
            multiplier: matchTier ? matchTier.multiplier : 1,
        };
    }

    return { is1DPointer: false, isParent: false, isChild: false, isWholesale: false, multiplier: 1 };
}
