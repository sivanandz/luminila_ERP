# Storefront SEO and AI discoverability — implementation report

Date: 2026-10-28
Scope: `storefront/` (the Niththigal storefront)
Status: implemented; verified only as a localhost static export. **Not deployed, indexed, or
field-measured.**
Report type: technical SEO and structured-data record. It does **not** include a keyword
map, content plan, analytics/consent setup, or field Core Web Vitals data.
Grounding: [`SEO_BRIEF.md`](./SEO_BRIEF.md) (official sources verified 2026-10-27),
[`seo-research/00-confirmation.md`](./seo-research/00-confirmation.md) (eight URLs
re-loaded 2026-10-28), [`SEO_PLAN.md`](./SEO_PLAN.md), and
[`SEO_CONTRACT.md`](./SEO_CONTRACT.md).

This report records what the implementation does, which official rules it follows, what
was verified (and how), what was deliberately omitted, and what remains unproven. The
verification commands in §6 were run on 2026-10-28 while writing this report; the
independent verifier findings in §6.3 come from the run's recorded verification reports.

---

---

## Post-verification repairs (2026-10-29)

The findings below were verified against the build snapshot that produced this report.
After that snapshot, four repairs were made and the export was rebuilt:

- **R1 home payload:** `page.tsx` now passes `trimBrandAssets(content)` to the client
  section components. The rebuilt home HTML is **80,679 bytes** (from 416,859) and
  contains no `data:image`.
- **R4 availability:** `isProductInStock` is exported from `seo.ts` and used by
  `ProductGroup`, `ProductGrid` and the Merchant feed, so
  `stock_status: "out_of_stock"` wins on every surface.
- **R8 eager image:** the primary product image now has `loading="eager"`.
- **Checkout fabricated number:** the current source and build contain neither
  `919876543210` nor `"Fashion Atelier"`; the checkout reads the CMS `niththigal` block
  and hides the WhatsApp action when no number is published.

Re-verified with `npm run seo:build` and
`npm run seo:audit -- --out "<OUT_DIR>"`: **59 pass, 1 warning (localhost origin),
0 failures**. R2 (shipping/COD copy), R3 (placeholder alt), R6 (stale local `.next`
cache), R9 (README placeholder), R12 (Razorpay placeholders) and R13 (llms stock counts)
remain as documented.

## 1. Executive summary

The storefront had one client-rendered marketing page plus a checkout, with one static
metadata block. It had no product URL, no canonical, no robots.txt, no sitemap, no
structured data, no crawlable policy page, and no explicit AI-crawler policy (SEO_BRIEF
§1; 00-confirmation "High" findings 1–3). A browser was required to see products, prices
or policy copy.

**Nothing in this work is live.** The verified export uses `http://localhost:3001`,
contains three products (including `TMP-NCK-LAKSHMI`), and was not submitted to any
search engine or Merchant Center. It is a technical SEO and structured-data record, not a
full SEO program: no keyword map, content plan, analytics instrumentation, or field Core
Web Vitals data exists yet.

The implementation changes that:

- **Build-time rendering.** `src/app/layout.tsx` and the home page are async server
  components. They fetch the CMS content and catalogue once per build, seed the existing
  client providers, and render the real copy, product grid, product links and JSON-LD in
  the initial HTML (`layout.tsx:158-240`, `page.tsx:150-212`).
- **Indexable routes.** Product pages (`/products/<sku-slug>`), collection pages
  (`/collections/<category>`), About, FAQ, Shipping & returns, Jewellery care and Privacy
  are prerendered. The quick-view modal still exists, but the card is now a real anchor
  (`Collection.tsx:232-268`); plain clicks may open quick view, modifier clicks follow the
  URL.
- **Grounded structured data.** `OnlineStore`, `WebSite`, `Product`, `ProductGroup`,
  `BreadcrumbList`, `CollectionPage`, `ItemList`, `FAQPage`, `AboutPage` and `WebPage`
  are emitted by server components. Offers use the catalogue's real price, INR, stock
  status and URL. No such field is invented in the structured data (`seo.ts`); the
  checkout's own fee display is a separate UI issue, see §6.4.
- **Machine-readable surfaces.** `robots.txt` with eight explicit search/answer groups
  and a three-bot training group (`GPTBot`, `ClaudeBot`, `CCBot`), an absolute sitemap,
  `llms.txt`, `llms-full.txt`, and a Google Merchant Center RSS feed. `/checkout` is
  `noindex, nofollow` and excluded everywhere. The training group is not a complete
  AI-training opt-out; other crawlers fall under `*`.
- **A deterministic audit.** `npm run seo:audit` runs 60 check functions over the export
  and exits non-zero on any `fail`; warnings (duplicate titles/descriptions, localhost
  origin) do not fail it.
- **A checkout repair.** The source-honesty verifier found the old checkout reading legacy
  CMS fields and falling back to a fabricated phone number. The checkout now reads the
  shared CMS block and renders WhatsApp only when the CMS supplies a number
  (`checkout/page.tsx:100-104`, `:202-208`, `:347`). The isolated export contains no
  `919876543210` or `"Fashion Atelier"`. Non-SEO placeholders remain in the payment code
  (a test Razorpay key fallback and an external icon); see R12.

**What this does not guarantee.** It does not guarantee Google or Bing indexing, ranking,
AI Overviews/AI Mode inclusion, Google Shopping or free-listing eligibility, Merchant
Center approval, rich results, or field Core Web Vitals. Those outcomes depend on search
engines, Merchant Center review, production hosting and real-user data. Nothing in this
report claims them.

**Decisions required before launch** (these are owner decisions, not verification tasks):

1. **₹99 shipping / ₹99 COD vs the published copy.** The checkout computes ₹99 shipping
   (free over ₹799) and a ₹99 COD fee (`checkout/page.tsx:151-154`), while
   `/shipping-returns` and the home AEO block say delivery is calculated at checkout
   (`niththigal-content-data.ts:719-725`, `page.tsx:63-64`, `:88`). Decide which is true
   before publishing a shipping policy or reviewing structured data.
2. **`TMP-NCK-LAKSHMI` is a temporary SKU.** It appears in the sitemap, feed, `llms.txt`
   and product JSON-LD (`out/products/tmp-nck-lakshmi.html`; `llms.txt:22`). Finalising
   it changes `/products/tmp-nck-lakshmi`; static export has no redirects, and
   `storefront/public` contains no `_redirects` file. Decide the final SKU and the
   redirect mechanism before launch.
3. **Deployment target.** The verification is a static export
   (`output: "export"`). The Docker/VPS path uses `output: "standalone"` and was **not**
   built or audited in this session (`next.config.ts:4-10`, `Dockerfile:21-24`). Choose
   the real target and gate it in CI.
4. **AI-training scope.** `SEO_BLOCK_AI_TRAINING=true` blocks only `GPTBot`, `ClaudeBot`
   and `CCBot`. The `*` group still allows every other crawler, including unnamed
   training crawlers. Decide whether "block AI training" means those three or a broader
   list.
5. **Home payload.** The home HTML is 416,859 bytes, and the same 336 KB data-URL
   wordmark is also duplicated in three RSC `.txt` artifacts (`index.txt`,
   `__next._full.txt`, `__next.__PAGE__.txt`). Host the wordmark or accept the cost. See
   §6.4.1.

**Verification snapshot (2026-10-28, this session).**

| Check | Result |
| --- | --- |
| Isolated build (`npm run seo:build`) | exit 0; Next.js 16.1.0 generated 20/20 static pages; 13 audited HTML documents |
| Deterministic audit (60 checks) | **59 pass, 1 warn, 0 fail**; the warning is the expected localhost origin |
| Independent verifier passes | 3 recorded passes, 11 findings, 38 passed checks; 1 high-severity finding repaired and re-verified. These reports are in the workflow run journal, not in the repository; see §6.3. |
| Residual findings | 1 high-impact performance defect (R1), 1 high launch risk (R11), several medium/low/operational items; see §6.4 |

The single audit warning is `sitemap-host`: the verification build used
`http://localhost:3001` because no production domain was supplied. A production build
must set `NEXT_PUBLIC_SITE_URL`. The audit only warns when the origin is literally
`localhost`; a staging or mistyped production origin would still exit 0. The deploy gate
therefore needs an expected-origin check (see §5.2 and §8).

---

## 2. Grounded standards

The rules below are the ones the code actually relies on. They were verified against the
official pages on **2026-10-27** (SEO_BRIEF §8). The eight URLs marked † were re-loaded on
2026-10-28 in `seo-research/00-confirmation.md`; pages 1 and 4 were served in Japanese
there, and the confirmation records the translated text. The other eleven URLs rest on
the brief's index and were **not** re-fetched for this report; the repository contains no
captured text for them. Treat those eleven as brief-sourced, not freshly re-verified. (The
report reader independently spot-checked the FAQ retirement dates and taxonomy IDs and
reported that both match; that spot check is not repeated here.)

