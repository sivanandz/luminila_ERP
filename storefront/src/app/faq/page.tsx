import type { Metadata } from "next";
import Link from "next/link";
import { EditorialPage } from "@/components/seo/EditorialPage";
import { getSiteContent } from "@/lib/site-content-server";
import { faqPageJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
    title: "Niththigal FAQ — materials, sizing, delivery and returns",
    description:
        "Answers about Niththigal jewellery: materials and plating, bangle sizing, care, ordering, delivery and returns.",
    alternates: { canonical: "/faq" },
    openGraph: {
        title: "Niththigal FAQ — materials, sizing, delivery and returns",
        description:
            "Answers about materials and plating, bangle sizing, care, ordering, delivery and returns.",
        url: "/faq",
        type: "website",
    },
    robots: { index: true, follow: true },
};

export default async function FaqPage() {
    const { content } = await getSiteContent();
    const faq = content.faq;

    return (
        <EditorialPage
            title="Frequently asked questions"
            eyebrow={faq.eyebrow || "A LITTLE CLARITY"}
            description={
                faq.text ||
                "Because finding your favourite should feel effortless."
            }
            body=""
            path="/faq"
            extraNodes={[faqPageJsonLd({ url: "/faq", items: faq.items })]}
        >
            <div className="faq-list" style={{ marginTop: 24 }}>
                {faq.items.map((item, index) => (
                    <details key={`${item.question}-${index}`} open={index === 0}>
                        <summary>
                            {item.question}
                            <span className="faq-plus" aria-hidden />
                        </summary>
                        <p>{item.answer}</p>
                    </details>
                ))}
            </div>

            <p className="product-purchase-note">
                <Link href="/#collection">Explore the collection</Link> ·{" "}
                <Link href="/shipping-returns">Shipping &amp; returns</Link>.
            </p>
        </EditorialPage>
    );
}
