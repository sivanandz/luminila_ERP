/**
 * Niththigal editorial content — the CMS contract for the storefront.
 *
 * The ERP's /api/storefront/content route serves this block as `niththigal`.
 * Every field is optional in the API payload; `mergeNiththigal` overlays the
 * saved payload on these defaults so a partially-saved record can never blank
 * the page. The same schema is mirrored in the ERP CMS editor.
 *
 * This module is deliberately server-safe (no "use client", no React): the
 * static export reads the same defaults, section map and merge at build time.
 * Client code imports it through src/lib/niththigal-content.tsx.
 */

export type NtSectionId =
    | "hero"
    | "promise"
    | "collection"
    | "promo"
    | "story"
    | "benefits"
    | "testimonials"
    | "instagram"
    | "pricing"
    | "faq"
    | "finalCta";

export interface NtSection {
    id: NtSectionId;
    label: string;
    enabled: boolean;
    order: number;
    /** Transparent padding outside the section, in CSS px. */
    spaceBefore: number;
    spaceAfter: number;
}

export interface NtNavItem {
    label: string;
    href: string;
    filter?: string;
}

export type NtFooterAction = "none" | "saved" | "shipping" | "privacy" | "care" | "search";

export interface NtFooterLink {
    label: string;
    href: string;
    action: NtFooterAction;
    filter?: string;
}

export interface NtFooterColumn {
    title: string;
    links: NtFooterLink[];
}

export interface NtHeroSlide {
    id: string;
    imageUrl: string;
    imageAlt: string;
    captionLabel: string;
    captionText: string;
    tagTitle: string;
    tagSub: string;
    tagHref: string;
    verticalCaption: string;
}

export interface NtPromiseItem {
    icon: "heritage" | "moments" | "gift";
    text: string;
}

export interface NtBenefitItem {
    icon: "heritage" | "sparkle" | "gift";
    title: string;
    text: string;
}

export interface NtTestimonial {
    quote: string;
    authorLabel: string;
    authorTitle: string;
    avatar: string;
}

export interface NtPricingItem {
    icon: "tag" | "gift" | "truck";
    title: string;
    text: string;
}

export interface NtInstagramPost {
    id: string;
    imageUrl: string;
    url: string;
    caption: string;
    type: "post" | "reel";
}

export interface NtInfoPage {
    title: string;
    body: string;
    cta: string;
}

