# INV Agent Report — INV-07 … INV-25

Scope: audit section 3 (Inventory / Products / Labels / Purchase / Vendors), excluding INV-01…INV-06 (already fixed in Phase 4).

| ID | Status | Files changed | Evidence |
| :-- | :-- | :-- | :-- |
| **INV-07** | Fixed | `src/lib/discrepancies.ts`, `src/components/inventory/DiscrepancyModal.tsx` | `resolveStockDiscrepancy` computes `remainingQty`; only a zero remainder sets `status="resolved"`/`resolved_at`/`resolution_action`, otherwise it persists `quantity: remainingQty` and leaves the flag active. Orphaned variant fallback now resolves `products.sku` → `product_variants` (tenant-scoped) instead of querying the non-existent variant `sku` column. Modal toasts distinguish full vs partial resolution. |
| **INV-08** | Fixed | `src/lib/manufacturing-jobs.ts` | `settingsFilter()` adds `account_email = "<tenant>"` to both `readJobs` and `writeJobs` lookups; new `store_settings` rows are created with `account_email: getCurrentTenantEmail()`. |
| **INV-09** | Fixed | `src/lib/manufacturing-engine.ts` | `reconcileMetalBalance` and `validateManufacturingOrder` now sum `netWeightGrams × quantityProduced`; assembly cost allocation weights lines by `grossWeightGrams × quantityProduced` before computing each unit cost. |
| **INV-10** | Fixed | `src/lib/multi-location.ts`, `src/components/inventory/StockTransferModal.tsx` | `adjustLocationStock` seeds the default location from live variant stock (or an explicit `globalStock`) before applying the delta and moves the outgoing quantity to a non-default source, instead of starting at 0. The modal resolves scanned SKUs/barcodes via `resolvePOSBarcodeVariant` and uses real product/variant ids (no `prod_${Date.now()}`). |
| **INV-11** | Fixed | `src/lib/barcode-generator.ts` | `generateDumbbellLabelHTML` `alt` and both text nodes in `generateSmallLabelHTML` are wrapped in `escapeHtml()`. |
| **INV-12** | Fixed | `src/lib/products.ts`, `src/lib/excel-import.ts` | `getTypeAheadProducts` builds its filter from `sanitizeFilter(query)`; `commitBulkInventoryImport` sanitizes `po_number` before interpolation. `searchVendors` was already sanitized (verified). |
| **INV-13** | Fixed | `src/lib/excel-import.ts` | `getColIndex` first looks for exact normalized-header equality across all keywords, then falls back to `.includes()`, so `price` no longer claims "Cost Price" and `weight` no longer claims "Net Weight". |
| **INV-14** | Fixed | `src/lib/image-matcher.ts` | `findMatchingProducts` filters `is_active = true && (image_url != "" \|\| image_data != "")` plus the tenant clause, so base64-only photos are matched and other tenants' rows are excluded. |
| **INV-15** | Fixed | `src/app/api/catalog/batch/route.ts`, `src/app/api/catalog/image/route.ts` | Batch by-id product query now requires `is_active = true` (variants query already had both filters). Image route resolves the product through a filtered `getFirstListItem` (`id && is_active && tenant`, keeping legacy empty-`account_email` rows) instead of an unfiltered `getOne`. |
| **INV-16** | Fixed | `src/lib/sku-generator.ts` | `computeNextSkuSequence` adds `account_email = "<tenant>"` to the `sku ~ …` query. |
| **INV-17** | Fixed | `src/components/inventory/DiscrepancyModal.tsx` | Removed the three hardcoded vendor `<option>`s; the list is rendered solely from `getVendors()` (already loaded on open). |
| **INV-18** | Fixed | `src/app/labels/page.tsx`, `src/components/inventory/QuickAddProductDialog.tsx` | Both `luminila_products` reads use `getTenantStorageKey(...)`; the Quick Add expanded-form flag reads/writes `getTenantStorageKey("luminila_quick_add_full_form")`. |
| **INV-19** | Fixed | `src/app/labels/page.tsx` | `handleLabelChannelChange` reprices `selectedProducts` from the catalog row by SKU (not just `availableProducts`), and the URL effect reads `qty` (clamped to ≥ 1) instead of hardcoding `quantity: 1`. |
| **INV-20** | Fixed | `src/lib/csv.ts` | `parseCSVLine` handles RFC 4180 `""` escapes and no longer post-strips quotes; both exporters wrap every string column in `escapeCSVField`. Fixed `escapeCSVField`'s `@-|` character *range* to `[=+@\|\t\r-]` — the range form prefixed most uppercase fields with `'` and would have corrupted every newly-escaped column. Verified with `tsx` smoke tests (parse + export). |
| **INV-21** | Fixed | `src/lib/manufacturing-jobs.ts` | `netProductionCost = Math.max(0, round(grossProductionCost - scrapCredit))`. |
| **INV-22** | Fixed (no-op) | none (inspected `src/lib/valuation.ts`) | `getInventoryValuation` / `getLowStockProducts` no longer exist anywhere in `src` (verified by search); the module is pure landed-cost math with no PocketBase reads. |
| **INV-23** | Fixed (no-op) | none (inspected `src/app/purchase/create/page.tsx`) | `loadProductCatalog` is gone; `loadProducts` uses tenant-scoped `listVariantsWithProduct()` (`getFullList` + `product.is_active`), so there is no `getList(1, 100)` truncation or missing tenant filter. |
| **INV-24** | Fixed | `src/app/vendors/detail/page.tsx` | Variant selection defaults the vendor price field to `product.cost_price \|\| product.base_price`; the expanded product mapping now carries both fields. |
| **INV-25** | Fixed | `src/components/vendor/VendorForm.tsx` | `alert()` calls replaced with `toast.error()`; a `useEffect` keyed on `vendor` re-syncs `formData` when the prop changes. |

## Verification

- `npx tsc --noEmit --incremental false` — **no errors in any file owned by this agent**.
  Exit code 2 comes entirely from files owned by parallel agents, which changed between runs (the tree is in flux): `src/app/api/storefront/flash-drop/route.ts`, `src/app/api/storefront/order/route.ts`, `src/app/orders/create/page.tsx`, `src/lib/whatsapp-flash-drops.ts`, `src/lib/returns.ts`.
- `npx eslint <changed files>` — 0 errors, only pre-existing `no-explicit-any` / unused-import / exhaustive-deps warnings.
- `npx tsx src/scripts/test-manufacturing.ts` — 7/7 pass.
- `npx tsx src/scripts/test-valuation.ts` — 10/10 pass.
- Ad-hoc `tsx` checks: `parseCSV` turns `"He said, ""hi"""` into `He said, "hi"`; `exportProductsToCSV` quotes/doubles correctly and neutralises `=CMD`; `parseInventoryImportFile` maps a sheet with "Cost Price" before "Selling Price" to `cost_price=700, base_price=1000` and "Net/Gross Weight (g)" to `5.5/6.5`.
- `npm test` does not include `src/scripts/test-manufacturing-engine.ts` (it is orphaned; see residual).

## Residual / notes

1. **INV-07 concurrency:** a *partial* resolve keeps `status="active"`, so the collection's active-only update guard cannot serialise two simultaneous partial resolves. Two operators resolving the same flag at the same moment could both credit stock. A full resolve still uses the status transition as the claim and is safe. Closing this would need a schema-level `resolved_quantity` field + a rule, or a server transaction.
2. **INV-10 POS seed:** `pos-sales.ts` (owned by another agent) decrements PocketBase stock *before* calling `adjustLocationStock`, so when a POS sale is the first movement for an item the seed reads post-sale stock and the location ledger under-counts by the sold quantity. Transfers (the audited path) are correct because the DB stock is untouched until receipt. Passing the pre-sale stock as the new optional fifth argument from `pos-sales.ts` would make POS exact; that file is outside this agent's scope.
3. **INV-09 domain semantics:** weights are now treated as per-unit (consistent with `stockAdjustments` returning `quantity` and per-piece `grossWeight`). The orphaned script `src/scripts/test-manufacturing-engine.ts` has fixtures that encode per-line totals and would fail if run; it is not part of `npm test` and is outside this agent's write scope.
4. **INV-15 legacy rows:** the catalog image route keeps `account_email = ""` rows readable (same rule as `api-auth.ts`) so pre-INV-01 products keep their images; stamped rows of other tenants are excluded.
5. **Observation (not an assigned finding):** `getProducts()` in `src/lib/products.ts` still scopes by raw `pb.authStore.model.email` rather than `accountScopeEmail()`, so a staff login would see no catalog. Left untouched to keep this pass surgical; flag for a follow-up.
6. No migrations were needed.
