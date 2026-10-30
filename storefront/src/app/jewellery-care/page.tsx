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
    const title = "Jewellery care — Niththigal";
    const description = policyDescription(
        content.info.care.body,
        "Keep imitation jewellery away from water, perfume and harsh chemicals; wipe it with a soft, dry cloth and store each piece separately."
    );

    return {
        title,
        description,
        alternates: { canonical: "/jewellery-care" },
        openGraph: {
            title,
            description,
            url: "/jewellery-care",
            type: "website",
        },
        robots: { index: true, follow: true },
    };
}

export default async function JewelleryCarePage() {
    const { content } = await getSiteContent();
    return (
        <EditorialPage
            title="Jewellery care"
            eyebrow={(content.info.care.title || "Keep the shine.").toUpperCase()}
            description="A little care keeps your favourite pieces lovely for longer."
            body={content.info.care.body}
            path="/jewellery-care"
        >
            <p className="product-purchase-note">
                <Link href="/#collection">Explore the collection</Link> ·{" "}
                <Link href="/shipping-returns">Shipping &amp; returns</Link>.
            </p>
        </EditorialPage>
    );
}
