# Bugs & Issues Audit Report — Luminila Inventory Management

**Date:** 2026-11-04  
**Project:** `luminila_inv_mgmt` (Next.js 16 + PocketBase + Tauri v2)  
**Method:** Token-efficient, feature-at-a-time audit. Max 3 parallel agents per batch.  
**Coverage this report:** 3 of 17 core domains — Auth/RBAC, POS/Checkout, Inventory/Products  
**Total findings:** 45 (Critical: 4, High: 23, Medium: 16, Low: 2)

---

## 1. Executive Summary

Audit focused on concrete, file:line-verified bugs only — no speculation. Critical issues cluster in:

1. **Cross-tenant RBAC bypass** — `user_roles` queries miss `account_email` filter; any tenant admin becomes global admin.
2. **Setup force bypass** — `?force=true` lets unauthenticated users re-run provisioning / create admin.
3. **POS financial integrity** — client totals persisted verbatim, oversell charges for undelivered qty, offline replay duplicates sales.
4. **Negative stock** — `updateStock` drives `stock_level` negative with no guard.

**Fix order:** Set up guard + tenant scope first (Critical), then POS recompute + idempotency, then inventory negative-stock / variant resolution.

---

## 2. Feature Audits

### 2.1 Auth / RBAC / Users

| # | File:Line | Severity | Evidence | Fix |
|---|---|---|---|---|
| A1 | `src/app/setup/page.tsx:72` | **Critical** | `if (!isForce && await isSetupComplete()) router.push("/login")` — unauthenticated `?force=true` skips setup-complete check and re-runs provisioning/admin creation (linked from `src/app/login/page.tsx:139`) | Remove `force` bypass; require server-side `isSetupComplete()` check and authenticated admin before re-running setup |
| A2 | `src/lib/rbac.ts:316` / `src/hooks/usePermissions.ts:64` | High | `ur.expand?.role?.name === 'Admin' \|\| 'Super Admin'` name-only check + `if (admin) return true` — any custom role named `Admin` grants all permissions | Grant admin only for system roles by ID/`is_system`; reserve `Admin`/`Super Admin` names |
| A3 | `src/lib/rbac.ts:312,322` / `src/contexts/AuthContext.tsx:36` | High | `isAdmin()`/`getCurrentUserPermissions()`/`checkUserIsAdmin()` filter only ``user="${id}"`` with no `account_email` tenant filter | Add `&& account_email="${tenant}"` to all `user_roles` queries |
| A4 | `src/lib/rbac.ts:148,169` | High | `if (tenant && existing.account_email && existing.account_email !== tenant)` — tenant check skipped when `accountScopeEmail()` empty | Fail closed: throw if `!tenant` or owner mismatch |
| A5 | `src/lib/rbac.ts:224` | High | `setUserRoles()` validates role tenant but never validates target user's `account_email` nor caller admin status; allows assigning `Super Admin` | Verify target user tenant + caller `isAdmin()`; block assigning system Admin roles to non-admins |
| A6 | `src/lib/rbac.ts:250` | High | `toggleUserActive()` directly `pb.collection('users').update(userId,{is_active})` with no tenant, admin, self, or last-admin check | Verify tenant ownership + caller admin; block self-deactivation and deactivating last active admin |
| A7 | `src/hooks/usePermissions.ts:51` | High | `catch { console.error(...) }` never clears `permissions`/`admin`, so failed refresh retains previous user's stale permissions | In `catch`/`finally` set `setPermissions({})` and `setAdmin(false)` before `setLoading(false)` |
| A8 | `src/app/setup/page.tsx:146` | High | `authenticateSetupSuperuser()` authenticates PB superuser on same shared `pb` client/browser `authStore` as app users, persisting full DB-admin JWT client-side | Use separate PocketBase instance for superuser seeding and clear superuser `authStore` immediately after |
| A9 | `src/contexts/AuthContext.tsx:105` | High | On regular `users` auth failure, automatically falls back to `pb.collection("_superusers").authWithPassword(email,password)` on normal login path | Remove fallback; expose superuser login only via separate, audited admin route |
| A10 | `src/contexts/AuthContext.tsx:63-74` | Medium | `authRefresh()` clears session only on `401/403`; other errors (e.g. 404/deleted account) leave stale token accepted | Clear session on any `ClientResponseError` and re-check `is_active`/existence before `setIsValid(true)` |
| A11 | `src/contexts/AuthContext.tsx:113` | Medium | `authData?.record?.is_active === false` only blocks explicit `false`; missing/`null` passes login | Treat `is_active !== true` as inactive; enforce `is_active` in server rules |
| A12 | `src/app/users/page.tsx:472-474,328,337` | Medium | Page gated only by `ProtectedRoute resource="users" action="read"`; create/role/deactivate handlers only visually hidden by `<Can>` | Guard handlers with `hasPermission("users","update")`/`isAdmin` and enforce equivalent PocketBase API rules |
| A13 | `src/app/setup/page.tsx:166-172` | Medium | `loginSetupAdmin()` failure only `console.warn`ed, yet sets `setCurrentStep("complete")`, leaving superuser session active | Abort/rollback on login failure; clear superuser store and only show complete after verified app-user login |
| A14 | `src/app/login/page.tsx:40-44` | Low | `safeNext` only checks `startsWith("/") && !startsWith("//")`, allowing `next=/setup?force=true` and `/\evil` redirects | Parse with `new URL()` and allowlist internal app routes; reject backslashes/encoded slashes/setup routes |
| A15 | `src/contexts/AuthContext.tsx:130-135` | Low | `logout()` only `pb.authStore.clear()` + removes `PB_CUSTOM_URL`, relying on `onChange` to reset state with no explicit reset/redirect | Explicitly `setUser(null); setIsValid(false); setIsAdmin(false)` and `router.replace("/login")` |

