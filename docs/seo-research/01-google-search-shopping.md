# 01 — Google Search, Google Shopping, structured data, content quality

Scope owner: Google Search / Google Shopping specialist.
Audience: the engineers implementing storefront SEO; the run owner deciding scope.
Repository state audited: working tree of `feat/finish-partial-features`, 2026-10-28.

This file is a rule sheet plus an evidence list. Every rule below is quoted or tightly
paraphrased from a source I fetched in this session; every claim about the storefront cites a
`path:line` or the exact command and its output. Where something could not be checked, it says so.

---

## 0. What I ran (so the checks are reproducible)

| Check | Exact command | Result used below |
| --- | --- | --- |
| Structured data anywhere in storefront source | `findstr /s /i /n /c:"application/ld+json" /c:"jsonld" /c:"JSON-LD" /c:"schema.org" /c:"metadata" src\*.tsx src\*.ts` (cwd `storefront/`) | only `src\app\layout.tsx:1`, `:42`, `:43` — no `ld+json` string exists in the app |
| Metadata exports | `findstr /s /n /c:"export const metadata" /c:"generateMetadata" /c:"alternates" /c:"robots:" src\app\*.tsx src\app\*.ts` | one hit: `src\app\layout.tsx:42` |
| Routes | `dir /b storefront\src\app` | `checkout/`, `icon.svg`, `globals.css`, `layout.tsx`, `niththigal.css`, `niththigal-sections.css`, `page.tsx` — two routes only |
| Initial HTML (home) | `curl -sS -o sf_dev_index.html -w "index HTTP %{http_code} bytes=%{size_download}" http://localhost:3001/` | `HTTP 200 bytes=52222` |
| Initial HTML (checkout) | `curl -sS -o sf_dev_checkout.html http://localhost:3001/checkout` | `HTTP 200 bytes=38953` |
| markers in home HTML | PowerShell regex count over `sf_dev_index.html` | `ld+json => 0`, `schema.org => 0`, `product-card => 0`, `Loading the collection => 1`, `rel="canonical" => 0`, `name="robots" => 0`, `<h1` => 1 |
| markers in checkout HTML | same, over `sf_dev_checkout.html` | `ld+json => 0`, `noindex => 0`, `name="robots" => 0`, `<title>` identical to home |
| robots / sitemap | `curl -o NUL -w "%{http_code}" http://localhost:3001/robots.txt` and `/sitemap.xml` | `404` and `404`; no `app/robots.*`, `app/sitemap.*`, `public/robots.txt`, `public/sitemap.xml` |
| Live catalog | `curl http://localhost:3000/api/storefront/catalog` (the ERP host the storefront calls, `storefront/src/lib/api.ts:12-14`) | `HTTP 200`, 3 products, see §3 |
| Live CMS content | `curl http://localhost:3000/api/storefront/content` | `brand.logoUrl.len=0`, `brand.wordmarkUrl.len=336034`, `contact.whatsapp=""`, `contact.email=""`, `contact.instagram=""` |
| Pre-existing export artifact (secondary) | PowerShell counts over `storefront/out/index.html` (file dated 28-10-2026 15:26, **not produced by me**) | `ld+json => 0`, `schema.org => 0`, `product-card => 0`, `Loading the collection => 1` |

Not run, deliberately:

- **`next build` was not run.** A dev server is holding `:3001` (`netstat -ano` → `TCP 0.0.0.0:3001 ... LISTENING 5420`) and `docs/SEO_BRIEF.md:47-49` records that this causes `EPERM`/`ENOTEMPTY` while finalising the export. I did not kill the dev server (a state change not supported by the evidence) and I may not edit `next.config.ts` to move `distDir`. The initial-HTML check above uses the dev server's server-rendered response plus the pre-existing export artifact; both agree.
- **Product image pixel dimensions were not verified.** No WebP dimension probe is available in this environment.
- **No Google Rich Results Test / Search Console run** — no public URL, only `localhost`.

---

## 1. Requirements (testable)

Each requirement has an id, the rule, and the source that establishes it. "Recommended" vs
"required" is kept as the source states it.

### 1.1 Product pages and eligibility

**R-01 — Product rich results only support single-product pages.**
> "Currently, product rich results only support pages that focus on a single product (or multiple
> variants of the same product). For example, 'shoes in our shop' is not a specific product. This
> includes product variants where each product variant has a distinct URL. We recommend focusing on
> adding markup to product pages instead of pages that list products or a category of products."

Applies to both product snippets and merchant listings (identical sentence on both pages).
Source: <https://developers.google.com/search/docs/appearance/structured-data/product-snippet>,
<https://developers.google.com/search/docs/appearance/structured-data/merchant-listing>

**R-02 — Merchant listings are only for pages where the shopper can buy.**
> "Only pages where a shopper can purchase a product are eligible for merchant listing experiences,
> not pages with links to other sites that sell the product. Google may attempt to verify merchant
> listing product data before showing the information in search results."
> Source: merchant-listing.

