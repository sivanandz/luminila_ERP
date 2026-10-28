"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { NITHTHIGAL_DEFAULTS, useNiththigalContent } from "@/lib/niththigal-content";

const PRELOADED = new Set(["Cormorant Garamond", "Manrope"]);

function stack(font: string, fallback: string): string {
    const trimmed = (font || "").trim();
    if (!trimmed) return fallback;
    if (trimmed === "Cormorant Garamond") {
        return `var(--font-cormorant), "Cormorant Garamond", ${fallback}`;
    }
    if (trimmed === "Manrope") {
        return `var(--font-manrope), "Manrope", ${fallback}`;
    }
    return `"${trimmed.replace(/"/g, "")}", ${fallback}`;
}

/**
 * Applies the CMS theme tokens and loads any non-preloaded font families.
 * Wrapping the whole storefront also gives the theme a single cascade root.
 */
export function NtSiteShell({ children }: { children: React.ReactNode }) {
    const { content } = useNiththigalContent();
    const { colors, typography } = content.theme;
    const headingFont = typography.headingFont || "Cormorant Garamond";
    const bodyFont = typography.bodyFont || "Manrope";

    useEffect(() => {
        const extra = [headingFont, bodyFont].filter((font) => !PRELOADED.has(font));
        const existing = document.getElementById("nt-theme-fonts") as HTMLLinkElement | null;
        if (!extra.length) {
            existing?.remove();
            return;
        }
        const families = [...new Set(extra)]
            .map((font) => {
                const name = font.trim().replace(/\s+/g, "+");
                return `family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;500;600;700`;
            })
            .join("&");
        const link = existing || document.createElement("link");
        link.id = "nt-theme-fonts";
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
        if (!existing) document.head.appendChild(link);
    }, [headingFont, bodyFont]);

    const style = {
        "--cream": colors.cream,
        "--paper": colors.paper,
        "--green": colors.green,
        "--green-deep": colors.greenDeep,
        "--ink": colors.ink,
        "--muted": colors.muted,
        "--gold": colors.gold,
        "--line": colors.line,
        "--serif": stack(headingFont, "Georgia, serif"),
        "--sans": stack(bodyFont, "Arial, sans-serif"),
    } as CSSProperties;

    const customTheme =
        JSON.stringify(colors) !== JSON.stringify(NITHTHIGAL_DEFAULTS.theme.colors);

    return (
        <div className={`nt-site${customTheme ? " nt-custom-theme" : ""}`} style={style}>
            {children}
        </div>
    );
}
