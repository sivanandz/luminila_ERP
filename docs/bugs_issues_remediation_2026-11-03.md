# Remediation — Audit 2026-11-03

Follow-up to [bugs_issues_audit_2026-11-03.md](bugs_issues_audit_2026-11-03.md). Fixes applied directly at HEAD `2d574b8` (working tree; **nothing committed** — the Mimosa commit gate blocks commits and no commit was requested).

## Verification (current tree)

| Check | Result |
| :--- | :--- |
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ **0 errors** (351 warnings) — was previously *unable to run* (dead plugin rules); 13 unescaped-entity errors fixed; nested build outputs + `storefront/**` + draft migrations ignored |
| `npm test` (27 suites, run individually) | ✅ **25 pass** · ⏳ 2 not runnable (`test-roadmap-capture`, `test-capture-invariants` — require PB `:8091`; capture-invariants also dev `:3000`; ECONNREFUSED, no code failure) |
| Migration syntax (`node --check`) | ✅ packing rewrite + 2 new migrations parse |

Previously-red suites now green: `test-invoice-math` (RT-1), `test-channel-orders` (RT-2), `test-offline-queue` (RT-3).

## Fixed

### Tooling / runtime
| ID | Fix |
| :- | :--- |
| RT-1 | `invoice-math.ts` restored exact GST back-compute (`taxable = round(total×100/(100+rate))`, `tax = total − taxable`) with CGST/SGST floor/ceil (±1 paisa, what GSTN and the repo's own spec accept). The "force even halves" remediation was losing a paisa on odd-paise bills. |
| RT-2 | Same fix covers `computeChannelTax` penny drift. |
| RT-3 | `test-offline-queue` now asserts the intended POS-10 enqueue stamp (`account_email` non-empty + payload fields). |
| RT-4 | `eslint.config.mjs`: removed two rule references whose plugins were never installed (lint could not start), completed ignore list (`server-dist/**`, `storefront/**`, `storefront/.next/**`, `storefront_example/**`, `pb-check.cjs`, `docs/migrations-draft/**`), fixed 13 unescaped JSX entities. |

### Analytics (AN)
AN-01 (WhatsApp mirror excluded: `channel="whatsapp" && channel_order_id != ""` in loader + history probe), AN-02 (`pbBound` PB space-datetime bounds everywhere; also expenses + turnover movements), AN-03 (CSV regex), AN-04 (discount allocation from stored `tx.discount`, previous window allocated too, new `discount-allocation.ts`, O(n) map), AN-05 (distinct-customer split), AN-06 (monthly overlay index alignment), AN-07 (local day keys), AN-08 (`status!="cancelled"` sales guard), AN-10 (`reports:read` on turnover API), AN-11 (category startStockValue defaults to current), AN-12 (`costFallback` + `costEstimatedUnits`, warning shows both counts), AN-13 (turnover uses shared allocation → same margin as Profitability), AN-14 (clamp ≥0 + documented exclusions), AN-15 (snapshot orders written once/day, reader takes max), AN-16 (upsert-then-delete rebuild, successes counted), AN-17 (backfill includes `unit_cost=0`), AN-18 (migration dual-identity rule + self-healing field loop), AN-20 (DataTable numeric/text/null sorting, CSV nulls), AN-22 (mobile drawer `/analytics` + `/packing`), AN-23 (empty state gated on order count), AN-25 (erosion delta in points), AN-26 (exclusive expense end bound), AN-27 (documented), AN-28 (sanitizeFilter + dead code removed), AN-29 (?tab= sync), AN-31 (verified: on-disk `shared.tsx` matches imports — no issue), AN-33 (dashboard tooltip reads the data point, not `payload[1]`). Tests: +8 (pbBound, alignPreviousMonths, customer dedupe, monthly overlay) → 23/23.

### Packing / flash-drop
- **PK-01** packing migration rewritten to the PB-0.25-safe create→fields→save→rules order with self-healing + unique partial index `(account_email, order_id) WHERE status='in_progress'`.
- **PK-02** dual-identity tenant rules (staff no longer locked out).
- **FD-01** route-level stock deduction removed; settlement is the single ledger owner (no double-deduct under webhook/confirm race).
- **FD-02** reservation completion moved into `settleCapturedOrder` (before this, webhook-settled orders left the hold active→expired and voided the drop cap).
- **FD-09** `whatsapp_flash_drop` channel label.

### CRM / storefront / tenancy
- **N-B1 (Critical)** unique-race fallback now passes tenant + phone (cross-tenant order hijack closed).
- **N-D1** `createCustomerFromChat` stamps `account_email`; **N-D2** custom-recipient broadcast rows stamped + 30-day dedupe; **N-D5** `getCustomerOrders` tenant-scoped + escaped; **N-D7** print report `<h2>` escaped.
- **N-C1** new migration `1793001400_products_whatsapp_catalog_identity.js` adds `whatsapp_catalog_id` + `whatsapp_last_synced` (self-healing).
- **N-C3** client-supplied `gateway_payment_id` no longer trusted at intake.
- **A-01 (rule half)** new migration `1793001500_tenant_rules_dual_identity.js` rewrites strict rules on products/variants + customers/sales/sales_orders/sale_items/sales_order_items/store_settings/stock_movements.
- **A-07 / F1** dedicated-tenant registry now stores the encrypted password; **F2** `tenantDatabaseExists` requires `data.db` (husk cannot brick an account); **F3** orphan dataDir adoption refuses another account's slug marker.
- **F6** OTP daily-limit NaN fallback; **A-22** login honours validated `?next=`.

## Partial

| ID | What remains |
| :- | :--- |
| AN-19 | Pure-helper tests added; **loader-level dedupe test with a fake `AnalyticsDb`** and turnover-reconstruction tests still missing. |
| AN-21 | O(n²) fixed; per-(tenant,range) result cache / refetch-storm layer not implemented (deferred — architectural). |
| PK-03 | Unique partial index enforces one in-progress session per order; **`packed_items` last-write-wins merge** (two packers/tabs) not implemented. |

## Deferred (not fixed — reasons)

| IDs | Reason |
| :- | :--- |
| AN-09, AN-24, AN-27 behavior, AN-32 | Copy/approximation semantics; need product wording or documented simplification (AN-27 documented). |
| AN-30 | Informational scope gaps vs plan (RangeHeader, Excel export, snapshot wiring, Treemap, RFM cohort) — feature work, not defects. |
| PK-04 … PK-14 | Packing lifecycle (notify-before-save, cancel wiring, empty slip, error states, scan scope, override audit, deep link, full-table scan, page guard, restart state, tests) — next feature pass; the destructive defects (migration, staff lockout, double session) are fixed. |
| FD-03 … FD-08, FD-10 … FD-12 | Cancelled-order resurrection, swallowed gateway update, OTP-less holds, zero-stock allocation, per-process rate limits, tenant-email disclosure, 503-on-paid, cascade delete, prefix parse — next flash-drop pass; double-deduct + cap-void (the money/stock defects) are fixed. |
| N-D3, N-D4, N-D6 | Custom-recipient opt-in bypass, update/delete ownership checks, getCustomerSummary ownership. |
| N-C2, N-C4, N-C5, N-B2, N-B3, N-B4, N-B5, N-B6, N-B7, ORD-11 | Reconciler amount verify, swallowed gateway update, hardcoded URLs, sku taxonomy sanitize, PO reconcile scope, e-way pincode, shipped bypass, legacy sequence adoption, hardcoded 3% order-line GST, unstamped returns children. |
| F4, F5, F7, F8 | Setup-token accepted first-run design; rbac defense-in-depth; OTP verify atomicity/pruning; e-way input caps. |
| N-A4 | `staffEmail` filter hygiene (server-derived; nil exploitability). |

## Migration note

Three migrations changed/added. On the **live** database run the house procedure: stop PB → backup `pb_data` → `migrate up` → restart → verify (never run against live without the backup step). The packing migration is safe to re-run on a database where the old version failed (self-healing); `1793001500` only rewrites rules; `1793001400` only adds two product fields.
