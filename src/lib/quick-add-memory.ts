/**
 * Quick Add Series Memory
 *
 * Remembers the last-used SKU taxonomy series (plus the commercial defaults
 * that ride along with it) so piece-by-piece entry only changes per piece:
 * the stone colour and the photo. Follows the house singleton pattern (see
 * sku-generator.ts): module state + listener Set + tenant-scoped localStorage
 * cache + PocketBase store_settings persistence so the memory follows the
 * account across devices.
 *
 * Series identity deliberately EXCLUDES the colour code — colour is the level
 * that changes every piece, so a colour-run upserts one series entry instead
 * of spamming the recent stack.
 */

import { pb, getCurrentTenantEmail, getTenantStorageKey } from "./pocketbase";
import type { SKUTaxonomies } from "./sku-generator";

export interface QuickAddSeriesEntry {
    // SKU Architect taxonomy codes (names mirror the inventory page states)
    skuGenre: string;
    skuCategory: string;
    skuSubcat: string;
    skuPlating: string;
    skuColor: string;
    skuSize: string;
    skuPackagingTier: string;
    skuBaseMetal: string;
    skuStone: string;
    // Commercial carry-over (form values, not codes)
    craft: string;
    plating: string; // imitation-jewelry key (e.g. "micro_gold_1gm")
    occasion: string;
    baseMetal: string; // imitation-jewelry key (e.g. "brass")
    costPrice: string;
    channelPrices: Record<string, number>;
    hsnCode: string;
    location: string;
    stock: string;
    categoryName: string; // resolved taxonomy category label for the form
    usedAt: string; // ISO timestamp; orders the recent stack
}

export interface QuickAddMemory {
    last?: QuickAddSeriesEntry;
    /** Newest first, capped at MAX_RECENT. */
    recent: QuickAddSeriesEntry[];
}

const MAX_RECENT = 5;
const BASE_STORAGE_KEY = "luminila_quick_add_memory_v1";
const PB_KEY = "quick_add_memory";

function getStorageKey(): string {
    return getTenantStorageKey(BASE_STORAGE_KEY);
}

/**
 * Display swatch for a colour code. Custom colours fall back to a neutral
 * chip rendered with the raw code text.
 */
export const COLOR_SWATCHES: Record<string, string> = {
    WH: "#f8fafc",
    RB: "#dc2626",
    EM: "#059669",
    ML: "linear-gradient(135deg, #dc2626, #f59e0b, #059669, #2563eb)",
    PK: "#f9a8d4",
    MN: "#6ee7b7",
    BK: "#1f2937",
    BL: "#2563eb",
};

/**
 * Series key: every taxonomy code except colour. Two pieces in the same
 * series with different colours share a key, so they share one chip.
 */
export function seriesKeyOf(entry: {
    skuGenre: string;
    skuCategory: string;
    skuSubcat: string;
    skuPlating: string;
    skuSize: string;
    skuPackagingTier: string;
    skuBaseMetal: string;
    skuStone: string;
}): string {
    return [
        entry.skuGenre,
        entry.skuCategory,
        entry.skuSubcat,
        entry.skuPlating,
        entry.skuSize,
        entry.skuPackagingTier,
        entry.skuBaseMetal,
        entry.skuStone,
    ]
        .map((code) => (code || "").toUpperCase().trim())
        .join("|");
}

