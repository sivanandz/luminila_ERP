"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { getStorefrontCatalog, type StorefrontProduct } from "@/lib/pocketbase";
import { sortCatalogProducts } from "@/lib/catalog-sort";
import { buildProductSlugIndex } from "@/lib/seo";

interface CatalogContextValue {
    products: StorefrontProduct[];
    loading: boolean;
    categories: string[];
    filter: string;
    setFilter: (filter: string) => void;
    refresh: () => Promise<void>;
    minPrice: number | null;
    /** Product id → canonical product slug, shared with server-rendered links. */
    slugByProductId: Record<string, string>;
}

const ALL_PIECES = "All pieces";

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function NtCatalogProvider({
    children,
    initialProducts,
    initialSlugs,
}: {
    children: React.ReactNode;
    initialProducts?: StorefrontProduct[];
    initialSlugs?: Record<string, string>;
}) {
    const [products, setProducts] = useState<StorefrontProduct[]>(initialProducts ?? []);
    const [loading, setLoading] = useState(initialProducts === undefined);
    const [filter, setFilterState] = useState(ALL_PIECES);
    const [slugByProductId, setSlugByProductId] = useState<Record<string, string>>(
        initialSlugs ?? buildProductSlugIndex(initialProducts ?? [])
    );

    const refresh = useCallback(async () => {
        try {
            const list = await getStorefrontCatalog();
            const sorted = sortCatalogProducts(list);
            setProducts(sorted);
            setSlugByProductId(buildProductSlugIndex(sorted));
        } catch {
            /* keep the server-rendered or previous list on a transient failure */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        // A header/footer filter link followed from another route hands the
        // chosen category over so the home page lands on the right chip.
        try {
            const hint = sessionStorage.getItem("niththigal_filter_hint");
            if (hint) {
                setFilterState(hint);
                sessionStorage.removeItem("niththigal_filter_hint");
            }
        } catch {
            /* storage unavailable */
        }
    }, [refresh]);

    const categories = useMemo(() => {
        const set = new Set<string>();
        for (const product of products) {
            const category = (product.category || "").trim();
            if (category) set.add(category);
        }
        // Keep the example's Earrings → Necklaces → Bangles reading order,
        // then any additional catalogue categories alphabetically.
        const preferred = ["Earrings", "Necklaces", "Bangles"];
        return [...set].sort((a, b) => {
            const ai = preferred.indexOf(a);
            const bi = preferred.indexOf(b);
            if (ai !== -1 || bi !== -1) {
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            }
            return a.localeCompare(b);
        });
    }, [products]);

    const setFilter = useCallback((next: string) => {
        setFilterState(next || ALL_PIECES);
    }, []);

    const minPrice = useMemo(() => {
        const prices = products
            .map((product) => product.website_price)
            .filter((price) => Number.isFinite(price) && price > 0);
        return prices.length ? Math.min(...prices) : null;
    }, [products]);

    useEffect(() => {
        // The motion layer rebuilds its card layers for every new grid.
        if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("niththigal:products"));
        }
    }, [products, filter]);

    const value = useMemo(
        () => ({
            products,
            loading,
            categories,
            filter,
            setFilter,
            refresh,
            minPrice,
            slugByProductId,
        }),
        [
            products,
            loading,
            categories,
            filter,
            setFilter,
            refresh,
            minPrice,
            slugByProductId,
        ]
    );

    return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useNtCatalog(): CatalogContextValue {
    const value = useContext(CatalogContext);
    if (!value) throw new Error("useNtCatalog must be used inside NtCatalogProvider");
    return value;
}

export { ALL_PIECES };
