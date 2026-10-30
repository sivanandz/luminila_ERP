# Storefront SEO contract

This is the maintenance contract for the storefront's technical SEO and AI-discovery
surfaces. It describes what the code emits, where the data comes from, and what must
never be added without a real source. The grounded rules and citations live in
[`SEO_BRIEF.md`](./SEO_BRIEF.md); the implementation plan is
[`SEO_PLAN.md`](./SEO_PLAN.md).

## 1. Module inventory — every export

### `storefront/src/lib/seo.ts` (isomorphic)

Imports no `fs`, no `next/headers`, and no PocketBase client instance (the
`StorefrontProduct` import is type-only).

| Export | Behaviour |
| --- | --- |
| `SITE_URL` | `NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_STOREFRONT_URL` → `http://localhost:3001`; trailing slash removed; malformed or non-http(s) values fall back locally |
| `SITE_NAME` | `Niththigal` |
| `SITE_DESCRIPTION` | the storefront's existing root description |
| `SITE_LANGUAGE` | `en` |
| `CONTENT_UPDATED` | editorial `dateModified`; bump only on a real copy change |
| `CURRENCY` | `INR` |
| `JsonLdNode` | `Record<string, unknown>` |
| `ItemSeo` | `{ name, url, imageUrl? }` |
| `absoluteUrl(path)` | absolute http(s) unchanged; `""` → `SITE_URL/`; otherwise `SITE_URL + path` |
| `absoluteAssetUrl(value)` | `null` for empty, `data:`, `blob:`, `javascript:`, `mailto:`, `tel:`, protocol-relative, other schemes and WhatsApp CDN URLs; otherwise absolute |
| `slugify(value)` | NFKD, strip marks, lower-case, `&` → ` and `, non-alphanumeric → `-`, trim, max 80 |
| `productSlug(product)` | `slugify(sku)` → `slugify(name)` → `product-<id>` → `product` |
| `productPath(slug)` | `/products/<slug>` |
| `categorySlug(name)` | `slugify(name)` or `jewellery` |
| `categoryPath(slug)` | `/collections/<slug>` |
| `buildProductSlugIndex(products)` | deterministic id → slug map, sorted by `(sku \|\| name \|\| id)`; duplicate slugs get `-2`, `-3` |
| `buildCategoryIndex(products)` | `{ name, slug, count }[]`; Earrings → Necklaces → Bangles → alphabetical; duplicate slugs get `-2` |
| `GOOGLE_PRODUCT_CATEGORY_IDS` | verified taxonomy ids: earrings 194, necklaces 196, bangles/bracelets 191, rings 200, anklets 189, charms/pendants 192, sets 6463, jewellery/jewelry 188 |
| `googleProductCategoryId(category)` | case-insensitive singular/plural lookup; `null` when unmapped (never a guess) |
| `serializeJsonLd(value)` | JSON with `<`, `>`, `&`, U+2028 and U+2029 escaped; `"{}"` when stringification fails |
| `jsonLdGraph(nodes)` | `{ "@context": "https://schema.org", "@graph": [...non-empty nodes] }` |
| `organizationJsonLd(input?)` | `OnlineStore` `@id <SITE_URL>/#organization`; name, url, return policy; optional description/logo/sameAs/contactPoint |
| `webSiteJsonLd(input?)` | `WebSite` `@id <SITE_URL>/#website`; url, name, `inLanguage`, `publisher` → organization `@id`; never `potentialAction` |
| `breadcrumbJsonLd(items)` | `BreadcrumbList`; `null` with fewer than two steps |
| `productJsonLd(input)` | `Product`; brand, optional sku/description/image/category/material, `offers` only when price > 0 |
| `productGroupJsonLd(input)` | `ProductGroup` + `hasVariant`; `null` with fewer than two variants |
| `itemListJsonLd(items, name?)` | `ItemList`; `null` when empty |
| `collectionPageJsonLd(input)` | `CollectionPage` + embedded `ItemList`; no Product/Offer |
| `faqPageJsonLd(input)` | `FAQPage`; `null` when empty |
| `webPageJsonLd(input)` | `WebPage` / `AboutPage` with `dateModified: CONTENT_UPDATED` |
| `ProductSeoInput`, `ProductGroupSeoInput` | builder input types; `imageUrl` is optional and an absent image behaves like `null` |

