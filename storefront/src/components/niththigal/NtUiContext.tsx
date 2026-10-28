"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { StorefrontProduct } from "@/lib/pocketbase";

export type NtInfoKey = "shipping" | "privacy" | "care";

interface NtUiContextValue {
    searchOpen: boolean;
    savedOpen: boolean;
    infoKey: NtInfoKey | null;
    activeProduct: StorefrontProduct | null;
    openSearch: () => void;
    openSaved: () => void;
    openInfo: (key: NtInfoKey) => void;
    openProduct: (product: StorefrontProduct) => void;
    closeSearch: () => void;
    closeSaved: () => void;
    closeInfo: () => void;
    closeProduct: () => void;
}

const NtUiContext = createContext<NtUiContextValue | null>(null);

export function NtUiProvider({ children }: { children: React.ReactNode }) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [savedOpen, setSavedOpen] = useState(false);
    const [infoKey, setInfoKey] = useState<NtInfoKey | null>(null);
    const [activeProduct, setActiveProduct] = useState<StorefrontProduct | null>(null);

    const openSearch = useCallback(() => {
        setSavedOpen(false);
        setSearchOpen(true);
    }, []);
    const openSaved = useCallback(() => {
        setSearchOpen(false);
        setSavedOpen(true);
    }, []);
    const openInfo = useCallback((key: NtInfoKey) => {
        setInfoKey(key);
    }, []);
    const openProduct = useCallback((product: StorefrontProduct) => {
        setSearchOpen(false);
        setSavedOpen(false);
        setInfoKey(null);
        setActiveProduct(product);
    }, []);

    const value = useMemo(
        () => ({
            searchOpen,
            savedOpen,
            infoKey,
            activeProduct,
            openSearch,
            openSaved,
            openInfo,
            openProduct,
            closeSearch: () => setSearchOpen(false),
            closeSaved: () => setSavedOpen(false),
            closeInfo: () => setInfoKey(null),
            closeProduct: () => setActiveProduct(null),
        }),
        [searchOpen, savedOpen, infoKey, activeProduct, openSearch, openSaved, openInfo, openProduct]
    );

    return <NtUiContext.Provider value={value}>{children}</NtUiContext.Provider>;
}

export function useNtUi(): NtUiContextValue {
    const value = useContext(NtUiContext);
    if (!value) throw new Error("useNtUi must be used inside NtUiProvider");
    return value;
}
