# Storefront SEO + AI discoverability — implementation plan

Scope: `storefront/`. Grounded in `docs/SEO_BRIEF.md` (verified 2026-10-27) and
`docs/seo-research/00-confirmation.md`. No new npm dependencies.
Env: `storefront/.env.example` (read).

## 1. Decisions and rejected tactics

| Decision | Source | Why |
| --- | --- | --- |
| Indexable `/products/<slug>` and `/collections/<slug>`; cards link to them | merchant-listing | Purchase must happen on the page; the modal (`Collection.tsx:184-226`) is not a URL |
| Canonical product URL + `?variant=` for selection | product-variants | Variants need a distinct selectable URL; query params allowed |
| `ProductGroup` only for ≥2 variants | product-variants | Single-variant products are plain `Product`; group carries `productGroupID` |
| Product markup in the initial HTML | merchant-listing | Build-time render, not client-injected |
| `Offer` from real price/currency/availability | product-snippet, merchant-listing | Price must be > 0; values come from the catalog API |
| No `aggregateRating`/`review` | brief §7.1 | Testimonials are "Illustrative community stories" (`sections.tsx:342`) |
| `Organization.logo` only for a crawlable ≥112×112 URL | organization | `brand.logoUrl` empty, wordmark is a data URL, `icon.svg` is 64×64 |
| No `address`/`telephone`/`email`/`sameAs`, and no `Offer` policy or expiry fields (`shippingDetails`, `hasMerchantReturnPolicy`, `priceValidUntil`) | organization, merchant-listing, brief §7.3-7.4 | `contact.*` is empty (`niththigal-content.tsx:429-433`); no rate or expiry exists |
| No `SearchAction` | brief §7.5 | Search is a dialog, not a URL |
| `FAQPage` only on `/faq`, no rich-result claim | faqpage | Google retired the FAQ rich result in 2026 |
| `llms.txt` as a convention | llmstxt.org, ai-features | A proposal; Google requires no AI file |
| Google-Extended omitted | brief §4.4, confirmation | Its official doc was never verified; record, do not guess |
| No invented `age_group`/`gender`/`color` | merchants spec | Required for Apparel & Accessories listings but absent from the catalog |
| Absolute URLs from `NEXT_PUBLIC_SITE_URL` | brief §7.10 | Local fallback `http://localhost:3001` |

## 2. File ownership (one owner each)

**Foundation engineer**
- `src/lib/seo.ts` — new; contract in §3.
- `src/lib/niththigal-content-data.ts` — new; types, defaults, sections, `mergeNiththigal`, `countCopy`, `yearCopy`; no `"use client"`.
- `src/lib/site-content-server.ts` — new; cached content fetch, defaults fallback.
- `src/lib/catalog-server.ts` — new; cached catalog fetch, validation, sort, indexes, snapshot fallback.
- `src/components/seo/JsonLd.tsx` — new; server component, one `@graph` script.
- `src/app/layout.tsx` — async metadata/render, provider props, preconnect, global JSON-LD, `lang`.
- `src/lib/niththigal-content.tsx` — re-export the data module; provider takes `initialContent`.
- `src/components/niththigal/NtCatalogContext.tsx` — takes `initialProducts`/`initialSlugs`, exposes `slugByProductId` and `categorySlugs`.
- `scripts/build-static-isolated.mjs` — new; isolated build.
- `package.json` — add `seo:build`, `seo:audit`, `seo:indexnow`.
- `next.config.ts` — review only; keep `output`, `images.unoptimized`, `turbopack.root`.
- `docs/SEO_CONTRACT.md` — new; exports, data flow, slugs, schema, honesty rules, audit ids.

**Product page engineer**
- `src/app/products/[slug]/page.tsx`, `src/app/collections/[category]/page.tsx`,
  `src/components/product/ProductPurchase.tsx`,
  `src/components/product/ProductGridCard.tsx`,
  `src/components/niththigal/Collection.tsx` (real product links + category link row).

**Machine-readable engineer**
- `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/llms.txt/route.ts`,
  `src/app/llms-full.txt/route.ts`, `src/app/merchant-feed.xml/route.ts`,
  `scripts/seo-audit.mjs`, `scripts/indexnow.mjs`.

**Editorial engineer**
- `src/app/about/page.tsx`, `src/app/faq/page.tsx`, `src/app/shipping-returns/page.tsx`,
  `src/app/jewellery-care/page.tsx`, `src/app/privacy/page.tsx`,
  `src/components/niththigal/NtFooter.tsx` (policy actions become real anchors),
  `src/app/page.tsx` (server component, CMS order, AEO block),
  `src/components/niththigal/sections.tsx` (semantics/images only),
  `src/components/niththigal/NtHeader.tsx` (prefix hash hrefs with `/`; non-blocking).

