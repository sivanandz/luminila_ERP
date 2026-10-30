/**
 * Build-time catalogue for the static export.
 *
 * Product and collection pages are prerendered, so the export needs the whole
 * catalogue before a browser exists. This module:
 *   1. GETs the ERP's public /api/storefront/catalog route,
 *   2. validates and normalises every entry (malformed records are dropped),
 *   3. applies the same display order as the client catalogue provider,
 *   4. builds the slug index the pages, sitemap, feed and llms.txt share.
 *
 * Failure policy: never throw. ERP down → optional JSON snapshot → empty list.
 * An empty catalogue produces no product pages; it never produces fake ones.
 */

import { cache } from "react";
import type { StorefrontProduct, StorefrontVariant } from "@/lib/pocketbase";
import { sortCatalogProducts } from "@/lib/catalog-sort";
import {
    buildCategoryIndex,
    buildProductSlugIndex,
    type ItemSeo,
} from "@/lib/seo";
import {
    describeError,
    fetchJson,
    storefrontApiEndpoint,
} from "@/lib/site-content-server";

/** Maximum products serialised into the initial client payload. */
export const INITIAL_CATALOG_LIMIT = 120;

/**
 * Conventional snapshot file, read from the build directory (the storefront
 * root, or the isolated copy build-static-isolated.mjs creates). The path is a
 * compile-time literal on purpose: the file is never selected dynamically.
 */
export const SNAPSHOT_FILE_NAME = "catalog-snapshot.json";

export interface BuildCategory {
    name: string;
    slug: string;
    count: number;
}

export interface BuildCatalog {
    products: StorefrontProduct[];
    slugByProductId: Record<string, string>;
    productBySlug: Record<string, StorefrontProduct>;
    categories: BuildCategory[];
    source: "erp" | "snapshot" | "empty";
}

const SUB_STYLES: StorefrontProduct["sub_style"][] = [
    "Temple",
    "Kundan",
    "Antique",
    "Zircon",
    "Bridal",
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
}

function asStockStatus(
    value: unknown,
    totalStock: number
): StorefrontProduct["stock_status"] {
    if (value === "in_stock" || value === "low_stock" || value === "out_of_stock") {
        return value;
    }
    if (totalStock <= 0) return "out_of_stock";
    return totalStock <= 3 ? "low_stock" : "in_stock";
}

function normalizeVariant(raw: unknown): StorefrontVariant | null {
    if (!isRecord(raw)) return null;
    const id = asString(raw.id).trim();
    if (!id) return null;
    return {
        id,
        label: asString(raw.label).trim() || "Standard",
        stock_level: Math.max(0, Math.round(asNumber(raw.stock_level))),
    };
}

function optionalText(value: unknown): string | undefined {
    const text = asString(value).trim();
    return text || undefined;
}

/**
 * Validate one catalogue record. Id and name are the minimum a product page
 * can honestly render; everything else is coerced or dropped.
 */
export function normalizeProduct(raw: unknown): StorefrontProduct | null {
    if (!isRecord(raw)) return null;
    const id = asString(raw.id).trim();
    const name = asString(raw.name).trim();
    if (!id || !name) return null;

    const variants = Array.isArray(raw.variants)
        ? raw.variants
              .map(normalizeVariant)
              .filter((variant): variant is StorefrontVariant => variant !== null)
        : [];
    const variantStock = variants.reduce((sum, variant) => sum + variant.stock_level, 0);
    const totalStock = Math.max(0, Math.round(asNumber(raw.total_stock))) || variantStock;

    const subStyle = optionalText(raw.sub_style) as StorefrontProduct["sub_style"];
    const websitePrice = Math.max(0, asNumber(raw.website_price));

    return {
        id,
        sku: asString(raw.sku).trim(),
        name,
        category: optionalText(raw.category),
        sub_style: subStyle && SUB_STYLES.includes(subStyle) ? subStyle : undefined,
        description: optionalText(raw.description),
        base_price: Math.max(0, asNumber(raw.base_price)),
        website_price: websitePrice,
        mrp: Math.max(0, asNumber(raw.mrp)),
        image_url: optionalText(raw.image_url),
        total_stock: totalStock,
        stock_status: asStockStatus(raw.stock_status, totalStock),
        variants,
        base_metal: asString(raw.base_metal).trim(),
        plating_type: asString(raw.plating_type).trim(),
        stone_type: optionalText(raw.stone_type),
        occasion: optionalText(raw.occasion),
        care_instructions: optionalText(raw.care_instructions),
    };
}

