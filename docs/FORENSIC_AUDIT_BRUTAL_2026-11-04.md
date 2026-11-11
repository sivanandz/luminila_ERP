# BRUTAL FORENSIC AUDIT — Luminila Inventory Management
**Auditor role:** Antagonistic / app forensic auditor
**Repo:** `E:\Local_GIT_2\luminila_inv_mgmt`
**Date:** 2026-11-04
**Scope:** 392 src files, 132,597 lines, 47 page routes, 25 API handlers, 175 lib files, 103 components
**Verdict:** **FAIL**. This is not an enterprise ERP, it's a 3-process Franken-app held together by string templates, committed databases, bare `eval()` calls, and a security proxy that is OFF by default.

> This file is the canonical copy of the forensic audit. An earlier draft was written to `FORENSIC_AUDIT_2026-11-04_BRUTAL.md` at the repo root; this `docs/` copy supersedes it and includes operator answers and the rate-limit remediation decision.

---

## 0. EXECUTIVE SUMMARY — THE BAD NEWS IN 30 SECONDS

| # | Verdict | Evidence |
|---|---|---|
| 1 | **Production DB committed to git** | `pocketbase/pb_data_backup_20261102/data.db` + `-shm` + `-wal` are TRACKED (`git ls-files`) while `pb_data/*` is gitignored. `.gitignore:64` misses the backup dir name. Clone = steal customers/GSTIN/costs/WhatsApp. |
| 2 | **Superuser secrets on disk by design** | `.env.local` holds `POCKETBASE_SUPERUSER_PASSWORD`, `TENANT_REGISTRY_KEY`, `CUSTOMER_SESSION_SECRET`. `scripts/dev-all.js` auto-upserts superuser and logs the email. `scratch/initial_schema.js` (252KB) + `mkuser.mjs` ship creation patterns. |
| 3 | **Zero CSP / zero HSTS / zero headers** | `next.config.ts:1-24` = `reactCompiler:true` + `images.unoptimized` + `output:standalone`. No `headers()`. `proxy.ts` sets 3 headers only when guard enabled. |
| 4 | **`eval("require")` + `Function(import)` in prod code** | `src/lib/pocketbase.ts:148`, `src/lib/mobile-scanner.ts:152`. CSP would need `unsafe-eval`. Analyzer blind. |
| 5 | **Host guard OFF by default** | `proxy.ts:24-26` `if(!config.enabled) return NextResponse.next()`. No `ADMIN_HOSTS` env = no protection. Docs claim "private ERP". |
| 6 | **God pages** | `whatsapp/page.tsx` 5,362 lines, `storefront-control/page.tsx` 3,489, `pos/page.tsx` 2,658, `inventory/page.tsx` 2,166. No code-split. |
| 7 | **Print XSS fleet** | 5 files dump `innerHTML` into bare windows (POS, invoices, shipping, reports). Stored XSS via product/customer names + logo upload -> steals `localStorage` JWT. |
| 8 | **Open storefront API with CORS `*`** | `storefront/catalog/route.ts` `Access-Control-Allow-Origin:"*"` exposes `cost_price`, `total_stock`, internal IDs. Tenant enumeration via `account_email` header. |
| 9 | **Rate limit theatre** | `rate-limit.ts` in-memory, `MAX_WINDOWS=10000`, only `tracking/st-courier` uses it. Storefront `Map`-based limits bypassed by spoofing `x-forwarded-for` (last hop trusted). Restart clears. |
| 10 | **Dead deps + folder sprawl** | `@openuidev/*` 0 imports, `jszip` 0 imports, `@tauri-apps/api` 0 direct imports. `scratch/vyaparapp.exe` 95MB, `eslint_out.txt` 4.2MB, `src-tauri` 32k files, `wppconnect-sidecar` 11k files, `server-dist` 2,955 files. |
| 11 | **PB port roulette** | `DEFAULT_URL 8090`, tenant manager prefers `8091`, candidates `[8091,8090]` / `[8091,8090,8092]`. Browser guesses `hostname:8090`. Prod HTTPS breaks. |
| 12 | **337 `console.log` live** | POS + sales + rate-limit still logging PII paths. Only `console.warn` in rate-limit. No redaction. |

**Bottom line:** Every prior audit flagged host-guard, `account_email` tenancy, XFF spoofing, ECB crypto, token refresh — and the code *still* ships with the three above mechanisms in their broken forms. This is security-notification fatigue weaponized into architecture.

---

## 1. OPERATOR GRILL-ME — ANSWERS (recorded 2026-11-04)

The operator was asked the 12 grill-me questions with multiple-choice options. Answers given:

