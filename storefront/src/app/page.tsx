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
import {
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

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

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
    return (
        <section className="section-pad" aria-labelledby="seo-intro-title">
            <div className="section-heading">
                <div>
                    <div className="eyebrow">THE NITHTHIGAL EDIT</div>
                    <h2 id="seo-intro-title">
                        South Indian-inspired imitation jewellery, made for everyday wear
                    </h2>
                </div>
                <p>
                    Heritage silhouettes, gold-tone finishes and the little details that
                    make an ordinary day feel special.
                </p>
            </div>

            <div className="seo-intro-grid">
                <div className="seo-intro-card">
                    <h3>What it is</h3>
                    <p>
                        Niththigal is an imitation jewellery label inspired by South
                        Indian silhouettes — temple necklaces, jhumkas and bangles — not
                        solid gold.
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
                        Live prices are shown on every piece. Taxes are included;
                        delivery is calculated at checkout.
                    </p>
                </div>
                <div className="seo-intro-card">
                    <h3>Delivery &amp; returns</h3>
                    <p>
                        Pan-India insured express dispatch in 24–48 hours, with a 7-day
                        return promise.
                    </p>
                </div>
            </div>

            <div className="seo-intro-links">
                {catalog.categories.map((category) => (
                    <Link key={category.slug} href={categoryPath(category.slug)}>
                        Shop {category.name}
                    </Link>
                ))}
                <Link href="/about">About Niththigal</Link>
                <Link href="/faq">FAQ</Link>
                <Link href="/shipping-returns">Shipping &amp; returns</Link>
                <Link href="/jewellery-care">Jewellery care</Link>
            </div>

            {featured.length ? (
                <div style={{ marginTop: 24 }}>
                    <h3 className="seo-intro-card" style={{ borderTop: 0, paddingTop: 0 }}>
                        A few favourites
                    </h3>
                    <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                        {featured.map((product) => {
                            const slug = catalog.slugByProductId[product.id];
                            if (!slug) return null;
                            return (
                                <li key={product.id} style={{ marginBottom: 6 }}>
                                    <Link href={productPath(slug)}>{product.name}</Link>{" "}
                                    <span style={{ color: "var(--muted)", fontSize: 13 }}>
                                        {money(product.website_price)}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : null}
        </section>
    );
}

export default async function NiththigalStorefrontPage() {
    const [{ content }, catalog] = await Promise.all([
        getSiteContent(),
        getBuildCatalog(),
    ]);
    const sections = [...content.sections]
        .filter((section) => section.enabled)
        .sort((a, b) => a.order - b.order);

    const render = {
        hero: <Hero content={content} />,
        promise: <PromiseStrip items={content.promise.items} />,
        collection: <Collection />,
        promo: <Promo content={content} />,
        story: <Story content={content} />,
        benefits: <Benefits content={content} />,
        testimonials: <Testimonials content={content} />,
        instagram: <Instagram content={content} />,
        pricing: <Pricing content={content} />,
        faq: <Faq content={content} />,
        finalCta: <FinalCta content={content} />,
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
        `Shop ${content.brand.name}`
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
                        <AeoBlock content={content} catalog={catalog} />
                    ) : null}
                </Fragment>
            ))}
            {hasCollection ? null : <AeoBlock content={content} catalog={catalog} />}
        </>
    );
}
