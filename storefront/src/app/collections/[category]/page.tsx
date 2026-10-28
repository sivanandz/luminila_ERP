import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { ProductGrid } from "@/components/product/ProductGrid";
import { getBuildCatalog } from "@/lib/catalog-server";
import {
    SITE_NAME,
    SITE_URL,
    absoluteAssetUrl,
    breadcrumbJsonLd,
    categoryPath,
    collectionPageJsonLd,
} from "@/lib/seo";
import "../../catalog.css";

export const dynamicParams = false;

export async function generateStaticParams() {
    const catalog = await getBuildCatalog();
    return catalog.categories.map((category) => ({ category: category.slug }));
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ category: string }>;
}): Promise<Metadata> {
    const { category: slug } = await params;
    const catalog = await getBuildCatalog();
    const category = catalog.categories.find((entry) => entry.slug === slug);
    if (!category) return { title: "Collection not found" };

    const title = `${category.name} — South Indian-inspired imitation jewellery | ${SITE_NAME}`;
    const description = `Shop ${category.name.toLowerCase()} from ${SITE_NAME}: heritage-inspired imitation jewellery with gold-tone finishes, live prices and pan-India insured delivery.`;
    const image = `${SITE_URL}/niththigal/hero.webp`;

    return {
        title,
        description,
        alternates: { canonical: categoryPath(category.slug) },
        openGraph: {
            title,
            description,
            type: "website",
            siteName: SITE_NAME,
            locale: "en_IN",
            url: categoryPath(category.slug),
            images: [{ url: image, alt: `${category.name} from ${SITE_NAME}` }],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [image],
        },
        robots: { index: true, follow: true },
    };
}

export default async function CollectionPage({
    params,
}: {
    params: Promise<{ category: string }>;
}) {
    const { category: slug } = await params;
    const catalog = await getBuildCatalog();
    const category = catalog.categories.find((entry) => entry.slug === slug);
    if (!category) notFound();

    const products = catalog.products.filter(
        (product) =>
            (product.category || "").trim().toLowerCase() === category.name.toLowerCase()
    );
    const items = products
        .map((product) => {
            const productSlug = catalog.slugByProductId[product.id];
            if (!productSlug) return null;
            return {
                name: product.name,
                url: `/products/${productSlug}`,
                imageUrl: absoluteAssetUrl(product.image_url),
            };
        })
        .filter(
            (item): item is { name: string; url: string; imageUrl: string | null } =>
                item !== null
        );

    const breadcrumb = breadcrumbJsonLd([
        { name: "Home", url: "/" },
        { name: category.name, url: categoryPath(category.slug) },
    ]);
    const collection = collectionPageJsonLd({
        url: categoryPath(category.slug),
        name: `${category.name} from ${SITE_NAME}`,
        description: `Heritage-inspired ${category.name.toLowerCase()} in gold-tone finishes, made for everyday wear.`,
        items,
    });

    return (
        <>
            <JsonLd id="collection-jsonld" nodes={[collection, breadcrumb]} />
            <div className="section-pad">
                <nav className="product-breadcrumb" aria-label="Breadcrumb">
                    <Link href="/">Home</Link>
                    <span aria-hidden>/</span>
                    <span aria-current="page">{category.name}</span>
                </nav>

                <header className="collection-hero">
                    <div className="eyebrow">THE NITHTHIGAL COLLECTION</div>
                    <h1>{category.name}</h1>
                    <p>
                        Heritage-inspired {category.name.toLowerCase()} in gold-tone
                        finishes, made for the saree days, the coffee dates and every
                        version of you. Prices and stock are live; taxes are included.
                    </p>
                    <nav className="collection-nav" aria-label="Other collections">
                        <Link href="/">All pieces</Link>
                        {catalog.categories
                            .filter((entry) => entry.slug !== category.slug)
                            .map((entry) => (
                                <Link key={entry.slug} href={categoryPath(entry.slug)}>
                                    {entry.name}
                                </Link>
                            ))}
                    </nav>
                </header>

                <div style={{ marginTop: 36 }}>
                    <ProductGrid products={products} slugs={catalog.slugByProductId} />
                </div>

                <p className="product-purchase-note">
                    Looking for something else? <Link href="/">Browse every piece</Link> or{" "}
                    <Link href="/faq">read the FAQ</Link>.
                </p>
            </div>
        </>
    );
}