**R-03 — The page must be reachable by Google.**
> "Be sure that your page is accessible to Google and not blocked by a robots.txt file, the noindex
> tag, or login requirements."
> Source: product-variants ("How to add structured data").

**R-04 — Online-purchase requirement for merchant listing `Offer`.**
> `offers` is required; "Product snippets accept an Offer or AggregateOffer but merchant listings
> require an Offer as the merchant has to be the seller of the product in order to be eligible for
> merchant listing experiences."
> Source: merchant-listing.

### 1.2 Required vs recommended properties

**R-05 — Merchant listing `Product` required properties: `name`, `image`, `offers`.**
`image` must be crawlable and indexable and "must represent the marked up content"; multiple
high-resolution images recommended (≥ 50 000 px total, 16x9 / 4x3 / 1x1). Source: merchant-listing.

**R-06 — Merchant listing `Offer`: `price` > 0 and `priceCurrency` (ISO 4217).**
> "Unlike product snippets, merchant listing experiences require a price greater than zero."
> "priceCurrency is required if price is specified, otherwise priceSpecification.priceCurrency is
> required if priceSpecification.price is specified."
> Source: merchant-listing.

**R-07 — Product snippet `Product`: `name` plus at least one of `review`, `aggregateRating`, `offers`.**
`Offer` requires `price` or `priceSpecification.price`; `availability`, `priceCurrency`,
`priceValidUntil` are recommended (`priceCurrency` is "required for merchant listing experiences").
Source: product-snippet.

**R-08 — Do not use `AggregateOffer` for variants, and it is not a merchant-listing offer.**
> "Don't use AggregateOffer to describe a set of product variants."
> Source: product-snippet (AggregateOffer section). Merchant listing: R-04.

**R-09 — Recommended `Product` properties that the storefront can actually supply:** `brand.name`,
`category`, `description`, `color`, `material`, `sku`, `size`, plus `offers.availability`,
`itemCondition`, `hasMerchantReturnPolicy`, `shippingDetails`, `priceValidUntil`, `url`.
Recommended `Offer` properties include `availability`, `itemCondition`, `priceValidUntil`, `url`.
Source: merchant-listing (Product / Offer property tables), product-snippet.

**R-10 — `availability` is a closed set; pick one.**
Supported: `BackOrder`, `Discontinued`, `InStock`, `InStoreOnly`, `LimitedAvailability`,
`OnlineOnly`, `OutOfStock`, `PreOrder`, `PreSale`, `SoldOut` — long or short names, "Don't specify
more than one value." Source: merchant-listing (Offer → availability).

**R-11 — One currency per URL.**
> "When offering products for sale in multiple currencies, have a distinct URL per currency."
> Source: product-snippet, merchant-listing. (Currently INR only, so not applicable — but it is why
> a currency selector must not be a client-side toggle.)

### 1.3 Structured data mechanics

**R-12 — Product markup in the initial HTML.**
> "If you're a merchant optimizing for all types of shopping results, we recommend putting Product
> structured data in the initial HTML for best results. For JavaScript-generated Product markup: Be
> aware that dynamically-generated markup can make Shopping crawls less frequent and less reliable,
> which can be an issue for fast-changing content like product availability and price."
> Source: product-snippet, merchant-listing, product-variants (same paragraph on all three).

**R-13 — Markup must describe visible content and be truthful.**
> "Don't mark up content that is not visible to readers of the page."
> "Don't mark up irrelevant or misleading content, such as fake reviews or content unrelated to the
> focus of a page."
> "Your structured data must be a true representation of the page content."
> Reviews/ratings "not by actual users may result in manual action."
> "Specify all required properties … Items that are missing required properties are not eligible
> for rich results."
> "Put the structured data on the page that it describes."
> Source: <https://developers.google.com/search/docs/appearance/structured-data/sd-policies>

**R-14 — Use the most specific schema.org type.**
> "Try to use the most specific applicable type and property names defined by schema.org for your
> markup." Source: sd-policies (Specificity).

### 1.4 Product variants

**R-15 — `ProductGroup` shape: `hasVariant` (nested `Product`s) or `isVariantOf` (variants pointing
back), and one group id.**
> "Each product group must have a unique ID in its corresponding structured data markup, specified
> with the inProductGroupWithID property in variant Product properties or the productGroupID
> property in the ProductGroup property."
> "Each variant must have a unique ID in its corresponding structured data markup (for example,
> using the sku or gtin properties)."
> Source: <https://developers.google.com/search/docs/appearance/structured-data/product-variants>

**R-16 — `variesBy` only accepts six aspects, as full schema.org URLs:** `https://schema.org/color`,
`https://schema.org/size`, `https://schema.org/suggestedAge`,
`https://schema.org/suggestedGender`, `https://schema.org/material`, `https://schema.org/pattern`.
Source: product-variants.

**R-17 — Every variant must be directly selectable by its own URL.**
> "The site must have the ability to preselect each variant directly with a distinct URL (using URL
> query parameters), for example https://www.example.com/winter_coat/size=small&color=green. This
> allows Google to crawl and identity each variant. Preselecting each variant includes showing the
> right image, price, and availability, as well as allowing the user to add the variant to the cart."
> Source: product-variants.

