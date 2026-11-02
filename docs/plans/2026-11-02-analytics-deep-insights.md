# Analytics Deep-Insights Build — Implementation Plan

> **Date:** 2026-11-02
> **Status:** Approved (brainstorm 2026-11-02)
> **Branch:** dedicated feature branch (analytics work must not mix with packing WIP)

## Context

The dashboard analytics today are thin: `src/app/page.tsx` shows 4 KPI cards + one 30-day revenue chart, **hardcoded 30-day window**, POS-only top products, and no turnover, margin, category, or inventory-health analytics anywhere. The goal is deep business insights — sales performance, inventory/stock turnover, category turnover, profitability — surfaced through an Insights engine that actively flags areas to improve (dead stock, margin erosion, reorder/overstock signals).

**Critical data issues found during exploration that this build must fix first** (otherwise every new number is wrong):

1. **Double-counting**: storefront orders write BOTH a `sales_orders` row AND a mirror `sales` row (`channel='storefront'`, status `pending`) → `analytics.ts:138` sums both. Unpaid Razorpay mirrors also inflate revenue.
2. **No cost snapshot at sale time** → COGS/margin/GMROI impossible for past sales; only current `products.cost_price` exists.
3. **Staff logins see an empty dashboard** — `analytics.ts:91` uses `pb.authStore.model?.email` instead of `accountScopeEmail()` (`src/lib/pocketbase.ts:137`).
4. **`reports.ts` queries lack explicit `account_email` filters** (violates tenant-dual-layer memory rule) and shows raw category IDs.
5. **Low stock uses hardcoded `<10`** instead of per-variant `low_stock_threshold`.

## Decisions (from brainstorm session 2026-11-02)

| Decision | Choice |
|---|---|
| Feature packs | **All four**: Sales & Customer, Inventory & Turnover, Categories, Profitability + Insights tab |
| Time control | Range presets (7d/30d/90d/12m/custom) + period-over-period compare |
| Performance | **All three layers**: client-side windowed + API-route aggregation + precomputed daily snapshots |
| Insights | Insights tab with ranked, ₹-impact findings (no notifications this build) |
| Build order | All packs in one build |
| Adjacent bugs | Fix in this build (staff email, reports.ts tenant filters, low-stock thresholds) |
| Exports | CSV + Excel on analytics tables |
| Cost basis *(default, round-1 unanswered)* | Snapshot `unit_cost` going forward + landed-cost backfill for history |
| Revenue truth *(default)* | Dedupe mirror rows in analytics layer (no write-path surgery) |
| Turnover family *(default)* | GMROI-centric suite at overall/category/product level |
| Placement *(default)* | Dedicated `/analytics` hub + light home dashboard |

## Step 0 — Data Foundations (before any UI)

### 0.1 Revenue truth engine (`src/lib/analytics-v2/range.ts` + `sales-metrics.ts`)
- `AnalyticsRange` type: presets `7d | 30d | 90d | 12m | custom(start,end)` + computed `previousWindow` for compare. Pure functions, unit-testable.
- **Dedupe rule**: unified revenue = Σ `sales.total` where `channel != 'storefront'` (mirror exclusion) **+** Σ `sales_orders.total` where `status ∈ {confirmed, shipped, delivered, invoiced}` (storefront counted once here; Razorpay unpaid stays excluded via status). Business date: `sales_orders.order_date || created`.
- Channel attribution for sales_orders via `capture_source`/`gateway` (storefront / whatsapp / b2b) instead of today's single "B2B / Online" bucket (`analytics.ts:330`).

### 0.2 Cost snapshot migration + write paths
- New PB migration `pocketbase/pb_migrations/1793001000_add_unit_cost_snapshots.js`: adds `unit_cost` (number, optional) to `sale_items` and `sales_order_items`; also creates `analytics_daily_snapshots` collection. Declare `created`/`updated` autodate fields explicitly (memory rule).
- Snapshot at sale time from landed-cost map (fallback `products.cost_price`):
  - `src/lib/pos-sales.ts` `createPOSSale` (sale_items)
  - `src/app/api/storefront/order/route.ts` (sales_order_items)
  - `src/lib/orders.ts` `createOrder` (sales_order_items)
- Backfill script `src/scripts/backfill-unit-costs.ts`: for historical items, compute via `buildLandedCostMap()` (`src/lib/reports.ts:333`), write `unit_cost`. Dry-run mode + stats output.

### 0.3 Tenant & bug fixes
- All analytics-v2 modules call `accountScopeEmail()` — never `pb.authStore.model?.email`.
- `src/lib/reports.ts`: add explicit `account_email` filters to every query; resolve category **names** (via `getCategoryTree()` map from `src/lib/categories.ts`) instead of raw relation IDs (`reports.ts:416`).
- Low-stock: honor `variant.low_stock_threshold` (fallback 10 when unset).
- Fix `getTopProducts` (`analytics.ts:259`) to **union** `sale_items` + `sales_order_items` using the 25-ID chunked expand pattern from `fetchInvoiceItemsForInvoices()` (`reports.ts:441`).

### 0.4 Layered performance architecture
- **Layer 1 (default)**: client-side windowed fetches — date-filtered `getFullList` + chunked expansion.
- **Layer 2 (heavy scans)**: Next.js API routes `src/app/api/analytics/[report]/route.ts` for ledger-wide scans (turnover suite, aging, 12m category rollup). Server PB client from forwarded auth token, tenant re-derived server-side.
- **Layer 3 (long-range)**: `analytics_daily_snapshots` PB collection (day, account_email, category, revenue, units, cogs, stock_value, orders). Incremental writes + rebuild via `src/scripts/rebuild-analytics-snapshots.ts`; seasonality/12m/mix-shift views read snapshots.