| # | Question | Operator answer | Auditor interpretation |
|---|---|---|---|
| 1a | Who cloned repo with `data.db`? | **Nobody tracked** | Untouched leak — no clone list, no audit trail. |
| 1b/c | Backup dir bypasses `.gitignore`? | *not separately answered* | Filename choice (`pb_data_backup_*`) evades `pocketbase/pb_data/*` rule. |
| 2a | What stops workspace zip = superuser? | **Nothing stops it** | `.env.local` + `dev-all.js` auto-upsert = full compromise on any backup leak. |
| 2b | Hardcoded `'Luminila2026!'` in tests? | *not separately answered* | Fallback password in `test-capture-invariants.ts:31`, `test-roadmap-capture.ts:32`, `.env.local:6`. |
| 3a/b | Deployed host-guard env? Public index? | **No prod deploy** | So what *is* deployed? Host-guard OFF is moot on localhost, but code treats surface as internet-facing. |
| 3c | XFF-strip tunnel = admin? | *not separately answered* | `proxy.ts:35 trustLoopback:!viaProxy` — fragile (see H8). |
| 5a | Exposed `cost_price`? | **Mistake - remove** | Operator agreed misexposure was a mistake. |
| 5b/c | Enumerate tenants / rate limit? | *not separately answered* | Auditor H3/H4 stand. |
| 6 | Which storefront is prod? | **"No idea read the code and explain what does what"** | Auditor read it — see §7 (O1 / §1.1 below). |
| 7 | Which PB port? | **8090 always** | Delete all 8091/8092 fallbacks. |
| 8 | JWT in `localStorage`? | **"what is the most secure option?"** | Answer: **httpOnly, Secure, SameSite cookie + server-side session** (not localStorage, not in-memory-only). See §7 (C3). |
| 9 | Print-window `innerHTML` fix? | **Sanitize with DOMPurify** | Correct for XSS, but also need print CSS or React portal — DOMPurify alone does not fix lost Tailwind. |
| 10 | Rate limit replace? | Operator first picked "Fix XFF only", then said **"ok do the strong option"** quoting the auditor's edge + DB-backed recommendation. | Strong option: shared edge limit (Cloudflare / nginx `limit_req`) for `/api/storefront/*`, DB-backed counters for OTP/orders, keep in-memory only as dev fallback. See §2. |
| 11 | Tenant mode? | **Single only** | Delete multi-account registry code (`TenantRegistryLike`, `resolveTenantRuntime`, `tenant-db-manager` 694 lines, `NEXT_PUBLIC_TENANT_MODE` split). |
| 12 | Tests / CI? | *not answered* | `npm test` = 29 sequential `tsx &&` chain; failure at #3 hides #29. No husky / lint-staged. |

### 1.1 Which storefront does what (operator asked auditor to read code)

You have **three** things, three different jobs. The confusion is real because nothing documents the split:

- **`src/app/storefront-control/page.tsx` (3,489 lines) — the admin CMS**, runs inside the ERP on `:3000`. Uses `pb`, `NITHGICAL_DEFAULTS`, `mergeNiththigal`, `NiththigalEditor`. Shows "Live Storefront Preview" linking to `getStorefrontOrigin()` (default `localhost:3001`, `:1317`), embeds nginx `proxy_pass http://127.0.0.1:3001` (`:1365`). **Keep.**
- **`storefront/` — the public customer site**, standalone Next.js on `:3001` (own `package.json`, `Dockerfile`, `src/app/{products,checkout,collections,about,faq}`, `robots.ts`, `sitemap.ts`, `merchant-feed.xml`). README: *"Standalone E-Commerce Storefront"*, dual checkout (gateway + WhatsApp), Cloudflare Pages or Docker VPS, talks to PocketBase via `NEXT_PUBLIC_POCKETBASE_URL` and to ERP via `/api/storefront/`. **This is the customer-facing site — keep.**
- **`storefront_example/niththigal/` — static design prototype**, vanilla HTML/CSS/JS (`Niththigal (1).html`, `app.js`, `assets/*.webp`). README: *"deployment-ready front end, **not a connected ecommerce backend**"*. Runs via `python -m http.server 3000` or opening HTML directly. **Archive/delete; do not ship.**

---

## 2. STRONG-OPTION RATE-LIMIT FIX (operator approved)

> *"Fixing XFF trust makes the in-memory limit harmlessly correct on single instance, but it still vanishes on restart, isn't shared across replicas, and still only covers 1 route. For a Cloudflare-fronted storefront, 'fix XFF' is theatre. Minimum viable: shared limit at edge (Cloudflare Rate Limiting / nginx limit_req) for /api/storefront/*, DB-backed counters for OTP/orders. In-memory can stay as dev fallback."*
> — auditor, quoted by operator who approved: **"ok do the strong option"**.

### 2.1 Topology