### `storefront/src/lib/niththigal-content-data.ts` (server-safe, no `"use client"`)

| Export | Behaviour |
| --- | --- |
| `NtSectionId`, `NtSection`, `NtNavItem`, `NtFooterAction`, `NtFooterLink`, `NtFooterColumn`, `NtHeroSlide`, `NtPromiseItem`, `NtBenefitItem`, `NtTestimonial`, `NtPricingItem`, `NtInstagramPost`, `NtInfoPage`, `NiththigalContent` | CMS content types |
| `NITHTHIGAL_SECTION_LABELS` | section id → editor label |
| `NITHTHIGAL_DEFAULT_SECTIONS` | default section map (ids, order, spacing) |
| `NITHTHIGAL_DEFAULTS` | full default content block |
| `mergeNiththigal(base, patch)` | deep merge over defaults; arrays replace, objects merge, the section map is always completed and re-sorted |
| `countCopy(template, count)` | replaces `{count}` |
| `yearCopy(template)` | replaces `{year}` |

### `storefront/src/lib/niththigal-content.tsx` (client)

| Export | Behaviour |
| --- | --- |
| `NiththigalContentProvider({ children, initialContent? })` | seeds state from server-rendered content, then refreshes from the ERP after mount |
| `useNiththigalContent()` | `{ content, ready }` |
| `export * from "./niththigal-content-data"` | same data API as before |

### `storefront/src/lib/site-content-server.ts` (server only)

| Export | Behaviour |
| --- | --- |
| `SiteContentResult` | `{ content, source: "erp" \| "snapshot" \| "defaults" }` |
| `CONTENT_SNAPSHOT_FILE_NAME` | `content-snapshot.json` |
| `validateErpOrigin(raw)` | validated origin or `null`; http(s) only, no credentials, localhost/loopback/private/reserved refused unless opted in |
| `erpOrigin()` | `ERP_API_URL` → `NEXT_PUBLIC_ERP_API_URL` → `http://127.0.0.1:3000`, validated; `null` when refused (warned once) |
| `storefrontApiEndpoint(endpoint)` | absolute `/api/storefront/*` URL, or `null` with no usable origin |
| `fetchJson(url)` | GET JSON, 5 s timeout, redirects refused; callers degrade |
| `describeError(error)` | short, log-safe failure description |
| `getSiteContent()` | React `cache()` plus module-level promise; never rejects |

### `storefront/src/lib/catalog-server.ts` (server only)

| Export | Behaviour |
| --- | --- |
| `INITIAL_CATALOG_LIMIT` | `120`: client payload cap |
| `SNAPSHOT_FILE_NAME` | `catalog-snapshot.json` |
| `BuildCategory`, `BuildCatalog` | categories, products, slug index, product-by-slug map, `source: "erp" \| "snapshot" \| "empty"` |
| `normalizeProduct(raw)` | validated `StorefrontProduct` or `null`; drops records without id/name, coerces numbers, normalises variants |
| `snapshotRequested(setting)` | true only when the setting is exactly `SNAPSHOT_FILE_NAME` |
| `getBuildCatalog()` | React `cache()` plus module-level promise; never rejects |

The display sort is `sortCatalogProducts` in `storefront/src/lib/catalog-sort.ts`,
shared with `NtCatalogContext`.

### `storefront/src/components/seo/JsonLd.tsx` (server component)

`JsonLd({ nodes, id? })` renders one `application/ld+json` `@graph` script, or
`null` when every node is empty. Never mark it `"use client"`; never inject JSON-LD
from an effect.

### `storefront/src/components/niththigal/NtCatalogContext.tsx` (client)

`NtCatalogProvider({ children, initialProducts?, initialSlugs? })` seeds the grid,
the slug index and the loading flag from the server, then refreshes from the ERP
without replacing server-rendered products with the loading label.
`useNtCatalog()` returns `{ products, loading, categories, filter, setFilter,
refresh, minPrice, slugByProductId }`. `ALL_PIECES` is unchanged.

### `storefront/src/app/layout.tsx`