export interface NiththigalContent {
    enabled: boolean;
    brand: {
        name: string;
        tagline: string;
        nav: NtNavItem[];
        mobileNav: NtNavItem[];
        /** Data URLs (or absolute URLs) for the uploaded brand assets. */
        logoUrl: string;
        wordmarkUrl: string;
        lockupUrl: string;
        logoMode: "auto" | "logo" | "wordmark" | "both" | "lockup";
        logoAlt: string;
        wordmarkAlt: string;
        lockupAlt: string;
        showTagline: boolean;
        logoNaturalWidth: number;
        logoNaturalHeight: number;
        wordmarkNaturalWidth: number;
        wordmarkNaturalHeight: number;
        lockupNaturalWidth: number;
        lockupNaturalHeight: number;
    };
    announcement: {
        text: string;
        star: string;
        extra: string;
    };
    ui: {
        searchTitle: string;
        searchPlaceholder: string;
        searchEmpty: string;
        savedTitle: string;
        savedEmpty: string;
        cartEyebrow: string;
        cartTitle: string;
        cartEmptyTitle: string;
        cartEmptyText: string;
        cartEmptyCta: string;
        cartSubtotal: string;
        cartCheckout: string;
        cartNote: string;
        productAdd: string;
        productAdded: string;
        productSizeLabel: string;
        productOptionLabel: string;
        productNote: string;
        closeLabel: string;
    };
    contact: {
        whatsappPhone: string;
        supportEmail: string;
        instagramUrl: string;
    };
    hero: {
        eyebrow: string;
        titleLine1: string;
        titleLine2Prefix: string;
        titleEmphasis: string;
        description: string;
        primaryCta: string;
        primaryHref: string;
        secondaryCta: string;
        secondaryHref: string;
        noteTitle: string;
        noteText: string;
        imageUrl: string;
        imageAlt: string;
        imageCaptionLabel: string;
        imageCaptionText: string;
        imageTagTitle: string;
        imageTagSub: string;
        imageTagHref: string;
        verticalCaption: string;
        bottomText: string;
        scrollLabel: string;
        slideshow: {
            enabled: boolean;
            intervalSeconds: number;
        };
        slides: NtHeroSlide[];
    };
    promise: {
        items: NtPromiseItem[];
    };
    collection: {
        eyebrow: string;
        headingLine1: string;
        headingEmphasis: string;
        supportingLine1: string;
        supportingLine2: string;
        allLabel: string;
        countSingular: string;
        countPlural: string;
        footLeft: string;
        footRightPrefix: string;
        minPriceFallback: string;
        productBadgeFallback: string;
        productTypeSuffix: string;
        quickViewLabel: string;
        addLabel: string;
        soldOutLabel: string;
        loadingLabel: string;
        emptyLabel: string;
        priceUnitPair: string;
        priceUnitSingle: string;
    };
    promo: {
        enabled: boolean;
        eyebrow: string;
        headingPlain: string;
        headingEmphasis: string;
        code: string;
        discount: string;
        description: string;
        ctaLabel: string;
        copiedLabel: string;
        note: string;
    };
    story: {
        eyebrow: string;
        headingPlain: string;
        headingEmphasis: string;
        paragraph1: string;
        paragraph2: string;
        cta: string;
        ctaHref: string;
        signature: string;
        imageUrl: string;
        imageAlt: string;
        stampTop: string;
        stampBottom: string;
        photoCaption: string;
    };
    benefits: {
        eyebrow: string;
        headingPlain: string;
        headingEmphasis: string;
        items: NtBenefitItem[];
    };
    testimonials: {
        eyebrow: string;
        headingPlain: string;
        headingEmphasis: string;
        stars: string;
        noteLine: string;
        note: string;
        items: NtTestimonial[];
    };
    instagram: {
        enabled: boolean;
        eyebrow: string;
        heading: string;
        handle: string;
        ctaLabel: string;
        ctaHref: string;
        posts: NtInstagramPost[];
    };
    pricing: {
        eyebrow: string;
        headingPlain: string;
        headingEmphasis: string;
        text: string;
        anchorLabel: string;
        anchorNote: string;
        currency: string;
        priceOverride: string;
        cta: string;
        ctaHref: string;
        items: NtPricingItem[];
        footNote: string;
    };
    faq: {
        eyebrow: string;
        headingPlain: string;
        headingEmphasis: string;
        text: string;
        decoration: string;
        items: { question: string; answer: string }[];
    };
    finalCta: {
        eyebrow: string;
        headingPlain: string;
        headingEmphasis: string;
        text: string;
        cta: string;
        ctaHref: string;
        decoration: string;
    };
    footer: {
        descriptionLine1: string;
        descriptionLine2: string;
        location: string;
        columns: NtFooterColumn[];
        savedLabel: string;
        noteTop: string;
        noteLine1: string;
        noteLine2: string;
        noteEmphasis: string;
        noteAccent: string;
        bottomLeft: string;
        bottomRight: string;
        bottomRightAccent: string;
        legalNote: string;
    };
    info: {
        shipping: NtInfoPage;
        privacy: NtInfoPage;
        care: NtInfoPage;
    };
    theme: {
        colors: {
            cream: string;
            paper: string;
            green: string;
            greenDeep: string;
            ink: string;
            muted: string;
            gold: string;
            line: string;
        };
        typography: {
            headingFont: string;
            bodyFont: string;
        };
    };
    sections: NtSection[];
}