- 1 Next process + 1 PocketBase (`127.0.0.1:8090`) per deployment (`rate-limit.ts:4`).
- Public routes: `storefront/order`, `storefront/flash-drop`, `storefront/auth/send-otp`, `tracking/st-courier`.
- Each public route had its **own** hand-rolled `Map`:
  - `storefront/order/route.ts:47-67` — per-phone `Map`, 5 orders / 10 min.
  - `storefront/flash-drop/route.ts:76-94` — `ip:get` / `ip:reserve` / `reserve:phone` / `ip:pay` / `ip:order` Maps.
  - `send-otp/route.ts:20-37` — `ipAttempts` Map, 20 / 10 min.
  - Shared `FixedWindowRateLimiter` (`rate-limit.ts`) used **only** by `tracking/st-courier`.
- IP extraction was inconsistent:
  - `flash-drop/route.ts:97` `clientIp()` — **first** hop `split(",")[0]` ❌ spoofable.
  - `send-otp/route.ts:23` `clientAddress()` — **first** hop ❌ spoofable.
  - `rate-limit.ts:125` `clientKeyFromHeaders()` — **last** hop (correct per PAY-12) but with `TRUSTED_PROXY_HOPS` unset, leftward entries attacker-controlled.
  - Result: attacker rotates `x-forwarded-for` leftmost entry and mints a fresh bucket per request on two routes.

### 2.2 The strong option, mapped to this topology

1. **Edge layer (survives restart, shared):** nginx `limit_req` (template already in `storefront/README.md:53-99` — add `/api/storefront/` limit zone) or Cloudflare Rate Limiting rule on `/api/storefront/*` — 100 req/min/IP burst, 429 + `Retry-After`. This is the *primary* limiter for catalogue scrape.
2. **App layer (shared `FixedWindowRateLimiter` everywhere):** replace the 3 hand-rolled Maps with the one shared class so prune/cap logic is uniform, and return standard `429` + `Retry-After` + `X-RateLimit-Limit/Remaining/Reset` headers so clients can back off.
3. **Durable layer (PocketBase-backed):** OTP per-phone daily cap already lives in `otp-store.ts` (PocketBase) — keep it as the restart-proof counter. Per-phone order cap (5/10 min) moves the same way: count `sales_orders` rows for the phone in the window via `createTenantClient` instead of a `Map`.
4. **IP extraction hardened:** prefer `cf-connecting-ip` > `x-real-ip`, honour `x-forwarded-for` **only** when `TRUSTED_PROXY_HOPS > 0` and then take the entry `hops.length - 1 - TRUSTED_PROXY_HOPS` from the right; never trust first hop blindly. Remove `clientIp`/`clientAddress` first-hop helpers in flash-drop/send-otp.

### 2.3 Acceptance tests (`src/scripts/test-rate-limit.ts` extended)

- Existing 8 tests (limit, retry hint, window reset, key independence, prune, right-most hop, `TRUSTED_PROXY_HOPS`, x-real-ip, per-request `direct:` bucket) must still pass.
- New: first-hop spoof (`x-forwarded-for: attacker, 203.0.113.9` with `TRUSTED_PROXY_HOPS=0`) returns `203.0.113.9`, **not** attacker string.
- New: `checkPublicRateLimit(req, "send-otp", {max:20, windowMs:600000})` returns 429 + `Retry-After` header after 20 hits from same IP, allowed from different IP.
- New: order route counts `sales_orders` in window (PocketBase mock) instead of Map.

### 2.4 Known residual risk (documented, not solved by this fix alone)

- In-memory limiter still resets on process restart. Mitigated by edge layer + durable OTP/order counters, not by the Map itself.
- `MAX_WINDOWS=10000` key cap eviction can be gamed by XFF rotation; mitigated by edge per-IP rule.
- No distributed store (Redis) — documented as acceptable for single-showroom-machine topology, **not** for multi-replica.

---

## CRITICAL — DATA BREACH / AUTH BYPASS

### C1 — Production SQLite in git history — **Critical**
- `git ls-files` shows:
  ```
  pocketbase/pb_data_backup_20261102/data.db
  pocketbase/pb_data_backup_20261102/data.db-shm
  pocketbase/pb_data_backup_20261102/data.db-wal
  ```
- `.gitignore:62-66` ignores `pocketbase/pb_data/*` but NOT `pb_data_backup_*`. The backup dir was literally named to evade the rule.
- Impact: Any clone/fork = full tenant dump (customers, GSTIN, cost_price, WhatsApp CRM, OTP). `git rm --cached` won't clean history. Needs `git filter-repo` + rotation.
- Fix: `git rm --cached`, purge history, rotate *everything* in that DB.