Async `generateMetadata()` and async `RootLayout`. They fetch content and catalogue
at build time, pass `initialContent` / `initialProducts` / `initialSlugs` to the
providers, and render canonical `/`, Open Graph `siteName`/`locale`, a Twitter
card, robots directives, verification tags from `GOOGLE_SITE_VERIFICATION` /
`BING_SITE_VERIFICATION`, preconnect links for the ERP/PocketBase origins (when
distinct from `SITE_URL`) and the global `OnlineStore` + `WebSite` graph.

### Scripts

| File | Purpose |
| --- | --- |
| `storefront/scripts/build-static-isolated.mjs` | builds the export outside the repository; prints `OUT_DIR` and `BUILD_DIR` |
| `storefront/scripts/next-run.mjs` | launcher for `npm run dev` / `npm run build`; preloads the exFAT readlink fix |
| `storefront/scripts/fix-exfat-readlink.cjs` | converts exFAT's spurious `readlink` `EISDIR` to `EINVAL` (used by both launchers) |
| `storefront/scripts/seo-audit.mjs` | offline audit; `--out <dir> --json` |
| `storefront/scripts/indexnow.mjs` | IndexNow submission |

## 2. Build-time data flow

1. `src/app/layout.tsx` is an async server component. `generateMetadata()` calls
   `getSiteContent()`; the layout calls `getSiteContent()` and `getBuildCatalog()`.
2. `src/lib/site-content-server.ts` GETs the ERP's `/api/storefront/content` once per
   build, merges the `niththigal` block over `NITHTHIGAL_DEFAULTS`, and caches the result
   with React `cache()` plus a module-level promise.
3. `src/lib/catalog-server.ts` GETs `/api/storefront/catalog`, validates and normalises
   every record, sorts with `src/lib/catalog-sort.ts`, and builds the slug index,
   product-by-slug map, and category list. It also caches with `cache()` plus a
   module-level promise.
4. The layout passes `initialContent`, `initialProducts` (capped at
   `INITIAL_CATALOG_LIMIT`) and `initialSlugs` into `NiththigalContentProvider` and
   `NtCatalogProvider`. The first HTML therefore carries the CMS copy, the product grid
   and real product links; the client refresh still updates the UI after hydration.
5. Brand assets that are data URLs are stripped from `initialContent` before it crosses
   to the client, so a 300 KB wordmark cannot bloat every page. The client refresh
   restores the uploaded asset after hydration.
6. ERP failures never fail the build. The order is: live ERP → optional local snapshot
   (`STOREFRONT_CONTENT_SNAPSHOT`, `STOREFRONT_CATALOG_SNAPSHOT`) → defaults / empty. An
   empty catalogue produces no product pages; it never produces fake ones. A successful
   but empty catalogue response is treated as genuinely empty, not as a reason to
   substitute the snapshot.
7. The build-time ERP origin is operator configuration, not request input. Only
   `http:`/`https:` is fetched; URL credentials, localhost, loopback, private, link-local
   and reserved hosts are refused unless `STOREFRONT_ALLOW_LOCAL_ERP=true` (the isolated
   build sets it together with its 127.0.0.1 default). Redirects are refused, so a public
   origin cannot bounce the request to a private host.
8. The build fetch deliberately leaves Next's fetch cache at its default. An explicit
   `cache: "no-store"` marks the route dynamic, and a static export then bails out of
   prerendering (`NEXT_STATIC_GEN_BAILOUT`) instead of using the live response.
9. Snapshot files are read from the build root by the literal names above; no
   environment value can steer the read.

## 3. URLs and slugs

- Origin: `NEXT_PUBLIC_SITE_URL` (or `NEXT_PUBLIC_STOREFRONT_URL`), local fallback
  `http://localhost:3001`. Never hard-code a production domain.
- URLs: `/` · `/about` · `/faq` · `/shipping-returns` · `/jewellery-care` · `/privacy` ·
  `/collections/<categorySlug>` · `/products/<productSlug>` ·
  `/products/<productSlug>?variant=<variantId>`. No trailing slash. `/checkout` is
  `noindex, nofollow` and is excluded from the sitemap and robots.
- Product slug: SKU first (stable, ASCII, readable: `BGL-NILA-HERITAGE` →
  `bgl-nila-heritage`), then name, then `product-<id>`.
