"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/hooks/use-wishlist";
import {
    countCopy,
    useNiththigalContent,
    type NiththigalContent,
} from "@/lib/niththigal-content";
import type { StorefrontProduct } from "@/lib/pocketbase";
import { categoryPath, categorySlug, productPath, productSlug } from "@/lib/seo";
import { ALL_PIECES, useNtCatalog } from "./NtCatalogContext";
import { useNtUi } from "./NtUiContext";
import { HeartIcon } from "./NtIcons";

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

function productLabel(product: StorefrontProduct, fallback: string): string {
    return (product.sub_style || product.occasion || fallback || "THE HERITAGE EDIT").toUpperCase();
}

function productSubtitle(product: StorefrontProduct): string {
    const text = (product.description || "").trim();
    if (!text) return "Thoughtfully crafted imitation jewellery.";
    const first = text.split(/(?<=[.!?])\s/)[0];
    return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

function priceUnit(product: StorefrontProduct, copy: NiththigalContent["collection"]) {
    return /bangle|earring/i.test(product.category || "")
        ? copy.priceUnitPair
        : copy.priceUnitSingle;
}

/**
 * Live catalogue showcase. The card markup is the example's, with catalogue
 * fields mapped into the label, price and quick-view slots.
 */
export function Collection() {
    const { content } = useNiththigalContent();
    const { products, loading, categories, filter, setFilter, minPrice, slugByProductId } =
        useNtCatalog();
    const { openProduct } = useNtUi();
    const { addToCart } = useCart();
    const { isSaved, toggleSaved } = useWishlist();
    const copy = content.collection;

    const filtered = useMemo(() => {
        if (filter === ALL_PIECES) return products;
        return products.filter(
            (product) => (product.category || "").toLowerCase() === filter.toLowerCase()
        );
    }, [products, filter]);

    const countText = countCopy(
        filtered.length === 1 ? copy.countSingular : copy.countPlural,
        filtered.length
    );

    const add = (product: StorefrontProduct) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.length > 1) {
            openProduct(product);
            return;
        }
        addToCart(product, 1, variants[0]?.id);
        toast.success(`${product.name} added to your bag`);
    };

    return (
        <section className="collection section-pad" id="collection" aria-labelledby="collection-title">
            <div className="section-heading reveal">
                <div>
                    <div className="eyebrow">{copy.eyebrow}</div>
                    <h2 id="collection-title">
                        {copy.headingLine1} <em>{copy.headingEmphasis}</em>
                    </h2>
                </div>
                <p>
                    {copy.supportingLine1}
                    <br />
                    {copy.supportingLine2}
                </p>
            </div>

            <div className="collection-controls reveal">
                <div className="filters" role="group" aria-label="Filter jewellery">
                    <button
                        type="button"
                        className={`filter ${filter === ALL_PIECES ? "active" : ""}`}
                        onClick={() => setFilter(ALL_PIECES)}
                        aria-pressed={filter === ALL_PIECES}
                    >
                        {copy.allLabel} <span>{String(products.length).padStart(2, "0")}</span>
                    </button>
                    {categories.map((category) => (
                        <button
                            key={category}
                            type="button"
                            className={`filter ${filter === category ? "active" : ""}`}
                            onClick={() => setFilter(category)}
                            aria-pressed={filter === category}
                        >
                            {category}
                        </button>
                    ))}
                </div>
                <span className="collection-count" aria-live="polite">
                    {countText}
                </span>
            </div>

            {categories.length ? (
                <nav
                    className="filters"
                    aria-label="Browse collections"
                    style={{ marginTop: 10 }}
                >
                    {categories.map((category) => (
                        <a
                            key={category}
                            className="filter"
                            href={categoryPath(categorySlug(category))}
                        >
                            {category} <span aria-hidden>↗</span>
                        </a>
                    ))}
                </nav>
            ) : null}

            <div className="product-grid" id="product-grid">
                {loading ? (
                    <p className="collection-status">{copy.loadingLabel}</p>
                ) : filtered.length === 0 ? (
                    <p className="collection-status">{copy.emptyLabel}</p>
                ) : (
                    filtered.map((product) => (
                        <ProductCard
                            key={product.id}
                            product={product}
                            slug={slugByProductId[product.id] || productSlug(product)}
                            copy={copy}
                            saved={isSaved(product.id)}
                            onOpen={() => openProduct(product)}
                            onToggleSaved={() => {
                                const willSave = !isSaved(product.id);
                                toggleSaved(product.id);
                                toast.success(
                                    willSave
                                        ? "Saved with love. Find it in your favourites."
                                        : "Removed from your favourites"
                                );
                            }}
                            onAdd={() => add(product)}
                        />
                    ))
                )}
            </div>

            <div className="collection-foot reveal">
                <span>{copy.footLeft}</span>
                <span>
                    {copy.footRightPrefix}{" "}
                    <strong>
                        {minPrice !== null ? money(minPrice) : copy.minPriceFallback}
                    </strong>{" "}
                    <span className="gold-text" aria-hidden>✧</span>
                </span>
            </div>
        </section>
    );
}

function ProductCard({
    product,
    slug,
    copy,
    saved,
    onOpen,
    onToggleSaved,
    onAdd,
}: {
    product: StorefrontProduct;
    slug: string;
    copy: NiththigalContent["collection"];
    saved: boolean;
    onOpen: () => void;
    onToggleSaved: () => void;
    onAdd: () => void;
}) {
    const outOfStock = product.total_stock <= 0 || product.stock_status === "out_of_stock";
    const label = outOfStock
        ? copy.soldOutLabel.toUpperCase()
        : productLabel(product, copy.productBadgeFallback);

    return (
        <article className="product-card reveal">
            <div className="product-image">
                <a
                    href={productPath(slug)}
                    onClick={(event) => {
                        event.preventDefault();
                        onOpen();
                    }}
                    aria-label={`View ${product.name}`}
                >
                    <img
                        src={product.image_url || "/niththigal/necklace.webp"}
                        alt={`${product.name}, gold-tone South Indian-inspired imitation jewellery`}
                        width={1024}
                        height={1024}
                        loading="lazy"
                        decoding="async"
                    />
                </a>
                <span className="product-badge">{label}</span>
                <button
                    type="button"
                    className={`heart-button ${saved ? "is-saved" : ""}`}
                    onClick={onToggleSaved}
                    aria-label={`${saved ? "Unsave" : "Save"} ${product.name}`}
                    aria-pressed={saved}
                >
                    <HeartIcon filled={saved} />
                </button>
                <button type="button" className="quick-view" onClick={onOpen}>
                    {copy.quickViewLabel} <span aria-hidden>↗</span>
                </button>
            </div>
            <div className="product-info">
                <div>
                    <span className="product-type">
                        {(product.category || "Jewellery").toUpperCase()} · {copy.productTypeSuffix}
                    </span>
                    <h3>
                        <a
                            href={productPath(slug)}
                            onClick={(event) => {
                                event.preventDefault();
                                onOpen();
                            }}
                        >
                            {product.name}
                        </a>
                    </h3>
                    <p className="product-price">
                        {money(product.website_price)} <small>{priceUnit(product, copy)}</small>
                    </p>
                </div>
                <button
                    type="button"
                    className="add-button"
                    onClick={onAdd}
                    disabled={outOfStock}
                    aria-label={
                        outOfStock
                            ? `${product.name} is sold out`
                            : /bangle/i.test(product.category || "")
                                ? `Choose size for ${product.name}`
                                : `${copy.addLabel}: ${product.name}`
                    }
                >
                    +
                </button>
            </div>
        </article>
    );
}
