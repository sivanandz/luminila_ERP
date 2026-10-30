import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { Collection } from "@/components/niththigal/Collection";
import {
    Benefits,
    Faq,
    FinalCta,
    Hero,
    Instagram,
    Pricing,
    Promo,
    PromiseStrip,
    Story,
    Testimonials,
} from "@/components/niththigal/sections";
import { JsonLd } from "@/components/seo/JsonLd";
import { getBuildCatalog, type BuildCatalog } from "@/lib/catalog-server";
import { getSiteContent } from "@/lib/site-content-server";
import type { NiththigalContent } from "@/lib/niththigal-content-data";
import { trimBrandAssets } from "@/lib/niththigal-content-data";
import {
    CONTENT_UPDATED,
    absoluteAssetUrl,
    categoryPath,
    itemListJsonLd,
    productPath,
} from "@/lib/seo";
import "./catalog.css";

export const metadata: Metadata = {
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
};

/**
 * Answer-first content that a search snippet or an AI answer can quote.
 * Every statement is grounded in the storefront's own copy or catalogue.
 */
function AeoBlock({
    content,
    catalog,
}: {
    content: NiththigalContent;
    catalog: BuildCatalog;
}) {
    const featured = catalog.products.slice(0, 3);
    const brand = content.brand.name;

    return (
        <section className="section-pad" aria-labelledby="seo-intro-title">
            <div className="section-heading">
                <div>
                    <div className="eyebrow">THE NITHTHIGAL EDIT</div>
                    <h2 id="seo-intro-title">
                        {brand}: South Indian-inspired imitation jewellery, made
                        for everyday wear
                    </h2>
                </div>
                <p>
                    {brand} is a South Indian-inspired imitation jewellery label.
                    It reimagines familiar silhouettes — temple necklaces, jhumkas
                    and bangles — in gold-tone finishes, made for everyday wear.
                    Prices and stock are shown live on each product page; taxes are
                    included, and delivery is calculated at checkout.
                </p>
            </div>

            <div className="seo-intro-grid">
                <div className="seo-intro-card">
                    <h3>What it is</h3>
                    <p>
                        {brand} is an imitation jewellery label inspired by South
                        Indian silhouettes — temple necklaces, jhumkas and bangles —
                        not solid gold.
                    </p>
                </div>
                <div className="seo-intro-card">
                    <h3>Materials</h3>
                    <p>
                        Skin-friendly alloy bases with multi-layer micro gold plating,
                        finished with heritage-inspired details.
                    </p>
                </div>
                <div className="seo-intro-card">
                    <h3>Price</h3>
                    <p>
                        Live prices are shown on every product page. Taxes are
                        included; delivery is calculated at checkout.
                    </p>
                </div>
                <div className="seo-intro-card">
                    <h3>Delivery &amp; returns</h3>
                    <p>
                        Pan-India insured express dispatch in 24–48 hours, with a 7-day
                        return promise.
                    </p>
                </div>
                <div className="seo-intro-card">
                    <h3>Jewellery care</h3>
                    <p>
                        Keep imitation jewellery away from water, perfume and harsh
                        chemicals; wipe it with a soft, dry cloth and store each piece
                        separately.
                    </p>
                </div>
            </div>

            <div className="seo-intro-links">
                {catalog.categories.length ? (
                    catalog.categories.map((category) => (
                        <Link key={category.slug} href={categoryPath(category.slug)}>
                            Shop {category.name}
                        </Link>
                    ))
                ) : (
                    <Link href="/#collection">Shop all pieces</Link>
                )}
                <Link href="/about">About {brand}</Link>
                <Link href="/faq">FAQ</Link>
                <Link href="/shipping-returns">Shipping &amp; returns</Link>
                <Link href="/jewellery-care">Jewellery care</Link>
                <Link href="/privacy">Privacy &amp; terms</Link>
            </div>

            {featured.length ? (
                <div style={{ marginTop: 24 }}>
                    <h3 style={{ borderTop: 0, paddingTop: 0 }}>A few favourites</h3>
                    <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                        {featured.map((product) => {
                            const slug = catalog.slugByProductId[product.id];
                            if (!slug) return null;
                            return (
                                <li key={product.id} style={{ marginBottom: 6 }}>
                                    <Link href={productPath(slug)}>{product.name}</Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : null}

            <p className="product-purchase-note">
                Reviewed {CONTENT_UPDATED}. Prices and stock are shown live on each
                product page.
            </p>
        </section>
    );
}

export default async function NiththigalStorefrontPage() {
    const [{ content }, catalog] = await Promise.all([
        getSiteContent(),
        getBuildCatalog(),
    ]);
    // Strip data-URL brand assets before the content crosses to the client
    // section components, so the 336 KB wordmark stays out of the initial RSC
    // payload. The header/footer provider restores it after hydration.
    const pageContent = trimBrandAssets(content);
    const sections = [...pageContent.sections]
        .filter((section) => section.enabled)
        .sort((a, b) => a.order - b.order);

    const render = {
        hero: <Hero content={pageContent} />,
        promise: <PromiseStrip items={pageContent.promise.items} />,
        collection: <Collection />,
        promo: <Promo content={pageContent} />,
        story: <Story content={pageContent} />,
        benefits: <Benefits content={pageContent} />,
        testimonials: <Testimonials content={pageContent} />,
        instagram: <Instagram content={pageContent} />,
        pricing: <Pricing content={pageContent} />,
        faq: <Faq content={pageContent} />,
        finalCta: <FinalCta content={pageContent} />,
    };

    const itemListItems = catalog.products.flatMap((product) => {
        const slug = catalog.slugByProductId[product.id];
        if (!slug) return [];
        return [
            {
                name: product.name,
                url: productPath(slug),
                imageUrl: absoluteAssetUrl(product.image_url),
            },
        ];
    });
    const itemList = itemListJsonLd(
        itemListItems,
        `Shop ${pageContent.brand.name}`
    );
    const hasCollection = sections.some((section) => section.id === "collection");

    return (
        <>
            <JsonLd id="home-jsonld" nodes={[itemList]} />
            {sections.map((section) => (
                <Fragment key={section.id}>
                    <div
                        className="nt-section-slot"
                        data-section={section.id}
                        style={{
                            paddingTop: Math.max(0, section.spaceBefore || 0),
                            paddingBottom: Math.max(0, section.spaceAfter || 0),
                        }}
                    >
                        {render[section.id]}
                    </div>
                    {section.id === "collection" ? (
                        <AeoBlock content={pageContent} catalog={catalog} />
                    ) : null}
                </Fragment>
            ))}
            {hasCollection ? null : <AeoBlock content={pageContent} catalog={catalog} />}
        </>
    );
}
