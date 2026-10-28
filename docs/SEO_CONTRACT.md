# Storefront SEO contract

This is the maintenance contract for the storefront's technical SEO and AI-discovery
surfaces. It describes what the code emits, where the data comes from, and what must
never be added without a real source. The grounded rules and citations live in
[`SEO_BRIEF.md`](./SEO_BRIEF.md); the implementation plan is
[`SEO_PLAN.md`](./SEO_PLAN.md).

## 1. Site constants and URL rules

`src/lib/seo.ts` is isomorphic: it imports no `fs`, no `next/headers`, and no PocketBase
client instance (only type-only imports).

| Export | Behaviour |
| --- | --- |
| `SITE_URL` | `NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_STOREFRONT_URL` → `http://localhost:3001`, trailing slash removed |
| `SITE_NAME` | `Niththigal` |
| `SITE_DESCRIPTION` | the storefront's existing root description |
| `SITE_LANGUAGE` | `en` |
| `CONTENT_UPDATED` | editorial `dateModified`; bump only on a real copy change |
| `CURRENCY` | `INR` |
| `absoluteUrl(path)` | absolute http(s) unchanged; otherwise `SITE_URL + path` |
| `absoluteAssetUrl(value)` | `null` for empty, `data:`, `blob:`, `javascript:`, `mailto:`, `tel:`, protocol-relative and WhatsApp CDN URLs; otherwise absolute |
| `productSlug(product)` | `slugify(sku)` → `slugify(name)` → `product-<id>` |
| `categorySlug(name)` | `slugify(name)` or `jewellery` |
| `buildProductSlugIndex(products)` | deterministic id → slug map; duplicate slugs get `-2`, `-3` |
| `buildCategoryIndex(products)` | Earrings → Necklaces → Bangles → alphabetical, with counts |
| `googleProductCategoryId(category)` | verified taxonomy id or `null`; never guesses |

URLs: `/` · `/about` · `/faq` · `/shipping-returns` · `/jewellery-care` · `/privacy` ·
`/collections/<categorySlug>` · `/products/<productSlug>` ·
`/products/<productSlug>?variant=<variantId>`. No trailing slash. `/checkout` is
`noindex, nofollow` and is excluded from the sitemap and robots.

## 2. Build-time data flow

1. `src/app/layout.tsx` is an async server component. `generateMetadata()` and the layout
   call `getSiteContent()` and `getBuildCatalog()`.
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
   empty catalogue produces no product pages; it never produces fake ones.
7. The build-time ERP origin is operator configuration, not request input. Loopback,
   private and reserved hosts are refused unless `STOREFRONT_ALLOW_LOCAL_ERP=true`.
   Redirects are refused.

## 3. JSON-LD per page

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

Every JSON-LD document uses `https://schema.org` as `@context`, is serialized by
`serializeJsonLd` (escapes `<`, `>`, `&`, U+2028/U+2029), and is rendered in the initial
HTML by the server component `JsonLd`. Price/availability/image values come from the
catalogue; descriptions come from the catalogue or visible CMS copy.

## 4. Honesty rules (hard)

1. No `aggregateRating` or `review` for the illustrative testimonials.
2. No invented address, telephone, email, Instagram URL, GTIN, MPN, founding date,
   shipping rate, or `priceValidUntil`.
3. No `Offer.shippingDetails` without a real shipping rate. The site says delivery is
   calculated at checkout; that is not a rate.
4. No `SearchAction` unless a working search URL exists. Search is a dialog.
5. No `Organization.logo` from a data URL. A crawlable, hosted, ≥112×112 asset is
   required first.
6. Do not claim FAQ rich results, `llms.txt` as an official standard, or any ranking
   guarantee. Google's AI features require no special AI file or AI-only schema.
7. Absolute URLs always derive from `NEXT_PUBLIC_SITE_URL`; never hard-code a production
   domain.
8. `/checkout` stays `noindex, nofollow` and out of the sitemap.

## 5. Machine-readable surfaces

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

## 6. Verification

```
cd storefront
npm run build
npm run seo:audit
```

`npm run build` uses `scripts/next-run.mjs`, which preloads
`scripts/fix-exfat-readlink.cjs` and runs `next build --webpack`. Stop local dev servers
before building: they can hold `storefront/out` handles on Windows and make the export
cleanup fail. CI and Docker are unaffected.

The audit is read-only and offline. It fails on missing robots/sitemap/llms/feed,
non-absolute or checkout sitemap URLs, missing or duplicate titles/descriptions,
non-self canonicals, wrong H1 counts, unintended noindex, unparsable JSON-LD, forbidden
rating/review/shipping/expiry/SearchAction fields, data-URL images in JSON-LD, missing
Product/Offer fields, duplicate variant SKUs, collections that contain Product markup,
broken internal links, or a feed missing required fields. `warn` does not fail the build.

## 7. Known data gaps

- `Organization.logo`, `sameAs`, `telephone`, `email`, and `address` are omitted because
  the CMS fields are empty or a data URL. Fill them in the CMS and the builders will emit
  them.
- Merchant Center free listings for Apparel & Accessories may require `age_group`,
  `gender`, and `color`; the catalogue does not supply them, so they are omitted rather
  than guessed.
- The storefront is statically exported. CMS copy, price and stock changes appear in the
  UI after the client refresh but require a rebuild to update metadata, sitemap, JSON-LD,
  `llms.txt` and the feed.
- SKU renames change product URLs; static export has no redirects. Treat SKUs as
  immutable or add a host-level redirect map.