**Integration engineer (after the parallel phase)**
- `src/app/checkout/layout.tsx` — new; title + `robots: { index: false, follow: false }`.
  Required because `checkout/page.tsx:1` is a client component and cannot export metadata.
- Any other file, only to fix build/audit failures.

Shared-file exception: `src/lib/niththigal-content-data.ts` is Foundation's;
Editorial may make one scoped edit after Foundation, limited to
`NITHTHIGAL_DEFAULTS.footer.columns` and the `info.*` prose.

## 3. `src/lib/seo.ts` contract

Isomorphic: no `fs`, no `next/headers`, no PocketBase instance; type-only imports allowed.

```ts
import type { StorefrontProduct } from "@/lib/pocketbase";

export const SITE_URL: string;        // no trailing slash; NEXT_PUBLIC_SITE_URL ??
                                      // NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3001"
export const SITE_NAME: string;       // "Niththigal"
export const SITE_DESCRIPTION: string; // layout.tsx:45-46 text, verbatim
export const SITE_LANGUAGE: string;   // "en"
export const CONTENT_UPDATED: string; // "2026-10-28"; bump only on a copy change
export const CURRENCY: string;        // "INR"

export type JsonLdNode = Record<string, unknown>;
export type ItemSeo = { name: string; url: string; imageUrl?: string | null };

export function absoluteUrl(path: string): string;
// "/" -> SITE_URL + "/"; "/about" -> SITE_URL + "/about"; absolute http(s) unchanged.
export function absoluteAssetUrl(value?: string | null): string | null;
// null for "", data:, blob:, javascript:, mailto:, tel:, whatsapp.net; else absolute.
export function slugify(value: string): string;
// NFKD, strip marks, lower, "&" -> " and ", non [a-z0-9] -> "-", trim, max 80, "" if none.
export function productSlug(p: Pick<StorefrontProduct, "id" | "sku" | "name">): string;
// slugify(sku) || slugify(name) || "product-" + slugify(id) || "product"
export function productPath(slug: string): string;   // "/products/" + slug
export function categorySlug(name: string): string;  // slugify(name) || "jewellery"
export function categoryPath(slug: string): string;  // "/collections/" + slug

export function buildProductSlugIndex(
    products: { id: string; sku?: string; name: string }[]
): Record<string, string>; // sorted (sku||name||id), duplicates get "-2", "-3"; id -> slug

export function buildCategoryIndex(
    products: { category?: string }[]
): { name: string; slug: string; count: number }[];
// Earrings/Necklaces/Bangles first, then localeCompare; duplicate slugs get "-2".

export const GOOGLE_PRODUCT_CATEGORY_IDS: Readonly<Record<string, number>>;
// earrings 194, necklaces 196, bangles/bracelets 191, rings 200, anklets 189,
// charms/pendants 192, sets 6463, jewellery/jewelry 188
export function googleProductCategoryId(category?: string | null): number | null;
// case-insensitive singular/plural; null when unmapped (never a guess)

export function serializeJsonLd(value: unknown): string;
// JSON + escape < > & U+2028 U+2029; "{}" on stringify failure.
export function jsonLdGraph(nodes: (JsonLdNode | null | undefined)[]): JsonLdNode;
// { "@context": "https://schema.org", "@graph": nodes.filter(Boolean) }

export function organizationJsonLd(input?: {
    name?: string; description?: string; logoUrl?: string | null;
    sameAs?: string[]; telephone?: string; email?: string;
}): JsonLdNode;
// OnlineStore, @id SITE_URL/#organization, name, url, optional description/logo/
// sameAs/contactPoint. Never address, aggregateRating, review, foundingDate.

export function webSiteJsonLd(input?: { name?: string }): JsonLdNode;
// WebSite, @id SITE_URL/#website, url, name, inLanguage, publisher @id.
// Never potentialAction.

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLdNode | null;
// null when < 2; BreadcrumbList with ListItem{position,name,item}.

export interface ProductSeoInput {
    product: StorefrontProduct; url: string; imageUrl: string | null;
    categoryId: number | null; brandName?: string; // defaults to SITE_NAME
}
export function productJsonLd(input: ProductSeoInput): JsonLdNode;
// Product, @id url+"#product", name, sku, brand, description?, image?, category?,
// material?, offers? = Offer{price, priceCurrency "INR", availability InStock|
// OutOfStock, itemCondition NewCondition, url}. No offers when price <= 0.

export interface ProductGroupSeoInput {
    product: StorefrontProduct; url: string; imageUrl: string | null;
    categoryId: number | null; brandName?: string; variesBy?: "size";
    variants: { id: string; label: string; url: string; stock: number }[];
}
export function productGroupJsonLd(input: ProductGroupSeoInput): JsonLdNode | null;
// null when < 2 variants; ProductGroup, @id url+"#productgroup", name,
// productGroupID, url, variesBy?, hasVariant: Product[] (each: @id variant.url+
// "#product", name, image?, brand, isVariantOf {@id group}, offers as Product)

export function itemListJsonLd(items: ItemSeo[], name?: string): JsonLdNode | null;
// null when empty; ItemList{name?, numberOfItems, itemListElement: ListItem[]}
export function collectionPageJsonLd(input: {
    url: string; name: string; description?: string; items: ItemSeo[];
}): JsonLdNode;
// CollectionPage, @id url+"#collection", url, name, description?, isPartOf @id,
// mainEntity: itemListJsonLd(...)
export function faqPageJsonLd(input: {
    url: string; items: { question: string; answer: string }[];
}): JsonLdNode | null;
// null when empty; FAQPage, @id url+"#faq", mainEntity: Question{name,
// acceptedAnswer: Answer{text}}
export function webPageJsonLd(input: {
    type?: "WebPage" | "AboutPage"; url: string; name: string; description?: string;
}): JsonLdNode;
// { @type, @id url+"#webpage", url, name, description?, inLanguage, isPartOf,
//   dateModified: CONTENT_UPDATED }
```

