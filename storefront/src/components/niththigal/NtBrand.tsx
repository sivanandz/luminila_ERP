"use client";

import Link from "next/link";
import type { NiththigalContent } from "@/lib/niththigal-content";
import { BrandSymbol } from "./NtIcons";

type Brand = NiththigalContent["brand"];
type BrandMode = "default" | "logo" | "wordmark" | "both" | "lockup";

/**
 * Resolves the configured lockup against what has actually been uploaded.
 * Explicit modes fall back to Auto when their required asset is missing, so a
 * half-finished CMS change can never blank the header.
 */
export function resolveBrandMode(brand: Brand): BrandMode {
    const hasLogo = Boolean(brand.logoUrl);
    const hasWordmark = Boolean(brand.wordmarkUrl);
    const hasLockup = Boolean(brand.lockupUrl);
    const requested = brand.logoMode || "auto";

    if (requested === "lockup" && hasLockup) return "lockup";
    if (requested === "both" && hasLogo && hasWordmark) return "both";
    if (requested === "logo" && hasLogo) return "logo";
    if (requested === "wordmark" && hasWordmark) return "wordmark";

    if (hasLockup) return "lockup";
    if (hasLogo && hasWordmark) return "both";
    if (hasWordmark) return "wordmark";
    if (hasLogo) return "logo";
    return "default";
}

function dimensions(width: number, height: number) {
    return width > 0 && height > 0
        ? { width, height }
        : {};
}

export function NtBrand({
    brand,
    variant = "header",
    href = "/",
}: {
    brand: Brand;
    variant?: "header" | "footer";
    href?: string;
}) {
    const mode = resolveBrandMode(brand);
    const tagline = brand.showTagline ? <small>{brand.tagline}</small> : null;
    const alt = (value: string) => value || brand.name;

    return (
        <Link className="brand" href={href} aria-label={`${brand.name} home`}>
            {mode === "lockup" ? (
                <img
                    className="brand-lockup"
                    src={brand.lockupUrl}
                    alt={alt(brand.lockupAlt)}
                    {...dimensions(brand.lockupNaturalWidth, brand.lockupNaturalHeight)}
                    loading={variant === "header" ? "eager" : "lazy"}
                    decoding="async"
                />
            ) : mode === "both" ? (
                <>
                    <img
                        className="brand-logo"
                        src={brand.logoUrl}
                        alt=""
                        {...dimensions(brand.logoNaturalWidth, brand.logoNaturalHeight)}
                        loading={variant === "header" ? "eager" : "lazy"}
                        decoding="async"
                    />
                    <span className="brand-wordmark-wrap">
                        <img
                            className="brand-wordmark"
                            src={brand.wordmarkUrl}
                            alt={alt(brand.wordmarkAlt)}
                            {...dimensions(
                                brand.wordmarkNaturalWidth,
                                brand.wordmarkNaturalHeight
                            )}
                            loading={variant === "header" ? "eager" : "lazy"}
                            decoding="async"
                        />
                        {tagline}
                    </span>
                </>
            ) : mode === "wordmark" ? (
                <span className="brand-wordmark-wrap">
                    <img
                        className="brand-wordmark"
                        src={brand.wordmarkUrl}
                        alt={alt(brand.wordmarkAlt)}
                        {...dimensions(
                            brand.wordmarkNaturalWidth,
                            brand.wordmarkNaturalHeight
                        )}
                        loading={variant === "header" ? "eager" : "lazy"}
                        decoding="async"
                    />
                    {tagline}
                </span>
            ) : mode === "logo" ? (
                <img
                    className="brand-logo"
                    src={brand.logoUrl}
                    alt={alt(brand.logoAlt)}
                    {...dimensions(brand.logoNaturalWidth, brand.logoNaturalHeight)}
                    loading={variant === "header" ? "eager" : "lazy"}
                    decoding="async"
                />
            ) : (
                <>
                    {variant === "header" ? <BrandSymbol /> : null}
                    <span>
                        {brand.name}
                        {tagline}
                    </span>
                </>
            )}
        </Link>
    );
}
