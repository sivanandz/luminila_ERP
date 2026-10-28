import type { BuildCatalog } from "@/lib/catalog-server";
import type { NiththigalContent } from "@/lib/niththigal-content-data";
import { absoluteUrl, categoryPath, productPath } from "@/lib/seo";

function money(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(value);
}

function text(value?: string | null): string {
    return (value || "").trim();
}

function availability(product: { stock_status?: string; total_stock: number }): string {
    if (product.stock_status === "out_of_stock" || product.total_stock <= 0) {
        return "out of stock";
    }
    return product.total_stock <= 3
        ? `low stock (${product.total_stock} left)`
        : `in stock (${product.total_stock} available)`;
}

function productUrl(catalog: BuildCatalog, productId: string): string | null {
    const slug = catalog.slugByProductId[productId];
    return slug ? absoluteUrl(productPath(slug)) : null;
}

/** Short index for agents: what the site is and where the useful pages are. */
export function buildLlmsIndex(
    content: NiththigalContent,
    catalog: BuildCatalog
): string {
    const brand = text(content.brand.name) || "Niththigal";
    const lines: string[] = [
        `# ${brand}`,
        "",
        "> South Indian-inspired imitation jewellery: temple necklaces, jhumkas and bangles in gold-tone finishes, with live prices and pan-India insured delivery.",
        "",
        `${brand} is a South Indian-inspired imitation jewellery label. This file is a community convention, not an official standard; Google does not require an AI-specific file and its AI features use normal Search eligibility.`,
        "",
        "## Pages",
        `- [Home](${absoluteUrl("/")}): the collection, brand story and FAQ.`,
        `- [About ${brand}](${absoluteUrl("/about")}): what ${brand} is and how the pieces are made.`,
        `- [FAQ](${absoluteUrl("/faq")}): materials, bangle sizing, care, ordering, delivery and returns.`,
        `- [Shipping & returns](${absoluteUrl("/shipping-returns")}): dispatch, tracking and the 7-day return promise.`,
        `- [Jewellery care](${absoluteUrl("/jewellery-care")}): how to keep gold-tone imitation jewellery lovely.`,
        `- [Privacy & terms](${absoluteUrl("/privacy")}): what is stored and how to request deletion.`,
        "",
        "## Collections",
    ];

    for (const category of catalog.categories) {
        const products = catalog.products.filter(
            (product) =>
                text(product.category).toLowerCase() === category.name.toLowerCase()
        );
        const prices = products
            .map((product) => product.website_price)
            .filter((price) => Number.isFinite(price) && price > 0);
        const from = prices.length ? ` from ${money(Math.min(...prices))}` : "";
        lines.push(
            `- [${category.name}](${absoluteUrl(categoryPath(category.slug))}): ${category.count} piece${
                category.count === 1 ? "" : "s"
            }${from}.`
        );
    }

    lines.push("", "## Products");
    for (const product of catalog.products) {
        const url = productUrl(catalog, product.id);
        if (!url) continue;
        const category = text(product.category) || "Jewellery";
        const price = product.website_price > 0 ? ` · ${money(product.website_price)}` : "";
        lines.push(
            `- [${product.name}](${url}): ${category}${price} · ${availability(product)}.`
        );
    }

    lines.push(
        "",
        "## Policies",
        `- [Shipping & returns](${absoluteUrl("/shipping-returns")})`,
        `- [Jewellery care](${absoluteUrl("/jewellery-care")})`,
        `- [Privacy & terms](${absoluteUrl("/privacy")})`,
        ""
    );

    return lines.join("\n");
}

/** Fuller markdown guide with real product and policy detail. */
export function buildLlmsFull(
    content: NiththigalContent,
    catalog: BuildCatalog
): string {
    const brand = text(content.brand.name) || "Niththigal";
    const lines: string[] = [
        `# ${brand} — full site guide`,
        "",
        "> South Indian-inspired imitation jewellery. Heritage silhouettes, gold-tone finishes and everyday pieces, with live prices and pan-India insured delivery.",
        "",
        `${brand} is an imitation jewellery label, not solid gold. This file is a community convention, not an official standard; it is a convenience for agents, not a Google requirement.`,
        "",
        "## Collections",
    ];

    for (const category of catalog.categories) {
        lines.push(
            `- [${category.name}](${absoluteUrl(categoryPath(category.slug))}): ${category.count} piece${
                category.count === 1 ? "" : "s"
            }.`
        );
    }

    lines.push("", "## Products");
    for (const product of catalog.products) {
        const url = productUrl(catalog, product.id);
        if (!url) continue;
        const category = text(product.category) || "Jewellery";
        lines.push("", `### ${product.name}`, "");
        lines.push(`- URL: ${url}`);
        lines.push(`- Category: ${category}`);
        if (product.website_price > 0) {
            lines.push(`- Price: ${money(product.website_price)} (INR), taxes included`);
        }
        lines.push(`- Availability: ${availability(product)}`);
        if (text(product.sku)) lines.push(`- SKU: ${text(product.sku)}`);
        if (text(product.base_metal)) lines.push(`- Base metal: ${text(product.base_metal)}`);
        if (text(product.plating_type)) lines.push(`- Plating: ${text(product.plating_type)}`);
        if (text(product.stone_type)) lines.push(`- Stone: ${text(product.stone_type)}`);
        if (text(product.occasion)) lines.push(`- Occasion: ${text(product.occasion)}`);
        if (product.variants.length) {
            lines.push(
                `- Variants: ${product.variants
                    .map(
                        (variant) =>
                            `${variant.label} (${variant.stock_level} in stock)`
                    )
                    .join(", ")}`
            );
        }
        if (text(product.description)) {
            lines.push(`- Description: ${text(product.description)}`);
        }
        if (text(product.care_instructions)) {
            lines.push(`- Care: ${text(product.care_instructions)}`);
        }
    }

    lines.push("", "## FAQ");
    for (const item of content.faq.items) {
        lines.push("", `### ${text(item.question)}`, "", text(item.answer));
    }

    lines.push("", "## Shipping & returns", "", text(content.info.shipping.body));
    lines.push("", "## Jewellery care", "", text(content.info.care.body));
    lines.push("", "## Privacy & terms", "", text(content.info.privacy.body));

    const contact: string[] = [];
    if (text(content.contact.whatsappPhone)) {
        contact.push(`- WhatsApp: ${text(content.contact.whatsappPhone)}`);
    }
    if (text(content.contact.supportEmail)) {
        contact.push(`- Email: ${text(content.contact.supportEmail)}`);
    }
    if (text(content.contact.instagramUrl)) {
        contact.push(`- Instagram: ${text(content.contact.instagramUrl)}`);
    }
    if (contact.length) {
        lines.push("", "## Contact", "", ...contact);
    }

    lines.push("");
    return lines.join("\n");
}