| Standard | Official source | Rule the implementation relies on |
| --- | --- | --- |
| Google Search Essentials | https://developers.google.com/search/docs/essentials | Meeting technical requirements does not guarantee crawling, indexing, or serving. |
| Helpful content / E-E-A-T | https://developers.google.com/search/docs/fundamentals/creating-helpful-content | People-first, original, reliable content; E-E-A-T is not a single ranking factor, and trust is central. |
| Google AI features † | https://developers.google.com/search/docs/appearance/ai-features | No additional requirement for AI Overviews/AI Mode beyond being indexed and snippet-eligible; no special machine-readable file or AI-only markup; structured data must match visible text. |
| Product snippets | https://developers.google.com/search/docs/appearance/structured-data/product-snippet | For pages where users cannot buy directly; `name` plus one of `review`, `aggregateRating`, or `offers`. This store targets merchant listings instead. |
| Merchant listings † | https://developers.google.com/search/docs/appearance/structured-data/merchant-listing | Purchasable page; `name`, `image`, `offers` (an `Offer`, not `AggregateOffer`); price > 0 and `priceCurrency`; Product markup is best in the initial HTML; global shipping/return policy belongs on `Organization`. |
| Product variants † | https://developers.google.com/search/docs/appearance/structured-data/product-variants | `ProductGroup` + `hasVariant`; `productGroupID`; each variant needs a unique identifier and a distinct selectable URL; single-page vs multi-page rules differ. |
| Organization † | https://developers.google.com/search/docs/appearance/structured-data/organization | No required properties; `OnlineStore` is the specific subtype; a logo needs a crawlable ≥112×112 asset; `sameAs` and contact fields need real values. |
| BreadcrumbList | https://developers.google.com/search/docs/appearance/structured-data/breadcrumb | At least two `ListItem`s with `position`, `name`, and `item`; describe a user path, not a URL mirror. |
| FAQPage retirement | https://developers.google.com/search/docs/appearance/structured-data/faqpage | The FAQ rich result was restricted in 2023, stopped appearing on 2026-05-07, and its documentation was removed on 2026-06-15. `FAQPage` is valid schema only. |
| Merchant product data | https://support.google.com/merchants/answer/7052112 | `id` ≤ 50 chars, `title` ≤ 150, `description` ≤ 5,000, `link`, `image_link`, `availability`, `price`, `brand`; `item_group_id` for variants; `age_group`/`gender`/`color` required for Apparel & Accessories free listings. |
| Product taxonomy | https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt | Verified IDs: 188 Jewellery, 194 Earrings, 196 Necklaces, 191 Bracelets, 192 Charms & Pendants, 200 Rings, 6463 Jewellery Sets, 189 Anklets. Bangles → Bracelets (191) is a mapping choice, not a Google rule. |
| OpenAI crawlers † | https://developers.openai.com/api/docs/bots | `OAI-SearchBot` (search) and `GPTBot` (training) are independent; `ChatGPT-User` is user-triggered; robots changes can take about 24 hours. |
| Anthropic crawlers † | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler | `ClaudeBot` trains, `Claude-User` fetches on user request, `Claude-SearchBot` indexes for search; they honor robots.txt. |
| Perplexity crawlers † | https://docs.perplexity.ai/guides/bots | `PerplexityBot` indexes for Perplexity search; `Perplexity-User` is user-requested and generally ignores robots.txt. |
| `llms.txt` † | https://llmstxt.org/ | A proposal, not an adopted standard; an H1 is mandatory; blockquote summary and H2 link lists are conventional; a sitemap is not a substitute. |
| IndexNow | https://www.indexnow.org/documentation | Key 8–128 chars; POST up to 10,000 URLs; 200/202 means received, not indexed. |
| Robots Exclusion Protocol | https://www.rfc-editor.org/rfc/rfc9309 | `User-agent`, `Allow`, `Disallow`, grouping and matching; `Sitemap` is a widely supported extension. |
| Core Web Vitals | https://web.dev/articles/vitals | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile, mobile and desktop; field data is the real measure. |
| Next.js static export | https://nextjs.org/docs/app/guides/static-exports | `generateStaticParams()` for dynamic routes; route handlers need `force-static`; `headers`, `redirects`, ISR, cookies and server actions are unsupported; metadata files are supported. |
| Sitemap protocol | https://www.sitemaps.org/protocol.html | Absolute `<loc>` URLs; `lastmod` optional; 50,000 URLs / 50 MB per sitemap. |

---

## 3. Implementation map

The SEO change is carried by the files below. Some foundation and presentation files
already existed from the storefront redesign; they were integrated and verified rather
than rewritten. "Purpose" describes what the file does in the current implementation.

**Change provenance.** This report describes the current implementation, not a clean
diff against a pre-SEO baseline. `git log --oneline -3 -- storefront/src/lib/seo.ts`
shows the SEO core last changed in commit `4f5003e`, which also contains the AI harness
and storefront redesign; `git status` also shows uncommitted changes to several SEO files
(e.g. `layout.tsx`, `products/[slug]/page.tsx`, `scripts/seo-audit.mjs`). A source-level
delta would need a diff against the intended pre-change commit, which is not established
here. Do not treat a revert of `4f5003e` as a clean SEO rollback.

### 3.1 Foundation, data and structured data

| File | Purpose |
| --- | --- |
| `storefront/src/lib/seo.ts` | Isomorphic constants (`SITE_URL`, `SITE_NAME`, `CONTENT_UPDATED`, `CURRENCY`), URL/slug rules, Google taxonomy map, JSON-LD builders for `OnlineStore`, `WebSite`, `Product`, `ProductGroup`, `BreadcrumbList`, `ItemList`, `CollectionPage`, `FAQPage` and `WebPage`, and `<`/`>`/`&`/U+2028/U+2029-safe serialization. |
| `storefront/src/lib/niththigal-content-data.ts` | Server-safe CMS types, defaults, section map, `mergeNiththigal`, `countCopy`, `yearCopy`; the real footer policy links and policy prose. No `"use client"`. |
| `storefront/src/lib/niththigal-content.tsx` | Client content provider. Seeds state from server-rendered `initialContent`, then refreshes from the ERP after hydration without a first-paint mismatch. |
| `storefront/src/lib/site-content-server.ts` | Build-time CMS fetch (`/api/storefront/content`), merge over defaults, 5 s timeout, redirects refused, host validation (http/https only; loopback/private/reserved denied unless `STOREFRONT_ALLOW_LOCAL_ERP=true`), snapshot fallback, React `cache()` plus a module-level promise. Never fails the build. |
| `storefront/src/lib/catalog-server.ts` | Build-time catalogue fetch (`/api/storefront/catalog`), per-record validation/normalisation, shared sort, slug index, product-by-slug map, category index, snapshot fallback. A successful but empty API response is treated as genuinely empty. |
| `storefront/src/lib/catalog-sort.ts` | The single display order shared by the server catalogue and the client provider, so the grid and slug collision order agree. |
| `storefront/src/lib/llms-text.ts` | Builds `llms.txt` and `llms-full.txt` from the same CMS/catalogue data; includes real prices, variant stock counts, materials, variants, FAQ and policy prose, and states that `llms.txt` is a community convention. **Trade-off:** the files publish exact stock counts (`llms.txt:21-23`, e.g. “11 available”), which go stale on any sale until a rebuild and disclose inventory. |
| `storefront/src/components/seo/JsonLd.tsx` | Server component that renders one `application/ld+json` `@graph` script, or nothing when every node is empty. Never client-injected. |
| `storefront/src/components/seo/EditorialPage.tsx` | Shared server shell for About/FAQ/policy pages: one H1, breadcrumb nav, `WebPage`/`AboutPage` JSON-LD, `dateModified: CONTENT_UPDATED`, internal links. |

### 3.2 Routes

