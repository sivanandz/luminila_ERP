# Bug Audit Report — 2026-10-22

> **RE-VERIFICATION 2026-10-23 (late):** All 16 findings from this report were re-checked
> against the tree after 49 remediation commits. **14 are fully fixed, 1 mostly fixed, 1
> fixed-in-config but blocked by an exFAT drive quirk** (now also resolved — details in the
> "Re-verification" section at the bottom). Line references below are historical (from the
> audit baseline `f0e96b4`) and may not match the current tree.

**Branch:** `fix/security-audit-remediation` @ `f0e96b4`
**Scope:** Fresh audit of existing features before new feature work. Re-verification of all findings in `APP_LOGIC_AUDIT_REPORT_2026-03-07.md` against the current tree, plus new findings.
**Method:** `tsc --noEmit` (clean), ESLint on `src/`, targeted production build test, line-level manual trace of money/stock/auth paths and all 13 API routes.

---

## Executive Summary

The March 2026 audit's critical logic findings have been **largely fixed** (shift reconciliation, POS rollback, order→invoice, return restock, GRN over-receipt guard, banking overdraft, sequence allocator, login unification, filter sanitization). However, this pass found **4 new P1 issues**, concentrated in three clusters:

1. **POS invoicing math is internally inconsistent** (tax added on top of tax-exclusive POS totals; pre-discount GST base).
2. **The tenant-provisioning API is completely unauthenticated** and can redirect the server's active tenant.
3. **Production builds are broken** (static export vs 13 API route handlers, plus a Windows Turbopack symlink blocker) — `npm run tauri:build` cannot currently ship.

| Severity | Count |
|---|---|
| 🔴 P1 | 4 |
| 🟠 P2 | 5 |
| 🟡 P3 | 7 |

---

## 🔴 P1 — Fix immediately

### 1) POS invoices add GST on top of tax-exclusive POS totals and are stamped "paid" for the wrong amount
**Files:** `src/lib/invoice.ts:1074-1192` (`createInvoiceFromSale`), POS UI (`src/app/pos/page.tsx`, `src/components/pos/*` — verified: zero GST references anywhere in POS UI)

- The POS checkout collects `data.total` with **no tax component** (no GST math exists in the POS UI at all).
- `createInvoiceFromSale` then computes 3% jewelry GST on `quantity × unit_price` and builds `grand_total = taxableValue + totalTax − sale.discount` (`invoice.ts:1136-1142, 1182`).
- The invoice is created with `status: 'paid'`, `is_paid: true`, `paid_amount: sale.total` (`invoice.ts:1168, 1187-1188`) — so `grand_total` (with tax) > `paid_amount` (what the customer actually paid) on **every POS invoice**, while the invoice claims to be fully paid.
- Downstream effect: GST reports overstate output tax on all POS revenue; invoice totals don't match drawer takings.

**Fix direction:** Decide the tax model (POS totals are tax-inclusive → back-compute taxable value via `rate/(1+rate)`, or add a tax line to POS checkout), make `paid_amount` = `grand_total`, and compute GST on the **post-discount** base.

### 2) POS invoice GST is computed on the pre-discount base (while order→invoice correctly uses post-discount)
**Files:** `src/lib/invoice.ts:1074-1090` vs `src/lib/orders.ts:242-251`

- `createInvoiceFromSale` applies `calculateGST` to the **undiscounted** line total, then subtracts `sale.discount` only at document level. Order→invoice was explicitly fixed (WPA comment, `orders.ts:243-251`) to tax the post-discount base — the two paths now disagree.
- Effect: on every discounted POS sale, CGST/SGST amounts are overstated versus the tax actually collected. Indian GST requires discount-adjusted taxable value (GST Act s.15).

### 3) `/api/system/tenant-db` is fully unauthenticated and can redirect the server's active tenant
**Files:** `src/app/api/system/tenant-db/route.ts:14-78`, `src/lib/tenant-db-manager.ts:376,392`