**Critical bug A1:** Setup re-entry. An unauthenticated visitor can open `/setup?force=true` after initial setup complete and re-run provisioning. This is pre-auth admin creation / takeover.

---

### 2.2 POS / Checkout / Register

| # | File:Line | Severity | Evidence | Fix |
|---|---|---|---|---|
| P1 | `src/lib/pos-sales.ts:123-125,158,162` | **Critical** | Client `data.subtotal/total/discountAmount/loyaltyDiscount` persisted verbatim; `total_price=price*quantity`. No server recompute, negative/`discount>100` accepted | Recompute from verified prices/qty server-side, round to paise, reject mismatch |
| P2 | `src/lib/pos-sales.ts:190-220` | **Critical** | `oversell:'clamp'`: on shortage stock deducts only `available` but `sale_items` and `total` stay at full requested qty — customer charged for undelivered items | Abort on shortage or recalc `total`/line totals to `available` and gate checkout on confirmation |
| P3 | `src/lib/offline-queue.ts:105-122` | **Critical** | `flush` replays `create` with no idempotency key/dedupe; lost-response retry duplicates sales/stock; unlimited `retries` | Store client UUID, server dedupe on it, cap retries/dead-letter |
| P4 | `src/lib/pos-sales.ts:181-188` | High | `stockLines` filters `Boolean(item.productId)`; items without `productId` sell/deduct no stock silently | Reject sale if any line lacks `productId/variantId` |
| P5 | `src/lib/pos-sales.ts:323-352` | High | `updateShiftTotals` returns `false` on error, comment "shift update failure shouldn't fail sale"; `expected_balance/total_*_sales` drift → drawer variance | Propagate error/reconcile; block close until totals verified |
| P6 | `src/lib/pos-sales.ts:209-215,263-272` | High | `adjustLocationStock(...).catch(()=>{})` swallowed and never rolled back; rollback restores global `stock_level+` only, no location reversal, no lock | Roll back location stock, surface errors, wrap in `enqueueTask`/transaction |
| P7 | `src/lib/pos-sales.ts:103` | Medium | `TXN-${Date.now().toString(36)}` — same-ms/concurrent sales collide on `channel_order_id`; offline replay can duplicate | Use `crypto.randomUUID()` + unique constraint + idempotency check |
| P8 | `src/app/pos/page.tsx:1031-1037,1067` | High | Cash check only `if cashTendered!==''`; empty tender proceeds, `cashTendered: parseFloat(...) \|\| 0` records ₹0 cash sale | Require numeric `tendered>=total` for `paymentMethod==='cash'` |
| P9 | `src/app/pos/page.tsx:753-756` | Medium | `subtotal/discountAmount/total` float math, `discount` uncapped (`>100` → negative pre-clamp), no 2-dec rounding | Validate `0<=discount<=100`, compute in paise, round |
| P10 | `src/app/pos/page.tsx:942-954` | High | Price override: `newPrice<0` checked but `0` allowed; `discPct>100` → `newPrice*(1-disc/100)` negative line price, shrinks bill | Clamp `0<=discPct<=100`, require `newPrice>0` or manager override |
| P11 | `src/app/pos/page.tsx:585-596,1024-1028,1154` | High | Cart/pre-flight stock check uses stale `product.stock` snapshot from search/scan; two terminals race → server clamp (P2) | Authoritative server stock check + reject/confirm on oversell |
| P12 | `src/lib/register.ts:259-325` | High | `addCashToDrawer/removeCashFromDrawer` validate neither `amount>0/finite` nor open shift; negative `add` subtracts, negative `remove` adds, over-remove → negative expected balance | Validate finite `>0`, shift `open`, decrement guard |
| P13 | `src/lib/register.ts:179-213,399-401` | High | `closeShift`: `getShift`→`update` non-atomic (no `enqueueTask`), no `closingBalance` NaN/negative check; `calculateChange` `Math.max(0,…)` masks under-tender | Lock close, validate finite `>=0`, fail on under-tender |
| P14 | `src/lib/offline-queue.ts:56-80` | Medium | Only `create` stamps `account_email`; `update/delete` replay unscoped; duplicate updates enqueued, no coalescing | Stamp/check tenant for all actions, coalesce updates by `recordId` |
| P15 | `src/components/pos/Cart.tsx:24-27,60,84,93` | Low | `items.reduce` no null guard (null cart crashes); `key=item.variant.id` + callbacks by `variant.id` — duplicate variant lines collide | Guard `(items??[])`, key/callback by cart-line `id` |

