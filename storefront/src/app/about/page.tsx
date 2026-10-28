import type { Metadata } from "next";
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
    const definition =
        content.faq.items.find((item) => /real gold/i.test(item.question))?.answer ||
        "Niththigal is an imitation jewellery concept with gold-tone, heritage-inspired designs.";
    const benefits = content.benefits.items
        .map((item) => `${item.title}. ${item.text}`)
        .join("\n\n");

    const body = [
        story.paragraph1,
        story.paragraph2,
        definition,
        benefits,
    ]
        .filter(Boolean)
        .join("\n\n");

    return (
        <EditorialPage
            title="About Niththigal"
            eyebrow={story.eyebrow || "OUR ROOTS. YOUR RADIANCE."}
            description="South Indian-inspired imitation jewellery, made for the saree days, the coffee dates and every version of you."
            body={body}
            path="/about"
            type="AboutPage"
        />
    );
}
