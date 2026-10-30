import type { MetadataRoute } from "next";
import { getBuildCatalog } from "@/lib/catalog-server";
import {
    CONTENT_UPDATED,
    absoluteAssetUrl,
    absoluteUrl,
    categoryPath,
    productPath,
} from "@/lib/seo";

export const dynamic = "force-static";

const STATIC_PATHS = [
    "/",
    "/about",
    "/faq",
    "/shipping-returns",
    "/jewellery-care",
    "/privacy",
];

/** Every indexable URL, absolute, with no checkout and no invented freshness. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const catalog = await getBuildCatalog();
    const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
        url: absoluteUrl(path),
        lastModified: CONTENT_UPDATED,
    }));

    // Collections are catalogue-derived like product pages. They carry no
    // editorial revision date, so they must not claim CONTENT_UPDATED.
    for (const category of catalog.categories) {
        entries.push({
            url: absoluteUrl(categoryPath(category.slug)),
        });
    }

    for (const product of catalog.products) {
        const slug = catalog.slugByProductId[product.id];
        if (!slug) continue;
        const image = absoluteAssetUrl(product.image_url);
        entries.push({
            url: absoluteUrl(productPath(slug)),
            ...(image ? { images: [image] } : {}),
        });
    }

    return entries;
}
