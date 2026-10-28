# 00 — Source confirmation and storefront audit

Date: 2026-10-28. Scope: the eight assigned URLs plus the eight assigned storefront
files. No other page or source file was read. Build output was inspected, not rebuilt.

## Sources verified

| # | URL | Result |
| --- | --- | --- |
| 1 | https://developers.google.com/search/docs/appearance/ai-features | Loaded |
| 2 | https://developers.google.com/search/docs/appearance/structured-data/merchant-listing | Loaded |
| 3 | https://developers.google.com/search/docs/appearance/structured-data/product-variants | Loaded |
| 4 | https://developers.google.com/search/docs/appearance/structured-data/organization | Loaded |
| 5 | https://developers.openai.com/api/docs/bots | Loaded |
| 6 | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler | Loaded |
| 7 | https://docs.perplexity.ai/guides/bots | Loaded |
| 8 | https://llmstxt.org/ | Loaded |

Pages 1 and 4 were served in Japanese. The text is the official content; the quotes
below are translated only where noted.

## Requirements extracted

**AI features (source 1).** No extra requirement exists for AI Overviews or AI Mode
beyond being indexed, eligible for a snippet, and meeting Search's technical
requirements: "AI による概要や AI モードにコンテンツが表示されるための追加の要件はなく"
and "新たにコンピュータが解読可能なファイルや AI テキスト ファイル、マークアップを
作成する必要はありません." Structured data must match visible text. `llms.txt` is not
mentioned. Meeting requirements does not guarantee inclusion.

**Merchant listings (source 2).** Product requires `name`, `image`, `offers`; the
offer must be an `Offer` where the merchant is the seller, not an `AggregateOffer`.
Offer requires a current price above zero and a currency (`price` + `priceCurrency`,
or `priceSpecification`). Recommended Product: `brand.name`, `category`,
`description`, `color`, `material`, `sku`, `mpn`, GTIN, `size`, `isVariantOf`,
`inProductGroupWithID`. Recommended Offer: `availability`, `itemCondition`,
`hasMerchantReturnPolicy`, `priceValidUntil`, `shippingDetails`, `url`, `validFrom`,
`validThrough`. Only pages where a shopper can complete a purchase are eligible;
pages that merely link elsewhere are not. Default shipping/return policy belongs on
`Organization`; Offer-level policy is for overrides or where no default exists.

**Product variants (source 3).** `ProductGroup` is the parent, `Product` each variant;
`productGroupID` on the group or `inProductGroupWithID` on each variant; variants need
a unique ID such as `sku`. `variesBy` accepts `color`, `size`, `suggestedAge`,
`suggestedGender`, `material`, `pattern`. Every variant must be directly selectable
through its own distinct URL (query parameters allowed) that shows the correct image,
price, availability and add-to-cart. Single-page sites may use `ProductGroup.url`;
multi-page sites must not.

**Organization (source 4).** No required properties: "必須プロパティはありません."
Recommended: `name`, `url`, `logo`, `sameAs`, `email`, `telephone`, `contactPoint`,
`address`. Logo must be at least 112 × 112 px, crawlable/indexable, a Google Images
format, on a white background. Prefer `OnlineStore` over `OnlineBusiness`. Phone
numbers include country and area codes.

**Crawler controls (sources 5–7).** OAI-SearchBot (ChatGPT search inclusion), GPTBot
(training), ChatGPT-User (user-triggered), OAI-AdsBot (ad landing pages) are separate
controls; robots changes take about 24 hours. ClaudeBot trains, Claude-User fetches on
user request, Claude-SearchBot indexes for search relevance; all honour robots.txt and
a non-standard `Crawl-delay`. PerplexityBot indexes for Perplexity search and is not
used for foundation-model training; Perplexity-User is user-requested and generally
ignores robots.txt.

**llms.txt (source 8).** A proposal, not a standard: "A proposal to standardise on
using an /llms.txt file…" and "The llms.txt specification is open for community
input." It may live at the root or any subpath; an H1 is the only mandatory section,
followed by a blockquote summary and optional H2 link lists. Sitemaps are explicitly
not a substitute for it.

## Audit findings (verified in this session)

The build output inspected is `storefront/out`, dated 28-10-2026 15:26. It was not
produced by this audit; the findings below come from `findstr`/`node` reads of that
artifact and from the assigned source files.

### High

1. **No product URL exists, so merchant-listing eligibility is impossible.**
   `storefront/src/app/page.tsx:22` renders one page; the only other route is
   `/checkout` (`dir /b src\app` returned `checkout`, `layout.tsx`, `page.tsx` plus
   CSS/icon only). Product cards link to `#${product.id}` and call `preventDefault`
   (`Collection.tsx:184-190`, `Collection.tsx:220-226`), and category filters are
   buttons (`Collection.tsx:94-112`). No page focuses on one product or one set of
   variants, and the bangle sizes 2.4/2.6/2.8 have no distinct URL, contradicting the
   variant-source requirement that each variant be selectable at its own URL.