/** Accept both {"success":true,"products":[…]} and a bare product array. */
function parseProductList(value: unknown): StorefrontProduct[] | null {
    let records: unknown[] | null = null;
    if (Array.isArray(value)) {
        records = value;
    } else if (isRecord(value) && value.success === true && Array.isArray(value.products)) {
        records = value.products;
    }
    if (!records) return null;
    return records
        .map(normalizeProduct)
        .filter((product): product is StorefrontProduct => product !== null);
}

/**
 * True when the build may read the conventional snapshot.
 *
 * STOREFRONT_CATALOG_SNAPSHOT must be exactly SNAPSHOT_FILE_NAME: the file is
 * read from the build directory by that literal name, so no operator value can
 * steer the read anywhere else.
 */
export function snapshotRequested(setting: string): boolean {
    const raw = (setting || "").trim();
    if (!raw) return false;
    if (raw !== SNAPSHOT_FILE_NAME) {
        console.warn(
            `[seo] STOREFRONT_CATALOG_SNAPSHOT must be "${SNAPSHOT_FILE_NAME}" in the build directory; ignoring "${raw}".`
        );
        return false;
    }
    return true;
}

async function loadSnapshot(): Promise<StorefrontProduct[] | null> {
    try {
        const { readFile } = await import("node:fs/promises");
        const raw = await readFile(SNAPSHOT_FILE_NAME, "utf8");
        return parseProductList(JSON.parse(raw) as unknown);
    } catch (error) {
        console.warn(`[seo] Could not read the catalogue snapshot "${SNAPSHOT_FILE_NAME}".`, error);
        return null;
    }
}

function buildCatalog(
    products: StorefrontProduct[],
    source: BuildCatalog["source"]
): BuildCatalog {
    const slugByProductId = buildProductSlugIndex(products);
    const productBySlug: Record<string, StorefrontProduct> = {};
    const items: ItemSeo[] = [];
    for (const product of products) {
        const slug = slugByProductId[product.id];
        if (!slug) continue;
        if (!productBySlug[slug]) productBySlug[slug] = product;
        items.push({ name: product.name, url: `/products/${slug}`, imageUrl: product.image_url });
    }
    return {
        products,
        slugByProductId,
        productBySlug,
        categories: buildCategoryIndex(products),
        source,
    };
}

async function loadBuildCatalog(): Promise<BuildCatalog> {
    const url = storefrontApiEndpoint("/api/storefront/catalog");
    let products: StorefrontProduct[] | null = null;
    let source: BuildCatalog["source"] = "empty";

    if (url) {
        try {
            const parsed = parseProductList(await fetchJson(url));
            if (parsed) {
                products = parsed;
                // The API answered. An empty answer is a real empty catalogue,
                // not a reason to substitute the snapshot.
                source = "erp";
            } else {
                console.warn(`[seo] ${url} returned an unexpected payload.`);
            }
        } catch (error) {
            console.warn(`[seo] Could not load the catalogue from ${url}: ${describeError(error)}`);
        }
    }

    if (products === null && snapshotRequested(process.env.STOREFRONT_CATALOG_SNAPSHOT || "")) {
        const loaded = await loadSnapshot();
        if (loaded) {
            products = loaded;
            source = "snapshot";
        }
    }

    return buildCatalog(sortCatalogProducts(products ?? []), source);
}

/** Module-level promise: one fetch per build worker, not one per page. */
let buildCatalogPromise: Promise<BuildCatalog> | null = null;

function loadBuildCatalogOnce(): Promise<BuildCatalog> {
    if (!buildCatalogPromise) {
        buildCatalogPromise = loadBuildCatalog().catch((error) => {
            console.warn("[seo] Catalogue build failed; continuing with an empty catalogue.", error);
            return buildCatalog([], "empty");
        });
    }
    return buildCatalogPromise;
}

/** Cached build-time catalogue. Never rejects. */
export const getBuildCatalog = cache((): Promise<BuildCatalog> => loadBuildCatalogOnce());
