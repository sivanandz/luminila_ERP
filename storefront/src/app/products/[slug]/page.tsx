import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { ProductGrid } from "@/components/product/ProductGrid";
import { ProductPurchase } from "@/components/product/ProductPurchase";
import { getBuildCatalog } from "@/lib/catalog-server";
import type { StorefrontProduct } from "@/lib/pocketbase";
import { getSiteContent } from "@/lib/site-content-server";
import {
    SITE_NAME,
    SITE_URL,
    absoluteAssetUrl,
    breadcrumbJsonLd,
    categoryPath,
    categorySlug,
    googleProductCategoryId,
    productGroupJsonLd,
    productJsonLd,
} from "@/lib/seo";
import "../../catalog.css";

/**
 * Every product page is prerendered from the build catalogue. An unknown slug
 * is a 404, never a client-rendered shell with empty Product markup.
 */
export const dynamicParams = false;

/**
 * Display labels for the catalogue's plating/metal/occasion codes. Mirrors the
 * quick-view dialog (NtDialogs.tsx) so the same product cannot describe itself
 * differently on two surfaces.
 */
const METAL_LABELS: Record<string, string> = {
    brass: "Skin-safe brass alloy",
    copper: "Skin-safe copper alloy",
    red_copper: "Skin-safe red-copper alloy",
    alloy: "Skin-safe alloy",
    silver: "Sterling silver",
};

const PLATING_LABELS: Record<string, string> = {
    micro_gold_1gm: "22K micron gold plating",
    micro_gold: "Micro gold plating",
    gold_plated: "Gold plating",
    rhodium: "Rhodium finish",
    antique_matte: "Antique matte finish",
    oxidised: "Oxidised finish",
};

const OCCASION_LABELS: Record<string, string> = {
    bridal: "Bridal & wedding",
    festive: "Festive occasions",
    daily: "Everyday wear",
    party: "Evening occasions",
};

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

function clean(value?: string | null): string {
    return (value || "").trim();
}

/** Humanise a catalogue code; unknown values keep their words, not a guess. */
function humanize(value: string | undefined, labels: Record<string, string>): string {
    const text = clean(value);
    if (!text) return "";
    return (
        labels[text.toLowerCase()] ||
        text.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    );
}

/** First paragraph of a multi-paragraph CMS string. */
function firstParagraph(value?: string | null): string {
    return clean(value).split(/\n{2,}/)[0].trim();
}

/** Keep meta descriptions near the 150-160 character display range. */
function metaDescription(value: string): string {
    const text = value.trim();
    if (text.length <= 160) return text;
    const cut = text.slice(0, 157);
    const lastSpace = cut.lastIndexOf(" ");
    return `${cut.slice(0, lastSpace > 100 ? lastSpace : 157)}…`;
}

/** Visible availability text from the catalogue's real stock numbers. */
function stockLabelFor(
    product: Pick<StorefrontProduct, "stock_status" | "total_stock">
): string {
    if (product.stock_status === "out_of_stock" || product.total_stock <= 0) {
        return "Sold out";
    }
    if (product.stock_status === "low_stock" || product.total_stock <= 3) {
        return `Only ${product.total_stock} left`;
    }
    return "In stock";
}