**R-18 — Single-page vs multi-page rules.**
> Single page: "there must be only one distinct canonical URL for the overall ProductGroup that all
> variants belong to. Typically this is the base URL that leads to a page without a variant
> pre-selected."
> `ProductGroup.url`: "For single-page websites only … Don't use this property for multi-page
> websites."
> Multi page: "each page must have full and self-contained markup for the entities defined on that
> page (meaning, off-page entities shouldn't be necessary to fully understand the markup on the page
> itself)."
> Source: product-variants (Technical guidelines; ProductGroup → url).

**R-19 — Variant `Product` still needs the normal Product requirements.**
> "Be sure to add Product structured data in addition to the product variant properties, following
> the list of required properties for merchant listings (or product snippets)."
> Source: product-variants.

### 1.5 Organization

**R-20 — Organization has no required properties; use the most specific subtype.**
> "There are no required properties; instead, add the properties that apply to your organization."
> "We recommend using the most specific schema.org subtype of Organization that matches your
> organization. For example, if you have an ecommerce site, then we recommend using the OnlineStore
> subtype instead of OnlineBusiness."
> "We recommend placing this information on your home page, or a single page that describes your
> organization … You don't need to include it on every page of your site."
> Source: <https://developers.google.com/search/docs/appearance/structured-data/organization>

**R-21 — Recommended Organization properties:** `address`, `alternateName`, `contactPoint`,
`description`, `email`, `logo`, `name`, `sameAs`, `telephone`, `url`; plus the shop-specific
`hasMerchantReturnPolicy` and shipping policy under Organization. Source: organization.

**R-22 — Logo rules.**
> "The image must be 112x112px, at minimum. The image URL must be crawlable and indexable. The image
> file format must be supported by Google Images. Make sure the image looks how you intend it to look
> on a purely white background."
> Source: organization (logo).

**R-23 — `sameAs` and `contactPoint` semantics.**
> `sameAs`: "The URL of a page on another website with additional information about your
> organization, if applicable. For example, a URL to your organization's profile page on a social
> media or review site."
> `contactPoint`: support channels, with `contactPoint.email` / `contactPoint.telephone`.
> Source: organization.

### 1.6 Breadcrumbs

**R-24 — `BreadcrumbList` needs at least two `ListItem`s; `item` optional only on the last one.**
> "To specify breadcrumbs, define a BreadcrumbList that contains at least two ListItems."
> `ListItem` required: `item` (URL) — "If the breadcrumb is the last item in the breadcrumb trail,
> item is not required" — and `name`, `position`.
> "We recommend providing breadcrumbs that represent a typical user path to a page, instead of
> mirroring the URL structure."
> Source: <https://developers.google.com/search/docs/appearance/structured-data/breadcrumb>

### 1.7 FAQPage (retired)

**R-25 — `FAQPage` produces no Google rich result. Do not claim one.**
> 2026-05 changelog: "Deprecating the FAQ rich result feature … This feature will no longer appear in
> Google Search starting May 7, 2026."
> 2026-06-15 changelog: "Removing documentation for the FAQ rich result feature … The FAQ rich
> result feature is no longer shown in Google Search results, as announced in the changelog entry in
> May 2026."
> Verified mechanically: `curl -L https://developers.google.com/search/docs/appearance/structured-data/faqpage?hl=en` now ends at `https://developers.google.com/search/updates?hl=en#removing-faq-rich-result` (`HTTP 200` after a `301`).
> Source: <https://developers.google.com/search/updates#removing-faq-rich-result>

FAQ content on the page is still normal page content — it just has no Google feature attached.

### 1.8 AI features (AI Overviews / AI Mode)

**R-26 — Nothing extra is required, and no special file or schema exists.**
> "There are no additional requirements to appear in AI Overviews or AI Mode, nor other special
> optimizations necessary."
> "To be eligible to be shown as a supporting link in AI Overviews or AI Mode, a page must be
> indexed and eligible to be shown in Google Search with a snippet … There are no additional
> technical requirements."
> "You don't need to create new machine readable files, AI text files, or markup to appear in these
> features. There's also no special schema.org structured data that you need to add."
> "Making sure that your structured data matches the visible text on the page."
> Source: <https://developers.google.com/search/docs/appearance/ai-features>

**R-27 — `llms.txt` is ignored by Google Search; it neither helps nor hurts.**
> "LLMS.txt files and other 'special' markup: You don't need to create new machine readable files,
> AI text files, markup, or Markdown to appear in Google Search (including its generative AI
> capabilities), as Google Search itself doesn't use them."
> "Doing so will neither harm nor help your site's visibility or rankings in Google Search, as
> Google Search ignores them."
> "Structured data isn't required for generative AI search, and there's no special schema.org markup
> you need to add."
> Source: <https://developers.google.com/search/docs/fundamentals/ai-optimization-guide>