export const NITHTHIGAL_SECTION_LABELS: Record<NtSectionId, string> = {
    hero: "Editorial Hero",
    promise: "Promise / Social Proof Strip",
    collection: "Product Showcase",
    promo: "Promo & Coupon Band",
    story: "Brand Story",
    benefits: "Benefits",
    testimonials: "Community Stories",
    instagram: "Instagram Feed",
    pricing: "Retail Price Story",
    faq: "FAQ",
    finalCta: "Final CTA",
};

export const NITHTHIGAL_DEFAULT_SECTIONS: NtSection[] = ([
    { id: "hero", label: NITHTHIGAL_SECTION_LABELS.hero, enabled: true, order: 1 },
    { id: "promise", label: NITHTHIGAL_SECTION_LABELS.promise, enabled: true, order: 2 },
    { id: "collection", label: NITHTHIGAL_SECTION_LABELS.collection, enabled: true, order: 3 },
    { id: "promo", label: NITHTHIGAL_SECTION_LABELS.promo, enabled: true, order: 4 },
    { id: "story", label: NITHTHIGAL_SECTION_LABELS.story, enabled: true, order: 5 },
    { id: "benefits", label: NITHTHIGAL_SECTION_LABELS.benefits, enabled: true, order: 6 },
    { id: "testimonials", label: NITHTHIGAL_SECTION_LABELS.testimonials, enabled: true, order: 7 },
    { id: "instagram", label: NITHTHIGAL_SECTION_LABELS.instagram, enabled: true, order: 8 },
    { id: "pricing", label: NITHTHIGAL_SECTION_LABELS.pricing, enabled: true, order: 9 },
    { id: "faq", label: NITHTHIGAL_SECTION_LABELS.faq, enabled: true, order: 10 },
    { id: "finalCta", label: NITHTHIGAL_SECTION_LABELS.finalCta, enabled: true, order: 11 },
] as Omit<NtSection, "spaceBefore" | "spaceAfter">[]).map((section) => ({
    ...section,
    // The story image extends ~53 px above its band for the parallax; this
    // default leaves a clear 43 px gap under the promo card.
    spaceBefore: section.id === "story" ? 96 : 0,
    spaceAfter: 0,
}));