| File | Purpose |
| --- | --- |
| `storefront/src/app/layout.tsx` | Async `generateMetadata()` and `RootLayout`; canonical `/`, Open Graph `siteName`/`en_IN`, Twitter card, robots directives, Google/Bing verification tags, preconnect for ERP/PocketBase origins, `lang="en-IN"`, global `OnlineStore` + `WebSite` graph, and `initialContent`/`initialProducts`/`initialSlugs` seeding. |
| `storefront/src/app/page.tsx` | Server home page. Preserves CMS section order/visibility, renders the existing sections, adds the answer-first AEO block, and emits `ItemList` of real product URLs. |
| `storefront/src/app/products/[slug]/page.tsx` | Prerendered product page (`dynamicParams=false`). One H1, price/stock, SKU/specs, description, care, variants, purchase panel, breadcrumb nav, `Product` or `ProductGroup` JSON-LD, and `BreadcrumbList`. Metadata is `<name> — <category> \| Niththigal` plus the catalog description (`:127-131`); there is no Q&A copy. Canonical is the base product URL; `?variant=` is a selection URL read after hydration (`:143`, `:188-192`, `ProductPurchase.tsx:24-41`). |
| `storefront/src/app/collections/[category]/page.tsx` | Prerendered collection page for non-empty categories only. One H1, visible intro, real product grid, `CollectionPage` + embedded `ItemList` + `BreadcrumbList`; no Product/Offer markup on the listing. |
| `storefront/src/app/about/page.tsx` | `AboutPage` with the CMS story, promise, benefits and the explicit "imitation jewellery, not solid gold" statement. |
| `storefront/src/app/faq/page.tsx` | Every visible CMS question/answer, `FAQPage` + `BreadcrumbList`; no rich-result claim. |
| `storefront/src/app/shipping-returns/page.tsx` | CMS shipping/returns prose, `WebPage` + breadcrumb; metadata derived from the visible copy. |
| `storefront/src/app/jewellery-care/page.tsx` | CMS care guide, `WebPage` + breadcrumb. |
| `storefront/src/app/privacy/page.tsx` | CMS privacy/terms prose, `WebPage` + breadcrumb. |
| `storefront/src/app/checkout/layout.tsx` | Title/description/canonical and `robots: { index: false, follow: false }` for the client checkout page. |
| `storefront/src/app/checkout/page.tsx` | Checkout client. Repaired to read `useNiththigalContent()` (CMS brand/contact) instead of legacy `branding`/`hero`/`socialAndContact`; WhatsApp links and the concierge option are conditional on a real CMS number. It still computes a ₹99 shipping fee and ₹99 COD fee (see §6.4). |
| `storefront/src/app/robots.ts` | `force-static` robots policy: `*`, Googlebot, Bingbot, Applebot, OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot and Claude-User allow the site and disallow `/checkout`; GPTBot/ClaudeBot/CCBot are explicit and switch to `Disallow: /` when `SEO_BLOCK_AI_TRAINING=true`; absolute sitemap; Google-Extended intentionally omitted. |
| `storefront/src/app/sitemap.ts` | `force-static` sitemap: six static pages (including `/`), non-empty collections, every product; absolute URLs; product images only when crawlable; no `/checkout`; `lastModified: CONTENT_UPDATED` on all six static pages (including `/`), none on collections/products. |
| `storefront/src/app/llms.txt/route.ts` | `force-static` short, link-first Markdown index. |
| `storefront/src/app/llms-full.txt/route.ts` | `force-static` fuller Markdown guide with product, FAQ and policy detail. |
| `storefront/src/app/merchant-feed.xml/route.ts` | `force-static` RSS 2.0 + `g:` namespace feed, one item per sellable variant; required fields, INR price, availability, brand, condition, `identifier_exists=no`, `item_group_id` and `size` where grounded; taxonomy ID only when mapped. Skips products without a crawlable image or positive price. |

### 3.3 Components and client behaviour

| File | Purpose |
| --- | --- |
| `storefront/src/components/niththigal/NtCatalogContext.tsx` | Client catalogue provider. Seeds `initialProducts`, `initialSlugs` and the loading flag from the server; refreshes from the ERP without replacing server-rendered products with a loading label; exposes `slugByProductId` and `categories`. |
| `storefront/src/components/product/ProductPurchase.tsx` | Client variant selector, `?variant=` sync inside `Suspense`, quantity clamping to the selected variant's stock, add-to-cart, wishlist, and `aria-live` announcements. |
| `storefront/src/components/product/ProductGrid.tsx` | Server-rendered product cards used by collection and product pages; every card links to the product URL. |
| `storefront/src/components/niththigal/Collection.tsx` | Home showcase. Product image/title are real anchors; modifier clicks keep the URL; a category link row uses the same `buildCategoryIndex` as the collection pages. |
| `storefront/src/components/niththigal/NtFooter.tsx` | Renders shipping/privacy/care as real anchors; saved/search remain dialogs; bare hash links become `/#…` so they work from any page. |
| `storefront/src/components/niththigal/NtHeader.tsx` | Prefixes hash hrefs with `/` so navigation from a product/collection page returns to the home section. |
| `storefront/src/components/niththigal/sections.tsx` | Semantic/performance-only changes: image `width`/`height`/`decoding`, lazy loading for below-fold images, hero `fetchPriority="high"`, and the visible “Illustrative community stories” label. |
| `storefront/src/components/niththigal/nt-footer.css` | Scoped grid rule for the third footer column; imported only by `NtFooter`. |
| `storefront/src/lib/pocketbase.ts` | `formatWhatsAppCartMessage` no longer defaults to a fabricated “Fashion Atelier” brand; the brand segment is omitted when no name is supplied (`:439-448`). |
| `storefront/src/lib/razorpay.ts` | Removes the fabricated Razorpay `name` and `customer@example.com` prefill; optional fields are omitted (`:64-73`). |

### 3.4 Build, audit and deployment tooling

| File | Purpose |
| --- | --- |
| `storefront/package.json` | Adds `seo:build`, `seo:audit`, `seo:indexnow`; keeps `dev`/`build` on `next-run.mjs` (`:6-12`). |
| `storefront/scripts/build-static-isolated.mjs` | Builds outside the repository in `%TEMP%/niththigal-seo-build`, mirrors/junctions `node_modules`, loads the exFAT readlink shim, seeds `NEXT_PUBLIC_SITE_URL`/`ERP_API_URL`, auto-enables snapshots when present, prints `OUT_DIR`, and exits with the Next build status. |
| `storefront/scripts/next-run.mjs` | Launcher for `npm run dev` / `npm run build`; preloads `fix-exfat-readlink.cjs` and runs `next build --webpack`. |
| `storefront/scripts/fix-exfat-readlink.cjs` | Converts the exFAT volume's spurious `readlink` `EISDIR` to `EINVAL`; used by both launchers. Separately, Turbopack cannot write the `node:fs` external chunk on this setup, so the build uses webpack. |
| `storefront/scripts/seo-audit.mjs` | Deterministic offline audit of the export. 60 check functions (some aggregate over 13 documents or emit conditionally): robots, sitemap, `llms` files, Merchant feed, HTML metadata/canonicals/H1/noindex, JSON-LD, cross-file consistency and internal links. `--json` prints `{ ok, outDir, summary, checks }`; `fail` exits 1; `warn` does not. The default `--out` is `%TEMP%/niththigal-seo-build/out`, not `storefront/out` (`:27`, `:41`). |
| `storefront/scripts/indexnow.mjs` | Validates `INDEXNOW_KEY` (`^[A-Za-z0-9-]{8,128}$`), writes `public/<key>.txt` if missing, requires an HTTPS non-loopback `NEXT_PUBLIC_SITE_URL`, reads the isolated `out/sitemap.xml` (or `--out`/live), submits at most 10,000 same-host URLs, and reports 200/202 as receipt only. |
| `storefront/.env.example` | Documented local/build environment: site URL, ERP URL, PocketBase URL, verification tags, IndexNow key, AI-training switch, snapshots. |
| `deploy/env.example` | VPS environment template: `NEXT_PUBLIC_SITE_URL`, `ERP_API_URL`, PocketBase, verification tags, IndexNow, AI-training switch, snapshots, host split. |
| `.gitignore` | Ignores `storefront/out/` and local `storefront/catalog-snapshot.json` / `content-snapshot.json` fixtures. |
| `storefront/next.config.ts` | Reviewed, unchanged: `output: "export"` by default, `standalone` only when `BUILD_STANDALONE=true`; `images.unoptimized`; pinned Turbopack root. |
| `storefront/scripts/readlink-eisdir-shim.cjs` | Deleted; replaced by `fix-exfat-readlink.cjs`. |
| `storefront/catalog-snapshot.json`, `storefront/content-snapshot.json` | Removed from version control; optional local/CI fixtures only. The verified build in §6 used the live ERP, not these snapshots. |

### 3.5 Documentation

| File | Purpose |
| --- | --- |
| `docs/SEO_BRIEF.md` | Grounded standards brief, pre-change audit, honesty constraints and source index. |
| `docs/SEO_PLAN.md` | File-by-file plan and acceptance criteria (retained as the design record). |
| `docs/SEO_CONTRACT.md` | Maintenance contract: exports, data flow, URL/slug rules, JSON-LD, honesty rules, machine-readable surfaces, verification. |
| `docs/seo-research/00-confirmation.md` | Bounded re-verification of eight official URLs and the pre-implementation gap list. |
| `docs/seo-research/01-google-search-shopping.md` | Research record for Google Search/Shopping and structured data. |
| `docs/seo-research/02-ai-crawlers-answer-engines.md` | Research record for AI crawlers, robots.txt and `llms.txt`. |
| `docs/README.md` | Adds the SEO report, brief, plan, contract and confirmation to the documentation index. |
| `docs/SEO_AI_OPTIMIZATION.md` | This report. |

---

## 4. Deliberate omissions and why

These are honesty decisions, not missing fields. Each omission is enforced by the builders
or by the audit.

1. **No `aggregateRating` or `review`.** The testimonials are visibly labelled
   “Illustrative community stories” (`sections.tsx:347`,
   `niththigal-content-data.ts:548`). Marking them as reviews would be fabricated data.
   The audit forbids both keys on every page (`ldjson-no-forbidden`).

2. **No `address`, `telephone`, `email` or `sameAs`.** The CMS defaults are empty
   (`niththigal-content-data.ts:429-431`), and `organizationJsonLd` only emits a
   `contactPoint` or `sameAs` when a real value is passed (`seo.ts:338-365`). The layout
   passes `sameAs` only when `contact.instagramUrl` is non-empty (`layout.tsx:183-185`).
   A fake address or profile would be worse than the omission. The checkout repair also
   removed its old hardcoded WhatsApp fallback; WhatsApp now renders only from
   `contact.whatsappPhone` (`checkout/page.tsx:100-104`).

