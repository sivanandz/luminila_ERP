"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/hooks/use-wishlist";
import { useNiththigalContent } from "@/lib/niththigal-content";
import { useNtCatalog } from "./NtCatalogContext";
import { useNtUi } from "./NtUiContext";
import { NtModal } from "./NtModal";
import { CloseIcon, SearchIcon } from "./NtIcons";

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

const PLATING_LABELS: Record<string, string> = {
    micro_gold_1gm: "22K micron gold plating",
    micro_gold: "Micro gold plating",
    gold_plated: "Gold plating",
    rhodium: "Rhodium finish",
    antique_matte: "Antique matte finish",
    oxidised: "Oxidised finish",
};

const METAL_LABELS: Record<string, string> = {
    brass: "Skin-safe brass alloy",
    copper: "Skin-safe copper alloy",
    red_copper: "Skin-safe red-copper alloy",
    alloy: "Skin-safe alloy",
    silver: "Sterling silver",
};

const OCCASION_LABELS: Record<string, string> = {
    bridal: "bridal & wedding",
    festive: "festive occasions",
    daily: "everyday wear",
    party: "evening occasions",
};

function humanize(value: string | undefined, labels: Record<string, string>): string {
    if (!value) return "";
    const key = value.trim().toLowerCase();
    return labels[key] || value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <button className="icon-button close-dialog" onClick={onClick} aria-label={label}>
            <CloseIcon />
        </button>
    );
}

