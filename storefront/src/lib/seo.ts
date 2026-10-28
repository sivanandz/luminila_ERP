/**
 * Storefront SEO contract — constants, URL/slug rules and JSON-LD builders.
 *
 * Isomorphic by design: this module is imported by server components (the
 * static export prerender) and by client components (catalogue links), so it
 * must not import `fs`, `next/headers`, a PocketBase client instance or any
 * other server-only module. The only PocketBase import is type-only and is
 * erased at build time.
 *
 * Honesty rules (see docs/SEO_CONTRACT.md):
 * - Every value emitted here comes from the catalogue API, the CMS content or
 *   plainly visible site copy.
 * - No aggregateRating, review, address, telephone, email, sameAs, GTIN, MPN,
 *   priceValidUntil, shippingDetails or SearchAction unless the caller passes
 *   real data for the ones that accept it.
 * - Absolute URLs always derive from NEXT_PUBLIC_SITE_URL (local fallback),
 *   never from an invented production domain.
 *
 * @see docs/SEO_PLAN.md §3 (API contract) and docs/SEO_CONTRACT.md
 */

import type { StorefrontProduct } from "@/lib/pocketbase";

const FALLBACK_SITE_URL = "http://localhost:3001";

/**
 * Canonical storefront origin, without a trailing slash.
 * NEXT_PUBLIC_SITE_URL → NEXT_PUBLIC_STOREFRONT_URL → local fallback.
 */
export const SITE_URL: string = resolveSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.NEXT_PUBLIC_STOREFRONT_URL ||
        FALLBACK_SITE_URL
);

/** Brand name used in metadata and as the default schema.org publisher. */
export const SITE_NAME = "Niththigal";

/** Root description — the text the storefront already ships (layout.tsx:45-46). */
export const SITE_DESCRIPTION =
    "South Indian-inspired imitation jewellery. Heritage silhouettes, thoughtfully reimagined for everyday wear. Pan-India insured express shipping.";

/** Content language for schema.org `inLanguage`. */
export const SITE_LANGUAGE = "en";

/** Editorial revision date used as `dateModified`. Bump only on a copy change. */
export const CONTENT_UPDATED = "2026-10-28";

/** ISO 4217 code for every price the storefront publishes. */
export const CURRENCY = "INR";

/** A single JSON-LD node. Nodes are plain objects; callers shape them. */
export type JsonLdNode = Record<string, unknown>;

/** Minimal item shape for ItemList entry points. */
export type ItemSeo = { name: string; url: string; imageUrl?: string | null };

function resolveSiteUrl(value: string): string {
    const trimmed = (value || "").trim().replace(/\/+$/, "");
    if (!trimmed) return FALLBACK_SITE_URL;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:") return FALLBACK_SITE_URL;
        return trimmed;
    } catch {
        // A malformed env value must not fail the build; fall back locally.
        return FALLBACK_SITE_URL;
    }
}

/**
 * Resolve `path` against the canonical origin.
 * Absolute http(s) URLs are returned unchanged; every other value becomes a
 * same-origin path, so a link can never point at an invented host.
 */
export function absoluteUrl(path: string): string {
    const value = typeof path === "string" ? path.trim() : "";
    if (/^https?:\/\//i.test(value)) return value;
    if (!value) return `${SITE_URL}/`;
    return `${SITE_URL}${value.startsWith("/") ? value : `/${value}`}`;
}

const UNSAFE_ASSET_PREFIXES = ["data:", "blob:", "javascript:", "mailto:", "tel:"];

/**
 * Resolve an image URL that may be emitted in metadata or JSON-LD.
 * Returns null for empty, data:, blob:, javascript:, mailto:, tel: and
 * WhatsApp CDN URLs (whose tokens expire and whose hotlinking is unreliable).
 */
export function absoluteAssetUrl(value?: string | null): string | null {
    if (typeof value !== "string") return null;
    const raw = value.trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (UNSAFE_ASSET_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            if (isWhatsAppHost(url.hostname)) return null;
            return raw;
        } catch {
            return null;
        }
    }
    // Any other explicit scheme (ftp:, file:, …) and protocol-relative URLs
    // are not crawlable same-origin assets.
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    if (raw.startsWith("//")) return null;
    return absoluteUrl(raw);
}