**Financial impact:** P1+P2 together mean a malicious client can set `total=₹1` for a full cart, or a legitimate oversell bills full qty while only partial stock moves. Both are direct revenue / stock-integrity losses.

---

### 2.3 Inventory / Products / Labels

| # | File:Line | Severity | Evidence | Fix |
|---|---|---|---|---|
| I1 | `src/lib/products.ts:298-313` | **Critical** | `updateStock` uses atomic `stock_level-` with no availability check; can drive stock negative. | Fetch variant first, throw if `stock_level < quantity`; or clamp and surface error. |
| I2 | `src/app/inventory/page.tsx:677,690` | High | `parseInt(newProduct.stock)\|\|0` preserves `-5`; create/edit allows negative initial stock. | Reject `stock < 0` / non-integer in validation |
| I3 | `src/app/inventory/page.tsx:660-671` | High | Edit applies aggregate `stockDelta` to `variants[0]` only and sets `variant_name: newProduct.sku`, corrupting multi-variant matrix. | Edit per-variant stock in a variant editor; never rename variant to parent SKU. |
| I4 | `src/app/inventory/page.tsx:392-406` | High | Scan stock update falls back to `variants[0]`, then non-atomic read-modify-write `stock_level: newVariantStock`; concurrent scans lose updates. | Resolve exact variant by suffix; use atomic `stock_level+/-` with pre-check. |
| I5 | `src/lib/products.ts:639-651` | High | `findVariantBySuffixOrBarcode` filters `barcode=` on `product_variants`, a field absent from `ProductVariant` interface; lookup errors/returns empty. | Filter `product.barcode=` or add a real `barcode` column to variants. |
| I6 | `src/lib/products.ts:375-388` | High | `resolveBarcodeProduct` matches only product `sku/barcode` and returns `variants.items[0]`; variant-label scan picks arbitrary variant. | Also match `sku_suffix` / `PARENT-SUFFIX`; return exact variant, not first. |
| I7 | `src/lib/mobile-scanner.ts:119-126` | High | `const handled = handler.callback(...)` — a `Promise !== false` is treated as handled, so async handlers resolving `false` block lower-priority handlers. | `await` dispatch and check resolved value before consuming scan. |
| I8 | `src/lib/mobile-scanner.ts:139-164` | High | `startCameraScan` only tries Tauri plugin; on web falls through to `return null` despite doc claiming HTML5 fallback. | Implement HTML5 camera scan or rename and surface "unsupported" error. |
| I9 | `src/lib/mobile-scanner.ts:190-215` | Medium | On `Enter` with `barcodeBuffer>=3`, regular focused input is blanked (`target.value=''`) and handler ignores slow typing only inconsistently. | Only intercept dedicated scanner inputs; never mutate regular form inputs. |
| I10 | `src/lib/barcode-generator.ts:236-245` | Medium | `parseSKUFromBarcode` rejects `_ . /` and uppercases everything, so valid SKUs fail scan lookup in inventory. | Accept full SKU charset, preserve case, or validate against existing SKU list. |
| I11 | `src/app/inventory/page.tsx:340-352,829-838` | Medium | Scan picks first `products.find(name.includes(query))` (fuzzy, wrong hit) and `product.name.toLowerCase()` crashes if name is null. | Exact SKU/barcode match first; guard `?.toLowerCase() ?? ''` |
| I12 | `src/lib/products.ts:516-531` | Medium | `getSellableVariants` fabricates `{id:'',name:'',sku:'',base_price:0}` when expand missing instead of filtering, creating blank sellable lines. | `.filter(v=>v.expand?.product)` before mapping. |
| I13 | `src/app/labels/page.tsx:289-309` | Medium | `JsBarcode(CODE128)` on unchecked SKU; on invalid char it throws, is only `console.error`-ed, leaving a blank label that still prints. | Validate SKU charset/length up front; block print and show error if invalid. |
| I14 | `src/app/labels/page.tsx:690-696,525-527` | Medium | Qty input `Number(e.target.value)` unbounded and `flatMap(Array(quantity))` expands copies; huge qty freezes/OOMs print sheet. | Clamp qty (e.g. 1-500) on change and cap total labels per print job. |
| I15 | `src/lib/valuation.ts:93-117` | Medium | `landedUnitCost` rounds per unit, so `summariseLanded.landedValue ≠ goodsValue+allocatedOverhead` for large quantities (paise drift). | Track line landed totals in paise; derive summary from totals, not `qty*roundedUnit`. |