3. **No data-URL logo.** `brand.logoUrl` is empty
   (`niththigal-content-data.ts:387`); the only uploaded wordmark is a data URL, and
   `absoluteAssetUrl` rejects `data:`, `blob:`, `javascript:`, `mailto:`, `tel:` and
   WhatsApp CDN URLs (`seo.ts:83-110`). `Organization.logo` therefore stays omitted until
   a crawlable, hosted, at-least-112×112 asset exists. **Known residual:** the home page
   still passes the raw CMS content object to client section components, so the 336 KB
   data-URL wordmark remains in the home RSC payload even though it is not in JSON-LD.
   The same payload is duplicated in `index.txt` and `__next._full.txt`; see §6.4.1 and
   finding R1.

4. **No shipping rate or `Offer.shippingDetails`.** The published policy page says
   delivery is calculated at checkout and does not state a rate
   (`niththigal-content-data.ts:719-725`). The home AEO block repeats the same claim
   (`page.tsx:63-64`, `:88`). The Merchant feed has no shipping or tax fields
   (`feed-no-shipping-tax`). **Known residual and owner decision:** the checkout computes
   ₹99 shipping (free over ₹799) and a ₹99 COD fee (`checkout/page.tsx:151-154`), so the
   visible site simultaneously says “calculated at checkout” and charges a rate. The
   structured data remains conservative; see §6.4, finding R2. If ₹99 is real, publish it
   on `/shipping-returns` and in the AEO copy, then revisit the schema; if not, fix the
   checkout. This is a pricing/consumer-copy contradiction, not a schema gap.

5. **No `priceValidUntil`.** The catalogue supplies no expiry date. A made-up date would
   be a false freshness claim. The audit forbids the key.

6. **No `SearchAction`.** Search is an in-page dialog (`NtFooter.tsx:49-66`), not a URL.
   A `SearchAction` would describe a target that does not work. `webSiteJsonLd` never
   emits `potentialAction` (`seo.ts:374-383`).

7. **No Google FAQ rich-result claim.** Google retired the FAQ rich result (stopped
   appearing 2026-05-07; documentation removed 2026-06-15). `/faq` emits valid
   `FAQPage` markup for other consumers, and neither the page nor this report presents it
   as a Google rich-result opportunity.

8. **Google-Extended is omitted from robots.txt; the training switch is partial.** The
   brief (§4.4) and `00-confirmation.md` record that Google-Extended's official
   documentation was never verified; `robots.ts:13-14` says so explicitly. Separately,
   `SEO_BLOCK_AI_TRAINING=true` switches only `GPTBot`, `ClaudeBot` and `CCBot` to
   `Disallow: /` (`robots.txt:16-20`). The `*` group still allows every crawler not
   named elsewhere, including other AI crawlers. The report's “training crawler groups”
   therefore means those three, not a complete AI-training opt-out. Do not add
   Google-Extended until its current documentation is verified.

9. **No `age_group`, `gender` or `color` in the Merchant feed.** Google requires these
   for Apparel & Accessories free listings, and the catalogue does not supply them.
   Guessing could cause feed disapproval. This is a catalogue/CMS gap, not a formatting
   choice; see §7.

10. **No GTIN or MPN.** The catalogue has no manufacturer identifiers. The feed declares
    `identifier_exists=no` and omits GTIN/MPN (`merchant-feed.xml/route.ts:81-95`). The
    per-variant `sku` values are storefront identifiers (for example
    `BGL-NILA-HERITAGE-2.4`), never claimed as manufacturer MPNs.

11. **No special AI file or AI-only schema.** Google states that AI Overviews/AI Mode add
    no requirement beyond normal indexing and snippet eligibility. `llms.txt` is
    published as a useful convention, not a standard and not a Google requirement; both
    generated files say so. The files do publish exact variant stock counts, which are
    build-time snapshots and disclose inventory (`llms.txt:21-23`); that is a deliberate
    trade-off, not live data. See finding R13.

12. **The 7-day return policy *is* included at Organization level.** The visible policy
    says “a simple 7-day return promise”
    (`niththigal-content-data.ts:626`, `:629`, `:722`), so `OnlineStore` carries
    `hasMerchantReturnPolicy: { applicableCountry: "IN", returnPolicyCategory:
    MerchantReturnFiniteReturnWindow, merchantReturnDays: 7 }` (`seo.ts:312-317`,
    `:348-354`). Google recommends putting a global policy on `Organization`; the audit
    allows the property only on `Organization`/`OnlineStore`, never inside a
    Product/Offer (`ldjson-return-policy-placement`). No shipping rate or expiry is
    added alongside it.

13. **Out of scope: keyword research, content plan, analytics, consent, and field CWV.**
    This change makes the existing catalogue and copy crawlable and machine-readable; it
    does not choose target queries, write a content calendar, install GA4/Search Console
    tags, gate analytics behind consent, or measure CrUX. Those are separate workstreams
    and are not claimed as done.

---

## 5. Deployment checklist

### 5.1 Environment variables

`NEXT_PUBLIC_*` values are inlined at build time, so a change requires a rebuild. The
build-time ERP origin is operator configuration, not request input; only `http:`/`https:`
is fetched, credentials are refused, redirects are refused, and loopback/private/reserved
hosts are refused unless `STOREFRONT_ALLOW_LOCAL_ERP=true`
(`site-content-server.ts:114-129`, `:179-193`).

| Variable | When | Required | What it controls | Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Build | **Yes, production** | Canonicals, Open Graph, JSON-LD `@id`/URLs, sitemap, `llms` links, feed links, robots sitemap | Absolute `http(s)` origin, no trailing slash. Fallback chain: `NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_STOREFRONT_URL` → `http://localhost:3001` (`seo.ts:30-34`). Never invent a production domain. |
| `ERP_API_URL` | Build | **Yes at build if the ERP is remote** | Build-time `/api/storefront/content` and `/catalog` fetch | Must be a public `http(s)` origin in production. Local/private values are refused without the opt-in. |
| `NEXT_PUBLIC_ERP_API_URL` | Build/browser | If the ERP is on a split origin | Browser-side content/catalog/order calls | The build prefers `ERP_API_URL`; the client uses the public value. |
| `NEXT_PUBLIC_POCKETBASE_URL` | Build/browser | If PocketBase is used | PocketBase gateway and preconnect | Not a structured-data value; keep it out of canonicals. |
| `GOOGLE_SITE_VERIFICATION` | Build | Optional | Google Search Console HTML-tag verification | Omit until the property exists (`layout.tsx:145-154`). |
| `BING_SITE_VERIFICATION` | Build | Optional | Bing Webmaster `msvalidate.01` | Omit until the property exists. |
| `INDEXNOW_KEY` | CLI/deploy | Optional | `public/<key>.txt` and IndexNow submission | 8–128 chars, `A-Z a-z 0-9 -`; the script requires an HTTPS non-loopback origin (`indexnow.mjs:61-102`). Not a runtime value. |
| `SEO_BLOCK_AI_TRAINING` | Build | Optional | GPTBot/ClaudeBot/CCBot group in robots.txt | `true` switches those three to `Disallow: /`; search/answer crawlers stay allowed (`robots.ts:17-47`). Default is allow. |
| `STOREFRONT_CATALOG_SNAPSHOT` | Build | Optional | Offline/CI catalogue fixture | Must be exactly `catalog-snapshot.json` in the build directory; any other value is ignored with a warning (`catalog-server.ts:165-175`). |
| `STOREFRONT_CONTENT_SNAPSHOT` | Build | Optional | Offline/CI CMS fixture | Must be exactly `content-snapshot.json` in the build directory (`site-content-server.ts:199-209`). |
| `STOREFRONT_ALLOW_LOCAL_ERP` | Build | Local only | Allows a loopback/private ERP at build time | Never set in production. The isolated build sets it for its `127.0.0.1` default. |
| `BUILD_STANDALONE` | Build | Docker/VPS only | Switches `output` from `export` to `standalone` | Leave unset for Cloudflare Pages/static export (`next.config.ts:4-10`). |

`NEXT_PUBLIC_STORE_NAME` and `NEXT_PUBLIC_STORE_CURRENCY` remain in `.env.example` for
other storefront code; they do not drive the SEO builders, which use the CMS brand name
and the `INR` constant (`seo.ts:37-50`). No source file reads either variable.

### 5.2 Build and static export

```bash
cd storefront
npm ci
# Set the build-time values from §5.1 in the build environment.
npm run build          # next-run.mjs -> next build --webpack, output "export"
```

`npm run build` uses `scripts/next-run.mjs`, which preloads
`scripts/fix-exfat-readlink.cjs` and runs `next build --webpack`. The plan and contract
record that Turbopack on this Windows/exFAT setup cannot write the `node:fs` external
chunk filename; the build therefore uses webpack. The shim is needed because `fs.readlink`
returns `EISDIR` on the volume.

After the build, confirm:

- `out/index.html`, `out/robots.txt`, `out/sitemap.xml`, `out/llms.txt`,
  `out/llms-full.txt`, `out/merchant-feed.xml`.