- Collisions resolve in `(sku || name || id)` order with `-2`, `-3`; links and the
  sitemap use the same `buildProductSlugIndex` map.
- Category slug: `slugify(name)` or `jewellery`; collisions get `-2`.
- SKU renames change product URLs; static export has no redirects. Treat SKUs as
  immutable or add a host-level redirect map.
- `ProductGroup.productGroupID` is the catalogue record id, not a slug.

## 4. JSON-LD per page

| Page | Types | Notes |
| --- | --- | --- |
| all pages (layout) | `OnlineStore`, `WebSite` | return policy at Organization level; no `SearchAction`; no logo unless a crawlable ≥112×112 URL exists |
| `/` | `ItemList` | real product URLs; no Product/Offer duplication |
| `/products/[slug]` | `Product` or `ProductGroup` + `BreadcrumbList` | `ProductGroup` only for ≥2 variants; each variant Product has its own `sku`, `offers`, `isVariantOf`; `variesBy=size` only for bangles |
| `/collections/[category]` | `CollectionPage` (embedded `ItemList`) + `BreadcrumbList` | no Product/Offer markup on listing pages |
| `/about` | `AboutPage` + `BreadcrumbList` | `dateModified` = `CONTENT_UPDATED` |
| `/faq` | `FAQPage` + `BreadcrumbList` | valid schema.org only; Google retired the FAQ rich result in 2026 |
| policy pages | `WebPage` + `BreadcrumbList` | `dateModified` = `CONTENT_UPDATED` |
| `/checkout` | none | `noindex, nofollow` |

Breadcrumbs describe the user path, not a mirror of the URL. Every JSON-LD document
uses `https://schema.org` as `@context`, is serialized by `serializeJsonLd` (escapes
`<`, `>`, `&`, U+2028/U+2029), and is rendered in the initial HTML by the server
component `JsonLd`. Price/availability/image values come from the catalogue;
descriptions come from the catalogue or visible CMS copy.

## 5. The two corrections to the plan

Both come from the official source documents and override the earlier plan text.

1. **Every variant carries its own identifier.** Each `Product` inside
   `ProductGroup.hasVariant` has a unique `sku` built from the product SKU plus the
   sanitised variant label (or variant id when the label sanitises to nothing), e.g.
   `BGL-NILA-HERITAGE-2.4`, `BGL-NILA-HERITAGE-2.6`. Duplicates inside one group get
   `-2`, `-3`. This is a storefront identifier, never a manufacturer MPN; no `mpn` or
   GTIN field is emitted. `productGroupJsonLd` returns `null` for fewer than two
   variants, so a single-variant product stays a plain `Product`.
2. **`Organization`/`OnlineStore` carries the visible return policy.**
   `hasMerchantReturnPolicy` is
   `{ "@type": "MerchantReturnPolicy", applicableCountry: "IN", returnPolicyCategory:
   "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: 7 }`,
   matching the visible “7-day return promise”. Offer-level `hasMerchantReturnPolicy`,
   `shippingDetails` and `priceValidUntil` stay omitted. The audit's
   `ldjson-no-forbidden` rule must therefore allow `hasMerchantReturnPolicy` **on the
   `OnlineStore` node only**, not inside a Product/Offer.

## 6. Honesty rules (hard)

1. No `aggregateRating` or `review` for the illustrative testimonials. They are
   “Illustrative community stories”, not verified reviews.
2. No invented address, telephone, email, Instagram URL, GTIN, MPN, founding date,
   shipping rate, or `priceValidUntil`. Optional Organization fields are emitted only
   when the CMS supplies a real value; `logo` additionally needs a crawlable URL and a
   known ≥112×112 natural size.
3. No `Offer.shippingDetails` without a real shipping rate. The site says delivery is
   calculated at checkout; that is not a rate. `hasMerchantReturnPolicy` is allowed only
   on the `OnlineStore` node (correction 2).
4. No `SearchAction` unless a working search URL exists. Search is a dialog.
5. No `Organization.logo` from a data URL. A crawlable, hosted, ≥112×112 asset is
   required first.