export async function generateStaticParams() {
    const catalog = await getBuildCatalog();
    return catalog.products
        .map((product) => ({ slug: catalog.slugByProductId[product.id] }))
        .filter((entry): entry is { slug: string } => Boolean(entry.slug));
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const catalog = await getBuildCatalog();
    const product = catalog.productBySlug[slug];
    if (!product) {
        return { title: "Product not found", robots: { index: false, follow: false } };
    }

    const category = clean(product.category) || "Jewellery";
    const title = `${product.name} — ${category} | ${SITE_NAME}`;
    const description = metaDescription(
        clean(product.description) ||
            `${product.name}, ${category.toLowerCase()} from ${SITE_NAME}: South Indian-inspired imitation jewellery with live price and availability.`
    );
    // Only a crawlable product image may be advertised to social crawlers; a
    // data URL is not shareable, so the brand campaign image stands in.
    const productImage = absoluteAssetUrl(product.image_url);
    const image = productImage ?? `${SITE_URL}/niththigal/hero.webp`;
    const imageAlt = productImage
        ? `${product.name}, ${category.toLowerCase()} from ${SITE_NAME}`
        : `${SITE_NAME} campaign imagery`;

    return {
        title,
        description,
        alternates: { canonical: `/products/${slug}` },
        openGraph: {
            title,
            description,
            type: "website",
            siteName: SITE_NAME,
            locale: "en_IN",
            url: `/products/${slug}`,
            images: [{ url: image, alt: imageAlt }],
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

export default async function ProductPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const [catalog, { content }] = await Promise.all([
        getBuildCatalog(),
        getSiteContent(),
    ]);
    const product = catalog.productBySlug[slug];
    if (!product) notFound();

    const categoryName = clean(product.category) || "Jewellery";
    const category = catalog.categories.find((entry) => entry.name === categoryName);
    const categoryUrl = categoryPath(category?.slug || categorySlug(categoryName));
    const variants = product.variants.length
        ? product.variants
        : [
              {
                  id: product.id,
                  label: "Standard",
                  stock_level: product.total_stock,
              },
          ];
    const variantUrls = variants.map((variant) => ({
        id: variant.id,
        label: variant.label,
        url: `/products/${slug}?variant=${encodeURIComponent(variant.id)}`,
        stock: variant.stock_level,
    }));
    const shared = {
        product,
        url: `/products/${slug}`,
        imageUrl: product.image_url,
        categoryId: googleProductCategoryId(categoryName),
        brandName: content.brand.name,
    };
    // A lone sellable option is a plain Product; only two or more options form
    // a ProductGroup, and every variant carries its own identifier.
    const productNode =
        variants.length > 1
            ? productGroupJsonLd({
                  ...shared,
                  variesBy: /bangle/i.test(categoryName) ? "size" : undefined,
                  variants: variantUrls,
              })
            : productJsonLd(shared);
    const breadcrumb = breadcrumbJsonLd([
        { name: "Home", url: "/" },
        { name: categoryName, url: categoryUrl },
        { name: product.name, url: `/products/${slug}` },
    ]);

    const specs = [
        { label: "SKU", value: product.sku },
        { label: "Category", value: categoryName },
        { label: "Material", value: humanize(product.base_metal, METAL_LABELS) },
        { label: "Plating", value: humanize(product.plating_type, PLATING_LABELS) },
        { label: "Stone", value: clean(product.stone_type) },
        { label: "Occasion", value: humanize(product.occasion, OCCASION_LABELS) },
    ].filter((entry) => clean(entry.value));

    const stockLabel = stockLabelFor(product);
    // Product-specific care first, then the visible CMS care copy. Neither is
    // invented: both are catalogue/CMS text.
    const careText =
        clean(product.care_instructions).replace(/\s+/g, " ") ||
        firstParagraph(content.info.care.body);

    const related = catalog.products
        .filter(
            (entry) =>
                entry.id !== product.id &&
                (entry.category || "").trim().toLowerCase() === categoryName.toLowerCase()
        )
        .slice(0, 4);

    const image = product.image_url || "/niththigal/necklace.webp";

    return (
        <>
            <JsonLd id="product-jsonld" nodes={[productNode, breadcrumb]} />
            <div className="section-pad">
                <nav className="product-breadcrumb" aria-label="Breadcrumb">
                    <Link href="/">Home</Link>
                    <span aria-hidden>/</span>
                    <Link href={categoryUrl}>{categoryName}</Link>
                    <span aria-hidden>/</span>
                    <span aria-current="page">{product.name}</span>
                </nav>

                <section className="product-detail" aria-labelledby="product-title">
                    <div className="product-detail-media">
                        <img
                            src={image}
                            alt={`${product.name}, ${categoryName.toLowerCase()} from Niththigal`}
                            width={1024}
                            height={1024}
                            loading="eager"
                            fetchPriority="high"
                            decoding="async"
                        />
                    </div>
                    <div className="product-detail-copy">
                        <div className="eyebrow">
                            {categoryName.toUpperCase()} · THE HERITAGE EDIT
                        </div>
                        <h1 id="product-title">{product.name}</h1>
                        <p className="product-detail-price">
                            {money(product.website_price)} <small>Taxes included</small>{" "}
                            <small>{stockLabel}</small>
                        </p>
                        {clean(product.description) ? (
                            <p className="product-detail-description">
                                {product.description}
                            </p>
                        ) : null}

                        {specs.length ? (
                            <dl className="product-specs">
                                {specs.map((entry) => (
                                    <div key={entry.label}>
                                        <dt>{entry.label}</dt>
                                        <dd>{entry.value}</dd>
                                    </div>
                                ))}
                            </dl>
                        ) : null}

                        <ProductPurchase product={product} />

                        {careText ? (
                            <p className="product-purchase-note">
                                <strong>Care.</strong> {careText}{" "}
                                <Link href="/jewellery-care">Full care guide</Link>
                            </p>
                        ) : null}

                        <p className="product-purchase-note">
                            Every piece ships in a keepsake pouch with care
                            instructions. <Link href="/jewellery-care">Jewellery care</Link>{" "}
                            · <Link href="/shipping-returns">Shipping &amp; returns</Link>
                        </p>
                    </div>
                </section>

                {related.length ? (
                    <section
                        className="section-pad"
                        aria-labelledby="related-title"
                    >
                        <div className="section-heading">
                            <div>
                                <div className="eyebrow">MORE FROM THIS COLLECTION</div>
                                <h2 id="related-title">
                                    A few more <em>little loves.</em>
                                </h2>
                            </div>
                        </div>
                        <ProductGrid products={related} slugs={catalog.slugByProductId} />
                    </section>
                ) : null}
            </div>
        </>
    );
}
