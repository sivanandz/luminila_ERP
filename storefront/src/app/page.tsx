"use client";

import React, { useEffect, useState, useMemo, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    getStorefrontCatalog,
    StorefrontProduct,
    extractInventoryCategories,
    InventoryCategoryNode,
} from "@/lib/pocketbase";
import { useCart } from "@/context/CartContext";
import { ArrowDown, Plus, Check, MessageCircle, ChevronLeft, ChevronRight, Clock, Instagram, Sparkles, Pin } from "lucide-react";
import { toast } from "sonner";
import TrustStrip, { TrustStripItem } from "@/components/TrustStrip";
import ReviewsCarousel, { ReviewItem } from "@/components/ReviewsCarousel";
import BrandStory from "@/components/BrandStory";
import FaqAccordion, { FaqItem } from "@/components/FaqAccordion";
import StickyMobileBar from "@/components/StickyMobileBar";
import { getStorefrontApiUrl } from "@/lib/api";

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

interface StorefrontContent {
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
        slides?: HeroSlide[];
    };
    layoutSections?: LayoutSectionItem[];
    trustStrip?: {
        enabled: boolean;
        items: TrustStripItem[];
    };
    merchandising?: {
        autoLowStockThreshold: number;
        pinnedProductSkus: string[];
        customProductBadges: Record<string, string>;
    };
    reviews?: {
        enabled: boolean;
        heading: string;
        subheading: string;
        items: ReviewItem[];
    };
    brandStory?: {
        enabled: boolean;
        tagline: string;
        heading: string;
        bodyText: string;
        craftDetails: string[];
        imageUrl: string;
    };
    faq?: {
        enabled: boolean;
        items: FaqItem[];
    };
    stickyMobileBar?: {
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
    instagramFeed?: {
        enabled: boolean;
        handle?: string;
        heading?: string;
        posts: {
            id: string;
            url: string;
            imageUrl: string;
            caption: string;
            type: "reel" | "post";
        }[];
    };
}

