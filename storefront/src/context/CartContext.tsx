"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { StorefrontProduct, StorefrontCartItem, cartLineKey, getStorefrontCatalog } from "@/lib/pocketbase";
import { toast } from "sonner";

interface CartContextType {
    cart: StorefrontCartItem[];
    addToCart: (product: StorefrontProduct, quantity?: number, variantId?: string) => void;
    removeFromCart: (lineKey: string) => void;
    updateQuantity: (lineKey: string, quantity: number) => void;
    chooseVariant: (lineKey: string, variantId: string) => void;
    clearCart: () => void;
    isCartOpen: boolean;
    setIsCartOpen: (open: boolean) => void;
    cartCount: number;
    cartSubtotal: number;
    /** True when at least one multi-variant line still needs a variant before checkout. */
    needsVariantSelection: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "luminila_storefront_cart_v1";

function variantsOf(product: StorefrontProduct) {
    return Array.isArray(product.variants) ? product.variants : [];
}

/** Stock available for the line's selected variant, falling back to the product total. */
function stockForLine(product: StorefrontProduct, variantId?: string): number {
    if (variantId) {
        const variant = variantsOf(product).find((v) => v.id === variantId);
        if (variant) return Math.max(0, variant.stock_level);
    }
    return Math.max(0, product.total_stock);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
    const [cart, setCart] = useState<StorefrontCartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = localStorage.getItem(CART_STORAGE_KEY);
        let parsed: StorefrontCartItem[] = [];
        if (saved) {
            try {
                parsed = JSON.parse(saved);
            } catch {}
        }
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        setCart(parsed);

        // Rehydrate product facts before the cart is trusted: the order API
        // re-prices from the database and refuses multi-variant lines without a
        // variant, so a stale persisted cart must not be sent as-is.
        getStorefrontCatalog()
            .then((catalog) => {
                const byId = new Map(catalog.map((p) => [p.id, p]));
                const refreshed = parsed.flatMap((item) => {
                    const fresh = byId.get(item.product.id);
                    if (!fresh || fresh.total_stock <= 0) return [];
                    const variant = item.variantId
                        ? (fresh.variants || []).find((v) => v.id === item.variantId)
                        : undefined;
                    return [
                        {
                            product: fresh,
                            quantity: Math.max(
                                1,
                                Math.min(item.quantity, Math.max(1, fresh.total_stock))
                            ),
                            variantId: variant?.id,
                            variantLabel: variant?.label,
                        },
                    ];
                });
                if (refreshed.length !== parsed.length) {
                    toast.info("Sold-out items were removed from your bag.");
                }
                saveCart(refreshed);
            })
            .catch(() => {
                // Offline: keep the saved cart; the order API remains the authority.
            });
    }, []);

    const saveCart = (items: StorefrontCartItem[]) => {
        setCart(items);
        if (typeof window !== "undefined") {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
        }
    };

    const addToCart = (product: StorefrontProduct, quantity: number = 1, variantId?: string) => {
        const variants = variantsOf(product);
        // Auto-select the only variant; leave the line pending when the customer
        // must choose (the drawer renders the selector and blocks checkout).
        const resolvedVariantId =
            variantId || (variants.length === 1 ? variants[0].id : undefined);
        const resolvedLabel = variants.find((v) => v.id === resolvedVariantId)?.label;

        if (stockForLine(product, resolvedVariantId) <= 0) {
            toast.error("This item is currently sold out.");
            return;
        }

        const targetKey = cartLineKey({ product, variantId: resolvedVariantId });
        const existingIndex = cart.findIndex((i) => cartLineKey(i) === targetKey);
        let newItems: StorefrontCartItem[];

        if (existingIndex > -1) {
            const currentQty = cart[existingIndex].quantity;
            const available = stockForLine(product, resolvedVariantId);
            if (currentQty + quantity > available) {
                toast.warning(`Only ${available} pieces available for this selection.`);
                return;
            }
            newItems = [...cart];
            newItems[existingIndex] = { ...newItems[existingIndex], quantity: currentQty + quantity };
        } else {
            newItems = [
                ...cart,
                {
                    product,
                    quantity,
                    variantId: resolvedVariantId,
                    variantLabel: resolvedLabel,
                },
            ];
        }

        saveCart(newItems);
        toast.success(`Added "${product.name}" to shopping bag!`);
        setIsCartOpen(true);
    };

    const removeFromCart = (lineKey: string) => {
        saveCart(cart.filter((i) => cartLineKey(i) !== lineKey));
    };

    const updateQuantity = (lineKey: string, quantity: number) => {
        if (quantity <= 0) {
            removeFromCart(lineKey);
            return;
        }
        const item = cart.find((i) => cartLineKey(i) === lineKey);
        if (!item) return;
        const available = stockForLine(item.product, item.variantId);
        if (quantity > available) {
            toast.warning(`Maximum available stock is ${available}.`);
            return;
        }
        saveCart(cart.map((i) => (cartLineKey(i) === lineKey ? { ...i, quantity } : i)));
    };

    const chooseVariant = (lineKey: string, variantId: string) => {
        const item = cart.find((i) => cartLineKey(i) === lineKey);
        if (!item) return;
        const variant = variantsOf(item.product).find((v) => v.id === variantId);
        if (!variant) return;
        if (variant.stock_level <= 0) {
            toast.error("That size is sold out.");
            return;
        }

        const nextLine: StorefrontCartItem = {
            ...item,
            variantId: variant.id,
            variantLabel: variant.label,
        };
        const nextKey = cartLineKey(nextLine);

        // Collapse into an existing line for the same variant.
        const duplicate = cart.find((i) => i !== item && cartLineKey(i) === nextKey);
        if (duplicate) {
            const mergedQty = Math.min(
                stockForLine(item.product, variant.id),
                duplicate.quantity + item.quantity
            );
            saveCart(
                cart
                    .filter((i) => i !== item)
                    .map((i) =>
                        cartLineKey(i) === nextKey ? { ...i, quantity: mergedQty } : i
                    )
            );
            return;
        }

        saveCart(
            cart.map((i) => (cartLineKey(i) === lineKey ? nextLine : i))
        );
    };

    const clearCart = () => {
        saveCart([]);
    };

    const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
    const cartSubtotal = cart.reduce((sum, i) => sum + i.product.website_price * i.quantity, 0);
    const needsVariantSelection = cart.some(
        (i) => variantsOf(i.product).length > 1 && !i.variantId
    );

    return (
        <CartContext.Provider
            value={{
                cart,
                addToCart,
                removeFromCart,
                updateQuantity,
                chooseVariant,
                clearCart,
                isCartOpen,
                setIsCartOpen,
                cartCount,
                cartSubtotal,
                needsVariantSelection,
            }}
        >
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error("useCart must be used within a CartProvider");
    return ctx;
}
