"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Globe,
    Sparkles,
    Eye,
    Save,
    RotateCcw,
    ExternalLink,
    Megaphone,
    Image as ImageIcon,
    Tag,
    Share2,
    CheckCircle2,
    Sliders,
    Plus,
    Trash2,
    ChevronLeft,
    ChevronRight,
    ArrowUp,
    ArrowDown,
    Layers,
    Link as LinkIcon,
    Star,
    Smartphone,
    HelpCircle,
    BookOpen,
    ShieldCheck,
    Pin,
    Flame,
    Clock,
    Palette,
    Type,
    ArrowRight,
    Pencil,
    UserCheck,
    Server,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { pb } from "@/lib/pocketbase";

export interface HeroSlide {
    id: string;
    title: string;
    tagline: string;
    ctaText: string;
    ctaLink: string;
    imageUrl: string;
    mobileImageUrl?: string;
    badgeText?: string;
    countdownTarget?: string;
    ctaStyle?: "underline" | "box";
    overlayOpacity: number;
}

export interface LayoutSectionItem {
    id: "hero_slideshow" | "trust_strip" | "category_vitrines" | "flash_promo" | "customer_reviews" | "instagram_feed" | "brand_story" | "faq_accordion";
    name: string;
    enabled: boolean;
    order: number;
}

export interface ReviewItem {
    id: string;
    customerName: string;
    city: string;
    rating: number;
    reviewText: string;
    itemPurchased: string;
    verifiedBuyer: boolean;
}

export interface FaqItem {
    question: string;
    answer: string;
}

export interface StorefrontContentState {
    announcement: {
        enabled: boolean;
        primary: string;
        secondary: string;
        couponSnippet: string;
        dispatchUrgencyText?: string;
    };
    hero: {
        brandName: string;
        tagline: string;
        ctaText: string;
        ctaLink: string;
        imageUrl: string;
        overlayOpacity: number;
        autoplaySpeed?: number;
        slides: HeroSlide[];
    };
    layoutSections: LayoutSectionItem[];
    trustStrip: {
        enabled: boolean;
        items: {
            icon: "truck" | "shield" | "sparkles" | "rotate-ccw";
            title: string;
            subtitle: string;
        }[];
    };
    merchandising: {
        autoLowStockThreshold: number;
        pinnedProductSkus: string[];
        customProductBadges: Record<string, string>;
    };
    reviews: {
        enabled: boolean;
        heading: string;
        subheading: string;
        items: ReviewItem[];
    };
    brandStory: {
        enabled: boolean;
        tagline: string;
        heading: string;
        bodyText: string;
        craftDetails: string[];
        imageUrl: string;
    };
    faq: {
        enabled: boolean;
        items: FaqItem[];
    };
    stickyMobileBar: {
        enabled: boolean;
        showWhatsApp: boolean;
        showCart: boolean;
        whatsappMessagePreset?: string;
    };
    vitrines: {
        id: string;
        title: string;
        filter: string;
    }[];
    promoBanner: {
        enabled: boolean;
        code: string;
        discount: string;
        description: string;
    };
    socialAndContact: {
        instagram: string;
        whatsappPhone: string;
        supportEmail: string;
    };
    instagramFeed: {
        enabled: boolean;
        handle: string;
        heading: string;
        posts: {
            id: string;
            url: string;
            imageUrl: string;
            caption: string;
            type: "reel" | "post";
        }[];
    };
    branding: {
        logoType: "wordmark" | "image";
        wordmark: {
            text: string;
            fontFamily: string;
            fontSize: number;
            letterSpacing: string;
            textTransform: "lowercase" | "uppercase" | "capitalize" | "none";
        };
        imageLogo: {
            url: string;
            alt: string;
            desktopHeight: number;
            mobileHeight: number;
        };
    };
    theme: {
        preset: string;
        colors: {
            primary: string;
            secondary: string;
            accent: string;
            background: string;
            surface: string;
            border: string;
        };
        sectionOverrides: {
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
        };
        typography: {
            headingFont: string;
            bodyFont: string;
            accentFont: string;
            fontEffect?: string;
        };
    };
    adminBinding?: {
        boundAdminEmail: string;
        customDomain: string;
        storefrontStatus: "active" | "maintenance" | "disabled";
        sslConfigured: boolean;
        storefrontName: string;
        boundAt?: string;
    };
}

export type CmsTab =
    | "domain_binding"
    | "ticker"
    | "hero"
    | "layout"
    | "branding_theme"
    | "trust"
    | "vitrines"
    | "merchandising"
    | "reviews"
    | "story_faq"
    | "promo"
    | "mobile_social";

const PALETTE_PRESETS = [
    {
        id: "royal_gold",
        name: "Royal Atelier Gold & Obsidian",
        description: "Signature Royal Gold with deep obsidian and warm alabaster",
        colors: {
            primary: "#0A0A0A",
            secondary: "#2A2A2A",
            accent: "#C5A059",
            background: "#FFFFFF",
            surface: "#FAF8F5",
            border: "#EAE6E1",
        },
        typography: {
            headingFont: "Playfair Display",
            bodyFont: "Plus Jakarta Sans",
            accentFont: "Cormorant Garamond",
        },
    },
    {
        id: "temple_heritage",
        name: "Temple Heritage Matte",
        description: "Antique temple ochre gold with earthy stone and ivory parchment",
        colors: {
            primary: "#1C1917",
            secondary: "#44403C",
            accent: "#D97706",
            background: "#FCFBF9",
            surface: "#F5F3EF",
            border: "#E7E5E4",
        },
        typography: {
            headingFont: "Cinzel",
            bodyFont: "Inter",
            accentFont: "Italianno",
        },
    },
    {
        id: "modern_rose",
        name: "Modern Rose Quartz",
        description: "Contemporary rose rubellite with zinc jet and soft blush cards",
        colors: {
            primary: "#18181B",
            secondary: "#3F3F46",
            accent: "#E11D48",
            background: "#FFFFFF",
            surface: "#FFF1F2",
            border: "#FFE4E6",
        },
        typography: {
            headingFont: "Montserrat",
            bodyFont: "Outfit",
            accentFont: "Great Vibes",
        },
    },
    {
        id: "emerald_royalty",
        name: "Emerald Royalty",
        description: "Deep emerald forest with polki sun-gold accents",
        colors: {
            primary: "#064E3B",
            secondary: "#065F46",
            accent: "#F59E0B",
            background: "#FBFDFB",
            surface: "#ECFDF5",
            border: "#D1FAE5",
        },
        typography: {
            headingFont: "Cormorant Garamond",
            bodyFont: "Plus Jakarta Sans",
            accentFont: "Cormorant Garamond",
        },
    },
    {
        id: "obsidian_minimalist",
        name: "Obsidian Minimalist",
        description: "Pure monochrome editorial with crisp neutral greys",
        colors: {
            primary: "#000000",
            secondary: "#262626",
            accent: "#525252",
            background: "#FFFFFF",
            surface: "#FAFAFA",
            border: "#EEEEEE",
        },
        typography: {
            headingFont: "Plus Jakarta Sans",
            bodyFont: "Inter",
            accentFont: "Plus Jakarta Sans",
        },
    },
];

const CURATED_GOOGLE_FONTS = {
    logo: [
        "Plus Jakarta Sans",
        "Playfair Display",
        "Cinzel",
        "Bodoni Moda",
        "Prata",
        "Cormorant Garamond",
        "Montserrat",
        "Marcellus",
        "Italianno",
        "Tangerine",
        "Outfit",
        "Jost",
    ],
    headings: [
        "Playfair Display",
        "Cormorant Garamond",
        "Cinzel",
        "Montserrat",
        "Plus Jakarta Sans",
        "Prata",
        "Bodoni Moda",
        "Marcellus",
        "Inconsolata",
    ],
    body: [
        "Plus Jakarta Sans",
        "Inter",
        "Outfit",
        "Roboto",
        "Jost",
        "DM Sans",
        "Geist",
    ],
    accent: [
        "Cormorant Garamond",
        "Tangerine",
        "Italianno",
        "Great Vibes",
        "Alex Brush",
        "Playfair Display",
    ],
};

const GOOGLE_FONT_EFFECTS = [
    { id: "none", name: "None (Default Pure Luxe)" },
    { id: "shadow-multiple", name: "Shadow Multiple (Editorial Depth)" },
    { id: "3d-float", name: "3D Float (Raised Dimension)" },
    { id: "emboss", name: "Emboss (Carved Heirloom)" },
    { id: "neon", name: "Neon (Modern Glow)" },
    { id: "anaglyph", name: "Anaglyph (Chromatic)" },
    { id: "vintage", name: "Vintage (Antique Texture)" },
    { id: "outline", name: "Outline (Editorial Hollow)" },
    { id: "3d", name: "3D (Isometric Solid)" },
];

const SECTION_CONFIG_MAP: Record<
    string,
    {
        tab: CmsTab;
        tabLabel: string;
        getDescription: (state: StorefrontContentState) => string;
    }
> = {
    hero_slideshow: {
        tab: "hero",
        tabLabel: "Hero Slideshow",
        getDescription: (s) => `${s.hero.slides?.length || 0} Slides · Autoplay ${s.hero.autoplaySpeed ? `${s.hero.autoplaySpeed / 1000}s` : "Manual"}`,
    },
    trust_strip: {
        tab: "trust",
        tabLabel: "Trust Guarantee Strip",
        getDescription: (s) => `${s.trustStrip.items?.length || 0} Guarantee Badges`,
    },
    category_vitrines: {
        tab: "vitrines",
        tabLabel: "Vitrines & Catalog Grid",
        getDescription: (s) => `${s.vitrines?.length || 0} Vitrines Configured`,
    },
    flash_promo: {
        tab: "promo",
        tabLabel: "Promo Banner & Coupons",
        getDescription: (s) => `Code: ${s.promoBanner?.code || "FESTIVE10"} (${s.promoBanner?.discount || "10% OFF"})`,
    },
    customer_reviews: {
        tab: "reviews",
        tabLabel: "Customer Reviews Carousel",
        getDescription: (s) => `${s.reviews.items?.length || 0} Verified Reviews`,
    },
    instagram_feed: {
        tab: "mobile_social",
        tabLabel: "Instagram Atelier Showcase",
        getDescription: (s) => `@${s.instagramFeed?.handle || s.socialAndContact.instagram} · ${s.instagramFeed?.posts?.length || 0} Posts`,
    },
    brand_story: {
        tab: "story_faq",
        tabLabel: "Brand Story & Heirloom Craft",
        getDescription: (s) => `${s.brandStory?.craftDetails?.length || 0} Craft Highlights`,
    },
    faq_accordion: {
        tab: "story_faq",
        tabLabel: "Customer FAQ Accordion",
        getDescription: (s) => `${s.faq.items?.length || 0} Care & Shipping Questions`,
    },
};

const HERO_PHOTO_PRESETS = [
    {
        name: "Luxe Gold / Kundan",
        url: "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=2000&auto=format&fit=crop",
        mobileUrl: "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=900&auto=format&fit=crop",
    },
    {
        name: "Bridal Heritage",
        url: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=2000&auto=format&fit=crop",
        mobileUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=900&auto=format&fit=crop",
    },
    {
        name: "Temple 22k Antique",
        url: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?q=80&w=2000&auto=format&fit=crop",
        mobileUrl: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?q=80&w=900&auto=format&fit=crop",
    },
    {
        name: "Solitaire / Diamonds",
        url: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?q=80&w=2000&auto=format&fit=crop",
        mobileUrl: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?q=80&w=900&auto=format&fit=crop",
    },
];

const LINK_PRESETS = [
    { label: "All Catalog", target: "#catalog-section" },
    { label: "Chokers", target: "/?category=chokers#catalog-section" },
    { label: "Necklaces", target: "/?category=necklaces#catalog-section" },
    { label: "Earrings", target: "/?category=earrings#catalog-section" },
    { label: "Bangles", target: "/?category=bangles#catalog-section" },
    { label: "Haram", target: "/?category=haram#catalog-section" },
    { label: "Bridal Suites", target: "/?category=bridal#catalog-section" },
    { label: "Temple 22k", target: "/?category=temple-22k-finish#catalog-section" },
    { label: "Promo Offer", target: "#promo" },
    { label: "Reviews", target: "#reviews" },
    { label: "Brand Story", target: "#brand-story" },
    { label: "Care & FAQ", target: "#faq" },
    { label: "Contact / WhatsApp", target: "#contact" },
];

