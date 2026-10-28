import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import {
    CONTENT_UPDATED,
    breadcrumbJsonLd,
    webPageJsonLd,
    type JsonLdNode,
} from "@/lib/seo";
import "@/app/catalog.css";

/**
 * Shared server-rendered shell for the about, FAQ and policy pages: one H1,
 * visible policy copy, a breadcrumb trail, WebPage markup and internal links.
 */
export function EditorialPage({
    title,
    eyebrow,
    description,
    body,
    path,
    type = "WebPage",
    extraNodes = [],
    children,
}: {
    title: string;
    eyebrow: string;
    description: string;
    body: string;
    path: string;
    type?: "WebPage" | "AboutPage";
    extraNodes?: (JsonLdNode | null)[];
    children?: React.ReactNode;
}) {
    const paragraphs = body
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return (
        <>
            <JsonLd
                id={`${path.replace(/[^a-z0-9]+/gi, "-")}-jsonld`}
                nodes={[
                    webPageJsonLd({ type, url: path, name: title, description }),
                    breadcrumbJsonLd([
                        { name: "Home", url: "/" },
                        { name: title, url: path },
                    ]),
                    ...extraNodes,
                ]}
            />
            <div className="section-pad">
                <nav className="product-breadcrumb" aria-label="Breadcrumb">
                    <Link href="/">Home</Link>
                    <span aria-hidden>/</span>
                    <span aria-current="page">{title}</span>
                </nav>

                <header className="collection-hero">
                    <div className="eyebrow">{eyebrow}</div>
                    <h1>{title}</h1>
                    <p>{description}</p>
                </header>

                <div className="product-detail-description" style={{ marginTop: 24 }}>
                    {paragraphs.map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                    ))}
                    {children}
                    <p className="product-purchase-note">
                        Reviewed {CONTENT_UPDATED}. <Link href="/about">About Niththigal</Link>{" "}
                        · <Link href="/faq">FAQ</Link> ·{" "}
                        <Link href="/shipping-returns">Shipping &amp; returns</Link> ·{" "}
                        <Link href="/jewellery-care">Jewellery care</Link> ·{" "}
                        <Link href="/privacy">Privacy &amp; terms</Link>
                    </p>
                </div>
            </div>
        </>
    );
}
