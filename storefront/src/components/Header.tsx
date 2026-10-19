"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";
import {
    getStorefrontCatalog,
    extractInventoryCategories,
    InventoryCategoryNode,
} from "@/lib/pocketbase";
import { getStorefrontApiUrl } from "@/lib/api";
import { useCustomerAuth } from "@/context/CustomerAuthContext";
import { ShoppingBag, Search, X, ChevronDown, MessageCircle, Instagram, Menu, User, LogOut } from "lucide-react";

export function Header() {
    const { setIsCartOpen, cartCount } = useCart();
    const { customer, isAuthenticated, openAuthModal, logout } = useCustomerAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeCategory = searchParams.get("category") || "all";
    const activeSub = searchParams.get("sub") || "all";

    const [mounted, setMounted] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchVal, setSearchVal] = useState("");
    const [announcementText, setAnnouncementText] = useState("PAN INDIA SHIPPING • DISPATCHED IN 24-48 HRS");
    const [brandName, setBrandName] = useState("niththigal.");
    const [branding, setBranding] = useState<{
        logoType: "wordmark" | "image";
        wordmark?: {
            text: string;
            fontFamily?: string;
            fontSize?: number;
            letterSpacing?: string;
            textTransform?: "lowercase" | "uppercase" | "capitalize" | "none";
        };
        imageLogo?: {
            url: string;
            alt?: string;
            desktopHeight?: number;
            mobileHeight?: number;
        };
    }>({
        logoType: "wordmark",
        wordmark: {
            text: "niththigal.",
            fontFamily: "Plus Jakarta Sans",
            fontSize: 28,
            letterSpacing: "-0.04em",
            textTransform: "lowercase",
        },
    });
    const [instagramHandle, setInstagramHandle] = useState("niththigal_craftisans");
    const [whatsappNumber, setWhatsappNumber] = useState("+917092122334");
    const [inventoryCategories, setInventoryCategories] = useState<InventoryCategoryNode[]>([]);
    const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

    // Lock body scroll when mobile menu is open
    useEffect(() => {
        if (mobileMenuOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [mobileMenuOpen]);

    useEffect(() => {
        setMounted(true);
        // 1. Fetch dynamic CMS settings and tenant binding from ERP backend
        fetch(getStorefrontApiUrl("/api/storefront/content"))
            .then((r) => r.json())
            .then((data) => {
                if (data?.announcement?.primary) {
                    setAnnouncementText(data.announcement.primary);
                }
                if (data?.hero?.brandName) {
                    setBrandName(data.hero.brandName);
                }
                if (data?.branding) {
                    setBranding(data.branding);
                }
                if (data?.socialAndContact?.instagram) {
                    setInstagramHandle(data.socialAndContact.instagram);
                }
                if (data?.socialAndContact?.whatsappPhone) {
                    setWhatsappNumber(data.socialAndContact.whatsappPhone);
                }
                const boundAdmin = data?.adminBinding?.boundAdminEmail;
                return getStorefrontCatalog(boundAdmin);
            })
            .catch(() => {
                return getStorefrontCatalog();
            })
            .then((products) => {
                if (products) {
                    const dynamicNodes = extractInventoryCategories(products);
                    setInventoryCategories(dynamicNodes);
                }
            })
            .catch(() => {});
    }, []);

    const handleCategoryClick = (catSlug: string) => {
        setHoveredCategory(null);
        if (catSlug === "all") {
            router.push("/");
        } else {
            router.push(`/?category=${encodeURIComponent(catSlug)}`);
        }
    };

    const handleSubCategoryClick = (catSlug: string, subSlug: string) => {
        setHoveredCategory(null);
        router.push(`/?category=${encodeURIComponent(catSlug)}&sub=${encodeURIComponent(subSlug)}`);
    };

    const handleMobileCategoryClick = (catSlug: string) => {
        setMobileMenuOpen(false);
        handleCategoryClick(catSlug);
    };

    const handleMobileSubCategoryClick = (catSlug: string, subSlug: string) => {
        setMobileMenuOpen(false);
        handleSubCategoryClick(catSlug, subSlug);
    };

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchVal.trim()) {
            router.push(`/?q=${encodeURIComponent(searchVal.trim())}`);
        } else {
            router.push("/");
        }
    };

    const whatsappLink = `https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
        "Hi Niththigal Craftisans, I'm reaching out from your website! I'd like to inquire about your jewellery collection ✨"
    )}`;

    const instagramLink = `https://www.instagram.com/${instagramHandle}/`;

    return (
        <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-neutral-100 transition-colors">
            {/* Minimalist Top Ticker Bar (Escape Closet Style) */}
            <div id="announcement-bar" className="bg-black text-white py-1.5 px-4 text-center transition-colors">
                <p className="text-[10.5px] tracking-[0.2em] uppercase font-medium">
                    {announcementText}
                </p>
            </div>

            {/* Main Header Container */}
            <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-2.5 flex items-center justify-between gap-3 min-h-[60px] sm:min-h-[64px]">
                {/* 1. Left Aligned & Left Justified Logo + Mobile Hamburger Button */}
                <div className="shrink-0 flex items-center gap-2.5 sm:gap-3 text-left">
                    {/* Mobile Hamburger Button */}
                    <button
                        onClick={() => setMobileMenuOpen(true)}
                        className="md:hidden text-black hover:opacity-70 transition p-1.5 -ml-1.5 cursor-pointer rounded-xs"
                        aria-label="Open mobile navigation menu"
                    >
                        <Menu className="w-5 h-5 stroke-[1.8]" />
                    </button>

                    <Link
                        href="/"
                        className="flex items-center hover:opacity-85 transition leading-none select-none"
                    >
                        {branding.logoType === "image" && branding.imageLogo?.url ? (
                            <img
                                src={branding.imageLogo.url}
                                alt={branding.imageLogo.alt || brandName}
                                style={{
                                    height: `${branding.imageLogo.desktopHeight || 36}px`,
                                }}
                                className="w-auto object-contain max-h-[52px]"
                            />
                        ) : (
                            <span
                                className="text-2xl sm:text-[28px] font-extrabold tracking-[-0.04em] text-black font-logo"
                                style={{
                                    fontFamily: `var(--font-logo, '${branding.wordmark?.fontFamily || "Plus Jakarta Sans"}')`,
                                    fontSize: branding.wordmark?.fontSize ? `${branding.wordmark.fontSize}px` : undefined,
                                    letterSpacing: branding.wordmark?.letterSpacing || "-0.04em",
                                    textTransform: branding.wordmark?.textTransform || "lowercase",
                                }}
                            >
                                {branding.wordmark?.text || brandName}
                            </span>
                        )}
                    </Link>
                </div>

                {/* 2. Centre Space: Categories List (Desktop only - md:flex) */}
                <nav className="hidden md:flex flex-1 flex-wrap items-center justify-center gap-x-6 gap-y-1.5 px-4 text-center">
                    <button
                        onClick={() => handleCategoryClick("all")}
                        className={`text-[13px] tracking-wide capitalize transition-all pb-0.5 cursor-pointer font-medium ${
                            activeCategory === "all"
                                ? "text-black font-bold border-b-2 border-black"
                                : "text-neutral-500 hover:text-black"
                        }`}
                    >
                        All
                    </button>

                    {/* Dynamically derived categories from active warehouse stock */}
                    {inventoryCategories.map((cat) => {
                        const isActive = activeCategory.toLowerCase() === cat.slug.toLowerCase();
                        const hasSubs = cat.subcategories.length > 0;

                        return (
                            <div
                                key={cat.slug}
                                className="relative group py-1"
                                onMouseEnter={() => setHoveredCategory(cat.slug)}
                                onMouseLeave={() => setHoveredCategory(null)}
                            >
                                <button
                                    onClick={() => handleCategoryClick(cat.slug)}
                                    className={`text-[13px] tracking-wide capitalize transition-all pb-0.5 flex items-center gap-1 cursor-pointer font-medium ${
                                        isActive
                                            ? "text-black font-bold border-b-2 border-black"
                                            : "text-neutral-500 hover:text-black"
                                    }`}
                                >
                                    <span>{cat.name}</span>
                                    {hasSubs && (
                                        <ChevronDown className="w-3 h-3 text-neutral-400 group-hover:rotate-180 transition-transform duration-200" />
                                    )}
                                </button>

                                {/* Subcategory Dropdown Flyout (Emil Kowalski: origin-aware, exact transitions, no scale(0)) */}
                                {hasSubs && (
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-[opacity,transform] duration-180 ease-emil-out -translate-y-1.5 group-hover:translate-y-0 z-50 origin-top">
                                        <div className="bg-white border border-neutral-200/90 shadow-xl rounded-md py-2 px-1.5 min-w-[185px] space-y-0.5 scale-95 group-hover:scale-100 transition-transform duration-180 ease-emil-out text-left">
                                            <button
                                                onClick={() => handleCategoryClick(cat.slug)}
                                                className="w-full text-left px-3 py-1.5 text-xs text-neutral-600 hover:text-black hover:bg-neutral-50 rounded-xs flex items-center justify-between font-medium transition-colors duration-120 cursor-pointer"
                                            >
                                                <span>All {cat.name}</span>
                                                <span className="text-[10px] text-neutral-400 font-mono">
                                                    ({cat.totalCount})
                                                </span>
                                            </button>
                                            <div className="my-1 border-t border-neutral-100" />
                                            {cat.subcategories.map((sub) => (
                                                <button
                                                    key={sub.slug}
                                                    onClick={() => handleSubCategoryClick(cat.slug, sub.slug)}
                                                    className="w-full text-left px-3 py-1.5 text-xs text-neutral-700 hover:text-black hover:bg-neutral-50 rounded-xs flex items-center justify-between transition-colors duration-120 cursor-pointer"
                                                >
                                                    <span>{sub.name}</span>
                                                    <span className="text-[10px] text-neutral-400 font-mono">
                                                        ({sub.count})
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>

                {/* 3. Right Aligned Utilities: WhatsApp + Instagram + Search + Cart */}
                <div className="shrink-0 flex items-center gap-1.5 sm:gap-3">
                    {/* Direct WhatsApp Chat Action */}
                    <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-700 hover:text-black transition p-1.5 flex items-center gap-1"
                        title="Direct WhatsApp Message"
                        aria-label="Direct WhatsApp Message"
                    >
                        <MessageCircle className="w-[18px] h-[18px] stroke-[1.75]" />
                        <span className="hidden xl:inline text-xs lowercase font-medium tracking-wide">whatsapp</span>
                    </a>

                    {/* Direct Instagram Follow Action */}
                    <a
                        href={instagramLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-700 hover:text-black transition p-1.5 flex items-center gap-1"
                        title="Follow on Instagram"
                        aria-label="Follow on Instagram"
                    >
                        <Instagram className="w-[18px] h-[18px] stroke-[1.75]" />
                        <span className="hidden xl:inline text-xs lowercase font-medium tracking-wide">instagram</span>
                    </a>

                    {/* Minimal Search Button */}
                    <button
                        onClick={() => setSearchOpen(!searchOpen)}
                        className="text-neutral-700 hover:text-black transition p-1.5 cursor-pointer"
                        aria-label="Search items"
                    >
                        {searchOpen ? <X className="w-5 h-5 stroke-[1.75]" /> : <Search className="w-5 h-5 stroke-[1.75]" />}
                    </button>

                    {/* Customer Account / WhatsApp Sign In */}
                    <div className="relative">
                        {isAuthenticated && customer ? (
                            <div className="relative">
                                <button
                                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                                    className="text-neutral-800 hover:text-black transition p-1 flex items-center gap-1.5 cursor-pointer rounded-full hover:bg-neutral-100"
                                    aria-label="Account menu"
                                >
                                    <div className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">
                                        {customer.name?.charAt(0).toUpperCase() || "C"}
                                    </div>
                                    <span className="hidden lg:inline text-xs font-medium max-w-[80px] truncate">
                                        {customer.name?.split(" ")[0]}
                                    </span>
                                </button>
                                {userMenuOpen && (
                                    <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-xl border border-neutral-100 py-2 z-50 text-neutral-800 animate-in fade-in zoom-in-95 duration-150">
                                        <div className="px-3 py-2 border-b border-neutral-100">
                                            <p className="text-xs font-semibold text-black truncate">{customer.name}</p>
                                            <p className="text-[11px] text-neutral-500 font-mono">+91 {customer.phone}</p>
                                            {customer.loyalty_points !== undefined && (
                                                <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-sm inline-block mt-1 font-medium">
                                                    💎 {customer.loyalty_points} Points
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => {
                                                setUserMenuOpen(false);
                                                logout();
                                            }}
                                            className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer transition-colors"
                                        >
                                            <LogOut className="w-3.5 h-3.5" />
                                            <span>Sign Out</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={openAuthModal}
                                className="text-neutral-700 hover:text-black transition p-1.5 flex items-center gap-1 cursor-pointer"
                                title="Sign In via WhatsApp"
                                aria-label="Sign In via WhatsApp"
                            >
                                <User className="w-[18px] h-[18px] stroke-[1.75]" />
                                <span className="hidden xl:inline text-xs lowercase font-medium tracking-wide">account</span>
                            </button>
                        )}
                    </div>

                    {/* Cart Trigger with Counter Badge */}
                    <button
                        onClick={() => setIsCartOpen(true)}
                        className="relative text-neutral-800 hover:text-black transition p-1.5 flex items-center cursor-pointer"
                        aria-label="Open cart"
                    >
                        <ShoppingBag className="w-5 h-5 stroke-[1.75]" />
                        {cartCount > 0 && (
                            <span
                                key={cartCount}
                                className="absolute -top-1 -right-1 bg-black text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none animate-in zoom-in-75 duration-150 shadow-xs"
                            >
                                {cartCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Mobile Navigation Drawer Modal (Portal to body to escape sticky header containing block) */}
            {mounted && mobileMenuOpen && createPortal(
                <div className="fixed inset-0 z-[100] md:hidden flex animate-in fade-in duration-200">
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200"
                        onClick={() => setMobileMenuOpen(false)}
                    />

                    {/* Drawer Content (Emil Kowalski: iOS drawer curve 300ms) */}
                    <div className="relative w-[85vw] max-w-[340px] bg-white h-dvh max-h-screen shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-300 ease-emil-drawer">
                        {/* Drawer Header */}
                        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
                            <Link
                                href="/"
                                onClick={() => setMobileMenuOpen(false)}
                                className="flex items-center hover:opacity-85 transition leading-none select-none"
                            >
                                {branding.logoType === "image" && branding.imageLogo?.url ? (
                                    <img
                                        src={branding.imageLogo.url}
                                        alt={branding.imageLogo.alt || brandName}
                                        style={{
                                            height: `${branding.imageLogo.mobileHeight || 26}px`,
                                        }}
                                        className="w-auto object-contain max-h-[40px]"
                                    />
                                ) : (
                                    <span
                                        className="text-2xl font-black tracking-[-0.04em] text-black font-logo"
                                        style={{
                                            fontFamily: `var(--font-logo, '${branding.wordmark?.fontFamily || "Plus Jakarta Sans"}')`,
                                            letterSpacing: branding.wordmark?.letterSpacing || "-0.04em",
                                            textTransform: branding.wordmark?.textTransform || "lowercase",
                                        }}
                                    >
                                        {branding.wordmark?.text || brandName}
                                    </span>
                                )}
                            </Link>
                            <button
                                onClick={() => setMobileMenuOpen(false)}
                                className="p-2 -mr-2 text-neutral-500 hover:text-black cursor-pointer"
                                aria-label="Close menu"
                            >
                                <X className="w-5 h-5 stroke-[1.75]" />
                            </button>
                        </div>

                        {/* Mobile Account Banner */}
                        <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50/60">
                            {isAuthenticated && customer ? (
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-semibold text-black">{customer.name}</p>
                                        <p className="text-[11px] text-neutral-500 font-mono">+91 {customer.phone}</p>
                                        {customer.loyalty_points !== undefined && (
                                            <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-sm inline-block mt-0.5 font-medium">
                                                💎 {customer.loyalty_points} Points
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => {
                                            setMobileMenuOpen(false);
                                            logout();
                                        }}
                                        className="text-xs text-red-600 font-medium hover:underline p-1 cursor-pointer"
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => {
                                        setMobileMenuOpen(false);
                                        openAuthModal();
                                    }}
                                    className="w-full flex items-center justify-center gap-2 py-2 bg-black text-white text-xs font-semibold uppercase tracking-wider rounded-xs cursor-pointer shadow-xs"
                                >
                                    <User className="w-3.5 h-3.5" />
                                    <span>Sign In via WhatsApp</span>
                                </button>
                            )}
                        </div>

                        {/* Search inside Drawer */}
                        <div className="p-4 border-b border-neutral-100">
                            <form
                                onSubmit={(e) => {
                                    handleSearchSubmit(e);
                                    setMobileMenuOpen(false);
                                }}
                                className="relative flex items-center"
                            >
                                <Search className="w-4 h-4 text-neutral-400 absolute left-3" />
                                <input
                                    type="text"
                                    value={searchVal}
                                    onChange={(e) => setSearchVal(e.target.value)}
                                    placeholder="Search jewellery..."
                                    className="w-full pl-9 pr-3 py-2 text-xs bg-neutral-100 rounded-xs outline-hidden text-black placeholder:text-neutral-400 focus:bg-white focus:ring-1 focus:ring-black transition"
                                />
                            </form>
                        </div>

                        {/* Categories List */}
                        <div className="flex-1 overflow-y-auto px-5 py-3 divide-y divide-neutral-100 space-y-1">
                            <div className="pb-1.5">
                                <button
                                    onClick={() => handleMobileCategoryClick("all")}
                                    className={`w-full text-left py-2 text-sm tracking-wide capitalize flex items-center justify-between font-medium ${
                                        activeCategory === "all" ? "text-black font-bold" : "text-neutral-600 hover:text-black"
                                    }`}
                                >
                                    <span>All Jewellery</span>
                                    {activeCategory === "all" && <span className="w-1.5 h-1.5 rounded-full bg-black" />}
                                </button>
                            </div>

                            {inventoryCategories.map((cat) => {
                                const isActive = activeCategory.toLowerCase() === cat.slug.toLowerCase();
                                const hasSubs = cat.subcategories.length > 0;
                                const isExpanded = expandedCategory === cat.slug;

                                return (
                                    <div key={cat.slug} className="py-1">
                                        <div className="flex items-center justify-between py-1.5">
                                            <button
                                                onClick={() => handleMobileCategoryClick(cat.slug)}
                                                className={`text-left text-sm tracking-wide capitalize transition font-medium flex items-center gap-2 ${
                                                    isActive ? "text-black font-bold" : "text-neutral-800 hover:text-black"
                                                }`}
                                            >
                                                <span>{cat.name}</span>
                                                <span className="text-[10px] text-neutral-400 font-mono">
                                                    ({cat.totalCount})
                                                </span>
                                            </button>

                                            {hasSubs && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setExpandedCategory(isExpanded ? null : cat.slug);
                                                    }}
                                                    className="p-1.5 text-neutral-400 hover:text-black cursor-pointer"
                                                    aria-label={`Toggle ${cat.name} subcategories`}
                                                >
                                                    <ChevronDown
                                                        className={`w-4 h-4 transition-transform duration-200 ${
                                                            isExpanded ? "rotate-180 text-black" : ""
                                                        }`}
                                                    />
                                                </button>
                                            )}
                                        </div>

                                        {/* Subcategory accordion */}
                                        {hasSubs && isExpanded && (
                                            <div className="pl-3 pb-2 space-y-1 animate-in fade-in duration-150">
                                                <button
                                                    onClick={() => handleMobileCategoryClick(cat.slug)}
                                                    className="w-full text-left py-1 text-xs text-neutral-500 hover:text-black flex items-center justify-between"
                                                >
                                                    <span>All {cat.name}</span>
                                                    <span className="text-[10px] text-neutral-400 font-mono">
                                                        ({cat.totalCount})
                                                    </span>
                                                </button>
                                                {cat.subcategories.map((sub) => {
                                                    const isSubActive =
                                                        isActive && activeSub.toLowerCase() === sub.slug.toLowerCase();
                                                    return (
                                                        <button
                                                            key={sub.slug}
                                                            onClick={() => handleMobileSubCategoryClick(cat.slug, sub.slug)}
                                                            className={`w-full text-left py-1 text-xs flex items-center justify-between transition ${
                                                                isSubActive
                                                                    ? "text-black font-bold"
                                                                    : "text-neutral-600 hover:text-black"
                                                            }`}
                                                        >
                                                            <span>{sub.name}</span>
                                                            <span className="text-[10px] text-neutral-400 font-mono">
                                                                ({sub.count})
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Drawer Footer Actions: WhatsApp + Instagram */}
                        <div className="p-4 border-t border-neutral-100 bg-neutral-50 space-y-2.5">
                            <a
                                href={whatsappLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xs bg-white border border-neutral-200 text-neutral-800 text-xs font-semibold uppercase tracking-wider hover:bg-neutral-100 transition"
                            >
                                <MessageCircle className="w-4 h-4 stroke-[1.75]" />
                                <span>Chat on WhatsApp</span>
                            </a>

                            <a
                                href={instagramLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xs bg-white border border-neutral-200 text-neutral-800 text-xs font-semibold uppercase tracking-wider hover:bg-neutral-100 transition"
                            >
                                <Instagram className="w-4 h-4 stroke-[1.75]" />
                                <span>Follow @{instagramHandle}</span>
                            </a>

                            <p className="text-[10px] text-center text-neutral-400 uppercase tracking-widest pt-1">
                                {announcementText}
                            </p>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Search Dropdown Input Bar */}
            {searchOpen && (
                <div className="border-t border-neutral-100 bg-white py-3 px-4 sm:px-8 shadow-xs animate-in fade-in duration-150">
                    <form onSubmit={handleSearchSubmit} className="max-w-[1440px] mx-auto flex items-center gap-3">
                        <Search className="w-4 h-4 text-neutral-400" />
                        <input
                            type="text"
                            value={searchVal}
                            onChange={(e) => setSearchVal(e.target.value)}
                            placeholder="Search in-stock imitation chokers, temple sets, earrings..."
                            className="w-full text-sm outline-hidden text-black placeholder:text-neutral-400 bg-transparent"
                            autoFocus
                        />
                        {searchVal && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchVal("");
                                    router.push("/");
                                }}
                                className="text-xs text-neutral-400 hover:text-black uppercase tracking-wider cursor-pointer"
                            >
                                Clear
                            </button>
                        )}
                    </form>
                </div>
            )}
        </header>
    );
}
