import Link from "next/link";
import type { StorefrontProduct } from "@/lib/pocketbase";
import { isProductInStock, productPath } from "@/lib/seo";

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

/**
 * Server-rendered product grid used by collection pages. Every card is a real
 * anchor to the product page, so the links are in the initial HTML.
 */
export function ProductGrid({
    products,
    slugs,
}: {
    products: StorefrontProduct[];
    slugs: Record<string, string>;
}) {
    if (!products.length) {
        return <p className="collection-status">No pieces in this collection yet.</p>;
    }
    return (
        <div className="product-grid">
            {products.map((product) => {
                const slug = slugs[product.id];
                if (!slug) return null;
                const href = productPath(slug);
                const image = product.image_url || "/niththigal/necklace.webp";
                const alt = `${product.name}, ${
                    product.category || "jewellery"
                } from Niththigal`;
                return (
                    <article className="product-card" key={product.id}>
                        <div className="product-image">
                            <Link href={href} aria-label={`View ${product.name}`}>
                                <img
                                    src={image}
                                    alt={alt}
                                    width={1024}
                                    height={1024}
                                    loading="lazy"
                                    decoding="async"
                                />
                            </Link>
                            <span className="product-badge">
                                {(product.category || "JEWELLERY").toUpperCase()}
                            </span>
                        </div>
                        <div className="product-info">
                            <div>
                                <span className="product-type">
                                    {(product.category || "Jewellery").toUpperCase()} · THE
                                    HERITAGE EDIT
                                </span>
                                <h3>
                                    <Link href={href}>{product.name}</Link>
                                </h3>
                                <p className="product-price">
                                    {money(product.website_price)}{" "}
                                    <small>
                                        {isProductInStock(product) ? "in stock" : "sold out"}
                                    </small>
                                </p>
                            </div>
                            <Link
                                className="add-button"
                                href={href}
                                aria-label={`View ${product.name}`}
                            >
                                +
                            </Link>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