const DEFAULT_STATE: StorefrontContentState = {
    announcement: {
        enabled: true,
        primary: "PAN INDIA SHIPPING • DISPATCHED IN 24-48 HRS",
        secondary: "FREE EXPRESS SHIPPING ON ORDERS ABOVE ₹799",
        couponSnippet: "USE CODE: FESTIVE10 FOR 10% OFF",
        dispatchUrgencyText: "⚡ Orders dispatched daily via insured express couriers",
    },
    hero: {
        brandName: "The Atelier",
        tagline: "Fine Jewellery & Heirlooms",
        ctaText: "shop now",
        ctaLink: "#catalog-section",
        imageUrl: "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=2000&auto=format&fit=crop",
        overlayOpacity: 0.25,
        autoplaySpeed: 5000,
        slides: [
            {
                id: "slide-1",
                title: "handcrafted heirlooms.",
                tagline: "traditional jewelry & polki suites",
                ctaText: "shop now ↓",
                ctaLink: "#catalog-section",
                imageUrl: "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=2000&auto=format&fit=crop",
                mobileImageUrl: "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=900&auto=format&fit=crop",
                badgeText: "✨ SIGNATURE ATELIER",
                countdownTarget: "",
                ctaStyle: "underline",
                overlayOpacity: 0.25,
            },
            {
                id: "slide-2",
                title: "bridal collection.",
                tagline: "royal jadau & polki suites",
                ctaText: "explore bridal suites ↓",
                ctaLink: "#catalog-section",
                imageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=2000&auto=format&fit=crop",
                mobileImageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=900&auto=format&fit=crop",
                badgeText: "👑 BRIDAL 2026",
                countdownTarget: "",
                ctaStyle: "box",
                overlayOpacity: 0.3,
            },
            {
                id: "slide-3",
                title: "temple heritage.",
                tagline: "antique matte gold finish",
                ctaText: "view temple jewellery ↓",
                ctaLink: "#catalog-section",
                imageUrl: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?q=80&w=2000&auto=format&fit=crop",
                mobileImageUrl: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?q=80&w=900&auto=format&fit=crop",
                badgeText: "🪔 TEMPLE HEIRLOOM",
                countdownTarget: "",
                ctaStyle: "underline",
                overlayOpacity: 0.3,
            },
        ],
    },
    layoutSections: [
        { id: "hero_slideshow", name: "Hero Editorial Slideshow", enabled: true, order: 1 },
        { id: "trust_strip", name: "Trust & Insured Dispatch Bar", enabled: true, order: 2 },
        { id: "category_vitrines", name: "Product Vitrines & Catalog Grid", enabled: true, order: 3 },
        { id: "flash_promo", name: "Festive Promo & Coupon Banner", enabled: true, order: 4 },
        { id: "customer_reviews", name: "Verified Customer Reviews", enabled: true, order: 5 },
        { id: "instagram_feed", name: "Instagram Atelier Showcase", enabled: false, order: 6 },
        { id: "brand_story", name: "Brand Story & Heirloom Craft", enabled: true, order: 7 },
        { id: "faq_accordion", name: "Jewellery Care & Shipping FAQ", enabled: true, order: 8 },
    ],
    trustStrip: {
        enabled: true,
        items: [
            {
                icon: "truck",
                title: "Pan-India Shipping",
                subtitle: "Dispatched within 24-48 hrs with insured transit",
            },
            {
                icon: "shield",
                title: "Skin-Safe Hypoallergenic",
                subtitle: "Lead & nickel-free brass & red-copper alloys",
            },
            {
                icon: "sparkles",
                title: "22K Micron Gold Plating",
                subtitle: "Authentic temple matte & Jadau polish",
            },
            {
                icon: "rotate-ccw",
                title: "Direct WhatsApp Concierge",
                subtitle: "Instant video-call inspection before dispatch",
            },
        ],
    },
    merchandising: {
        autoLowStockThreshold: 3,
        pinnedProductSkus: [],
        customProductBadges: {},
    },
    reviews: {
        enabled: true,
        heading: "loved by our patrons.",
        subheading: "REAL EXPERIENCES FROM VERIFIED PATRONS ACROSS INDIA",
        items: [],
    },
    brandStory: {
        enabled: true,
        tagline: "THE ATELIER HERITAGE",
        heading: "preserving traditional jewellery craftsmanship.",
        bodyText: "Our atelier was born out of deep reverence for traditional jewellery artistry. Rather than mass-produced imitation alloys, each piece is handcrafted using traditional red-copper & brass cores, high-micron gold immersion, and hand-crimped stones — making royal bridal magnificence accessible without compromise.",
        craftDetails: [
            "22K High-Micron Gold Immersion",
            "Hand-Crimped Foil-Backed Polki",
            "Deep Relief Repoussé Detailing",
            "100% Skin-Friendly Hypoallergenic Cores",
        ],
        imageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=1200&auto=format&fit=crop",
    },
    faq: {
        enabled: true,
        items: [
            {
                question: "How long does shipping take to my city?",
                answer: "Orders are dispatched via express insured couriers within 24-48 hours and typically delivered within 2 to 4 business days with end-to-end SMS tracking.",
            },
            {
                question: "Is the jewellery water-resistant and skin-safe?",
                answer: "Yes. Every piece is crafted on hypoallergenic brass and copper alloys free of nickel and lead. With our multi-layer micro gold plating, it resists tarnishing when kept away from direct perfume and moisture.",
            },
            {
                question: "Can I request live video inspection before dispatch?",
                answer: "Yes. Contact our WhatsApp concierge with your order ID, and our studio team will share high-resolution videos under natural lighting prior to dispatch.",
            },
            {
                question: "How do I care for my jewelry?",
                answer: "After each wear, wipe gently with a soft dry cloth to remove body oils. Always store in individual ziplock pouches inside an airtight container. Never spray perfumes directly on the jewellery.",
            },
        ],
    },
    stickyMobileBar: {
        enabled: true,
        showWhatsApp: true,
        showCart: true,
        whatsappMessagePreset: "Hello! I am browsing your store and would like to inquire about custom orders ✨",
    },
    vitrines: [
        { id: "latest-drop", title: "Latest Drop", filter: "all" },
        { id: "temple-classics", title: "Temple Classics", filter: "Temple" },
        { id: "bridal-kundan", title: "Bridal Suites", filter: "Bridal" },
    ],
    promoBanner: {
        enabled: true,
        code: "FESTIVE10",
        discount: "10% OFF",
        description: "FLAT 10% OFF ON ORDERS OVER ₹1,999",
    },
    socialAndContact: {
        instagram: "",
        whatsappPhone: "",
        supportEmail: "",
    },
    instagramFeed: {
        enabled: false,
        handle: "",
        heading: "atelier community & reel drops",
        posts: [],
    },
    branding: {
        logoType: "wordmark",
        wordmark: {
            text: "The Atelier",
            fontFamily: "Plus Jakarta Sans",
            fontSize: 28,
            letterSpacing: "-0.04em",
            textTransform: "none",
        },
        imageLogo: {
            url: "",
            alt: "The Atelier",
            desktopHeight: 36,
            mobileHeight: 26,
        },
    },
    theme: {
        preset: "royal_gold",
        colors: {
            primary: "#0A0A0A",
            secondary: "#2A2A2A",
            accent: "#C5A059",
            background: "#FFFFFF",
            surface: "#FAF8F5",
            border: "#EAE6E1",
        },
        sectionOverrides: {
            heroBg: "#000000",
            heroText: "#FFFFFF",
            announcementBg: "#0A0A0A",
            announcementText: "#FFFFFF",
            trustStripBg: "#FAF8F5",
            trustStripText: "#1A1A1A",
            vitrinesBg: "#FFFFFF",
            reviewsBg: "#FAF8F5",
            storyBg: "#FFFFFF",
            faqBg: "#FFFFFF",
        },
        typography: {
            headingFont: "Playfair Display",
            bodyFont: "Plus Jakarta Sans",
            accentFont: "Cormorant Garamond",
            fontEffect: "none",
        },
    },
    adminBinding: {
        boundAdminEmail: "",
        customDomain: "",
        storefrontStatus: "active",
        sslConfigured: false,
        storefrontName: "Boutique Storefront",
        boundAt: "2026-10-19T00:00:00.000Z",
    },
};