function toStringField(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

/** Convenience factory with sensible defaults, for tests and first-time callers. */
export function getDefaultSeriesEntry(): Omit<QuickAddSeriesEntry, "usedAt"> {
    return {
        skuGenre: "GEN",
        skuCategory: "GEN",
        skuSubcat: "GEN",
        skuPlating: "MG",
        skuColor: "WH",
        skuSize: "STD",
        skuPackagingTier: "EA",
        skuBaseMetal: "BR",
        skuStone: "KP",
        craft: "",
        plating: "",
        occasion: "",
        baseMetal: "",
        costPrice: "",
        channelPrices: {},
        hsnCode: "71179010",
        location: "Showcase Tray A",
        stock: "0",
        categoryName: "Uncategorized",
    };
}

/** Defensive shape check so a corrupt cache can never crash the dialog. */
function sanitizeMemory(raw: unknown): QuickAddMemory {
    if (!raw || typeof raw !== "object") return { recent: [] };
    const source = raw as Partial<QuickAddMemory>;
    if (!Array.isArray(source.recent)) return { recent: [] };
    const recent = source.recent
        .filter((entry): entry is QuickAddSeriesEntry => !!entry && typeof entry === "object")
        .map((entry) => ({
            ...entry,
            skuGenre: toStringField(entry.skuGenre, "GEN"),
            skuCategory: toStringField(entry.skuCategory, "GEN"),
            skuSubcat: toStringField(entry.skuSubcat, "GEN"),
            skuPlating: toStringField(entry.skuPlating, "MG"),
            skuColor: toStringField(entry.skuColor, "WH"),
            skuSize: toStringField(entry.skuSize, "STD"),
            skuPackagingTier: toStringField(entry.skuPackagingTier, "EA"),
            skuBaseMetal: toStringField(entry.skuBaseMetal, "BR"),
            skuStone: toStringField(entry.skuStone, "KP"),
            craft: toStringField(entry.craft),
            plating: toStringField(entry.plating),
            occasion: toStringField(entry.occasion),
            baseMetal: toStringField(entry.baseMetal),
            costPrice: toStringField(entry.costPrice),
            hsnCode: toStringField(entry.hsnCode, "71179010"),
            location: toStringField(entry.location, "Showcase Tray A"),
            stock: toStringField(entry.stock, "0"),
            channelPrices:
                entry.channelPrices && typeof entry.channelPrices === "object"
                    ? entry.channelPrices
                    : {},
            categoryName: toStringField(entry.categoryName),
            usedAt: toStringField(entry.usedAt, new Date().toISOString()),
        }))
        .slice(0, MAX_RECENT);
    return { last: recent[0], recent };
}

let currentMemory: QuickAddMemory = { recent: [] };
const listeners = new Set<(memory: QuickAddMemory) => void>();

// Hydrate from localStorage synchronously so the first dialog open of a
// session already has the last series (PocketBase refresh follows async).
if (typeof window !== "undefined") {
    try {
        const cached = localStorage.getItem(getStorageKey());
        if (cached) {
            currentMemory = sanitizeMemory(JSON.parse(cached));
        }
    } catch (e) {
        console.error("Failed to parse cached quick add memory", e);
    }
}

function notifyListeners() {
    listeners.forEach((listener) => {
        try {
            listener({ ...currentMemory, recent: [...currentMemory.recent] });
        } catch (e) {
            console.error("Error in quick add memory listener", e);
        }
    });
}

export function getQuickAddMemory(): QuickAddMemory {
    return { ...currentMemory, recent: [...currentMemory.recent] };
}

export function subscribeQuickAddMemory(
    callback: (memory: QuickAddMemory) => void
): () => void {
    listeners.add(callback);
    callback(getQuickAddMemory());
    return () => {
        listeners.delete(callback);
    };
}

function persistLocal() {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(currentMemory));
    } catch (e) {
        console.warn("Could not cache quick add memory locally", e);
    }
}

async function persistToPocketBase() {
    try {
        const tenantEmail = getCurrentTenantEmail();
        const filter =
            tenantEmail && tenantEmail !== "default"
                ? `key="${PB_KEY}" && account_email="${tenantEmail}"`
                : `key="${PB_KEY}"`;
        const existing = await pb.collection("store_settings").getFirstListItem(filter).catch(() => null);
        if (existing) {
            await pb.collection("store_settings").update(existing.id, {
                value: currentMemory,
                category: "quick_add",
                account_email:
                    tenantEmail && tenantEmail !== "default"
                        ? tenantEmail
                        : existing.account_email || "",
            });
        } else {
            await pb.collection("store_settings").create({
                key: PB_KEY,
                value: currentMemory,
                category: "quick_add",
                account_email: tenantEmail && tenantEmail !== "default" ? tenantEmail : "",
            });
        }
    } catch (e) {
        // Local cache already has the data; cross-device sync retries next save.
        console.warn("Could not persist quick add memory to PocketBase (local cached):", e);
    }
}

/**
 * Upsert the just-used series as the most recent entry. Same series (ignoring
 * colour) bumps to the front with refreshed colour + commercial fields.
 */
export function rememberQuickAdd(entry: Omit<QuickAddSeriesEntry, "usedAt">): QuickAddMemory {
    const stamped: QuickAddSeriesEntry = { ...entry, usedAt: new Date().toISOString() };
    const key = seriesKeyOf(stamped);
    const rest = currentMemory.recent.filter((existing) => seriesKeyOf(existing) !== key);
    currentMemory = {
        last: stamped,
        recent: [stamped, ...rest].slice(0, MAX_RECENT),
    };
    persistLocal();
    notifyListeners();
    void persistToPocketBase();
    return getQuickAddMemory();
}

/**
 * Loads the memory from PocketBase (source of truth across devices), falling
 * back to the localStorage cache hydrated at module init.
 */
