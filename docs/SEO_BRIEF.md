# Storefront SEO + AI Discoverability Brief

Status: grounded research brief for the Niththigal storefront (`storefront/`).
Verified: 2026-10-27 against the official sources linked below.
Implementation status (2026-10-28): the gaps recorded here were implemented; see
[`SEO_AI_OPTIMIZATION.md`](./SEO_AI_OPTIMIZATION.md). This file remains the pre-change
audit and the source record.
Rule: nothing in this file is an opinion presented as a standard. Where a claim is a
recommendation, a proposal, or a retired feature, it is labelled as such.

---

## 1. What the current storefront actually is

Verified from the repository and a production build:

- Next.js 16.1.0, App Router, React 19, TypeScript, Tailwind 4.
- `storefront/next.config.ts` uses `output: "export"` by default (static export), and
  `images.unoptimized: true`.
- Only two routes exist: `/` (`src/app/page.tsx`) and `/checkout`
  (`src/app/checkout/page.tsx`). A build produces `out/index.html` and
  `out/checkout.html`.
- `src/app/layout.tsx` exports one static `metadata` block. It has `metadataBase`,
  title, description, and Open Graph title/description/image. It has no canonical URL,
  no Twitter card, no robots directives, no verification tags, and no JSON-LD.
- There is no `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, or product feed.
- `src/app/page.tsx` is a client component. It renders sections whose visibility and
  order come from CMS content. The CMS content provider and catalog provider fetch
  from the ERP in `useEffect`, so the first HTML is rendered from defaults/empty state.
- The catalog API (`/api/storefront/catalog`) returned three live products during this
  audit:
  - `BGL-NILA-HERITAGE` — Nila Heritage Bangles, category Bangles, ₹1,299, 11 in stock,
    variants `2.4`, `2.6`, `2.8`.
  - `TMP-NCK-LAKSHMI` — Lakshmi Temple Necklace, category Necklaces, ₹1,899, 6 in stock,
    variant `Standard`.
  - `KND-JHU-MALAR` — Malar Temple Jhumkas, category Earrings, ₹899, 8 in stock,
    variant `Standard`.
  Product image values are hosted paths (`/niththigal/bangles.webp`, etc.), not data URLs.
- The CMS content route (`/api/storefront/content`) returns a `niththigal` block. The
  brand name is `Niththigal`, tagline `Jewellery, with soul`. `contact.whatsappPhone`,
  `contact.supportEmail`, and `contact.instagramUrl` are empty. `brand.logoUrl` is empty;
  `brand.wordmarkUrl` is a data URL (about 336 KB). A data URL is not a crawlable logo
  URL for structured data.
- Product cards link to `#<product id>` and open an in-page quick-view modal. There is
  no indexable product URL.
- Footer shipping/privacy/care links open in-page dialogs. There are no dedicated
  policy pages.
- Testimonials are explicitly labelled "Illustrative community stories" in the CMS
  defaults. They are not verified customer reviews.
- A storefront dev server on port 3001 can hold file handles in `storefront/out` on
  Windows and make `next build` fail with `EPERM`/`ENOTEMPTY` while finalizing the
  export. CI and an isolated build directory avoid this.

---

## 2. Google Search and Google Shopping

### 2.1 Google Search Essentials and content quality

- Google Search Essentials has three parts: technical requirements, spam policies,
  and key best practices. Meeting the technical requirements does not guarantee
  crawling, indexing, or serving.
- Google's guidance for helpful content: make people-first, original, reliable content;
  show clear authorship and explain how content was made (including automation); do not
  mass-produce low-value content, summarize others without added value, invent details,
  or change dates without substantive updates.
- E-E-A-T (experience, expertise, authoritativeness, trustworthiness) is not a specific
  ranking factor in Google's documentation, but Google says trust is the most important
  member of that family, with more weight for YMYL topics.
- Source: https://developers.google.com/search/docs/essentials
- Source: https://developers.google.com/search/docs/fundamentals/creating-helpful-content

### 2.2 Google AI Overviews and AI Mode

- Google states there are no additional requirements for AI Overviews or AI Mode beyond
  being indexed and eligible to be shown with a snippet, and no special schema.org
  markup, machine-readable file, or "AI text file" is needed.
- Google says structured data should match the visible text.
- Source: https://developers.google.com/search/docs/appearance/ai-features

### 2.3 Product snippets and merchant listings

- Product snippets are for product pages where users cannot buy directly. Required:
  `name`; at least one of `review`, `aggregateRating`, or `offers`. `Offer` requires
  `price` or `priceSpecification.price`; recommended `availability`,
  `priceCurrency`, `priceValidUntil`.
- Merchant listings are for pages where the shopper can purchase the product from the
  merchant. Required: `name`, `image`, and `offers` (an `Offer`, not an
  `AggregateOffer`; the merchant must be the seller). `Offer` requires `price` (greater
  than zero) and `priceCurrency`.