- `out/products/<slug>.html` for every product and `out/collections/<slug>.html` for
  every non-empty category.
- `/checkout` is `noindex, nofollow` and absent from the sitemap.
- The sitemap and canonicals use the production origin, not localhost.

Run the audit against the output you are about to deploy:

```bash
node scripts/seo-audit.mjs --out out --json
```

The audit defaults to `%TEMP%\niththigal-seo-build\out` (`seo-audit.mjs:27`, `:41`), not
`storefront/out`. `npm run seo:audit` therefore audits the isolated build; on a fresh CI
runner without that directory it exits 2 (“Export directory not found”,
`seo-audit.mjs:59-62`). For a deploy gate, use the `--out out` form above against the
artifact you will upload.

Exit 0 permits warnings. `html-title-unique`, `html-description-unique` and `sitemap-host`
are warnings, so duplicate titles/descriptions or a non-production origin can still exit
0. A production gate should require `fail: 0` and inspect `warn: 0`; `sitemap-host` only
warns for a literal `localhost` origin, so a staging or mistyped origin needs a separate
expected-origin assertion (`seo-audit.mjs:568-573`).

For an offline/CI build, place `catalog-snapshot.json` and/or `content-snapshot.json` in
the build directory and set the corresponding variables. They are fallbacks, not
overrides: if the ERP answers successfully with an empty catalogue, the build treats it
as genuinely empty and does not substitute the snapshot (`catalog-server.ts:215-239`).
The snapshots are gitignored; supply them through the CI checkout or build context.

### 5.3 Cloudflare Pages (static export)

1. Root directory: `storefront`.
2. Build command: `npm run build`.
3. Build output directory: `out`.
4. Set `NEXT_PUBLIC_SITE_URL`, `ERP_API_URL` (or a public `NEXT_PUBLIC_ERP_API_URL`),
   `GOOGLE_SITE_VERIFICATION`/`BING_SITE_VERIFICATION` once the properties exist, and any
   optional values from §5.1 in the Pages build environment. If the ERP is not reachable
   during the Pages build, provide the snapshots. No verification tag is present in the
   current export because the variables are unset.
5. Verify that extensionless routes resolve: `/products/<slug>` must serve
   `out/products/<slug>.html`, and `/collections/<slug>` likewise. Cloudflare Pages
   usually handles this, but confirm it on the first deploy rather than assuming it.
6. Finalise the `TMP-` SKU before launch. `storefront/public` contains no `_redirects`
   file (`dir /b public` → `instagram`, `niththigal`, `icon.svg`), so a SKU rename will
   404 unless a Pages redirect rule is added first.
7. Submit `https://<domain>/sitemap.xml` in Google Search Console and Bing Webmaster
   Tools, and `https://<domain>/merchant-feed.xml` in Google Merchant Center.

**Careful:** `storefront/README.md:39` still shows
`NEXT_PUBLIC_WHATSAPP_PHONE: 919876543210` in the Cloudflare Pages instructions. That is
a placeholder/fabricated number, not a real contact. The active checkout no longer reads
that variable; do not copy the value into the storefront configuration. The README is
outside the SEO change and was not edited.

### 5.4 Docker / VPS (standalone Next server)

The storefront Dockerfile sets `BUILD_STANDALONE=true` and runs `npm run build`
(`Dockerfile:21-24`). That selects `output: "standalone"` (`next.config.ts:4-10`), copies
`.next/standalone` and `.next/static`, and runs `node server.js` on port 3000
(`Dockerfile:40-50`). This is not the static-export path; the same SEO route handlers are
still generated at build time, and Next serves them natively.

1. Set `NEXT_PUBLIC_SITE_URL`, `ERP_API_URL`, `NEXT_PUBLIC_POCKETBASE_URL` and
   `NEXT_PUBLIC_ERP_API_URL` in the build environment. They are inlined at build time.
2. Build and start the container.
3. Route `/api/storefront/*` to the ERP and `/api/pb/*` to PocketBase as documented in
   `storefront/README.md:81-98`.
4. Submit the sitemap and Merchant feed as above.
5. Clear or rebuild `.next` before starting from a cache that predates the checkout
   repair; see §6.4, finding R6.

`next-run.mjs` works on Linux; the exFAT shim is a no-op there. The standalone build was
**not** run in this session; only the static export was built and audited. If VPS is the
real deployment target, add a standalone build plus the audit to CI before treating this
work as deployable; the static-export verification does not cover the standalone server.

### 5.5 IndexNow

```bash
cd storefront
INDEXNOW_KEY=<8-128-char-key> NEXT_PUBLIC_SITE_URL=https://<production-host> npm run seo:indexnow
```

The script writes `public/<key>.txt` when missing, reads the isolated
`out/sitemap.xml` (or the live sitemap), and submits at most 10,000 same-host URLs. The
key file must be deployed with the site. A 200/202 response means the endpoint received
the submission, not that anything was indexed. The script refuses HTTP origins,
loopback/private hosts and an absent/malformed key. It was not executed against the real
endpoint in this session because no real key or HTTPS origin exists.

### 5.6 Dev-server output-lock caveat

A local `next dev` on port 3001 can hold handles in `storefront/out` and make an in-place
`next build` fail with `EPERM`/`ENOTEMPTY` during export cleanup. Stop the dev servers
first, or use `npm run seo:build`, which builds outside the repository in
`%TEMP%/niththigal-seo-build` and never deletes the developer's `out` or `.next`. CI and
Docker do not have this problem. The current working-tree `storefront/out` is incomplete
(no `index.html` or `robots.txt`) and must not be deployed; it is a stale, gitignored
directory.

### 5.7 Rollback and ownership

- **Rollback:** redeploy the previous known-good export (or container image). Do not
  revert commit `4f5003e` wholesale: it also contains the AI harness and storefront
  redesign, and the SEO core files are part of that commit. The working tree has separate
  uncommitted changes. A clean rollback is an artifact redeploy, not a source revert.
- The only file written outside the build by these scripts is `public/<INDEXNOW_KEY>.txt`
  (IndexNow); no schema or data migration exists.
- **Ownership:** no owner or date is assigned in this report for R1–R16, the decisions in
  §1, or the monitoring plan. That is an open operational gap; assign owners before
  launch. In particular, `CONTENT_UPDATED` (`seo.ts:47`) and the visible “Reviewed
  2026-10-28” lines must be bumped by an owner on a real copy change; the sitemap
  `lastmod` and `dateModified` depend on that value.

---

## 6. Verification results

### 6.1 Commands run in this writing session

Both commands were executed on 2026-10-28 from `storefront/`, against the current source
and the live local ERP (`http://127.0.0.1:3000` returned HTTP 200). The isolated build
recreated its build directory and copied no snapshot files (`dir /b
"%TEMP%\niththigal-seo-build\*.json"` shows only `package.json` and `tsconfig.json`), so
the build log has no `Snapshots:` line. Snapshots are read from the build directory, not
the working tree (`catalog-server.ts:165-175`); the earlier phrasing “none were in the
working tree” was imprecise.

```text
> npm run seo:build
> node scripts/build-static-isolated.mjs

[seo:build] Isolated build directory: C:\Users\sivan\AppData\Local\Temp\niththigal-seo-build
[seo:build] fs.readlink returns EISDIR on this volume; loading the normalising shim.
[seo:build] NEXT_PUBLIC_SITE_URL=http://localhost:3001 ERP_API_URL=http://127.0.0.1:3000
▲ Next.js 16.1.0 (webpack)
✓ Compiled successfully in 5.4s
✓ Generating static pages using 23 workers (20/20)
OUT_DIR=C:\Users\sivan\AppData\Local\Temp\niththigal-seo-build\out
BUILD_EXIT=0
```

```text
> node scripts/seo-audit.mjs --out "C:\Users\sivan\AppData\Local\Temp\niththigal-seo-build\out" --json
{
  "ok": true,
  "summary": { "pass": 59, "warn": 1, "fail": 0 }
}
AUDIT_EXIT=0
```

The audit reports **60 check functions**: 59 pass, 1 warn (`sitemap-host`), 0 fail. Some
checks aggregate across all 13 documents (for example one `html-canonical` check covers
every page), and some are emitted conditionally (a missing `llms.txt` produces one
`llms-exists` fail instead of the four normal `llms-*` checks). The count is therefore a
check-list size, not 60 independent assertions. The warning is expected because the
verification build used the local fallback origin; it is not a defect in the production
configuration, provided `NEXT_PUBLIC_SITE_URL` is set at deploy time.

The export contains **13 audited HTML documents**: the home page, five
editorial/policy pages, three collection pages, three product pages and `/checkout`.
`404.html` and `_not-found.html` are excluded by the audit. Next reported 20/20
prerendered pages including the non-HTML artifacts.

### 6.2 Audit coverage (60 checks)