/** Search and saved-favourites dialog (the example uses one dialog for both). */
function SearchDialog() {
    const { content } = useNiththigalContent();
    const { products } = useNtCatalog();
    const { searchOpen, savedOpen, closeSearch, closeSaved, openProduct } = useNtUi();
    const { saved } = useWishlist();
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const open = searchOpen || savedOpen;
    const mode = savedOpen ? "saved" : "search";

    useEffect(() => {
        if (!open) return;
        setQuery("");
        if (mode === "search") {
            const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
            return () => window.clearTimeout(timer);
        }
    }, [open, mode]);

    const results = useMemo(() => {
        if (mode === "saved") return products.filter((product) => saved.has(product.id));
        const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (!terms.length) return products;
        return products.filter((product) => {
            const haystack = [
                product.name,
                product.category,
                product.sub_style,
                product.occasion,
                product.description,
                product.sku,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return terms.every((term) => haystack.includes(term));
        });
    }, [mode, products, query, saved]);

    return (
        <NtModal
            open={open}
            onClose={mode === "saved" ? closeSaved : closeSearch}
            className="search-dialog"
            labelledBy="search-title"
        >
            <div className="modal-header">
                <h2 id="search-title">
                    {mode === "saved" ? content.ui.savedTitle : content.ui.searchTitle}
                </h2>
                <CloseButton
                    onClick={mode === "saved" ? closeSaved : closeSearch}
                    label={content.ui.closeLabel}
                />
            </div>

            {mode === "search" ? (
                <label className="search-field">
                    <SearchIcon />
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        placeholder={content.ui.searchPlaceholder}
                        aria-label="Search jewellery"
                        autoComplete="off"
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
            ) : null}

            <div className="search-results" aria-live="polite">
                {results.length ? (
                    results.map((product) => (
                        <button
                            key={product.id}
                            type="button"
                            className="result-row"
                            onClick={() => openProduct(product)}
                        >
                            <img
                                src={product.image_url || "/niththigal/necklace.webp"}
                                alt=""
                                width={65}
                                height={65}
                            />
                            <span>
                                <strong>{product.name}</strong>
                                <small>
                                    {product.category || "Jewellery"} · {money(product.website_price)}
                                </small>
                            </span>
                            <span aria-hidden>↗</span>
                        </button>
                    ))
                ) : (
                    <p className="no-results">
                        {mode === "saved" ? content.ui.savedEmpty : content.ui.searchEmpty}
                    </p>
                )}
            </div>
        </NtModal>
    );
}

/** Product detail dialog, including the sellable variant selector. */
function ProductDialog() {
    const { content } = useNiththigalContent();
    const { activeProduct, closeProduct } = useNtUi();
    const { addToCart } = useCart();
    const product = activeProduct;
    const variants = useMemo(
        () => (Array.isArray(product?.variants) ? product.variants : []),
        [product]
    );

    const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (!product) {
            setSelectedVariant(undefined);
            return;
        }
        const bangle = /bangle/i.test(product.category || "");
        const preferred = bangle
            ? variants.find(
                  (variant) => variant.label.includes("2.6") && variant.stock_level > 0
              )
            : undefined;
        const available =
            preferred ||
            variants.find((variant) => variant.stock_level > 0) ||
            variants[0];
        setSelectedVariant(available?.id);
    }, [product, variants]);

    if (!product) {
        return (
            <NtModal open={false} onClose={closeProduct} className="product-dialog" labelledBy="product-title">
                <span id="product-title" />
            </NtModal>
        );
    }

    const outOfStock = product.total_stock <= 0 || product.stock_status === "out_of_stock";
    const isBangle = /bangle/i.test(product.category || "");
    const needsChoice = variants.length > 1;
    const details = [
        humanize(product.plating_type, PLATING_LABELS),
        humanize(product.base_metal, METAL_LABELS),
        product.stone_type,
        product.occasion
            ? `Made for ${humanize(product.occasion, OCCASION_LABELS)}`
            : "",
    ].filter(Boolean) as string[];
    const selected = variants.find((variant) => variant.id === selectedVariant) || variants[0];

    const add = () => {
        if (outOfStock) return;
        if (needsChoice && !selected) {
            toast.error("Please choose an option first.");
            return;
        }
        closeProduct();
        addToCart(product, 1, selected?.id);
    };

    return (
        <NtModal
            open
            onClose={closeProduct}
            className="product-dialog"
            labelledBy="product-title"
        >
            <button
                className="icon-button close-dialog modal-close"
                aria-label={content.ui.closeLabel}
                onClick={closeProduct}
            >
                <CloseIcon />
            </button>
            <div id="product-detail">
                <div className="detail-image">
                    <img
                        src={product.image_url || "/niththigal/necklace.webp"}
                        alt={product.name}
                        width={1024}
                        height={1024}
                    />
                </div>
                <div className="detail-copy">
                    <div className="eyebrow">
                        THE HERITAGE EDIT · {(product.category || "JEWELLERY").toUpperCase()}
                    </div>
                    <h2 id="product-title">{product.name}</h2>
                    <div className="detail-price">{money(product.website_price)}</div>
                    <p>{product.description || "Thoughtfully crafted imitation jewellery."}</p>
                    {details.length ? (
                        <ul>
                            {details.map((detail) => (
                                <li key={detail}>{detail}</li>
                            ))}
                        </ul>
                    ) : null}

                    {needsChoice ? (
                        <label className="size-field" htmlFor="nt-variant">
                            {isBangle ? content.ui.productSizeLabel : content.ui.productOptionLabel}
                            <select
                                id="nt-variant"
                                value={selectedVariant || ""}
                                onChange={(event) => setSelectedVariant(event.target.value)}
                            >
                                {variants.map((variant) => (
                                    <option
                                        key={variant.id}
                                        value={variant.id}
                                        disabled={variant.stock_level <= 0}
                                    >
                                        {variant.label}
                                        {variant.stock_level <= 0 ? " — sold out" : ""}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}

                    <button
                        className="button button-green"
                        id="detail-add"
                        onClick={add}
                        disabled={outOfStock}
                    >
                        {outOfStock ? content.collection.soldOutLabel : content.ui.productAdd}{" "}
                        <span aria-hidden>+</span>
                    </button>
                    <p className="sample-caption">{content.ui.productNote}</p>
                </div>
            </div>
        </NtModal>
    );
}

/** Footer information dialogs: shipping, privacy and jewellery care. */
function InfoDialog() {
    const { content } = useNiththigalContent();
    const { infoKey, closeInfo } = useNtUi();
    const page = infoKey ? content.info[infoKey] : null;

    const waNumber = content.contact.whatsappPhone.replace(/[^\d]/g, "");
    const ctaHref =
        infoKey === "care"
            ? "#collection"
            : waNumber
                ? `https://wa.me/${waNumber}?text=${encodeURIComponent("Hello Niththigal, I have a question about my order.")}`
                : content.contact.supportEmail
                    ? `mailto:${content.contact.supportEmail}`
                    : "";

    const onCta = () => {
        closeInfo();
        if (infoKey === "care") {
            window.setTimeout(
                () => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" }),
                50
            );
        }
    };

    return (
        <NtModal
            open={Boolean(infoKey && page)}
            onClose={closeInfo}
            className="info-dialog"
            labelledBy="info-title"
        >
            <div className="modal-header">
                <h2 id="info-title">{page?.title || ""}</h2>
                <CloseButton onClick={closeInfo} label={content.ui.closeLabel} />
            </div>
            <div className="info-body">
                {page?.body
                    .split(/\n{2,}/)
                    .filter(Boolean)
                    .map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                    ))}
            </div>
            {ctaHref ? (
                <a
                    className="button button-green info-cta"
                    href={ctaHref}
                    onClick={onCta}
                    target={ctaHref.startsWith("http") ? "_blank" : undefined}
                    rel={ctaHref.startsWith("http") ? "noreferrer" : undefined}
                >
                    {page?.cta} <span aria-hidden>↗</span>
                </a>
            ) : (
                <button className="button button-green info-cta" onClick={onCta}>
                    {page?.cta} <span aria-hidden>↗</span>
                </button>
            )}
        </NtModal>
    );
}

export function NtDialogs() {
    return (
        <>
            <SearchDialog />
            <ProductDialog />
            <InfoDialog />
        </>
    );
}