### C2 — Secrets shipped by design — **Critical**
- `.env.local` keys present (no values echoed here): `POCKETBASE_SUPERUSER_EMAIL`, `POCKETBASE_SUPERUSER_PASSWORD`, `TENANT_REGISTRY_KEY` (64-hex), `CUSTOMER_SESSION_SECRET` (64-hex).
- `.gitignore:37 .env*` hides the file, but:
  - `scripts/dev-all.js` provisions superuser: `adminUser = env || 'admin@luminila.local'` then `pocketbase.exe superuser upsert`; email logged to stdout.
  - `scratch/initial_schema.js` 252KB + `mkuser.mjs` + `sync_admin.js` leave creation recipes.
  - `env.example.txt:38` `INITIAL_ADMIN_PASSWORD=change-me-before-first-boot`.
  - `src/scripts/test-*.ts` fallback `'Luminila2026!'` in `test-capture-invariants.ts:31`, `test-roadmap-capture.ts:32`, hardcoded in `.env.local:6`.
- Impact: Workspace zip / backup / log file = superuser. Password fallback appears in 3+ test files.

### C3 — Browser JWT = full takeover — **Critical**
- `src/lib/pocketbase.ts:60` `export const pb = new PocketBase(getPocketBaseUrl())`.
- `src/contexts/AuthContext.tsx:67-85` uses `pb.authStore` (default `localStorage:pocketbase_auth`, 180-day JWT).
- 141 `localStorage` hits repo-wide:
  - POS cart/held `src/app/pos/page.tsx:334,341,359,372`, `luminila_active_pos_loc_${userEmail}:407,1472`
  - `merchant_upi_id` `src/app/invoices/detail/page.tsx:248,790`
  - `PB_CUSTOM_URL`, `luminila_products` `src/app/labels/page.tsx:441,453`
  - `luminila_notifications` `settings/page.tsx:263,278`, `wa_read_timestamps` `whatsapp/page.tsx:946`, `wa_badge_layout:1063`
  - Channel pricing cache `channel-pricing.ts:109,132,151`
- Any XSS (H2) silently copies the token. Logout wipes storage `AuthContext.tsx:160-167` but copies `HARDWARE_PREFIXES` (`pos_printer`, `barcode_scanner`...) — overly clever, untested edge.
- Auth flow: `login()` calls `resolveTenantPocketBase(email)` then `authWithPassword`, updates `last_login` `AuthContext.tsx:131-135`. Is-active check `!==true` throws (good — A11 patched), but `checkUserIsAdmin` swallows errors -> `return false` (fail-closed only by accident).
- **Most secure option (operator asked):** `httpOnly; Secure; SameSite=Lax` cookie set by a server `/api/auth/*` route, read server-side, `authRefresh` on load. Not `localStorage` (XSS-stealable), not in-memory-only (breaks refresh / tab reload). Requires a cookie-writing API route; PocketBase JS SDK supports cookie store in SSR.

### C4 — `eval("require")` — **Critical**
- `src/lib/pocketbase.ts:148` `const nodeRequire = eval("require") as NodeRequire;`
- `149-150: nodeRequire("fs")`, `nodeRequire("path")` to read `pb_tenants/registry.json`.
- Bypasses bundler, breaks CSP at runtime if ever enabled, invisible to static analysis. Server FS access reachable from client bundle path.
- `src/lib/mobile-scanner.ts:152`: `await (Function('m','return import(m)')(pluginModule))` (`pluginModule='@tauri-apps/plugin-barcode-scanner'`). Same class of sin.
- `src/lib/mobile-scanner.ts` `__TAURI_INTERNALS__*/hooks/use-viewport.ts:30` detection fragile.

---

## HIGH — SECURITY HOLES

### H1 — XSS via print windows — **High**
| File | Line | Pattern |
|---|---|---|
| `src/components/invoice/InvoicePrint.tsx` | 178 | `${content.innerHTML}` |
| same | 202,340 | logo `eslint-disable no-img-element` — dynamic base64 upload |
| `src/app/invoices/detail/page.tsx` | 153 | `${element.innerHTML}` (comment L132: loses Tailwind rules) |
| `src/app/pos/page.tsx` | 944 | `<body>${receiptRef.current.innerHTML}</body>` |
| `src/components/shipping/ShippingLabelPrintModal.tsx` | 213 | `${content.innerHTML}` |
| `src/lib/reports.ts` | 835 | `${element.innerHTML}` |
| `src/app/layout.tsx` | 60 | `<script dangerouslySetInnerHTML={{__html:themeScript}}/>` L29 |

Stored XSS via product name, customer name, or uploaded logo -> executes in print window origin -> reads `localStorage` JWT (C3). No `DOMPurify`.
- **Operator decision: sanitize with DOMPurify.** Note: DOMPurify stops XSS, it does **not** restore lost Tailwind/CSS in the bare window. Pair it with print CSS injection or a React portal.

