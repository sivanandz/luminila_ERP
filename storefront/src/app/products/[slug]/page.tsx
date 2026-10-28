import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { ProductGrid } from "@/components/product/ProductGrid";
import { ProductPurchase } from "@/components/product/ProductPurchase";
import { getBuildCatalog } from "@/lib/catalog-server";
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

/** Keep meta descriptions near the 150-160 character display range. */
function metaDescription(value: string): string {
    const text = value.trim();
    if (text.length <= 160) return text;
    const cut = text.slice(0, 157);
    const lastSpace = cut.lastIndexOf(" ");
    return `${cut.slice(0, lastSpace > 100 ? lastSpace : 157)}…`;
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
    if (!product) return { title: "Product not found" };

    const category = clean(product.category) || "Jewellery";
    const title = `${product.name} — ${category} | ${SITE_NAME}`;
    const description = metaDescription(
        clean(product.description) ||
            `${product.name}, ${category.toLowerCase()} from ${SITE_NAME}: South Indian-inspired imitation jewellery with a gold-tone finish.`
    );
    const image =
        absoluteAssetUrl(product.image_url) ?? `${SITE_URL}/niththigal/necklace.webp`;

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
            images: [{ url: image, alt: product.name }],
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
        { label: "Base metal", value: product.base_metal },
        { label: "Plating", value: product.plating_type },
        { label: "Stone", value: product.stone_type },
        { label: "Occasion", value: product.occasion },
    ].filter((entry) => clean(entry.value));

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
                            {money(product.website_price)} <small>Taxes included</small>
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
