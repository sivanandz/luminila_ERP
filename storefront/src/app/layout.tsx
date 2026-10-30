import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { Toaster } from "sonner";
import { CartProvider } from "@/context/CartContext";
import { CustomerAuthProvider } from "@/context/CustomerAuthContext";
import { NtHeader } from "@/components/niththigal/NtHeader";
import { NtFooter } from "@/components/niththigal/NtFooter";
import { NtSiteShell } from "@/components/niththigal/NtSiteShell";
import { NtCatalogProvider } from "@/components/niththigal/NtCatalogContext";
import { NtUiProvider } from "@/components/niththigal/NtUiContext";
import { NtDialogs } from "@/components/niththigal/NtDialogs";
import { NtMotion } from "@/components/niththigal/NtMotion";
import { WishlistProvider } from "@/hooks/use-wishlist";
import { CartDrawer } from "@/components/CartDrawer";
import { CustomerAuthModal } from "@/components/CustomerAuthModal";
import { JsonLd } from "@/components/seo/JsonLd";
import { NiththigalContentProvider } from "@/lib/niththigal-content";
import { trimBrandAssets } from "@/lib/niththigal-content-data";
import { getSiteContent } from "@/lib/site-content-server";
import { getBuildCatalog, INITIAL_CATALOG_LIMIT } from "@/lib/catalog-server";
import { erpOrigin } from "@/lib/site-content-server";
import {
    SITE_DESCRIPTION,
    SITE_NAME,
    SITE_URL,
    absoluteAssetUrl,
    organizationJsonLd,
    webSiteJsonLd,
} from "@/lib/seo";
import "./globals.css";
import "./niththigal.css";
import "./niththigal-sections.css";

const cormorant = Cormorant_Garamond({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600"],
    variable: "--font-cormorant",
});

const manrope = Manrope({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700", "800"],
    variable: "--font-manrope",
});

export const viewport: Viewport = {
    themeColor: "#193d32",
};

function originOf(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.origin;
    } catch {
        return null;
    }
}

function preconnectOrigins(): string[] {
    const origins = new Set<string>();
    const erp = originOf(erpOrigin() ?? undefined);
    if (erp) origins.add(erp);
    const pocketBase = originOf(process.env.NEXT_PUBLIC_POCKETBASE_URL);
    if (pocketBase) origins.add(pocketBase);
    origins.delete(SITE_URL);
    return [...origins];
}

export async function generateMetadata(): Promise<Metadata> {
    const { content } = await getSiteContent();
    const title = `${content.brand.name} — ${
        content.brand.tagline || "A little tradition. A lot of you."
    }`;
    const description = content.hero.description || SITE_DESCRIPTION;
    const image =
        absoluteAssetUrl(content.hero.imageUrl) ?? `${SITE_URL}/niththigal/hero.webp`;
    const googleVerification = (process.env.GOOGLE_SITE_VERIFICATION || "").trim();
    const bingVerification = (process.env.BING_SITE_VERIFICATION || "").trim();

    return {
        metadataBase: new URL(SITE_URL),
        title,
        description,
        applicationName: content.brand.name,
        // Default canonical for the home page. Every other route must set its
        // own `alternates.canonical`; /checkout is noindex.
        alternates: { canonical: "/" },
        openGraph: {
            title,
            description,
            type: "website",
            siteName: content.brand.name,
            locale: "en_IN",
            images: [
                {
                    url: image,
                    width: 1122,
                    height: 1402,
                    alt: content.hero.imageAlt || `${content.brand.name} campaign imagery`,
                },
            ],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [image],
        },
        robots: {
            index: true,
            follow: true,
            googleBot: {
                index: true,
                follow: true,
                "max-image-preview": "large",
                "max-snippet": -1,
                "max-video-preview": -1,
            },
        },
        icons: {
            icon: "/icon.svg",
            shortcut: "/icon.svg",
        },
        ...(googleVerification || bingVerification
            ? {
                  verification: {
                      ...(googleVerification ? { google: googleVerification } : {}),
                      ...(bingVerification
                          ? { other: { "msvalidate.01": bingVerification } }
                          : {}),
                  },
              }
            : {}),
    };
}

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [{ content }, catalog] = await Promise.all([
        getSiteContent(),
        getBuildCatalog(),
    ]);
    const initialContent = trimBrandAssets(content);
    const initialProducts = catalog.products.slice(0, INITIAL_CATALOG_LIMIT);

    return (
        <html lang="en-IN" className={`${cormorant.variable} ${manrope.variable}`}>
            <body className="antialiased">
                {preconnectOrigins().map((origin) => (
                    <link key={origin} rel="preconnect" href={origin} />
                ))}
                <JsonLd
                    id="site-jsonld"
                    nodes={[
                        organizationJsonLd({
                            name: content.brand.name,
                            description: content.hero.description || SITE_DESCRIPTION,
                            logoUrl: content.brand.logoUrl,
                            sameAs: content.contact.instagramUrl
                                ? [content.contact.instagramUrl]
                                : [],
                            telephone: content.contact.whatsappPhone,
                            email: content.contact.supportEmail,
                        }),
                        webSiteJsonLd({ name: content.brand.name }),
                    ]}
                />
                <CustomerAuthProvider>
                    <WishlistProvider>
                        <NiththigalContentProvider initialContent={initialContent}>
                            <NtSiteShell>
                                <NtCatalogProvider
                                    initialProducts={initialProducts}
                                    initialSlugs={catalog.slugByProductId}
                                >
                                    <CartProvider>
                                        <NtUiProvider>
                                            <a className="skip-link" href="#main">
                                                Skip to content
                                            </a>
                                            <NtHeader />
                                            <CartDrawer />
                                            <NtDialogs />
                                            <CustomerAuthModal />
                                            <main id="main" className="flex-1">
                                                {children}
                                            </main>
                                            <NtFooter />
                                            <NtMotion />
                                            <Toaster
                                                position="bottom-center"
                                                toastOptions={{
                                                    style: {
                                                        background:
                                                            "linear-gradient(120deg, #284b3ee8, #193d32e8)",
                                                        color: "#f5efdf",
                                                        border: "1px solid #dbe5bd40",
                                                        borderRadius: "99px",
                                                        fontFamily:
                                                            "var(--font-manrope), Manrope, sans-serif",
                                                        fontSize: 11,
                                                        backdropFilter: "blur(18px)",
                                                    },
                                                }}
                                            />
                                        </NtUiProvider>
                                    </CartProvider>
                                </NtCatalogProvider>
                            </NtSiteShell>
                        </NiththigalContentProvider>
                    </WishlistProvider>
                </CustomerAuthProvider>
            </body>
        </html>
    );
}