### H2 — Zero security headers — **High**
- `next.config.ts` has zero `headers()`.
- `proxy.ts:58-63` sets `X-Content-Type-Options:nosniff`, `Referrer-Policy`, `X-Frame-Options:DENY` (admin only) — only if guard enabled.
- No `Content-Security-Policy`, `Strict-Transport-Security`, `Permissions-Policy`, CORS lockdown.
- Inline `themeScript` (L29) + `eval` (C4) make CSP impossible without rewrite.

### H3 — Open storefront APIs designed without auth — **High**
- `src/lib/public-surfaces.ts`: `PUBLIC_PATH_PREFIXES=["/login","/tracking","/checkout"]`, `STOREFRONT_PATH_PREFIXES=["/checkout","/tracking","/api/storefront","/api/tracking"]`.
- `src/app/api/storefront/catalog/route.ts`: `CORS_HEADERS Access-Control-Allow-Origin:"*"`, open `OPTIONS`, tenant via `account_email`/`x-account-email`, reads `cost_price?:number` L73, maps L127, exposes `total_stock`, variant `stock_level`, internal IDs.
- `src/app/api/catalog/feed/route.ts:139` `cost_price:Number(p.cost_price)||0` fed into `getChannelPriceFromList`.
- `src/app/api/storefront/order/route.ts:620` `cost_price` internal read.
- Impact: Internet scrape farm. Margins inferrable if channel fallback uses cost markup.
- **Operator decision: "Mistake - remove"** (cost_price exposure). Redact from public projection; server-side pricing already recomputes via `getChannelPriceFromList`.

### H4 — Rate limit theatre — **High** (fix: see §2)
- `src/lib/rate-limit.ts`: in-memory FixedWindow, 256-check prune, `MAX_WINDOWS=10000`.
- Used only by `tracking/st-courier/route.ts:6`. Storefront uses hand-rolled `Map` (`order/route.ts:43-60`, `flash-drop` per-phone Map, OTP daily limit only in docs). `clientKeyFromHeaders` uses `x-forwarded-for` last hop, but with `TRUSTED_PROXY_HOPS` unset and direct attacker, attacker sets last hop arbitrarily -> new bucket per request.
- Restart clears counters. Distributed NAT shares bucket.
- **Operator decision: strong option (edge + DB-backed), not "fix XFF only".** See §2.

### H5 — Payment routes under-documented — **High**
- `src/app/api/webhooks/razorpay/route.ts` + `razorpay-webhook-handler.ts:411 console.log Processing Razorpay...` (signature tests exist `test-gateway-signature.ts` but handler logging remains).
- `src/app/api/pos/payment/route.ts` absent from `authenticateOperator` grep list.
- `catalog/image/route.ts` via `feed` `origin/api/catalog/image?id=` exposes authenticated image via IDOR (`id` + optional `account_email`).
- `src/lib/phonepe.ts:24-27` reads `NEXT_PUBLIC_PHONEPE_MERCHANT_ID` (public) alongside salt key (server-only) — mixed trust.
- `src/lib/eway-bill.ts:16,277,285` `CryptoJS.AES.encrypt` ECB mode — leaks patterns, no IV. `crypto-js@4.2`, `zod@4.6` only for CSV parsing (13 uses).

### H6 — Superuser fallback in API auth — **High**
- `src/lib/api-auth.ts:50-70 authenticateOperator` tries `users.authRefresh` then `_superusers.authRefresh`.
- `src/lib/pocketbase.ts:authenticateTenantClient` same.
- `src/app/api/catalog/batch/route.ts:44-68` duplicate accepting `_superusers` token.
- Contradicts `AuthContext.tsx` A9 comment "never fall back to _superusers on normal login" — API does exactly that. Different trust boundary per file.

### H7 — Customer PII aggregation — **High**
- `customer-lookup.ts:40 normalizePhone slice(-10)`, stores phone, email, address, GSTIN, PAN, DOB, anniversary, loyalty.
- `whatsapp-crm.ts`, `whatsapp-message-store.ts`, `consent-ledger.ts` aggregate.
- `backup.ts BACKUP_TABLES` scoped to `account_email` but restore stamps tenant — no field redaction. Cloud backup = DPDP breach.

### H8 — No host guard by default, loopback trust fragile — **High**
- `src/lib/host-guard.ts` `enabled = adminHosts.length||storefrontHosts.length && !=off`.
- `proxy.ts:35 trustLoopback:!viaProxy` — XFF missing = trust localhost. Tunnel rewrites Host to `localhost` + strips XFF = public visitor classified admin (A-15 patch attempted, still fragile). INF-9 traversal check `normalizePathForPolicy` good, but only when enabled.
- `x-forwarded-host` trusted `proxy.ts:31-33` — spoofable if upstream doesn't strip (A-15 residual).
- **Operator:** "No prod deploy" — so guard status is currently moot in prod, but the code path is the documented private-ERP story.