`JsonLd.tsx`: `JsonLd({ nodes, id }: { nodes: (JsonLdNode | null | undefined)[]; id?: string })`
renders `serializeJsonLd(jsonLdGraph(nodes))` in one `application/ld+json` script, or `null`.

## 4. Build-time data flow

1. `layout.tsx` becomes `async`; `generateMetadata()` and the layout call
   `getSiteContent()` and `getBuildCatalog()`.
2. `getSiteContent(): Promise<{ content: NiththigalContent; source: "erp" | "defaults" }>`
   GETs `${ERP_API_URL || NEXT_PUBLIC_ERP_API_URL || "http://127.0.0.1:3000"}/api/storefront/content`
   (http/https only, 5 s timeout, `no-store`), reads `payload.niththigal`
   as the client does (`niththigal-content.tsx:823`), merges over defaults. Any throw →
   defaults + `console.warn`; never fails the build.
3. `getBuildCatalog(): Promise<BuildCatalog>`, where `BuildCatalog = { products:
   StorefrontProduct[]; slugByProductId: Record<string, string>; productBySlug:
   Record<string, StorefrontProduct>; categories: BuildCategory[]; source: "erp" |
   "snapshot" | "empty" }`. Validates `{ success, products }`, drops malformed entries, applies the
   `NtCatalogContext.tsx:35-46` sort, builds both indexes. Failure → `STOREFRONT_CATALOG_SNAPSHOT`
   (JSON file) → `[]`. `INITIAL_CATALOG_LIMIT = 120` caps the client payload; the full list
   stays server-only.
4. Both wrap React `cache()` **and** a module-level promise: `cache()` dedupes only
   within one render pass, and one worker renders many pages.
5. `layout.tsx` passes `initialContent`, `initialProducts` (capped) and `initialSlugs` into
   the providers, so the first HTML carries CMS copy, the grid and real product links.
6. Providers keep their post-mount refresh (no hydration mismatch). `NtCatalogProvider`
   sets `loading` only when it has no products and recomputes its slug index on refresh.
7. Product links read `slugByProductId[id] ?? productSlug(product)`; category links read
   `categorySlugs[name] ?? categorySlug(name)`, so links cannot diverge.

## 5. URLs and slugs

`/` · `/about` · `/faq` · `/shipping-returns` · `/jewellery-care` · `/privacy` ·
`/collections/<categorySlug>` · `/products/<productSlug>` ·
`/products/<productSlug>?variant=<id>`. No trailing slash (default
`trailingSlash: false`); canonicals and sitemap use the same form.

Slug = `sku`, else `name`, else `product-<id>`. SKUs are unique, ASCII, readable
(`BGL-NILA-HERITAGE` → `bgl-nila-heritage`) and survive renames. Collisions resolve by
sorted order with `-2`, `-3`; categories likewise. A SKU rename breaks its URL (no
redirects in static export): treat SKUs as immutable or keep a host redirect map.

## 6. JSON-LD per page

Global via layout: `OnlineStore` + `WebSite`.

