import type { Metadata } from "next";
import Link from "next/link";
import { EditorialPage } from "@/components/seo/EditorialPage";
import { getSiteContent } from "@/lib/site-content-server";

/** First visible sentence(s) of the CMS copy, never a second, invented claim. */
function policyDescription(body: string, fallback: string): string {
    const text = (body.split(/\n{2,}/)[0] || "").replace(/\s+/g, " ").trim();
    if (!text) return fallback;
    if (text.length <= 158) return text;
    const cut = text.slice(0, 157);
    const boundary = Math.max(
        cut.lastIndexOf(". "),
        cut.lastIndexOf("? "),
        cut.lastIndexOf("! ")
    );
    if (boundary > 60) return cut.slice(0, boundary + 1);
    const space = cut.lastIndexOf(" ");
    return `${cut.slice(0, space > 80 ? space : 157).trim()}…`;
}

export async function generateMetadata(): Promise<Metadata> {
    const { content } = await getSiteContent();
    const title = "Shipping & returns — Niththigal";
    const description = policyDescription(
        content.info.shipping.body,
        "Insured pan-India express delivery and a 7-day return promise."
    );

    return {
        title,
        description,
        alternates: { canonical: "/shipping-returns" },
        openGraph: {
            title,
            description,
            url: "/shipping-returns",
            type: "website",
        },
        robots: { index: true, follow: true },
    };
}

export default async function ShippingReturnsPage() {
    const { content } = await getSiteContent();
    return (
        <EditorialPage
            title="Shipping & returns"
            eyebrow={(content.info.shipping.title || "The finer details.").toUpperCase()}
            description="Insured pan-India express delivery and a 7-day return promise."
            body={content.info.shipping.body}
            path="/shipping-returns"
        >
            <p className="product-purchase-note">
                <Link href="/#collection">Explore the collection</Link> ·{" "}
                <Link href="/jewellery-care">Jewellery care</Link>.
            </p>
        </EditorialPage>
    );
}