function isWhatsAppHost(hostname: string): boolean {
    const host = (hostname || "").toLowerCase();
    return host === "whatsapp.net" || host.endsWith(".whatsapp.net");
}

/**
 * URL-safe slug: NFKD, strip combining marks, lower-case, "&" → " and ",
 * collapse every other run to "-", trim, cap at 80 characters.
 * Returns "" when nothing survives.
 */
export function slugify(value: string): string {
    const slug = String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, " and ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/g, "");
    return slug;
}

function slugForProduct(product: { id?: string; sku?: string; name?: string }): string {
    const sku = slugify(product.sku || "");
    if (sku) return sku;
    const name = slugify(product.name || "");
    if (name) return name;
    const id = slugify(product.id || "");
    return id ? `product-${id}` : "product";
}

/** SKU first (stable across renames), then name, then id. */
export function productSlug(p: Pick<StorefrontProduct, "id" | "sku" | "name">): string {
    return slugForProduct(p);
}

export function productPath(slug: string): string {
    return `/products/${slug}`;
}

/** Category name → URL slug; never empty ("jewellery" fallback). */
export function categorySlug(name: string): string {
    return slugify(name) || "jewellery";
}

export function categoryPath(slug: string): string {
    return `/collections/${slug}`;
}

/**
 * Deterministic product id → slug map.
 *
 * Products are ordered by (sku || name || id) so a collision always resolves
 * the same way: the first keeps the base slug, later ones get "-2", "-3", …
 * Callers must use the same map everywhere (links and the sitemap).
 */
export function buildProductSlugIndex(
    products: { id: string; sku?: string; name: string }[]
): Record<string, string> {
    const unique = new Map<string, { id: string; sku?: string; name: string }>();
    for (const product of products || []) {
        if (!product || typeof product.id !== "string" || !product.id) continue;
        if (!unique.has(product.id)) unique.set(product.id, product);
    }
    const sorted = [...unique.values()].sort((a, b) =>
        (a.sku || a.name || a.id).localeCompare(b.sku || b.name || b.id)
    );
    const index: Record<string, string> = {};
    const used = new Set<string>();
    for (const product of sorted) {
        const base = slugForProduct(product);
        let slug = base;
        let suffix = 2;
        while (used.has(slug)) {
            slug = `${base}-${suffix}`;
            suffix += 1;
        }
        used.add(slug);
        index[product.id] = slug;
    }
    return index;
}

const PREFERRED_CATEGORY_ORDER = ["Earrings", "Necklaces", "Bangles"];

/**
 * Category list in storefront reading order (Earrings → Necklaces → Bangles,
 * then alphabetical) with the same collision rule as product slugs.
 */
export function buildCategoryIndex(
    products: { category?: string }[]
): { name: string; slug: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const product of products || []) {
        const name = (product?.category || "").trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    const names = [...counts.keys()].sort((a, b) => {
        const ai = PREFERRED_CATEGORY_ORDER.indexOf(a);
        const bi = PREFERRED_CATEGORY_ORDER.indexOf(b);
        if (ai !== -1 || bi !== -1) {
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        }
        return a.localeCompare(b);
    });
    const used = new Set<string>();
    return names.map((name) => {
        const base = categorySlug(name);
        let slug = base;
        let suffix = 2;
        while (used.has(slug)) {
            slug = `${base}-${suffix}`;
            suffix += 1;
        }
        used.add(slug);
        return { name, slug, count: counts.get(name) || 0 };
    });
}

/**
 * Google product taxonomy IDs verified for this project (docs/SEO_BRIEF.md
 * §3). Bangles deliberately maps to Bracelets (191), the closest node.
 * Unknown categories return null — never a guess.
 */
export const GOOGLE_PRODUCT_CATEGORY_IDS: Readonly<Record<string, number>> = {
    anklets: 189,
    bangles: 191,
    bracelets: 191,
    charms: 192,
    earrings: 194,
    jewellery: 188,
    jewelry: 188,
    necklaces: 196,
    pendants: 192,
    rings: 200,
    sets: 6463,
};

