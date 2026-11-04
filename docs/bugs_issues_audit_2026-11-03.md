# Luminila — Bugs & Issues Audit 2026-11-03

> Fresh feature-by-feature audit at HEAD `2d574b8` (branch `feat/analytics-deep-insights`), after the 214-finding register (`docs/codebase_bugs_and_issues_audit.md`) was remediated through `454ebb5`.
> **Scope:** deep audit of code added/changed since audit pass 2 (`17622fe`) — analytics-v2, packing station, flash-drop checkout, closures — plus a regression check of all 9 legacy areas (every Critical + ≥half of Highs verified per area).
> **Dedupe rule:** nothing already fixed in the old register is re-listed; reproduced old defects are marked REG. Findings marked ✔ were independently verified by the auditor, not just agent-reported.
> **Method:** 7 read-only audit agents (waves of ≤2–3), auditor spot-verification of the top claims. No code changes were made.

> **Remediation (2026-11-03):** see [bugs_issues_remediation_2026-11-03.md](bugs_issues_remediation_2026-11-03.md). All 3 Criticals fixed; 49 findings fixed, 3 partial, remaining Medium/Low tail deferred with reasons. `npm run typecheck` and `npm run lint` are green; 25/27 test suites pass (2 require a live PocketBase on :8091). Migrations changed — run the house backup → migrate-up procedure before deploying.

## Totals

**91 new findings — 3 Critical · 13 High · 38 Medium · 37 Low** — plus **4 legacy items still open/partial** (A-01 rule half, A-22 login-redirect half, ORD-11 child stamps, FIN-23 `<h2>` escape). Runtime: typecheck green, **lint broken and `npm test` red (3 suites)** — see §6 (RT-1…RT-4).

| # | Feature area | Critical | High | Medium | Low | Total | Legacy verdict |
| :- | :--- | :-: | :-: | :-: | :-: | :-: | :--- |
| 1 | Analytics / Deep-Insights | 1 | 4 | 17 | 11 | 33 | FIN-15 REGRESSED |
| 2 | Packing station | 1 | 2 | 5 | 6 | 14 | A-05 REGRESSED, A-01 class on new collection |
| 3 | Flash-drop checkout | 0 | 2 | 5 | 5 | 12 | POS-01/SF-02 class verified clean |
| 4 | Closure residuals (OTP/E-way/RBAC/spawn) | 0 | 1 | 2 | 5 | 8 | A-07 STILL-OPEN (dedicated tenant), A-22 partial |
| 5 | Legacy regression sweep — new defects | 1 | 4 | 9 | 10 | 24 | see §5 tables |

### Cross-cutting themes (fix first)

