"use client";

import { useEffect, useState } from "react";
import { getStorefrontApiUrl } from "@/lib/api";

export interface ThemeColors {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    border: string;
}

export interface SectionOverrides {
    heroBg?: string;
    heroText?: string;
    announcementBg?: string;
    announcementText?: string;
    trustStripBg?: string;
    trustStripText?: string;
    vitrinesBg?: string;
    reviewsBg?: string;
    storyBg?: string;
    faqBg?: string;
}

export interface TypographySettings {
    headingFont: string;
    bodyFont: string;
    accentFont: string;
    fontEffect?: string;
}

export interface ThemeConfig {
    preset?: string;
    colors?: ThemeColors;
    sectionOverrides?: SectionOverrides;
    typography?: TypographySettings;
    wordmarkFont?: string;
}

export function ThemeRuntime() {
    const [theme, setTheme] = useState<ThemeConfig | null>(null);

    useEffect(() => {
        const apiUrl = getStorefrontApiUrl("/api/storefront/content");
        fetch(apiUrl)
            .then((res) => res.json())
            .then((data) => {
                if (data?.theme) {
                    setTheme({
                        ...data.theme,
                        wordmarkFont: data.branding?.wordmark?.fontFamily,
                    });
                }
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!theme) return;

        // 1. Construct Google Fonts link dynamically using official Google Fonts API
        const heading = theme.typography?.headingFont || "Playfair Display";
        const body = theme.typography?.bodyFont || "Plus Jakarta Sans";
        const accent = theme.typography?.accentFont || "Cormorant Garamond";
        const fontEffect = theme.typography?.fontEffect || "";

        const uniqueFonts = Array.from(new Set([heading, body, accent, theme.wordmarkFont].filter(Boolean) as string[]));
        
        // Encode font families with '+' for spaces and '|' as separator as per Google Fonts API
        const fontParams = uniqueFonts
            .map((f) => {
                const clean = f.trim().replace(/\s+/g, "+");
                return `${clean}:400,600,700`;
            })
            .join("|");

        let fontUrl = `https://fonts.googleapis.com/css?family=${fontParams}&display=swap`;
        if (fontEffect && fontEffect !== "none") {
            fontUrl += `&effect=${encodeURIComponent(fontEffect)}`;
        }

        let fontLink = document.getElementById("google-fonts-dynamic") as HTMLLinkElement | null;
        if (!fontLink) {
            fontLink = document.createElement("link");
            fontLink.id = "google-fonts-dynamic";
            fontLink.rel = "stylesheet";
            document.head.appendChild(fontLink);
        }
        fontLink.href = fontUrl;

        // 2. Inject CSS variables and custom classes
        const colors: ThemeColors = {
            primary: theme.colors?.primary || "#0A0A0A",
            secondary: theme.colors?.secondary || "#2A2A2A",
            accent: theme.colors?.accent || "#C5A059",
            background: theme.colors?.background || "#FFFFFF",
            surface: theme.colors?.surface || "#FAF8F5",
            border: theme.colors?.border || "#EAE6E1",
        };

        const sec: SectionOverrides = theme.sectionOverrides || {};

        let styleTag = document.getElementById("storefront-theme-style");
        if (!styleTag) {
            styleTag = document.createElement("style");
            styleTag.id = "storefront-theme-style";
            document.head.appendChild(styleTag);
        }

        const effectClassName = fontEffect && fontEffect !== "none" ? `font-effect-${fontEffect}` : "";

        styleTag.innerHTML = `
            :root {
                --color-primary: ${colors.primary};
                --color-secondary: ${colors.secondary};
                --color-accent: ${colors.accent};
                --color-background: ${colors.background};
                --color-surface: ${colors.surface};
                --color-border: ${colors.border};
                --font-heading: '${heading}', Georgia, serif;
                --font-body: '${body}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                --font-accent: '${accent}', 'Times New Roman', cursive, serif;
                --font-logo: '${theme.wordmarkFont || "Plus Jakarta Sans"}', sans-serif;
                --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
                --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
                --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
                --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
                --hero-bg: ${sec.heroBg || colors.primary};
                --hero-text: ${sec.heroText || "#FFFFFF"};
                --announcement-bg: ${sec.announcementBg || colors.primary};
                --announcement-text: ${sec.announcementText || "#FFFFFF"};
                --trust-bg: ${sec.trustStripBg || colors.surface};
                --trust-text: ${sec.trustStripText || colors.primary};
                --vitrines-bg: ${sec.vitrinesBg || colors.background};
                --reviews-bg: ${sec.reviewsBg || colors.surface};
                --story-bg: ${sec.storyBg || colors.background};
                --faq-bg: ${sec.faqBg || colors.background};
            }
            body {
                font-family: var(--font-body) !important;
                background-color: var(--color-background);
                color: var(--color-primary);
            }
            h1, h2, h3, h4, .font-heading {
                font-family: var(--font-heading) !important;
            }
            .font-accent {
                font-family: var(--font-accent) !important;
            }
            .font-logo {
                font-family: var(--font-logo) !important;
            }
            .theme-accent {
                color: var(--color-accent) !important;
            }
            .bg-theme-accent {
                background-color: var(--color-accent) !important;
            }
            .border-theme-accent {
                border-color: var(--color-accent) !important;
            }
            #announcement-bar {
                background-color: var(--announcement-bg) !important;
                color: var(--announcement-text) !important;
            }
            #trust-strip-section {
                background-color: var(--trust-bg) !important;
                color: var(--trust-text) !important;
            }
            #reviews {
                background-color: var(--reviews-bg) !important;
            }
            #brand-story {
                background-color: var(--story-bg) !important;
            }
            #faq {
                background-color: var(--faq-bg) !important;
            }
            ${effectClassName ? `
            .theme-display-heading {
                composes: ${effectClassName};
            }
            ` : ""}
        `;
    }, [theme]);

    return null;
}