| Page | Types | Include | Omit |
| --- | --- | --- | --- |
| `/` | ItemList (global adds OnlineStore + WebSite) | `name`, `numberOfItems`, `ListItem{position,name,url}` | FAQPage, Product, BreadcrumbList |
| `/products/[slug]` | Product, or ProductGroup when ≥2 variants; BreadcrumbList (Home › Collection › Product) | `name`, `sku`, `brand`, `image` (crawlable), `description` (catalog text), `category`, `material`, `offers{price,INR,availability,NewCondition,url}`; group: `productGroupID`, `url`, `variesBy` only for bangle sizes, `hasVariant` | `aggregateRating`, `review`, `priceValidUntil`, `shippingDetails`, `hasMerchantReturnPolicy`, GTIN/MPN, per-variant `sku` |
| `/collections/[category]` | CollectionPage (embedded ItemList) + BreadcrumbList | name, description, url, product URLs | any Product/Offer |
| `/about` | AboutPage + BreadcrumbList | name, description, url, `dateModified` | duplicate Organization |
| `/faq` | FAQPage + BreadcrumbList | every visible CMS Q&A | rich-result claims |
| policy pages | WebPage + BreadcrumbList | name, description, url, `dateModified` | rates, fees |
| `/checkout` | none | — | everything; `noindex, nofollow` |

Breadcrumbs are user paths, not URL mirrors.

## 7. robots.txt

`src/app/robots.ts`:

- `*` → `Allow: /`, `Disallow: /checkout`.
- Explicit groups (same rules) for Googlebot, Bingbot, Applebot, OAI-SearchBot,
  ChatGPT-User, PerplexityBot, Claude-SearchBot, Claude-User.
- GPTBot, ClaudeBot, CCBot → `Disallow: /` when `SEO_BLOCK_AI_TRAINING === "true"`,
  else `Allow: /`; always emitted, explicit.
- Google-Extended **omitted now**: the brief (§4.4) and confirmation record that its
  official documentation was never verified. Add it to the same switch only after
  verification; the report must say so.
- `Sitemap: ${SITE_URL}/sitemap.xml`. No `Crawl-delay`, no `Host`, no `/_next` block.

## 8. Discovery artifacts

- **sitemap**: home, five editorial pages, non-empty collections, all products; absolute,
  no `/checkout`; `lastModified: CONTENT_UPDATED` for editorial pages only (no product
  timestamps); images only when crawlable; no `changeFrequency`/`priority`.
- **llms.txt / llms-full.txt** (`force-static`): H1, blockquote summary, H2
  Pages/Collections/Products/Policies, `[name](absolute url): note`, plus the full
  version's real product details (price, availability, material, plating, stone, variants,
  care), CMS FAQ, policy prose and contact channels when non-empty; both note that this is
  a community convention, not an official standard.
- **merchant feed** (`/merchant-feed.xml`, `force-static`): RSS 2.0 + `g:` namespace, one
  item per variant with positive price and crawlable image. `g:id =
  <product.id>_<variant.id>` (≤50, unique), title ≤150, description ≤5000 (catalog text or
  a factual `name — category by Niththigal`), absolute `link`/`image_link`,
  `availability`, `price="1299.00 INR"`, `brand`, `condition=new`,
  `identifier_exists=no`, `google_product_category` only when mapped, `item_group_id` for
  multi-variant, `size` only for bangle labels. No shipping/tax/GTIN/MPN. Escape all text;
  `application/xml; charset=utf-8`.
- **IndexNow**: validate `INDEXNOW_KEY` (`^[A-Za-z0-9-]{8,128}$`, `process.env` then a
  minimal `.env.local` parser), write `public/<key>.txt` if missing, require an `https`
  `SITE_URL` with a non-loopback/private host, read the isolated
  `out/sitemap.xml` (or `--urls`), POST `{ host, key, keyLocation, urlList }` (≤10,000) to
  `https://api.indexnow.org/indexnow`, print status, exit non-zero on failure. 200 means
  received, not indexed.
- **Network safety**: outbound calls accept `http:`/`https:` only; no untrusted XML is
  parsed (the feed is generated; the audit uses a tag-balance scanner).

## 9. Performance and accessibility

- `Collection` images keep 1024×1024 and `loading="lazy"`, add `decoding="async"`; the
  placeholder gets `alt=""`; `.product-image` reserves `aspect-ratio: 1/1.05` (no CLS).
- Product page: one H1 (product name); primary image `loading="eager"`,
  `fetchPriority="high"`, `decoding="async"`, explicit dimensions in an aspect-ratio box.
  Grids reuse `product-grid`/`product-card`.
