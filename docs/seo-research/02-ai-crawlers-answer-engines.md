# 02 — AI crawlers and machine-readable guidance

Scope: AI crawler behaviour, robots.txt, llms.txt, answer-engine readiness of the
Niththigal storefront (`storefront/`).
Verified: 2026-10-28 against the official sources listed in §9. Every rule below was
re-read from the vendor page during this audit; nothing is quoted from memory or from
`docs/SEO_BRIEF.md`.
Read-only: no storefront file was edited for this report.

---

## 0. How this was verified

Commands and files used, so any claim can be reproduced:

| Check | How it was run |
| --- | --- |
| robots.txt / llms.txt / sitemap presence | `dir /s /b robots.txt llms*.txt sitemap*.xml` at repo root — no output |
| Build routes | `dir storefront\out` — `index.html`, `checkout.html`, `404.html`, `_not-found.html`, `_next/`, `instagram/`, `niththigal/` |
| App routes | `dir /s /b storefront\src\app` — `globals.css`, `checkout/`, `niththigal.css`, `icon.svg`, `layout.tsx`, `page.tsx`, `niththigal-sections.css` |
| Structured data | PowerShell regex on `storefront/out/index.html` → `application/ld+json` count `0` |
| Canonical / robots meta | Same file → `rel="canonical"` count `0`, `name="robots"` count `0` |
| Headings | `out/index.html` → `<h1` 1, `<h2` 12, `<h3` 9, `<section` 11 |
| FAQ DOM | `out/index.html` → `<details` 5, `<summary` 5 |
| Pre-rendered product data | Text extraction of `out/index.html` → "Loading the collection…", "0 little reasons to shine", "starting at ₹ —" |
| Absolute URLs in build | `out/index.html` → `<meta property="og:image" content="http://localhost:3001/niththigal/hero.webp"/>` |
| IP list endpoints | HTTP HEAD on 7 published list URLs — all `200` |
| Vendor docs | `WebFetch` and `Invoke-WebRequest` against the URLs in §9, 2026-10-28 |

---

## 1. What the storefront actually ships

Verified from the current `storefront/out` build (2026-10-28 15:26):

- Two indexable routes only: `/` and `/checkout`. Both are static `.html` files.
- `robots.txt`: **absent**. No `src/app/robots.ts`, no `public/robots.txt`, and no
  `robots.txt` in `out/`.
- `sitemap.xml`: **absent**. No `src/app/sitemap.ts`.
- `llms.txt`: **absent**.
- JSON-LD: **absent** from the source tree (`findstr /s /i /m "application/ld+json"
  src\*.tsx src\*.ts`) and from `out/index.html`.
- Canonical link: **absent** on both pages.
- `meta robots`: **absent** on both pages, so `/checkout` is currently indexable.
- The page copy and headings **are** in the initial HTML: the root page is a client
  component, but static export pre-renders its first render, so the default CMS copy is
  in `out/index.html`.
- Product data is **not** in the initial HTML. `NtCatalogProvider` starts with
  `products: []` (`storefront/src/components/niththigal/NtCatalogContext.tsx:28`) and
  fills it from a `useEffect` fetch (`:55`). The pre-rendered collection section
  therefore reads "Loading the collection…", "0 little reasons to shine" and
  "starting at ₹ —" (`storefront/src/components/niththigal/Collection.tsx:120`–`:123`,
  `:152`–`:154`).
- CMS copy is **not** in the initial HTML when it differs from the defaults:
  `NiththigalContentProvider` seeds state with `NITHTHIGAL_DEFAULTS`
  (`storefront/src/lib/niththigal-content.tsx:811`) and fetches in `useEffect`
  (`:814`–`:835`).
- Policy text (shipping/returns, privacy, care) exists only inside modals that render
  when opened (`storefront/src/components/niththigal/NtDialogs.tsx:330`–`:335`), and the
  footer triggers are `<button>` elements, not links
  (`storefront/src/components/niththigal/NtFooter.tsx:17`–`:31`). The strings
  "Your bag and saved pieces" and "Delivery usually takes" appear **0** times in
  `out/index.html`.
