"use client";

/**
 * Client-side CMS content provider.
 *
 * The content schema, defaults and merge live in the server-safe
 * `niththigal-content-data.ts` module so the static export can read the same
 * defaults at build time. This module only owns the React context and the
 * post-hydration refresh. Initial content is rendered by the server, so the
 * first HTML carries real CMS copy; a later CMS edit still appears without a
 * rebuild once the client fetch completes.
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getStorefrontApiUrl } from "./api";
import {
    NITHTHIGAL_DEFAULTS,
    mergeNiththigal,
    type NiththigalContent,
} from "./niththigal-content-data";

export * from "./niththigal-content-data";

interface NtContentContextValue {
    content: NiththigalContent;
    ready: boolean;
}

const NiththigalContentContext = createContext<NtContentContextValue>({
    content: NITHTHIGAL_DEFAULTS,
    ready: false,
});

export function NiththigalContentProvider({
    children,
    initialContent,
}: {
    children: React.ReactNode;
    initialContent?: NiththigalContent;
}) {
    const [content, setContent] = useState<NiththigalContent>(
        initialContent ?? NITHTHIGAL_DEFAULTS
    );
    const [ready, setReady] = useState(Boolean(initialContent));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(getStorefrontApiUrl("/api/storefront/content"), {
                    cache: "no-store",
                });
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json();
                if (!cancelled && data?.niththigal) {
                    setContent(mergeNiththigal(NITHTHIGAL_DEFAULTS, data.niththigal));
                }
            } catch {
                /* the server-rendered content or defaults are already in place */
            } finally {
                if (!cancelled) setReady(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const value = useMemo(() => ({ content, ready }), [content, ready]);
    return (
        <NiththigalContentContext.Provider value={value}>
            {children}
        </NiththigalContentContext.Provider>
    );
}

export function useNiththigalContent(): NtContentContextValue {
    return useContext(NiththigalContentContext);
}