export const NITHTHIGAL_DEFAULTS: NiththigalContent = {
    enabled: true,
    brand: {
        name: "Niththigal",
        tagline: "Jewellery, with soul",
        nav: [
            { label: "Shop all", href: "#collection", filter: "All pieces" },
            { label: "Earrings", href: "#collection", filter: "Earrings" },
            { label: "Necklaces", href: "#collection", filter: "Necklaces" },
            { label: "Our story", href: "#story" },
        ],
        mobileNav: [
            { label: "Shop the collection", href: "#collection", filter: "All pieces" },
            { label: "Our story", href: "#story" },
            { label: "The Niththigal feeling", href: "#love" },
            { label: "Need a little help?", href: "#faq" },
        ],
        logoUrl: "",
        wordmarkUrl: "",
        lockupUrl: "",
        logoMode: "auto",
        logoAlt: "Niththigal",
        wordmarkAlt: "Niththigal",
        lockupAlt: "Niththigal",
        showTagline: true,
        logoNaturalWidth: 0,
        logoNaturalHeight: 0,
        wordmarkNaturalWidth: 0,
        wordmarkNaturalHeight: 0,
        lockupNaturalWidth: 0,
        lockupNaturalHeight: 0,
    },
    announcement: {
        text: "Rooted in the South. Made for your kind of beautiful.",
        star: "✧",
        extra: "Discover the new collection",
    },
    ui: {
        searchTitle: "Find your little joy.",
        searchPlaceholder: "Try “jhumka” or “bangles”…",
        searchEmpty: "No pieces found just yet. Try “temple”, “earrings” or “gold”.",
        savedTitle: "Your little loves.",
        savedEmpty: "Your wishlist is waiting. Tap the heart on any piece to save it here.",
        cartEyebrow: "A LITTLE BAG OF JOY",
        cartTitle: "Your favourites, together.",
        cartEmptyTitle: "A little room for something lovely.",
        cartEmptyText: "Your bag is waiting for its first favourite.",
        cartEmptyCta: "Explore the collection",
        cartSubtotal: "Subtotal",
        cartCheckout: "Review your bag",
        cartNote: "Taxes included. Delivery is calculated at checkout.",
        productAdd: "Add a little joy to your bag",
        productAdded: "Added to your bag ✓",
        productSizeLabel: "Your bangle size",
        productOptionLabel: "Choose your option",
        productNote: "Live price and stock. Every piece ships in a keepsake pouch with care instructions.",
        closeLabel: "Close",
    },
    contact: {
        whatsappPhone: "",
        supportEmail: "",
        instagramUrl: "",
    },
    hero: {
        eyebrow: "THE EVERYDAY HEIRLOOM EDIT",
        titleLine1: "A little tradition.",
        titleLine2Prefix: "A lot of",
        titleEmphasis: "you.",
        description:
            "The beauty you grew up with. The way you wear it now. Discover South Indian-inspired imitation jewellery for life's big moments—and the little ones in between.",
        primaryCta: "Find your forever favourites",
        primaryHref: "#collection",
        secondaryCta: "Our story",
        secondaryHref: "#story",
        noteTitle: "Precious in feeling. Not in price.",
        noteText: "Thoughtful details. Timeless South Indian soul.",
        imageUrl: "/niththigal/hero.webp",
        imageAlt: "A woman in a deep green sari wearing gold-tone jhumkas and a traditional necklace",
        imageCaptionLabel: "THE NITHTHIGAL WOMAN",
        imageCaptionText: "Tradition looks good on you.",
        imageTagTitle: "A new kind of timeless",
        imageTagSub: "EXPLORE THE COLLECTION",
        imageTagHref: "#collection",
        verticalCaption: "INSPIRED BY OUR ROOTS. STYLED BY YOU.",
        bottomText: "IMPERFECT MOMENTS. PERFECT FINISHING TOUCH.",
        scrollLabel: "Scroll to collection",
        slideshow: {
            enabled: false,
            intervalSeconds: 6,
        },
        slides: [],
    },
    promise: {
        items: [
            { icon: "heritage", text: "Heritage-inspired details" },
            { icon: "moments", text: "Made for your many moments" },
            { icon: "gift", text: "A little joy, ready to gift" },
        ],
    },
    collection: {
        eyebrow: "YOUR NEXT SIGNATURE PIECE",
        headingLine1: "Small details.",
        headingEmphasis: "Big feelings.",
        supportingLine1: "For the saree days, the coffee dates,",
        supportingLine2: "and every version of you.",
        allLabel: "All pieces",
        countSingular: "{count} little reason to shine",
        countPlural: "{count} little reasons to shine",
        footLeft: "Beautiful doesn't have to be out of reach.",
        footRightPrefix: "Considered pieces, starting at",
        minPriceFallback: "—",
        productBadgeFallback: "THE HERITAGE EDIT",
        productTypeSuffix: "THE HERITAGE EDIT",
        quickViewLabel: "A closer look",
        addLabel: "Add to bag",
        soldOutLabel: "Sold out",
        loadingLabel: "Loading the collection…",
        emptyLabel: "No pieces in this category yet — check back soon.",
        priceUnitPair: "for the pair",
        priceUnitSingle: "a little luxury",
    },
    promo: {
        enabled: true,
        eyebrow: "A LITTLE SOMETHING FOR YOU",
        headingPlain: "A little something",
        headingEmphasis: "for you.",
        code: "FESTIVE10",
        discount: "10% OFF",
        description: "On orders above ₹1,499",
        ctaLabel: "Copy code",
        copiedLabel: "Copied ✓",
        note: "Apply it at checkout — or send it to someone who deserves a little joy.",
    },
    story: {
        eyebrow: "OUR ROOTS. YOUR RADIANCE.",
        headingPlain: "Some things never go out of style.",
        headingEmphasis: "Like where you're from.",
        paragraph1:
            "The gentle chime of Amma's bangles. A pair of jhumkas borrowed for your first saree. The way a little gold makes an ordinary day feel special.",
        paragraph2:
            "Niththigal is inspired by those feelings. Familiar South Indian silhouettes, thoughtfully reimagined as imitation jewellery you can make your own.",
        cta: "A little piece of your story",
        ctaHref: "#collection",
        signature: "With love, Niththigal ♡",
        imageUrl: "/niththigal/necklace.webp",
        imageAlt: "Intricate gold-tone Lakshmi necklace with ruby-coloured accents and pearl-style drops",
        stampTop: "OLD SOUL",
        stampBottom: "NEW STORIES",
        photoCaption: "A CLOSER LOOK AT THE LITTLE THINGS.",
    },
    benefits: {
        eyebrow: "MORE THAN A FINISHING TOUCH",
        headingPlain: "All the feeling.",
        headingEmphasis: "None of the fuss.",
        items: [
            {
                icon: "heritage",
                title: "A familiar kind of beautiful",
                text: "Temple-inspired motifs, delicate details and the unmistakable charm of our southern roots.",
            },
            {
                icon: "sparkle",
                title: "Dress up. Or don't.",
                text: "Your favourite cotton kurta or your treasured Kanjivaram. Find the piece that feels right for the moment.",
            },
            {
                icon: "gift",
                title: "Little luxuries, real joy",
                text: "The heirloom-inspired look you love, at a price that leaves room for one more little celebration.",
            },
        ],
    },
    testimonials: {
        eyebrow: "THE NITHTHIGAL FEELING",
        headingPlain: "Worn with love.",
        headingEmphasis: "Remembered with a smile.",
        stars: "✦ ✦ ✦ ✦ ✦",
        noteLine: "Little pieces. Lovely stories.",
        note: "Illustrative community stories",
        items: [
            {
                quote: "That just-one-more-look in the mirror feeling. Jhumkas, a cotton saree, and suddenly a regular Friday feels special.",
                authorLabel: "The everyday muse",
                authorTitle: "A little sparkle, on her own terms",
                avatar: "K",
            },
            {
                quote: "Something that feels like home, even when you're far away. A little temple jewellery, a whole lot of memories.",
                authorLabel: "The old soul",
                authorTitle: "Tradition, with her own little twist",
                avatar: "A",
            },
            {
                quote: "For the sister who borrows everything. And the one piece you buy for her, so she finally has a favourite of her own.",
                authorLabel: "The thoughtful gifter",
                authorTitle: "Because she deserves a little joy",
                avatar: "S",
            },
        ],
    },
    instagram: {
        enabled: true,
        eyebrow: "THE NITHTHIGAL DIARY",
        heading: "A little more of us.",
        handle: "@niththigal",
        ctaLabel: "Follow along",
        ctaHref: "",
        posts: [
            {
                id: "post-1",
                imageUrl: "/instagram/post-1.jpg",
                url: "",
                caption: "Jhumkas, a cotton saree, and a Friday that feels like a festival.",
                type: "post",
            },
            {
                id: "post-2",
                imageUrl: "/instagram/post-2.jpg",
                url: "",
                caption: "The little details you notice the second time around.",
                type: "post",
            },
            {
                id: "post-3",
                imageUrl: "/instagram/post-3.jpg",
                url: "",
                caption: "Gift-ready, always. Even when the gift is for you.",
                type: "reel",
            },
        ],
    },
    pricing: {
        eyebrow: "HONESTLY PRICED. BEAUTIFULLY MADE.",
        headingPlain: "Little luxuries.",
        headingEmphasis: "Lovely at any price.",
        text: "No made-up MRPs. No festival inflation. Just considered pieces at prices that leave room for one more little joy.",
        anchorLabel: "Pieces from",
        anchorNote: "Taxes included. Keepsake pouch included.",
        currency: "₹",
        priceOverride: "",
        cta: "Find your price point",
        ctaHref: "#collection",
        items: [
            {
                icon: "tag",
                title: "Honest, all-in pricing",
                text: "The price you see is the price you pay — taxes included, with no surprises at checkout.",
            },
            {
                icon: "gift",
                title: "Gift-ready, always",
                text: "Every order arrives in a keepsake pouch, with a handwritten note option at checkout.",
            },
            {
                icon: "truck",
                title: "Insured express delivery",
                text: "Pan-India dispatch in 24–48 hours, fully insured, with a simple 7-day return promise.",
            },
        ],
        footNote: "Every piece is covered by our 7-day easy return promise.",
    },
    faq: {
        eyebrow: "A LITTLE CLARITY",
        headingPlain: "Good questions.",
        headingEmphasis: "Thoughtful answers.",
        text: "Because finding your favourite should feel effortless.",
        decoration: "✺",
        items: [
            {
                question: "Is this real gold jewellery?",
                answer:
                    "No. Niththigal is an imitation jewellery concept, with gold-tone, heritage-inspired designs — not solid gold. Every piece is crafted on skin-friendly alloys with multi-layer micro gold plating.",
            },
            {
                question: "How do I care for my jewellery?",
                answer:
                    "Keep imitation jewellery away from water, perfume and harsh chemicals. Wipe gently with a soft, dry cloth after wearing and store each piece separately in a dry pouch.",
            },
            {
                question: "How do I choose a bangle size?",
                answer:
                    "Measure the inside diameter of a well-fitting bangle. Common sizes are 2.4 (57.2 mm), 2.6 (60.3 mm) and 2.8 (63.5 mm). Choose your size in the product details.",
            },
            {
                question: "Can I place an order on this website?",
                answer:
                    "Yes. Browse the collection, add pieces to your bag and check out — prices and stock are live from our studio. Pay online via Razorpay, reserve on WhatsApp, or choose cash on delivery.",
            },
            {
                question: "What are the delivery and return options?",
                answer:
                    "We ship pan-India via insured express couriers, dispatched within 24–48 hours. Delivery estimates appear at checkout once you enter your pincode.",
            },
        ],
    },
    finalCta: {
        eyebrow: "YOUR EVERYDAY, A LITTLE MORE BEAUTIFUL",
        headingPlain: "Find the piece that",
        headingEmphasis: "feels like you.",
        text: "No occasion needed. Just a little love for yourself.",
        cta: "Meet your next favourite",
        ctaHref: "#collection",
        decoration: "✺",
    },
    footer: {
        descriptionLine1: "South Indian roots. Everyday radiance.",
        descriptionLine2: "A little tradition. A lot of you.",
        location: "Thoughtfully imagined for the women of the South.",
        columns: [
            {
                title: "Find your favourite",
                links: [
                    { label: "Shop all jewellery", href: "#collection", action: "none", filter: "All pieces" },
                    { label: "Earrings", href: "#collection", action: "none", filter: "Earrings" },
                    { label: "Necklaces", href: "#collection", action: "none", filter: "Necklaces" },
                    { label: "Bangles", href: "#collection", action: "none", filter: "Bangles" },
                ],
            },
            {
                title: "A little more about us",
                links: [
                    { label: "Our story", href: "/about", action: "none" },
                    { label: "FAQ", href: "/faq", action: "none" },
                    { label: "Shipping & returns", href: "/shipping-returns", action: "none" },
                    { label: "Jewellery care", href: "/jewellery-care", action: "none" },
                    { label: "Privacy & terms", href: "/privacy", action: "none" },
                    { label: "The Niththigal feeling", href: "#love", action: "none" },
                ],
            },
        ],
        savedLabel: "My saved favourites ♡",
        noteTop: "FROM OUR HEART TO YOUR JEWELLERY BOX.",
        noteLine1: "Here's to the pieces",
        noteLine2: "that become",
        noteEmphasis: "part of you.",
        noteAccent: "✧  ✧  ✧",
        bottomLeft: "© {year} Niththigal. All little joys reserved.",
        bottomRight: "Rooted in tradition. Reimagined for today.",
        bottomRightAccent: "✧",
        legalNote: "Imitation jewellery, thoughtfully made. Prices include taxes. Imagery is styled by Niththigal.",
    },
    info: {
        shipping: {
            title: "The finer details.",
            body:
                "Orders are dispatched from our studio within 24–48 hours via insured express couriers. Delivery usually takes 2–4 business days across India, and you'll receive tracking by SMS and email.\n\nIf a piece isn't right, message our concierge within 7 days of delivery. Unworn pieces in their original pouch with tags are eligible for a return or exchange. Made-to-order pieces and pierced-earring hygiene exclusions may apply.",
            cta: "Talk to our concierge",
        },
        privacy: {
            title: "Your privacy matters.",
            body:
                "Your bag and saved pieces are stored in your browser. Account, order and delivery details are used only to fulfil your order and are never sold.\n\nPayments are processed by Razorpay. We do not store card details. You can request deletion of your account and data at any time through our support concierge.",
            cta: "Contact support",
        },
        care: {
            title: "Keep the shine.",
            body:
                "Keep imitation jewellery away from water, perfume and harsh chemicals. Wipe gently with a soft, dry cloth after wearing and store each piece separately in a dry pouch.\n\nFollow the product-specific care card included with your order. With a little care, your favourite pieces stay lovely for longer.",
            cta: "Explore the collection",
        },
    },
    theme: {
        colors: {
            cream: "#f0f2dd",
            paper: "#e9eed4",
            green: "#193d32",
            greenDeep: "#16372e",
            ink: "#243a30",
            muted: "#5e6753",
            gold: "#a78043",
            line: "#dbe1c7",
        },
        typography: {
            headingFont: "Cormorant Garamond",
            bodyFont: "Manrope",
        },
    },
    sections: NITHTHIGAL_DEFAULT_SECTIONS,
};