/** Case-insensitive singular/plural lookup; null when unmapped. */
export function googleProductCategoryId(category?: string | null): number | null {
    const raw = (category || "").trim().toLowerCase();
    if (!raw) return null;
    const direct = GOOGLE_PRODUCT_CATEGORY_IDS[raw];
    if (typeof direct === "number") return direct;
    if (raw.endsWith("s")) {
        const value = GOOGLE_PRODUCT_CATEGORY_IDS[raw.slice(0, -1)];
        return typeof value === "number" ? value : null;
    }
    const value = GOOGLE_PRODUCT_CATEGORY_IDS[`${raw}s`];
    return typeof value === "number" ? value : null;
}

/**
 * Serialise JSON-LD for a <script> element.
 *
 * Escapes <, >, & and the JS line separators so a catalogue string cannot
 * close the script tag or break the parser. Stringify failures yield "{}" —
 * a broken node must never break the page.
 */
export function serializeJsonLd(value: unknown): string {
    try {
        const json = JSON.stringify(value);
        if (typeof json !== "string") return "{}";
        return json
            .replace(/</g, "\\u003c")
            .replace(/>/g, "\\u003e")
            .replace(/&/g, "\\u0026")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029");
    } catch {
        return "{}";
    }
}

/** One `@graph` document containing every non-empty node. */
export function jsonLdGraph(nodes: (JsonLdNode | null | undefined)[]): JsonLdNode {
    return {
        "@context": "https://schema.org",
        "@graph": (nodes || []).filter(
            (node): node is JsonLdNode => Boolean(node) && typeof node === "object"
        ),
    };
}

function cleanText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
    if (!/^https?:\/\//i.test(value)) return false;
    try {
        const url = new URL(value);
        return !isWhatsAppHost(url.hostname);
    } catch {
        return false;
    }
}

const RETURN_POLICY: JsonLdNode = {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "IN",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 7,
};

/**
 * Organization / OnlineStore for the whole site.
 *
 * `hasMerchantReturnPolicy` mirrors the visible 7-day return promise
 * (collection copy + shipping policy). It is the only place this property is
 * allowed: Offer-level policies/rates stay omitted because the site states no
 * shipping rate and no price expiry.
 */
export function organizationJsonLd(input?: {
    name?: string;
    description?: string;
    logoUrl?: string | null;
    sameAs?: string[];
    telephone?: string;
    email?: string;
}): JsonLdNode {
    const name = cleanText(input?.name) || SITE_NAME;
    const description = cleanText(input?.description);
    const logo = absoluteAssetUrl(input?.logoUrl);
    const sameAs = Array.from(
        new Set(
            (input?.sameAs || [])
                .map((value) => cleanText(value))
                .filter((value) => value && isHttpUrl(value))
        )
    );
    const telephone = cleanText(input?.telephone);
    const email = cleanText(input?.email);

    const node: JsonLdNode = {
        "@type": "OnlineStore",
        "@id": `${SITE_URL}/#organization`,
        name,
        url: `${SITE_URL}/`,
        hasMerchantReturnPolicy: RETURN_POLICY,
    };
    if (description) node.description = description;
    if (logo) node.logo = { "@type": "ImageObject", url: logo };
    if (sameAs.length) node.sameAs = sameAs;
    if (telephone || email) {
        node.contactPoint = {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(telephone ? { telephone } : {}),
            ...(email ? { email } : {}),
        };
    }
    // Deliberately never: address, aggregateRating, review, foundingDate.
    return node;
}

/**
 * WebSite for the whole site. No `potentialAction`: search is a dialog, not a
 * URL, so a SearchAction would describe a target that does not exist.
 */
export function webSiteJsonLd(input?: { name?: string }): JsonLdNode {
    return {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: cleanText(input?.name) || SITE_NAME,
        inLanguage: SITE_LANGUAGE,
        publisher: { "@id": `${SITE_URL}/#organization` },
    };
}