- Contact facts are empty in the CMS defaults
  (`storefront/src/lib/niththigal-content.tsx:429`–`:433`:
  `whatsappPhone: ""`, `supportEmail: ""`, `instagramUrl: ""`). The footer "location" is
  an emotional line, not a place (`:678`: "Thoughtfully imagined for the women of the
  South.").
- The checkout page hardcodes a placeholder WhatsApp number fallback
  (`storefront/src/app/checkout/page.tsx:103` and `:113`:
  `|| "919876543210"`), and `storefront/.env.local:6` sets
  `NEXT_PUBLIC_WHATSAPP_PHONE=919876543210`.

---

## 2. Official sources, verified 2026-10-28

### 2.1 OpenAI — `OAI-SearchBot`, `GPTBot`, `ChatGPT-User`, `OAI-AdsBot`

Source: <https://developers.openai.com/api/docs/bots> ("Overview of OpenAI Crawlers").

- Independence of controls: *"Each setting is independent of the others - for example, a
  webmaster can allow OAI-SearchBot in order to appear in search results while
  disallowing GPTBot to indicate that crawled content should not be used for training
  OpenAI's generative AI foundation models. If your site has allowed both bots, we may
  use the results from just one crawl for both use cases to avoid duplicative crawling.
  For search results, please note it can take ~24 hours from a site's robots.txt update
  for our systems to adjust."*
- `OAI-SearchBot` — *"used to surface websites in search results in ChatGPT's search
  features."* Allowing it is the documented way to be eligible for ChatGPT search
  answers. IP list: `https://openai.com/searchbot.json`.
- `GPTBot` — *"used to crawl content that may be used in training our generative AI
  foundation models."* *"Disallowing GPTBot indicates a site's content should not be used
  in training generative AI foundation models."* IP list: `https://openai.com/gptbot.json`.
- `ChatGPT-User` — *"used for certain user actions in ChatGPT and Custom GPTs"*.
  *"Because these actions are initiated by a user, robots.txt rules may not apply."* It is
  *"not used for crawling the web in an automatic fashion"* and *"ChatGPT-User is not used
  to determine whether content may appear in Search."* IP list:
  `https://openai.com/chatgpt-user.json`.
- `OAI-AdsBot` — *"used to validate the safety of web pages submitted as ads on ChatGPT.
  When you submit an ad, OpenAI may visit the landing page to ensure it complies with our
  policies. We may also use content from the landing page to determine when it's most
  relevant to show the ad to users. OAI-AdsBot only visits pages submitted as ads, and the
  data collected by OAI-AdsBot is not used to train generative AI foundation models."*
  IP list: `https://openai.com/adsbot.json`. The page states **no** robots.txt behaviour
  for this agent; do not assert one.
- All four IP JSON endpoints returned HTTP `200` on 2026-10-28.

Consequence for this site: a robots.txt that only disallows `GPTBot` still leaves
`OAI-SearchBot` eligible for ChatGPT search, and vice versa. The two decisions are
separate.

### 2.2 Anthropic — `ClaudeBot`, `Claude-User`, `Claude-SearchBot`

Source: <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>

- `ClaudeBot` — collects *"web content that could potentially contribute to their
  training."*
- `Claude-User` — *"supports Claude AI users"*; requests may *"access websites using a
  Claude-User agent."*
- `Claude-SearchBot` — works to *"improve search result quality for users"* and analyses
  content to *"enhance the relevance and accuracy of search responses."*
- robots.txt: Anthropic's bots honour *"industry standard directives in robots.txt"* and
  *"respect 'do not crawl' signals."* Blocking must be repeated *"for every subdomain that
  you wish to opt out from."*
- Non-standard extension: Anthropic supports a *"non-standard Crawl-delay extension to
  robots.txt"*, e.g. `User-agent: ClaudeBot` / `Crawl-delay: 1`.
- CAPTCHAs: it *"will not attempt to bypass CAPTCHAs for the sites we crawl"* and its bots
  *"respect anti-circumvention technologies."*
- IP list: `https://claude.com/crawling/bots.json` (HTTP `200` on 2026-10-28).

### 2.3 Perplexity — `PerplexityBot`, `Perplexity-User`

Source: <https://docs.perplexity.ai/guides/bots>

- `PerplexityBot` — *"designed to surface and link websites in search results on
  Perplexity."* It is *"not used to crawl content for AI foundation models."* The page
  recommends *"allowing `PerplexityBot` in your site's `robots.txt` file"* and
  *"permitting requests from our published IP ranges."* IP list:
  `https://www.perplexity.com/perplexitybot.json`.
- `Perplexity-User` — *"supports user actions within Perplexity."* For user questions it
  *"might visit a web page to help provide an accurate answer and include a link to the
  page in its response."* It is *"not used for web crawling or to collect content for
  training AI foundation models."* Because the fetch is user-requested, *"this fetcher
  generally ignores robots.txt rules."* IP list:
  `https://www.perplexity.com/perplexity-user.json`.
- Both JSON endpoints returned HTTP `200` on 2026-10-28.

Consequence: blocking `Perplexity-User` in robots.txt is not a reliable control, because
the fetcher generally ignores robots.txt. Server-side rules (firewall/WAF) are the only
control if that traffic must be stopped.

### 2.4 Google AI features — no special file, no special schema

Source: <https://developers.google.com/search/docs/appearance/ai-features>
("AI features and your website", last updated 2025-12-10 UTC; fetched with `?hl=en`).

- *"There are no additional requirements to appear in AI Overviews or AI Mode, nor other
  special optimizations necessary."*
- Technical baseline: the page must be indexed, eligible for a snippet, and meet Search's
  technical requirements.
- *"You don't need to create new machine readable files, AI text files, or markup to
  appear in these features. There's also no special schema.org structured data that you
  need to add."*
- *"Making sure your structured data matches the visible text on the page"* is listed
  among the things that are worthwhile.
- The page does **not** mention `llms.txt` (grep for "llms" returned no match). It does
  not endorse any AI-specific file.

Consequence: the absence of `llms.txt` is not a Google defect and must never be reported
as a ranking or AI-visibility requirement. `llms.txt` is an optional convention (§2.7).

### 2.5 Google-Extended — current official documentation found

Source: <https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers>
(section `#google-extended`, page last updated 2026-10-15 UTC).

This resolves the open item in `docs/SEO_BRIEF.md` §4.4 (which recorded a 404 and no
verified behaviour). The current page says:

- *"Google-Extended doesn't have a separate HTTP request user agent string. Crawling is
  done with existing Google user agent strings; the robots.txt user-agent token is used
  in a control capacity."*
- *"Google-Extended is a standalone product token that web publishers can use to manage
  whether content Google crawls from their sites may be used for training future
  generations of Gemini models that power Gemini Apps and Vertex AI API for Gemini and
  for grounding (providing content from the Google Search index to the model at prompt
  time to improve factuality and relevancy) in Gemini Apps and Grounding with Google
  Search on Vertex AI."*
- *"Google-Extended does not impact a site's inclusion in Google Search nor is it used as
  a ranking signal in Google Search."*

Consequence: `Google-Extended` is **not** a crawler user-agent. It is a robots.txt control
token that governs training/grounding use of content Google already crawls. Allowing or
disallowing it does not change Search inclusion.

### 2.6 RFC 9309 and the Sitemap extension

Source: <https://www.rfc-editor.org/rfc/rfc9309> (fetched as `.txt` and `.html`).

- §2.3 Access Method: rules must be at `"/robots.txt"` (*all lowercase*), at the top-level
  path, UTF-8, `text/plain`.
- §2.2.1 The User-Agent Line: crawlers match the product token case-insensitively;
  multiple matching groups *"MUST be combined into one group"*; if no group matches, the
  `*` group applies; *"If no group matches the product token and there is no group with a
  user-agent line with the "*" value, or no groups are present at all, no rules apply."*
- §2.2.2 Allow/Disallow: matching starts at the first octet; *"The most specific match
  found MUST be used. The most specific match is the match that has the most octets."*
  An `allow` rule wins over an equivalent `disallow`; with no matching rule the URI is
  allowed; `/robots.txt` is implicitly allowed.
- §2.2.3 Special characters: `#` comment, `$` end-of-match, `*` *"0 or more instances of
  any character."*
- §2.2.4 Other Records: *"Crawlers MAY interpret other records that are not part of the
  robots.txt protocol -- for example, "Sitemaps" [SITEMAPS]."* and *"Parsing of other
  records MUST NOT interfere with the parsing of explicitly defined records in Section
  2. For example, a "Sitemaps" record MUST NOT terminate a group."*
- §2.4 Caching: a cached copy *"SHOULD NOT"* be used for more than 24 hours unless the
  file is unreachable.
- §2.5/§3 Limits: the parsing limit *"MUST be at least 500 kibibytes [KiB]."*

Sitemap is **not** defined by RFC 9309; it is an "other record". The protocol itself is
defined at <https://www.sitemaps.org/protocol.html>, which shows the directive in use:
*"the robots.txt file at http://www.host1.com/robots.txt would contain the line
"Sitemap: http://www.sitemaphost.com/sitemap-host1.xml""*. The page also states that all
URLs in a Sitemap must be from a single host.

Consequence: a `Sitemap:` line in robots.txt is a widely supported extension, not part of
the RFC, and RFC 9309 requires it not to break normal group parsing.

### 2.7 llms.txt — proposal status, format, limitations

Source: <https://llmstxt.org/> ("The /llms.txt file, v2"; author Jeremy Howard; published
2024-09-03; modified 2026-08-10).