---

## UI DECAY

### U1 — God pages, no splitting
| Page | Lines | Sin |
|---|---|---|
| `whatsapp/page.tsx` | 5,362 | 3,316 lines of badge/layout hacks, `sessionStorage` timestamps, `localStorage` badge layout |
| `storefront-control/page.tsx` | 3,489 | CMS + preview + publish in one file |
| `pos/page.tsx` | 2,658 | Cart + held cart + location + print + scanner |
| `inventory/page.tsx` | 2,166 | Bulk + packing + cycle count + virtual bundles in one |
| `customers/page.tsx` | 2,030 | List + detail + loyalty + anniversary |
| `settings/page.tsx` | 1,711 | Providers + notifications + registry |

`scripts/dev-all.js` `warmupNextRoutes` fetches every route sequentially — 47 routes × latency = minutes of thrash on exFAT drive (`next.config.ts` admits `fix-exfat-readlink.cjs` needed). First hit = webpack compile of 5k lines.

### U2 — Print CSS broken
- `invoices/detail:132` comment admits copying `innerHTML` into bare window loses every Tailwind rule.
- `InvoicePrint.tsx` raw HTML string. `@media print` missing in `global.css` (Tailwind v4). `layout.tsx:27` comment admits `font-sans` resolved to nothing (Tailwind token self-reference). `viewport themeColor:#001F3F` hardcoded.

### U3 — Alert fatigue + console noise
- `sonner` `Toaster position=top-right richColors closeButton` `layout.tsx:65`.
- 337 `console.log` live (`pos/page.tsx:455,602,665`, `pos-sales.ts:265,378,389`). Only `console.warn` in rate-limit. No logger redaction.

### U4 — A11y / semantics
- `checkout/whatsapp` 658 lines: `Intl` formatting but inputs unlabeled Watson pattern.
- `InvoicePrint` `img` with `eslint-disable no-img-element`; icon buttons (`Sidebar`, `MobileBottomNav`, `WhatsAppDrawer`) lack `aria-label`; tables (`customers/detail` 710 lines, `vendors/detail` 631) use `div` grid without `<table>` semantics.

### U5 — Responsive / nav sprawl
- 4 nav copies: `AppChrome` + `Sidebar` + `MobileBottomNav` + `MobileDrawer`.
- `hooks/use-viewport.ts:30 "__TAURI_INTERNALS__" in window` fragile. Light/dark: `layout.tsx` themeScript forces `dark` on catch, light only via OS. `dark` class toggled inconsistently.

---

## ORPHAN / REDUNDANT

### O1 — Storefront duplication (clarified — see §1.1)
- `src/app/storefront-control/` (3,489-line CMS) + `storefront/` standalone Next app (`storefront/package.json`, `Dockerfile`, `seed-niththigal.cjs`) + `storefront_example/` + `storefront-content` route. Three ways to edit same content. `resolveStorefrontTenant` fallback `A25` (avoids registry) shows multi-source truth.
- Triple-storefront framing is misleading: 1 is CMS, 1 is public site, 1 is prototype (see §1.1). Keep CMS + public site, delete prototype.

### O2 — Checkout redundancy
- `checkout/whatsapp/page.tsx` 658 vs `pos/page.tsx` 2658 vs WhatsApp `order-ingestion` vs `storefront/order` route. Same discount/GST math thrice (`calculator` comments in order route:643-648).

### O3 — Assistant graveyard
- `assistant/page.tsx` 384-line wrapper over 14 `src/lib/ai/*` files (agent-loop, harness, net-guard, sse). `api/ai/*` 7 routes. Providers settings duplicated in `settings/page.tsx` 1711 lines.

### O4 — Tracking orphan
- `tracking/st-courier/page.tsx` 324 + `api/tracking/st-courier/route.ts` (only properly rate-limited route) — ST Courier is one carrier, general `shipments.ts`, `logistics-engine.ts` duplicate.

### O5 — Deps never imported (0 hits)
- `@openuidev/react-headless/react-lang/react-ui` 0 hits; `jszip` 0 hits; `@tauri-apps/api` 0 direct imports (only `plugin-barcode-scanner` string). Dead weight: `npm-openui-install.log` evidence of install spree.

### O6 — Folder sprawl
- `scratch/vyaparapp.exe` 95MB, `eslint_out.txt` 4.2MB, `tunnel-urls.json`, `pb-8091.pid/log`, `deploy/backup/backup.sh`, `deploy/env.example`, `backup_20251221_034042/` (gitignored but shipped), `server-dist/` placeholder only (`README.md` says never commit generated output — but `out/`, `.next/` exist locally), `wppconnect-sidecar/server.js` 129KB, `src-tauri/gen/android`, `docs/` vs `APP_LOGIC_AUDIT_REPORT.md` overlapping.

