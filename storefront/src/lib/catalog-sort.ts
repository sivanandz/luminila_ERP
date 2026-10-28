import type { StorefrontProduct } from "@/lib/pocketbase";

const PREFERRED_CATEGORY_ORDER = ["Earrings", "Necklaces", "Bangles"];

/**
 * Display order shared by the build-time catalogue, the client provider and
 * the sitemap: Earrings, Necklaces, Bangles first, then the product name.
 */
export function sortCatalogProducts(products: StorefrontProduct[]): StorefrontProduct[] {
    const rank = (category?: string) => {
        const index = PREFERRED_CATEGORY_ORDER.indexOf((category || "").trim());
        return index === -1 ? 99 : index;
    };
    return [...products].sort(
        (a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name)
    );
}