Status — a proposal, not a standard:

- *"A proposal to standardise on using an /llms.txt file to provide information to help
  agents use a website."*
- *"The llms.txt specification is open for community input. A GitHub repository hosts this
  informal overview, allowing for version control and public discussion."*
- It is not referenced by Google's AI features page (§2.4) and is not an official standard
  of any search engine vendor.

Format (in this order):

1. Optional byte-order mark.
2. *"An H1 with the name of the project or site. This is the only required section."*
3. *"A blockquote with a short summary of the project, containing key information
   necessary for understanding the rest of the file."*
4. *"Zero or more markdown sections (e.g. paragraphs, lists, etc) of any type except
   headings"* — extra detail, no headings.
5. *"Zero or more markdown sections delimited by H2 headers, containing "file lists" of
   URLs where further detail is available."*
   Each list item: *"a required markdown hyperlink [name](url), then optionally a : and
   notes about the file."*
6. *"The "Optional" section is used, by convention, for secondary information: links an
   agent can skip when a shorter context is needed."*

Location: *"at the root path /llms.txt of a website or at any subpath (e.g. /docs/llms.txt).
A file covers the URLs under its path, and where more than one file applies, agents should
use the most specific one."*

Purpose and stated expectation: *"llms.txt offers a curated overview for LLMs"*, it
*"can complement robots.txt by providing context for allowed content"*, and *"Our
expectation was that llms.txt would mainly be useful for inference rather than training,
and that is how it has been used, though training runs could take advantage of the
information too."*

Consequence: `llms.txt` is a useful, low-risk convention for agents that read it, and
must be described as a community proposal. It is not a Google requirement, not a ranking
signal, and it does not replace a sitemap or robots.txt.

---

## 3. Requirements extracted from those sources

