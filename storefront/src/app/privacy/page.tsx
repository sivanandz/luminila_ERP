import type { Metadata } from "next";
import { EditorialPage } from "@/components/seo/EditorialPage";
import { getSiteContent } from "@/lib/site-content-server";

export const metadata: Metadata = {
    title: "Privacy & terms — Niththigal",
    description:
        "How Niththigal handles your data: browser-stored bag and favourites, order and delivery details used to fulfil orders, Razorpay payments, and data deletion requests.",
    alternates: { canonical: "/privacy" },
    openGraph: {
        title: "Privacy & terms — Niththigal",
        description:
            "Your bag and favourites stay in your browser; order details are used only to fulfil your order.",
        url: "/privacy",
        type: "website",
    },
    robots: { index: true, follow: true },
};

export default async function PrivacyPage() {
    const { content } = await getSiteContent();
    return (
        <EditorialPage
            title="Privacy & terms"
            eyebrow="YOUR PRIVACY MATTERS"
            description="What we store, why we store it, and how to ask us to delete it."
            body={content.info.privacy.body}
            path="/privacy"
        />
    );
}
