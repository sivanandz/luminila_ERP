"use client";

/**
 * Shared per-browser favourites (Niththigal "saved" hearts). A single provider
 * keeps the header dot, product hearts and saved dialog in lockstep; storage is
 * keyed per customer when signed in, guest otherwise.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useCustomerAuth } from "@/context/CustomerAuthContext";

interface WishlistContextValue {
    saved: Set<string>;
    isSaved: (productId: string) => boolean;
    toggleSaved: (productId: string) => void;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

function storageKey(customerId?: string): string {
    return customerId ? `niththigal_wishlist_${customerId}` : "niththigal_wishlist_guest";
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
    const { customer } = useCustomerAuth();
    const customerId = customer?.id;
    const [saved, setSaved] = useState<Set<string>>(new Set());

    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey(customerId));
            const parsed = raw ? (JSON.parse(raw) as unknown) : [];
            setSaved(
                new Set(
                    Array.isArray(parsed)
                        ? parsed.filter((value): value is string => typeof value === "string")
                        : []
                )
            );
        } catch {
            setSaved(new Set());
        }
    }, [customerId]);

    const persist = useCallback(
        (next: Set<string>) => {
            try {
                localStorage.setItem(storageKey(customerId), JSON.stringify([...next]));
            } catch {
                /* storage unavailable */
            }
        },
        [customerId]
    );

    const toggleSaved = useCallback(
        (productId: string) => {
            setSaved((previous) => {
                const next = new Set(previous);
                if (next.has(productId)) next.delete(productId);
                else next.add(productId);
                persist(next);
                return next;
            });
        },
        [persist]
    );

    const isSaved = useCallback((productId: string) => saved.has(productId), [saved]);

    const value = useMemo(
        () => ({ saved, isSaved, toggleSaved }),
        [saved, isSaved, toggleSaved]
    );

    return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistContextValue {
    const value = useContext(WishlistContext);
    if (!value) throw new Error("useWishlist must be used inside WishlistProvider");
    return value;
}