2. **No Product, Offer, ProductGroup or Organization structured data is emitted.**
   `node -e` over `out/index.html` and `out/checkout.html` returned `ldjson 0` for
   both. `layout.tsx:42-61` defines only title/description/openGraph; there is no
   JSON-LD component anywhere in the assigned files, and `page.tsx:1` is a client
   component. Product names from the brief's catalog (`Nila Heritage`, `Lakshmi
   Temple`, `Malar Temple`) are absent from `out/index.html`
   (`findstr` → `PRODUCTS=NOT_FOUND`), while the hero copy is present
   (`HERO_COPY=FOUND`), confirming products are client-fetched only.

3. **The catalog is fetched in the browser, so price/availability cannot be in the
   initial HTML even after markup is added.** `pocketbase.ts:107-124` fetches
   `/api/storefront/catalog` at call time and `Collection.tsx:120-124` renders the
   loading/empty state; `LOADING_LABEL=FOUND` in `out/index.html`. Per the brief
   (§2.3, brief-sourced, not re-surfaced by the fetched page), Product markup should
   be in the initial HTML; fast-changing price and availability are exactly the case
   where client-only markup is unreliable.

### Medium

4. **`/checkout` is indexable and duplicates the homepage metadata.**
   `out/checkout.html` contains the same `<title>` and description as the homepage
   and `robotsmeta 0` (node count), and `checkout/page.tsx:1-28` declares no
   `metadata` or robots directive. A transactional page should be
   `noindex, nofollow` (brief §7 rule 8) and must not compete with the homepage.

5. **No canonical URL on any route.** `canonical 0` in both `out/index.html` and
   `out/checkout.html`; `layout.tsx:42-61` has no `alternates.canonical`. With
   hash-only product links and client-side filters, no canonical strategy exists for
   the one indexable page.

6. **No `robots.txt` and no `sitemap.xml`.** `dir /b public` returned only
   `instagram` and `niththigal`; `dir /b out` contains no `robots.txt` or
   `sitemap.xml`; `src/app` has no `robots.ts`/`sitemap.ts`. AI search crawlers
   (OAI-SearchBot, Claude-SearchBot, PerplexityBot) therefore cannot be explicitly
   grouped or pointed at a sitemap, and crawlers have no discovery file at all.
   Because no `robots.txt` exists, nothing is currently disallowed — the gap is
   discovery and control, not a block.

7. **No Organization entity can be emitted honestly today.** `layout.tsx` emits no
   JSON-LD; `niththigal-content.tsx:388` defaults `brand.logoUrl` to `""`,
   `niththigal-content.tsx:430-433` defaults `contact.whatsappPhone`,
   `supportEmail` and `instagramUrl` to `""`, and `niththigal-content.tsx:577`
   defaults the Instagram `ctaHref` to `""` (post URLs at 582, 589, 596 are also
   empty). A crawlable ≥112 × 112 logo and real contact/profile URLs are prerequisites
   per source 4; the brief records the wordmark as a data URL, which cannot serve as
   `logo`.

8. **Policy text has no crawlable URL.** `NtFooter.tsx:17-32` renders every
   non-`none` footer action as a `<button>` that opens a dialog, and
   `niththigal-content.tsx:694-695` points shipping/privacy at `href: "#"`. The
   substantive policy copy exists only as modal strings
   (`niththigal-content.tsx:711-716`), so neither `Organization.hasShippingService`
   / `hasMerchantReturnPolicy` nor Offer-level overrides can reference a page, and no
   crawler or AI answer can read the return policy as a document.

### Low

9. **Product images may be data URLs.** `pocketbase.ts:168-170` prefers
   `rec.image_data` over the hosted URL; `Collection.tsx:193` then uses it as `src`.
   A base64 image is not a crawlable `Product.image` and would invalidate merchant
   listing markup if passed through unchanged.

10. **Absolute URLs resolve to localhost in the inspected build.**
    `layout.tsx:37-40` falls back to `http://localhost:3001`, and
    `out/index.html` contains `og:image` / `twitter:image` =
    `http://localhost:3001/niththigal/hero.webp` (4 `localhost:3001` occurrences).
    The fallback is correct for local work, but the shipped build must set
    `NEXT_PUBLIC_SITE_URL` or every future canonical, JSON-LD and sitemap URL will be
    wrong.

11. **No `llms.txt`.** Absent from `public/` and `out/`. This is optional: source 8
    is a proposal, and source 1 requires no AI file. Listed as a convention gap only,
    and a sitemap does not replace it.

## Not verified / conflicts

- **Brief correction:** `docs/SEO_BRIEF.md` §1 says the layout has no Twitter card.
  The current build emits 7 `twitter:*` tags in both HTML files, derived from
  `openGraph` by Next 16. The finding is stale; no action needed.
- **Not run:** `next build`. The artifact inspected pre-dates this audit.
- **Not verified:** Google-Extended (not among the eight URLs; the brief flags its
  documentation as unverified). No robots group should be written for it here.
- **Brief-sourced only:** the initial-HTML rendering recommendation for Product
  markup. The fetched merchant-listing summary did not restate it.
- **Out of scope:** whether `/api/storefront/catalog` is reachable, and the live
  catalog contents. Product names above are quoted from the brief, not refetched.
- **Honesty constraints unchanged:** the testimonials are labelled "Illustrative
  community stories" (`niththigal-content.tsx:549`) with decorative stars (547); no
  `review`/`aggregateRating` may be derived from them. The FAQ block (638-664) must
  not be marked up as a Google FAQ rich result.