### 1.9 Content quality (Search Essentials, helpful content, E-E-A-T)

**R-28 — Search Essentials has three parts, and passing them guarantees nothing.**
> Technical requirements / spam policies / key best practices. "Just because a page meets all
> requirements, best practices, and complies with the policies, doesn't mean that Google will crawl,
> index, or serve its content." (ai-features states it explicitly; essentials defines the three
> parts.)
> Source: <https://developers.google.com/search/docs/essentials>

**R-29 — People-first content; avoid search-engine-first patterns.**
Warning-sign questions include: "Are you using extensive automation to produce content on many
topics?", "Are you mainly summarizing what others have to say without adding much value?", "Does
your content promise to answer a question that actually has no answer, such as suggesting there's a
release date for a product … when one isn't confirmed?", "Are you changing the date of pages to make
them seem fresh when the content has not substantially changed?"
Source: <https://developers.google.com/search/docs/fundamentals/creating-helpful-content>

**R-30 — E-E-A-T: trust is most important, and it is not a ranking factor.**
> "Of these aspects, trust is most important." "While E-E-A-T itself isn't a specific ranking
> factor, using a mix of factors that can identify content with good E-E-A-T is useful."
> "Who / How / Why": clear authorship; explain how content was produced including automation/AI when
> a reader would reasonably ask; the "why" should be helping people.
> Source: creating-helpful-content (E-E-A-T, "Ask Who, How, and Why").
> Also: "Does the main heading or page title provide a descriptive, helpful summary of the content?"
> (self-assessment questions).

### 1.10 Google Shopping feed (Merchant Center)

**R-31 — Required feed attributes:** `id`, `title` (max 150), `description` (max 5 000), `link`,
`image_link`, `availability`, `price` (numeric + ISO 4217), `brand` (max 70; "Required (For all new
products, except movies, books, and musical recording brands)").
`condition` — "Required if your product is used or refurbished". `gtin` — "It Depends (strongly
recommended if available)". `mpn` — "Required (Only if your product does not have a manufacturer
assigned GTIN)". `item_group_id` — "Required for free listings for all product variants".
Source: <https://support.google.com/merchants/answer/7052112> (Minimum requirements at a glance).

**R-32 — Prices must match across the landing page, structured data and checkout; GST is included
for India.**
> "Accurately submit the product's price and currency, and match with the price from your landing
> page, structured data, and at checkout."
> "For the US and Canada: Don't include any taxes … For all other countries: Include value added tax
> (VAT) or Goods and Services Tax (GST) in the price attribute."
> "Don't submit a price of 0."
> "If an item is out of stock, the price must still be clearly visible on the landing page."
> Source: Merchant Center spec (`price`, `availability`).

**R-33 — Image requirements for the feed:** accepted formats JPEG/WebP/PNG/non-animated GIF/BMP/TIFF;
"Make sure the URL can be crawled by Google (robots.txt configuration allowing Googlebot and
Googlebot-image)"; "at least 500 x 500 pixels … Enforcement of the new requirements will begin
January 31, 2027."
Source: Merchant Center spec (`image_link`).

**R-34 — Feed vs on-page markup are complementary.**
> "Providing both structured data on web pages and a Merchant Center feed maximizes your eligibility
> to experiences … Some experiences combine data from structured data and Google Merchant Center
> feeds if both are available."
> Source: <https://developers.google.com/search/docs/appearance/structured-data/product>,
> and Merchant Center spec.

---

## 2. Current state of the storefront

### 2.1 Shape

- Two routes only: `/` (`storefront/src/app/page.tsx`) and `/checkout`
  (`storefront/src/app/checkout/page.tsx`). Confirmed by `dir /b storefront\src\app`.
- The home route is a client component (`storefront/src/app/page.tsx:1` `"use client"`) that renders
  CMS-selected sections in order (`page.tsx:22-26`, `:44-56`).
- Static export by default: `storefront/next.config.ts:10` `output: isStandalone ? "standalone" : "export"`,
  with `images.unoptimized: true` (`next.config.ts:12-14`).
- One `metadata` export for the whole site (`storefront/src/app/layout.tsx:42-61`):
  `metadataBase` from `NEXT_PUBLIC_SITE_URL || NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3001"`
  (`layout.tsx:37-40`), a title, a description, and Open Graph title/description/image.
  No `alternates.canonical`, no `robots`, no JSON-LD, no verification tags.
- `og:image` is absolute because of `metadataBase` — the dev HTML contains
  `<meta property="og:image" content="http://localhost:3001/niththigal/hero.webp"/>`.
  `og:url` is absent.
- The checkout page has no metadata of its own (`export const metadata` count in
  `checkout/page.tsx` = 0) and inherits the home title.

### 2.2 Products are not URLs

- Card image link: `storefront/src/components/niththigal/Collection.tsx:184-192` —
  `href={`#${product.id}`}` with `onClick` → `event.preventDefault(); onOpen();`.
- Card title link: `Collection.tsx:219-228` — same pattern.
- The quick-view button and the `+` button call `onOpen()` / `add()` (`Collection.tsx:210`,
  `:234-248`).
