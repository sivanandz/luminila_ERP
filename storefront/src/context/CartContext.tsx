"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { StorefrontProduct, StorefrontCartItem } from "@/lib/pocketbase";
import { toast } from "sonner";

interface CartContextType {
    cart: StorefrontCartItem[];
    addToCart: (product: StorefrontProduct, quantity?: number) => void;
    removeFromCart: (productId: string) => void;
    updateQuantity: (productId: string, quantity: number) => void;
    clearCart: () => void;
    isCartOpen: boolean;
    setIsCartOpen: (open: boolean) => void;
    cartCount: number;
    cartSubtotal: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "luminila_storefront_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
    const [cart, setCart] = useState<StorefrontCartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem(CART_STORAGE_KEY);
            if (saved) {
                try {
                    setCart(JSON.parse(saved));
                } catch {}
            }
        }
    }, []);

    const saveCart = (items: StorefrontCartItem[]) => {
        setCart(items);
        if (typeof window !== "undefined") {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
        }
    };

    const addToCart = (product: StorefrontProduct, quantity: number = 1) => {
        if (product.total_stock <= 0) {
            toast.error("This item is currently sold out.");
            return;
        }

        const existingIndex = cart.findIndex((i) => i.product.id === product.id);
        let newItems: StorefrontCartItem[];

        if (existingIndex > -1) {
            const currentQty = cart[existingIndex].quantity;
            if (currentQty + quantity > product.total_stock) {
                toast.warning(`Only ${product.total_stock} pieces available in inventory.`);
                return;
            }
            newItems = [...cart];
            newItems[existingIndex].quantity += quantity;
        } else {
            newItems = [...cart, { product, quantity }];
        }

        saveCart(newItems);
        toast.success(`Added "${product.name}" to shopping bag!`);
        setIsCartOpen(true);
    };

    const removeFromCart = (productId: string) => {
        const filtered = cart.filter((i) => i.product.id !== productId);
        saveCart(filtered);
    };

    const updateQuantity = (productId: string, quantity: number) => {
        if (quantity <= 0) {
            removeFromCart(productId);
            return;
        }
        const item = cart.find((i) => i.product.id === productId);
        if (item && quantity > item.product.total_stock) {
            toast.warning(`Maximum available stock is ${item.product.total_stock}.`);
            return;
        }
        const updated = cart.map((i) =>
            i.product.id === productId ? { ...i, quantity } : i
        );
        saveCart(updated);
    };

    const clearCart = () => {
        saveCart([]);
    };

    const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
    const cartSubtotal = cart.reduce((sum, i) => sum + i.product.website_price * i.quantity, 0);

    return (
        <CartContext.Provider
            value={{
                cart,
                addToCart,
                removeFromCart,
                updateQuantity,
                clearCart,
                isCartOpen,
                setIsCartOpen,
                cartCount,
                cartSubtotal,
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
