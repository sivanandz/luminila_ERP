"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { cartLineKey } from "@/lib/pocketbase";
import { useNiththigalContent } from "@/lib/niththigal-content";
import { NtModal } from "./niththigal/NtModal";
import { CloseIcon } from "./niththigal/NtIcons";

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

/**
 * Slide-over shopping bag, matching the Niththigal example's drawer markup.
 * Variant selection stays inside the line so the order API never receives an
 * ambiguous multi-variant line.
 */
export function CartDrawer() {
    const { content } = useNiththigalContent();
    const {
        cart,
        isCartOpen,
        setIsCartOpen,
        removeFromCart,
        updateQuantity,
        chooseVariant,
        cartSubtotal,
        needsVariantSelection,
    } = useCart();

    const close = () => setIsCartOpen(false);

    return (
        <NtModal
            open={isCartOpen}
            onClose={close}
            className="drawer"
            labelledBy="cart-title"
        >
            <div className="drawer-header">
                <div>
                    <span className="eyebrow">{content.ui.cartEyebrow}</span>
                    <h2 id="cart-title">{content.ui.cartTitle}</h2>
                </div>
                <button
                    className="icon-button close-dialog"
                    aria-label={content.ui.closeLabel}
                    onClick={close}
                >
                    <CloseIcon />
                </button>
            </div>

            <div id="cart-items" className="cart-items">
                {cart.length === 0 ? (
                    <div className="empty-state">
                        <span aria-hidden>✧</span>
                        <h3>{content.ui.cartEmptyTitle}</h3>
                        <p>{content.ui.cartEmptyText}</p>
                        <button
                            className="button button-green"
                            onClick={() => {
                                close();
                                window.setTimeout(
                                    () =>
                                        document
                                            .getElementById("collection")
                                            ?.scrollIntoView({ behavior: "smooth" }),
                                    60
                                );
                            }}
                        >
                            {content.ui.cartEmptyCta} <span aria-hidden>↗</span>
                        </button>
                    </div>
                ) : (
                    cart.map((item) => {
                        const key = cartLineKey(item);
                        const variants = Array.isArray(item.product.variants)
                            ? item.product.variants
                            : [];
                        const multiVariant = variants.length > 1;
                        return (
                            <div className="cart-row" key={key}>
                                <img
                                    src={item.product.image_url || "/niththigal/necklace.webp"}
                                    alt={item.product.name}
                                    width={90}
                                    height={105}
                                />
                                <div className="cart-row-info">
                                    <div className="cart-row-top">
                                        <h3>{item.product.name}</h3>
                                        <button
                                            className="remove-item"
                                            data-remove
                                            onClick={() => removeFromCart(key)}
                                            aria-label={`Remove ${item.product.name}`}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                    <p>
                                        {item.variantLabel &&
                                        !/^(standard|one size)$/i.test(item.variantLabel)
                                            ? `Size ${item.variantLabel}`
                                            : item.product.category || "Jewellery"}{" "}
                                        · {money(item.product.website_price)} each
                                    </p>

                                    {multiVariant ? (
                                        <label className="cart-variant">
                                            <span>Choose a size</span>
                                            <select
                                                value={item.variantId || ""}
                                                onChange={(event) =>
                                                    chooseVariant(key, event.target.value)
                                                }
                                                aria-label={`Choose a size for ${item.product.name}`}
                                            >
                                                <option value="" disabled>
                                                    Select size
                                                </option>
                                                {variants.map((variant) => (
                                                    <option
                                                        key={variant.id}
                                                        value={variant.id}
                                                        disabled={variant.stock_level <= 0}
                                                    >
                                                        {variant.label}
                                                        {variant.stock_level <= 0
                                                            ? " — sold out"
                                                            : ""}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ) : null}

                                    <div className="cart-row-bottom">
                                        <div className="quantity">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    updateQuantity(key, item.quantity - 1)
                                                }
                                                aria-label={`Decrease ${item.product.name} quantity`}
                                            >
                                                −
                                            </button>
                                            <span aria-label={`Quantity ${item.quantity}`}>
                                                {item.quantity}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    updateQuantity(key, item.quantity + 1)
                                                }
                                                aria-label={`Increase ${item.product.name} quantity`}
                                            >
                                                +
                                            </button>
                                        </div>
                                        <strong>{money(item.product.website_price * item.quantity)}</strong>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {cart.length > 0 ? (
                <div id="cart-footer" className="cart-footer">
                    <div className="cart-total">
                        <span>{content.ui.cartSubtotal}</span>
                        <strong>{money(cartSubtotal)}</strong>
                    </div>
                    <p>{content.ui.cartNote}</p>
                    {needsVariantSelection ? (
                        <span className="button button-green cart-disabled" aria-disabled="true">
                            Select a size to continue <span aria-hidden>→</span>
                        </span>
                    ) : (
                        <Link
                            href="/checkout"
                            className="button button-green"
                            onClick={close}
                        >
                            {content.ui.cartCheckout} <span aria-hidden>→</span>
                        </Link>
                    )}
                    <p>Secure payments · Insured express delivery</p>
                </div>
            ) : null}
        </NtModal>
    );
}