| ID | Requirement | Source |
| --- | --- | --- |
| `openai-searchbot-allow` | To be eligible in ChatGPT search answers, the site must allow `OAI-SearchBot` in robots.txt; disallowing it removes the site from those answers. | https://developers.openai.com/api/docs/bots |
| `openai-gptbot-separate` | Training use is controlled separately by `GPTBot`; one group does not imply the other. Robots changes can take ~24 hours to affect search. | https://developers.openai.com/api/docs/bots |
| `openai-chatgpt-user` | `ChatGPT-User` is user-triggered; robots.txt rules may not apply, and it does not decide Search inclusion. | https://developers.openai.com/api/docs/bots |
| `openai-adsbot` | `OAI-AdsBot` visits only pages submitted as ads and its data is not used for training; no robots behaviour is documented. | https://developers.openai.com/api/docs/bots |
| `openai-ip-lists` | Each OpenAI agent publishes IP ranges as JSON at a per-agent URL. | https://developers.openai.com/api/docs/bots |
| `anthropic-bots` | `ClaudeBot` (training), `Claude-User` (user requests) and `Claude-SearchBot` (search relevance) honour robots.txt, support `Crawl-delay`, and publish IPs at `claude.com/crawling/bots.json`. | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler |
| `perplexity-bots` | `PerplexityBot` drives Perplexity search results and should be allowed; `Perplexity-User` serves user questions, is not a training crawler, and generally ignores robots.txt. | https://docs.perplexity.ai/guides/bots |
| `google-ai-no-special-file` | No extra requirements, machine-readable files, AI text files, markup or special schema.org data are needed for AI Overviews or AI Mode; structured data must match visible text. | https://developers.google.com/search/docs/appearance/ai-features |
| `google-extended-token` | `Google-Extended` is a robots.txt product token with no separate HTTP user agent; it controls training/grounding use of Gemini, not Search inclusion or ranking. | https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers |
| `robots-rfc-basics` | robots.txt must be at `/robots.txt`, UTF-8, text/plain; groups match case-insensitively; the most specific (most octets) rule wins; `*`, `$`, `#` are supported; absent groups mean no rules apply. | https://www.rfc-editor.org/rfc/rfc9309 |
| `robots-other-records` | `Sitemap` is not defined by RFC 9309; crawlers MAY interpret it and it must not terminate a group. | https://www.rfc-editor.org/rfc/rfc9309 |
| `sitemap-directive` | A Sitemap may be advertised with a `Sitemap: <absolute-url>` line in robots.txt; all URLs must be on one host. | https://www.sitemaps.org/protocol.html |
| `llms-txt-format` | An llms.txt has a required H1, a blockquote summary, optional non-heading detail, and H2 file lists whose items are `[name](url)` plus optional `: notes`; root or any subpath, most specific file applies. | https://llmstxt.org/ |
| `llms-txt-not-standard` | llms.txt is a proposal and an "informal overview", open for community input; it must not be described as an official standard or a Google requirement. | https://llmstxt.org/ |

---

## 4. Findings

Severity reflects impact on how an AI answer engine can understand and cite this site,
not how hard the fix is.

### F1 — No robots.txt at all, so no AI crawler policy exists
- **Where:** `storefront/out/` (no `robots.txt`), `storefront/src/app/` (no `robots.ts`)
- **Problem:** Every crawler, including training crawlers, is allowed by default, and
  there is no place to declare a search-vs-training policy or point at a sitemap.
- **Evidence:** `dir /s /b robots.txt llms*.txt sitemap*.xml` at the repo root returned
  nothing; `dir storefront\out` lists no `robots.txt`; `dir /s /b storefront\src\app`
  lists no `robots.ts`. RFC 9309 §2.2.1: *"If no group matches the product token and
  there is no group with a user-agent line with the "*" value, or no groups are present
  at all, no rules apply."*
- **Severity:** high
- **Recommendation:** add a real `robots.txt` at the deployment root with explicit
  groups. Allow the search/index agents (`OAI-SearchBot`, `PerplexityBot`,
  `Claude-SearchBot`) if ChatGPT/Perplexity/Claude search visibility is wanted. Treat
  `GPTBot`, `ClaudeBot` and `Google-Extended` as a business policy choice and document
  the choice; the sources in §2.1, §2.2 and §2.5 describe the exact consequences. Verify
  the deployed file over HTTP after release — a static export only contains it if it is
  in `public/` or generated by `app/robots.ts`.

### F2 — No sitemap and no `Sitemap:` line
- **Where:** `storefront/out/` (no `sitemap.xml`), `storefront/src/app/` (no `sitemap.ts`)
- **Problem:** Crawlers have no machine-readable list of the only two routes, and there is
  no `Sitemap:` record to advertise one.
- **Evidence:** same directory search as F1. Build contains only `index.html`,
  `checkout.html`, `404.html`, `_not-found.html` (plus assets).
- **Severity:** medium
- **Recommendation:** generate a static sitemap containing the indexable URL(s) only —
  exclude `/checkout` (F3) — with absolute URLs derived from `NEXT_PUBLIC_SITE_URL`, and
  add `Sitemap: <absolute-url>` to robots.txt (sitemaps.org syntax, §2.6).

### F3 — `/checkout` is indexable
- **Where:** `storefront/out/checkout.html`, `storefront/src/app/checkout/page.tsx`
- **Problem:** The transactional page has no `noindex` and no robots meta, so it can be
  indexed and quoted as if it were a content page; its pre-rendered state is the empty
  cart.