| Group | Count | Check ids |
| --- | ---: | --- |
| robots.txt | 7 | `robots-exists`, `robots-sitemap`, `robots-ai-groups`, `robots-checkout-blocked`, `robots-allow-site`, `robots-no-asset-block`, `robots-training-groups` |
| sitemap.xml | 7 | `sitemap-exists`, `sitemap-wellformed`, `sitemap-absolute`, `sitemap-no-checkout`, `sitemap-pages`, `sitemap-images`, `sitemap-host` |
| llms.txt / llms-full.txt | 9 | `llms-h1`, `llms-summary`, `llms-convention`, `llms-links`, `llms-full-h1`, `llms-full-summary`, `llms-full-convention`, `llms-full-links`, `llms-full-products` |
| Merchant feed | 11 | `feed-wellformed`, `feed-exists`, `feed-required-fields`, `feed-field-bounds`, `feed-price-format`, `feed-field-values`, `feed-unique-ids`, `feed-links`, `feed-item-groups`, `feed-no-shipping-tax`, `feed-no-checkout` |
| HTML metadata | 9 | `html-lang`, `html-title`, `html-title-unique`, `html-description`, `html-description-unique`, `html-canonical`, `html-h1`, `html-no-noindex`, `checkout-noindex` |
| JSON-LD | 14 | `ldjson-parses`, `ldjson-context`, `ldjson-no-forbidden`, `ldjson-return-policy-placement`, `ldjson-no-data-urls`, `ldjson-organization`, `ldjson-return-policy`, `ldjson-website`, `ldjson-product`, `ldjson-offer`, `ldjson-breadcrumb`, `ldjson-collection`, `ldjson-faq`, `ldjson-home-itemlist` |
| Cross-file consistency | 3 | `sitemap-products-match`, `sitemap-collections-match`, `internal-links-resolve` |

The machine-readable engineer also ran the audit against a deliberately mutated copy
(Googlebot group removed, one sitemap URL relativised, About H1 removed,
`merchantReturnDays` changed to 3, `aggregateRating` injected, feed price set to 0.00
INR). It exited 1 with 7 failures, including `robots-ai-groups`, `sitemap-absolute`,
`html-h1`, `ldjson-no-forbidden`, `ldjson-return-policy` and `feed-price-format`. That
negative test is recorded in its verification report; it demonstrates the checks are not
vacuous. No mutation script or artifact is checked into the repo, and the test was not
re-run in this session; treat it as a recorded claim, not a reproducible check.

### 6.3 Independent verifier results

Three read-only verifier passes were recorded in the workflow run journal for run
`dwfrun-95c4b913-3dbb-4510-abf8-960f23044390`. Their counts are reproduced here. **The
reports are not files in this repository**, so a reader with only the repo cannot inspect
them; the provenance is the run journal (the `dwf_actor`/`dwf_node` records for the
source-honesty verifier, technical SEO verifier and re-verification specialist). They are
not the report writer's own checks, and their counts are not independently reproducible
from the checked-in tree alone.

| Verifier | Findings | Passed checks | Outcome |
| --- | ---: | ---: | --- |
| Source-honesty verifier | 7 (1 high, 2 medium, 4 low) | 14 | The high-severity checkout phone/brand finding was repaired and re-verified. Two medium and three low findings remain; one low documentation finding was fixed. |
| Technical SEO verifier | 3 (2 verified low, 1 unconfirmed low) | 19 | Two low findings remain; the unconfirmed build check was closed by this session's `npm run seo:build` (exit 0). |
| Re-verification specialist | 1 (1 low) | 5 | Confirmed the checkout repair in source and in the isolated export; flagged a stale local `.next` cache that still contains the old checkout bundle. |

The source-honesty verifier's **high-severity** finding was that
`checkout/page.tsx` read the legacy `branding`/`hero`/`socialAndContact` fields and fell
back to `919876543210`; the built checkout chunk contained
`{brandName:"Fashion Atelier",whatsappPhone:"919876543210"}`. The repair now reads
`useNiththigalContent()` and renders WhatsApp only when
`siteContent.contact.whatsappPhone` is non-empty (`checkout/page.tsx:100-104`,
`:202-208`, `:347`, `:420`). A scan of the current source and the current isolated export
found **no** `919876543210` or `"Fashion Atelier"`; the re-verification pass confirmed the
same and checked the built chunk references.

The technical verifier's **unconfirmed** finding was procedural: it did not rerun the
build, so its exit code was not independently reproduced by that pass. This session ran
`npm run seo:build` and got exit 0, so that gap is closed. Its other findings are in
§6.4.

### 6.4 Residual findings

These are known and reproducible. They do not contradict the audit's pass result because
the audit checks the SEO contract, not every UI, payload, pricing or ops concern.

#### 6.4.1 Home-page payload (performance)

The home page is the one measurable performance defect. Measured in this session:

| File | Size |
| --- | ---: |
| `out/index.html` | 416,859 bytes |
| `out/index.txt` | 376,949 bytes |
| `out/__next._full.txt` | 376,949 bytes |
| `out/__next.__PAGE__.txt` | 710,869 bytes |
| `out/about.html` (comparison) | 50,881 bytes |
| `out/products/bgl-nila-heritage.html` (comparison) | 56,630 bytes |

The 336,034-character `data:image` wordmark starts at character offset 54,649 in
`index.html` and is duplicated in the `.txt` RSC artifacts (`index.txt`,
`__next._full.txt`, `__next.__PAGE__.txt`). `trimBrandAssets` strips data URLs only
from the provider's `initialContent`; `page.tsx` passes the raw `content` object to client
section components (`layout.tsx:57-67`, `:167`; `page.tsx:159-170`; `sections.tsx` is a
client module). It is not in JSON-LD, and `Organization.logo` is correctly omitted. The
source-honesty verifier logged this as Medium; this report treats its performance impact
as **High** because it dominates the most important page. It contradicts
`SEO_CONTRACT.md` §2.5's claim that data URLs are stripped from the initial payload.

