"use client";

import { useState, useEffect } from "react";

export interface ViewportState {
    isMobile: boolean; // < 768px (smartphones)
    isTablet: boolean; // 768px - 1024px (tablets)
    isDesktop: boolean; // > 1024px
    isTauri: boolean;
    isAndroid: boolean;
    width: number;
    height: number;
}

export function useViewport(): ViewportState {
    const [viewport, setViewport] = useState<ViewportState>({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isTauri: false,
        isAndroid: false,
        width: typeof window !== "undefined" ? window.innerWidth : 1200,
        height: typeof window !== "undefined" ? window.innerHeight : 800,
    });

    useEffect(() => {
        const updateDimensions = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
            const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
            const isAndroid = userAgent.includes("android") || (isTauri && userAgent.includes("linux; android"));

            setViewport({
                isMobile: width < 768,
                isTablet: width >= 768 && width < 1024,
                isDesktop: width >= 1024,
                isTauri,
                isAndroid,
                width,
                height,
            });
        };

        updateDimensions();
        window.addEventListener("resize", updateDimensions);
        return () => window.removeEventListener("resize", updateDimensions);
    }, []);

    return viewport;
}