export default function StorefrontControlPage() {
    const { user } = useAuth();
    const [mounted, setMounted] = useState(false);
    const [content, setContent] = useState<StorefrontContentState>(DEFAULT_STATE);
    const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<CmsTab>("layout");

    useEffect(() => {
        setMounted(true);
        fetchContent();
    }, []);

    useEffect(() => {
        const hFont = content.theme?.typography?.headingFont || "Playfair Display";
        const bFont = content.theme?.typography?.bodyFont || "Plus Jakarta Sans";
        const aFont = content.theme?.typography?.accentFont || "Cormorant Garamond";
        const logoFont = content.branding?.wordmark?.fontFamily || "Plus Jakarta Sans";
        const fontEffect = content.theme?.typography?.fontEffect || "";

        const unique = Array.from(new Set([hFont, bFont, aFont, logoFont].filter(Boolean)));
        
        // Official Google Fonts API format: spaces replaced by '+', multiple families joined by '|'
        const q = unique
            .map((f) => {
                const clean = f.trim().replace(/\s+/g, "+");
                return `${clean}:400,600,700`;
            })
            .join("|");

        let url = `https://fonts.googleapis.com/css?family=${q}&display=swap`;
        if (fontEffect && fontEffect !== "none") {
            url += `&effect=${encodeURIComponent(fontEffect)}`;
        }

        let link = document.getElementById("cms-google-fonts-preview") as HTMLLinkElement | null;
        if (!link) {
            link = document.createElement("link");
            link.id = "cms-google-fonts-preview";
            link.rel = "stylesheet";
            document.head.appendChild(link);
        }
        link.href = url;
    }, [
        content.theme?.typography?.headingFont,
        content.theme?.typography?.bodyFont,
        content.theme?.typography?.accentFont,
        content.theme?.typography?.fontEffect,
        content.branding?.wordmark?.fontFamily,
    ]);

    const fetchContent = async () => {
        try {
            const res = await fetch("/api/storefront/content", {
                headers: {
                    ...(pb.authStore.token ? { "Authorization": `Bearer ${pb.authStore.token}` } : {})
                }
            });
            if (res.ok) {
                const data = await res.json();
                const rawHero = data.hero || {};
                const slides = Array.isArray(rawHero.slides) && rawHero.slides.length > 0
                    ? rawHero.slides
                    : DEFAULT_STATE.hero.slides;

                setContent({
                    ...DEFAULT_STATE,
                    ...data,
                    announcement: { ...DEFAULT_STATE.announcement, ...(data.announcement || {}) },
                    hero: {
                        ...DEFAULT_STATE.hero,
                        ...rawHero,
                        slides,
                    },
                    layoutSections: Array.isArray(data.layoutSections) && data.layoutSections.length > 0
                        ? data.layoutSections
                        : DEFAULT_STATE.layoutSections,
                    trustStrip: { ...DEFAULT_STATE.trustStrip, ...(data.trustStrip || {}) },
                    merchandising: { ...DEFAULT_STATE.merchandising, ...(data.merchandising || {}) },
                    reviews: { ...DEFAULT_STATE.reviews, ...(data.reviews || {}) },
                    brandStory: { ...DEFAULT_STATE.brandStory, ...(data.brandStory || {}) },
                    faq: { ...DEFAULT_STATE.faq, ...(data.faq || {}) },
                    stickyMobileBar: { ...DEFAULT_STATE.stickyMobileBar, ...(data.stickyMobileBar || {}) },
                    promoBanner: { ...DEFAULT_STATE.promoBanner, ...(data.promoBanner || {}) },
                    socialAndContact: { ...DEFAULT_STATE.socialAndContact, ...(data.socialAndContact || {}) },
                    instagramFeed: { ...DEFAULT_STATE.instagramFeed, ...(data.instagramFeed || {}) },
                    branding: { ...DEFAULT_STATE.branding, ...(data.branding || {}) },
                    theme: { ...DEFAULT_STATE.theme, ...(data.theme || {}) },
                    vitrines: Array.isArray(data.vitrines) && data.vitrines.length > 0 ? data.vitrines : DEFAULT_STATE.vitrines,
                    adminBinding: { ...DEFAULT_STATE.adminBinding, ...(data.adminBinding || {}) },
                });
            }
        } catch (err) {
            console.error("Failed to load storefront content:", err);
            toast.error("Could not load current content, using defaults");
        } finally {
            setIsLoading(false);
        }
    };

    // Live preview Google Font dynamic stylesheet loader
    useEffect(() => {
        const heading = content.theme?.typography?.headingFont || "Playfair Display";
        const body = content.theme?.typography?.bodyFont || "Plus Jakarta Sans";
        const accent = content.theme?.typography?.accentFont || "Cormorant Garamond";
        const logoFont = content.branding?.wordmark?.fontFamily || "Plus Jakarta Sans";
        const fontEffect = content.theme?.typography?.fontEffect || "";

        const uniqueFonts = Array.from(new Set([heading, body, accent, logoFont].filter(Boolean) as string[]));
        const fontParams = uniqueFonts.map((f) => f.trim().replace(/\s+/g, "+") + ":400,600,700").join("|");

        let fontUrl = `https://fonts.googleapis.com/css?family=${fontParams}&display=swap`;
        if (fontEffect && fontEffect !== "none") {
            fontUrl += `&effect=${encodeURIComponent(fontEffect)}`;
        }

        let link = document.getElementById("admin-google-fonts-preview") as HTMLLinkElement | null;
        if (!link) {
            link = document.createElement("link");
            link.id = "admin-google-fonts-preview";
            link.rel = "stylesheet";
            document.head.appendChild(link);
        }
        link.href = fontUrl;
    }, [
        content.theme?.typography?.headingFont,
        content.theme?.typography?.bodyFont,
        content.theme?.typography?.accentFont,
        content.theme?.typography?.fontEffect,
        content.branding?.wordmark?.fontFamily,
    ]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const toSave = {
                ...content,
                adminBinding: {
                    ...DEFAULT_STATE.adminBinding,
                    ...(content.adminBinding || {}),
                    boundAdminEmail: user?.email || content.adminBinding?.boundAdminEmail || "admin@luminila.com",
                },
            };
            const res = await fetch("/api/storefront/content", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(pb.authStore.token ? { "Authorization": `Bearer ${pb.authStore.token}` } : {})
                },
                body: JSON.stringify(toSave),
            });
            if (res.ok) {
                toast.success("Storefront content & domain binding updated successfully!");
            } else {
                throw new Error("Failed to save");
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to update storefront content");
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setContent(DEFAULT_STATE);
        toast.info("Reset to Escape-Closet minimalist presets. Click 'Save Changes' to apply.");
    };

    // Hero Slides Handlers
    const handleAddSlide = () => {
        const newSlide: HeroSlide = {
            id: `slide-${Date.now()}`,
            title: "new collection.",
            tagline: "handcrafted artisan jewellery",
            ctaText: "explore collection ↓",
            ctaLink: "/?category=all#catalog-section",
            imageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=2000&auto=format&fit=crop",
            mobileImageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=900&auto=format&fit=crop",
            badgeText: "✨ NEW DROP",
            countdownTarget: "",
            ctaStyle: "underline",
            overlayOpacity: 0.25,
        };
        const updatedSlides = [...(content.hero.slides || []), newSlide];
        setContent({
            ...content,
            hero: { ...content.hero, slides: updatedSlides },
        });
        setSelectedSlideIndex(updatedSlides.length - 1);
        toast.success("New slide added");
    };

    const handleDeleteSlide = (index: number) => {
        const currentSlides = content.hero.slides || [];
        if (currentSlides.length <= 1) {
            toast.error("You must have at least one hero slide.");
            return;
        }
        const updatedSlides = currentSlides.filter((_, idx) => idx !== index);
        setContent({
            ...content,
            hero: { ...content.hero, slides: updatedSlides },
        });
        if (selectedSlideIndex >= updatedSlides.length) {
            setSelectedSlideIndex(Math.max(0, updatedSlides.length - 1));
        }
        toast.info("Slide removed");
    };

    const handleUpdateActiveSlide = (fields: Partial<HeroSlide>) => {
        const currentSlides = [...(content.hero.slides || [])];
        if (!currentSlides[selectedSlideIndex]) return;
        currentSlides[selectedSlideIndex] = {
            ...currentSlides[selectedSlideIndex],
            ...fields,
        };
        setContent({
            ...content,
            hero: { ...content.hero, slides: currentSlides },
        });
    };

    const handleMoveSlide = (index: number, direction: "up" | "down") => {
        const currentSlides = [...(content.hero.slides || [])];
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= currentSlides.length) return;
        const temp = currentSlides[index];
        currentSlides[index] = currentSlides[targetIndex];
        currentSlides[targetIndex] = temp;
        setContent({
            ...content,
            hero: { ...content.hero, slides: currentSlides },
        });
        setSelectedSlideIndex(targetIndex);
    };

    // Section Order Handlers
    const handleMoveSection = (index: number, direction: "up" | "down") => {
        const sections = [...content.layoutSections];
        const targetIdx = direction === "up" ? index - 1 : index + 1;
        if (targetIdx < 0 || targetIdx >= sections.length) return;
        const temp = sections[index];
        sections[index] = sections[targetIdx];
        sections[targetIdx] = temp;
        const reordered = sections.map((sec, i) => ({ ...sec, order: i + 1 }));
        setContent({ ...content, layoutSections: reordered });
    };

    const handleToggleSection = (index: number) => {
        const sections = [...content.layoutSections];
        sections[index] = { ...sections[index], enabled: !sections[index].enabled };
        setContent({ ...content, layoutSections: sections });
    };

    const handleUpdateSectionName = (index: number, name: string) => {
        const sections = [...content.layoutSections];
        sections[index] = { ...sections[index], name };
        setContent({ ...content, layoutSections: sections });
    };

    // Review Handlers
    const handleAddReview = () => {
        const newRev: ReviewItem = {
            id: `rev-${Date.now()}`,
            customerName: "New Patron",
            city: "Chennai",
            rating: 5,
            reviewText: "Exceptional handcrafted quality and fast dispatch.",
            itemPurchased: "The Padmavati Polki Choker Suite",
            verifiedBuyer: true,
        };
        setContent({
            ...content,
            reviews: { ...content.reviews, items: [newRev, ...content.reviews.items] },
        });
        toast.success("New review added");
    };

    const handleDeleteReview = (index: number) => {
        const items = content.reviews.items.filter((_, idx) => idx !== index);
        setContent({
            ...content,
            reviews: { ...content.reviews, items },
        });
    };

    const handleUpdateReview = (index: number, fields: Partial<ReviewItem>) => {
        const items = [...content.reviews.items];
        items[index] = { ...items[index], ...fields };
        setContent({
            ...content,
            reviews: { ...content.reviews, items },
        });
    };

    // FAQ Handlers
    const handleAddFaq = () => {
        const newFaq: FaqItem = {
            question: "New FAQ Question?",
            answer: "Provide clear helpful guidance for customers here.",
        };
        setContent({
            ...content,
            faq: { ...content.faq, items: [...content.faq.items, newFaq] },
        });
    };

    const handleDeleteFaq = (index: number) => {
        const items = content.faq.items.filter((_, idx) => idx !== index);
        setContent({ ...content, faq: { ...content.faq, items } });
    };

    const handleUpdateFaq = (index: number, fields: Partial<FaqItem>) => {
        const items = [...content.faq.items];
        items[index] = { ...items[index], ...fields };
        setContent({ ...content, faq: { ...content.faq, items } });
    };

    if (!mounted) {
        return (
            <div className="flex-1 h-full overflow-y-auto p-4 sm:p-6 max-w-7xl mx-auto space-y-6" suppressHydrationWarning>
                <div className="flex items-center justify-between p-5 bg-card border rounded-lg animate-pulse">
                    <div className="space-y-2">
                        <div className="h-7 w-64 bg-muted rounded"></div>
                        <div className="h-4 w-96 bg-muted/60 rounded"></div>
                    </div>
                    <div className="h-9 w-32 bg-muted rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 h-full overflow-y-auto" suppressHydrationWarning>
            <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 pb-28">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border rounded-lg p-5 shadow-xs">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Globe className="w-6 h-6 text-primary" />
                        <h1 className="text-2xl font-bold tracking-tight">Storefront Studio & CMS Engine</h1>
                        <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                            Live on :3001
                        </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">
                        Total control over homepage sections, hero slides, visual merchandising, and social commerce.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
                        <RotateCcw className="w-4 h-4" />
                        Reset Defaults
                    </Button>
                    <a href="http://localhost:3001" target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="gap-1.5">
                            <ExternalLink className="w-4 h-4" />
                            View Storefront
                        </Button>
                    </a>
                    <Button onClick={handleSave} disabled={isSaving} size="sm" className="gap-1.5 bg-primary">
                        <Save className="w-4 h-4" />
                        {isSaving ? "Saving..." : "Save Changes"}
                    </Button>
                </div>
            </div>

            {/* Quick Live Preview Bar */}
            <Card className="bg-muted/40 border-dashed">
                <CardHeader className="py-3 px-5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                        <span className="flex items-center gap-1.5">
                            <Eye className="w-3.5 h-3.5" />
                            Live Storefront Appearance Preview
                        </span>
                        <span>Atelier Theme</span>
                    </div>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                    <div className="rounded-md border bg-black text-white overflow-hidden shadow-md">
                        {/* Mock Ticker */}
                        {content.announcement.enabled && (
                            <div className="bg-white text-black text-[10px] tracking-widest uppercase font-medium py-1 px-4 text-center">
                                {content.announcement.primary}
                            </div>
                        )}
                        {/* Mock Hero Slideshow Box */}
                        {(() => {
                            const activeSlide = (content.hero.slides && content.hero.slides[selectedSlideIndex]) || content.hero.slides?.[0] || {
                                title: content.hero.brandName || "The Atelier",
                                tagline: content.hero.tagline || "craftisans",
                                ctaText: content.hero.ctaText || "shop now ↓",
                                ctaLink: content.hero.ctaLink || "#catalog-section",
                                imageUrl: content.hero.imageUrl || "",
                                overlayOpacity: content.hero.overlayOpacity ?? 0.25,
                            };
                            const totalSlides = content.hero.slides?.length || 1;
                            return (
                                <div
                                    className="relative h-48 flex flex-col justify-end bg-cover bg-center p-6 text-left"
                                    style={{
                                        backgroundImage: `url(${activeSlide.imageUrl})`,
                                    }}
                                >
                                    <div
                                        className="absolute inset-0 bg-black"
                                        style={{ opacity: activeSlide.overlayOpacity }}
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                                    {/* Slide Counter & Dots */}
                                    <div className="absolute top-4 right-5 z-10 flex items-center gap-3 text-white/70 text-xs font-mono">
                                        <span>
                                            {String(selectedSlideIndex + 1).padStart(2, "0")} / {String(totalSlides).padStart(2, "0")}
                                        </span>
                                        <div className="flex gap-1">
                                            {Array.from({ length: totalSlides }).map((_, i) => (
                                                <button
                                                    key={i}
                                                    type="button"
                                                    onClick={() => setSelectedSlideIndex(i)}
                                                    className={`h-1 rounded-full transition-all ${
                                                        i === selectedSlideIndex ? "w-6 bg-white" : "w-2 bg-white/40"
                                                    }`}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="relative z-10 max-w-lg space-y-1">
                                        {activeSlide.badgeText && (
                                            <span className="inline-block text-[10px] font-mono tracking-widest px-2 py-0.5 rounded bg-white/20 backdrop-blur-md text-white mb-1">
                                                {activeSlide.badgeText}
                                            </span>
                                        )}
                                        <h2 className="text-3xl font-extrabold tracking-tighter lowercase text-white">
                                            {activeSlide.title}
                                        </h2>
                                        {activeSlide.tagline && (
                                            <p className="text-xs uppercase tracking-widest text-white/80 font-medium">
                                                {activeSlide.tagline}
                                            </p>
                                        )}
                                        <div className="pt-2 flex items-center gap-3">
                                            <span className="text-[11px] uppercase tracking-widest text-white underline decoration-1 underline-offset-4 font-semibold">
                                                {activeSlide.ctaText}
                                            </span>
                                            <span className="text-[10px] text-white/60 font-mono">
                                                → {activeSlide.ctaLink}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </CardContent>
            </Card>

            {/* Main Tabs Navigation: Themed Dropdown on Mobile, Tab Strip on Desktop */}
            <div className="block sm:hidden w-full mb-2">
                {(() => {
                    const cmsTabs = [
                        { id: "domain_binding", label: "Domain & Admin Binding", icon: Globe },
                        { id: "layout", label: "Section Builder", icon: Layers },
                        { id: "branding_theme", label: "Branding & Theming", icon: Palette },
                        { id: "hero", label: "Hero Slideshow", icon: ImageIcon },
                        { id: "ticker", label: "Announcement & Urgency", icon: Megaphone },
                        { id: "trust", label: "Trust Guarantee Strip", icon: ShieldCheck },
                        { id: "vitrines", label: "Vitrines & Catalog", icon: Sliders },
                        { id: "merchandising", label: "Badges & Spotlights", icon: Pin },
                        { id: "reviews", label: "Customer Reviews", icon: Star },
                        { id: "story_faq", label: "Story & FAQ", icon: BookOpen },
                        { id: "promo", label: "Coupons & Banners", icon: Tag },
                        { id: "mobile_social", label: "Mobile Bar & Socials", icon: Smartphone },
                    ];
                    const curTab = cmsTabs.find((t) => t.id === activeTab) || cmsTabs[0];
                    const CurIcon = curTab.icon;
                    return (
                        <Select value={activeTab} onValueChange={(v) => v && setActiveTab(v as CmsTab)}>
                            <SelectTrigger className="w-full h-11 bg-card border-border text-xs font-semibold px-3 rounded-xl flex items-center justify-between shadow-xs">
                                <div className="flex items-center gap-2.5">
                                    <CurIcon className="w-4 h-4 text-primary" />
                                    <span className="font-semibold text-xs text-foreground">{curTab.label}</span>
                                </div>
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border">
                                {cmsTabs.map((tab) => {
                                    const Icon = tab.icon;
                                    return (
                                        <SelectItem key={tab.id} value={tab.id} className="text-xs font-medium py-2.5">
                                            <div className="flex items-center gap-2.5">
                                                <Icon className="w-3.5 h-3.5 text-primary" />
                                                <span>{tab.label}</span>
                                            </div>
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                    );
                })()}
            </div>

            <div className="hidden sm:flex items-center border-b gap-1 text-sm overflow-x-auto pb-1.5 scrollbar-thin shrink-0">
                {[
                    { id: "domain_binding", label: "Domain & Admin Binding", icon: Globe },
                    { id: "layout", label: "Section Builder", icon: Layers },
                    { id: "branding_theme", label: "Branding & Theming", icon: Palette },
                    { id: "hero", label: "Hero Slideshow", icon: ImageIcon },
                    { id: "ticker", label: "Announcement & Urgency", icon: Megaphone },
                    { id: "trust", label: "Trust Guarantee Strip", icon: ShieldCheck },
                    { id: "vitrines", label: "Vitrines & Catalog", icon: Sliders },
                    { id: "merchandising", label: "Badges & Spotlights", icon: Pin },
                    { id: "reviews", label: "Customer Reviews", icon: Star },
                    { id: "story_faq", label: "Story & FAQ", icon: BookOpen },
                    { id: "promo", label: "Coupons & Banners", icon: Tag },
                    { id: "mobile_social", label: "Mobile Bar & Socials", icon: Smartphone },
                ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as CmsTab)}
                            className={`pb-2.5 px-3 font-medium transition flex items-center gap-1.5 border-b-2 text-xs md:text-sm whitespace-nowrap ${
                                activeTab === tab.id
                                    ? "border-primary text-primary font-semibold"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* TAB: Domain & Admin Account Binding */}
            {activeTab === "domain_binding" && (
                <div className="space-y-6">
                    {/* Admin Binding Card */}
                    <Card className="border-primary/20 shadow-xs">
                        <CardHeader className="pb-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                                    Single Admin Account Binding
                                </CardTitle>
                                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-300 w-fit">
                                    <UserCheck className="w-3.5 h-3.5 mr-1" />
                                    Bound & Enforced
                                </Badge>
                            </div>
                            <CardDescription>
                                Each storefront and domain integration is strictly mapped to one admin account. All online catalog orders, customer records, and inventory movements are tagged with this administrator's ID for data isolation.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-1">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2 p-4 rounded-lg bg-muted/30 border">
                                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                                        <UserCheck className="w-3.5 h-3.5 text-primary" />
                                        Bound Admin Account
                                    </Label>
                                    <div className="text-sm font-bold font-mono text-foreground flex items-center gap-2">
                                        <span>{content.adminBinding?.boundAdminEmail || user?.email || "admin@luminila.com"}</span>
                                        {user?.email && (
                                            <Badge variant="secondary" className="text-[10px] uppercase">
                                                Active Session
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Account identity used for database security rules and omnichannel order routing.
                                    </p>
                                </div>

                                <div className="space-y-2 p-4 rounded-lg bg-muted/30 border">
                                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                                        <Server className="w-3.5 h-3.5 text-primary" />
                                        Storefront Architecture
                                    </Label>
                                    <div className="text-sm font-semibold text-foreground">
                                        Dedicated Single-Storefront Instance (v1)
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Multi-storefront routing & multi-tenant domain mapping will be enabled in v2.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Custom Domain & Status Card */}
                    <Card className="shadow-xs">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Globe className="w-5 h-5 text-primary" />
                                Custom Domain Integration
                            </CardTitle>
                            <CardDescription>
                                Configure the public domain where this storefront is deployed and control its operational status.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Custom Domain / Hostname</Label>
                                    <Input
                                        value={content.adminBinding?.customDomain || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                adminBinding: {
                                                    boundAdminEmail: content.adminBinding?.boundAdminEmail || DEFAULT_STATE.adminBinding?.boundAdminEmail || "admin@luminila.com",
                                                    customDomain: e.target.value,
                                                    storefrontStatus: content.adminBinding?.storefrontStatus || "active",
                                                    sslConfigured: content.adminBinding?.sslConfigured ?? false,
                                                    storefrontName: content.adminBinding?.storefrontName || "Primary Boutique Storefront",
                                                    boundAt: content.adminBinding?.boundAt,
                                                },
                                            })
                                        }
                                        placeholder="shop.yourbrand.com or localhost:3001"
                                        className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Domain where customers access this storefront. Used in order tracking links and reverse proxy headers.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Storefront Status</Label>
                                    <select
                                        value={content.adminBinding?.storefrontStatus || "active"}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                adminBinding: {
                                                    boundAdminEmail: content.adminBinding?.boundAdminEmail || DEFAULT_STATE.adminBinding?.boundAdminEmail || "admin@luminila.com",
                                                    customDomain: content.adminBinding?.customDomain || "localhost:3001",
                                                    storefrontStatus: e.target.value as "active" | "maintenance" | "disabled",
                                                    sslConfigured: content.adminBinding?.sslConfigured ?? false,
                                                    storefrontName: content.adminBinding?.storefrontName || "Primary Boutique Storefront",
                                                    boundAt: content.adminBinding?.boundAt,
                                                },
                                            })
                                        }
                                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                    >
                                        <option value="active">Active (Serving Live Customers)</option>
                                        <option value="maintenance">Maintenance Mode (Storefront Paused)</option>
                                        <option value="disabled">Disabled</option>
                                    </select>
                                    <p className="text-xs text-muted-foreground">
                                        Switch to Maintenance Mode when performing physical stock audits or catalog overhauls.
                                    </p>
                                </div>
                            </div>

                            <Separator />

                            {/* Reverse Proxy & Nginx Snippet Helper */}
                            <div className="space-y-3">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                    <Server className="w-3.5 h-3.5" />
                                    Unified Reverse Proxy Setup
                                </Label>
                                <div className="p-3 bg-muted/50 rounded-lg text-xs font-mono border overflow-x-auto text-slate-800 dark:text-slate-200">
                                    <code>
                                        # Nginx upstream mapping for {content.adminBinding?.customDomain || "shop.yourbrand.com"}{"\n"}
                                        location / &#123; proxy_pass http://127.0.0.1:3001; &#125;{"\n"}
                                        location /api/storefront/ &#123; proxy_pass http://127.0.0.1:3000/api/storefront/; &#125;{"\n"}
                                        location /api/pb/ &#123; proxy_pass http://127.0.0.1:8091/; &#125;
                                    </code>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Routing Storefront, ERP APIs, and PocketBase through one domain prevents CORS errors and simplifies SSL management.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* TAB: Section Order & Layout Builder */}
            {activeTab === "layout" && (
                <div className="space-y-4">
                    <Card>
                        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4">
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Layers className="w-5 h-5 text-primary" />
                                    Homepage Section Builder & Sequence
                                </CardTitle>
                                <CardDescription>
                                    Rearrange homepage visual hierarchy, customize section titles, toggle visibility, and click Configure to edit each section's content.
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs font-mono bg-muted/40">
                                    {content.layoutSections.filter((s) => s.enabled).length} of {content.layoutSections.length} Sections Active
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {content.layoutSections.map((sec, idx) => {
                                const meta = SECTION_CONFIG_MAP[sec.id];
                                return (
                                    <div
                                        key={sec.id}
                                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border transition-all ${
                                            sec.enabled
                                                ? "bg-card shadow-xs hover:border-primary/40"
                                                : "bg-muted/30 opacity-60 border-dashed"
                                        }`}
                                    >
                                        {/* Left: Sequence badge & Inline Editable Title */}
                                        <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                                            <Badge
                                                variant="outline"
                                                className={`font-mono text-xs w-7 h-7 flex items-center justify-center shrink-0 p-0 ${
                                                    sec.enabled ? "bg-primary text-primary-foreground font-bold" : ""
                                                }`}
                                            >
                                                #{sec.order}
                                            </Badge>
                                            <div className="space-y-1.5 flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        value={sec.name}
                                                        onChange={(e) => handleUpdateSectionName(idx, e.target.value)}
                                                        className="h-8 text-xs sm:text-sm font-semibold max-w-[340px] bg-background"
                                                        placeholder="Section Name"
                                                    />
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                    <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                                        id: {sec.id}
                                                    </span>
                                                    {meta && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-neutral-600 dark:text-neutral-300 font-medium">
                                                                {meta.getDescription(content)}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right: Quick Configure Button, Up/Down Reorder, and Visibility Switch */}
                                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0">
                                            {meta && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => {
                                                        setActiveTab(meta.tab);
                                                        toast.info(`Opened ${meta.tabLabel} editor`);
                                                    }}
                                                    className="h-8 text-xs gap-1.5 font-medium cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                                                >
                                                    <Sliders className="w-3.5 h-3.5" />
                                                    Configure
                                                    <ArrowRight className="w-3 h-3" />
                                                </Button>
                                            )}

                                            <div className="flex items-center gap-1 bg-muted/30 p-0.5 rounded border">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={idx === 0}
                                                    onClick={() => handleMoveSection(idx, "up")}
                                                    className="h-7 w-7 p-0 cursor-pointer disabled:opacity-30"
                                                    title="Move Up"
                                                >
                                                    <ArrowUp className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={idx === content.layoutSections.length - 1}
                                                    onClick={() => handleMoveSection(idx, "down")}
                                                    className="h-7 w-7 p-0 cursor-pointer disabled:opacity-30"
                                                    title="Move Down"
                                                >
                                                    <ArrowDown className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>

                                            <div className="flex items-center gap-2 border-l pl-3">
                                                <Label htmlFor={`sec-toggle-${sec.id}`} className="text-xs cursor-pointer select-none">
                                                    {sec.enabled ? "Active" : "Hidden"}
                                                </Label>
                                                <Switch
                                                    id={`sec-toggle-${sec.id}`}
                                                    checked={sec.enabled}
                                                    onCheckedChange={() => handleToggleSection(idx)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* TAB: Hero Slideshow Studio */}
            {activeTab === "hero" && (
                <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <CardTitle className="text-lg">Hero Slideshow Studio & Custom Links</CardTitle>
                                <Badge variant="secondary" className="text-xs">
                                    {(content.hero.slides || []).length} Slides Active
                                </Badge>
                            </div>
                            <CardDescription>
                                Fullscreen editorial slideshow banners with desktop & mobile photography, pill badges, and direct links.
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-3 bg-muted/50 px-3 py-2 rounded-lg border">
                            <Label htmlFor="autoplaySpeed" className="text-xs whitespace-nowrap font-medium">
                                Autoplay Rotation:
                            </Label>
                            <select
                                id="autoplaySpeed"
                                value={content.hero.autoplaySpeed ?? 5000}
                                onChange={(e) =>
                                    setContent({
                                        ...content,
                                        hero: { ...content.hero, autoplaySpeed: parseInt(e.target.value, 10) },
                                    })
                                }
                                className="text-xs h-8 rounded-md border border-input bg-background px-2 font-medium"
                            >
                                <option value={3000}>3 seconds (Fast)</option>
                                <option value={5000}>5 seconds (Standard)</option>
                                <option value={7000}>7 seconds (Relaxed)</option>
                                <option value={10000}>10 seconds (Slow)</option>
                                <option value={0}>Paused (Manual navigation)</option>
                            </select>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-6">
                        {/* Slide Switcher Navigation Pills */}
                        <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/30 border rounded-lg">
                            {(content.hero.slides || []).map((slide, idx) => (
                                <div
                                    key={slide.id || idx}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                        idx === selectedSlideIndex
                                            ? "bg-primary text-primary-foreground shadow-xs"
                                            : "bg-background border text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setSelectedSlideIndex(idx)}
                                        className="flex items-center gap-1.5"
                                    >
                                        <span className="font-mono opacity-70">#{idx + 1}</span>
                                        <span className="max-w-[120px] truncate">{slide.title || "Untitled Slide"}</span>
                                    </button>

                                    <div className="flex items-center ml-2 border-l pl-1.5 gap-0.5 opacity-80 hover:opacity-100">
                                        <button
                                            type="button"
                                            disabled={idx === 0}
                                            onClick={() => handleMoveSlide(idx, "up")}
                                            className="p-0.5 hover:bg-black/10 rounded disabled:opacity-30"
                                        >
                                            <ChevronLeft className="w-3 h-3" />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={idx === (content.hero.slides || []).length - 1}
                                            onClick={() => handleMoveSlide(idx, "down")}
                                            className="p-0.5 hover:bg-black/10 rounded disabled:opacity-30"
                                        >
                                            <ChevronRight className="w-3 h-3" />
                                        </button>
                                        {(content.hero.slides || []).length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteSlide(idx)}
                                                className="p-0.5 text-red-500 hover:bg-red-500/10 rounded ml-1"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}

                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleAddSlide}
                                className="h-8 gap-1.5 border-dashed"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add Slide
                            </Button>
                        </div>

                        {/* Active Slide Form */}
                        {(() => {
                            const slide = (content.hero.slides && content.hero.slides[selectedSlideIndex]) || content.hero.slides?.[0];
                            if (!slide) return null;

                            return (
                                <div className="space-y-5 border rounded-lg p-5 bg-card">
                                    <div className="flex items-center justify-between border-b pb-3">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="font-mono text-xs">
                                                Editing Slide #{selectedSlideIndex + 1}
                                            </Badge>
                                            <span className="text-sm font-semibold tracking-tight">{slide.title}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground font-mono">
                                            ID: {slide.id}
                                        </span>
                                    </div>

                                    {/* Badge & Title */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="slideBadge" className="text-xs font-semibold">
                                                Top Pill Badge (Optional)
                                            </Label>
                                            <Input
                                                id="slideBadge"
                                                value={slide.badgeText || ""}
                                                onChange={(e) => handleUpdateActiveSlide({ badgeText: e.target.value })}
                                                placeholder="e.g. ✨ FESTIVE DROP"
                                            />
                                        </div>

                                        <div className="space-y-2 md:col-span-2">
                                            <Label htmlFor="slideTitle" className="text-xs font-semibold">
                                                Slide Wordmark Title
                                            </Label>
                                            <Input
                                                id="slideTitle"
                                                value={slide.title}
                                                onChange={(e) => handleUpdateActiveSlide({ title: e.target.value })}
                                                placeholder="e.g. The Atelier or bridal kundan."
                                            />
                                        </div>
                                    </div>

                                    {/* Tagline & Countdown Target */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="slideTagline" className="text-xs font-semibold">
                                                Slide Subtitle / Tagline
                                            </Label>
                                            <Input
                                                id="slideTagline"
                                                value={slide.tagline}
                                                onChange={(e) => handleUpdateActiveSlide({ tagline: e.target.value })}
                                                placeholder="e.g. craftisans or royal jadau & polki suites"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="slideCountdown" className="text-xs font-semibold">
                                                Countdown Target Time (Optional ISO or Date)
                                            </Label>
                                            <Input
                                                id="slideCountdown"
                                                value={slide.countdownTarget || ""}
                                                onChange={(e) => handleUpdateActiveSlide({ countdownTarget: e.target.value })}
                                                placeholder="e.g. 2026-10-31T23:59:59 (leave blank if none)"
                                            />
                                        </div>
                                    </div>

                                    {/* Action Link & Target */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="slideCtaText" className="text-xs font-semibold">
                                                CTA Action Text
                                            </Label>
                                            <Input
                                                id="slideCtaText"
                                                value={slide.ctaText}
                                                onChange={(e) => handleUpdateActiveSlide({ ctaText: e.target.value })}
                                                placeholder="e.g. shop now ↓"
                                            />
                                        </div>

                                        <div className="space-y-2 md:col-span-2">
                                            <div className="flex items-center justify-between">
                                                <Label htmlFor="slideCtaLink" className="text-xs font-semibold">
                                                    Custom Link Destination URL or Anchor
                                                </Label>
                                                <span className="text-[10px] text-muted-foreground font-mono">
                                                    Supports relative categories & internal sections
                                                </span>
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="relative flex-1">
                                                    <LinkIcon className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
                                                    <Input
                                                        id="slideCtaLink"
                                                        value={slide.ctaLink}
                                                        onChange={(e) => handleUpdateActiveSlide({ ctaLink: e.target.value })}
                                                        className="pl-8 font-mono text-xs"
                                                        placeholder="/?category=chokers#catalog-section"
                                                    />
                                                </div>
                                            </div>

                                            {/* Quick Link Target Badges */}
                                            <div className="pt-2">
                                                <span className="text-[11px] font-medium text-muted-foreground block mb-1.5">
                                                    Quick Category / Section Presets:
                                                </span>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {LINK_PRESETS.map((preset) => (
                                                        <button
                                                            key={preset.target}
                                                            type="button"
                                                            onClick={() => handleUpdateActiveSlide({ ctaLink: preset.target })}
                                                            className={`px-2 py-0.5 rounded text-[11px] font-mono transition border ${
                                                                slide.ctaLink === preset.target
                                                                    ? "bg-primary text-primary-foreground border-primary"
                                                                    : "bg-muted/40 hover:bg-muted text-foreground border-border"
                                                            }`}
                                                        >
                                                            {preset.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Desktop & Mobile Images */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="slideImageUrl" className="text-xs font-semibold">
                                                Desktop Background Image URL (Landscape)
                                            </Label>
                                            <Input
                                                id="slideImageUrl"
                                                value={slide.imageUrl}
                                                onChange={(e) => handleUpdateActiveSlide({ imageUrl: e.target.value })}
                                                placeholder="https://images.unsplash.com/..."
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="slideMobileImageUrl" className="text-xs font-semibold">
                                                Mobile Background Image URL (Portrait 9:16)
                                            </Label>
                                            <Input
                                                id="slideMobileImageUrl"
                                                value={slide.mobileImageUrl || ""}
                                                onChange={(e) => handleUpdateActiveSlide({ mobileImageUrl: e.target.value })}
                                                placeholder="https://images.unsplash.com/..."
                                            />
                                        </div>
                                    </div>

                                    {/* Curated Editorial Photo Presets */}
                                    <div>
                                        <span className="text-[11px] font-medium text-muted-foreground block mb-2">
                                            Curated Luxury Jewelry Photography Presets:
                                        </span>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            {HERO_PHOTO_PRESETS.map((preset) => (
                                                <button
                                                    key={preset.name}
                                                    type="button"
                                                    onClick={() =>
                                                        handleUpdateActiveSlide({
                                                            imageUrl: preset.url,
                                                            mobileImageUrl: preset.mobileUrl,
                                                        })
                                                    }
                                                    className={`group relative h-16 rounded-md overflow-hidden border text-left transition-all ${
                                                        slide.imageUrl === preset.url
                                                            ? "ring-2 ring-primary border-primary"
                                                            : "border-border hover:opacity-90"
                                                    }`}
                                                >
                                                    <div
                                                        className="absolute inset-0 bg-cover bg-center"
                                                        style={{ backgroundImage: `url(${preset.url})` }}
                                                    />
                                                    <div className="absolute inset-0 bg-black/50 group-hover:bg-black/40 transition-colors" />
                                                    <span className="absolute bottom-1.5 left-2 right-2 text-[10px] font-medium text-white truncate z-10">
                                                        {preset.name}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Darkness / Vignette Slider */}
                                    <div className="space-y-2 pt-2 border-t">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="slideOverlay" className="text-xs font-semibold">
                                                Dark Vignette Overlay Opacity: {Math.round(slide.overlayOpacity * 100)}%
                                            </Label>
                                        </div>
                                        <input
                                            id="slideOverlay"
                                            type="range"
                                            min="0"
                                            max="0.8"
                                            step="0.05"
                                            value={slide.overlayOpacity}
                                            onChange={(e) =>
                                                handleUpdateActiveSlide({ overlayOpacity: parseFloat(e.target.value) })
                                            }
                                            className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
                                        />
                                    </div>
                                </div>
                            );
                        })()}
                    </CardContent>
                </Card>
            )}

            {/* TAB: Announcement & Urgency */}
            {activeTab === "ticker" && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Top Announcement Ticker & Dispatch Urgency</CardTitle>
                        <CardDescription>
                            Configure the scrolling announcement marquee and real-time shipping urgency ticker.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                            <div>
                                <Label htmlFor="tickerToggle" className="font-semibold text-sm">
                                    Display Announcement Ticker
                                </Label>
                                <p className="text-xs text-muted-foreground">Appears at the very top of all storefront pages.</p>
                            </div>
                            <Switch
                                id="tickerToggle"
                                checked={content.announcement.enabled}
                                onCheckedChange={(checked) =>
                                    setContent({
                                        ...content,
                                        announcement: { ...content.announcement, enabled: checked },
                                    })
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="primaryTicker">Primary Banner Text</Label>
                            <Input
                                id="primaryTicker"
                                value={content.announcement.primary}
                                onChange={(e) =>
                                    setContent({
                                        ...content,
                                        announcement: { ...content.announcement, primary: e.target.value },
                                    })
                                }
                                placeholder="PAN INDIA SHIPPING • DISPATCHED IN 24-48 HRS"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="urgencyText">Dispatch Urgency Ticker (Subtle social proof)</Label>
                            <Input
                                id="urgencyText"
                                value={content.announcement.dispatchUrgencyText || ""}
                                onChange={(e) =>
                                    setContent({
                                        ...content,
                                        announcement: { ...content.announcement, dispatchUrgencyText: e.target.value },
                                    })
                                }
                                placeholder="⚡ Orders dispatched daily via insured express couriers"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="couponSnippet">Coupon Code Snippet</Label>
                            <Input
                                id="couponSnippet"
                                value={content.announcement.couponSnippet}
                                onChange={(e) =>
                                    setContent({
                                        ...content,
                                        announcement: { ...content.announcement, couponSnippet: e.target.value },
                                    })
                                }
                                placeholder="USE CODE: FESTIVE10 FOR 10% OFF"
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* TAB: Trust Guarantee Strip */}
            {activeTab === "trust" && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Trust Guarantee & Shipping Strip</CardTitle>
                        <CardDescription>
                            Showcase 4 minimalist pillars (express insured delivery, 22K micron plating, skin-safe alloys, and concierge).
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                            <div>
                                <Label htmlFor="trustToggle" className="font-semibold text-sm">
                                    Display Trust Strip on Homepage
                                </Label>
                                <p className="text-xs text-muted-foreground">Increases customer checkout conversion by 30%.</p>
                            </div>
                            <Switch
                                id="trustToggle"
                                checked={content.trustStrip?.enabled ?? true}
                                onCheckedChange={(checked) =>
                                    setContent({
                                        ...content,
                                        trustStrip: { ...content.trustStrip, enabled: checked },
                                    })
                                }
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(content.trustStrip?.items || []).map((item, idx) => (
                                <div key={idx} className="p-4 border rounded-lg space-y-2 bg-card">
                                    <Badge variant="outline" className="text-xs font-mono uppercase">
                                        Pillar #{idx + 1}
                                    </Badge>
                                    <Input
                                        value={item.title}
                                        onChange={(e) => {
                                            const items = [...content.trustStrip.items];
                                            items[idx] = { ...items[idx], title: e.target.value };
                                            setContent({ ...content, trustStrip: { ...content.trustStrip, items } });
                                        }}
                                        placeholder="Pillar Title"
                                        className="font-semibold text-sm"
                                    />
                                    <Input
                                        value={item.subtitle}
                                        onChange={(e) => {
                                            const items = [...content.trustStrip.items];
                                            items[idx] = { ...items[idx], subtitle: e.target.value };
                                            setContent({ ...content, trustStrip: { ...content.trustStrip, items } });
                                        }}
                                        placeholder="Pillar description"
                                        className="text-xs text-muted-foreground"
                                    />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* TAB: Product Vitrines */}
            {activeTab === "vitrines" && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Homepage Product Vitrines</CardTitle>
                        <CardDescription>
                            Configure category sections displayed on the storefront.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {content.vitrines.map((vitrine, idx) => (
                            <div key={vitrine.id} className="p-4 border rounded-md space-y-3 bg-muted/20">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                        Vitrine #{idx + 1}
                                    </span>
                                    <Badge variant="outline">{vitrine.filter}</Badge>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Section Heading</Label>
                                        <Input
                                            value={vitrine.title}
                                            onChange={(e) => {
                                                const updated = [...content.vitrines];
                                                updated[idx] = { ...updated[idx], title: e.target.value };
                                                setContent({ ...content, vitrines: updated });
                                            }}
                                            placeholder="e.g. Latest Drop"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Category Filter</Label>
                                        <Input
                                            value={vitrine.filter}
                                            onChange={(e) => {
                                                const updated = [...content.vitrines];
                                                updated[idx] = { ...updated[idx], filter: e.target.value };
                                                setContent({ ...content, vitrines: updated });
                                            }}
                                            placeholder="e.g. Temple, Bridal, all"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* TAB: Merchandising & Badges */}
            {activeTab === "merchandising" && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Visual Merchandising & Product Badges</CardTitle>
                        <CardDescription>
                            Pin flagship pieces to the top of catalog vitrines and assign custom tags (e.g. "CELEB PICK", "ROYAL BRIDAL").
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="lowStockThreshold">Auto Low-Stock Alert Threshold</Label>
                            <Input
                                id="lowStockThreshold"
                                type="number"
                                value={content.merchandising?.autoLowStockThreshold ?? 3}
                                onChange={(e) =>
                                    setContent({
                                        ...content,
                                        merchandising: {
                                            ...content.merchandising,
                                            autoLowStockThreshold: parseInt(e.target.value, 10) || 3,
                                        },
                                    })
                                }
                                className="w-32"
                            />
                            <p className="text-xs text-muted-foreground">
                                When product inventory drops to or below this number, storefront automatically displays an "ONLY X LEFT" badge.
                            </p>
                        </div>

                        <Separator />

                        <div className="space-y-3">
                            <Label className="text-sm font-semibold">Custom Product Badges & Spotlights</Label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {[
                                    { sku: "LUM-PADMAVATI-CHOKER", name: "The Padmavati Polki Choker Suite" },
                                    { sku: "LUM-MEHRUNISA-SET", name: "Mehrunisa Royal Kundan Choker Set" },
                                    { sku: "LUM-DEVI-TEMPLE-CHOKER", name: "Devi Temple Matte Vanki Choker" },
                                    { sku: "LUM-RANI-SAHIBA-MALA", name: "Rani Sahiba 7-Layered Pearl Mala" },
                                    { sku: "LUM-NOOR-CHANDBALI", name: "Noor Victorian Moissanite Chandbali" },
                                    { sku: "LUM-BRIDAL-NAVRATNA-CHOKER", name: "Navratna Heritage Polki Bridal Choker" },
                                ].map((p) => {
                                    const currentBadge = content.merchandising?.customProductBadges?.[p.sku] || "";
                                    const isPinned = content.merchandising?.pinnedProductSkus?.includes(p.sku);
                                    return (
                                        <div key={p.sku} className="p-3 border rounded-lg bg-card space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-xs truncate max-w-[200px]">{p.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const pinned = [...(content.merchandising?.pinnedProductSkus || [])];
                                                        const next = isPinned
                                                            ? pinned.filter((s) => s !== p.sku)
                                                            : [...pinned, p.sku];
                                                        setContent({
                                                            ...content,
                                                            merchandising: { ...content.merchandising, pinnedProductSkus: next },
                                                        });
                                                    }}
                                                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                                                        isPinned ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    {isPinned ? "Pinned to Top" : "Pin to Top"}
                                                </button>
                                            </div>
                                            <Input
                                                value={currentBadge}
                                                onChange={(e) => {
                                                    const badges = { ...(content.merchandising?.customProductBadges || {}) };
                                                    if (e.target.value.trim()) {
                                                        badges[p.sku] = e.target.value.toUpperCase();
                                                    } else {
                                                        delete badges[p.sku];
                                                    }
                                                    setContent({
                                                        ...content,
                                                        merchandising: { ...content.merchandising, customProductBadges: badges },
                                                    });
                                                }}
                                                placeholder="Custom Badge (e.g. CELEB PICK)"
                                                className="text-xs"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* TAB: Reviews & Testimonials */}
            {activeTab === "reviews" && (
                <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-lg">Customer Testimonials & Reviews Studio</CardTitle>
                            <CardDescription>
                                Curate 5-star verified buyer reviews to build deep patron trust.
                            </CardDescription>
                        </div>
                        <Button type="button" size="sm" onClick={handleAddReview} className="gap-1.5">
                            <Plus className="w-3.5 h-3.5" />
                            Add Review
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2 border-b">
                            <div className="space-y-1">
                                <Label className="text-xs">Section Heading</Label>
                                <Input
                                    value={content.reviews?.heading || ""}
                                    onChange={(e) =>
                                        setContent({
                                            ...content,
                                            reviews: { ...content.reviews, heading: e.target.value },
                                        })
                                    }
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Subheading Tagline</Label>
                                <Input
                                    value={content.reviews?.subheading || ""}
                                    onChange={(e) =>
                                        setContent({
                                            ...content,
                                            reviews: { ...content.reviews, subheading: e.target.value },
                                        })
                                    }
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            {(content.reviews?.items || []).map((rev, idx) => (
                                <div key={rev.id || idx} className="p-4 border rounded-lg bg-card space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="flex text-amber-500">
                                                {Array.from({ length: rev.rating || 5 }).map((_, i) => (
                                                    <Star key={i} className="w-3.5 h-3.5 fill-current" />
                                                ))}
                                            </div>
                                            <Badge variant="outline" className="text-[10px] font-mono">
                                                Verified Patron
                                            </Badge>
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleDeleteReview(idx)}
                                            className="text-red-500 hover:bg-red-500/10 h-7 w-7 p-0"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <Input
                                            value={rev.customerName}
                                            onChange={(e) => handleUpdateReview(idx, { customerName: e.target.value })}
                                            placeholder="Customer Name"
                                            className="text-xs"
                                        />
                                        <Input
                                            value={rev.city}
                                            onChange={(e) => handleUpdateReview(idx, { city: e.target.value })}
                                            placeholder="City (e.g. Chennai)"
                                            className="text-xs"
                                        />
                                        <Input
                                            value={rev.itemPurchased}
                                            onChange={(e) => handleUpdateReview(idx, { itemPurchased: e.target.value })}
                                            placeholder="Item Purchased"
                                            className="text-xs"
                                        />
                                    </div>

                                    <Textarea
                                        value={rev.reviewText}
                                        onChange={(e) => handleUpdateReview(idx, { reviewText: e.target.value })}
                                        placeholder="Review text..."
                                        className="text-xs min-h-[60px]"
                                    />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* TAB: Brand Story & FAQ */}
            {activeTab === "story_faq" && (
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Brand Story & Heirloom Atelier</CardTitle>
                            <CardDescription>
                                Educate customers on your traditional handcrafting process and skin-safe 22K plating.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Tagline</Label>
                                    <Input
                                        value={content.brandStory?.tagline || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                brandStory: { ...content.brandStory, tagline: e.target.value },
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Heading</Label>
                                    <Input
                                        value={content.brandStory?.heading || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                brandStory: { ...content.brandStory, heading: e.target.value },
                                            })
                                        }
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs">Story Body Text</Label>
                                <Textarea
                                    value={content.brandStory?.bodyText || ""}
                                    onChange={(e) =>
                                        setContent({
                                            ...content,
                                            brandStory: { ...content.brandStory, bodyText: e.target.value },
                                        })
                                    }
                                    className="text-xs min-h-[90px]"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-lg">Customer Care & Shipping FAQ</CardTitle>
                                <CardDescription>
                                    Address common queries regarding delivery times, skin safety, and WhatsApp inspection.
                                </CardDescription>
                            </div>
                            <Button type="button" size="sm" onClick={handleAddFaq} className="gap-1.5">
                                <Plus className="w-3.5 h-3.5" />
                                Add Question
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {(content.faq?.items || []).map((faq, idx) => (
                                <div key={idx} className="p-3 border rounded-lg bg-card space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-xs font-mono">
                                            Q#{idx + 1}
                                        </Badge>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleDeleteFaq(idx)}
                                            className="text-red-500 hover:bg-red-500/10 h-6 w-6 p-0"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                    <Input
                                        value={faq.question}
                                        onChange={(e) => handleUpdateFaq(idx, { question: e.target.value })}
                                        placeholder="Question"
                                        className="text-xs font-semibold"
                                    />
                                    <Textarea
                                        value={faq.answer}
                                        onChange={(e) => handleUpdateFaq(idx, { answer: e.target.value })}
                                        placeholder="Answer"
                                        className="text-xs min-h-[60px]"
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* TAB: Promo & Coupons */}
            {activeTab === "promo" && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Coupons & Festive Promotion Banner</CardTitle>
                        <CardDescription>
                            Manage promotional discount codes and full-width festive callout banners.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                            <div>
                                <Label htmlFor="promoToggle" className="font-semibold text-sm">
                                    Display Full-Width Promo Callout
                                </Label>
                                <p className="text-xs text-muted-foreground">Appears between product drops on the homepage.</p>
                            </div>
                            <Switch
                                id="promoToggle"
                                checked={content.promoBanner.enabled}
                                onCheckedChange={(checked) =>
                                    setContent({
                                        ...content,
                                        promoBanner: { ...content.promoBanner, enabled: checked },
                                    })
                                }
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="promoCode">Coupon Code</Label>
                                <Input
                                    id="promoCode"
                                    value={content.promoBanner.code}
                                    onChange={(e) =>
                                        setContent({
                                            ...content,
                                            promoBanner: { ...content.promoBanner, code: e.target.value.toUpperCase() },
                                        })
                                    }
                                    placeholder="FESTIVE10"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="promoDiscount">Discount Badge</Label>
                                <Input
                                    id="promoDiscount"
                                    value={content.promoBanner.discount}
                                    onChange={(e) =>
                                        setContent({
                                            ...content,
                                            promoBanner: { ...content.promoBanner, discount: e.target.value },
                                        })
                                    }
                                    placeholder="10% OFF"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="promoDesc">Banner Description</Label>
                            <Input
                                id="promoDesc"
                                value={content.promoBanner.description}
                                onChange={(e) =>
                                    setContent({
                                        ...content,
                                        promoBanner: { ...content.promoBanner, description: e.target.value },
                                    })
                                }
                                placeholder="FLAT 10% OFF ON ORDERS OVER ₹1,999"
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* TAB: Mobile Sticky Commerce & Socials */}
            {activeTab === "mobile_social" && (
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Mobile Sticky Commerce Action Bar</CardTitle>
                            <CardDescription>
                                Floating quick-buy bar that sticks to the bottom on phone screens when scrolling past the hero.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                                <div>
                                    <Label htmlFor="stickyToggle" className="font-semibold text-sm">
                                        Enable Mobile Sticky Action Bar
                                    </Label>
                                    <p className="text-xs text-muted-foreground">Boosts mobile conversion rate significantly.</p>
                                </div>
                                <Switch
                                    id="stickyToggle"
                                    checked={content.stickyMobileBar?.enabled ?? true}
                                    onCheckedChange={(checked) =>
                                        setContent({
                                            ...content,
                                            stickyMobileBar: { ...content.stickyMobileBar, enabled: checked },
                                        })
                                    }
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="waPreset">WhatsApp Inquiry Message Preset</Label>
                                <Input
                                    id="waPreset"
                                    value={content.stickyMobileBar?.whatsappMessagePreset || ""}
                                    onChange={(e) =>
                                        setContent({
                                            ...content,
                                            stickyMobileBar: {
                                                ...content.stickyMobileBar,
                                                whatsappMessagePreset: e.target.value,
                                            },
                                        })
                                    }
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Social Accounts & Direct Contact</CardTitle>
                            <CardDescription>
                                Manage official Instagram and direct WhatsApp concierge contact details.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="instagram">Instagram Username</Label>
                                    <Input
                                        id="instagram"
                                        value={content.socialAndContact.instagram}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                socialAndContact: {
                                                    ...content.socialAndContact,
                                                    instagram: e.target.value.replace("@", "").trim(),
                                                },
                                            })
                                        }
                                        placeholder="your_brand_handle"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="whatsapp">WhatsApp Phone (with Country Code)</Label>
                                    <Input
                                        id="whatsapp"
                                        value={content.socialAndContact.whatsappPhone}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                socialAndContact: {
                                                    ...content.socialAndContact,
                                                    whatsappPhone: e.target.value,
                                                },
                                            })
                                        }
                                        placeholder="+91 98765 00000"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Instagram Atelier Showcase Posts Studio */}
                    <Card>
                        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Share2 className="w-4 h-4 text-pink-500" />
                                    Latest Instagram Posts & Reels Studio
                                </CardTitle>
                                <CardDescription>
                                    Manage the top 3 live Instagram drops shown on the storefront from @{content.socialAndContact.instagram || "your_brand"}.
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                <Label htmlFor="ig-feed-enabled" className="text-xs cursor-pointer">
                                    {content.instagramFeed?.enabled ? "Feed Visible" : "Feed Hidden"}
                                </Label>
                                <Switch
                                    id="ig-feed-enabled"
                                    checked={content.instagramFeed?.enabled ?? true}
                                    onCheckedChange={(c) =>
                                        setContent({
                                            ...content,
                                            instagramFeed: {
                                                ...content.instagramFeed,
                                                enabled: c,
                                            },
                                        })
                                    }
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {(content.instagramFeed?.posts || DEFAULT_STATE.instagramFeed.posts).slice(0, 3).map((post, idx) => (
                                    <div key={post.id || idx} className="border rounded-lg p-3 bg-muted/20 space-y-3">
                                        <div className="relative aspect-square w-full rounded overflow-hidden bg-neutral-900 border">
                                            <img
                                                src={post.imageUrl}
                                                alt={post.caption}
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute top-2 right-2 bg-black/80 text-white text-[10px] font-mono uppercase px-2 py-0.5 rounded-full">
                                                {post.type}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-semibold">Post #{idx + 1}</Label>
                                                <a
                                                    href={post.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[11px] text-primary underline flex items-center gap-1"
                                                >
                                                    Open ↗
                                                </a>
                                            </div>

                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">Post / Reel URL</Label>
                                                <Input
                                                    value={post.url}
                                                    onChange={(e) => {
                                                        const updated = [...(content.instagramFeed?.posts || DEFAULT_STATE.instagramFeed.posts)];
                                                        updated[idx] = { ...updated[idx], url: e.target.value };
                                                        setContent({
                                                            ...content,
                                                            instagramFeed: { ...content.instagramFeed, posts: updated },
                                                        });
                                                    }}
                                                    placeholder="https://www.instagram.com/reel/..."
                                                    className="text-xs font-mono h-8"
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">Image / Thumbnail Path</Label>
                                                <Input
                                                    value={post.imageUrl}
                                                    onChange={(e) => {
                                                        const updated = [...(content.instagramFeed?.posts || DEFAULT_STATE.instagramFeed.posts)];
                                                        updated[idx] = { ...updated[idx], imageUrl: e.target.value };
                                                        setContent({
                                                            ...content,
                                                            instagramFeed: { ...content.instagramFeed, posts: updated },
                                                        });
                                                    }}
                                                    placeholder="/instagram/post-1.jpg"
                                                    className="text-xs font-mono h-8"
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">Caption</Label>
                                                <Input
                                                    value={post.caption}
                                                    onChange={(e) => {
                                                        const updated = [...(content.instagramFeed?.posts || DEFAULT_STATE.instagramFeed.posts)];
                                                        updated[idx] = { ...updated[idx], caption: e.target.value };
                                                        setContent({
                                                            ...content,
                                                            instagramFeed: { ...content.instagramFeed, posts: updated },
                                                        });
                                                    }}
                                                    placeholder="Describe jewellery drop..."
                                                    className="text-xs h-8"
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">Type</Label>
                                                <div className="flex gap-2">
                                                    {(["reel", "post"] as const).map((t) => (
                                                        <Button
                                                            key={t}
                                                            type="button"
                                                            size="sm"
                                                            variant={post.type === t ? "default" : "outline"}
                                                            onClick={() => {
                                                                const updated = [...(content.instagramFeed?.posts || DEFAULT_STATE.instagramFeed.posts)];
                                                                updated[idx] = { ...updated[idx], type: t };
                                                                setContent({
                                                                    ...content,
                                                                    instagramFeed: { ...content.instagramFeed, posts: updated },
                                                                });
                                                            }}
                                                            className="text-xs h-7 uppercase flex-1"
                                                        >
                                                            {t}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* TAB: Branding, Logo & Google Fonts Theming */}
            {activeTab === "branding_theme" && (
                <div className="space-y-6">
                    {/* Live Appearance Preview Panel */}
                    <Card className="border-2 border-primary/20 overflow-hidden shadow-md">
                        <CardHeader className="bg-muted/30 pb-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Eye className="w-4 h-4 text-primary" />
                                        Real-Time Branding & Theming Preview
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Live render of your configured logo, Google fonts, and color palette.
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="font-mono text-[11px] bg-primary/10 text-primary">
                                    Preset: {content.theme?.preset || "Custom"}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6 bg-card">
                            {/* Logo & Navigation simulation */}
                            <div
                                className="p-4 rounded-lg border flex items-center justify-between transition-colors"
                                style={{
                                    backgroundColor: content.theme?.colors?.background || "#FFFFFF",
                                    borderColor: content.theme?.colors?.border || "#E5E5E5",
                                }}
                            >
                                {/* Logo render */}
                                <div>
                                    {content.branding?.logoType === "image" && content.branding?.imageLogo?.url ? (
                                        <img
                                            src={content.branding.imageLogo.url}
                                            alt={content.branding.imageLogo.alt || "Logo"}
                                            style={{
                                                height: `${content.branding.imageLogo.desktopHeight || 36}px`,
                                            }}
                                            className="w-auto object-contain max-h-[50px]"
                                        />
                                    ) : (
                                        <span
                                            style={{
                                                fontFamily: `'${content.branding?.wordmark?.fontFamily || "Plus Jakarta Sans"}', sans-serif`,
                                                fontSize: `${content.branding?.wordmark?.fontSize || 28}px`,
                                                letterSpacing: content.branding?.wordmark?.letterSpacing || "-0.04em",
                                                textTransform: content.branding?.wordmark?.textTransform || "lowercase",
                                                color: content.theme?.colors?.primary || "#0A0A0A",
                                                fontWeight: 800,
                                            }}
                                        >
                                            {content.branding?.wordmark?.text || "The Atelier"}
                                        </span>
                                    )}
                                </div>

                                {/* Simulated Nav & Accent Button */}
                                <div className="flex items-center gap-4">
                                    <span
                                        className="text-xs hidden sm:inline"
                                        style={{
                                            fontFamily: `'${content.theme?.typography?.bodyFont || "Plus Jakarta Sans"}', sans-serif`,
                                            color: content.theme?.colors?.secondary || "#444444",
                                        }}
                                    >
                                        Chokers · Polki · Temple 22K
                                    </span>
                                    <button
                                        type="button"
                                        className="text-xs px-3 py-1.5 rounded-full font-medium shadow-xs transition"
                                        style={{
                                            backgroundColor: content.theme?.colors?.accent || "#C5A059",
                                            color: "#FFFFFF",
                                            fontFamily: `'${content.theme?.typography?.bodyFont || "Plus Jakarta Sans"}', sans-serif`,
                                        }}
                                    >
                                        Atelier Bag (3)
                                    </button>
                                </div>
                            </div>

                            {/* Typography Preview Canvas */}
                            <div
                                className="p-5 rounded-lg border space-y-3"
                                style={{
                                    backgroundColor: content.theme?.colors?.surface || "#FAF8F5",
                                    borderColor: content.theme?.colors?.border || "#E5E5E5",
                                }}
                            >
                                <div className="space-y-1">
                                    <span
                                        className="text-[11px] font-mono uppercase tracking-widest block"
                                        style={{ color: content.theme?.colors?.accent || "#C5A059" }}
                                    >
                                        Display / Heading Font ({content.theme?.typography?.headingFont || "Playfair Display"})
                                    </span>
                                    <h2
                                        className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                                            content.theme?.typography?.fontEffect && content.theme.typography.fontEffect !== "none"
                                                ? `font-effect-${content.theme.typography.fontEffect}`
                                                : ""
                                        }`}
                                        style={{
                                            fontFamily: `'${content.theme?.typography?.headingFont || "Playfair Display"}', Georgia, serif`,
                                            color: content.theme?.colors?.primary || "#0A0A0A",
                                        }}
                                    >
                                        Handcrafted 22K Heritage Jewellery
                                    </h2>
                                </div>

                                <div className="space-y-1">
                                    <span
                                        className="text-[11px] font-mono uppercase tracking-widest block text-muted-foreground"
                                    >
                                        Body / UI Font ({content.theme?.typography?.bodyFont || "Plus Jakarta Sans"})
                                    </span>
                                    <p
                                        className="text-xs sm:text-sm leading-relaxed"
                                        style={{
                                            fontFamily: `'${content.theme?.typography?.bodyFont || "Plus Jakarta Sans"}', sans-serif`,
                                            color: content.theme?.colors?.secondary || "#2A2A2A",
                                        }}
                                    >
                                        Each heirloom is meticulously shaped on hypoallergenic cores, finished with high-micron 22K gold immersion, and dispatched within 24 to 48 hours with insured tracking.
                                    </p>
                                </div>

                                <div className="space-y-1 pt-1">
                                    <span
                                        className="text-[11px] font-mono uppercase tracking-widest block"
                                        style={{ color: content.theme?.colors?.accent || "#C5A059" }}
                                    >
                                        Atelier Accent Font ({content.theme?.typography?.accentFont || "Cormorant Garamond"})
                                    </span>
                                    <p
                                        className="text-lg sm:text-xl italic font-normal"
                                        style={{
                                            fontFamily: `'${content.theme?.typography?.accentFont || "Cormorant Garamond"}', cursive, serif`,
                                            color: content.theme?.colors?.accent || "#C5A059",
                                        }}
                                    >
                                        "Where sacred South Indian temple heritage meets imperial Jaipur polki splendour."
                                    </p>
                                </div>
                            </div>

                            {/* Color Palette Swatches */}
                            <div className="flex flex-wrap items-center gap-3">
                                {[
                                    { label: "Primary", val: content.theme?.colors?.primary },
                                    { label: "Secondary", val: content.theme?.colors?.secondary },
                                    { label: "Accent", val: content.theme?.colors?.accent },
                                    { label: "Background", val: content.theme?.colors?.background },
                                    { label: "Surface", val: content.theme?.colors?.surface },
                                    { label: "Border", val: content.theme?.colors?.border },
                                ].map((swatch) => (
                                    <div key={swatch.label} className="flex items-center gap-2 border rounded-md px-2.5 py-1.5 bg-background">
                                        <div
                                            className="w-5 h-5 rounded-full border shadow-xs"
                                            style={{ backgroundColor: swatch.val || "#000000" }}
                                        />
                                        <div>
                                            <p className="text-[10px] text-muted-foreground uppercase">{swatch.label}</p>
                                            <p className="font-mono text-xs font-semibold">{swatch.val}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Logo Management Studio */}
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Type className="w-4 h-4 text-primary" />
                                        Storefront Logo Studio (Independent Font & Style)
                                    </CardTitle>
                                    <CardDescription>
                                        Configure your brand identity. The Wordmark Logo font is decoupled from general typography tokens, ensuring 1-click theme presets will never alter your bespoke logo font.
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="text-xs font-mono bg-primary/10 text-primary w-fit">
                                    --font-logo: {content.branding?.wordmark?.fontFamily || "Plus Jakarta Sans"}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Mode switcher */}
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={content.branding?.logoType === "wordmark" ? "default" : "outline"}
                                    onClick={() =>
                                        setContent({
                                            ...content,
                                            branding: { ...content.branding, logoType: "wordmark" },
                                        })
                                    }
                                    className="gap-2"
                                >
                                    <Type className="w-4 h-4" />
                                    Wordmark Logo
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={content.branding?.logoType === "image" ? "default" : "outline"}
                                    onClick={() =>
                                        setContent({
                                            ...content,
                                            branding: { ...content.branding, logoType: "image" },
                                        })
                                    }
                                    className="gap-2"
                                >
                                    <ImageIcon className="w-4 h-4" />
                                    Uploaded Image Logo
                                </Button>
                            </div>

                            {/* Wordmark options */}
                            {content.branding?.logoType === "wordmark" && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 border rounded-lg bg-muted/20">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Wordmark Text</Label>
                                        <Input
                                            value={content.branding.wordmark.text}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        wordmark: { ...content.branding.wordmark, text: e.target.value },
                                                    },
                                                })
                                            }
                                            placeholder="The Atelier"
                                            className="text-xs"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-semibold">Logo Font (Independent)</Label>
                                            <Badge variant="outline" className="text-[10px] font-mono">
                                                --font-logo
                                            </Badge>
                                        </div>
                                        <select
                                            value={content.branding.wordmark.fontFamily}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        wordmark: { ...content.branding.wordmark, fontFamily: e.target.value },
                                                    },
                                                })
                                            }
                                            className="w-full text-xs h-9 px-2 rounded-md border bg-background"
                                        >
                                            {CURATED_GOOGLE_FONTS.logo.map((f) => (
                                                <option key={f} value={f}>
                                                    {f}
                                                </option>
                                            ))}
                                        </select>
                                        <Input
                                            value={content.branding.wordmark.fontFamily || ""}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        wordmark: { ...content.branding.wordmark, fontFamily: e.target.value },
                                                    },
                                                })
                                            }
                                            placeholder="Or type custom Google Font..."
                                            className="text-xs h-8"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-xs">Font Size (px)</Label>
                                            <span className="font-mono text-[11px]">{content.branding.wordmark.fontSize || 28}px</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="18"
                                            max="44"
                                            value={content.branding.wordmark.fontSize || 28}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        wordmark: { ...content.branding.wordmark, fontSize: Number(e.target.value) },
                                                    },
                                                })
                                            }
                                            className="w-full h-2 bg-muted rounded-lg cursor-pointer accent-primary"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Letter Spacing (Tracking)</Label>
                                        <Input
                                            value={content.branding.wordmark.letterSpacing || "-0.04em"}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        wordmark: { ...content.branding.wordmark, letterSpacing: e.target.value },
                                                    },
                                                })
                                            }
                                            placeholder="-0.04em"
                                            className="text-xs font-mono"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Image logo options */}
                            {content.branding?.logoType === "image" && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/20">
                                    <div className="space-y-1.5 md:col-span-2">
                                        <Label className="text-xs">Logo Image URL (PNG or SVG)</Label>
                                        <Input
                                            value={content.branding.imageLogo.url}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        imageLogo: { ...content.branding.imageLogo, url: e.target.value },
                                                    },
                                                })
                                            }
                                            placeholder="/images/logo.png or https://..."
                                            className="text-xs font-mono"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Alt Text</Label>
                                        <Input
                                            value={content.branding.imageLogo.alt}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        imageLogo: { ...content.branding.imageLogo, alt: e.target.value },
                                                    },
                                                })
                                            }
                                            placeholder="Brand Alt Text"
                                            className="text-xs"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-xs">Desktop Height (px)</Label>
                                            <span className="font-mono text-[11px]">{content.branding.imageLogo.desktopHeight || 36}px</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="20"
                                            max="60"
                                            value={content.branding.imageLogo.desktopHeight || 36}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        imageLogo: { ...content.branding.imageLogo, desktopHeight: Number(e.target.value) },
                                                    },
                                                })
                                            }
                                            className="w-full h-2 bg-muted rounded-lg cursor-pointer accent-primary"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-xs">Mobile Height (px)</Label>
                                            <span className="font-mono text-[11px]">{content.branding.imageLogo.mobileHeight || 26}px</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="16"
                                            max="44"
                                            value={content.branding.imageLogo.mobileHeight || 26}
                                            onChange={(e) =>
                                                setContent({
                                                    ...content,
                                                    branding: {
                                                        ...content.branding,
                                                        imageLogo: { ...content.branding.imageLogo, mobileHeight: Number(e.target.value) },
                                                    },
                                                })
                                            }
                                            className="w-full h-2 bg-muted rounded-lg cursor-pointer accent-primary"
                                        />
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Curated Luxury Presets */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-500" />
                                1-Click Luxury Theme Presets
                            </CardTitle>
                            <CardDescription>
                                Instant designer palettes pairing high-jewellery color harmonies with complementary Google Fonts.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
                                {PALETTE_PRESETS.map((preset) => {
                                    const isSelected = content.theme?.preset === preset.id;
                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => {
                                                setContent({
                                                    ...content,
                                                    theme: {
                                                        ...content.theme,
                                                        preset: preset.id,
                                                        colors: { ...preset.colors },
                                                        typography: { ...preset.typography },
                                                    },
                                                });
                                                toast.success(`Applied ${preset.name} theme preset`);
                                            }}
                                            className={`p-3.5 rounded-lg border text-left transition-all relative cursor-pointer ${
                                                isSelected
                                                    ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                                                    : "hover:border-primary/50 bg-card"
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5 mb-2.5">
                                                <div className="w-4 h-4 rounded-full border shadow-2xs" style={{ backgroundColor: preset.colors.primary }} />
                                                <div className="w-4 h-4 rounded-full border shadow-2xs" style={{ backgroundColor: preset.colors.accent }} />
                                                <div className="w-4 h-4 rounded-full border shadow-2xs" style={{ backgroundColor: preset.colors.surface }} />
                                            </div>
                                            <p className="font-semibold text-xs leading-tight mb-1">{preset.name}</p>
                                            <p className="text-[10px] text-muted-foreground line-clamp-2 leading-snug">{preset.description}</p>
                                            {isSelected && (
                                                <CheckCircle2 className="w-3.5 h-3.5 text-primary absolute top-2 right-2" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Google Fonts Selection (3-Tier) */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Type className="w-4 h-4 text-primary" />
                                Storefront Typography (Headings, Body & Accent)
                            </CardTitle>
                            <CardDescription>
                                Controls all editorial headlines, descriptions, vitrines, and buttons across the storefront. (Logo font is managed independently in the Logo Studio above).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* 1. Display / Heading Font */}
                                <div className="space-y-2 p-3.5 border rounded-lg bg-muted/20">
                                    <Label className="text-xs font-semibold">1. Display & Headings Font</Label>
                                    <p className="text-[11px] text-muted-foreground">Used for hero titles, section headlines, vitrines & badges.</p>
                                    <select
                                        value={content.theme?.typography?.headingFont || "Playfair Display"}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    preset: "custom",
                                                    typography: {
                                                        ...content.theme.typography,
                                                        headingFont: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        className="w-full text-xs h-9 px-2 rounded-md border bg-background"
                                    >
                                        {CURATED_GOOGLE_FONTS.headings.map((f) => (
                                            <option key={f} value={f}>
                                                {f}
                                            </option>
                                        ))}
                                    </select>
                                    <Input
                                        value={content.theme?.typography?.headingFont || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    preset: "custom",
                                                    typography: {
                                                        ...content.theme.typography,
                                                        headingFont: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        placeholder="Or type custom Google Font..."
                                        className="text-xs h-8"
                                    />
                                </div>

                                {/* 2. Body Font */}
                                <div className="space-y-2 p-3.5 border rounded-lg bg-muted/20">
                                    <Label className="text-xs font-semibold">2. Body & UI Font</Label>
                                    <p className="text-[11px] text-muted-foreground">Used for product descriptions, navigation, buttons, and checkout.</p>
                                    <select
                                        value={content.theme?.typography?.bodyFont || "Plus Jakarta Sans"}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    preset: "custom",
                                                    typography: {
                                                        ...content.theme.typography,
                                                        bodyFont: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        className="w-full text-xs h-9 px-2 rounded-md border bg-background"
                                    >
                                        {CURATED_GOOGLE_FONTS.body.map((f) => (
                                            <option key={f} value={f}>
                                                {f}
                                            </option>
                                        ))}
                                    </select>
                                    <Input
                                        value={content.theme?.typography?.bodyFont || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    preset: "custom",
                                                    typography: {
                                                        ...content.theme.typography,
                                                        bodyFont: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        placeholder="Or type custom Google Font..."
                                        className="text-xs h-8"
                                    />
                                </div>

                                {/* 3. Accent Font */}
                                <div className="space-y-2 p-3.5 border rounded-lg bg-muted/20">
                                    <Label className="text-xs font-semibold">3. Atelier Accent & Script Font</Label>
                                    <p className="text-[11px] text-muted-foreground">Used for editorial quotes, signature subtitles, and badges.</p>
                                    <select
                                        value={content.theme?.typography?.accentFont || "Cormorant Garamond"}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    preset: "custom",
                                                    typography: {
                                                        ...content.theme.typography,
                                                        accentFont: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        className="w-full text-xs h-9 px-2 rounded-md border bg-background"
                                    >
                                        {CURATED_GOOGLE_FONTS.accent.map((f) => (
                                            <option key={f} value={f}>
                                                {f}
                                            </option>
                                        ))}
                                    </select>
                                    <Input
                                        value={content.theme?.typography?.accentFont || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    preset: "custom",
                                                    typography: {
                                                        ...content.theme.typography,
                                                        accentFont: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        placeholder="Or type custom Google Font..."
                                        className="text-xs h-8"
                                    />
                                </div>

                                {/* Google Fonts Display Effect (Beta) */}
                                <div className="space-y-2 p-3.5 border rounded-lg bg-muted/20 md:col-span-3">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                        <div>
                                            <Label className="text-xs font-semibold flex items-center gap-1.5">
                                                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                                                Google Font Display Effect (Beta)
                                            </Label>
                                            <p className="text-[11px] text-muted-foreground">
                                                Applies official Google Fonts decorative text effects (e.g. shadow-multiple, 3d-float, emboss, neon) to headline display typography.
                                            </p>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] font-mono self-start sm:self-auto">
                                            {content.theme?.typography?.fontEffect && content.theme.typography.fontEffect !== "none"
                                                ? `.font-effect-${content.theme.typography.fontEffect}`
                                                : "Standard Luxe (No Effect)"}
                                        </Badge>
                                    </div>
                                    <select
                                        value={content.theme?.typography?.fontEffect || "none"}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    preset: "custom",
                                                    typography: {
                                                        ...content.theme.typography,
                                                        fontEffect: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        className="w-full text-xs h-9 px-2 rounded-md border bg-background"
                                    >
                                        {GOOGLE_FONT_EFFECTS.map((eff) => (
                                            <option key={eff.id} value={eff.id}>
                                                {eff.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Custom Hex Color Pickers */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Palette className="w-4 h-4 text-primary" />
                                Storefront Color Palette
                            </CardTitle>
                            <CardDescription>
                                Fine-tune primary, secondary, accent, and surface hex color tokens with live color pickers.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                                {[
                                    { key: "primary", label: "Primary (Headings & Dark)" },
                                    { key: "secondary", label: "Secondary (Body Text)" },
                                    { key: "accent", label: "Accent (Luxe Gold)" },
                                    { key: "background", label: "Background" },
                                    { key: "surface", label: "Surface (Cards & Tint)" },
                                    { key: "border", label: "Borders" },
                                ].map((item) => {
                                    const colorVal = (content.theme?.colors as any)?.[item.key] || "#000000";
                                    return (
                                        <div key={item.key} className="space-y-1.5 p-3 border rounded-lg bg-card">
                                            <Label className="text-[11px] font-medium leading-tight block h-7">
                                                {item.label}
                                            </Label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={colorVal}
                                                    onChange={(e) =>
                                                        setContent({
                                                            ...content,
                                                            theme: {
                                                                ...content.theme,
                                                                preset: "custom",
                                                                colors: {
                                                                    ...content.theme.colors,
                                                                    [item.key]: e.target.value,
                                                                },
                                                            },
                                                        })
                                                    }
                                                    className="w-8 h-8 rounded border cursor-pointer p-0 bg-transparent"
                                                />
                                                <Input
                                                    value={colorVal}
                                                    onChange={(e) =>
                                                        setContent({
                                                            ...content,
                                                            theme: {
                                                                ...content.theme,
                                                                preset: "custom",
                                                                colors: {
                                                                    ...content.theme.colors,
                                                                    [item.key]: e.target.value,
                                                                },
                                                            },
                                                        })
                                                    }
                                                    className="text-xs font-mono h-8 flex-1 uppercase"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Section Specific Overrides */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Section-Specific Color Overrides</CardTitle>
                            <CardDescription>
                                Optional granular background and text styling overrides for dedicated storefront sections.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1.5 p-3 border rounded-lg bg-muted/20">
                                    <Label className="text-xs font-semibold">Hero Background</Label>
                                    <Input
                                        value={content.theme?.sectionOverrides?.heroBg || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    sectionOverrides: {
                                                        ...content.theme.sectionOverrides,
                                                        heroBg: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        placeholder="#000000"
                                        className="text-xs font-mono h-8"
                                    />
                                </div>

                                <div className="space-y-1.5 p-3 border rounded-lg bg-muted/20">
                                    <Label className="text-xs font-semibold">Announcement Bar Bg</Label>
                                    <Input
                                        value={content.theme?.sectionOverrides?.announcementBg || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    sectionOverrides: {
                                                        ...content.theme.sectionOverrides,
                                                        announcementBg: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        placeholder="#0A0A0A"
                                        className="text-xs font-mono h-8"
                                    />
                                </div>

                                <div className="space-y-1.5 p-3 border rounded-lg bg-muted/20">
                                    <Label className="text-xs font-semibold">Trust Strip Background</Label>
                                    <Input
                                        value={content.theme?.sectionOverrides?.trustStripBg || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    sectionOverrides: {
                                                        ...content.theme.sectionOverrides,
                                                        trustStripBg: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        placeholder="#FAF8F5"
                                        className="text-xs font-mono h-8"
                                    />
                                </div>

                                <div className="space-y-1.5 p-3 border rounded-lg bg-muted/20">
                                    <Label className="text-xs font-semibold">Customer Reviews Tint</Label>
                                    <Input
                                        value={content.theme?.sectionOverrides?.reviewsBg || ""}
                                        onChange={(e) =>
                                            setContent({
                                                ...content,
                                                theme: {
                                                    ...content.theme,
                                                    sectionOverrides: {
                                                        ...content.theme.sectionOverrides,
                                                        reviewsBg: e.target.value,
                                                    },
                                                },
                                            })
                                        }
                                        placeholder="#FAF8F5"
                                        className="text-xs font-mono h-8"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
            </div>
        </div>
    );
}
