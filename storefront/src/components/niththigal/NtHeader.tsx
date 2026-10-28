"use client";

import { useEffect, useMemo, useState } from "react";
import { useCart } from "@/context/CartContext";
import { useCustomerAuth } from "@/context/CustomerAuthContext";
import { useWishlist } from "@/hooks/use-wishlist";
import { useNiththigalContent, type NtNavItem } from "@/lib/niththigal-content";
import { useNtCatalog } from "./NtCatalogContext";
import { useNtUi } from "./NtUiContext";
import { NtBrand } from "./NtBrand";

function buildNavItems(items: NtNavItem[], categories: string[]): NtNavItem[] {
    const all =
        items.find((item) => item.filter === "All pieces") ?? {
            label: "Shop all",
            href: "#collection",
            filter: "All pieces",
        };
    const categorySlots = items.filter(
        (item) => item.filter && item.filter !== "All pieces"
    );
    const otherLinks = items.filter((item) => !item.filter);
    const used = new Set<string>();
    const categoryLinks: NtNavItem[] = [];

    for (const slot of categorySlots) {
        const match = categories.find(
            (category) =>
                category.toLowerCase() === (slot.filter || "").toLowerCase()
        );
        if (match && !used.has(match)) {
            categoryLinks.push({
                label: match,
                href: "#collection",
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
            filter: category,
        });
        used.add(category);
    }

    return [all, ...categoryLinks, ...otherLinks];
}
import {
    AccountIcon,
    BagIcon,
    CloseIcon,
    HeartIcon,
    MenuIcon,
    SearchIcon,
} from "./NtIcons";

/**
 * Announcement band + sticky frosted navigation, matching the Niththigal
 * example element-for-element. The bag count is live from CartContext and the
 * saved dot from the wishlist; sign-in stays available as an extra action.
 */
export function NtHeader() {
    const { content } = useNiththigalContent();
    const { setFilter, categories } = useNtCatalog();
    const { openSearch, openSaved } = useNtUi();
    const { cartCount, setIsCartOpen } = useCart();
    const { customer, isAuthenticated, openAuthModal } = useCustomerAuth();
    const { saved } = useWishlist();
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [pulseKey, setPulseKey] = useState(0);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 10);
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        if (cartCount > 0) setPulseKey((key) => key + 1);
    }, [cartCount]);

    useEffect(() => {
        if (!menuOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setMenuOpen(false);
                document.getElementById("nt-menu-button")?.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [menuOpen]);

    useEffect(() => {
        const onResize = () => {
            if (window.innerWidth > 600) setMenuOpen(false);
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const activate = (item: NtNavItem) => (event: React.MouseEvent<HTMLAnchorElement>) => {
        setMenuOpen(false);
        const hashTarget =
            item.href.startsWith("#") && item.href.length > 1
                ? document.querySelector(item.href)
                : null;

        if (item.filter) {
            event.preventDefault();
            setFilter(item.filter);
            if (hashTarget) {
                hashTarget.scrollIntoView({ behavior: "smooth", block: "start" });
            } else {
                try {
                    sessionStorage.setItem("niththigal_filter_hint", item.filter);
                } catch {
                    /* storage unavailable */
                }
                window.location.assign(`/${item.href}`);
            }
            return;
        }

        // Hash links in the global header must still work from /checkout.
        if (item.href.startsWith("#") && !hashTarget) {
            event.preventDefault();
            window.location.assign(`/${item.href}`);
        }
    };

    const { brand, announcement, ui } = content;
    const navItems = useMemo(
        () => buildNavItems(brand.nav, categories),
        [brand.nav, categories]
    );
    const mobileNavItems = useMemo(() => {
        const all =
            brand.mobileNav.find((item) => item.filter === "All pieces") ?? {
                label: "Shop the collection",
                href: "#collection",
                filter: "All pieces",
            };
        const otherLinks = brand.mobileNav.filter((item) => !item.filter);
        return [
            all,
            ...categories.map((category) => ({
                label: category,
                href: "#collection",
                filter: category,
            })),
            ...otherLinks,
        ];
    }, [brand.mobileNav, categories]);

    return (
        <>
            {announcement.text ? (
                <div className="announcement">
                    <span>{announcement.text}</span>
                    {announcement.star ? <span className="announcement-star">{announcement.star}</span> : null}
                    {announcement.extra ? <span className="announcement-extra">{announcement.extra}</span> : null}
                </div>
            ) : null}

            <header className={`header ${scrolled ? "scrolled" : ""}`}>
                <div className="nav-wrap">
                    <NtBrand brand={brand} variant="header" />

                    <nav className="desktop-nav" aria-label="Main navigation">
                        {navItems.map((item) => (
                            <a key={`${item.label}-${item.href}`} href={item.href} onClick={activate(item)}>
                                {item.label}
                            </a>
                        ))}
                    </nav>

                    <div className="nav-actions">
                        <button
                            className="icon-button"
                            onClick={openSearch}
                            aria-label="Search jewellery"
                        >
                            <SearchIcon />
                        </button>

                        <button
                            className="icon-button saved-button"
                            onClick={openSaved}
                            aria-label="View saved jewellery"
                        >
                            <HeartIcon filled={saved.size > 0} />
                            <span className="saved-dot" hidden={saved.size === 0} />
                        </button>

                        <button
                            className="icon-button bag-button"
                            onClick={() => setIsCartOpen(true)}
                            aria-label={`Open shopping bag, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
                        >
                            <BagIcon />
                            <span key={pulseKey} id="cart-count">
                                {cartCount}
                            </span>
                        </button>

                        {isAuthenticated ? (
                            <span
                                className="icon-button account-button"
                                title={customer?.name || "Signed in"}
                                aria-label={customer?.name ? `Signed in as ${customer.name}` : "Signed in"}
                            >
                                <span className="account-initial">
                                    {(customer?.name || "N").slice(0, 1).toUpperCase()}
                                </span>
                            </span>
                        ) : (
                            <button
                                className="icon-button account-button"
                                onClick={openAuthModal}
                                aria-label="Sign in to your account"
                                title="Sign in"
                            >
                                <AccountIcon />
                            </button>
                        )}

                        <button
                            id="nt-menu-button"
                            className="icon-button mobile-toggle"
                            onClick={() => setMenuOpen((open) => !open)}
                            aria-expanded={menuOpen}
                            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                        >
                            {menuOpen ? <CloseIcon /> : <MenuIcon />}
                        </button>
                    </div>
                </div>

                {menuOpen ? (
                    <nav className="mobile-nav" aria-label="Mobile navigation">
                        {mobileNavItems.map((item) => (
                            <a key={`${item.label}-${item.href}`} href={item.href} onClick={activate(item)}>
                                {item.label} <span aria-hidden>↗</span>
                            </a>
                        ))}
                        {!isAuthenticated ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setMenuOpen(false);
                                    openAuthModal();
                                }}
                            >
                                Sign in to your account <span aria-hidden>↗</span>
                            </button>
                        ) : null}
                        <button type="button" onClick={openSearch}>
                            Search jewellery <span aria-hidden>↗</span>
                        </button>
                    </nav>
                ) : null}
            </header>
        </>
    );
}