- `GET ?email=x` starts and returns the address of **any** tenant's PocketBase instance. `POST {mode:'provision'}` creates **new tenant databases with attacker-chosen superuser credentials** — no auth check of any kind.
- `resolveTenantDatabase()` mutates the process-global `registry.activeTenantEmail`, so an unauthenticated call re-points the server's default tenant for subsequent operations.
- The app is routinely exposed via Cloudflare tunnels (`npm run tunnel:app`), so this is remotely reachable; even on localhost, any website can trigger state-changing POSTs cross-origin.

**Fix direction:** require a valid operator JWT (same pattern as `src/app/api/pos/payment/route.ts:17-58`) and never switch `activeTenantEmail` from an unauthenticated request.

### 4) React hooks called conditionally — WhatsApp chat view can crash wholesale
**File:** `src/app/whatsapp/page.tsx:270, 295-299` (`QuotedBlock`)

- `if (!msg.quotedMsg) return null;` executes **before** three `useState` calls and one `useEffect`. When React reconciles a message that has a quoted reply with one that doesn't in the same slot, hook count changes between renders → "Rendered fewer hooks than expected" → the entire chat page crashes.
- Confirmed by ESLint `react-hooks/rules-of-hooks` (only error-severity React finding in `src/`).

**Fix direction:** call hooks unconditionally at the top, then `if (!msg.quotedMsg) return null;` after them.

---

## 🟠 P2 — Fix before release

### 5) Any 400 on variant stock update is misread as "insufficient stock" and **clamps stock to 0**
**File:** `src/lib/pos-sales.ts:166-176`

- The oversell handler matches `pbErr?.status === 400` as a fallback. A permissions failure, validation error, or any other 400 on `stock_level-` update is treated as min-constraint violation → `stock_level: 0` is written and the sale continues. One bad rule/network-shaped 400 silently destroys a variant's stock count.
- Fix: match only `validation_min_number_constraint` (drop the bare `status === 400` branch); on anything else, fail the item (and compensate) instead of clamping.

### 6) POS rollback doesn't compensate shift totals or a partially-created invoice
**File:** `src/lib/pos-sales.ts:210-262`

- Step 4 (`updateShiftTotals`, cash/UPI totals incremented) and step 5 (`createInvoiceFromSale`) run before the catch. The compensating rollback restores stock, deletes movements/items/sale — but leaves `total_cash_sales`/`total_upi_sales` inflated and an orphan invoice header behind.
- Related: `createInvoice` (`invoice.ts:522-580`) creates the invoice header first, then items in a loop with no try/catch — an item failure leaves a header with zero items and no rollback.

### 7) OTP flow: no daily send cap; signed token issued for a fake customer when PocketBase is down
**Files:** `src/lib/otp-store.ts:98` (`requestCount` recorded, never enforced), `src/app/api/storefront/auth/verify-otp/route.ts:79-90`

- Only a 30s resend cooldown exists → an attacker can pump unlimited WhatsApp OTP messages through the merchant's session (ban/charge risk for the WhatsApp sidecar).
- On PocketBase unreachability, verify-otp still returns a **valid 30-day signed customer token** bound to `temp_<timestamp>` id that exists nowhere in the DB.
- Fix: enforce a per-phone daily cap in `generateAndSaveOtp`; fail closed in verify-otp when customer persistence fails.

### 8) `store_settings` collection rules have no tenant scoping
**Evidence:** `scratch/initial_schema.js` (dumped live schema): `listRule/viewRule/updateRule = "@request.auth.id != ''"` — any authenticated user can read/write any row.

- Safe today only because each tenant gets its own SQLite instance; any code path that shares an instance (single-instance mode, migration, provisioning fallback) is cross-tenant readable/writable.
- Also: `invoice.ts:390-408 updateStoreSettings` creates rows **without** `account_email` while `getStoreSettings` (`invoice.ts:304`) filters by `account_email="user@x"` — if ever called, saved settings become invisible. It currently has **zero callers** (dead code — delete it); the real writer `lib/settings.ts` scopes correctly.

### 9) Production build is broken two ways — `npm run tauri:build` cannot ship
**Files:** `next.config.ts:9`, 13 files under `src/app/api/**/route.ts`, build log