- **Evidence:** regex on `out/checkout.html`: `noindex` → 0, `name="robots"` → 0.
  The pre-rendered text begins with "Your Shopping Bag is Empty" and contains no product
  or policy content.
- **Severity:** medium
- **Recommendation:** set `noindex, nofollow` for `/checkout`. A `"use client"` page
  cannot export `metadata`, so this needs a small server `layout.tsx` under
  `src/app/checkout/` exporting `metadata.robots`, or an equivalent static meta tag.

### F4 — Product data exists only after a client-side fetch
- **Where:** `storefront/src/components/niththigal/NtCatalogContext.tsx:28`,
  `storefront/src/components/niththigal/Collection.tsx:120`
- **Problem:** Names, categories, prices, variants and availability of the catalog are
  absent from the initial HTML. A crawler that does not run the catalog fetch sees a
  loading state and an empty grid; any AI answer about specific pieces or prices cannot
  be grounded in this page.
- **Evidence:** `const [products, setProducts] = useState<StorefrontProduct[]>([]);`
  (`NtCatalogContext.tsx:28`) filled by `void refresh()` inside `useEffect` (`:55`);
  the pre-rendered HTML contains "Loading the collection…", "All pieces 00",
  "0 little reasons to shine" and "starting at ₹ —" (text extraction of
  `out/index.html`).
- **Severity:** high
- **Recommendation:** render the catalog for the initial HTML. With `output: "export"`,
  fetch the catalog in a server component at build time (or in a route handler marked
  `dynamic = "force-static"`) and pass it into the client provider as `initialProducts`.
  Do not rely on client-injected Product markup.

### F5 — CMS copy is only applied after hydration
- **Where:** `storefront/src/lib/niththigal-content.tsx:811`, `:814`–`:835`
- **Problem:** The HTML always contains the compiled defaults. Any CMS edit to the
  brand's description, FAQ, policies or contact facts is invisible to a crawler that does
  not execute the content fetch, and the HTML can disagree with what users see.
- **Evidence:** state initialised to `NITHTHIGAL_DEFAULTS` (`:811`), replaced in
  `useEffect` from `getStorefrontApiUrl("/api/storefront/content")` (`:818`).
- **Severity:** medium
- **Recommendation:** pre-render the CMS block at build time (static export runs at build
  time, so the content route can be fetched then), or guarantee that every fact an AI
  engine may quote — entity description, FAQ, policies, contact — is also present in the
  static defaults and kept in sync.

### F6 — No machine-readable entity identity
- **Where:** `storefront/src/app/layout.tsx:42`–`:61`
- **Problem:** There is no JSON-LD, no canonical URL and no `og:url`. The brand is named
  in visible copy but never declared as an entity, so an answer engine has to infer the
  organisation, its market and its canonical URL from prose alone.
- **Evidence:** `out/index.html` regex counts: `application/ld+json` → 0, `rel="canonical"`
  → 0, `og:url` → 0. `metadata` in `layout.tsx` declares only title, description and
  Open Graph title/description/image.
- **Severity:** high
- **Recommendation:** add one `Organization` (or specific subtype) JSON-LD block in the
  static HTML, containing only supportable facts: `name` ("Niththigal"), `url`, `logo`
  only when a crawlable URL exists, `description`, and `sameAs` only when a profile URL
  exists. Add `alternates.canonical` and `openGraph.url`, both derived from
  `NEXT_PUBLIC_SITE_URL`. Omit `address`, `telephone`, `email`, `contactPoint` until the
  facts exist (F10) — do not invent them.

### F7 — The built page advertises `localhost` as an absolute URL
- **Where:** `storefront/src/app/layout.tsx:37`–`:40`, `storefront/out/index.html`
- **Problem:** Without `NEXT_PUBLIC_SITE_URL`, the metadata base falls back to
  `http://localhost:3001`, and that is what ships in the image metadata. Any consumer that
  resolves the image or copies the URL gets a local address.
- **Evidence:** `out/index.html` contains
  `<meta property="og:image" content="http://localhost:3001/niththigal/hero.webp"/>`
  and the same value for `twitter:image`; `storefront/.env.local` has no
  `NEXT_PUBLIC_SITE_URL`. `storefront/.env.example` documents
  `NEXT_PUBLIC_SITE_URL=http://localhost:3001`.
- **Severity:** high
- **Recommendation:** set `NEXT_PUBLIC_SITE_URL` for every production build, fail the
  build (or at least warn loudly) when it is missing in a non-local build, and add the
  canonical/`og:url` from F6 so the entity URL is explicit rather than inferred from an
  image path.

### F8 — The first screen does not answer "what is this and where does it sell"
- **Where:** `storefront/src/components/niththigal/sections.tsx:117`–`:122`,
  `storefront/src/lib/niththigal-content.tsx:434`–`:462`
- **Problem:** The H1 is a slogan ("A little tradition. A lot of you.") and the hero copy
  is poetic. The plainest statement of what the business is sits in an FAQ answer and a
  footer legal note. An answer engine lifting the first screen gets mood, not a fact it
  can state.