6. Do not claim FAQ rich results, `llms.txt` as an official standard, or any ranking
   guarantee. Google's AI features require no special AI file or AI-only schema.
7. Absolute URLs always derive from `NEXT_PUBLIC_SITE_URL`; never hard-code a production
   domain.
8. `/checkout` stays `noindex, nofollow` and out of the sitemap.
9. Product/ProductGroup markup must be in the initial HTML, never client-only.
10. `Offer` only when the catalogue price is > 0; `priceCurrency` is always `INR`;
    availability comes from the catalogue stock status.

## 7. Machine-readable surfaces

- `src/app/robots.ts` — `force-static`; `*`, Googlebot/Bingbot/Applebot, and the AI
  search/answer crawlers are allowed with `/checkout` disallowed. GPTBot/ClaudeBot/CCBot
  are emitted as a group; `SEO_BLOCK_AI_TRAINING=true` switches them to `Disallow: /`.
  Google-Extended is intentionally omitted until its official documentation is verified.
- `src/app/sitemap.ts` — `force-static`; static pages, non-empty collections, all
  products; absolute URLs; product images only when crawlable; no `/checkout`.
- `src/app/llms.txt/route.ts`, `src/app/llms-full.txt/route.ts` — `force-static`
  Markdown; the short index and the full product/FAQ/policy guide. They state that
  `llms.txt` is a community convention, not an official standard.
- `src/app/merchant-feed.xml/route.ts` — `force-static` RSS 2.0 with the `g:` namespace;
  one item per sellable variant; required id/title/description/link/image/availability/
  price/brand/condition; `identifier_exists=no`; `item_group_id` for multi-variant
  products; `size` for bangle variants; verified taxonomy ids (Bangles 191, Necklaces
  196, Earrings 194). Products without a crawlable image or a positive price are skipped.
- `scripts/indexnow.mjs` — reads `INDEXNOW_KEY` and `NEXT_PUBLIC_SITE_URL`, writes
  `public/<key>.txt`, and submits the sitemap URLs to `https://api.indexnow.org/indexnow`.

## 8. Verification

```
cd storefront
npm run build                                    # in place; stop dev servers first
npm run seo:audit                                # defaults to storefront/out

# Isolated export (recommended when a dev server or watcher locks out/):
npm run seo:build                                # prints OUT_DIR
node scripts/seo-audit.mjs --out "<OUT_DIR>" --json
```

`npm run build` goes through `scripts/next-run.mjs`, which preloads the exFAT
`readlink` fix and runs `next build --webpack`. Turbopack on Windows cannot write the
`node:fs` external chunk filename. `npm run seo:build`
(`scripts/build-static-isolated.mjs`) copies the app outside the repository, mirrors or
links `node_modules` into a temp cache, loads the same readlink fix, sets
`NEXT_PUBLIC_SITE_URL` / `ERP_API_URL` / `STOREFRONT_ALLOW_LOCAL_ERP`, uses snapshots
when present, and prints `OUT_DIR` / `BUILD_DIR`. CI and Docker do not need it.

The audit is read-only and offline. Its `--json` output is the authoritative list. It
checks robots, sitemap, both llms files, the Merchant feed, every page's title/
description/canonical/H1/noindex state, JSON-LD (`Product`/`ProductGroup` with unique
variant SKUs, `Offer`, `BreadcrumbList`, `Organization`/`OnlineStore` return policy,
`WebSite`, `CollectionPage` without Product markup, `FAQPage`, home `ItemList`), and
every internal link. `warn` does not fail the build.

## 9. Known data gaps

- `Organization.logo`, `sameAs`, `telephone`, `email`, and `address` are omitted because
  the CMS fields are empty or a data URL. Fill them in the CMS and the builders will emit
  them (logo only with a crawlable ≥112×112 asset).
- Merchant Center free listings for Apparel & Accessories may require `age_group`,
  `gender`, and `color`; the catalogue does not supply them, so they are omitted rather
  than guessed.
- The storefront is statically exported. CMS copy, price and stock changes appear in the
  UI after the client refresh but require a rebuild to update metadata, sitemap, JSON-LD,
  `llms.txt` and the feed.
- SKU renames change product URLs; static export has no redirects. Treat SKUs as
  immutable or add a host-level redirect map.