| Id | Finding | Severity | Evidence | Recommended action |
| --- | --- | --- | --- | --- |
| R1 | The home HTML and its RSC artifacts embed the 336 KB data-URL wordmark across four exported files. It is a page-weight and payload/privacy defect, not a structured-data defect. | **High (performance)**; verifier logged Medium | Table above; `index.html` character offset 54,649; `layout.tsx:57-67`, `:167`; `page.tsx:159-170`. | Host the wordmark and strip data-URL brand assets from the object passed to the client sections; re-measure and run Lighthouse/CWV. |
| R2 | The checkout UI states a ₹99 shipping fee (free over ₹799) and a ₹99 COD fee, while `/shipping-returns` and the home AEO block say delivery is calculated at checkout. Structured data and the feed remain conservative and contain no shipping rate. | Medium (pricing/copy; owner decision) | `checkout/page.tsx:151-154`, `:240`, `:336`, `:983-993`; `niththigal-content-data.ts:719-725`; `page.tsx:63-64`, `:88`. | Decide which is true. If ₹99 is policy, publish it on `/shipping-returns` and the AEO copy, then revisit the schema; if not, fix checkout. Do not add `shippingDetails` until a real rate is published. |
| R3 | A product without `image_url` renders `/niththigal/necklace.webp` with alt text naming the actual product. The plan says the placeholder should have `alt=""`. The current catalogue has images for all three products, so the built output does not exercise this path. | Low | `Collection.tsx:238`, `ProductGrid.tsx:33-36`, `products/[slug]/page.tsx:241`. | Use `alt=""` for the placeholder or render a visibly labelled placeholder. |
| R4 | Availability is computed inconsistently: `ProductGroup` variant offers use only positive variant stock (`seo.ts:560`), collection cards use only `total_stock` (`ProductGrid.tsx:65`), while the product page and feed also honour `stock_status: "out_of_stock"`. The current catalogue is all `in_stock`, so the export agrees. | Low | `seo.ts:560`; `ProductGrid.tsx:65`; `products/[slug]/page.tsx:96-105`; `merchant-feed.xml/route.ts:61-62`. | Centralise one availability predicate and use it everywhere. |
| R5 | Unused legacy components still hardcode a phone number. They are not imported by the active layout or any source file and are not bundled, but reuse would resurrect a fabricated contact. | Low | `Header.tsx:59` and `Footer.tsx:10` (`+917092122334`), `StickyMobileBar.tsx:14`; verifier's import scan found no active imports. | Delete them or update them before any reuse. |
| R6 | The local `.next` build cache still contains the pre-repair checkout bundle with the fabricated phone and legacy brand. The source and isolated export are clean, but starting a server from that stale cache without rebuilding would expose the old values. | Low (local) | This session's `findstr /s /m /c:"919876543210" /c:"Fashion Atelier" .next\*` matched exactly: `.next\cache\webpack\server-production\0.pack`, `.next\cache\webpack\client-production\0.pack`, `.next\server\chunks\63.js`, `.next\server\app\checkout\page.js`, `.next\static\chunks\app\checkout\page-1c026d37e0cf38d0.js`, `.next\static\chunks\631-2a54b114e64e719f.js`. `.next\dev\server\app\page.js` is no longer a match and was removed from this list. | Clear `.next` or rebuild before `next start`; Docker/CI rebuild. The isolated `out` has no such matches. |
| R7 | The working-tree `storefront/out` is incomplete (no `index.html`, `robots.txt`, `sitemap.xml`, or feed) and is gitignored. It is not the verified artifact. | Low (local) | `dir /b out` shows only `_next`, `instagram`, `niththigal`, route directories and `_not-found`; `out/index.html` and `out/robots.txt` do not exist. | Deploy a fresh `npm run build` output or the isolated `OUT_DIR`, never this stale directory. |
| R8 | The primary product image has `fetchPriority="high"` and `decoding="async"` but no explicit `loading="eager"`; the HTML default is eager, so runtime behaviour matches the plan's intent, but the named attribute is absent. | Low | `products/[slug]/page.tsx:257-264`. | Add `loading="eager"` if strict plan adherence is required. |
| R9 | `storefront/README.md:39` still shows `NEXT_PUBLIC_WHATSAPP_PHONE: 919876543210` in the Cloudflare Pages steps. The active checkout no longer reads that env var, but copying the value would publish a fake contact in other tooling. | Low (documentation) | `storefront/README.md:39`. | Treat it as a placeholder, not a real number; update the README separately. Do not set it in production. |
| R10 | `SEO_CONTRACT.md:267` says `npm run seo:audit` “defaults to storefront/out”. The script actually defaults to `%TEMP%\niththigal-seo-build\out` (`seo-audit.mjs:27`, `:41`). The contract's verification section is wrong on this point; the rest of its audit list is accurate. | Low (documentation) | `SEO_CONTRACT.md:264-271` vs `seo-audit.mjs:27`, `:41`; `npm run seo:audit` is `node scripts/seo-audit.mjs --json` (`package.json:11`). | Correct the contract, or change the script default; use `--out out` for deploy gates. The earlier claim that the current contract is fully accurate was wrong. |
| R11 | `TMP-NCK-LAKSHMI` is a temporary SKU published in the sitemap, feed, `llms.txt` and product JSON-LD. Finalising it changes `/products/tmp-nck-lakshmi`; static export has no redirects and `storefront/public` has no `_redirects` file. | **High (launch decision)** | Sitemap `<loc>.../tmp-nck-lakshmi`; `llms.txt:22`; `out/products/tmp-nck-lakshmi.html`; slug from SKU (`seo.ts:135-142`); `public` contains only `instagram`, `niththigal`, `icon.svg`. | Decide the final SKU before launch and add a redirect map (Pages `_redirects` or nginx) for any rename; otherwise treat SKUs as immutable. |
| R12 | The checkout still has non-SEO placeholders: a `rzp_test_placeholder_key` fallback (`razorpay.ts:54-57`) and a Flaticon-hosted payment icon (`:68`). The checkout repair removed the fabricated brand/email/phone, not these. | Medium (non-SEO) | `razorpay.ts:54-57`, `:68`. | Require a real Razorpay key in production and host the icon; do not ship a test-key fallback. |
| R13 | `llms.txt` publishes exact variant stock counts (“11 available”, “6 available”, “8 available”). They go stale on any sale until a rebuild and disclose inventory. | Low/Medium (content policy) | `llms.txt:21-23`; `llms-text.ts:17-24`. | Decide whether exact counts are acceptable; otherwise publish only availability status. |
| R14 | Visible copy says “Prices and stock are shown live on each product page” (`page.tsx:63-64`, `:143`) and “delivery is calculated at checkout”. Product pages render the build-time server prop (`products/[slug]/page.tsx:271-274`) and do not refresh price/stock after hydration; only CMS content and the home grid refresh. JSON-LD, sitemap and feed are build-time too. | Medium (content accuracy) | `page.tsx:63-64`, `:88`, `:143`; `products/[slug]/page.tsx:271-274`, `:292`; `NtCatalogContext.tsx:47-51`, `:61` (home/collection grids only). | Reword to “prices shown are current at build time” or add a real product refresh; resolve the delivery copy with R2. |
| R15 | `SEO_BLOCK_AI_TRAINING=true` blocks only `GPTBot`, `ClaudeBot` and `CCBot`; the `*` group still allows every other crawler, including unnamed AI crawlers. This is not a complete AI-training opt-out. | Low/Medium (policy) | `robots.ts:16-47`; built `robots.txt:1-20`; the `*` group allows `/`. | Decide the intended list and document that the switch is partial, or add explicit groups for other named crawlers. |
| R16 | The export has no Google/Bing verification meta tag and no GA4/gtag/Plausible/Umami marker (string scan). The env-gated tags are unset, and the monitoring plan assumes properties and analytics that do not exist. Consent and AI-referral instrumentation were not audited. | Medium (operational) | `layout.tsx:145-154` (tags only when env set); `out/index.html` scan found no verification or analytics markers; §8 assumes accounts. | Create the properties, set the tokens, rebuild; add analytics/consent and name the log source (Cloudflare Logpush vs nginx). |

### 6.5 Artifact spot checks

These were read or parsed in this session from
`C:\Users\sivan\AppData\Local\Temp\niththigal-seo-build\out`.

- **Product structured data is in the initial HTML.** `products/bgl-nila-heritage.html`
  contains an `OnlineStore`, a `WebSite`, a `ProductGroup` and a `BreadcrumbList`. The
  `ProductGroup` has `productGroupID` `4l0oq9zfu30c39o`, `variesBy`
  `https://schema.org/size`, and three `hasVariant` Products with SKUs
  `BGL-NILA-HERITAGE-2.4`, `-2.6`, `-2.8`, each with an `Offer` at 1299.00 INR,
  `InStock`, and `isVariantOf`. The product name is present in the HTML.
- **Single-variant products stay plain Products.** `products/tmp-nck-lakshmi.html` and
  `products/knd-jhu-malar.html` carry `Product` nodes, not groups. The `TMP-` SKU is
  published in the sitemap, feed, `llms.txt` and JSON-LD; finalising it will change the
  URL (R11).
- **Variant selection is client-side.** The canonical is the base product URL
  (`products/[slug]/page.tsx:143`); each JSON-LD variant `Offer.url` and feed link uses
  `?variant=<id>` (`:188-192`, `merchant-feed.xml/route.ts:71-73`). The same static HTML
  is served for every variant; `ProductPurchase` selects the first sellable variant by
  default and reads `?variant=` after hydration (`ProductPurchase.tsx:24-41`). Without
  JavaScript the query is not applied, so the no-JS page shows the default variant. This
  was not tested in a browser.
- **Collections do not carry Product markup.** The audit's `ldjson-collection` passes
  for all three collection pages; each has a `CollectionPage` with an embedded
  `ItemList` and a `BreadcrumbList`.
- **The home page has real content and links.** `index.html` contains the three product
  names, 9 `/products/` href occurrences and 6 `/collections/` href occurrences, and an
  `ItemList`. The AEO block is visible copy, not client-only. Its “prices and stock are
  shown live” claim is inaccurate for product pages (R14).
- **The global graph is on every page.** Each audited HTML document has one `OnlineStore`
  (name, absolute URL, 7-day IN return policy) and one `WebSite`; the Organization node
  has no address, phone, email, `sameAs`, logo, `aggregateRating` or `review`.
- **`/checkout` is `noindex, nofollow`** (`checkout.html`) with an absolute self
  canonical; it is disallowed in robots.txt, absent from the sitemap, and absent from the
  feed and `llms` files.
- **The sitemap has 12 absolute URLs** — home, five editorial/policy pages, three
  collections and three products — with three image URLs, no `/checkout`, and no
  product/collection `lastmod`. The three product image URLs exist locally.
- **The Merchant feed has 5 items** — one per sellable variant (1 + 1 + 3). IDs are
  unique; the bangle variants share `g:item_group_id` and carry `g:size` 2.4/2.6/2.8;
  `google_product_category` values are 194, 196, 191, 191, 191; prices are positive INR;
  no shipping, tax, GTIN or MPN is present.
- **The `llms` files start with an H1** and each has 15 absolute links; both state that
  `llms.txt` is a community convention, not an official standard. `llms.txt:21-23`
  publishes exact stock counts (“11 available”, “6 available”, “8 available”), a
  build-time snapshot (R13).
- **Forbidden-value scan of the current export:** no `aggregateRating`, `ratingValue`,
  `reviewCount`, `"review"`, `priceValidUntil`, `shippingDetails`, `SearchAction`,
  `Google-Extended`, `919876543210` or `Fashion Atelier` in the HTML, `llms`, feed or
  `_next` JS chunks. `data:image` occurs only in the home RSC payload (R1), not in
  JSON-LD; the audit's `ldjson-no-data-urls` passes.
- **The audit's `ldjson-no-forbidden` scan is recursive** and passes; the feed has no
  shipping/tax fields; the return policy is only on `OnlineStore`.

---

## 7. What remains unverified

- **Deployment.** Nothing is live. The verified artifact is a localhost static export
  (`http://localhost:3001`); no production `NEXT_PUBLIC_SITE_URL` was set, and no DNS,
  TLS, CDN, Cloudflare Pages routing or nginx proxy was exercised.
- **Search indexing and ranking.** No search engine was queried; there is no evidence of
  indexing, ranking, impressions, or AI Overviews/AI Mode inclusion. No target keyword
  map or query-to-page mapping exists; the audit checks metadata uniqueness, not query
  fit.
- **Merchant Center approval.** The feed is generated but was not submitted or reviewed.
  Approval and free-listing eligibility remain unknown.