---

## 3. Cross-Cutting Themes

| Theme | Where | Risk |
|---|---|---|
| Client trusts client | POS totals (P1), discount uncapped (P9/P10), users page `<Can>` only (A12) | Price manipulation, free items |
| Missing tenant scope | `user_roles` (A3-A5), offline queue update/delete (P14) | Cross-tenant data leak |
| Non-atomic stock / shift writes | I1/I4, P6/P13 | Negative stock, lost updates, drawer drift |
| No idempotency | `TXN-` timestamp (P7), offline replay (P3) | Duplicate sales on retry |
| Silent failures | `catch(()=>{})` (P6), `console.error`+blank label (I13), stale permissions (A7) | Data loss hidden from operator |
| Variant resolution defaults to `[0]` | I3/I4/I6 | Wrong SKU moved / sold / labelled |

---

## 4. Recommended Fix Priority

**P0 — This week (Critical):**
- [ ] A1 Remove `?force=true` setup bypass, require authenticated admin
- [ ] A3 Tenant-scope all `user_roles` queries
- [ ] P1 Server-side recompute of POS totals, reject mismatch
- [ ] P2 Fix oversell clamp → abort or recalc totals
- [ ] P3 Idempotency key + dedupe + retry cap for offline queue
- [ ] I1 Block negative stock in `updateStock`

**P1 — Next sprint (High):**
- [ ] A2/A5/A6 System-role-only admin, validate target user tenant, last-admin guard
- [ ] A9 Remove `_superusers` fallback from normal login
- [ ] P4 Reject lines without `productId`, P8 cash tender validation, P12/P13 register validation + locked close
- [ ] I2/I3/I4/I5/I6 Variant-exact stock, per-variant edit, `barcode` field fix, variant scan lookup
- [ ] I7/I8 Fix async scanner dispatch + implement HTML5 fallback

**P2 — Backlog (Medium/Low):**
- [ ] A10/A11/A13 Session cleanup on any auth error, `is_active !== true` check, setup rollback
- [ ] P7 `crypto.randomUUID()` for txn IDs, P9/P10 discount clamps, P14 tenant-stamp all offline actions, P15 Cart null guard + line-id keys
- [ ] I9-I15 Scanner input protection, SKU charset preservation, exact search, sellable-variant filter, label validation + qty cap, landed-cost paise totals
- [ ] A14/A15 URL allowlist, explicit logout reset

---

## 5. Scope & Limitations

- Static code audit only; PocketBase API rules (`.pb` collections) and live runtime were not executed.
- 3 of 17 domains audited. Not covered: Invoices/GST/E-Way, Orders/Challan/Returns, Purchase/GRN, Banking/Ledger, Expenses, Customers/Loyalty, Vendors, Reports, WhatsApp CRM/Broadcast, Sync (Shopify/Woo/Drive), Mobile print, Settings/Barcelona. Recommended batch 2 (max 3 agents): Batch 2a Invoices/GST/Returns, Batch 2b Orders/Challan/Purchase, Batch 2c Banking/Expenses/Reports, Batch 2d WhatsApp/Sync/Mobile.
- Findings count reflects distinct file:line issues, not exploit attempts against a live instance.

---

## 6. How to Reproduce / Verify

```bash
# Type check
npm run typecheck

# Targeted logic tests for POS / stock / auth
npm test
# includes: test-pos-quantity, test-offline-queue, test-tenant-auth, test-customer-token, test-invoice-math, test-returns-policy
```

Manual checks:
- Login → `/setup?force=true` as unauthenticated user (should redirect to `/login` after fix, not re-provision).
- POS with `discount=150` (should reject, bill must not go negative).
- Offline sale with dropped response → replay (should dedupe, not duplicate stock decrement).
- `updateStock` with qty > `stock_level` (should throw, stock must not go negative).

---
*Report generated 2026-11-04. Token-efficient audit: ≤3 agents per batch. Next batch to continue with remaining 14 domains.*
