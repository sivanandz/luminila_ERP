"use client";

import { useMemo } from "react";
import {
    useNiththigalContent,
    yearCopy,
    type NtFooterLink,
} from "@/lib/niththigal-content";
import { useNtCatalog } from "./NtCatalogContext";
import { useNtUi } from "./NtUiContext";
import { NtBrand } from "./NtBrand";
import "./nt-footer.css";

/** Canonical page for a policy action when the CMS supplies no real URL. */
const POLICY_PATHS: Partial<Record<NtFooterLink["action"], string>> = {
    shipping: "/shipping-returns",
    privacy: "/privacy",
    care: "/jewellery-care",
};

/** A bare hash must survive a click from any page, so it renders as "/#…". */
function pageHref(href: string): string {
    const value = (href || "").trim();
    if (value.startsWith("#")) return `/${value}`;
    return value || "/";
}

/**
 * Policy links always point at the visible page. A saved CMS value such as
 * "#" or "#faq" is replaced by the canonical path, never opened as a dialog.
 */
function policyHref(link: NtFooterLink): string {
    const canonical = POLICY_PATHS[link.action];
    if (!canonical) return pageHref(link.href);
    const value = (link.href || "").trim();
    if (value.startsWith("/") && !value.startsWith("//") && value !== "/") return value;
    return canonical;
}

function findHashTarget(hash: string): Element | null {
    if (!hash || hash.length < 2) return null;
    try {
        return document.querySelector(hash);
    } catch {
        return null;
    }
}

function FooterLink({ link }: { link: NtFooterLink }) {
    const { setFilter } = useNtCatalog();
    const { openSaved, openSearch } = useNtUi();

    // Saved pieces and search stay dialog actions; policies are real pages.
    if (link.action === "saved" || link.action === "search") {
        return (
            <button
                type="button"
                onClick={() => {
                    if (link.action === "saved") openSaved();
                    if (link.action === "search") openSearch();
                }}
            >
                {link.label}
            </button>
        );
    }

    if (
        link.action === "shipping" ||
        link.action === "privacy" ||
        link.action === "care"
    ) {
        return <a href={policyHref(link)}>{link.label}</a>;
    }

    const raw = (link.href || "").trim();
    const hash = raw.startsWith("#") ? raw : raw.startsWith("/#") ? raw.slice(1) : "";
    const destination = raw.startsWith("#") ? `/${raw}` : raw || "/";

    return (
        <a
            href={pageHref(raw)}
            onClick={(event) => {
                const hashTarget = findHashTarget(hash);

                if (link.filter) {
                    event.preventDefault();
                    setFilter(link.filter);
                    if (hashTarget) {
                        hashTarget.scrollIntoView({ behavior: "smooth", block: "start" });
                    } else {
                        try {
                            sessionStorage.setItem("niththigal_filter_hint", link.filter);
                        } catch {
                            /* storage unavailable */
                        }
                        window.location.assign(destination);
                    }
                    return;
                }

                if (hash && !hashTarget) {
                    event.preventDefault();
                    window.location.assign(destination);
                }
            }}
        >
            {link.label}
        </a>
    );
}

/** Footer, matching the example's four-column editorial block. */
export function NtFooter() {
    const { content } = useNiththigalContent();
    const { categories } = useNtCatalog();
    const { openSaved } = useNtUi();
    const { footer, brand } = content;

    const columns = useMemo(
        () =>
            footer.columns.map((column) => {
                const hasFilters = column.links.some((link) => Boolean(link.filter));
                if (!hasFilters) return column;

                const all =
                    column.links.find((link) => link.filter === "All pieces") ?? {
                        label: "Shop all jewellery",
                        href: "#collection",
                        action: "none" as const,
                        filter: "All pieces",
                    };
                const categorySlots = column.links.filter(
                    (link) => link.filter && link.filter !== "All pieces"
                );
                const otherLinks = column.links.filter((link) => !link.filter);
                const used = new Set<string>();
                const categoryLinks: NtFooterLink[] = [];

                for (const slot of categorySlots) {
                    const match = categories.find(
                        (category) =>
                            category.toLowerCase() ===
                            (slot.filter || "").toLowerCase()
                    );
                    if (match && !used.has(match)) {
                        categoryLinks.push({
                            label: match,
                            href: "#collection",
                            action: "none",
                            filter: match,
                        });
                        used.add(match);
                    }
                }
                for (const category of categories) {
                    if (used.has(category)) continue;
                    categoryLinks.push({
                        label: category,
                        href: "#collection",
                        action: "none",
                        filter: category,
                    });
                    used.add(category);
                }

                return {
                    ...column,
                    links: [all, ...categoryLinks, ...otherLinks],
                };
            }),
        [footer.columns, categories]
    );

    return (
        <footer className="footer">
            <div className={`footer-top${columns.length >= 3 ? " nt-footer-wide" : ""}`}>
                <div className="footer-brand">
                    <NtBrand brand={brand} variant="footer" />
                    <p>
                        {footer.descriptionLine1}
                        <br />
                        {footer.descriptionLine2}
                    </p>
                    <span className="footer-location">{footer.location}</span>
                </div>

                {columns.map((column, columnIndex) => (
                    <div className="footer-links" key={`${column.title}-${columnIndex}`}>
                        <h3>{column.title}</h3>
                        {column.links.map((link) => (
                            <FooterLink key={`${column.title}-${link.label}`} link={link} />
                        ))}
                        {columnIndex === 0 ? (
                            <button className="saved-footer" onClick={openSaved}>
                                {footer.savedLabel}
                            </button>
                        ) : null}
                    </div>
                ))}

                <div className="footer-note">
                    <span>{footer.noteTop}</span>
                    <p>
                        {footer.noteLine1}
                        <br />
                        {footer.noteLine2} <em>{footer.noteEmphasis}</em>
                    </p>
                    {footer.noteAccent ? (
                        <span
                            className="gold-text"
                            style={{ whiteSpace: "pre-wrap" }}
                        >
                            {footer.noteAccent}
                        </span>
                    ) : null}
                </div>
            </div>

            <div className="footer-bottom">
                <span>{yearCopy(footer.bottomLeft)}</span>
                <span>
                    {footer.bottomRight}
                    {footer.bottomRightAccent ? (
                        <>
                            {" "}
                            <span className="gold-text">{footer.bottomRightAccent}</span>
                        </>
                    ) : null}
                </span>
            </div>
            <p className="preview-note">{footer.legalNote}</p>
        </footer>
    );
}