- **Field Core Web Vitals.** No CrUX/RUM or PageSpeed Insights field data was collected.
  Only static build correctness, markup and image-dimension hygiene were checked. Lab
  LCP/CLS and INP/TBT were not measured.
- **Production environment.** DNS, TLS, CDN, Cloudflare Pages extensionless routing,
  nginx proxy rules, and the actual production env values were not exercised. The
  Docker/standalone build was not run; only the static export was. If VPS is the real
  target, the standalone build and its audit are unverified.
- **Analytics, consent and verification properties.** A string scan of `out/index.html`
  found no `google-site-verification`, `msvalidate`, `gtag`, `googletagmanager`,
  `plausible` or `umami` marker; the layout only emits verification tags when the env
  vars are set (`layout.tsx:145-154`). Consent handling and AI-referral instrumentation
  were not audited. No log source (Cloudflare Logpush vs nginx) is configured, so the
  monitoring plan cannot start yet.
- **Page-weight budget.** No bundle or page-weight budget is enforced. The home page is
  416,859 bytes versus ~51–57 KB for other pages; the data-URL duplicate is R1. No lab
  Lighthouse run was made.
- **Legal review.** Privacy, shipping/returns and care copy were not reviewed by counsel;
  the 7-day return policy is represented in schema because it is visible copy, not
  because it was legally validated.
- **CMS freshness after a static build.** The client refresh updates CMS content and the
  home/collection grids after hydration, but **not** product-page price/stock: those are
  server props (`products/[slug]/page.tsx:271-274`, `:292`). Metadata, JSON-LD, sitemap,
  `llms.txt` and the Merchant feed also require a rebuild. A CMS/catalogue change that is
  not followed by a rebuild leaves stale machine-readable data and stale product pages;
  the visible “shown live” copy on the home page (`page.tsx:63-64`, `:143`) overstates
  this.
- **Merchant Center attribute gap.** `age_group`, `gender` and `color` are required for
  Apparel & Accessories free listings and are absent from the catalogue. GTIN/MPN are
  also absent. These omissions may cause item disapproval for those categories.
- **Google-Extended.** Its official documentation was not verified; no robots group is
  emitted. Do not infer its behaviour from memory.
- **`llms.txt` adoption.** It is a proposal; vendors may ignore it. Google does not
  require it.
- **Rich Results Test / validator runs.** No external validator (Rich Results Test,
  Schema Markup Validator, Merchant Center feed debugger) was run. The audit is an
  internal deterministic check, not an external validator.
- **Browser interaction.** `?variant=` preselection, add-to-cart, and the saved-pieces
  action were verified from code and static markup, not in a browser.
- **IndexNow submission.** No real `INDEXNOW_KEY` or HTTPS origin was available; the
  endpoint POST was not executed. Key validation, sitemap reading and exit codes were
  exercised previously; a 200/202 would only confirm receipt, not indexing.
- **Residual UI/payload/ops issues R1–R16.** The data-URL wordmark payload, checkout fee
  and “live pricing” contradiction, `TMP-` SKU/URL, Razorpay placeholders, partial
  AI-training switch, missing analytics/verification tags, stale `.next` cache and
  incomplete working-tree `out` are described in §6.4 and remain open.
- **Ownership and dates.** No person or date is assigned for R1–R16, the launch decisions
  in §1, or the weekly/monthly monitoring. That is unresolved.
- **Rollback.** There is no tested rollback beyond redeploying the previous export;
  reverting commit `4f5003e` would also revert the AI harness and redesign.

---

## 8. Monitoring plan

| Cadence | Action |
| --- | --- |
| Before monitoring starts | Create Google Search Console, Bing Webmaster Tools and Merchant Center properties; set `GOOGLE_SITE_VERIFICATION`/`BING_SITE_VERIFICATION`; rebuild so the tags exist; choose and document the log source (Cloudflare Logpush or nginx access logs). Without this, the monitoring below has no data. |
| Every deploy | Run `npm run build`, then `node scripts/seo-audit.mjs --out out --json` against the artifact being deployed. Require `fail: 0` and inspect `warn: 0`; do not rely on `npm run seo:audit` alone because it defaults to `%TEMP%\niththigal-seo-build\out`. Assert the production origin appears in canonicals and the sitemap; `sitemap-host` only warns for literal localhost. Submit changed URLs with IndexNow if configured. |
| Weekly | Google Search Console: Page indexing, Enhancements, Core Web Vitals. Bing Webmaster Tools: crawl errors and sitemap status. Google Merchant Center: Diagnostics and feed fetch errors. |
| Monthly | Review AI crawler hits in server logs (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot/User, GPTBot/ClaudeBot/CCBot). Check product/collection query impressions and click-through in Search Console. Re-check the feed's missing-attribute warnings. |
| On catalogue or CMS change | Rebuild the static export. Confirm the changed product/collection page, sitemap entry, `llms` entry and feed item all match the new price, stock and copy. |
| On new product or category | Confirm `generateStaticParams` produced the page, the sitemap includes it, the feed includes every sellable variant, and internal links resolve. |
| On SKU rename | Add a host-level redirect. Static export has no redirects, so the old product URL will 404. Treat SKUs as immutable or keep a redirect map. |
| Quarterly | Re-verify the official sources in §9 before changing a rule or a public claim. Re-run the audit on a fresh build and compare the check list. Re-measure the home payload and Core Web Vitals. |
| Ownership | Assign a named owner and date for each residual in §6.4, the launch decisions in §1, and the monitoring rows above. None are assigned in this report. |

Operational notes:

- Use the **Rich Results Test** on a product URL (Product/ProductGroup, Breadcrumb) and
  the home page (Organization). Do not expect an FAQ rich result; Google retired it.
- Use **PageSpeed Insights/CrUX** for LCP, INP and CLS. The code avoids layout shift with
  explicit image dimensions and prioritises the LCP hero; field data is the only real
  measure.
- In **Merchant Center**, set the shipping service and return policy in the account if
  the account requires them. The Organization markup carries the visible 7-day return
  policy but no shipping rate. Address `age_group`, `gender`, `color`, GTIN/MPN only when
  the catalogue supplies real values.
- **AI crawler policy:** the `SEO_BLOCK_AI_TRAINING` switch covers only `GPTBot`,
  `ClaudeBot` and `CCBot`. If the intent is a broader opt-out, name the additional
  crawlers explicitly and re-check their official documentation first.
- **Page weight:** the home page is ~417 KB because of the embedded wordmark (R1). Track
  it as a performance budget, not just a privacy note.

---

## 9. Source index

All sources were verified on **2026-10-27** in `SEO_BRIEF.md` §8. The eight entries marked
† were re-loaded on 2026-10-28 in `seo-research/00-confirmation.md`; the other eleven have
no captured text in the repo and are brief-sourced only. Re-verify before changing a rule
or making a public claim.

| Topic | URL | Verified |
| --- | --- | --- |
| Google Search Essentials | https://developers.google.com/search/docs/essentials | 2026-10-27 |
| Google helpful content / E-E-A-T | https://developers.google.com/search/docs/fundamentals/creating-helpful-content | 2026-10-27 |
| Google AI features (AI Overviews/AI Mode) † | https://developers.google.com/search/docs/appearance/ai-features | 2026-10-27; re-loaded 2026-10-28 |
| Google Product snippets | https://developers.google.com/search/docs/appearance/structured-data/product-snippet | 2026-10-27 |
| Google merchant listings † | https://developers.google.com/search/docs/appearance/structured-data/merchant-listing | 2026-10-27; re-loaded 2026-10-28 |
| Google product variants † | https://developers.google.com/search/docs/appearance/structured-data/product-variants | 2026-10-27; re-loaded 2026-10-28 |
| Google Organization † | https://developers.google.com/search/docs/appearance/structured-data/organization | 2026-10-27; re-loaded 2026-10-28 |
| Google BreadcrumbList | https://developers.google.com/search/docs/appearance/structured-data/breadcrumb | 2026-10-27 |
| Google FAQPage (retired rich result) | https://developers.google.com/search/docs/appearance/structured-data/faqpage | 2026-10-27 |
| Google Merchant product data specification | https://support.google.com/merchants/answer/7052112 | 2026-10-27 |
| Google product taxonomy | https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt | 2026-10-27 |
| OpenAI crawlers † | https://developers.openai.com/api/docs/bots | 2026-10-27; re-loaded 2026-10-28 |
| Anthropic crawlers † | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler | 2026-10-27; re-loaded 2026-10-28 |
| Perplexity crawlers † | https://docs.perplexity.ai/guides/bots | 2026-10-27; re-loaded 2026-10-28 |
| `llms.txt` proposal † | https://llmstxt.org/ | 2026-10-27; re-loaded 2026-10-28 |
| IndexNow | https://www.indexnow.org/documentation | 2026-10-27 |
| Robots Exclusion Protocol | https://www.rfc-editor.org/rfc/rfc9309 | 2026-10-27 |
| Core Web Vitals | https://web.dev/articles/vitals | 2026-10-27 |
| Next.js static exports | https://nextjs.org/docs/app/guides/static-exports | 2026-10-27 |
| Sitemap protocol | https://www.sitemaps.org/protocol.html | 2026-10-27 |