- `sections.tsx`: heading hierarchy only (Hero keeps the sole home H1); Instagram images
  gain width/height/`decoding`; hero keeps `fetchPriority="high"` (`sections.tsx:159`).
- `layout.tsx` calls `preconnect()` (React 19) only for absolute http(s) ERP/PocketBase
  origins distinct from `SITE_URL`. No new fonts, blocking JS, or dependencies;
  `JsonLd` is server-only and `ProductPurchase` is the only new client component.
- Product page: labelled variant `<select>`, real `<a>` links, `aria-live` on
  add-to-cart; the selected variant drives stock, price and add-to-cart, and `?variant=`
  is read in an effect inside `Suspense` so prerender and hydration agree.

## 10. Verification

```
cd storefront
npm run build
npm run seo:audit
```

The build goes through `scripts/next-run.mjs`, which preloads the repo's
`fix-exfat-readlink.cjs` and runs `next build --webpack`. Turbopack on Windows cannot
write the `node:fs` external chunk filename, and webpack otherwise aborts on the exFAT
`readlink` EISDIR. Stop the local dev servers before a local build: they can hold handles
in `storefront/out` and make the export cleanup fail with EPERM/ENOTEMPTY. CI and Docker
do not have this problem. For an offline build, set `STOREFRONT_CONTENT_SNAPSHOT` and
`STOREFRONT_CATALOG_SNAPSHOT`; for a live local ERP, set
`STOREFRONT_ALLOW_LOCAL_ERP=true`.

Audit ids: `robots-exists`, `robots-sitemap`, `robots-ai-groups`,
`robots-checkout-blocked`, `robots-no-asset-block`, `robots-training-groups`;
`sitemap-exists`, `sitemap-absolute`, `sitemap-no-checkout`, `sitemap-pages`,
`sitemap-products-match`, `sitemap-collections-match`, `sitemap-host` (localhost warns); per page `html-lang`, `html-title` (unique), `html-description`,
`html-canonical` (absolute, self), `html-h1` (exactly one), `html-no-noindex`, plus
`checkout-noindex`, `internal-links-resolve`; `ldjson-parses`, `ldjson-no-forbidden`
(no `aggregateRating`, `review`, `SearchAction`, `priceValidUntil`, `shippingDetails`),
`ldjson-no-data-urls`, `ldjson-organization`,
`ldjson-website`, `ldjson-breadcrumb`, `ldjson-product` (fields, price > 0, INR,
availability, unique variant URLs), `ldjson-collection` (CollectionPage + ItemList, no
Product), `ldjson-faq`, `ldjson-home-itemlist` (home links a product when products exist);
`llms-h1`, `llms-links`, `llms-full-h1`, `llms-full-products`;
`feed-wellformed`, `feed-required-fields`, `feed-unique-ids`, `feed-no-checkout`.
`fail` exits 1, `warn` does not.

Acceptance: build exit 0; audit exit 0 with zero fails; `out/products/<slug>.html` carries
the name, price and Product/ProductGroup JSON-LD in the initial HTML; robots has the
sitemap and every group; the sitemap is absolute and checkout-free; both llms files start
with `# `; the feed has one item per variant; `/checkout` is noindex; no
`aggregateRating`/`review`; canonicals are absolute; home HTML has CMS copy and a
`/products/` link.

## 11. Risks, rollback, unverified

- **Build-time ERP dependency**: no ERP → defaults + empty catalog (no product pages, empty
  feed). Build with the ERP reachable or set `STOREFRONT_CATALOG_SNAPSHOT`;
  `next/font/google` needs network too.
- **Static staleness**: CMS, price and stock need a rebuild; the client refresh updates the
  UI, not metadata/JSON-LD/sitemap/feed.
- **SKU renames break URLs** (no redirects in static export).
- **Merchant gap**: `age_group`/`gender`/`color` are required for Apparel & Accessories
  (166) and absent; omitted, so Google may reject those items for free listings.
- **No crawlable logo or data-URL images**: `Organization.logo` and image-dependent
  merchant fields stay omitted until the CMS supplies hosted assets (logo ≥112×112).
- **Extensionless routing**: `out/products/x.html` must serve at `/products/x`; verify
  host mapping on the first deploy (`next start` routes natively).
- **Rollback**: revert the commit — no schema change, no data write, no new dependency;
  redeploy the previous export. `public/<INDEXNOW_KEY>.txt` is the only written file.
- **Unverified**: indexing/ranking, AI-answer inclusion, Merchant Center approval, field
  Core Web Vitals, production env values, Google-Extended, Cloudflare Pages routing before
  deploy, and the live CMS payload (only defaults/merge logic read).
