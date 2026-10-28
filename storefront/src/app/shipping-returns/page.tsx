import type { Metadata } from "next";
import { EditorialPage } from "@/components/seo/EditorialPage";
import { getSiteContent } from "@/lib/site-content-server";

export const metadata: Metadata = {
    title: "Shipping & returns — Niththigal",
    description:
        "Niththigal shipping and returns: insured pan-India express dispatch within 24–48 hours, tracking by SMS and email, and a 7-day return promise.",
    alternates: { canonical: "/shipping-returns" },
    openGraph: {
        title: "Shipping & returns — Niththigal",
        description:
            "Insured pan-India express dispatch within 24–48 hours and a 7-day return promise.",
        url: "/shipping-returns",
        type: "website",
    },
    robots: { index: true, follow: true },
};

export default async function ShippingReturnsPage() {
    const { content } = await getSiteContent();
    return (
        <EditorialPage
            title="Shipping & returns"
            eyebrow="THE FINER DETAILS"
            description="Insured pan-India express delivery and a 7-day return promise."
            body={content.info.shipping.body}
            path="/shipping-returns"
        />
    );
}
