"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/hooks/use-wishlist";
import type { StorefrontProduct } from "@/lib/pocketbase";

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

/**
 * Reads ?variant=<id> after hydration and preselects it. Kept in its own
 * component so the product page can wrap it in a Suspense boundary, which
 * `useSearchParams` requires in a static export.
 */
function VariantSync({
    variants,
    selected,
    onSelect,
}: {
    variants: { id: string; label: string }[];
    selected: string;
    onSelect: (id: string) => void;
}) {
    const searchParams = useSearchParams();
    useEffect(() => {
        const requested = searchParams.get("variant");
        if (requested && requested !== selected && variants.some((v) => v.id === requested)) {
            onSelect(requested);
        }
    }, [searchParams, variants, selected, onSelect]);
    return null;
}

export function ProductPurchase({ product }: { product: StorefrontProduct }) {
    const variants = useMemo(
        () => (Array.isArray(product.variants) ? product.variants : []),
        [product.variants]
    );
    const [variantId, setVariantId] = useState(variants[0]?.id || "");
    const [quantity, setQuantity] = useState(1);
    const router = useRouter();
    const { addToCart } = useCart();
    const { isSaved, toggleSaved } = useWishlist();

    const selected = variants.find((variant) => variant.id === variantId);
    const available = selected ? selected.stock_level : product.total_stock;
    const outOfStock =
        product.stock_status === "out_of_stock" || product.total_stock <= 0 || available <= 0;
    const saved = isSaved(product.id);

    const selectVariant = useCallback(
        (id: string) => {
            setVariantId(id);
            const params = new URLSearchParams(window.location.search);
            params.set("variant", id);
            router.replace(`${window.location.pathname}?${params.toString()}`, {
                scroll: false,
            });
        },
        [router]
    );

    const add = () => {
        if (outOfStock) return;
        addToCart(product, Math.max(1, quantity), variants.length ? variantId : undefined);
        toast.success(`${product.name} added to your bag`);
    };

    return (
        <div className="product-purchase">
            {variants.length > 1 ? (
                <>
                    <Suspense fallback={null}>
                        <VariantSync
                            variants={variants}
                            selected={variantId}
                            onSelect={selectVariant}
                        />
                    </Suspense>
                    <label className="product-purchase-label" htmlFor="product-variant">
                        {product.category && /bangle/i.test(product.category)
                            ? "Your bangle size"
                            : "Choose your option"}
                    </label>
                    <select
                        id="product-variant"
                        className="product-purchase-select"
                        value={variantId}
                        onChange={(event) => selectVariant(event.target.value)}
                    >
                        {variants.map((variant) => (
                            <option key={variant.id} value={variant.id}>
                                {variant.label}
                                {variant.stock_level <= 0 ? " — sold out" : ""}
                            </option>
                        ))}
                    </select>
                </>
            ) : null}

            <div className="product-purchase-row">
                <label className="product-purchase-label" htmlFor="product-quantity">
                    Quantity
                </label>
                <input
                    id="product-quantity"
                    className="product-purchase-qty"
                    type="number"
                    min={1}
                    max={Math.max(1, available)}
                    value={quantity}
                    onChange={(event) =>
                        setQuantity(
                            Math.max(1, Math.min(Math.max(1, available), Number(event.target.value) || 1))
                        )
                    }
                />
                <span className="product-purchase-stock" aria-live="polite">
                    {outOfStock
                        ? "Sold out"
                        : available <= 3
                          ? `Only ${available} left`
                          : "In stock"}
                </span>
            </div>

            <div className="product-purchase-actions">
                <button
                    type="button"
                    className="button button-green"
                    onClick={add}
                    disabled={outOfStock}
                    aria-label={
                        outOfStock ? `${product.name} is sold out` : `Add ${product.name} to bag`
                    }
                >
                    {outOfStock ? "Sold out" : "Add a little joy to your bag"}
                </button>
                <button
                    type="button"
                    className="product-purchase-save"
                    onClick={() => {
                        const willSave = !saved;
                        toggleSaved(product.id);
                        toast.success(
                            willSave
                                ? "Saved with love. Find it in your favourites."
                                : "Removed from your favourites"
                        );
                    }}
                    aria-pressed={saved}
                >
                    {saved ? "Saved ♥" : "Save this piece ♡"}
                </button>
            </div>

            <p className="product-purchase-note">
                {money(product.website_price)} · Taxes included. Delivery is calculated at
                checkout.
            </p>
        </div>
    );
}