/** BreadcrumbList built from a user path; null when fewer than two steps. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLdNode | null {
    const steps = (items || []).filter(
        (item) => cleanText(item?.name) && cleanText(item?.url)
    );
    if (steps.length < 2) return null;
    return {
        "@type": "BreadcrumbList",
        itemListElement: steps.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: cleanText(item.name),
            item: absoluteUrl(item.url),
        })),
    };
}

function availabilityUrl(inStock: boolean): string {
    return inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
}

function isProductInStock(product: StorefrontProduct): boolean {
    if (product.stock_status === "out_of_stock") return false;
    return Number(product.total_stock) > 0;
}

function buildOffer(
    product: StorefrontProduct,
    url: string,
    inStock: boolean
): JsonLdNode | null {
    const price = Number(product.website_price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
        "@type": "Offer",
        price: price.toFixed(2),
        priceCurrency: CURRENCY,
        availability: availabilityUrl(inStock),
        itemCondition: "https://schema.org/NewCondition",
        url,
    };
}

/**
 * `categoryId` is the mapped Google taxonomy id for the merchant feed.
 * Schema.org has no numeric Google-category field and the taxonomy path is not
 * available from the catalogue, so Product.category carries the visible
 * category text and `categoryId` is accepted for forward compatibility only.
 */
export interface ProductSeoInput {
    product: StorefrontProduct;
    url: string;
    /** Optional on purpose: an absent image is treated exactly like null. */
    imageUrl?: string | null;
    categoryId: number | null;
    brandName?: string;
}

/**
 * Product node for a single-variant product page.
 *
 * `offers` appears only when the catalogue supplies a positive price; there is
 * no price expiry, shipping rate or return-policy override to add.
 */
export function productJsonLd(input: ProductSeoInput): JsonLdNode {
    const product = input.product;
    const url = absoluteUrl(input.url);
    const image = absoluteAssetUrl(input.imageUrl);
    const sku = cleanText(product.sku);
    const node: JsonLdNode = {
        "@type": "Product",
        "@id": `${url}#product`,
        name: cleanText(product.name) || SITE_NAME,
        brand: {
            "@type": "Brand",
            name: cleanText(input.brandName) || SITE_NAME,
        },
    };
    if (sku) node.sku = sku;
    const description = cleanText(product.description);
    if (description) node.description = description;
    if (image) node.image = image;
    const category = cleanText(product.category);
    if (category) node.category = category;
    const material = cleanText(product.base_metal);
    if (material) node.material = material;
    const offer = buildOffer(product, url, isProductInStock(product));
    if (offer) node.offers = offer;
    return node;
}

export interface ProductGroupSeoInput {
    product: StorefrontProduct;
    url: string;
    /** Optional on purpose: an absent image is treated exactly like null. */
    imageUrl?: string | null;
    categoryId: number | null;
    brandName?: string;
    variesBy?: "size";
    variants: { id: string; label: string; url: string; stock: number }[];
}