## Step 1 — Metric Engines (`src/lib/analytics-v2/`)

**Formulas (documented in code headers):**
- COGS = Σ line `quantity × unit_cost` (snapshot; backfilled estimate for history)
- Gross margin = revenue − COGS (item-level; order-level discounts allocated pro-rata)
- Avg inventory value ≈ (stock value at window start + end) / 2 — start reconstructed from current landed-cost stock value minus net `stock_movements` in window
- Inventory turnover = COGS / avg inventory value (annualized ×365/days); Days of inventory = days / turnover
- **GMROI** = gross margin ₹ / avg inventory cost ₹ — overall, category, product level
- Weeks of cover = stock units / avg weekly units sold; Sell-through % = units sold / units available (start stock + receipts)
- Aging buckets: days-since-last-sale per product: 0–30 / 31–60 / 61–90 / 91–180 / 180+ with ₹ locked per bucket

| Module | Contents |
|---|---|
| `range.ts` | window math, presets, compare windows |
| `sales-metrics.ts` | unified deduped revenue, trend series (auto day/week/month granularity), channel table, payment mix, weekday×hour heatmap, new-vs-returning split, repeat rate, AOV — each returning `{current, previous, deltaPct}` |
| `turnover.ts` | COGS, avg inventory, turnover/GMROI suite (overall/category/product), sell-through, weeks of cover, dead-stock aging, fast-vs-slow quadrant data |
| `category-metrics.ts` | category rollups (revenue/units/margin/turnover/GMROI), hierarchical parent rollups, mix-shift series, price-band performance, purity-wise split, making-charge recovery % |
| `profitability.ts` | margin by product/category/channel, top-profit vs top-revenue contributors, discount erosion, expenses-vs-revenue overlay (reuses `getExpenseStats` `src/lib/expenses.ts:389`) |
| `insights.ts` | rule engine → ranked insight cards `{severity, title, impactINR, evidenceQuery}` |
| `snapshots.ts` | daily snapshot read/write/rebuild |

**Reuse (do not rebuild):** `buildLandedCostMap()` + `allocateLandedCosts`/`weightedAverageCost` (`src/lib/valuation.ts`), `computeRFMAnalysis()` (`src/lib/crm-rfm.ts:81`), `getCategoryTree()`/`flattenCategories()` (`src/lib/categories.ts`), `formatINR()` (`src/lib/gst.ts:254`), `exportToCSV` pattern (`src/lib/reports.ts`), exceljs. Recharts 3.6 everywhere — remember the `[key: string]: string | number` index-signature quirk on chart row interfaces (`analytics.ts:50`).

## Step 2 — `/analytics` Hub UI

**Route** `src/app/analytics/page.tsx` (guard: `resource="reports" action="read"`), tabs → themed dropdown on narrow viewports (memory rule):

1. **Sales** — KPI strip with deltas (revenue, orders, AOV, units, margin), revenue trend w/ previous-period overlay, channel performance table+bars, payment mix, weekday×hour heatmap, new-vs-returning, RFM cohort table.
2. **Inventory & Turnover** — overall turnover/days/GMROI/stock-value KPIs, category + product turnover tables (sortable), dead-stock aging (buckets + ₹ + drill list), fast-vs-slow quadrant scatter, sell-through, weeks-of-cover overstock list.
3. **Categories** — leaderboard table + Recharts Treemap, drill-down via category tree, revenue mix-shift stacked area (from snapshots), price-band performance, purity split, making-charge recovery.
4. **Profitability** — margin trend w/ compare, margin by category/channel/product, top-profit vs top-revenue side-by-side, discount erosion, expenses overlay.
5. **Insights** — ranked actionable cards with ₹ impact: dead stock >180d, category margin drop vs previous period, reorder (cover < 2 wks + velocity), overstock (cover > 12 wks), fast-movers at zero stock, discount erosion warning, channel shift anomalies. Each card deep-links to the relevant tab/table. No notifications this build.

**Components** in `src/components/analytics/`: `RangeHeader` (presets + custom + compare toggle — zustand), `KpiStrip`, chart wrappers, `DataTable` (sortable + CSV/Excel export buttons), `InsightCard`, empty states per zero-mock rule.

**Home dashboard** (`src/app/page.tsx`) stays light: deduped numbers, honor thresholds, honor `accountScopeEmail`, add AOV + margin KPI cards, "Open full analytics" link.

**Sidebar**: add "Analytics" entry (`src/components/layout/Sidebar.tsx`).

**Exports**: CSV via existing pattern, Excel via exceljs, print-friendly summary — on every tab's tables.

## Step 3 — Verification

1. `npm run build` + dev server (`npm run dev`) with local PB running.
2. **Sanity script** `src/scripts/test-analytics.ts`: asserts dedupe (storefront order counts exactly once), turnover math on synthetic fixtures, range-window math.
3. Manual cross-checks: dashboard 30d revenue == POS daily summary + confirmed orders; storefront COD order appears once; Razorpay unpaid excluded; staff login shows data; empty tenant renders empty states (zero-mock).
4. Backfill script dry-run on real data → review stats → apply → spot-check COGS vs `getStockReport` landed values.
5. Snapshot rebuild → mix-shift chart populates for 12m range.
6. Visual pass on all 5 tabs at desktop + narrow width (tab bar collapses to dropdown).

## Deliverables Summary

- ~6 new lib modules, 1 API route group, 5-tab analytics hub, 2 PB migrations (unit_cost + snapshots), 3 scripts (backfill, snapshot rebuild, sanity), fixes to analytics.ts/reports.ts/pos-sales.ts/orders.ts/storefront route, sidebar + light home dashboard refresh.
- All numbers tenant-scoped, deduped, cost-backed, exportable, driven by an actionable Insights engine.
