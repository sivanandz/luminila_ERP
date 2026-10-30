import type { Metadata } from "next";
import Link from "next/link";
import { EditorialPage } from "@/components/seo/EditorialPage";
import { getSiteContent } from "@/lib/site-content-server";

export const metadata: Metadata = {
    title: "About Niththigal — South Indian-inspired imitation jewellery",
    description:
        "The story behind Niththigal: South Indian-inspired imitation jewellery with heritage silhouettes, gold-tone finishes and everyday radiance.",
    alternates: { canonical: "/about" },
    openGraph: {
        title: "About Niththigal — South Indian-inspired imitation jewellery",
        description:
            "Heritage silhouettes, thoughtfully reimagined for everyday wear.",
        url: "/about",
        type: "website",
    },
    robots: { index: true, follow: true },
};

export default async function AboutPage() {
    const { content } = await getSiteContent();
    const story = content.story;
    // The FAQ answer is written for a question, so drop its leading "No."
    // before quoting it as a standalone statement about the brand.
    const realGold = content.faq.items.find((item) => /real gold/i.test(item.question));
    const honestDefinition =
        (realGold?.answer || "").replace(/^\s*no\.\s*/i, "").trim() ||
        "Niththigal is a South Indian-inspired imitation jewellery label — not solid gold.";
    const promise = content.promise.items
        .map((item) => item.text)
        .filter(Boolean);

    return (
        <EditorialPage
            title="About Niththigal"
            eyebrow={story.eyebrow || "OUR ROOTS. YOUR RADIANCE."}
            description="South Indian-inspired imitation jewellery, made for the saree days, the coffee dates and every version of you."
            body={[story.paragraph1, story.paragraph2, honestDefinition]
                .filter(Boolean)
                .join("\n\n")}
            path="/about"
            type="AboutPage"
        >
            {promise.length ? (
                <section
                    aria-labelledby="about-promise-title"
                    style={{ marginTop: 30 }}
                >
                    <h2
                        id="about-promise-title"
                        style={{
                            fontSize: "clamp(28px, 4vw, 40px)",
                            marginBottom: 10,
                        }}
                    >
                        Our promise
                    </h2>
                    <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
                        {promise.map((item) => (
                            <li key={item} style={{ marginBottom: 6 }}>
                                {item}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {content.benefits.items.length ? (
                <section
                    aria-labelledby="about-benefits-title"
                    style={{ marginTop: 30 }}
                >
                    <h2
                        id="about-benefits-title"
                        style={{
                            fontSize: "clamp(28px, 4vw, 40px)",
                            marginBottom: 10,
                        }}
                    >
                        {content.benefits.headingPlain}{" "}
                        {content.benefits.headingEmphasis}
                    </h2>
                    <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
                        {content.benefits.items.map((item) => (
                            <li key={item.title} style={{ marginBottom: 8 }}>
                                <strong>{item.title}.</strong> {item.text}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <p className="product-purchase-note">
                <Link href="/#collection">Explore the collection</Link> ·{" "}
                <Link href="/faq">Read the FAQ</Link>
            </p>
        </EditorialPage>
    );
}