### O7 — Scripts harbouring secrets
- `scripts/*.js` + `src/scripts/test-*.ts` (54 files) — `test-capture-invariants`, `test-roadmap-capture` hardcode password fallback. `backfill-unit-costs.ts:18-19`, `rebuild-analytics-snapshots.ts:18-19` read `POCKETBASE_SUPERUSER_*` defaults.

---

## ILLOGICAL FEATURES

- **L1 — PB port roulette:** `DEFAULT_URL 8090` (`pocketbase.ts:12`), `tenant-db-manager.ts:218-222` prefers `8091` then `8090`, `pocketbase.ts:535 candidatePorts [8091,8090]`, `596 [8091,8090,8092]`, `dev-all.js` picks 8090 unless occupied by "Wondershare" then 8091. Browser guess `http://hostname:8090` in `pocketbase-url.ts:120` breaks prod HTTPS. Same DB reachable via 3 ports = same-origin confusion.
  - **Operator decision: 8090 always.** Delete 8091/8092 fallbacks, one source of truth from env.
- **L2 — Tenant mode schizo:** `NEXT_PUBLIC_TENANT_MODE` baked at build time, but server reads runtime `TENANT_MODE`. Comment in `env.example.txt` admits rebuild required. Single-account default but multi-account registry code everywhere (`TenantRegistryLike`, `resolveTenantRuntime`, `tenant-db-manager 694` lines).
  - **Operator decision: single only.** Delete registry code, make `account_email` constant.
- **L3 — Account email as RBAC:** `AuthContext.checkUserIsAdmin` queries `user_roles` with `account_email` filter, but if row empty grants nothing (AI-2) — legacy rows = bricked admin. Staff email vs `account_email` split confuses 403 debugging.
- **L4 — Host guard default-off:** `host-guard.ts parseHostGuardConfig enabled = adminHosts.length||storefrontHosts.length && !=off`. Without env, `proxy.ts` `if(!config.enabled) return NextResponse.next()` = no protection. Cloudflare tunnel docs assume guard on.
- **L5 — Settings vs AI Providers duplication:** Same provider key edited in two pages, two data paths, neither authoritative.
- **L6 — Backup restore unsafe order:** `backup.ts BACKUP_TABLES` order defined but restore loop not atomic; partial restore leaves FK dangling. `errors?: {table,error}` reported only after.

---

## TECH DEBT

- **T1 — Test chain = lottery:** `package.json test = 29 sequential tsx &&` (`test-invoice-math` through `test-analytics`). Failure at #3 hides #29. No parallelism, no runner. `typecheck: tsc --noEmit --incremental false` full recheck every CI. `lint: eslint` bare, no `--max-warnings`.
- **T2 — Dev orchestrator over-engineered:** `scripts/dev-all.js 19.8KB` supervise loop, restart budget 5, warmup threadpool 4, taskkill `/F`. Spawns PB + sidecar + Next even for typecheck. `tunnel.js 9.6KB` duplicates cloudflared args.
- **T3 — Crypto legacy:** `src/lib/eway-bill.ts:16 CryptoJS.AES.encrypt ECB mode (line 277,285)`. ECB leaks patterns, no IV. `crypto-js` 4.2 with 13 prod `zod` uses for CSV parsing only — validation elsewhere hand-rolled `sanitizeFilter`.
- **T4 — Console noise:** 337 `console.log` (lead `pos/page.tsx:455,602,665`, `pos-sales.ts:265,378,389`). `console.warn` in rate-limit only. No logger redaction for PII.
- **T5 — exFAT special-case:** `next.config.ts` comment + `scripts/fix-exfat-readlink.cjs` + `NODE_OPTIONS=--require ./scripts/fix-exfat-readlink.cjs` in build. Shipping dev on external drive = prod risk.
- **T6 — Backup restore unsafe order:** `backup.ts BACKUP_TABLES` order defined but restore loop not atomic; partial restore leaves FK dangling. `errors?: {table,error}` reported only after.

---

## FALSE SECURITY