- The "product page" is a `<dialog>`: `storefront/src/components/niththigal/NtDialogs.tsx:166-301`
  (`ProductDialog`), rendered into `NtModal` (`NtDialogs.tsx:227-233`).
- Result: no crawlable product URL exists anywhere on the site.

### 2.3 Products are loaded after mount

- `storefront/src/components/niththigal/NtCatalogContext.tsx:55-68` — `useEffect(() => { void refresh(); ... })`.
- `NtCatalogContext.tsx:32-53` — `refresh()` awaits `getStorefrontCatalog()`.
- `storefront/src/lib/pocketbase.ts:107-122` — fetches `/api/storefront/catalog`.
- The server-rendered HTML therefore contains the loading state only:
  dev HTML regex counts `Loading the collection => 1`, `product-card => 0`.

### 2.4 Variants

Live catalog (`http://localhost:3000/api/storefront/catalog`):

| sku | name | category | website_price | total_stock | variants |
| --- | --- | --- | --- | --- | --- |
| BGL-NILA-HERITAGE | Nila Heritage Bangles | Bangles | 1299 | 11 | `2.4` (4), `2.6` (4), `2.8` (3) |
| TMP-NCK-LAKSHMI | Lakshmi Temple Necklace | Necklaces | 1899 | 6 | `Standard` (6) |
| KND-JHU-MALAR | Malar Temple Jhumkas | Earrings | 899 | 8 | `Standard` (8) |

- Variant payload is `{ id, label, stock_level }` only —
  `src/app/api/storefront/catalog/route.ts:147-151`; no per-variant price, image or structured
  size/colour.
- Variant selection is a `<select>` inside the modal:
  `storefront/src/components/niththigal/NtDialogs.tsx:265-285`. Selection lives in React state
  (`NtDialogs.tsx:176`, `:193`) — there is no URL parameter, no preselection from a URL, and no
  per-variant image.
- `low_stock` is a third status: `storefront/src/lib/pocketbase.ts:27` and
  `src/app/api/storefront/catalog/route.ts:121`. schema.org's `ItemAvailability` has no "low" value
  (R-10).

### 2.5 Organization / entity data available

Live `/api/storefront/content` (`niththigal` block):

- `brand.name` = `Niththigal`.
- `brand.logoUrl` length 0; `brand.lockupUrl` length 0; `brand.wordmarkUrl` length **336 034** — a
  data URL (defaults at `storefront/src/lib/niththigal-content.tsx:388-401`).
- `contact.whatsappPhone` = `""`, `contact.supportEmail` = `""`, `contact.instagramUrl` = `""`
  (defaults `niththigal-content.tsx:429-433`).
- `footer.location` = "Thoughtfully imagined for the women of the South." — a line of copy, not an
  address (`niththigal-content.tsx:678`).
- `instagram.handle` = `@niththigal`, but `instagram.ctaHref` is `""` (`niththigal-content.tsx:577`)
  and the section only renders the follow link when a URL exists
  (`storefront/src/components/niththigal/sections.tsx:427`, `:438-447`).

Conclusion: `address`, `telephone`, `email`, `contactPoint`, `sameAs` and `logo` are all
unsupported by real data today. Omitting them is correct; inventing them is prohibited.

### 2.6 Policy content

- Shipping / privacy / care footer links are `<button>`s that open dialogs:
  `storefront/src/components/niththigal/NtFooter.tsx:17-31`.
- Dialog body renders only when a key is set: `NtDialogs.tsx:304-307` (`const page = infoKey ? ... : null`).
- Dev HTML: `We do not store card details => 0`, `Talk to our concierge => 0` — the policy text is
  not in the initial HTML and has no URL.
- A real shipping rule exists only in checkout code: `storefront/src/app/checkout/page.tsx:167`
  `const shippingFee = cartSubtotal >= 799 ? 0 : 99;` and `:168` COD fee `99`. No visible policy
  states this.

### 2.7 Content that is good and must not regress