export async function loadQuickAddMemory(): Promise<QuickAddMemory> {
    const tenantEmail = getCurrentTenantEmail();
    try {
        const filter =
            tenantEmail && tenantEmail !== "default"
                ? `key="${PB_KEY}" && account_email="${tenantEmail}"`
                : `key="${PB_KEY}"`;
        const record = await pb
            .collection("store_settings")
            .getFirstListItem(filter)
            .catch(() => null);
        if (record && record.value) {
            const value =
                typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            currentMemory = sanitizeMemory(value);
            persistLocal();
            notifyListeners();
            return getQuickAddMemory();
        }
    } catch (e) {
        console.warn("Failed to load quick add memory from PocketBase:", e);
    }
    return getQuickAddMemory();
}

/**
 * Auto piece name from taxonomy labels — mirrors the auto-name logic in the
 * full Add Product dialog (inventory page handleApplyGeneratedSKU): first
 * word of the genre label + category label + subcategory label.
 */
export function autoPieceName(
    taxonomies: SKUTaxonomies,
    codes: { skuGenre: string; skuCategory: string; skuSubcat: string }
): string {
    const isGen = codes.skuCategory === "GEN";
    const genreLabel = isGen
        ? ""
        : taxonomies.genres.find((g) => g.code === codes.skuGenre)?.label.split(" ")[0] || "";
    const catLabel = isGen
        ? ""
        : taxonomies.categories.find((c) => c.code === codes.skuCategory)?.label || "";
    const subLabel =
        isGen || codes.skuSubcat === "GEN"
            ? ""
            : taxonomies.subcategories.find((s) => s.code === codes.skuSubcat)?.label || "";
    return [genreLabel, catLabel, subLabel].filter(Boolean).join(" ").trim();
}

/** Minimal product shape needed to seed a clone (matches the inventory list rows). */
export interface ClonableProduct {
    sku: string;
    name: string;
    category: string; // display name
    cost_price?: number;
    channel_prices?: Record<string, number>;
    hsn_code?: string;
    location?: string;
    craft?: string;
    plating?: string; // imitation-jewelry key
    occasion?: string;
    base_metal?: string; // imitation-jewelry key
}

export interface CloneTaxonomyResult {
    taxonomy: Pick<
        QuickAddSeriesEntry,
        | "skuGenre"
        | "skuCategory"
        | "skuSubcat"
        | "skuPlating"
        | "skuColor"
        | "skuSize"
        | "skuPackagingTier"
        | "skuBaseMetal"
        | "skuStone"
        | "categoryName"
    >;
    /** True when the SKU parsed as a full architecture SKU (codes recovered exactly). */
    fromArchitectureSku: boolean;
}

/**
 * Recover the taxonomy series from an existing product, for "clone a piece".
 * Architecture SKUs (e.g. TMPNECCHK04821-MGRBSTD[-C12]) encode every code, so
 * they parse exactly; other SKUs fall back to matching the category label.
 */
export function taxonomyFromProduct(
    product: ClonableProduct,
    taxonomies: SKUTaxonomies
): CloneTaxonomyResult {
    const fallback = {
        skuGenre: "GEN",
        skuCategory: "GEN",
        skuSubcat: "GEN",
        skuPlating: "MG",
        skuColor: "WH",
        skuSize: "STD",
        skuPackagingTier: "EA",
        skuBaseMetal: "BR",
        skuStone: "KP",
        categoryName: product.category || "Uncategorized",
    };

    const parts = (product.sku || "").trim().toUpperCase().split("-");
    const parent = parts[0] || "";
    if (parts.length >= 2 && /^\d{5}$/.test(parent.slice(9)) && parent.length === 14) {
        const child = parts[1];
        const taxonomy = {
            skuGenre: parent.slice(0, 3),
            skuCategory: parent.slice(3, 6),
            skuSubcat: parent.slice(6, 9),
            skuPlating: child.slice(0, 2) || "MG",
            skuColor: child.slice(2, 4) || "WH",
            skuSize: child.slice(4, 7) || "STD",
            skuPackagingTier: parts.length >= 3 ? parts[2] : "EA",
            skuBaseMetal: "BR",
            skuStone: "KP",
            categoryName:
                taxonomies.categories.find((c) => c.code === parent.slice(3, 6))?.label ||
                product.category ||
                "Uncategorized",
        };
        return { taxonomy, fromArchitectureSku: true };
    }

    // Fallback: match the product's category display name to a taxonomy label.
    const wanted = (product.category || "").trim().toLowerCase();
    const matched = wanted
        ? taxonomies.categories.find(
              (c) => c.label.toLowerCase() === wanted || c.label.toLowerCase().startsWith(wanted)
          )
        : undefined;
    if (matched && matched.code !== "GEN") {
        return {
            taxonomy: {
                ...fallback,
                skuCategory: matched.code,
                categoryName: matched.label,
            },
            fromArchitectureSku: false,
        };
    }
    return { taxonomy: fallback, fromArchitectureSku: false };
}
