# fin-agent — FIN / Banking / Expense / GSTR-1 audit fixes

Date: 2026-11-02
Scope: FIN-01, FIN-04, FIN-06…FIN-09, FIN-11, FIN-14…FIN-24 (FIN-13 skipped), plus POS-15/POS-16/POS-23 and ORD-24 in `src/lib/gst.ts`.
Not touched (owned by analytics-agent): `src/lib/reports.ts`, `src/lib/analytics.ts`, `src/types/database.ts`, analytics paths.

## Results

| ID | Status | Files | Evidence |
| :-- | :-- | :-- | :-- |
| FIN-01 | partial (owned files fixed; reports.ts out of scope) | `src/lib/banking.ts`, `src/lib/expenses.ts`, `src/lib/gstr1-report.ts` | Every query now carries `account_email="${sanitizeFilter(accountScopeEmail())}"`; id-addressed reads/updates/deletes verify the stamp in memory; creates stamp explicitly. 16 query sites covered. `reports.ts` still pending. |
| FIN-04 | fixed | `src/lib/cheque-register.ts`, `src/app/cheques/page.tsx` | `advanceCheque` posts `createBankTransaction` before committing the register whenever `bankBalanceDelta !== 0` (cleared, bounce fee, cleared→open reversal). Deposit now picks a real `BankAccount` from a page selector; the fabricated `acc_*` id and `window.prompt` are gone. |
| FIN-06 | fixed | `src/lib/gstr1-engine.ts` | Table 9B credit/debit note items are grouped by `gst_rate` (header fallback derives the rate from actual tax instead of 3.0 / `cnValue / 1.03`). Table 12 `hsnMap` subtracts credit-note qty/value/tax and adds debit notes. |
| FIN-07 | blocked | — | `generateGSTR1JSON` lives in `src/lib/reports.ts` (analytics-agent). `/reports/gst` "Export JSON" still calls it; the GSTN JSON button already uses `buildGstr1OfficialPayload`. |
| FIN-08 | partial (gstr1 fixed; reports.ts out of scope) | `src/lib/gstr1-report.ts` | `periodInvoices` excludes `draft`; `periodNotes` excludes `draft`/`pending`; turnover sums skip both; cancelled rows stay only for Table 13. `reports.ts` queries still include drafts. |
| FIN-09 | fixed | `src/lib/gstr1-engine.ts` | `String(inv.buyer_gstin ?? "").trim().toUpperCase()` in both loops; `extractStateCode()` now resolves numeric prefixes, "29-Karnataka" and state names, and normalises `supplierStateCode`/`place_of_supply` before the inter-state comparison. |
| FIN-10 | fixed (verified, pre-existing) | `src/app/cheques/page.tsx` | Bounce button renders only for `status === "deposited"`; no change needed. |
| FIN-11 | fixed | `src/lib/expenses.ts`, `src/app/expenses/categories/page.tsx` | `getCategories(includeInactive = false)`; categories page passes `true`, so disabled rows stay visible and can be re-enabled. Other pickers keep active-only. |
| FIN-12 | fixed (verified, pre-existing) | `src/lib/banking.ts` | `createBankTransaction` rejects non-finite/`<= 0` amounts before the overdraft check. |
| FIN-13 | blocked (skipped by instruction) | — | `src/lib/analytics.ts` belongs to analytics-agent. |
| FIN-14 | blocked (no in-scope instance) | — | No `product_variants`/stock query exists in any fin-agent file. Residual is `getStockReport` in `reports.ts`. |
| FIN-16 | fixed | `src/lib/cheque-engine.ts` | Bounce branch now guarded with `newStatus === 'bounced' && fromStatus !== 'bounced'`; re-marking cannot re-apply receivable/penalty deltas. |
| FIN-17 | fixed | `src/lib/cheque-register.ts` | `addCheque`/`advanceCheque` were already `enqueueTask('cheque_register')`-serialized and prune only cancelled rows; added the same serialization to `deleteCheque`, which was still an unserialized RMW. |
| FIN-18 | fixed | `src/lib/gstr1-engine.ts`, `src/lib/gstr1-report.ts` | Cancelled invoices/notes are passed through for Table 13 (transaction tables still skip them); `cancelled` status preserved instead of mapped to `paid`; document numbers sort with `localeCompare(undefined, { numeric: true })`. |
| FIN-19 | fixed | `src/lib/cross-border-engine.ts`, `src/app/reports/export/page.tsx` | `foreignGstTotal` is computed per line and `foreignGrandTotal = foreignSubtotal + foreignGstTotal` when not LUT; the download recompiles from `validItems` so blank rows never enter the statutory JSON; preview shows foreign GST/grand total. |
| FIN-20 | fixed | `src/app/banking/transactions/page.tsx` | `transfer` rows render `-` (and red); the search input is bound to `searchQuery` and filters description/reference client-side. |
| FIN-21 | partial (page fixed; reports.ts out of scope) | `src/app/reports/gst/page.tsx` | Added the missing IGST column to the B2C table and a derived Type column: `B2C Large` only when `igstAmount > 0 && invoiceValue > 250000`, otherwise `B2C Small`. `getGSTR1Report` still labels every B2C row "B2C Large". |
| FIN-22 | fixed | `src/app/expenses/page.tsx` | Default From Date is built from local `getFullYear()/getMonth()` as `YYYY-MM-01`; To Date uses a local formatter. No `toISOString()` month shift. |
| FIN-23 | partial (owned files fixed; printReport out of scope) | `src/lib/banking.ts`, `src/lib/expenses.ts`, `src/lib/gstr1-report.ts` | `accountId`, `categoryId`, and invoice/credit-note item parent ids are `sanitizeFilter`ed. `escapeHtml(printReport title)` remains in `reports.ts`. |
| FIN-24 | fixed | `src/app/reports/page.tsx` | Both Quick Export cards are wired: "Export All Invoices" downloads this month's `getSalesReport` rows as CSV; "Monthly Summary" downloads revenue/tax/orders/items. Busy labels while running. |
| POS-15 | partial (gst.ts fixed; invoices page out of scope) | `src/lib/gst.ts` | `generateEWayBillJSON` throws an explicit error unless the destination pincode is a 6-digit number; the `560001` fabrication is gone. The mock GSTIN fallback in `src/app/invoices/detail/page.tsx` (not a fin-agent file) remains. |
| POS-16 | fixed | `src/lib/gst.ts` | `amountToWords` rounds `totalPaise = Math.round(absAmount * 100)` first, then derives rupees/paise; `99.996` now yields 100 rupees and 0 paise. |
| POS-23 | fixed (verified + explicit alias) | `src/lib/gst.ts` | `validateGSTIN` already delegates to the Mod-36 `isValidGstin` checksum; added `isValidGSTIN` as a boolean wrapper over `validateGSTIN` so no regex-only validator remains. |
| ORD-24 | fixed | `src/lib/gst.ts` | E-Way Bill item rate uses `roundToTwo((totalTax / taxable) * 100)` so 0.25% rates are not rounded to 0. |