const DEFAULT_CONTENT: StorefrontContent = {
    announcement: {
        enabled: true,
        primary: "PAN INDIA SHIPPING • DISPATCHED IN 24-48 HRS",
        secondary: "FREE EXPRESS SHIPPING ON ORDERS ABOVE ₹799",
        couponSnippet: "USE CODE: FESTIVE10 FOR 10% OFF",
        dispatchUrgencyText: "⚡ 18 orders dispatched today via ST Courier Express",
    },
    hero: {
        brandName: "niththigal.",
        tagline: "craftisans",
        ctaText: "shop now",
        ctaLink: "#catalog-section",
        imageUrl: "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=2000&auto=format&fit=crop",
        overlayOpacity: 0.25,
        autoplaySpeed: 5000,
        slides: [
            {
                id: "slide-1",
                title: "niththigal.",
                tagline: "craftisans",
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
                title: "bridal kundan.",
                tagline: "royal jadau & polki suites",
                ctaText: "explore kundan chokers ↓",
                ctaLink: "/?category=chokers&sub=kundan#catalog-section",
                imageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=2000&auto=format&fit=crop",
                mobileImageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=900&auto=format&fit=crop",
                badgeText: "👑 BRIDAL 2026",
                countdownTarget: "",
                ctaStyle: "box",
                overlayOpacity: 0.3,
            },
            {
                id: "slide-3",
                title: "temple 22k finish.",
                tagline: "antique devi lakshmi matte gold",
                ctaText: "view temple jewellery ↓",
                ctaLink: "/?category=temple-22k-finish#catalog-section",
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
        { id: "instagram_feed", name: "Instagram Atelier Showcase", enabled: true, order: 6 },
        { id: "brand_story", name: "Brand Story & Heirloom Craft", enabled: true, order: 7 },
        { id: "faq_accordion", name: "Jewellery Care & Shipping FAQ", enabled: true, order: 8 },
    ],
    trustStrip: {
        enabled: true,
        items: [
            { icon: "truck", title: "Pan-India Shipping", subtitle: "Dispatched within 24-48 hrs via ST Courier" },
            { icon: "shield", title: "Skin-Safe Hypoallergenic", subtitle: "Lead & nickel-free brass & red-copper alloys" },
            { icon: "sparkles", title: "22K Micron Gold Plating", subtitle: "Authentic temple matte & Jadau polish" },
            { icon: "rotate-ccw", title: "Direct WhatsApp Concierge", subtitle: "Instant video-call inspection before dispatch" },
        ],
    },
    merchandising: {
        autoLowStockThreshold: 3,
        pinnedProductSkus: ["LUM-PADMAVATI-CHOKER", "LUM-DEVI-TEMPLE-CHOKER"],
        customProductBadges: {
            "LUM-PADMAVATI-CHOKER": "ROYAL ATELIER PICK",
            "LUM-MEHRUNISA-SET": "CELEB CHOICE",
            "LUM-DEVI-TEMPLE-CHOKER": "TEMPLE CLASSIC",
            "LUM-RANI-SAHIBA-MALA": "HEIRLOOM PIECE",
        },
    },
    reviews: {
        enabled: true,
        heading: "loved by our craftisan family.",
        subheading: "REAL EXPERIENCES FROM VERIFIED BRIDAL & FESTIVE PATRONS ACROSS INDIA",
        items: [
            {
                id: "rev-1",
                customerName: "Deepika Sundaram",
                city: "Chennai",
                rating: 5,
                reviewText: "The Padmavati Polki Choker Suite took my breath away. The weight, the 2.5-micron gold immersion, and the micro-ghunghroos looked identical to real jadau gold. Dispatched and arrived in 48 hours via ST Courier!",
                itemPurchased: "The Padmavati Polki Choker Suite",
                verifiedBuyer: true,
            },
            {
                id: "rev-2",
                customerName: "Ananya Kulkarni",
                city: "Bengaluru",
                rating: 5,
                reviewText: "Ordered the Devi Temple Matte Vanki Choker for my muhurtham. The Goddess Lakshmi embossing is so crisp. Everyone at the mandap thought it was heirloom 22K temple jewellery.",
                itemPurchased: "Devi Temple Matte Vanki Choker",
                verifiedBuyer: true,
            },
            {
                id: "rev-3",
                customerName: "Kavitha Ramesh",
                city: "Coimbatore",
                rating: 5,
                reviewText: "The WhatsApp concierge service sent me a 360-degree video of the Noor Victorian Chandbali before packing. Safe packaging and zero stone dislodgement. 10/10 experience!",
                itemPurchased: "Noor Victorian Moissanite Chandbali",
                verifiedBuyer: true,
            },
        ],
    },
    brandStory: {
        enabled: true,
        tagline: "THE ATELIER HERITAGE",
        heading: "preserving south indian & jaipur jewellery craftsmanship.",
        bodyText: "Niththigal Craftisans was born out of deep reverence for Indian heirloom jewellery. Rather than mass-produced imitation alloys, our artisans handcraft each piece using traditional red-copper & brass cores, 22K micro bullion gold plating, and hand-crimped uncut glass polki — making royal bridal magnificence accessible without compromise.",
        craftDetails: [
            "22K High-Micron Gold Immersion",
            "Hand-Crimped Foil-Backed Polki",
            "Chettinad Deep Relief Repoussé",
            "100% Skin-Friendly Hypoallergenic Cores",
        ],
        imageUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?q=80&w=1200&auto=format&fit=crop",
    },
    faq: {
        enabled: true,
        items: [
            {
                question: "How long does shipping take to my city?",
                answer: "Orders within Tamil Nadu, Bengaluru, and South India are dispatched via ST Courier / BlueDart within 24 hours and delivered in 2 business days. Rest of India deliveries take 3 to 4 business days with end-to-end SMS tracking.",
            },
            {
                question: "Is the jewellery water-resistant and skin-safe?",
                answer: "Yes. Every piece is crafted on hypoallergenic brass and copper alloys free of nickel and lead. With our multi-layer 22K micro gold plating, it resists tarnishing when kept away from direct perfume and moisture.",
            },
            {
                question: "Can I request live video inspection before dispatch?",
                answer: "Absolutely. You can tap our direct WhatsApp Concierge (+91 70921 22334) with your order ID, and our studio team will share high-resolution videos under natural lighting before dispatch.",
            },
            {
                question: "How do I care for my imitation polki & temple jewellery?",
                answer: "After each wear, wipe gently with a soft dry cloth to remove body oils. Always store in individual ziplock pouches inside an airtight container. Never spray perfumes directly on the jewellery.",
            },
        ],
    },
    stickyMobileBar: {
        enabled: true,
        showWhatsApp: true,
        showCart: true,
        whatsappMessagePreset: "Hi Niththigal Craftisans! I'm browsing your mobile store and want to inquire about custom orders ✨",
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
        instagram: "niththigal_craftisans",
        whatsappPhone: "+917092122334",
        supportEmail: "niththigal@gmail.com",
    },
    instagramFeed: {
        enabled: true,
        handle: "niththigal_craftisans",
        heading: "atelier community & reel drops",
        posts: [
            {
                id: "ig-1",
                url: "https://www.instagram.com/niththigal_craftisans/reel/Degqj0ppUd5/",
                imageUrl: "/instagram/post-1.jpg",
                caption: "Handcrafted neckwear & choker suite atelier showcase",
                type: "reel",
            },
            {
                id: "ig-2",
                url: "https://www.instagram.com/niththigal_craftisans/p/DegKGJZE8Bh/",
                imageUrl: "/instagram/post-2.jpg",
                caption: "Royal bridal kundan suite heirloom drop",
                type: "post",
            },
            {
                id: "ig-3",
                url: "https://www.instagram.com/niththigal_craftisans/reel/DefOz9GTBui/",
                imageUrl: "/instagram/post-3.jpg",
                caption: "Devi temple matte finish 22k gold craft reel",
                type: "reel",
            },
        ],
    },
};

function StorefrontContentInner() {
    const { addToCart } = useCart();
    const router = useRouter();
    const searchParams = useSearchParams();
    const selectedCategory = searchParams.get("category") || "all";
    const selectedSub = searchParams.get("sub") || "all";
    const searchQuery = searchParams.get("q") || "";

    const [products, setProducts] = useState<StorefrontProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [cmsContent, setCmsContent] = useState<StorefrontContent>(DEFAULT_CONTENT);
    const [addedId, setAddedId] = useState<string | null>(null);

    useEffect(() => {
        // Load CMS Content from ERP backend API to retrieve tenant admin binding
        fetch(getStorefrontApiUrl("/api/storefront/content"))
            .then((res) => res.json())
            .then((data) => {
                if (data && data.hero) {
                    setCmsContent(data);
                }
                const boundAdmin = data?.adminBinding?.boundAdminEmail;
                return getStorefrontCatalog(boundAdmin);
            })
            .catch(() => {
                return getStorefrontCatalog();
            })
            .then((data) => {
                if (data) setProducts(data);
            })
            .finally(() => setIsLoading(false));
    }, []);

    // Automatically scroll to catalog when category/sub filter or search changes
    useEffect(() => {
        if (selectedCategory !== "all" || selectedSub !== "all" || searchQuery.trim() !== "") {
            const el = document.getElementById("catalog-section");
            if (el) {
                el.scrollIntoView({ behavior: "smooth" });
            }
        }
    }, [selectedCategory, selectedSub, searchQuery]);

    // Extract active categories from inventory
    const inventoryCategories: InventoryCategoryNode[] = useMemo(() => {
        return extractInventoryCategories(products);
    }, [products]);

    // Current category node
    const currentCategoryNode = useMemo(() => {
        if (selectedCategory === "all") return null;
        return inventoryCategories.find(
            (c) => c.slug.toLowerCase() === selectedCategory.toLowerCase()
        );
    }, [inventoryCategories, selectedCategory]);

    // Filtered products list
    const filteredProducts = useMemo(() => {
        return products.filter((p) => {
            if (p.total_stock <= 0 && p.stock_status === "out_of_stock") return false;

            if (searchQuery.trim() !== "") {
                const q = searchQuery.toLowerCase();
                const matchName = p.name.toLowerCase().includes(q);
                const matchCategory = p.category?.toLowerCase().includes(q);
                const matchStyle = p.sub_style?.toLowerCase().includes(q);
                if (!matchName && !matchCategory && !matchStyle) return false;
            }

            if (selectedCategory !== "all") {
                const target = selectedCategory.toLowerCase();
                const catLower = p.category?.toLowerCase() || "";
                if (catLower !== target && !catLower.includes(target)) return false;
            }

            if (selectedSub !== "all") {
                const targetSub = selectedSub.toLowerCase();
                const subLower = p.sub_style?.toLowerCase() || "";
                if (subLower !== targetSub && !subLower.includes(targetSub)) return false;
            }

            return true;
        });
    }, [products, selectedCategory, selectedSub, searchQuery]);

    const handleQuickAdd = (product: StorefrontProduct, e: React.MouseEvent) => {
        e.stopPropagation();
        addToCart(product, 1);
        setAddedId(product.id);
        toast.success(`Added ${product.name} to bag`);
        setTimeout(() => setAddedId(null), 1500);
    };

    // Hero Slideshow derivation
    const slides: HeroSlide[] = useMemo(() => {
        if (Array.isArray(cmsContent.hero?.slides) && cmsContent.hero.slides.length > 0) {
            return cmsContent.hero.slides;
        }
        return [
            {
                id: "slide-default",
                title: cmsContent.hero?.brandName || "niththigal.",
                tagline: cmsContent.hero?.tagline || "craftisans",
                ctaText: cmsContent.hero?.ctaText || "shop now ↓",
                ctaLink: cmsContent.hero?.ctaLink || "#catalog-section",
                imageUrl: cmsContent.hero?.imageUrl || "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=2000&auto=format&fit=crop",
                mobileImageUrl: "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?q=80&w=900&auto=format&fit=crop",
                badgeText: "✨ SIGNATURE ATELIER",
                overlayOpacity: cmsContent.hero?.overlayOpacity ?? 0.25,
            },
        ];
    }, [cmsContent.hero]);

    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);

    const nextSlide = useCallback(() => {
        setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
    }, [slides.length]);

    const prevSlide = useCallback(() => {
        setCurrentSlideIndex((prev) => (prev - 1 + slides.length) % slides.length);
    }, [slides.length]);

    // Autoplay timer
    useEffect(() => {
        if (slides.length <= 1 || isPaused) return;
        const speed = cmsContent.hero?.autoplaySpeed && cmsContent.hero.autoplaySpeed >= 2000 ? cmsContent.hero.autoplaySpeed : 5000;
        const interval = setInterval(() => {
            nextSlide();
        }, speed);
        return () => clearInterval(interval);
    }, [slides.length, isPaused, nextSlide, cmsContent.hero?.autoplaySpeed]);

    const activeSlide = slides[currentSlideIndex] || slides[0];

    // Countdown calculation for active slide
    const [countdownFormatted, setCountdownFormatted] = useState<string | null>(null);
    useEffect(() => {
        if (!activeSlide.countdownTarget) {
            setCountdownFormatted(null);
            return;
        }
        const target = new Date(activeSlide.countdownTarget).getTime();
        if (isNaN(target)) {
            setCountdownFormatted(null);
            return;
        }
        const updateTimer = () => {
            const diff = target - Date.now();
            if (diff <= 0) {
                setCountdownFormatted("OFFER ENDED");
                return;
            }
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            setCountdownFormatted(
                `${String(hours).padStart(2, "0")}h : ${String(minutes).padStart(2, "0")}m : ${String(seconds).padStart(2, "0")}s`
            );
        };
        updateTimer();
        const timer = setInterval(updateTimer, 1000);
        return () => clearInterval(timer);
    }, [activeSlide.countdownTarget]);

    const isFiltered = selectedCategory !== "all" || selectedSub !== "all" || searchQuery.trim() !== "";

    const whatsappLink = `https://wa.me/${(cmsContent.socialAndContact.whatsappPhone || "+917092122334").replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
        cmsContent.stickyMobileBar?.whatsappMessagePreset ||
        "Hi Niththigal Craftisans, I'm reaching out from your website! I'd like to inquire about your jewellery collection ✨"
    )}`;

    const instagramLink = `https://www.instagram.com/${cmsContent.socialAndContact.instagram || "niththigal_craftisans"}/`;

    // Sort sections by sequence order
    const orderedSections = useMemo(() => {
        const list = cmsContent.layoutSections && cmsContent.layoutSections.length > 0
            ? [...cmsContent.layoutSections]
            : DEFAULT_CONTENT.layoutSections!;
        return list.sort((a, b) => a.order - b.order);
    }, [cmsContent.layoutSections]);

    // Handle Slide CTA Navigation
    const handleCtaClick = (e: React.MouseEvent<HTMLAnchorElement>, link: string) => {
        if (link.startsWith("#")) {
            e.preventDefault();
            const el = document.getElementById(link.replace("#", ""));
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (link.startsWith("/")) {
            e.preventDefault();
            router.push(link);
            const hashIdx = link.indexOf("#");
            if (hashIdx !== -1) {
                const hashId = link.substring(hashIdx + 1);
                setTimeout(() => {
                    const el = document.getElementById(hashId);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 100);
            }
        }
    };

    return (
        <div className="w-full relative">
            {/* If user filtered or searched: always render hero + filtered catalog */}
            {isFiltered ? (
                <div>
                    {/* Render Compact Hero */}
                    <section
                        className="relative w-full h-[55vh] min-h-[420px] flex flex-col justify-end overflow-hidden bg-black text-white"
                        onMouseEnter={() => setIsPaused(true)}
                        onMouseLeave={() => setIsPaused(false)}
                    >
                        {/* Slide Crossfade */}
                        {slides.map((slide, idx) => {
                            const isCurrent = idx === currentSlideIndex;
                            return (
                                <div
                                    key={slide.id || idx}
                                    className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
                                        isCurrent ? "opacity-100 z-10" : "opacity-0 pointer-events-none z-0"
                                    }`}
                                >
                                    <div
                                        className="hidden sm:block absolute inset-0 bg-cover bg-center"
                                        style={{ backgroundImage: `url('${slide.imageUrl}')` }}
                                    />
                                    <div
                                        className="sm:hidden absolute inset-0 bg-cover bg-center"
                                        style={{ backgroundImage: `url('${slide.mobileImageUrl || slide.imageUrl}')` }}
                                    />
                                    <div
                                        className="absolute inset-0 bg-black transition-opacity"
                                        style={{ opacity: slide.overlayOpacity }}
                                    />
                                </div>
                            );
                        })}

                        <div className="relative z-20 w-full max-w-[1440px] mx-auto px-6 sm:px-12 pb-8 flex flex-col items-start text-left">
                            <h1
                                className="text-4xl sm:text-6xl font-black lowercase tracking-[-0.05em] text-white select-none"
                                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                            >
                                {activeSlide.title || "niththigal."}
                            </h1>
                            {activeSlide.tagline && (
                                <p className="text-white/80 text-xs sm:text-sm font-medium tracking-widest uppercase mt-2">
                                    {activeSlide.tagline}
                                </p>
                            )}
                        </div>
                    </section>

                    {/* Filtered Search / Category Catalog View */}
                    <div id="catalog-section" className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 space-y-8 scroll-mt-28">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 pb-4">
                            <div>
                                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-black capitalize">
                                    {selectedCategory !== "all" ? selectedCategory : "All Jewellery"}
                                    {selectedSub !== "all" && <span className="text-neutral-400 font-normal"> · {selectedSub}</span>}
                                    {searchQuery ? ` · Search: "${searchQuery}"` : ""}
                                </h2>
                                <p className="text-xs uppercase tracking-widest text-neutral-400 font-mono mt-0.5">
                                    {filteredProducts.length} {filteredProducts.length === 1 ? "piece" : "pieces"} available
                                </p>
                            </div>
                            <button
                                onClick={() => router.push("/#catalog-section")}
                                className="text-xs uppercase tracking-wider text-neutral-400 hover:text-black underline cursor-pointer self-start sm:self-auto"
                            >
                                Clear filter
                            </button>
                        </div>

                        {/* Filtered Product Grid */}
                        {filteredProducts.length === 0 ? (
                            <div className="py-20 text-center space-y-3">
                                <p className="text-sm uppercase tracking-widest text-neutral-400">
                                    No items currently in stock for this selection.
                                </p>
                                <button
                                    onClick={() => router.push("/")}
                                    className="text-xs font-semibold uppercase tracking-wider underline text-black cursor-pointer"
                                >
                                    Browse all in-stock jewellery
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-12">
                                {filteredProducts.map((product) => (
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        onQuickAdd={handleQuickAdd}
                                        isAdded={addedId === product.id}
                                        customBadge={cmsContent.merchandising?.customProductBadges?.[product.sku]}
                                        lowStockThreshold={cmsContent.merchandising?.autoLowStockThreshold ?? 3}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Default Homepage: Modular Dynamic Layout Sequence */
                orderedSections.map((sec) => {
                    if (!sec.enabled) return null;

                    // 1. HERO SLIDESHOW BLOCK
                    if (sec.id === "hero_slideshow") {
                        return (
                            <section
                                key={sec.id}
                                className="relative w-full h-[85vh] min-h-[580px] max-h-[880px] flex flex-col justify-end overflow-hidden bg-black text-white"
                                onMouseEnter={() => setIsPaused(true)}
                                onMouseLeave={() => setIsPaused(false)}
                            >
                                {/* Slide Crossfade Images */}
                                {slides.map((slide, idx) => {
                                    const isCurrent = idx === currentSlideIndex;
                                    return (
                                        <div
                                            key={slide.id || idx}
                                            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
                                                isCurrent ? "opacity-100 z-10" : "opacity-0 pointer-events-none z-0"
                                            }`}
                                        >
                                            {/* Desktop Image */}
                                            <div
                                                className="hidden sm:block absolute inset-0 bg-cover bg-center"
                                                style={{ backgroundImage: `url('${slide.imageUrl}')` }}
                                            />
                                            {/* Mobile Vertical Crop */}
                                            <div
                                                className="sm:hidden absolute inset-0 bg-cover bg-center"
                                                style={{ backgroundImage: `url('${slide.mobileImageUrl || slide.imageUrl}')` }}
                                            />
                                            {/* Dark Minimal Vignette */}
                                            <div
                                                className="absolute inset-0 bg-black transition-opacity"
                                                style={{ opacity: slide.overlayOpacity }}
                                            />
                                        </div>
                                    );
                                })}

                                <div className="relative z-20 pt-10" />

                                {/* Left Aligned & Left Justified Wordmark, Subtitle & Custom CTA */}
                                <div className="relative z-20 w-full max-w-[1440px] mx-auto px-6 sm:px-12 flex flex-col items-start text-left">
                                    <div key={currentSlideIndex} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                                        {/* Optional Slide Badge & Countdown Timer */}
                                        <div className="flex flex-wrap items-center gap-2 mb-3">
                                            {activeSlide.badgeText && (
                                                <span className="text-[10px] font-mono tracking-widest px-2.5 py-1 rounded bg-white/20 backdrop-blur-md text-white border border-white/20 uppercase font-medium">
                                                    {activeSlide.badgeText}
                                                </span>
                                            )}
                                            {countdownFormatted && (
                                                <span className="text-[10px] font-mono tracking-wider px-2.5 py-1 rounded bg-black/60 backdrop-blur-md text-amber-300 border border-amber-300/30 flex items-center gap-1.5">
                                                    <Clock className="w-3 h-3" />
                                                    {countdownFormatted}
                                                </span>
                                            )}
                                        </div>

                                        <h1
                                            className="text-5xl sm:text-7xl md:text-8xl font-black lowercase tracking-[-0.05em] text-white drop-shadow-sm select-none"
                                            style={{ fontFamily: "var(--font-heading)" }}
                                        >
                                            {activeSlide.title || "niththigal."}
                                        </h1>

                                        {activeSlide.tagline && (
                                            <p className="text-white/80 text-xs sm:text-sm font-medium tracking-widest uppercase mt-3">
                                                {activeSlide.tagline}
                                            </p>
                                        )}

                                        {/* CTA Link Target */}
                                        <div className="mt-6 pt-2">
                                            {activeSlide.ctaStyle === "box" ? (
                                                <a
                                                    href={activeSlide.ctaLink || "#catalog-section"}
                                                    onClick={(e) => handleCtaClick(e, activeSlide.ctaLink || "#catalog-section")}
                                                    className="py-2.5 px-6 bg-white text-black text-xs sm:text-sm font-bold tracking-widest lowercase hover:bg-neutral-100 transition-[background-color,transform] duration-160 ease-emil-out active:scale-96 inline-flex items-center gap-2 rounded-xs shadow-md"
                                                >
                                                    <span>{activeSlide.ctaText || "shop now ↓"}</span>
                                                    <ArrowDown className="w-4 h-4" />
                                                </a>
                                            ) : (
                                                <a
                                                    href={activeSlide.ctaLink || "#catalog-section"}
                                                    onClick={(e) => handleCtaClick(e, activeSlide.ctaLink || "#catalog-section")}
                                                    className="group text-white text-xs sm:text-sm font-medium tracking-widest lowercase hover:opacity-85 transition-[opacity,transform] duration-160 ease-emil-out active:scale-96 inline-flex items-center gap-2 underline decoration-1 underline-offset-6 cursor-pointer"
                                                >
                                                    <span>{activeSlide.ctaText || "shop now ↓"}</span>
                                                    <ArrowDown className="w-4 h-4 transition-transform duration-200 ease-emil-out group-hover:translate-y-1" />
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Slideshow Controls */}
                                {slides.length > 1 ? (
                                    <div className="relative z-20 w-full max-w-[1440px] mx-auto px-6 sm:px-12 pb-8 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {slides.map((_, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => setCurrentSlideIndex(idx)}
                                                    className={`h-1.5 transition-[width,background-color] duration-300 ease-emil-out rounded-full cursor-pointer ${
                                                        idx === currentSlideIndex
                                                            ? "w-8 bg-white"
                                                            : "w-2.5 bg-white/40 hover:bg-white/70 active:scale-95"
                                                    }`}
                                                    aria-label={`Go to slide ${idx + 1}`}
                                                />
                                            ))}
                                            <span className="text-[11px] font-mono text-white/70 ml-2 tracking-wider select-none">
                                                0{currentSlideIndex + 1} / 0{slides.length}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={prevSlide}
                                                className="p-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-92 rounded-full transition-[background-color,color,transform] duration-140 ease-emil-out cursor-pointer"
                                                aria-label="Previous slide"
                                            >
                                                <ChevronLeft className="w-5 h-5 stroke-[1.75]" />
                                            </button>
                                            <button
                                                onClick={nextSlide}
                                                className="p-2 text-white/70 hover:text-white hover:bg-white/10 active:scale-92 rounded-full transition-[background-color,color,transform] duration-140 ease-emil-out cursor-pointer"
                                                aria-label="Next slide"
                                            >
                                                <ChevronRight className="w-5 h-5 stroke-[1.75]" />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="relative z-20 pb-12" />
                                )}
                            </section>
                        );
                    }

                    // 2. TRUST GUARANTEE STRIP BLOCK
                    if (sec.id === "trust_strip") {
                        return <TrustStrip key={sec.id} items={cmsContent.trustStrip?.items} />;
                    }

                    // 3. PRODUCT VITRINES & CATALOG GRID BLOCK
                    if (sec.id === "category_vitrines") {
                        return (
                            <div key={sec.id} id="catalog-section" className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12 space-y-16 scroll-mt-28">
                                {inventoryCategories.map((cat) => {
                                    // Filter products for this vitrine category
                                    const matchingProducts = products.filter(
                                        (p) =>
                                            p.category?.toLowerCase() === cat.slug.toLowerCase() &&
                                            p.total_stock > 0 &&
                                            p.stock_status !== "out_of_stock"
                                    );

                                    if (matchingProducts.length === 0) return null;

                                    // Visual Merchandising: Pinned products sorted first!
                                    const pinnedSkus = cmsContent.merchandising?.pinnedProductSkus || [];
                                    const sortedProducts = [...matchingProducts].sort((a, b) => {
                                        const aPinned = pinnedSkus.includes(a.sku);
                                        const bPinned = pinnedSkus.includes(b.sku);
                                        if (aPinned && !bPinned) return -1;
                                        if (!aPinned && bPinned) return 1;
                                        return 0;
                                    }).slice(0, 4);

                                    return (
                                        <section key={cat.slug} className="space-y-6 sm:space-y-8">
                                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-neutral-100 pb-3">
                                                <div className="space-y-1">
                                                    <h2 className="text-lg sm:text-xl font-bold tracking-tight text-black capitalize">
                                                        {cat.name}
                                                    </h2>
                                                    {cat.subcategories.length > 0 && (
                                                        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                                                            <span>In-stock styles:</span>
                                                            {cat.subcategories.map((sub, sIdx) => (
                                                                <span key={sub.slug} className="text-neutral-600">
                                                                    {sub.name} ({sub.count}){sIdx < cat.subcategories.length - 1 ? " • " : ""}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => router.push(`/?category=${encodeURIComponent(cat.slug)}`)}
                                                    className="text-xs uppercase tracking-widest text-neutral-400 hover:text-black transition underline decoration-1 underline-offset-4 cursor-pointer self-start sm:self-auto"
                                                >
                                                    View all {cat.totalCount} {cat.name} →
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-12">
                                                {sortedProducts.map((product) => (
                                                    <ProductCard
                                                        key={product.id}
                                                        product={product}
                                                        onQuickAdd={handleQuickAdd}
                                                        isAdded={addedId === product.id}
                                                        isPinned={pinnedSkus.includes(product.sku)}
                                                        customBadge={cmsContent.merchandising?.customProductBadges?.[product.sku]}
                                                        lowStockThreshold={cmsContent.merchandising?.autoLowStockThreshold ?? 3}
                                                    />
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                        );
                    }

                    // 4. FLASH PROMO BANNER BLOCK
                    if (sec.id === "flash_promo") {
                        if (!cmsContent.promoBanner.enabled) return null;
                        return (
                            <section key={sec.id} id="promo" className="border-t border-b border-neutral-100 bg-neutral-50 py-10 px-4 text-center scroll-mt-24">
                                <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-xs tracking-widest uppercase text-neutral-800">
                                    <span className="font-semibold">{cmsContent.promoBanner.description}</span>
                                    <span className="hidden sm:inline text-neutral-300">•</span>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(cmsContent.promoBanner.code);
                                            toast.success(`Copied coupon ${cmsContent.promoBanner.code}`);
                                        }}
                                        className="px-3 py-1 bg-black text-white text-[11px] font-bold rounded-xs tracking-widest uppercase hover:bg-neutral-800 transition cursor-pointer"
                                    >
                                        USE CODE: {cmsContent.promoBanner.code}
                                    </button>
                                </div>
                            </section>
                        );
                    }

                    // 5. CUSTOMER REVIEWS BLOCK
                    if (sec.id === "customer_reviews") {
                        if (!cmsContent.reviews?.enabled) return null;
                        return (
                            <ReviewsCarousel
                                key={sec.id}
                                heading={cmsContent.reviews.heading}
                                subheading={cmsContent.reviews.subheading}
                                items={cmsContent.reviews.items}
                            />
                        );
                    }

                    // 6. INSTAGRAM SHOWCASE BLOCK
                    if (sec.id === "instagram_feed") {
                        const igFeed = cmsContent.instagramFeed || DEFAULT_CONTENT.instagramFeed;
                        if (igFeed && !igFeed.enabled) return null;
                        const igPosts = igFeed?.posts && igFeed.posts.length > 0 ? igFeed.posts : (DEFAULT_CONTENT.instagramFeed?.posts || []);
                        const handle = igFeed?.handle || cmsContent.socialAndContact?.instagram || "niththigal_craftisans";

                        return (
                            <section key={sec.id} className="py-16 border-b border-neutral-200 bg-white">
                                <div className="max-w-[1440px] mx-auto px-6 sm:px-12 space-y-8">
                                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                                        <div className="space-y-1">
                                            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 flex items-center gap-1.5">
                                                <Instagram className="w-3.5 h-3.5" />
                                                {igFeed?.heading || "Atelier Community & Reel Drops"}
                                            </span>
                                            <h3 className="text-2xl font-extrabold tracking-tight lowercase text-black">
                                                @{handle}
                                            </h3>
                                        </div>
                                        <a
                                            href={`https://www.instagram.com/${handle}/`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs uppercase tracking-widest font-semibold text-black underline decoration-1 underline-offset-4 hover:text-neutral-600 transition-colors"
                                        >
                                            Follow on Instagram ↗
                                        </a>
                                    </div>

                                    {/* Actual Linked Account's Latest 3 Posts */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                                        {igPosts.slice(0, 3).map((post) => (
                                            <a
                                                key={post.id}
                                                href={post.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="group block relative rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200 shadow-xs hover:shadow-md transition-all duration-300"
                                            >
                                                <div className="relative aspect-square w-full overflow-hidden bg-neutral-900">
                                                    <img
                                                        src={post.imageUrl}
                                                        alt={post.caption}
                                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                    />
                                                    {/* Badge: Reel vs Post */}
                                                    <div className="absolute top-3 right-3 bg-black/75 backdrop-blur-xs text-white text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 border border-white/20">
                                                        <Instagram className="w-3 h-3 text-pink-400" />
                                                        <span>{post.type}</span>
                                                    </div>
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4 text-center text-white">
                                                        <Instagram className="w-7 h-7 mb-2" />
                                                        <p className="text-xs font-semibold tracking-wider uppercase">Open On Instagram ↗</p>
                                                    </div>
                                                </div>
                                                <div className="p-4 bg-white">
                                                    <p className="text-xs text-neutral-800 line-clamp-2 leading-relaxed font-sans font-medium">
                                                        {post.caption}
                                                    </p>
                                                    <span className="text-[10px] font-mono text-neutral-400 mt-2 block tracking-wider uppercase">
                                                        Watch on Instagram ↗
                                                    </span>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        );
                    }

                    // 7. BRAND STORY BLOCK
                    if (sec.id === "brand_story") {
                        if (!cmsContent.brandStory?.enabled) return null;
                        return (
                            <BrandStory
                                key={sec.id}
                                tagline={cmsContent.brandStory.tagline}
                                heading={cmsContent.brandStory.heading}
                                bodyText={cmsContent.brandStory.bodyText}
                                craftDetails={cmsContent.brandStory.craftDetails}
                                imageUrl={cmsContent.brandStory.imageUrl}
                            />
                        );
                    }

                    // 8. FAQ ACCORDION BLOCK
                    if (sec.id === "faq_accordion") {
                        if (!cmsContent.faq?.enabled) return null;
                        return <FaqAccordion key={sec.id} items={cmsContent.faq.items} />;
                    }

                    return null;
                })
            )}

            {/* Sticky Mobile Commerce Bar */}
            <StickyMobileBar
                enabled={cmsContent.stickyMobileBar?.enabled}
                whatsappPhone={cmsContent.socialAndContact?.whatsappPhone}
                whatsappMessage={cmsContent.stickyMobileBar?.whatsappMessagePreset}
            />

            {/* Desktop Floating WhatsApp Button */}
            <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex fixed bottom-6 right-6 z-40 bg-emerald-600 hover:bg-emerald-700 text-white p-3.5 rounded-full shadow-2xl items-center gap-2 transition-all hover:scale-105 active:scale-95 group"
                title="Direct WhatsApp Message"
                aria-label="Direct WhatsApp Message"
            >
                <MessageCircle className="w-5 h-5 fill-white text-emerald-600" />
                <span className="text-xs font-semibold tracking-wider uppercase pr-1">
                    WhatsApp
                </span>
            </a>
        </div>
    );
}

export default function StorefrontHomePage() {
    return (
        <Suspense fallback={<div className="h-screen flex items-center justify-center text-xs tracking-widest uppercase text-neutral-400">Loading catalog...</div>}>
            <StorefrontContentInner />
        </Suspense>
    );
}

/**
 * Enhanced Escape-Closet Product Card with Visual Merchandising Badges & Pinned Tag
 */
function ProductCard({
    product,
    onQuickAdd,
    isAdded,
    isPinned,
    customBadge,
    lowStockThreshold = 3,
}: {
    product: StorefrontProduct;
    onQuickAdd: (p: StorefrontProduct, e: React.MouseEvent) => void;
    isAdded: boolean;
    isPinned?: boolean;
    customBadge?: string;
    lowStockThreshold?: number;
}) {
    return (
        <div className="group flex flex-col cursor-pointer select-none transition-transform duration-200 ease-emil-out hover:-translate-y-1">
            {/* Visual Media Container */}
            <div className="relative aspect-3/4 sm:aspect-4/5 w-full bg-[#f9f9f9] overflow-hidden rounded-xs border border-neutral-100/60 shadow-2xs">
                {product.image_url ? (
                    <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-cover object-center transition-transform duration-500 ease-emil-out group-hover:scale-104 gpu-layer"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-300 text-xs">
                        No Image
                    </div>
                )}

                {/* Top Left Badges: Custom Merchandising Badge, Low Stock or Pinned */}
                <div className="absolute top-2 left-2 flex flex-col gap-1 items-start z-10 pointer-events-none">
                    {customBadge && (
                        <span className="bg-black text-white text-[9px] uppercase tracking-wider px-2 py-0.5 font-bold rounded-2xs shadow-xs">
                            {customBadge}
                        </span>
                    )}
                    {isPinned && !customBadge && (
                        <span className="bg-amber-600 text-white text-[9px] uppercase tracking-wider px-2 py-0.5 font-semibold rounded-2xs flex items-center gap-1 shadow-xs">
                            <Pin className="w-2.5 h-2.5" />
                            FEATURED
                        </span>
                    )}
                    {product.total_stock <= lowStockThreshold && product.total_stock > 0 && (
                        <span className="bg-neutral-900/90 text-white text-[9px] uppercase tracking-wider px-2 py-0.5 font-medium rounded-2xs">
                            Only {product.total_stock} Left
                        </span>
                    )}
                </div>

                {/* Floating Quick Add Trigger (Emil Kowalski: tactile active response & spring pulse on success) */}
                <button
                    onClick={(e) => onQuickAdd(product, e)}
                    className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 w-9 h-9 rounded-full bg-white text-black shadow-md flex items-center justify-center opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-[opacity,transform] duration-180 ease-emil-out scale-95 sm:group-hover:scale-100 active:scale-90 cursor-pointer z-10"
                    aria-label="Add to bag"
                    title="Quick add to bag"
                >
                    {isAdded ? (
                        <span key="added-check" className="animate-in zoom-in-75 duration-150 flex items-center justify-center">
                            <Check className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
                        </span>
                    ) : (
                        <Plus className="w-4 h-4 stroke-[2]" />
                    )}
                </button>
            </div>

            {/* Minimalist 2-line Text Detail */}
            <div className="pt-3 space-y-1">
                <h3 className="text-xs sm:text-[13px] text-neutral-800 font-medium tracking-tight line-clamp-1 group-hover:text-black transition-colors duration-140">
                    {product.name}
                </h3>
                <div className="flex items-center gap-2 text-xs sm:text-[13px]">
                    <span className="font-semibold text-black">
                        Rs. {product.website_price.toLocaleString("en-IN")}
                    </span>
                    {product.mrp > product.website_price && (
                        <span className="text-neutral-400 line-through text-[11px] sm:text-xs">
                            Rs. {product.mrp.toLocaleString("en-IN")}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