- **F1 — "Host guard" headlines vs default-off.** Docs tout private ERP, code disables when env missing. Prior audits A-15/AI-12/AI-10 repeatedly flag; still requires operators to set both host lists or protection vanishes.
- **F2 — "Tenant isolation" that is DRY-less:** `account_email` checks sprinkled, but variants filter allows `account_email = ""` for legacy (SF-20), catalog feed re-implements filter differently than storefront catalog, backup restore trusts client. One missed `filter` = cross-tenant read.
- **F3 — Rate-limit marketing:** Comment says "in-memory is enough" but product is internet-facing storefront (Cloudflare). Customers listed as "Disposable limit" is false.
- **F4 — Markdown "safe":** `src/components/assistant/Markdown.tsx:8 * dangerouslySetInnerHTML, so model output cannot inject markup.` Yet dashboard renders unescaped product titles into `innerHTML` print. AI output sanitized, user input not.
- **F5 — "Encrypted secrets":** `AI_SECRET_KEY`/`TENANT_REGISTRY_KEY` 64-hex encrypts provider keys, but `pocketbase.ts` registry stores `adminPassword` plaintext or `enc:v1:` ciphertext loaded via `readRegistrySecret` — attacker with file read decrypts all tenant superusers with one key.
- **F6 — CI exists but not enforced:** `.github/workflows/ci.yml` present, but `husky` False, no `lint-staged`, no branch protection proof. `dev-all` secret generation via `randomBytes` logs not gated.

---

## WHAT PRIOR AUDITS ALREADY KNEW VS NEW

- **Known (do not re-report as new):** A-15 Host spoof, A-16 staff tenant mismatch, INF-9 traversal, PAY-12 XFF order, AI-10 window cap, SF-14 variant scope, A-20 token refresh, A25 content fallback, INF-12 split mode, ECB eway risk mentions.
- **New in this audit:** Committed `pb_data_backup` DB, `eval("require")` + `Function(import)`, zero hits for `@openuidev/*`/`jszip`, 337 console.log count, innerHTML print fleet (5 files), CSP absence, PB 8090/8091/8092 roulette evidence lines, CORS * on catalog, `.env.local` key inventory, `scratch/vyaparapp.exe` 95MB + `eslint_out.txt` 4.2MB, `scripts/dev-all.js:1-441` supervisor reality. Plus operator answers (§1) and strong-option rate-limit scope (§2).

---

## PRIORITIZED REMEDIATION

1. **Immediate (24h):** Purge `pb_data_backup_20261102/` from git history (`git filter-repo`), rotate superuser + registry + session secrets, audit who cloned.
2. **Immediate:** Add `headers()` with CSP (no `unsafe-eval`), HSTS, `Permissions-Policy`. Remove `eval`/`Function` (replace with `createRequire` server-only, static import).
3. **Immediate:** Set `ADMIN_HOSTS`/`STOREFRONT_HOSTS` in prod or remove host-guard theatre and use real auth middleware.
4. **Week 1:** Replace `innerHTML` print with `DOMPurify` + print CSS injection / React portal. Fix `font-sans` token.
5. **Week 1:** Lock `storefront/catalog` (remove `cost_price`, add auth/rate-limit via shared `rate-limit.ts` + edge rule, fix IP extraction — see §2). Add `cost_price` redaction test.
6. **Week 2:** Flatten god pages (extract `whatsapp` subcomponents, `pos` cart/held logic). Kill duplicate nav. Add `aria-label`/`label` audit. Move JWT to `httpOnly` cookie (§7 C3).
7. **Week 2:** Delete `@openuidev/*`, `jszip` (or wire), `storefront_example/`, `scratch/vyaparapp.exe`, collapse triple checkout/assistant/tracking into single implementations. Pin PB port to 8090 (operator decision), kill roulette. Delete multi-account registry (operator: single only).
8. **Week 3:** Replace 29-file `&&` test chain with parallel runner + GH Actions gating, add `lint-staged`/husky, purge 337 `console.log`.

---

## GRILL-ME — QUESTIONS (for reference)

1. Why is a **production database** still in git history? Who has the current clone list? Have you rotated the superuser since 2026-10-24 re-key?
2. If host-guard is OFF by default, what *actually* stops a public attacker hitting `/inventory` today? Show me the deployed env.
3. Why does `pos/page.tsx` need 2,658 lines? What would break if cart vs held-cart vs print were 3 separate modules?
4. Why three storefronts? Which one serves prod traffic — `storefront-control`, `storefront/`, or `storefront_example`? *(Answered — see §1.1.)*
5. Why trust `x-forwarded-for` last hop when you control the tunnel? Why is rate-limit in-memory for an internet storefront? *(Strong-option fix: §2.)*
6. Why `CryptoJS ECB` for e-way bills in 2026? Who approved ECB?
7. Which of `@openuidev`, `jszip`, `socket.io-client` is load-bearing? Show me an import.
8. If `.env.local` leaked tomorrow, what stops an attacker from minting a superuser via `superuser upsert`?
9. Print window loses Tailwind (your own comment L132) — why ship broken invoices to customers?
10. When did you last `git filter-repo`? If never, why should anyone trust this repo's confidentiality?

---

*Antagonistic audit — no sugar. Fix C1-C4 + H1-H3 before any new feature ships.*