## tsc

`npx tsc --noEmit --incremental false` → **zero errors in every fin-agent file**.

Pre-existing / concurrent errors in files owned by other agents (reported, not fixed):

- `src/app/api/storefront/flash-drop/route.ts` — `FlashDropItem` null/optional mismatch + `order` possibly null (wa-agent).
- `src/lib/whatsapp-flash-drops.ts` — same `FlashDropItem` mismatch (wa-agent).
- `src/app/orders/create/page.tsx` — `await` outside async function (audit-fix).
- `src/lib/returns.ts` — `linkage` used before declaration (audit-fix, appeared during the run).

## Residuals

1. `src/lib/reports.ts` (analytics-agent, not edited):
   - FIN-01: `getSalesReport`, `getHSNSummary`, `generateGSTR1JSON` filters lack tenant scoping (and `getGSTR1Report` lacks `sanitizeFilter`).
   - FIN-07: `generateGSTR1JSON` still hardcodes `num: 1`, `typ: 'E'` without `etin`, and no checksum validation; `/reports/gst` "Export JSON" still calls it.
   - FIN-08: report invoice queries still include `draft`/`cancelled`.
   - FIN-14: `getStockReport` still misses `product.is_active=true` and the cost fallback.
   - FIN-21: `getGSTR1Report` still labels all unregistered buyers `B2C Large`.
   - FIN-23: `printReport` still interpolates the raw title into `<h2>`.
2. `src/lib/analytics.ts` — FIN-13, untouched by instruction.
3. `src/app/invoices/detail/page.tsx` — POS-15 mock GSTIN fallback `29AAACN1234F1Z8` (audit-fix owns `src/app/invoices/**`).