/** Sanitise a variant label/id into a stable SKU segment ("2.4" stays "2.4"). */
function variantToken(value: string): string {
    return String(value || "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(0, 32);
}

function variantSku(
    product: StorefrontProduct,
    variant: { id: string; label: string },
    used: Set<string>
): string {
    const base = cleanText(product.sku);
    const tail = variantToken(variant.label) || variantToken(variant.id);
    const seed =
        base && tail
            ? `${base}-${tail}`
            : base || tail || `${cleanText(product.id) || "product"}-variant`;
    let sku = seed;
    let suffix = 2;
    while (used.has(sku.toLowerCase())) {
        sku = `${seed}-${suffix}`;
        suffix += 1;
    }
    used.add(sku.toLowerCase());
    return sku;
}

/**
 * ProductGroup node for a product with two or more selectable variants.
 *
 * Correction to the plan: every `hasVariant` Product carries its own unique
 * `sku`, derived from the product SKU plus the variant label (or variant id
 * when the label sanitises to nothing) — e.g. "BGL-NILA-HERITAGE-2.4".
 * That is a storefront identifier, never a manufacturer MPN.
 *
 * Returns null when there are fewer than two variants: a lone variant is a
 * plain Product and must not be wrapped in a group.
 */
export function productGroupJsonLd(input: ProductGroupSeoInput): JsonLdNode | null {
    const variants = Array.isArray(input.variants) ? input.variants : [];
    if (variants.length < 2) return null;
    const product = input.product;
    const groupUrl = absoluteUrl(input.url);
    const image = absoluteAssetUrl(input.imageUrl);
    const brandName = cleanText(input.brandName) || SITE_NAME;
    const usedSkus = new Set<string>();

    const group: JsonLdNode = {
        "@type": "ProductGroup",
        "@id": `${groupUrl}#productgroup`,
        name: cleanText(product.name) || SITE_NAME,
        productGroupID: cleanText(product.id) || groupUrl,
        url: groupUrl,
        brand: { "@type": "Brand", name: brandName },
        hasVariant: variants.map((variant) => {
            const variantUrl = absoluteUrl(variant.url);
            const label = cleanText(variant.label);
            const node: JsonLdNode = {
                "@type": "Product",
                "@id": `${variantUrl}#product`,
                name: label ? `${cleanText(product.name)} — ${label}` : cleanText(product.name),
                sku: variantSku(product, variant, usedSkus),
                brand: { "@type": "Brand", name: brandName },
                isVariantOf: { "@id": `${groupUrl}#productgroup` },
            };
            if (image) node.image = image;
            const inStock = Number(variant.stock) > 0;
            const offer = buildOffer(product, variantUrl, inStock);
            if (offer) node.offers = offer;
            return node;
        }),
    };
    if (input.variesBy) group.variesBy = `https://schema.org/${input.variesBy}`;
    const description = cleanText(product.description);
    if (description) group.description = description;
    const material = cleanText(product.base_metal);
    if (material) group.material = material;
    if (image) group.image = image;
    return group;
}

/** ItemList; null when there is nothing to list. */
export function itemListJsonLd(items: ItemSeo[], name?: string): JsonLdNode | null {
    const entries = (items || []).filter(
        (item) => cleanText(item?.name) && cleanText(item?.url)
    );
    if (!entries.length) return null;
    const node: JsonLdNode = {
        "@type": "ItemList",
        numberOfItems: entries.length,
        itemListElement: entries.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: cleanText(item.name),
            url: absoluteUrl(item.url),
        })),
    };
    const label = cleanText(name);
    if (label) node.name = label;
    return node;
}

/** CollectionPage with an embedded ItemList; no Product/Offer nodes. */
export function collectionPageJsonLd(input: {
    url: string;
    name: string;
    description?: string;
    items: ItemSeo[];
}): JsonLdNode {
    const url = absoluteUrl(input.url);
    const node: JsonLdNode = {
        "@type": "CollectionPage",
        "@id": `${url}#collection`,
        url,
        name: cleanText(input.name) || SITE_NAME,
        isPartOf: { "@id": `${SITE_URL}/#website` },
    };
    const description = cleanText(input.description);
    if (description) node.description = description;
    const list = itemListJsonLd(input.items, input.name);
    if (list) node.mainEntity = list;
    return node;
}

/**
 * FAQPage markup for visible CMS questions.
 *
 * Google retired the FAQ rich result in 2026; this is valid schema.org markup
 * only and must never be presented as a rich-result opportunity.
 */
export function faqPageJsonLd(input: {
    url: string;
    items: { question: string; answer: string }[];
}): JsonLdNode | null {
    const entries = (input.items || []).filter(
        (item) => cleanText(item?.question) && cleanText(item?.answer)
    );
    if (!entries.length) return null;
    return {
        "@type": "FAQPage",
        "@id": `${absoluteUrl(input.url)}#faq`,
        mainEntity: entries.map((item) => ({
            "@type": "Question",
            name: cleanText(item.question),
            acceptedAnswer: {
                "@type": "Answer",
                text: cleanText(item.answer),
            },
        })),
    };
}

/** WebPage / AboutPage node for the editorial and policy pages. */
export function webPageJsonLd(input: {
    type?: "WebPage" | "AboutPage";
    url: string;
    name: string;
    description?: string;
}): JsonLdNode {
    const url = absoluteUrl(input.url);
    const node: JsonLdNode = {
        "@type": input.type || "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: cleanText(input.name) || SITE_NAME,
        inLanguage: SITE_LANGUAGE,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        dateModified: CONTENT_UPDATED,
    };
    const description = cleanText(input.description);
    if (description) node.description = description;
    return node;
}