- Recommended Product properties include `brand.name`, `category`, `description`,
  `color`, `material`, `sku`, `mpn`, GTIN fields, `size`, `review`, `aggregateRating`.
- Recommended Offer properties include `availability`, `itemCondition`,
  `hasMerchantReturnPolicy`, `shippingDetails`, `priceValidUntil`, `url`,
  `validFrom`, `validThrough`.
- Google recommends Product structured data in the initial HTML. JavaScript-generated
  Product markup can make Shopping crawls less frequent and less reliable, especially
  for fast-changing price and availability.
- Google says global shipping and return policies are best placed under `Organization`;
  Offer-level `shippingDetails` / `hasMerchantReturnPolicy` are for overrides or when
  no standard policy exists.
- Only pages where a shopper can purchase a product are eligible for merchant listing
  experiences. Markup should target one product or variants of the same product, not a
  category or product-list page.
- Source: https://developers.google.com/search/docs/appearance/structured-data/product-snippet
- Source: https://developers.google.com/search/docs/appearance/structured-data/merchant-listing

### 2.4 Product variants

- `ProductGroup` identifies the parent; `hasVariant` holds nested `Product` objects (or
  each variant points back with `isVariantOf`). `productGroupID` must be on the group or
  on each variant via `inProductGroupWithID`.
- `variesBy` supports `color`, `size`, `suggestedAge`, `suggestedGender`, `material`,
  `pattern` (full schema.org URLs).
- Single-page variant sites: one canonical group URL, normally the base URL without a
  variant preselected; `ProductGroup.url` is for single-page sites.
- Multi-page variant sites: do not add `ProductGroup.url`; repeat the complete
  `ProductGroup` definition on every variant page and include full, self-contained
  markup for the entities on that page.
- Every variant must be directly selectable through a distinct URL (query parameters
  are acceptable) that shows the correct image, price, availability, and add-to-cart
  behavior.
- Source: https://developers.google.com/search/docs/appearance/structured-data/product-variants

### 2.5 Organization and breadcrumbs

- Organization structured data has no required properties. Recommended: `address`,
  `alternateName`, `contactPoint`, `description`, `email`, `logo`, `name`, `sameAs`,
  `telephone`, `url`. Use a specific subtype such as `OnlineStore` where it fits.
- `logo` should be at least 112 × 112 px, crawlable/indexable, supported format, checked
  against a white background.
- `sameAs` lists profile URLs on other sites; `contactPoint` should include available
  support channels; phone numbers should include country and area codes.
