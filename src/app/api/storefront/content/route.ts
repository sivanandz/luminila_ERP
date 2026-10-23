import { NextResponse, NextRequest } from "next/server";
import PocketBase from "pocketbase";
import { pb as sharedPb, ensureServerAuth, getPocketBaseUrl } from "@/lib/pocketbase";
import { hasCapability } from "@/lib/api-auth";

const PB_KEY = "storefront_content";

const DEFAULT_CONTENT = {
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
        {
            id: "latest-drop",
            title: "Latest Drop",
            filter: "all",
        },
        {
            id: "temple-classics",
            title: "Temple Classics",
            filter: "Temple",
        },
        {
            id: "bridal-kundan",
            title: "Bridal Suites",
            filter: "Bridal",
        },
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

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-account-email",
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
    try {
        const queryEmail = req.nextUrl.searchParams.get("account_email") || req.headers.get("x-account-email") || "";
        await ensureServerAuth(queryEmail || undefined);

        const pb = new PocketBase(sharedPb.baseUrl || getPocketBaseUrl());
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
        
        let staffEmail = "";
        let isAuthorized = false;

        if (token) {
            try {
                pb.authStore.save(token, null);
                await pb.collection("users").authRefresh();
                isAuthorized = pb.authStore.isValid;
                staffEmail = pb.authStore.record?.email || pb.authStore.model?.email || "";
            } catch {
                try {
                    pb.authStore.save(token, null);
                    await pb.collection("_superusers").authRefresh();
                    isAuthorized = pb.authStore.isValid;
                    staffEmail = pb.authStore.record?.email || pb.authStore.model?.email || "";
                } catch {
                    isAuthorized = false;
                }
            }
        }

        const targetEmail = staffEmail || queryEmail;

        let record = null;
        const readPb = isAuthorized ? pb : sharedPb;
        if (!isAuthorized && targetEmail) {
            await ensureServerAuth(targetEmail);
        }

        if (targetEmail) {
            try {
                record = await readPb.collection("store_settings").getFirstListItem(
                    `key="${PB_KEY}" && account_email="${targetEmail}"`
                );
            } catch {}
        }

        if (!record) {
            try {
                record = await readPb.collection("store_settings").getFirstListItem(`key="${PB_KEY}"`);
            } catch {}
        }

        let content = DEFAULT_CONTENT;
        if (record && record.value) {
            const parsed = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            content = { ...DEFAULT_CONTENT, ...parsed };
        }

        // Pentest M-01 remediation: Do not disclose operator internal bindings to unauthorized public callers
        if (!isAuthorized) {
            const sanitized = { ...content };
            delete (sanitized as Record<string, unknown>).adminBinding;
            return NextResponse.json(sanitized, { headers: CORS_HEADERS });
        }

        return NextResponse.json(content, { headers: CORS_HEADERS });
    } catch (err: unknown) {
        console.error("Failed to read storefront content:", err);
        return NextResponse.json(DEFAULT_CONTENT, { headers: CORS_HEADERS });
    }
}

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();

        if (!token) {
            return NextResponse.json(
                { success: false, error: "Unauthorized: Valid staff authentication token is required." },
                { status: 401, headers: CORS_HEADERS }
            );
        }

        const body = await req.json();
        const hintEmail = (
            body?.adminBinding?.boundAdminEmail ||
            body?.account_email ||
            req.headers.get("x-account-email") ||
            ""
        ).trim().toLowerCase();

        await ensureServerAuth(hintEmail || undefined);

        const pb = new PocketBase(sharedPb.baseUrl || getPocketBaseUrl());
        let staffEmail = "";
        let isAuthorized = false;

        try {
            pb.authStore.save(token, null);
            await pb.collection("users").authRefresh();
            isAuthorized = pb.authStore.isValid;
            staffEmail = pb.authStore.record?.email || pb.authStore.model?.email || "";
        } catch {
            try {
                pb.authStore.save(token, null);
                await pb.collection("_superusers").authRefresh();
                isAuthorized = pb.authStore.isValid;
                staffEmail = pb.authStore.record?.email || pb.authStore.model?.email || "";
            } catch {
                isAuthorized = false;
            }
        }

        if (!isAuthorized || !staffEmail) {
            return NextResponse.json(
                { success: false, error: "Unauthorized: Invalid or expired staff authentication token." },
                { status: 401, headers: CORS_HEADERS }
            );
        }

        // Writing storefront content is a settings change, not a read: require
        // the capability instead of accepting any valid staff token.
        const staffSession = {
            ok: true,
            status: 200,
            email: staffEmail,
            userId: pb.authStore.record?.id,
            isSuperuser: Boolean(pb.authStore.isSuperuser),
            client: pb,
        };
        if (!(await hasCapability(staffSession, "settings", "update"))) {
            return NextResponse.json(
                { success: false, error: "Your role cannot change storefront content." },
                { status: 403, headers: CORS_HEADERS }
            );
        }

        // Load existing tenant content from PocketBase
        let existingRecord = null;
        try {
            existingRecord = await pb.collection("store_settings").getFirstListItem(
                `key="${PB_KEY}" && account_email="${staffEmail}"`
            );
        } catch {}

        let current = DEFAULT_CONTENT;
        if (existingRecord && existingRecord.value) {
            try {
                current = typeof existingRecord.value === "string" ? JSON.parse(existingRecord.value) : existingRecord.value;
            } catch {}
        }

        const safeAdminBinding = {
            ...(current.adminBinding || {}),
            ...(body.adminBinding || {}),
            boundAdminEmail: staffEmail,
        };

        const merged = {
            ...current,
            ...body,
            announcement: { ...current.announcement, ...(body.announcement || {}) },
            hero: { ...current.hero, ...(body.hero || {}) },
            layoutSections: Array.isArray(body.layoutSections) ? body.layoutSections : current.layoutSections,
            trustStrip: { ...current.trustStrip, ...(body.trustStrip || {}) },
            merchandising: { ...current.merchandising, ...(body.merchandising || {}) },
            reviews: { ...current.reviews, ...(body.reviews || {}) },
            brandStory: { ...current.brandStory, ...(body.brandStory || {}) },
            faq: { ...current.faq, ...(body.faq || {}) },
            stickyMobileBar: { ...current.stickyMobileBar, ...(body.stickyMobileBar || {}) },
            promoBanner: { ...current.promoBanner, ...(body.promoBanner || {}) },
            socialAndContact: { ...current.socialAndContact, ...(body.socialAndContact || {}) },
            vitrines: Array.isArray(body.vitrines) ? body.vitrines : current.vitrines,
            adminBinding: safeAdminBinding,
        };

        if (existingRecord) {
            await pb.collection("store_settings").update(existingRecord.id, {
                value: merged,
                account_email: staffEmail,
                category: "storefront_content",
            });
        } else {
            await pb.collection("store_settings").create({
                key: PB_KEY,
                value: merged,
                account_email: staffEmail,
                category: "storefront_content",
            });
        }

        return NextResponse.json({ success: true, data: merged }, { headers: CORS_HEADERS });
    } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("Failed to save storefront content:", err);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500, headers: CORS_HEADERS });
    }
}