- **Evidence:** H1 text extracted from `out/index.html`: "A little tradition. A lot of
  you."; the only definitional sentence is in the FAQ default
  (`niththigal-content.tsx:642`: "Niththigal is an imitation jewellery concept, with
  gold-tone, heritage-inspired designs — not solid gold.").
- **Severity:** medium
- **Recommendation:** add one short, factual lead sentence near the top (brand + category
  + market + price positioning + shipping), using only facts already on the site — e.g.
  South Indian-inspired imitation jewellery, pan-India shipping, prices in INR with taxes
  included. Keep the existing poetic H1 if design requires it; put the plain statement in
  the hero description that already exists.

### F9 — Shipping, returns, privacy and care have no crawlable page
- **Where:** `storefront/src/components/niththigal/NtDialogs.tsx:304`–`:364`,
  `storefront/src/components/niththigal/NtFooter.tsx:17`–`:31`
- **Problem:** The only full policy text lives in modals opened by buttons. There is no
  URL for shipping/returns, privacy or care, so an AI engine cannot cite a policy page,
  and the text is not in the initial HTML.
- **Evidence:** `InfoDialog` renders only when `infoKey` is set
  (`NtDialogs.tsx:330`–`:335`); footer triggers are `<button onClick={openInfo(...)}>`
  (`NtFooter.tsx:19`–`:31`); "Delivery usually takes" and "Your bag and saved pieces"
  appear 0 times in `out/index.html`.
- **Severity:** medium
- **Recommendation:** publish real routes (`/shipping-returns`, `/privacy`, `/jewellery-care`)
  with headings and the existing copy, link them from the footer, and include them in the
  sitemap. Static export supports additional static routes. Until then, mirror the policy
  text into the HTML of the home page rather than only into a modal.

### F10 — No usable contact facts, and a placeholder phone number in code
- **Where:** `storefront/src/lib/niththigal-content.tsx:429`–`:433`,
  `storefront/src/app/checkout/page.tsx:103`, `storefront/.env.local:6`
- **Problem:** The site never states how to reach a human. The CMS contact fields are
  empty, so the policy dialogs fall back to a non-link CTA, and the checkout uses a
  hardcoded sample Indian number as a fallback.
- **Evidence:** defaults are `whatsappPhone: ""`, `supportEmail: ""`,
  `instagramUrl: ""` (`niththigal-content.tsx:429`–`:433`); the info dialog builds its CTA
  only from those two fields (`NtDialogs.tsx:309`–`:317`); checkout falls back to
  `|| "919876543210"` (`checkout/page.tsx:103`, `:113`); `.env.local:6` sets the same
  sample number.
- **Severity:** high
- **Recommendation:** enter the real support channel in the CMS (or in the static
  defaults) so it appears in the HTML, remove the hardcoded number fallback or make a
  missing number a visible configuration error, and expose one support path as visible
  text. Do not add `contactPoint`, `telephone` or `email` markup until a real value
  exists.

### F11 — A claim an AI crawler can quote that the checkout cannot support
- **Where:** `storefront/src/lib/niththigal-content.tsx:621`,
  `storefront/src/app/checkout/page.tsx`
- **Problem:** The pricing section promises *"a handwritten note option at checkout"*,
  but the checkout has no gift-note field. This is exactly the kind of concrete promise an
  answer engine will repeat.
- **Evidence:** the string is in the default pricing item ("Gift-ready, always … with a
  handwritten note option at checkout"); `findstr /i /c:"handwritten"
  src\app\checkout\page.tsx` returns nothing, and `findstr /i /c:"handwritten"
  out\checkout.html` returns nothing. The checkout form collects name, phone, email,
  address, pincode, city, state, GSTIN/billing, coupon, payment method and marketing
  consent only.
- **Severity:** medium
- **Recommendation:** either add the gift-note field to checkout, or change the copy to
  what checkout actually offers. Do not leave a specific fulfilment promise that the
  transactional flow contradicts.

### F12 — Absolute material claims appear only on the client-rendered checkout
- **Where:** `storefront/src/app/checkout/page.tsx:1002`, `:1006`
- **Problem:** The checkout asserts "100% Skin-Friendly Lead & Nickel Free Alloy" and
  "Premium 22K Micro Gold Plating with Anti-Tarnish Coat". No other visible copy makes the
  "100%" guarantee, and plating is catalog-dependent (`PLATING_LABELS` in
  `NtDialogs.tsx:21`–`:28` includes several finishes). A summariser can lift an absolute
  safety claim the product data may not support for every piece.
- **Evidence:** `checkout/page.tsx:1002` and `:1006`; the FAQ instead says "crafted on
  skin-friendly alloys with multi-layer micro gold plating"
  (`niththigal-content.tsx:642`).
- **Severity:** medium
- **Recommendation:** make the claim match verified sourcing for all pieces, or soften it
  to what is uniformly true. Do not publish `material` or `additionalProperty` schema
  from an unverified absolute claim.

### F13 — Testimonial styling can be read as a rating
- **Where:** `storefront/src/lib/niththigal-content.tsx:547`–`:549`,
  `storefront/src/components/niththigal/sections.tsx:340`–`:343`
- **Problem:** The section shows five star glyphs (`✦ ✦ ✦ ✦ ✦`) above quote cards, with
  the qualifier "Illustrative community stories" only as a small note. A summariser can
  quote the stars as a customer rating.
- **Evidence:** `stars: "✦ ✦ ✦ ✦ ✦"` and `note: "Illustrative community stories"`
  (`niththigal-content.tsx:547`, `:549`); rendered as `love-stars` with
  `aria-hidden` plus the note (`sections.tsx:340`–`:343`).
- **Severity:** low
- **Recommendation:** keep the illustrative label adjacent to the quotes (it is), drop or
  de-emphasise the star row, and never add `review` or `aggregateRating` markup for these
  stories.

### F14 — Heading structure is sound, with one footer skip
- **Where:** `storefront/src/components/niththigal/NtFooter.tsx:147`,
  `storefront/out/index.html`
- **Problem:** The page uses one H1, and most section H2s are bound with
  `aria-labelledby`; H3s sit inside sections. The footer uses `<h3>` for column titles
  with no H2 in the footer region, which is a small hierarchy skip for outline-based
  extraction.
- **Evidence:** `out/index.html`: `<h1` 1, `<h2` 12, `<h3` 9, `<section` 11; footer
  contains 2 `<h3>` and no `<h2>`.
- **Severity:** low
- **Recommendation:** leave the main outline as it is; either give the footer a visually
  hidden H2 ("Site footer") or use non-heading markup for footer column labels.

### F15 — No `llms.txt` (optional convention, not a requirement)
- **Where:** `storefront/public/` (only `instagram/` and `niththigal/`),
  `storefront/out/` (no `llms.txt`)
- **Problem:** Agents that look for `llms.txt` find nothing, so the site cannot give them
  a curated overview and canonical links in one file.
- **Evidence:** repo-wide `dir /s /b llms*.txt` returned nothing; `public/` listing has
  only two asset directories.
- **Severity:** low
- **Recommendation:** add `public/llms.txt` following §2.7 (H1 "Niththigal", blockquote
  summary, one file list of real URLs). Only list URLs that exist. Do not describe it as
  an official standard, and do not present it as a Google requirement (§2.4).

### F16 — No non-JavaScript fallback
- **Where:** `storefront/src/app/layout.tsx:68`–`:114`
- **Problem:** There is no `<noscript>` summary. Content that hydrates from the catalog or
  CMS fetch simply does not exist for a non-executing fetcher.
- **Evidence:** `out/index.html` contains 0 `<noscript>` elements.
- **Severity:** low
- **Recommendation:** optional once F4/F5/F9 are fixed; a short `<noscript>` paragraph
  naming the brand, category and how to reach support would be enough.

---

## 5. Claims that could be quoted, and whether the page supports them

| Claim visible on the site | Where it appears | Supported? |
| --- | --- | --- |
| "South Indian-inspired imitation jewellery" | meta description, hero paragraph, story, FAQ | Yes — repeated in visible copy |
| "Pan-India insured express shipping" | meta description, benefits/pricing copy | Yes — visible copy, and checkout computes dispatch |
| "7-day easy return promise" | pricing section, pricing foot note | Yes — visible copy; details are only in a modal (F9) |
| "Prices include taxes" | cart note, pricing anchor note, footer legal note | Yes |
| "Dispatched within 24–48 hours" | pricing item, FAQ answer | Yes |
| "Delivery estimates appear at checkout once you enter your pincode" | FAQ answer | Yes — checkout calls the pincode serviceability check |
| "Prices and stock are live from our studio" | FAQ answer | Yes — catalog is fetched live, but not in HTML (F4) |
| "handwritten note option at checkout" | pricing item | **No** — checkout has no note field (F11) |
| "100% Skin-Friendly Lead & Nickel Free Alloy" | checkout only | **Not verifiable from the site** — absolute claim, appears nowhere else (F12) |
| "Premium 22K Micro Gold Plating with Anti-Tarnish Coat" | checkout only | **Partly** — plating is per-product data; not uniform copy (F12) |
| Five-star glyph row over testimonials | testimonials section | **No** — labelled illustrative stories, not reviews (F13) |
| "Pieces from ₹—" | pre-rendered collection/pricing | **No** — placeholder in HTML before hydration (F4) |

---

## 6. What is already correct

- Content is in the initial HTML for everything that is static: hero, story, benefits,
  pricing, FAQ, testimonials, footer. The static export pre-renders the client page's
  first render.
- The FAQ is real, visible, semantic content: 5 `<details>`/`<summary>` pairs with the
  first open, all five answers present in `out/index.html`. This is the strongest asset
  for answer engines, because the questions are the ones customers actually ask
  ("Is this real gold jewellery?", "How do I choose a bangle size?").
- Headings and landmarks are largely semantic: one H1, most section H2s with
  `aria-labelledby`, one `<nav aria-label="Main navigation">` in the pre-rendered HTML, a
  skip link, and the page declares `lang="en"` (`layout.tsx:69`).
- The entity name is consistent: "Niththigal" appears 20 times in `out/index.html`, and
  the brand block ("Jewellery, with soul") repeats in header and footer.
- There is no fabricated rating, review, address, GTIN or `SearchAction` markup anywhere.
- Structured data is absent rather than wrong; that is a gap to fill with true facts, not
  a correctness bug.

---

## 7. Conflicts, dead ends and unverified items

1. **Resolved — brief §4.4 (`Google-Extended` not verified).** The brief recorded a 404.
   The current documentation exists at
   <https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers>
   (last updated 2026-10-15 UTC) and is quoted in §2.5. Behaviour is now verified; the
   brief's caution was correct and can be replaced.
2. **Discrepancy — brief §1 says the layout has "no Twitter card".** The source
   `layout.tsx` indeed declares no `twitter` block, but `out/index.html` does contain
   `twitter:card=summary_large_image`, `twitter:title`, `twitter:description` and
   `twitter:image`. Next.js derives these from `openGraph` + `images`. The brief describes
   the source accurately; it should not be read as a statement about the built artifact.
3. **Not verified this session — "Product structured data must be in the initial HTML"**
   is a rule in the task brief and `docs/SEO_BRIEF.md` §2.3, attributed to Google's
   product-snippet guidance. I did not fetch that Google page during this audit, so this
   report treats it as a project rule, not as a source-verified requirement. F4 is written
   to be defensible either way: product facts are absent from the HTML, and Google's AI
   features page (verified) does say important content should be available in textual
   form and structured data must match visible text.
4. **Not documented — `OAI-AdsBot` robots.txt handling.** The OpenAI page describes what
   the bot does and publishes its IP list, but states nothing about robots.txt for it.
   This report does not assert any robots behaviour for `OAI-AdsBot`.
5. **Not verifiable from here — deployment-time file presence.** Whether a generated
   `robots.txt`/`llms.txt` actually reaches the live origin depends on the host and the
   build pipeline. I could only verify that neither file exists in the repository or in
   the current `out/` export. The check must be repeated against the deployed URL.
6. **Not re-verified — Google FAQPage retirement.** The task brief states Google retired
   the FAQ rich result in 2026 and forbids claiming it. I did not re-fetch that page in
   this session. This report makes no FAQ rich-result claim at all, which is the safe
   reading either way.
7. **Localized page returned on first fetch.** Google's AI features page initially
   returned Japanese (`?hl` auto-detection). The English text quoted in §2.4 was fetched
   again with `?hl=en`; the statements match across both.
8. **`Next.js` static-export support for metadata routes** is not re-verified here; the
   brief cites it. If `app/robots.ts` cannot be emitted in this configuration, a plain
   `public/robots.txt` is equivalent and is a static file the export copies.

---

## 8. Reference shapes (illustrative — no invented values)

These are outlines only. Every URL must come from `NEXT_PUBLIC_SITE_URL`; every listed
fact must already exist in visible content.

`robots.txt` (root):

```text
# Search and answer-engine crawlers the site wants to be eligible for.
User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

# Training / grounding controls: a business decision, not a ranking lever.
# Allowing these is the current default (no robots.txt at all); state the choice.
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: *
Allow: /
Disallow: /checkout

Sitemap: ${NEXT_PUBLIC_SITE_URL}/sitemap.xml
```

`llms.txt` (root) — structure only:

```markdown
# Niththigal

> <one-sentence summary using only copy already on the site>

<optional short paragraph of detail, no headings>

## Pages

- [Home](${NEXT_PUBLIC_SITE_URL}/): <what the page contains>
- [Shipping and returns](${NEXT_PUBLIC_SITE_URL}/shipping-returns): <only if the route exists>

## Optional

- [Jewellery care](${NEXT_PUBLIC_SITE_URL}/jewellery-care): <only if the route exists>
```

Do not list `/checkout` in `llms.txt`; it is transactional and should be `noindex` (F3).
Do not list policy routes before they exist (F9) — a dead link in `llms.txt` is worse than
an absent file.

---

## 9. Sources fetched 2026-10-28

| Topic | URL | Note |
| --- | --- | --- |
| OpenAI crawlers | https://developers.openai.com/api/docs/bots | OAI-SearchBot, GPTBot, ChatGPT-User, OAI-AdsBot; independence; ~24 h |
| OpenAI IP list | https://openai.com/searchbot.json | HTTP 200 |
| OpenAI IP list | https://openai.com/gptbot.json | HTTP 200 |
| OpenAI IP list | https://openai.com/chatgpt-user.json | HTTP 200 |
| OpenAI IP list | https://openai.com/adsbot.json | HTTP 200 |
| Anthropic crawlers | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler | ClaudeBot, Claude-User, Claude-SearchBot; Crawl-delay; no CAPTCHA bypass |
| Anthropic IP list | https://claude.com/crawling/bots.json | HTTP 200 |
| Perplexity crawlers | https://docs.perplexity.ai/guides/bots | PerplexityBot; Perplexity-User ignores robots.txt |
| Perplexity IP list | https://www.perplexity.com/perplexitybot.json | HTTP 200 |
| Perplexity IP list | https://www.perplexity.com/perplexity-user.json | HTTP 200 |
| Google AI features | https://developers.google.com/search/docs/appearance/ai-features | No special files/schema; last updated 2025-12-10 UTC |
| Google-Extended | https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers | Product token, not a UA; last updated 2026-10-15 UTC |
| Robots Exclusion Protocol | https://www.rfc-editor.org/rfc/rfc9309 | §2.2.1–2.2.4, §2.3, §2.4, §2.5 |
| Sitemap protocol | https://www.sitemaps.org/protocol.html | `Sitemap:` line in robots.txt; single host |
| llms.txt proposal | https://llmstxt.org/ | v2, modified 2026-08-10; format, location, status |