/** Plain-object check used by the deep merge. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge a saved payload over the defaults. Arrays are replaced as a whole
 * (item order and removals must survive), objects merge key by key, and
 * undefined values fall back to the default.
 */
export function mergeNiththigal(
    base: NiththigalContent,
    patch: unknown
): NiththigalContent {
    if (!isRecord(patch)) return base;
    const merge = (fallback: unknown, next: unknown): unknown => {
        if (next === undefined || next === null) return fallback;
        if (Array.isArray(next)) return next;
        if (isRecord(fallback) && isRecord(next)) {
            const out: Record<string, unknown> = { ...fallback };
            for (const key of Object.keys(next)) {
                out[key] = merge(fallback[key], next[key]);
            }
            return out;
        }
        return next;
    };
    const merged = merge(base, patch) as NiththigalContent;
    // The section map must always cover every known section, even when an
    // older saved payload predates a newly added section.
    const byId = new Map((merged.sections || []).map((section) => [section.id, section]));
    merged.sections = NITHTHIGAL_DEFAULT_SECTIONS.map((section) => {
        const saved = byId.get(section.id);
        return {
            ...section,
            enabled: saved?.enabled ?? section.enabled,
            order: typeof saved?.order === "number" ? saved.order : section.order,
            spaceBefore:
                typeof saved?.spaceBefore === "number"
                    ? saved.spaceBefore
                    : section.spaceBefore,
            spaceAfter:
                typeof saved?.spaceAfter === "number"
                    ? saved.spaceAfter
                    : section.spaceAfter,
        };
    }).sort((a, b) => a.order - b.order);
    return merged;
}

/** Replace the `{count}` token in collection count copy. */
export function countCopy(template: string, count: number): string {
    return template.replace(/\{count\}/g, String(count));
}

/** Replace `{year}` in footer copy. */
export function yearCopy(template: string): string {
    return template.replace(/\{year\}/g, String(new Date().getFullYear()));
}
