import { getBuildCatalog } from "@/lib/catalog-server";
import { getSiteContent } from "@/lib/site-content-server";
import {
    SITE_URL,
    absoluteAssetUrl,
    absoluteUrl,
    googleProductCategoryId,
    isProductInStock,
    productPath,
} from "@/lib/seo";

export const dynamic = "force-static";

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

/**
 * Google Merchant Center RSS 2.0 feed.
 *
 * One item per sellable variant. Only products with a crawlable image and a
 * positive price are included. No shipping/tax/GTIN/MPN values are invented;
 * identifier_exists=no is honest because the catalogue has no GTIN.
 */
export async function GET() {
    const [{ content }, catalog] = await Promise.all([
        getSiteContent(),
        getBuildCatalog(),
    ]);
    const brand = oneLine(content.brand.name) || "Niththigal";
    const items: string[] = [];

    for (const product of catalog.products) {
        const slug = catalog.slugByProductId[product.id];
        if (!slug) continue;
        const image = absoluteAssetUrl(product.image_url);
        if (!image) continue;
        if (!(product.website_price > 0)) continue;

        const category = oneLine(product.category || "") || "Jewellery";
        const categoryId = googleProductCategoryId(category);
        const variants = product.variants.length
            ? product.variants
            : [
                  {
                      id: product.id,
                      label: "Standard",
                      stock_level: product.total_stock,
                  },
              ];

        for (const variant of variants) {
            const available =
                variant.stock_level > 0 && isProductInStock(product);
            const variantLabel =
                variant.label && variant.label !== "Standard"
                    ? ` — ${oneLine(variant.label)}`
                    : "";
            const title = oneLine(`${product.name}${variantLabel}`).slice(0, 150);
            const description =
                oneLine(product.description || "") ||
                `${oneLine(product.name)} — ${category} by ${brand}.`;
            const link = `${absoluteUrl(productPath(slug))}?variant=${encodeURIComponent(
                variant.id
            )}`;
            const groupId =
                variants.length > 1 ? `\n      <g:item_group_id>${escapeXml(product.id)}</g:item_group_id>` : "";
            const size =
                /bangle/i.test(category) && variant.label !== "Standard"
                    ? `\n      <g:size>${escapeXml(oneLine(variant.label))}</g:size>`
                    : "";

            items.push(`    <item>
      <g:id>${escapeXml(`${product.id}_${variant.id}`)}</g:id>
      <title>${escapeXml(title)}</title>
      <description>${escapeXml(description.slice(0, 5000))}</description>
      <link>${escapeXml(link)}</link>
      <g:image_link>${escapeXml(image)}</g:image_link>
      <g:availability>${available ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${product.website_price.toFixed(2)} INR</g:price>
      <g:brand>${escapeXml(brand)}</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>${
          categoryId
              ? `\n      <g:google_product_category>${categoryId}</g:google_product_category>`
              : ""
      }${groupId}${size}
    </item>`);
        }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(brand)}</title>
    <link>${escapeXml(`${SITE_URL}/`)}</link>
    <description>${escapeXml(
        `South Indian-inspired imitation jewellery from ${brand}.`
    )}</description>
${items.join("\n")}
  </channel>
</rss>
`;

    return new Response(xml, {
        headers: { "content-type": "application/xml; charset=utf-8" },
    });
}
