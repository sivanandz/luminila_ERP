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
    const title = "Privacy & terms — Niththigal";
    const description = policyDescription(
        content.info.privacy.body,
        "What we store, why we store it, and how to ask us to delete it."
    );

    return {
        title,
        description,
        alternates: { canonical: "/privacy" },
        openGraph: {
            title,
            description,
            url: "/privacy",
            type: "website",
        },
        robots: { index: true, follow: true },
    };
}

export default async function PrivacyPage() {
    const { content } = await getSiteContent();
    return (
        <EditorialPage
            title="Privacy & terms"
            eyebrow={(content.info.privacy.title || "Your privacy matters.").toUpperCase()}
            description="What we store, why we store it, and how to ask us to delete it."
            body={content.info.privacy.body}
            path="/privacy"
        >
            <p className="product-purchase-note">
                <Link href="/#collection">Explore the collection</Link> ·{" "}
                <Link href="/faq">Read the FAQ</Link>.
            </p>
        </EditorialPage>
    );
}
