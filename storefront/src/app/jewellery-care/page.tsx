import type { Metadata } from "next";
import { EditorialPage } from "@/components/seo/EditorialPage";
import { getSiteContent } from "@/lib/site-content-server";

export const metadata: Metadata = {
    title: "Jewellery care — Niththigal",
    description:
        "How to care for Niththigal imitation jewellery: keep it away from water, perfume and harsh chemicals, wipe it with a soft dry cloth and store each piece separately.",
    alternates: { canonical: "/jewellery-care" },
    openGraph: {
        title: "Jewellery care — Niththigal",
        description:
            "Keep your gold-tone pieces lovely for longer with a little everyday care.",
        url: "/jewellery-care",
        type: "website",
    },
    robots: { index: true, follow: true },
};

export default async function JewelleryCarePage() {
    const { content } = await getSiteContent();
    return (
        <EditorialPage
            title="Jewellery care"
            eyebrow="KEEP THE SHINE"
            description="A little care keeps your favourite pieces lovely for longer."
            body={content.info.care.body}
            path="/jewellery-care"
        />
    );
}
