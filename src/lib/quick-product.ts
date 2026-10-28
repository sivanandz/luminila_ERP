/**
 * Shared helpers for fast inventory entry.
 *
 * A quick-added piece is always created as a draft (`is_active: false`) so the
 * storefront only sees it after an explicit publish. Cost is the pricing root;
 * channel prices are resolved from the tenant's rules rather than written into
 * `channel_prices`, unless the user typed an explicit override.
 */

import {
    createProduct,
    createVariant,
    type Product as PbProduct,
} from "./products";
import { createCategory, type Category } from "./categories";

export interface QuickProductDraftInput {
    name: string;
    sku?: string;
    categoryName: string;
    categories: Category[];
    costPrice: number;
    /** Only used when the Shop channel has no cost rule. */
    sellingPrice?: number;
    stock: number;
    description?: string;
    craft?: string;
    plating?: string;
    occasion?: string;
    baseMetal?: string;
    imageData?: string;
    imageUrl?: string;
    hsnCode?: string;
    location?: string;
    channelPrices?: Record<string, number>;
    existingSkus?: string[];
}

export interface QuickProductDraftResult {
    productId: string;
    sku: string;
    name: string;
    variantIds: string[];
    createdCategory?: Category;
}

const DEFAULT_HSN = "71179010";
const DEFAULT_LOCATION = "Showcase Tray A";

export function categorySkuPrefix(category: string): string {
    const letters = (category || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 3);
    return letters || "JWL";
}

export function nextSku(category: string, existingSkus: string[] = []): string {
    const prefix = categorySkuPrefix(category);
    const used = new Set(existingSkus.map((sku) => (sku || "").toUpperCase()));
    let sequence = 1;
    while (used.has(`${prefix}-${String(sequence).padStart(4, "0")}`)) {
        sequence += 1;
    }
    return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

export interface SizePreset {
    sizes: string[];
    /** Size that receives the stock entered at creation. */
    defaultSize: string | null;
}

/**
 * Bangles and rings get size variants at creation. Every size starts at zero
 * except the default one, which receives the stock entered on the form.
 */
export function sizePresetsForCategory(category: string): SizePreset {
    const name = (category || "").toLowerCase();
    if (name.includes("bangle") || name.includes("kada")) {
        return { sizes: ["2.4", "2.6", "2.8"], defaultSize: "2.6" };
    }
    if (name.includes("ring")) {
        return {
            sizes: ["10", "11", "12", "13", "14", "15", "16", "17", "18"],
            defaultSize: "14",
        };
    }
    return { sizes: [], defaultSize: null };
}

export function variantRowsForCategory(
    category: string,
    stock: number
): { name: string; stock: number }[] {
    const preset = sizePresetsForCategory(category);
    if (preset.sizes.length === 0) {
        return [{ name: "Standard", stock: Math.max(0, Math.floor(stock) || 0) }];
    }
    return preset.sizes.map((size) => ({
        name: size,
        stock: size === preset.defaultSize ? Math.max(0, Math.floor(stock) || 0) : 0,
    }));
}

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read the image file"));
        reader.readAsDataURL(file);
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not decode the image"));
        image.src = src;
    });
}

/**
 * Resize to at most 1200 px and encode as WebP so a phone photo does not bloat
 * the product record (images are stored as data URLs today).
 */
export async function compressImageFile(
    file: File,
    maxDimension: number = 1200,
    quality: number = 0.85
): Promise<string> {
    const original = await readAsDataUrl(file);

    // Vector images are already small and resolution-independent.
    if (file.type === "image/svg+xml") return original;

    try {
        const image = await loadImage(original);
        let width = image.width;
        let height = image.height;
        if (width > maxDimension || height > maxDimension) {
            if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
            } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
            }
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const context = canvas.getContext("2d");
        if (!context) return original;

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/webp", quality);
    } catch {
        return original;
    }
}

async function resolveCategory(
    name: string,
    categories: Category[]
): Promise<{ id: string; created?: Category }> {
    const clean = (name || "").trim();
    if (!clean || clean.toLowerCase() === "uncategorized") {
        return { id: "" };
    }

    const existing = categories.find(
        (category) => category.name.toLowerCase() === clean.toLowerCase()
    );
    if (existing) return { id: existing.id };

    const created = await createCategory({
        name: clean,
        slug: clean.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        is_active: true,
    });
    return { id: created.id, created };
}

/**
 * Create a draft product and its variants. Returns the ids so the caller can
 * offer "Save & add another" without re-reading the whole catalogue.
 */
export async function createDraftProduct(
    input: QuickProductDraftInput
): Promise<QuickProductDraftResult> {
    const name = input.name.trim();
    if (!name) throw new Error("Product name is required");

    const costPrice = Math.max(0, Number(input.costPrice) || 0);
    const sellingPrice = Math.max(0, Number(input.sellingPrice) || 0);
    if (costPrice <= 0 && sellingPrice <= 0) {
        throw new Error("Enter a cost price so channel prices can be calculated");
    }

    const category = await resolveCategory(input.categoryName, input.categories);
    const sku = (input.sku || "").trim() || nextSku(input.categoryName, input.existingSkus);

    const basePrice = sellingPrice > 0 ? sellingPrice : costPrice;

    const payload: Omit<PbProduct, "id" | "created" | "updated"> = {
        name,
        sku,
        category: category.id,
        base_price: basePrice,
        cost_price: costPrice,
        channel_prices: input.channelPrices || {},
        hsn_code: input.hsnCode || DEFAULT_HSN,
        image_url: input.imageUrl || "",
        image_data: input.imageData || input.imageUrl || "",
        location: input.location || DEFAULT_LOCATION,
        craft: input.craft || "",
        plating: input.plating || "",
        occasion: input.occasion || "",
        base_metal: input.baseMetal || "",
        description: input.description?.trim() || "",
        is_active: false,
    };

    const product = await createProduct(payload);

    const rows = variantRowsForCategory(input.categoryName, input.stock);
    const variantIds: string[] = [];
    for (const row of rows) {
        const variant = await createVariant({
            product: product.id,
            variant_name: row.name,
            stock_level: row.stock,
        });
        variantIds.push(variant.id);
    }

    return {
        productId: product.id,
        sku,
        name,
        variantIds,
        createdCategory: category.created,
    };
}