- Prices shown are tax-inclusive in copy: `niththigal-content.tsx:421` ("Taxes included. Delivery is
  calculated at checkout."), `:608` ("Taxes included. Keepsake pouch included."), `:708` ("Prices
  include taxes."). This matches R-32's India rule (GST included).
- `mrp` equals `website_price` server-side — no invented compare-at price:
  `src/app/api/storefront/catalog/route.ts:143` (`mrp: websitePrice`) with the explanatory comment at
  `:140-142`.
- Testimonials are labelled: `sections.tsx:340` renders the stars with `aria-hidden`, `:342` renders
  `testimonials.note`, value "Illustrative community stories" in live content and default
  (`niththigal-content.tsx:549`). No review markup exists.
- FAQ Q&A are real server-rendered `<details>` elements: `sections.tsx:556-563`; dev HTML contains
  `Is this real gold jewellery => 1`.
- Exactly one `<h1>` (dev HTML `<h1` count = 1), and it is the hero headline
  (`sections.tsx:117-121`).

---

## 3. Gaps, by severity

### High

**G-01 — There is no product URL, so no Google product surface is reachable.**
Every card links to `#<id>` and opens a modal (`Collection.tsx:184-192`, `:219-228`;
`NtDialogs.tsx:166-301`). This breaks R-01 (single-product page), R-02 (purchasable page),
R-17 (variant URLs), the feed's required `link` (R-31), and leaves nothing to put in a sitemap.
Everything else in this document is downstream of this one.

**G-02 — Zero structured data exists.**
No `application/ld+json` string exists in `storefront/src` (findstr over `src\*.tsx` / `src\*.ts`);
the initial HTML contains zero `ld+json` and zero `schema.org`; the pre-existing export artifact
`storefront/out/index.html` likewise. No Product, Offer, Organization, BreadcrumbList, WebSite.

**G-03 — Product data cannot be in the initial HTML under the current architecture.**
The catalog is fetched in `useEffect` (`NtCatalogContext.tsx:55-68`, `:32-53` →
`pocketbase.ts:107-122`). A client-injected markup path is exactly what R-12 warns degrades Shopping
crawls. With `output: "export"` (`next.config.ts:10`) a build-time fetch in a server component is the
only way to bake product data in; that choice belongs to the run owner, not to a markup patch.

**G-04 — The one page showing products shows three of them.**
`Collection.tsx:119-145` maps every filtered product into one grid; live catalog `count` is 3. A
multi-product page is ineligible for product snippets and merchant listings (R-01). Marking up all
three on `/` would be a false structural claim, not an enhancement.

**G-05 — Variants are not URL-addressable.**
`NtDialogs.tsx:265-285` selects a size in a `<select>`; no URL state, no preselection, no per-variant
image/price. R-17 fails on all four counts ("right image, price, and availability, as well as
allowing the user to add the variant to the cart"). Additionally the API exposes only
`{ id, label, stock_level }` (`catalog/route.ts:147-151`), so a correct variant `Offer` cannot be
rendered even if a URL existed.

### Medium

**G-06 — No crawlable logo, and no Organization entity data.**
`brand.logoUrl` is empty and `brand.wordmarkUrl` is a 336 034-character data URL (live content;
defaults `niththigal-content.tsx:388-401`). R-22 requires a crawlable, indexable image URL ≥112×112.
`contact.*` are all empty, and `footer.location` is copy, not an address. So Organization can only
ever be shipped as `name` + `url` + (`description`) until real values exist.

**G-07 — Policy pages do not exist, so return/shipping markup cannot reference them.**
`NtFooter.tsx:17-31` (buttons) and `NtDialogs.tsx:304-307` (body only when open); the text is absent
from initial HTML. Google recommends putting the global return and shipping policy under
Organization (R-21), and Offer-level properties are for overrides only — both need a real policy
document. There is also a real shipping rule (`checkout/page.tsx:167`: free ≥ ₹799, else ₹99) that no
page states.

**G-08 — The checkout page is crawlable and duplicates the home title.**
Dev checkout HTML: `noindex => 0`, `name="robots" => 0`, `<title>` identical to `/`. This violates the
project constraint in `docs/SEO_BRIEF.md:310-311` (§7.8). Honest note: I found **no official Google
document** requiring `noindex` on a checkout page — I checked
<https://developers.google.com/search/docs/specialty/ecommerce?hl=en> (no cart/checkout indexing
rule) and <https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag?hl=en> (no
cart/checkout example). Treat this as a project decision and a duplicate/thin-page quality issue,
not as a Google rule.

**G-09 — A product `image` may be a `data:` URI and is currently relative.**
`src/app/api/storefront/catalog/route.ts:123-129` accepts `image_data` when it starts with `/` or
`data:`; `pocketbase.ts:167-170` accepts any `image_data` longer than 20 chars. A data URI is not a
crawlable URL (R-05, R-33). The three current products resolve to root-relative
`/niththigal/*.webp` (live JSON), which is crawlable but must become absolute in JSON-LD.

**G-10 — No `robots.txt` and no `sitemap.xml`.**
`curl http://localhost:3001/robots.txt` → `404`; `/sitemap.xml` → `404`; no metadata route files in
`storefront/src/app` and none in `storefront/public`. Google only *recommends* a sitemap
("To keep Google informed of future changes, we recommend that you submit a sitemap" —
product-variants), but without product URLs (G-01) there is nothing to submit. This overlaps the
technical-SEO owner's files; report, do not fix here.

**G-11 — The home title and description are brand copy, not a description of what is sold.**
`layout.tsx:44` title `"Niththigal — A little tradition. A lot of you."`; the `<title>` in the dev
HTML matches. The description (`layout.tsx:45-46`) does say "South Indian-inspired imitation
jewellery". R-30's self-assessment asks whether the title gives "a descriptive, helpful summary of
the content". Proposal (keep the tone): a title that names the category, e.g.
`"Niththigal — South Indian-inspired imitation jewellery"`.

### Low

**G-12 — `low_stock` has no `ItemAvailability` equivalent.**
`pocketbase.ts:27`, `catalog/route.ts:121`. A naive mapping could emit an invalid enum. Map
`in_stock`/`low_stock` → `https://schema.org/InStock` (or `LimitedAvailability` for `low_stock`) and
`out_of_stock` → `https://schema.org/OutOfStock`; never invent a value.

**G-13 — The pricing band can display a price that is not the catalog price.**
`sections.tsx:486-490` prefers `pricing.priceOverride.trim()` over `minPrice`. Today
`priceOverride` is `""` (`niththigal-content.tsx:610`), so the shown figure is the catalog minimum.
Any future structured-data price must come from `website_price`, never from this copy string.

**G-14 — The five-star glyph row is a latent review-markup trap.**
`sections.tsx:340` (`testimonials.stars`, `aria-hidden`) plus `:342` (the "Illustrative community
stories" note). Current state is correct: no `aggregateRating`, no `review`. The risk is a future
"SEO improvement" that turns decorative stars into a rating.

**G-15 — No BreadcrumbList, and none should be added yet.**
`BreadcrumbList` needs ≥ 2 `ListItem`s representing a typical user path (R-24). With two routes
(`/`, `/checkout`), the only possible trail is "Home > Checkout", which describes nothing. Defer
until per-product and per-category URLs exist.

---

## 4. Do-not-do list

Hard rules for anyone implementing this area. Each one prevents a specific failure mode named above.

1. **Do not add `aggregateRating` or `review`** derived from the testimonials. They are illustrative
   (`sections.tsx:340-342`; "Illustrative community stories"). Fake ratings "may result in manual
   action" (R-13).
2. **Do not invent** `address`, `telephone`, `email`, `sameAs`, `gtin`, `mpn`, founding date, review
   count, rating, shipping rate, delivery promise, or `priceValidUntil`. The data is absent from the
   CMS (live content: all contact fields empty) and using it would violate R-13.
3. **Do not emit `Organization.logo` from `brand.wordmarkUrl`.** It is a 336 KB data URL, not a
   crawlable image URL (R-22).
4. **Do not put `Product` markup on `/`.** It is a three-product listing page (R-01, G-04).
5. **Do not use `AggregateOffer` for variants, and do not use it for a merchant listing** (R-04,
   R-08). Also do not use an `ItemList` of prices as a stand-in for an `Offer`.
6. **Do not claim an FAQ rich result.** The feature stopped appearing 2026-05-07 and its
   documentation was removed 2026-06-15 (R-25). `FAQPage` markup may be valid schema.org, but it buys
   nothing in Google Search; do not describe it as an SEO win.
7. **Do not describe `llms.txt` as a Google requirement or a Google signal.** Google Search ignores
   it (R-27). Keeping the file for other consumers is explicitly fine.
8. **Do not add "AI schema", AI text files, or AI-only markup.** Nothing is required (R-26).
9. **Do not mark up content that is invisible.** Policy text inside closed dialogs
   (`NtDialogs.tsx:304-307`), internal enum strings (`micro_gold_1gm`, `brass` — humanised only inside
   the modal, `NtDialogs.tsx:21-49`), or `mrp` as a fake compare-at price all fail R-13.
10. **Do not publish a `shippingDetails` rate from `checkout/page.tsx:167`** until a visible policy
    page states it. Google wants the global policy under Organization, with Offer-level overrides
    only for exceptions (R-21).
11. **Do not add `SearchAction`.** There is no search URL — search is a modal over an in-memory list
    (`NtDialogs.tsx:60-163`).
12. **Do not add `priceValidUntil`** without a real expiry date, and never a past one
    (product-snippet: "Your product snippet may not display if the priceValidUntil property
    indicates a past date").
13. **Do not add `itemCondition`.** No page states a condition; R-13 forbids marking up unstated
    facts. (For the feed it is only required for used/refurbished, R-31.)
14. **Do not weaken any check to make a test pass.** If a required property cannot be sourced, omit
    the markup and report the gap.

---

## 5. Blocked / needs a decision that is not mine

**B-01 — Architecture vs requirement (the real blocker).**
`output: "export"` (`next.config.ts:10`) + runtime CMS/catalog fetch
(`NtCatalogContext.tsx:55-68`) is incompatible with R-12 (Product markup in initial HTML) and R-17
(distinct variant URLs). Making Google Shopping reachable needs per-product routes whose HTML
already contains name/image/price/availability, plus URL-addressable variants. Options the owner
must choose between (I am not choosing for them, and I am not editing files):

- (a) Build-time catalog fetch + `generateStaticParams()` product routes, accepting that price and
  availability freeze until a rebuild (Google tolerates stale markup, but it must stay truthful —
  R-13/R-32).
- (b) Keep the live client fetch for the UI and additionally emit markup from a server-rendered
  snapshot; this repeats the same staleness trade-off in two places and is the worse option.
- (c) Stay as-is and ship no product markup at all — valid, but then there is no Google Shopping
  surface and no feed (the feed's `link` is required, R-31).

**B-02 — Organization cannot be completed without real business data.** `address`, `telephone`,
`email`, `sameAs`, `logo` require values only the business can supply. Until the CMS has them, ship
Organization with `name`, `url`, `@type: "OnlineStore"` and (optionally) `description` — nothing else.

**B-03 — Policy pages are a content/legal task, not an SEO patch.** Return policy, shipping policy
and privacy text already exist as CMS strings (`niththigal-content.tsx:710-729`) but live only in
dialogs. Someone must decide that they become real pages.

**B-04 — Sitemap/robots and the checkout `noindex` touch other owners' files.** Reported here
(G-08, G-10); not fixed.

---

## 6. Conflicts and corrections to `docs/SEO_BRIEF.md`

1. **Brief says the layout has "no Twitter card" (`docs/SEO_BRIEF.md:23`).** Observed dev HTML
   contains `<meta name="twitter:card" content="summary_large_image"/>` plus `twitter:title`,
   `twitter:description`, `twitter:image`. Next.js generates these from `openGraph`. The brief is
   stale on this point.
2. **Brief's FAQ dates are consistent with my re-check** (deprecation May 2026; gone from 2026-05-07;
   docs removed 2026-06-15), and the doc URL now 301s to the changelog anchor. Added detail: the
   `FAQPage` page redirect target is `https://developers.google.com/search/updates?hl=en#removing-faq-rich-result`.
3. **New since the brief:** Google published an AI-optimization guide (changelog 2026-05-15) that
   states outright that Google Search ignores `llms.txt` "neither harm nor help". This is stronger
   and more citable than the brief's "community proposal" framing and should be the wording used in
   any future note.
4. **The brief's claim about Organization-level return policies is still correct**, but the return
   policy documentation has since moved to its own page (changelog 2026-06-10). Cite
   "Merchant return policy" rather than the Organization page for policy details.
5. **No source conflict found** on product snippets vs merchant listings, one-product-per-page, or
   the initial-HTML guidance. All three pages repeat the same sentences verbatim.
6. **Cannot verify:** product image pixel sizes (`bangles.webp`, `necklace.webp`, `jhumka.webp`,
   `hero.webp`) — no WebP dimension probe available here. R-33's 500×500 enforcement (2027-01-31)
   and R-05's 50 000 px recommendation are therefore unverified for this catalog.

---

## 7. Source index (fetched 2026-10-28)

| # | Source | What it establishes |
| --- | --- | --- |
| 1 | <https://developers.google.com/search/docs/appearance/structured-data/product-snippet> | Product snippet required/recommended props; single-product pages; initial HTML |
| 2 | <https://developers.google.com/search/docs/appearance/structured-data/merchant-listing> | Merchant listing `name`/`image`/`offers`; seller requirement; price > 0; availability set; Organization-level policies |
| 3 | <https://developers.google.com/search/docs/appearance/structured-data/product-variants> | `ProductGroup`, `hasVariant`, `isVariantOf`, `productGroupID`, `variesBy`, distinct variant URLs, single/multi-page rules |
| 4 | <https://developers.google.com/search/docs/appearance/structured-data/organization> | No required props; `OnlineStore` subtype; logo ≥112×112; `sameAs`; `contactPoint`; home-page placement |
| 5 | <https://developers.google.com/search/docs/appearance/structured-data/breadcrumb> | ≥ 2 `ListItem`s; `position`/`name`/`item`; last `item` optional; typical user path |
| 6 | <https://developers.google.com/search/docs/appearance/structured-data/faqpage> | Returns `301` → updates page; doc removed |
| 7 | <https://developers.google.com/search/updates#removing-faq-rich-result> | FAQ deprecation (2026-05) and removal (2026-06-15) |
| 8 | <https://developers.google.com/search/docs/appearance/ai-features> | No extra requirements; no AI files or special schema; markup must match visible text |
| 9 | <https://developers.google.com/search/docs/fundamentals/ai-optimization-guide> | Google ignores `llms.txt`; no special schema for generative AI |
| 10 | <https://developers.google.com/search/docs/essentials> | Three parts of Search Essentials; no guarantee of crawling/indexing/serving |
| 11 | <https://developers.google.com/search/docs/fundamentals/creating-helpful-content> | People-first content; E-E-A-T (trust most important, not a ranking factor); Who/How/Why |
| 12 | <https://developers.google.com/search/docs/appearance/structured-data/product> | Product snippets vs merchant listings; structured data + Merchant Center feed are complementary |
| 13 | <https://developers.google.com/search/docs/appearance/structured-data/sd-policies> | Visible content only; truthful representation; all required props; page-specific placement; specificity |
| 14 | <https://support.google.com/merchants/answer/7052112> | Shopping feed required attributes, price/GST rule, image rules, `item_group_id` |
| 15 | <https://developers.google.com/search/docs/specialty/ecommerce> | Ecommerce guidance hub — checked, contains **no** cart/checkout indexing rule |
| 16 | <https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag> | `noindex` semantics — checked, contains **no** cart/checkout example |
