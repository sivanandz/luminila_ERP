---
type: project
created: 2026-07-18
updated: 2026-10-30
---

# Technical Decisions

- Component metadata uses SemVer while the toolkit release keeps CalVer.
- `manifest.json` and `manifest.lock.json` must remain synchronized with component frontmatter.

## Quick Add Series Memory (2026-10-30)

- The Quick Add dialog (`QuickAddProductDialog`) is the single rapid piece-by-piece entry path and runs the full SKU taxonomy engine (`sku-generator.ts`); the full Add Product dialog keeps its own SKU Architect untouched.
- Series identity for the memory stack (`quick-add-memory.ts`) deliberately EXCLUDES the colour code — colour is the per-piece level, so a colour-run upserts one series entry instead of stacking chips. Entries also carry commercial fields (cost, channel overrides, HSN, location, stock, craft/plating/occasion/base metal).
- Memory persists to PocketBase `store_settings` key `quick_add_memory` (category `quick_add`, `account_email`-scoped) with a tenant-scoped localStorage cache (`luminila_quick_add_memory_v1_<email>`) hydrated synchronously at module init — same hybrid pattern as `jewelry_sku_taxonomies`.
- "Clone a piece" recovers taxonomy codes by parsing architecture SKUs (`TMPNECCHK04821-MGRBSTD-C12` → genre/cat/subcat/plating/colour/size/packaging); non-architecture SKUs fall back to category-label matching.
- Keyboard: `Alt+N` opens Quick add (`use-inventory-shortcuts.ts`); inside the dialog `Enter` = save & add another, `Ctrl/Cmd+Enter` = save draft & close.

## Packing & Dispatch Station (2026-11-02)

- `/packing` is a POS-style two-pane station: queue of confirmed/invoiced `sales_orders` joined with `order_packing` sessions (`packing.ts`). No new order status was added — "packed awaiting dispatch" is derived from completed sessions, not a status value.
- Packing state lives in the `order_packing` PB collection (migration `1793000000`): one row per order, `packed_items` json array `{item_id, variant_id, product_id, sku, packed_qty, quantity, scanned_at}`, `order_id` is TEXT not a relation (same convention as `shipments`), strict `account_email` rules.
- Scan grammar (`matchResolvedToLine`, pure + tested): variant-id match is strict (channel orders always carry an explicit variant); a product-level tag only matches when exactly one line carries that product, else `ambiguous`. A full line re-scan = `already_complete`, not an over-pack (`incrementPackedItem` is a no-op at cap).
- Cross-order guard: a stray piece scan resolves the variant and looks up which queued orders contain it via `sales_order_items.variant`, then the error toast NAMES the owning order (`findOpenOrdersForVariant`).
- Packing slips carry Code128 of the exact `order_number` (bwip-js, same endpoint as the shipping label); the station queue resolves a slip scan before item scans so a SKU can never hijack slip entry (`findOrderBySlipScan` first).
- Scanner: new `packing_station` context at priority 80 (yields to `shipping_awb` 100 / `active_modal` 90); Tauri native formats list now includes `DataMatrix` (jewelry tags default to ECC200 — without it the native scanner ignored the most common tag).
- Completion chain: chime (`soundEffects.playConfirmationChime`, first caller) → optional parcel photo → `dispatchOrderMilestoneWhatsApp({milestone:'packed'})` → session completed → one-tap handoff to `BarcodeScanDispatchModal` preselected.

### PocketBase traps found during the live packing test (2026-11-02)

- **Programmatic collection migrations must declare the `created`/`updated` system fields explicitly.** A `new Collection({ fields: [...] })` without `{ name: "created", type: "autodate", onCreate: true }` / `{ name: "updated", type: "autodate", onCreate: true, onUpdate: true }` produces a collection where any `sort=-created` / `sort=-updated` query returns **400 "Something went wrong while processing your request."** — and every sorted read silently fails. Migration `1793000001_add_order_packing_system_dates.js` is the corrective example; text/wildcard sorts still work, which makes it look like a partially-healthy collection.
- **PocketBase returns relation fields as record-id strings with expanded records under `expand`.** `OrderDetailItem.variant` is typed as `ProductVariant` in `orders.ts`, but at runtime it is the id string and the object lives at `item.expand.variant`. Any code reading `item.variant?.size` / `item.variant?.sku_suffix` must handle both shapes (see `buildPackingLines` in `packing.ts`). The order-detail page (`orders/detail/page.tsx:337-339`) currently reads it as an object and shows blank variant attributes.
- Packed orders re-open read-only from the "awaiting dispatch" bucket (`getLatestSessionForOrder`); "Restart packing" is the explicit fresh-pass action.

### Analytics Deep-Insights architecture (2026-11-02, branch feat/analytics-deep-insights)

- **Revenue truth rule (analytics-v2/load.ts):** storefront orders exist TWICE (a sales_orders row + a mirror sales row with channel='storefront'). All revenue math MUST use the canonical rule: sum sales.total where channel != 'storefront' + sales_orders.total where status in confirmed/shipped/delivered/invoiced, business date order_date || created. Never sum the sales collection unfiltered again.
- **Cost snapshots:** unit_cost column on sale_items/sales_order_items (migration 1793001000) written at sale time via resolveUnitCostMap (src/lib/item-cost.ts, landed-cost then products.cost_price fallback, per-sale variant-scoped queries). Historical rows backfilled by npm run analytics:backfill-costs (dry-run default). Missing cost = 0 means UNKNOWN, never silent zero-margin.
- **Engines:** src/lib/analytics-v2/ (range/load/sales-metrics/turnover/category-metrics/profitability/insights/snapshots) - pure aggregation over canonical lines; heavy ledger scans re-runnable server-side via /api/analytics/turnover (engines accept {db, tenant} overrides). GMROI = margin INR / avg inventory INR; avg inventory = (start+end)/2 with start reconstructed from current stock value minus net window movements (current unit cost prices history - documented approximation).
- **Snapshots:** analytics_daily_snapshots (day x category rollups) rebuilt by npm run analytics:rebuild-snapshots for 12m/mix-shift views; UI falls back to live computation when empty.
- **Tenant rule:** every analytics query filters account_email explicitly via accountScopeEmail() (NOT pb.authStore.model?.email - staff logins saw an empty dashboard before this fix); reports.ts queries all carry explicit tenant filters now.
- **Range semantics (range.ts):** presets yield exactly N local day keys ending today; custom date-only or UTC-midnight bounds are PICKED CALENDAR DATES resolved to local day boundaries (end inclusive via +1 day). inWindow is start-inclusive, end-exclusive on the resolved instant.
- **UI:** /analytics hub (5 tabs: Sales / Inventory & Turnover / Categories / Profitability / Insights); tab bar collapses to a Select dropdown on narrow viewports; useSearchParams requires a Suspense shell on the page. Zero-mock: every empty dataset renders an empty state, insights fire only on data conditions.