1. **Half-applied fixes / missed sibling call sites** are the dominant defect class: A-01 (PB rules still staff-only), A-07 (plaintext password on the dedicated-tenant branch), POS-07 (jewelry fields dropped at the cart boundary), ORD-01 (unique-race fallback unscoped → Critical cross-tenant hijack), CRM-01 (`createCustomerFromChat` still un-stamped → WhatsApp leads vanish), `markSalesOrderShipped` bypass, unstamped child writes in returns.
2. **New features replicate old bugs the repo already fixed**: packing migration recreates the A-05 `fields`-in-constructor crash and the A-01 staff-lockout rule; flash-drop re-learns webhook-vs-confirm deduction races.
3. **Analytics correctness**: the canonical revenue-truth loader double-counts WhatsApp orders (the one channel storefront dedupe doesn't cover), loses window-boundary rows to PB datetime string-compare, and mislabels transaction counts as customers.
4. **Silent failure modes**: catalog sync writes fail forever (columns don't exist), queue errors render as empty states, swallowed gateway-order updates strand paid buyers.

---

## 1. Analytics / Deep-Insights (AN-01 … AN-33)

### Critical

| ID | File:Line | Issue | Evidence / Fix |
| :- | :--- | :--- | :--- |
| ✔ AN-01 | [chat-sales.ts:303-333](../src/lib/chat-sales.ts#L303-L333), [chat-sales.ts:391-407](../src/lib/chat-sales.ts#L391-L407), [load.ts:101](../src/lib/analytics-v2/load.ts#L101) | **WhatsApp revenue double-counted and counted before payment.** Every WhatsApp concierge order writes a `confirmed` `sales_orders` row AND a `pending` `sales` mirror (`channel: 'whatsapp'`). The canonical loader counts sales with `channel!="storefront"` (no status guard) **plus** confirmed orders → the same order counts twice, before payment. Storefront dedupe is correct; WhatsApp is not. | Verified at HEAD. Fix: exclude the `whatsapp` mirror in `load.ts` exactly like `storefront`, or stop writing the mirror. |

### High

| ID | File:Line | Issue | Evidence / Fix |
| :- | :--- | :--- | :--- |
| ✔ AN-02 | [load.ts:101-105,228](../src/lib/analytics-v2/load.ts#L101-L105), [sales-metrics.ts:228-229](../src/lib/analytics-v2/sales-metrics.ts#L228-L229), [turnover.ts:158](../src/lib/analytics-v2/turnover.ts#L158) | **PB datetime filters use `T`-format ISO; string compare drops boundary sales.** `range.ts:53` emits `toISOString()`; PB stores `… 18:30:00.000Z` (space). At index 10 space < `T`, so rows on the window-start UTC date compare before the filter and are excluded — on IST every preset loses first-day early-morning sales; on a UTC host the whole first day vanishes. `utils.ts:37-45` (`normalizeDateBounds`) documents and solves exactly this; analytics doesn't use it. `inWindow()` only fixes over-inclusion, never recovers DB-filtered rows. | Normalize all analytics filter bounds to PB space format. |
| ✔ AN-03 | [reports.ts:548](../src/lib/reports.ts#L548), used by [Shared.tsx:139](../src/components/analytics/Shared.tsx#L139) | **CSV export prefix-curses every label cell.** Formula-injection guard `/^[=+@-|\t\r]/` — the `@-|` range (0x40–0x7C) includes A–Z, a–z, `_[\]^` , so "Gold Ring" exports as `'Gold Ring`. Every analytics-table CSV export is affected. | Escape the dash: `[=+@\-|\t\r]`. |
| AN-04 | [profitability.ts:97-103,152-166,218-223](../src/lib/analytics-v2/profitability.ts#L97-L103) | **Discount-allocation gate inverted + previous window unadjusted.** `orderDiscount = max(0, tx.revenue − lineNetSum − tx.discount)` is the header-vs-lines gap (`tax+shipping−2·discount`), not the discount. POS writes bill discount on the header with item `discount: 0` ([pos-sales.ts:124,161](../src/lib/pos-sales.ts#L124)) → gap = `−2·discount` → clamped 0 → **POS bill discounts are never allocated**, overstating per-product/category margin. Orders allocate only when `discount < (tax+shipping)/2`. Previous window uses raw `netRevenue` (prev txs never loaded) → `previousMarginPct`, trend overlay, erosion deltas inconsistent whenever allocation fires. | Scale off `tx.discount > 0`; load prev txs and allocate both windows. |
| AN-05 | [sales-metrics.ts:246-267](../src/lib/analytics-v2/sales-metrics.ts#L246-L267), [SalesTab.tsx:75,78,142-151](../src/components/analytics/SalesTab.tsx#L75) | **"New/Returning customers" and "Repeat Rate" count transactions, not customers.** Counters increment once per tx; a returning buyer with 5 orders counts 5×. `Orders` KPI is the unified tx count (POS sales + orders), not orders. | Dedupe by `customerKey` per window for customer metrics; relabel/dedupe the Orders KPI. |

### Medium

| ID | File:Line | Issue |
| :- | :--- | :--- |
| AN-06 | [sales-metrics.ts:113-123](../src/lib/analytics-v2/sales-metrics.ts#L113-L123) | 12m trend previous-overlay can never render: monthly branch keys by the previous window's own `YYYY-MM`; lookup uses current-window months → `previousRevenue` always null for >60d ranges despite the dashed-series legend. |
| AN-07 | [load.ts:123,140](../src/lib/analytics-v2/load.ts#L123), [range.ts:34-39](../src/lib/analytics-v2/range.ts#L34-L39) | Day keys are UTC-sliced while window day arrays are local → a 20:00Z sale renders in the previous local-day column across all trends. |
| AN-08 | [load.ts:101](../src/lib/analytics-v2/load.ts#L101) | Sales side of the revenue-truth rule has no status guard: voided/cancelled POS sales still count as revenue; returns/credit notes never net. |
| AN-09 | [load.ts:299](../src/lib/analytics-v2/load.ts#L299), [category-metrics.ts:105,128](../src/lib/analytics-v2/category-metrics.ts#L105) | Making-charge stats multiply `making_charges` by qty ignoring `making_charges_type` (`per_gram` needs ×net_weight; `percent` is a rate). |
| AN-10 | [turnover/route.ts:28-44](../src/app/api/analytics/turnover/route.ts#L28-L44) | `/api/analytics/turnover` authenticates but never checks `reports:read` — any staff user can pull the full turnover suite the UI blocks (A-11 class). |
| AN-11 | [turnover.ts:391,414-430](../src/lib/analytics-v2/turnover.ts#L391) | Category `startStockValue` initialized 0 and only written for categories present in `catMovementValue` → categories with stock but no in-window movements get avg inventory halved → turnover/GMROI roughly doubled. Product level verified OK. |
| AN-12 | [profitability.ts:168](../src/lib/analytics-v2/profitability.ts#L168), [load.ts:273-277](../src/lib/analytics-v2/load.ts#L273-L277) | `marginUnknownCostUnits` counts only `unitCost===0`; fallback-to-current-cost units are indistinguishable from true snapshots → "estimated cost" warning understates; counted units actually have **no** basis yet UI calls them "estimated". |
| AN-13 | [turnover.ts:293-295](../src/lib/analytics-v2/turnover.ts#L293-L295) | Suite margin uses raw `netRevenue` (no discount allocation) → Inventory-tab margin ≠ Profitability-tab margin for the same window. |
| AN-14 | [turnover.ts:276-290](../src/lib/analytics-v2/turnover.ts#L276-L290) | Opening-stock reconstruction excludes inactive-product/product-kind variants (no movement rows) while counting their COGS; `stockValueStart` can go negative → erratic turnover. |
| AN-15 | [snapshots.ts:48-56](../src/lib/analytics-v2/snapshots.ts#L48-L56) | Snapshot writer stores the full day's `orders` count on **every** category row; reader sums rows → orders multiplied by category count. |
| AN-16 | [snapshots.ts:109-130](../src/lib/analytics-v2/snapshots.ts#L109-L130), [rebuild-analytics-snapshots.ts:96-114](../src/scripts/rebuild-analytics-snapshots.ts#L96-L114) | Non-atomic delete-then-create: one create failure leaves the span empty (script exits after old rows deleted); failures swallowed but still counted as written. |
| AN-17 | [backfill-unit-costs.ts:60-61](../src/scripts/backfill-unit-costs.ts#L60-L61) | Backfill selects `unit_cost=""` but sale-time snapshotting writes literal **0** for unknown basis ([pos-sales.ts:157](../src/lib/pos-sales.ts#L157)) → those rows are never backfilled even after purchase history arrives. |
| AN-18 | [1793001000_analytics_unit_cost_and_snapshots.js:20,44-81](../pocketbase/pb_migrations/1793001000_analytics_unit_cost_and_snapshots.js#L20) | (a) Rule uses only `@request.auth.email` — staff locked out (A-01 class; corrected pattern exists in `1792774201`). (b) `if (!snapshots)` skip means a run dying between collection-save and field-add leaves a field-less collection that never self-heals. |
| AN-19 | [test-analytics.ts](../src/scripts/test-analytics.ts) | Coverage gap: loader dedupe/mirror exclusion/status filter, unit-cost fallback, `adjustedLineRevenues`, entire turnover reconstruction, snapshots — all untested. |
| AN-20 | [Shared.tsx:112-129](../src/components/analytics/Shared.tsx#L112-L129) | DataTable sorting coerces every value via `Number(v)\|\|0` → text columns no-op; tabs' `-1` null sentinels sort as −1; CSV exports `-1` where UI shows "—". |
| AN-21 | [page.tsx:179-183](../src/app/analytics/page.tsx#L179-L183), [profitability.ts:92](../src/lib/analytics-v2/profitability.ts#L92) | Refetch storm: tabs unmount on switch so every change re-runs full engines (Insights = 3 engines, 20+ `getFullList` scans); `adjustedLineRevenues` does `txs.find()` per line — O(n²) on 12m. |
| AN-22 | [MobileDrawer.tsx:50-95](../src/components/layout/MobileDrawer.tsx#L50-L95) | Mobile drawer cannot reach `/analytics` or `/packing` (desktop sidebar has both). |

### Low

| ID | File:Line | Issue |
| :- | :--- | :--- |
| AN-23 | [SalesTab.tsx:87-92](../src/components/analytics/SalesTab.tsx#L87-L92) | "No sales recorded" EmptyState is dead code — `buildTrend` zero-fills the axis so `trend.length ≥ 1` always. Gate on `kpis.orders.current === 0`. |
| AN-24 | [insights.ts:96,103-123](../src/lib/analytics-v2/insights.ts#L103-L123) | P1 card titled per-category margin drop computes the *overall* delta; D4 `impactINR` is at-risk revenue, not a loss estimate. |
| AN-25 | [ProfitabilityTab.tsx:67](../src/components/analytics/ProfitabilityTab.tsx#L67) | Discount-erosion delta is percentage *points* but rendered as a relative-% delta arrow. |
| AN-26 | [expenses.ts:448-449](../src/lib/expenses.ts#L448-L449), [profitability.ts:228](../src/lib/analytics-v2/profitability.ts#L228) | Expense window bound includes the exclusive end day while sales exclude it → "Margin − Expenses" skewed one day (AN-02 family). |
| AN-27 | [sales-metrics.ts:204-213](../src/lib/analytics-v2/sales-metrics.ts#L204-L213) | Date-only `order_date` orders heap into the midnight heatmap hour; heatmap hours local while day keys UTC (AN-07 inconsistency). |
| AN-28 | [load.ts:101-105](../src/lib/analytics-v2/load.ts#L101-L105), [profitability.ts:205-211](../src/lib/analytics-v2/profitability.ts#L205-L211) | `tenant` interpolated without `sanitizeFilter()` (house rule; auth-derived, low risk). Dead code: first `byChannel` aggregation discarded at :210-211. |
| AN-29 | [page.tsx:152-176](../src/app/analytics/page.tsx#L152-L176) | Tab clicks don't sync `?tab=` to the URL; browser Back from an Insights deep-link snaps to the stale param. |
| AN-30 | [2026-11-02-analytics-deep-insights.md](plans/2026-11-02-analytics-deep-insights.md) | Informational scope gaps vs plan: `RangeHeader` component, Excel export, snapshots layer wired to zero consumers, category Treemap/drill-down, RFM cohort table, aging drill list. |
| AN-31 | tabs import `./shared` vs on-disk `Shared.tsx` | Case-sensitivity risk: resolves on Windows; fails a case-sensitive Linux build if on-disk casing is `Shared.tsx`. Verify and normalize. |
| AN-32 | [turnover.ts:363-364](../src/lib/analytics-v2/turnover.ts#L363-L364) | Product turnover approximates per-unit cost as `stockValue/max(stock,1)` and returns null for sold-out products even when start stock existed (documented approximation). |
| REG AN-33 | [SalesChart.tsx:32-46](../src/components/dashboard/SalesChart.tsx#L32-L46) | **REGRESSION of old FIN-15:** home dashboard chart tooltip reads `payload[1]?.value` with only one `<Area>` rendered → always "0 orders". |

### Verified clean (crosswalk)

Race handling in all 5 tabs (cancelled-flag pattern); `tenantEmail()` ≡ `accountScopeEmail()` semantics (FIN-13 holds); FIN-14 fixed; A-16 fix present; MobileDrawer `/backup` guard present (AI-SYS-16); turnover route per-request client (no shared-session bleed); custom range end<start normalized; annualization/weeks-of-cover/dead-stock aging math correct; snapshot tenant scoping + unique index valid; `order_date` writers emit full ISO; storefront rows carry no item-level discount; ORD-02 (B2B stock deduction) fixed at HEAD.

---

## 2. Packing station (PK-01 … PK-14)

| ID | Sev | File:Line | Issue | Fix |
| :- | :-: | :--- | :--- | :--- |
| PK-01 | Crit | [1793000000_created_order_packing.js:20-58](../pocketbase/pb_migrations/1793000000_created_order_packing.js#L20-L58) | **REGRESSION of A-05: the `order_packing` collection can never be created.** Migration passes `fields` inside `new Collection({...})`, which PB 0.25's JSVM ignores; the subsequent save validates rules referencing the nonexistent `account_email` → throws "unknown field account_email". `bootstrapTenantDataDir` swallows `migrate up` failures, so on a fresh DB every `order_packing` call 404s silently. Corrected pattern exists in `1792774201:20-66`. | Recreate migration with create→save→`fields.add`→save→rules. |
| PK-02 | High | [1793000000_created_order_packing.js:17](../pocketbase/pb_migrations/1793000000_created_order_packing.js#L17) | REGRESSION of the A-01 class on the new collection: rule is `account_email = @request.auth.email` only — staff accounts cannot create/read/complete packing sessions. | Use the dual-identity pattern from `1792774201:57-61`. |
| PK-03 | High | [packing/page.tsx:286-313](../src/app/packing/page.tsx#L286-L313), [packing.ts:417-422](../src/lib/packing.ts#L417-L422) | **Concurrent packing loses scans — last-write-wins on `packed_items` JSON.** No merge, no optimistic-concurrency check; two tabs on the same order erase each other's scans, then the parcel can "complete" with scans silently dropped. Also TOCTOU in `getOrCreateSession` (packing.ts:375-415): only a non-unique index backs one-session-per-order → two `in_progress` sessions under a race. | Merge server-side or version-check `updated`; unique partial index on `(account_email, order) WHERE status='in_progress'`. |
| PK-04 | Med | [packing/page.tsx:416-432](../src/app/packing/page.tsx#L416-L432) | Completion notifies the customer **before** the session is saved (save failure → customer told "packed", retry re-sends WhatsApp); no order-status re-check (cancelled/dispatched orders still get the milestone). `cancelPackingSession` (packing.ts:461-464) has zero callers → orphaned `in_progress` sessions forever. | Save first, then notify once; guard on order status; wire cancel on abandonment. |
| PK-05 | Med | [packing/page.tsx:607-618](../src/app/packing/page.tsx#L607-L618) | Queue "Slip" button prints a packing slip with `lines: []` (QueueOrder carries only `item_count`) — empty-table "verify before sealing" slip. | Pass real lines or disable until session loaded. |
| PK-06 | Med | [packing.ts:329-341,474-477](../src/lib/packing.ts#L329-L341), [orders.ts:543-559](../src/lib/orders.ts#L543-L559) | Every queue read swallows errors → a PocketBase outage renders as a trustworthy "No orders waiting" empty state (zero-mock violation). | Surface load errors distinctly from empty. |
| PK-07 | Med | [products.ts:574-598](../src/lib/products.ts#L574-L598) | Bare-suffix scan resolution (`sku_suffix="..."` tenant-wide, arbitrary first hit) can auto-open the wrong order in the packing no-order flow; strict verification then passes on the wrong item. | Scope suffix to parent product or require full SKU/barcode at the station. |
| PK-08 | Med | [packing/page.tsx:904-908](../src/app/packing/page.tsx#L904-L908), [packing.ts:447-459](../src/lib/packing.ts#L447-L459) | "Records the override" claim is false — `completePackingSession` writes only status/completed_at/packed_by; the unscanned-lines override leaves no note/flag/audit. | Persist the override flag. |
| PK-09 | Low | [packing/page.tsx:211-231](../src/app/packing/page.tsx#L211-L231) | Deep link `/packing?order=` consumed even when `getOrderDetails` fails → silent blank station; `openOrder` never checks `PACKABLE_STATUSES` (a `draft` order can be packed via deep link). |
| PK-10 | Low | [packing.ts:476-484](../src/lib/packing.ts#L476-L484) | Queue counts load the entire `sales_order_items` table (no tenant filter, all order types) per refresh — full-table scan; isolation rests on collection rules. |
| PK-11 | Low | [packing/page.tsx:423](../src/app/packing/page.tsx#L423), [order-milestones.ts:144-152](../src/lib/order-milestones.ts#L144-L152) | Parcel photo WebP data-URL sent as `.jpg`/document with a "Live photo preview" claim (WA-15 sibling). |
| PK-12 | Low | src/app/packing (no layout/guard) | `/packing` has no page-level guard or capability check — any authenticated user incl. Viewer can pack and fire customer WhatsApp milestones (shipment creation itself is guarded). |
| PK-13 | Low | [packing.ts:436](../src/lib/packing.ts#L436) | `restartPacking` then abandon leaves the order in `packedAwaitingDispatch` while its newest session is editable (cosmetic state-machine branch). |
| PK-14 | Low | [test-packing.ts](../src/scripts/test-packing.ts) | Tests cover only 5 pure helpers; untested: scan resolution incl. suffix collisions, all session IO (race, lost-update), queue loading, page scan state machine, migration validity (where PK-01/02 live). |

Stock semantics verified: packing performs no reservation/deduction (stock committed at confirmation via `applyChannelStock` with rollback) — no double-deduct; the exposure is PK-03/PK-04 and orphaned sessions.

---

## 3. Flash-drop checkout (FD-01 … FD-12)

| ID | Sev | File:Line | Issue | Fix |
| :- | :-: | :--- | :--- | :--- |
| FD-01 | High | [flash-drop/route.ts:1012-1018,895-913,1052](../src/app/api/storefront/flash-drop/route.ts#L1012-L1018), [razorpay-webhook-handler.ts:124-151](../src/lib/razorpay-webhook-handler.ts#L124-L151) | **Double stock deduction race.** `handleOrderConfirmation` deducts via `applyChannelStock` *outside* the per-order settlement lock; the interleaved `payment.captured` webhook deducts again inside `settleCapturedOrder` → one paid sale deducts twice. The comment at route.ts:975-977 ("cannot deduct twice") is false — `applyChannelStock` has no ledger-reference idempotency. | Drop the route-level deduction and let settlement own it (as `storefront/order/route.ts:279` does), or wrap it in the same lock with a movement check. |
| FD-02 | High | [flash-drop/route.ts:1064-1079,255-276,375-379](../src/app/api/storefront/flash-drop/route.ts#L1064-L1079) | **Drop allocation cap silently voided after a sale.** Reservation is marked `completed` only in `handleOrderConfirmation`; webhook-settled orders leave the hold `active`→`expired`, so `liveHoldCount` stops counting the sold unit → it reappears in the pool → oversell beyond `allocatedStock` (or paid-but-out-of-stock refund path). Same if the hold expires while the Razorpay sheet is open (settlement never rechecks the cap). | Complete the reservation inside settlement; recheck `liveHoldCount < allocatedStock` at confirm. |
| FD-03 | Med | [flash-drop/route.ts:711-728,885-926](../src/app/api/storefront/flash-drop/route.ts#L711-L728), [orders.ts:682-716](../src/lib/orders.ts#L682-L716) | Cancelled orders remain payable and resurrect: duplicate `pay-intent` returns the live gateway order for any unpaid order regardless of `status:"cancelled"`, and confirm only checks `PAID` → a stale checkout completes payment after cancellation, flipping the order back to confirmed and re-deducting stock. | Refuse both paths for cancelled orders. |
| FD-04 | Med | [flash-drop/route.ts:840-850](../src/app/api/storefront/flash-drop/route.ts#L840-L850) | Swallowed `gateway_order_id` update failure (catch-all treated as unique-race) → order is payable but unconfirmable (409); only the webhook notes backstop rescues. Money in flight, silent partial state. | Re-read in the catch; fail the response if still empty. |
| FD-05 | Med | [flash-drop/route.ts:461-565](../src/app/api/storefront/flash-drop/route.ts#L461-L565), [whatsapp-flash-drops.ts:469-508](../src/lib/whatsapp-flash-drops.ts#L469-L508) | No phone verification (otp-store unused here, unlike storefront checkout) — one IP can lock 30 holds/10min across unlimited fake numbers, locking real buyers out and creating orders against unreachable numbers. | Require OTP at pay-intent or tighten per-IP hold caps. |
| FD-06 | Med | [FlashDropModal.tsx:156,172-174](../src/components/whatsapp/FlashDropModal.tsx#L156) | `stock_level 0 → 0 \|\| 5 → 5`: zero-stock variants get 5 units allocated; operator qty input unclamped → promised stock that doesn't exist; captured payments land in the manual-refund path. | Clamp to `variant.stock_level`, block 0. |
| FD-07 | Med | [flash-drop/route.ts:76-100,874-883](../src/app/api/storefront/flash-drop/route.ts#L76-L100) | In-memory rate limiting is per-process (Cloudflare deploys) and the `order` action's phone bucket is skipped when the caller omits `phone` — each call triggers an outbound Razorpay fetch. | Derive phone server-side before the limiter; shared store if multi-instance. |
| FD-08 | Low | [flash-drop/route.ts:192-206](../src/app/api/storefront/flash-drop/route.ts#L192-L206) | Public GET returns the operator's `accountEmail` (tenant login email) to anyone holding a dropId. | Omit from the public projection. |
| FD-09 | Low | [load.ts:56-63](../src/lib/analytics-v2/load.ts#L56-L63) | Flash-drop revenue mislabeled "Online (Razorpay)" — `orderChannel()` doesn't recognize `capture_source: "whatsapp_flash_drop"`. Dedupe is correct (no double count) — attribution loss only. |
| FD-10 | Low | [razorpay-webhook-handler.ts:210](../src/lib/razorpay-webhook-handler.ts#L210) | If `sendPaidOrderInvoice` throws (the one uncaught settlement step), the route returns 503 though the order is PAID; retry returns `duplicate:true`. Cosmetic. |
| FD-11 | Low | [1793001100_flash_drops.js:93-99](../pocketbase/pb_migrations/1793001100_flash_drops.js#L93-L99) | Reservation ledger `cascadeDelete`s with the drop — deleting a campaign erases completed-hold sales history. |
| FD-12 | Low | [flash-drop/route.ts:1066-1068](../src/app/api/storefront/flash-drop/route.ts#L1066-L1068) | Reservation completion keyed on the `ORD-FD-` prefix parse — brittle; FD-02's fix should not depend on it. |

Verified clean: no paid-without-payment path (POS-01/SF-02 class held); migration follows the correct PB-0.25 fields-after-save pattern; all filters sanitized/bound; ids validated; price computed server-side; amount verified ±1 paisa at confirm; UTC epoch math correct; replay check global-but-correct (unique partial index); no analytics mirror double-count.

---

## 4. Closure residuals (post-audit fix verification)

Crosswalk verdicts: **A-03, A-05, A-12, A-13, A-14 CLOSED-VERIFIED**. Still open: A-07 (below), A-22 (OTP half fixed; login `?next=` half never done — [AuthGate.tsx:26-27](../src/contexts/AuthContext.tsx#L26) emits it, [login/page.tsx:38](../src/app/login/page.tsx#L38) always pushes `/`).

| ID | Sev | File:Line | Issue | Fix |
| :- | :-: | :--- | :--- | :--- |
| F1 | High | [tenant-db-manager.ts:448](../src/lib/tenant-db-manager.ts#L448) | **A-07 STILL-OPEN on the dedicated-tenant branch:** `adminPassword: params.password` written in plaintext to `registry.json` even when `TENANT_REGISTRY_KEY` is configured — the encrypted `storedPassword` computed at :366 is used only in the primary branch (:384). | `adminPassword: storedPassword`. |
| F2 | Med | [tenant-db-manager.ts:81,425-433](../src/lib/tenant-db-manager.ts#L81) | A failed first provisioning bricks the account: owner marker written **before** bootstrap; on failure a husk directory remains and `tenantDatabaseExists` returns true for any directory → every retry hits "already exists — sign in" with no superuser to sign in as. | Require `data.db` in the existence check; remove the husk on bootstrap failure. |
| F3 | Med | [tenant-db-manager.ts:497-514](../src/lib/tenant-db-manager.ts#L497-L514) | `resolveTenantDatabase` re-registers an orphan on-disk tenant dir to any email whose slug matches, without consulting the owner marker → after registry loss `a_b@c.com` binds to `a.b@c.com`'s dataDir and boots their PocketBase. | Call `findTenantSlugOwner` before adopting an orphan dir. |
| F4 | Low | [tenant-db/route.ts:42-47,162-164](../src/app/api/system/tenant-db/route.ts#L42-L47) | Brand-new-tenant provisioning is unauthenticated when no setup token is configured; sole control is a spoofable-IP 5/10min limit. Accepted first-run design, but the token requirement never activates post-first-run. |
| F5 | Low | [rbac.ts:238-240,294-296](../src/lib/rbac.ts#L238) | Residual defense-in-depth: `setUserRoles` delete loop / `removeRole` lack `account_email`; role mutations never verify the target user belongs to the acting tenant; `getUsers` unbounded `getFullList`. |
| F6 | Low | [otp-store.ts:28](../src/lib/otp-store.ts#L28) | `Number(env \|\| 5)` yields `NaN` for non-numeric `OTP_DAILY_LIMIT`; `dayCount >= NaN` always false → daily cap silently disabled. | `Number.isFinite` fallback. |
| F7 | Low | [otp-store.ts:199-215](../src/lib/otp-store.ts#L199-L215) | Verify attempts use non-atomic read-then-write (small brute-force race); `ipAttempts` map never prunes (unbounded growth); `x-forwarded-for` spoofable absent trusted proxy (per-phone daily cap still holds). |
| F8 | Low | [eway/route.ts:118-158](../src/app/api/settings/eway/route.ts#L118) | No length/charset caps on clientId/username; key-rotation mismatch makes `decryptSecret` throw unhandled → 500; legacy `account_email=""` rows readable/claimable cross-tenant (documented shared-legacy policy). Closure otherwise solid (auth, capability gates, sanitizeFilter, secrets never returned). |

---

## 5. Legacy regression sweep — new defects (remediation siblings)

### 5a. Auth/Tenancy + POS/Billing/GST — 26/28 sampled IDs CLOSED

Half-applied fixes: **A-01** (client half fixed at [pocketbase.ts:160-168,589-595](../src/lib/pocketbase.ts#L160); **PB rules half not fixed** — [1792000200:17-21,32-36,58-62](../pocketbase/pb_migrations/1792000200_strict_tenant_isolation_and_auth_rules.js#L17) still `@request.auth.email` only → staff denied on every strict business collection); **A-07** (→ F1); **POS-07** (below). A-02 closed (unaliased-join escalation likely didn't reproduce; prescribed alias not applied — informational).

| ID | Sev | File:Line | Issue |
| :- | :-: | :--- | :--- |
| N-A1 | High | [pos/page.tsx:606-625,444-459,482-497](../src/app/pos/page.tsx#L606-L625) | **POS-07 half-applied:** barcode path populates jewelry fields but `addToCart` never copies them into `CartItem` and search/quick-add mappings never populate them → `sale_items` jewelry attributes always null on every path. |
| N-A2 | Med | [PhonePePayment.tsx:141-146,78-80,61](../src/components/pos/PhonePePayment.tsx#L141-L146) | Retry dead-end introduced by the POS-11 fix: decline sets `completedRef.current = true`; `handleRetry` resets status but not the ref → polling permanently skipped for the retried transaction until the modal is reopened. |
| N-A3 | Low | [tenant-db-manager.ts:497-514](../src/lib/tenant-db-manager.ts#L497-L514) | Slug-collision guard not applied on the resolve path (dup of F3). |
| N-A4 | Low | [storefront/content/route.ts:400-401](../src/app/api/storefront/content/route.ts#L400-L401) | POST interpolates `staffEmail` without `sanitizeFilter` (GET fixed) — server-derived value, hygiene only. |

### 5b. Inventory/Procurement + Orders/Returns/Shipping — all sampled Criticals CLOSED (ORD-11 partial)

ORD-11 partial: child `stock_movements`/`stock_discrepancies` creates in `approveCreditNote`/`processExchange` ([returns.ts:449-456,460-476,497-504,1113-1120](../src/lib/returns.ts#L449)) still omit `account_email` (browser-client `beforeSend` saves them; unstamped under server/superuser callers).

| ID | Sev | File:Line | Issue |
| :- | :-: | :--- | :--- |
| ✔ N-B1 | Crit | [storefront/order/route.ts:858](../src/app/api/storefront/order/route.ts#L858) | **Cross-tenant order hijack in the unique-race fallback** — on UNIQUE failure, `findExistingChannelOrder(client, txnId)` is called **without the tenant/phone args** used at :443. A verified buyer on tenant A submitting tenant B's order number as idempotency key gets B's order assigned and items written onto it (:892-905). Missed sibling of the ORD-01 fix. |
| N-B2 | Med | [sku-generator.ts:426-428,469-471](../src/lib/sku-generator.ts#L426-L428) | `account_email="${tenantEmail}"` interpolated without `sanitizeFilter`; empty-tenant fallback `getFirstListItem('key=...')` reads another tenant's taxonomies. |
| N-B3 | Med | [purchase.ts:1331-1339](../src/lib/purchase.ts#L1331-L1339) | `reconcilePOWithInwardBatch` fallback `getFirstListItem('po_number="X"')` with no tenant predicate — PO numbers aren't tenant-unique, and this function **writes** to the matched row. |
| N-B4 | Med | [eway-bill.ts:664-665](../src/lib/eway-bill.ts#L664-L665) | NIC API path sends `toPincode: 0` / `toPlace: ""` / `transDistance: 0` — the JSON exporter was made fail-closed (POS-15) but the API path still files an invalid destination. |
| N-B5 | Med | [orders.ts:643-650](../src/lib/orders.ts#L643-L650) | Exported `markSalesOrderShipped` flips any order to `shipped` with only a tenant check — remaining bypass of the ORD-08 canonical path (no callers in the UI, but still exported). |
| N-B6 | Low | [sequence-generator.ts:93-96](../src/lib/sequence-generator.ts#L93-L96) | Legacy sequence adoption reads an unscoped `name=` row → a new tenant's series seeds from another tenant's counter value. |
| N-B7 | Low | [orders/create/page.tsx:167](../src/app/orders/create/page.tsx#L167) | Hardcoded `tax_rate: 3` on manual order lines ignores `product.gst_rate` (same pattern POS-07/08 fixed elsewhere). |

Mechanism spot-checks PASS: order→packing→dispatch state machine, GRN/receiving math (reservation-first over-receipt guard + rollback), returns credit-note stock restore (`wasStockDeducted` evidence gate), e-way token cache, GSTR-1 period/B2B-B2C split (in 5d), challan transitions (no challan→invoice conversion flow exists).

### 5c. WhatsApp + Storefront/Payments — all 26 sampled IDs CLOSED, zero regressions

| ID | Sev | File:Line | Issue |
| :- | :-: | :--- | :--- |
| ✔ N-C1 | High | [whatsapp-catalog.ts:161-164,182-187,328,335](../src/lib/whatsapp-catalog.ts#L161-L164) | **Catalog identity columns don't exist; every write silently fails.** Code writes `whatsapp_catalog_id`/`whatsapp_last_synced` to `products`, but no migration adds these fields (verified across all migrations) → PB rejects unknown-field updates, writes swallowed by `.catch`. "Synced/unsynced" filter and stored-id matching are dead; drift-reconcile relies solely on SKU matching — a SKU change duplicates the catalog item. | 
| N-C2 | Med | [payment-reconciliation.ts:254-296](../src/lib/payment-reconciliation.ts#L254-L296) | Reconciler settles orders without amount verification: `settleLinkedOrder`→`settleCapturedOrder` never checks captured amount vs `order.total` (the webhook path does) → a desynced/undersized link amount settles the full order. |
| N-C3 | Low-Med | [storefront/order/route.ts:841](../src/app/api/storefront/order/route.ts#L841) | Unverified client-supplied `gateway_payment_id` at intake — stamping another order's payment id 409s the legitimate settlement via the global replay query (DoS) and pollutes the ledger. |
| N-C4 | Low | [flash-drop/route.ts:840-850](../src/app/api/storefront/flash-drop/route.ts#L840-L850), [order/route.ts:1035-1042](../src/app/api/storefront/order/route.ts#L1035-L1042) | Swallowed `gateway_order_id` update failures dead-end buyer confirmation (dup of FD-04's root pattern). |
| N-C5 | Low | [whatsapp-catalog.ts:135](../src/lib/whatsapp-catalog.ts#L135), [whatsapp-event-sync.ts:680](../src/lib/whatsapp-event-sync.ts#L680), [WhatsAppCatalogEditorModal.tsx:488,1135](../src/components/whatsapp/WhatsAppCatalogEditorModal.tsx#L488) | Hardcoded tenant-independent `https://luminila.com/product/<sku>` URLs — every tenant's buyers pointed at the vendor domain instead of their storefront binding. |
| N-C6 | Residual | [flash-drop/route.ts:186-189](../src/app/api/storefront/flash-drop/route.ts#L186-L189), [chat-inventory.ts:42-46](../src/lib/chat-inventory.ts#L42-L46) | Empty `account_email` rows treated as tenant-owned in multi-account mode — documented trade-off; notable multi-tenant. |

Spot-checks PASS: webhook signature fail-closed + per-tenant dedupe + amount/currency checks; sidecar dual-shape contract + boot-on-status token refresh; ingestion dedupe (unique index + tenant-scoped lookup); ghost-product reconcile matches by catalog id OR SKU (orphan-with-no-metadata residual noted); payment-link lifecycle created→paid only after side effects; chatId validated server-side.

### 5d. Finance + CRM + AI/System — all sampled IDs CLOSED, zero regressions

| ID | Sev | File:Line | Issue |
| :- | :-: | :--- | :--- |
| ✔ N-D1 | High | [customer-lookup.ts:228-236](../src/lib/customer-lookup.ts#L228-L236) | **`createCustomerFromChat` still creates `customers` rows without `account_email`** — the CRM-01 fix scoped every read, so WhatsApp-ingested leads are saved unowned and vanish from all tenant-scoped CRM reads (or are rejected by strict create rules). |
| ✔ N-D2 | High | [crm-lifecycle-triggers.ts:358-366](../src/lib/crm-lifecycle-triggers.ts#L358-L366) | `dispatchCustomRecipientsMessages` creates `broadcast_messages` without `account_email` (sibling at :302 stamps it) — under tenant create rules nothing queues; if saved, invisible to `withTenantFilter` reads and `sentTodayCount` (quota bypass). Its "zero dedup" sub-clause (CRM-09) also remains. |
| N-D3 | Med | [whatsapp-broadcast.ts:284-299](../src/lib/whatsapp-broadcast.ts#L284-L299) | `resolveCustomRecipients` checks `whatsapp_opt_out` + STOP but **not `opt_in_marketing === false`** — hand-picked RFM cohorts bypass the CRM-10 marketing opt-in gate that `resolveAudienceDetailed` enforces. |
| N-D4 | Med | [customers.ts:153-182](../src/lib/customers.ts#L153-L182) | `updateCustomer`/`deleteCustomer` by-id writes with **no ownership verification** — the compensating get-one-check pattern applied in `expenses.ts`/`banking.ts` was not replicated here. |
| N-D5 | Med | [customer-lookup.ts:251-269](../src/lib/customer-lookup.ts#L251-L269) | `getCustomerOrders` queries `sales` with unsanitized `customer="${customerId}"` and no `account_email` filter — the last unscoped customer-adjacent read after the CRM-01 fix. |
| N-D6 | Low | [customers.ts:497-505](../src/lib/customers.ts#L497-L505) | `getCustomerSummary` bare `getOne` without the in-memory ownership check `getCustomer` applies. |
| N-D7 | Low | [reports.ts:784](../src/lib/reports.ts#L784) | FIN-23 residual: `printReport` escapes `<title>` but still interpolates unescaped `${title}` into `<h2>`; `element.innerHTML` injection pre-existing print design. |

Spot-checks PASS: GSTR-1 period math + B2B/B2C split; cheque FSM + money posting inside serialized RMW; backup restore (31 tables, FK-ordered, tenant/foreign-id refusal); consent gating of broadcasts (audience path); AI harness cross-tenant leak — NONE found (session-derived tenant only, every tool filter scoped, RBAC-gated).

---

## 6. Runtime verification (2026-11-03, HEAD `2d574b8`)

| Check | Verdict | Detail |
| :--- | :--- | :--- |
| `npm run typecheck` | ✅ PASS | `tsc --noEmit --incremental false`, zero errors. |
| `npm run lint` | ❌ **BROKEN** | Config error: `Rule "react/no-unescaped-entities" … could not find plugin "react"` — ESLint 9 exits before linting any file. CI's lint step (`ci.yml:19-33`) would fail. **RT-4 (tooling, High).** |
| `npm test` (27-suite chain) | ❌ **RED** — 22 pass · 3 fail · 2 not-runnable | Chain `&&`-aborts at suite 1; remaining suites run individually (results below). **`npm test` has not been green since at least the POS-05/POS-10 remediation** — the previous closure record (`docs/bugfix_progress.md:298-303`) verified typecheck + migrations but never ran the test chain. |

**RT-1 (High, statutory) — `test-invoice-math` FAILS:** `intra-state splits into two equal halves without losing a paise` → `9710 !== 9709`. The POS-05 fix (`cgst = Math.round(base/2); sgst = cgst`, [invoice-math.ts:112-113](../src/lib/invoice-math.ts#L112-L113)) preserves CGST=SGST but **2×round(base/2) ≠ base whenever baseTax in paise is odd** — an odd-paise bill's stated tax shifts by one paisa, the exact GSTN-mismatch class POS-05 was meant to close. Runtime proof the fix is incomplete.

**RT-2 (Medium, same root) — `test-channel-orders` 19/21:** inclusive-tax pennies off by one: `inclusive tax of 1000 at 3%` expected 29.13, received 29.12; `discounted base` expected 26.21, received 26.2 (`computeChannelTax`). Same rounding-family regression as RT-1.

**RT-3 (Medium) — `test-offline-queue` 5/6:** `enqueue persists a create with its payload` — stored mutation now carries `account_email: 'niththigal@gmail.com'` but the test's expected payload does not. The POS-10 fix ([offline-queue.ts:71-73](../src/lib/offline-queue.ts#L71-L73)) stamps the payload at enqueue without updating the test — fix-vs-test drift; the chain is red either way.

**Not runnable (environmental, not code failures):** `test-roadmap-capture` and `test-capture-invariants` require PocketBase on `:8091` (capture-invariants also the dev server on `:3000` + `.env.local` secrets) — both exit `ECONNREFUSED 127.0.0.1:8091` with no server running. Per project convention these are run against a throwaway database, never the live one; they were excluded from this audit's runtime pass.

**Passing suites (22):** returns-policy, tenant-auth, gstr1-period, returns-qc, manufacturing, cheque-register, cross-border, backup, valuation, imitation, rate-limit, customer-token, whatsapp-secret, webhook-dedupe, tenant-runtime, tenant-secrets, gstin, pos-quantity, gateway-signature, quick-add-memory, packing, analytics. (`test:ai` is a separate script and was not part of this run.)

> Net runtime verdict: **typecheck green; lint and the test suite red** — the remediation record's "all 214 fixed" claim is not supported by current runtime evidence. RT-1/RT-2/RT-3 should be treated as priority fixes alongside the §Totals findings.