- Source: https://developers.google.com/search/docs/appearance/structured-data/organization
- `BreadcrumbList` requires `itemListElement` with at least two `ListItem`s, each with
  `position`, `name`, and `item` (the final item's `item` is optional). Google recommends
  a typical user path, not a mirror of the URL structure.
- Source: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb

### 2.6 FAQ rich results are retired

- Google's FAQPage rich result was restricted to well-known authoritative government
  and health sites in September 2023, stopped appearing on 2026-05-07, and its
  documentation was removed on 2026-06-15.
- Consequence: `FAQPage` markup is not a path to a Google FAQ rich result. It can still
  be valid schema.org markup and useful to other consumers, but do not claim a Google
  rich result from it.
- Source: https://developers.google.com/search/docs/appearance/structured-data/faqpage

---

## 3. Google Merchant Center and Shopping feeds

- Required core attributes for Shopping ads and free listings: `id` (max 50 chars,
  unique), `title` (max 150), `description` (max 5,000), `link`, `image_link`
  (JPEG/WebP/PNG/non-animated GIF/BMP/TIFF), `availability`
  (`in_stock`, `out_of_stock`, `preorder`, `backorder`), `price` (numeric + ISO 4217
  currency), `brand` (max 70 chars).
- `condition` is required for used/refurbished, optional for new. `gtin` is conditional
  and strongly recommended when available. `mpn` is required when no manufacturer-
  assigned GTIN. `google_product_category` is optional (one taxonomy path or numeric id).
- Free-listing-specific requirements: `age_group`, `gender`, and `color` are required for
  Apparel & Accessories (ID 166); `size` is required for Clothing (1604) and Shoes (187);
  `item_group_id` is required for all variants.
- Feed format: English attribute names and supported values, one consistent language for
  free text, text/XML/API submission.
- Source: https://support.google.com/merchants/answer/7052112
- Google product taxonomy IDs verified for this brief:
  - 188 — Apparel & Accessories > Jewelry
  - 194 — Apparel & Accessories > Jewelry > Earrings
  - 196 — Apparel & Accessories > Jewelry > Necklaces
  - 191 — Apparel & Accessories > Jewelry > Bracelets
  - 192 — Apparel & Accessories > Jewelry > Charms & Pendants
  - 200 — Apparel & Accessories > Jewelry > Rings
  - 6463 — Apparel & Accessories > Jewelry > Jewelry Sets
  - 189 — Apparel & Accessories > Jewelry > Anklets
  - Source: https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt
- For the current catalog, Bangles maps to the closest taxonomy node, Bracelets (191),
  unless the merchant has a more specific mapping. This is a mapping choice, not a
  Google rule about the word "bangles".

---

## 4. AI crawlers and machine-readable guidance

### 4.1 OpenAI

- `OAI-SearchBot` — search; surfaces sites in ChatGPT search results. Allow its
  robots.txt group for search inclusion.
- `GPTBot` — training; crawls content that may train OpenAI's generative foundation
  models. Disallow its group to opt out of training.
- `OAI-SearchBot` and `GPTBot` robots controls are independent. If both are allowed,
  one crawl may serve both uses. Robots changes can take about 24 hours.
- `ChatGPT-User` — user-triggered browsing/actions in ChatGPT, Custom GPTs, and GPT
  Actions; not automatic web crawling and not used to decide Search inclusion.
- `OAI-AdsBot` — validates safety/policy compliance of submitted ad landing pages; not
  used for training.
- Published IP lists: `https://openai.com/searchbot.json`, `https://openai.com/gptbot.json`,
  `https://openai.com/chatgpt-user.json`, `https://openai.com/adsbot.json`.
- Source: https://developers.openai.com/api/docs/bots

### 4.2 Anthropic

- `ClaudeBot` — collects public web content that may contribute to training Anthropic's
  generative AI models.
- `Claude-User` — retrieves pages when Claude users make requests; blocking it can
  reduce visibility in user-directed search.
- `Claude-SearchBot` — indexes and analyzes content to improve search-result relevance
  and accuracy; blocking it can reduce visibility.
- Anthropic says its bots honor standard robots.txt directives, do not bypass CAPTCHAs,
  and support a non-standard `Crawl-delay` directive. Source IPs are published at
  `https://claude.com/crawling/bots.json`.
- Source: https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler

### 4.3 Perplexity

- `PerplexityBot` — used to surface and link sites in Perplexity search results; not
  used for AI foundation-model crawling. Perplexity recommends allowing it and its
  published IP ranges.
- `Perplexity-User` — fetches pages to answer user questions, with links back to the
  page; not used for crawling or AI training. Because the fetch is user-requested, it
  generally ignores robots.txt rules.
- Source: https://docs.perplexity.ai/guides/bots

### 4.4 Google-Extended

- This brief did **not** verify the current official Google-Extended documentation: the
  first attempt returned HTTP 404. Verify it from Google's official crawler docs before
  shipping a robots.txt group for it. Do not state what it controls from memory.

### 4.5 robots.txt

- The de facto standard is RFC 9309, "Robots Exclusion Protocol". It defines
  `User-agent`, `Allow`, `Disallow`, grouping, and matching. `Sitemap` is a widely
  supported non-standard extension.
- Source: https://www.rfc-editor.org/rfc/rfc9309

### 4.6 llms.txt

- `llms.txt` is a **proposal**, not an adopted official standard. It is authored by
  Jeremy Howard and maintained through AnswerDotAI's GitHub repository; the site says it
  is "open for community input".
- Location: site root `/llms.txt` or any subpath; it covers pages below that path.
- Format: Markdown. An H1 naming the project/site is the only mandatory section. Then a
  blockquote summary, optional non-heading detail, and zero or more H2 file lists. Each
  file-list item is `[name](url)` plus optional notes after a colon. An H2 named
  "Optional" conventionally marks secondary links.
- Purpose: give agents concise background and links to fuller Markdown resources; agents
  read it and fetch linked material as needed. A sitemap is "not a substitute".
- Source: https://llmstxt.org/
- Consequence: publish `llms.txt` as a useful, low-risk convention, not as a Google
  ranking requirement. Google's AI features page does not mention or endorse it.

---

## 5. IndexNow (Bing and participating engines)

- IndexNow notifies participating search engines when URLs are added, updated, or
  deleted.
- Key: 8–128 characters, `a-z`, `A-Z`, `0-9`, and `-`. Host `{key}.txt` at the site root
  (UTF-8, containing the key). A key file elsewhere is possible with `keyLocation`, but
  its directory limits the URLs it covers.
- Single URL: `GET https://<searchengine>/indexnow?url=<url>&key=<key>`.
- Multiple URLs: `POST /indexnow` with JSON `{ host, key, urlList }`, optional
  `keyLocation`; up to 10,000 URLs per post.
- Responses: 200 received, 202 pending key validation, 400 invalid format, 403 invalid
  key, 422 URL/host mismatch, 429 too many requests. A 200 only confirms receipt, not
  indexing.
- Source: https://www.indexnow.org/documentation
- Google's old sitemap ping endpoint is not part of this brief; submit sitemaps through
  Google Search Console.

---

## 6. Performance and technical SEO

- Current Core Web Vitals good thresholds: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, at the
  75th percentile, split by mobile and desktop; all three must meet the target.
- Field data comes from CrUX, PageSpeed Insights, Search Console, and RUM. Lab tools
  (Lighthouse, DevTools) measure LCP and CLS; INP needs real user input, so lab tests use
  TBT as a proxy.
- Source: https://web.dev/articles/vitals
- Next.js static export supports server components rendered at build time; dynamic
  routes require `generateStaticParams()`; `dynamicParams: true` is unsupported; route
  handlers must be GET and marked `export const dynamic = "force-static"`; `headers`,
  `redirects`, `rewrites`, cookies, ISR, server actions, and image optimization with the
  default loader are unsupported. Metadata files (`robots.txt`, `sitemap.xml`) are
  supported.
- Source: https://nextjs.org/docs/app/guides/static-exports
- Sitemap protocol: absolute URLs in `<loc>`, `lastmod` optional, 50,000 URLs / 50 MB
  uncompressed per sitemap.
- Source: https://www.sitemaps.org/protocol.html

---

## 7. Honesty constraints for this implementation

These are hard constraints, not preferences:

1. Do not add `aggregateRating` or `review` markup for the illustrative testimonials.
   They are not verified customer reviews.
2. Do not invent a physical address, phone number, email, Instagram URL, GTIN, MPN,
   founding date, review count, rating, shipping rate, or delivery promise that is not in
   the visible site content.
3. Do not add `Offer.shippingDetails` with a made-up shipping price. The checkout
   displays a flat ₹99 shipping fee (free over ₹799) and a ₹99 COD fee, while
   `/shipping-returns` says delivery estimates appear at checkout. The CMS has no
   declared Merchant Center shipping policy, so the structured data and feed omit
   shipping; do not invent a different rate. If ₹99 is the real policy, publish it
   consistently on `/shipping-returns` and the AEO copy first.
4. Do not add `priceValidUntil` without a real expiry date.
5. Do not add a `SearchAction` unless a working search URL exists.
6. Do not use the 336 KB data-URL wordmark as `Organization.logo`.
7. Do not claim FAQ rich results, `llms.txt` as an official standard, or any ranking
   guarantee.
8. Do not mark the checkout page indexable. It is a transactional page and should be
   `noindex, nofollow`.
9. Product structured data must be present in the initial HTML, not injected only by
   client-side JavaScript.
10. Every URL in canonical tags, Open Graph, JSON-LD, sitemaps, and the feed must be
    absolute and derive from `NEXT_PUBLIC_SITE_URL`. Do not invent a production domain;
    the local fallback is `http://localhost:3001`.
11. Use only facts visible in the CMS content or the catalog API. If a field is empty,
    omit the corresponding schema property.

---

## 8. Source index

All sources were fetched on 2026-10-27. Re-verify before changing a rule or making a
public claim.

| Topic | Source |
| --- | --- |
| Google Search Essentials | https://developers.google.com/search/docs/essentials |
| Google helpful content / E-E-A-T | https://developers.google.com/search/docs/fundamentals/creating-helpful-content |
| Google AI features (AI Overviews/AI Mode) | https://developers.google.com/search/docs/appearance/ai-features |
| Google Product snippets | https://developers.google.com/search/docs/appearance/structured-data/product-snippet |
| Google merchant listings | https://developers.google.com/search/docs/appearance/structured-data/merchant-listing |
| Google product variants | https://developers.google.com/search/docs/appearance/structured-data/product-variants |
| Google Organization | https://developers.google.com/search/docs/appearance/structured-data/organization |
| Google BreadcrumbList | https://developers.google.com/search/docs/appearance/structured-data/breadcrumb |
| Google FAQPage (retired rich result) | https://developers.google.com/search/docs/appearance/structured-data/faqpage |
| Google Merchant product data spec | https://support.google.com/merchants/answer/7052112 |
| Google product taxonomy | https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt |
| OpenAI crawlers | https://developers.openai.com/api/docs/bots |
| Anthropic crawlers | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler |
| Perplexity crawlers | https://docs.perplexity.ai/guides/bots |
| llms.txt proposal | https://llmstxt.org/ |
| IndexNow | https://www.indexnow.org/documentation |
| Robots Exclusion Protocol | https://www.rfc-editor.org/rfc/rfc9309 |
| Core Web Vitals | https://web.dev/articles/vitals |
| Next.js static exports | https://nextjs.org/docs/app/guides/static-exports |
| Sitemap protocol | https://www.sitemaps.org/protocol.html |