- `output: "export"` activates for every `next build` (NODE_ENV=production), but route handlers without `export const dynamic = 'force-static'` (all 13) are illegal under static export — the build fails at route collection once it gets that far. Even if it passed, these runtime APIs (payments, OTP, catalog sync, tenant provisioning) would be dead in the packaged app.
- Current build fails earlier with a **Turbopack panic**: `create symlink ... os error 1` (Windows requires Developer Mode/admin for symlinks). Environment issue, but blocks all packaging until fixed (enable Developer Mode or `NEXT_DISABLE_TURBOPACK`/webpack fallback).

**Fix direction:** pick one architecture — (a) keep static export and move the 13 server endpoints into the WPPConnect sidecar (already a Node server), or (b) drop `output: "export"` and run Next with a server in packaged apps.

---

## 🟡 P3 — Should fix

10. **`src/lib/expenses.ts:118`** — raw `filters.search` interpolated into `payee~"..." || description~"..."` without `sanitizeFilter` (the only live remainder of prior finding #10; products/customers are fixed).
11. **`src/lib/register.ts:109`** — writes `operation_type: 'opening_float'`, but the schema enum is `add|remove|sale|refund` (`scratch/initial_schema.js`). The create 400s and is swallowed by `.catch(warn)` → opening-float audit trail never persists. Also `DrawerOperation` type at `register.ts:50` doesn't include it.
12. **`src/lib/orders.ts:226,296-298,298`** — `generateInvoiceFromOrder` hardcodes `sellerStateCode || '27'` (Maharashtra) and writes `buyer_gstin: ''` even when the customer's GSTIN was just fetched (line 231) — B2B invoices generated from orders lack buyer GSTIN. Also: if `createInvoice` succeeds but the `sales_orders.update(status:'invoiced')` (line 326) fails, retry creates a duplicate invoice.
13. **`src/lib/banking.ts:166-186`** — overdraft check is read-then-write without locking; two concurrent withdrawals can both pass and drive balance negative. Low likelihood (single store), cheap to fix with a serialized queue like `concurrency.ts`.
14. **`src/lib/sequence-generator.ts:68-99`** — cross-process read-modify-write on `current_value` remains (in-process mutex only). `createWithUniqueRetry` heals duplicates only where the document number has a UNIQUE index — verify indexes exist on `invoice_number`, `po_number`, `challan_number`, `credit_note_number`, `expense_number`.
15. **`src/app/api/storefront/auth/send-otp/route.ts:34`** — `accountEmail` is client-supplied and selects which tenant's WhatsApp session sends the OTP; `getStorefrontBinding` (`src/lib/storefront.ts:30`) also falls back to an arbitrary first `store_settings` row. Works for the multi-brand storefront model, but consider pinning the binding by domain instead of request body.
16. **`src/app/api/tracking/st-courier/route.ts`** — public unauthenticated proxy to ST Courier scraping with no rate limit; fine as a customer tracking page, but cap requests/IP to avoid quota abuse.

---

## ✅ Verified fixed (from APP_LOGIC_AUDIT_REPORT_2026-03-07)

| Prior finding | Status | Evidence |
|---|---|---|
| #1 P1 Opening balance double-counted in shift reconciliation | **FIXED** | `register.ts:105-115` records `opening_float` op without touching `cash_added`; formula `register.ts:181-186` correct |
| #2 P1 POS sale non-atomic | **FIXED (mostly)** | compensating rollback `pos-sales.ts:226-262`; residual gaps → new #6 |
| #3 P1 "Generate Invoice from Order" doesn't generate | **FIXED** | real invoice created `orders.ts:287-326` |
| #4 P1 Returns don't restore stock | **FIXED** | restock/quarantine + idempotency guard `returns.ts:338-422` |
| #5 P1 GRN unbounded over-receipt | **FIXED** | cap-to-remaining guard `purchase.ts:674-690` |
| #6 P1 Banking split-write + silent overdraft | **FIXED** | funds check `banking.ts:166-169`, atomic operators, transfer rollback `banking.ts:218-224` |
| #7 P1 Race-prone document numbering | **FIXED (mostly)** | `sequence-generator.ts` mutex + unique-retry everywhere (residual → #14) |
| #8 P2 Challan schema drift | **FIXED** | `challan.ts:114-119,367-388` documents/normalizes `delivery_date` mapping |
| #9 P2 Login bypasses AuthContext | **FIXED** | `login/page.tsx:35` routes through `useAuth().login` |
| #10 P2 Unescaped filters | **MOSTLY FIXED** | products/customers sanitized; `expenses.ts:118` remains (#10 above) |

`npx tsc --noEmit` — clean. ESLint `src/` — 0 errors except the #4 hooks finding (plus `prefer-const` nits in `excel-import.ts:474`, `purchase.ts:294`, `storefront.ts:26`).

---

## Not covered this round (recommend follow-up)

- WhatsApp sidecar internals (`wppconnect-sidecar/server.js` — lifecycle/reconnect/broadcast loops) and the Meta catalog batch/stealth-sync engine — recent commits claim fixes, unverified here.
- Reports/dashboard KPI math, banking/expenses UI flows, labels & excel-import edge cases.
- PocketBase API-rule audit for all 40+ collections beyond `store_settings`.

## Recommended fix order

1. **#9 build** — nothing ships until resolved (architecture decision: sidecar endpoints vs Next server).
2. **#3 tenant-db auth** — one auth block copied from `pos/payment` route.
3. **#1 + #2 POS tax model** — single decision (inclusive vs exclusive), then fix `createInvoiceFromSale` + POS totals together.
4. **#4 hooks crash** — 5-line fix.
5. **#5 clamp catch-all, #6 rollback gaps, #7 OTP caps** — small, contained.
6. **#8 rules + #10-16** — batch hardening pass.
---

## Re-verification — 2026-10-23 (49 commits after the audit)

Every finding was re-checked against current code, not against commit messages.

### Fixed and verified

| # | Original finding | How it is fixed now |
|---|---|---|
| P1-1 | POS invoice paid_amount < grand_total | Rewritten around new `src/lib/invoice-math.ts`: POS totals treated as tax-INCLUSIVE, tax back-computed in integer paise after discount allocation (largest-remainder); `paid_amount = grand_total` (`invoice.ts:1199-1205`) |
| P1-2 | GST computed on pre-discount base | Discount is allocated across lines BEFORE the tax split (`invoice-math.ts:68-91,182-211`); POS and order paths share the module, so the two paths can no longer disagree |
| P1-4 | Conditional hooks crashed WhatsApp chat | Hooks hoisted above the early return (`src/app/whatsapp/page.tsx:296-324`); ESLint reports zero error-severity hooks findings in `src/` |
| P2-5 | Any 400 clamped stock to 0 | Only `validation_min_number_constraint` triggers the oversell path; all other errors throw into rollback; movement ledger reconciled to actual available qty (`pos-sales.ts:188-231`) |
| P2-6 | Rollback skipped shift totals & orphan invoice | Rollback now deletes the invoice (and its items) and compensates shift totals (`pos-sales.ts:289-305`); `createInvoice` items loop has its own try/catch that removes header+items on failure (`invoice.ts:519-581`) |
| P2-7 | OTP: no daily cap; token for unpersisted customer | Daily per-phone cap with day-keyed counters (`otp-store.ts`); verify-otp fails closed 503 instead of minting temp-customer tokens and refuses to sign without a configured secret (`verify-otp/route.ts:79-104`) |
| P2-8 | store_settings rules without tenant scope | Migration `pb_migrations/1792774206_store_settings_rules.js` applied to the live DB (tenant-scoped list/view/update/delete). The file header still says "DRAFT — not applied"; only that comment is stale. The dead `updateStoreSettings` writer was deleted (`invoice.ts:396`) |
| P3-10 | expenses.ts unsanitized search | `sanitizeFilter` applied (`expenses.ts:116-121`) |
| P3-11 | opening_float not in schema enum | Float now written as `add` with an explicit reason (`register.ts:105-117`) |
| P3-12 | Order invoice: '27' default, empty buyer_gstin, duplicate on retry | Seller state derived from settings then store GSTIN ('27' only as documented last resort); `buyer_gstin` populated from the customer (`orders.ts:248-261,332`); idempotent already-invoiced guard (`orders.ts:222-234`) plus unique index `idx_invoices_order` (`pb_migrations/1792774205_indexes.js`) |
| P3-13 | Banking read-then-write overdraft race | Transaction + balance update serialized per account via `enqueueTask('bank_...')` (`banking.ts:160`) |
| P3-14 | Document numbering cross-process race | Atomic server-side increment `current_value+` with the post-increment value read from the response (`sequence-generator.ts:75-85`); unique indexes exist on document numbers |
| P3-15 | Client-supplied accountEmail steers tenant binding | Storefront writes require a verified customer session token; tenant resolved from the session with explicit fallback rules (`storefront/order/route.ts:80-88`) |
| P3-16 | Unauthenticated ST Courier proxy | `FixedWindowRateLimiter` with per-client keys (`st-courier/route.ts:3-16`) |

### Mostly fixed

- **P1-3 tenant control plane**: GET no longer switches the global active tenant (`activate: false`), unauthenticated responses expose only the connect URL, and re-provisioning an EXISTING tenant requires a valid operator session for that tenant (`api/system/tenant-db/route.ts`). Residual: provisioning a brand-NEW tenant remains anonymous (deliberate, for first-run setup) with no cap — an attacker on a network-exposed host could still create arbitrary tenant DBs. Acceptable for the desktop/tunnel model; add a provision allow-list or cap before wide hosting.

### Fixed, with an environment caveat (resolved 2026-10-23/24)

- **P2-9 build**: the architecture decision landed (`output: 'standalone'`, webpack build, PocketBase + Next server bundled and supervised by the Tauri shell — `src-tauri/tauri.conf.json`, `lib.rs`). The build still failed ON THIS MACHINE because the repo sits on an **exFAT drive, where libuv's `readlink()` returns EISDIR for regular files**; webpack treats that as fatal. Fixed via new `scripts/fix-exfat-readlink.cjs`, loaded through `NODE_OPTIONS` in the `build` script (normalizes EISDIR→EINVAL across the callback, sync, and promise readlink APIs, in parent and child processes). **Final state 2026-10-24: `npm run build:desktop` passes end-to-end** — all routes generate, `server-dist/` is prepared (server.js + traced node_modules + static, ~140 MB), and the standalone server was booted with `PORT=3210` and verified serving the login page (HTTP 200) with API route handlers executing. The interim type error at `whatsapp/page.tsx:1245` was a parallel agent's mid-edit state, resolved by their committed refactor.

Also verified as fixed beyond the original list (spotted during re-checks): POS quantity validation (`pos-sales.ts:91-100`), GRN atomic reservation (`purchase.ts:678+`), landed cost moved from a notes blob to an atomic numeric column (`purchase.ts:1296`, migration 1792774207), GSTIN check-digit validation, webhook dedupe/amount-match, and a 21-suite test gate wired into `npm test`.

## Addendum 2026-10-24 — users-collection tenant leak (closed)

Reported from the /users page: "ananya@heritagejewels.com leaked into niththigal". Root cause: `users` and `user_roles` were the only two of 63 collections without account_email scoping (their rules were `@request.auth.id != ""`), so any authenticated tenant could list every account in the system. `roles` stays global by design (shared RBAC catalog, no PII). Fixed by migration `1792800000_users_tenant_scoping` (applied to the live DB 2026-10-24): `account_email` added and backfilled on both collections; list/view scoped to tenant + self; create/update/delete gated to same-tenant Admin. Client writers (`app-users.ts createAppUser`, `rbac.ts setUserRoles`, `setup.ts ensureSetupAdminUser/linkUserToAdminRole`) now stamp `account_email`. Verified: a tenant token lists only its own record (API check) and `/users` renders one record (UI check). This closes the gap this report flagged under "Not covered this round" (PocketBase API-rule audit beyond store_settings).
