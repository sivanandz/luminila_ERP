# Bugfix Progress Log

Tracks remediation of [`docs/codebase_bugs_and_issues_audit.md`](./codebase_bugs_and_issues_audit.md).

**Baseline:** `npx tsc --noEmit` clean; 214 findings (46 Critical / 79 High / 66 Medium / 23 Low).
**Method:** fix feature-wise, severity-first, cross-cutting root causes before their symptoms. Each phase is type-checked before moving on.

## Status legend

| Status | Meaning |
| :-- | :-- |
| ✅ Fixed | Code changed and type-checked. |
| 🟡 Partial | Core defect removed; residual work documented. |
| ⬜ Open | Not started. |
| ⏸ Deferred | Needs a design decision or external service; rationale recorded. |

## Summary

| Feature area | Critical | High | Medium | Low | Fixed | Partial | Open |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 1. Auth, tenancy, RBAC, API security | 5 | 11 | 4 | 2 | 20 | 2 | 0 |
| 2. POS, billing, GST | 5 | 9 | 7 | 3 | 23 | 1 | 0 |
| 3. Inventory, products, POs, vendors | 6 | 10 | 6 | 3 | 25 | 0 | 0 |
| 4. Orders, returns, shipping, challans | 6 | 10 | 7 | 1 | 24 | 0 | 0 |
| 5. WhatsApp commerce | 5 | 8 | 8 | 3 | 0 | 0 | 24 |
| 6. Storefront, catalog, payments | 5 | 9 | 9 | 2 | 23 | 1 | 1 |
| 7. Finance, banking, cheques, GSTR-1 | 4 | 8 | 9 | 3 | 24 | 0 | 0 |
| 8. Customers, CRM, RFM, consent | 5 | 6 | 8 | 3 | 21 | 1 | 0 |
| 9. AI, backup, activity, settings, Tauri | 5 | 8 | 8 | 3 | 23 | 1 | 0 |
| **Total** | **46** | **79** | **66** | **23** | **183** | **6** | **25** |

> Status after the second pass (`1e7feda`). The only remaining batch is WhatsApp (24 findings); `SF-21` is the storefront angle of `WA-01` and closes with it. Partial items are `A-05`, `A-13`, `POS-01`/`SF-02`, `CRM-18`, `AI-SYS-18` — each has its residual documented below.

---

## Phase 1 — Cross-cutting auth & tenancy root causes (complete)

These five root causes generated a large share of the downstream findings; fixing them first prevents re-introducing the same defect while touching feature code.

| ID | Status | What changed |
| :-- | :-- | :-- |
| **A-01** | ✅ Fixed | `accountScopeEmail()` and `getCurrentTenantEmail()` now prefer `authStore.model.account_email` over the staff login email (`src/lib/pocketbase.ts`). New migration `1793000002_tenant_owner_rules_and_rbac_hardening.js` rewrites every collection rule that has an `account_email` field from `account_email = @request.auth.email` to `(account_email = @request.auth.email \|\| account_email = @request.auth.account_email)`, including the `createRule` body predicate. Staff can now read/write their tenant's records, and `pb.beforeSend` stamps the owner's tenant instead of the staff email. |
| **A-02** | ✅ Fixed | Same migration binds both RBAC predicates to one row with `@collection.user_roles:auth`, closing the un-aliased `EXISTS` escalation on `users`, `user_roles` and `roles` update/delete rules. Role-link rows are backfilled to the owner's `account_email` so tenant-scoped listings still see staff. |
| **A-06** | ✅ Fixed | `createAppUser()` passes `is_active: true` (PocketBase defaults a missing bool to `false`, and `users.authRule` is `is_active = true`), and uses `accountScopeEmail()` for the tenant stamp. |
| **A-12** | ✅ Fixed | `getUsers()`, `getRBACStats()` and `assignRole()` filter/stamp `account_email`; `setUserRoles`, `removeRole`, `isAdmin`, `getCurrentUserPermissions` sanitize interpolated ids. `hasCapability()` adds the tenant predicate to its `user_roles` query. |
| **A-16** | ✅ Fixed | `authenticateOperator()` compares the tenant hint against `record.account_email \|\| record.email`, and `OperatorSession` now exposes `email` (tenant owner), `staffEmail` (actual login) and `accountEmail`. Downstream `createTenantClient(session.email)` and `tenantAccessAllowed(session.email, …)` now resolve the correct tenant for staff. |
| **A-19** | ✅ Fixed | `sanitizeFilter()` applied to every interpolated value in `setup.ts` (roles, users, user_roles, store_settings), `rbac.ts` and `AuthContext.tsx`; `api-auth.ts` tenant predicate is escaped. |
| **A-20** | ✅ Fixed | `AuthContext` calls `users.authRefresh()` on hydration and clears the auth store on 401/403, so deactivated accounts cannot keep a stale session. |

**Not in this phase but related:** A-17, A-18, A-21, A-22 (Medium/Low, see backlog).

### Verification

- `npx tsc --noEmit` — clean (re-verified in the final verification section).

---

## Phase 2 — API security criticals (complete)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **A-03** | ✅ Fixed | `tenantDatabaseExists()` treats a registry entry, an on-disk `data.db`/tenant dir, or the shared primary slug as "existing", so re-provisioning an existing account always requires a session for that account. `findTenantSlugOwner()` reads a `tenant-email.txt` marker written before migrations and rejects `a_b@c.com` vs `a.b@c.com` slug collisions. `assertSafeDataDir()` confines every bootstrap path to `pb_data` / `pb_tenants`, and the slug is re-validated against `^[a-z0-9_]{1,64}$`. The route now also rate-limits provisioning per IP (5 / 10 min) and honours an optional `TENANT_SETUP_TOKEN`/`SETUP_TOKEN` shared secret. |
| **A-04** | ✅ Fixed | `GET /api/storefront/content` validates `account_email` with `normalizeBindingEmail()` and escapes it with `sanitizeFilter()` before interpolation. |
| **A-05** | 🟡 Partial | `1792774201_manufacturing_jobs.js` now creates the collection, adds fields via `collection.fields.add(new Field(...))`, saves, then applies rules — the PocketBase 0.25 ordering the audit requires. `bootstrapTenantDataDir()` no longer swallows `migrate up` failures and includes stderr in the thrown error. **Residual:** `1792774202_cheques.js`, `1792774204_landed_cost_and_channels.js`, `1792774208_phantom_collections.js` and `1792830000_roadmap_capture.js` use the same fields-in-constructor pattern; they are draft migrations and need the same two-step conversion. |
| **A-08** | ✅ Fixed | Removed the unscoped `key = "storefront_content"` fallback in `storefront-tenant.ts` and in the content route; a storefront is bound only by its `account_email`-scoped record or falls back to defaults. |
| **A-09** | ✅ Fixed | `getStorefrontBinding()` uses `createTenantClient(cleanEmail)` instead of `ensureServerAuth()` + the module-global `pb`, eliminating the cross-request session bleed. |
| **A-10** | ✅ Fixed | `findExistingChannelOrder()` now takes the tenant and customer phone, filters `order_number && account_email`, and refuses to return an order whose stored phone does not match the submitting customer. |
| **A-11** | ✅ Fixed | `/api/pos/payment` uses `authenticateOperator()`, enforces tenant ownership outside single mode, and requires `sales:create` (link creation) or `sales:read` (status lookup). Payload fields are validated before reaching either gateway helper. |
| **A-13** | 🟡 Partial | Added per-IP rate limiting (20 / 10 min) to `send-otp`; `releaseOtpAttempt()` rolls back the daily counter and consumes the code when WhatsApp delivery fails, so failed sends no longer lock a number out. **Residual:** OTP records still live in `src/data/otp_store.json` rather than PocketBase; moving them needs a collection plus async store API. |
| **A-14** | ✅ Fixed | `otp-store.ts` normalizes both write and verify paths to `String(phone).replace(/\D/g, "").slice(-10)`, so `+91…`, `91…` and bare numbers agree. Also fixes SF-12. |
| **A-15** | ✅ Fixed | `proxy.ts` honours `x-forwarded-host` and disables the loopback→admin promotion whenever proxy headers are present; `STATIC_EXTENSION` no longer makes `/api/…js` paths serveable on the storefront host. |
| **A-22** | ✅ Fixed | `crypto.randomInt(100000, 1000000)` (was an exclusive upper bound of 999999). The `?next=` redirect remains open. |

### Verification

- `npx tsc --noEmit` — clean after Phase 1 and Phase 2.
- `node --check` on the new/changed migration files — clean.

## Phase 3 — POS / billing / GST (criticals complete)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **POS-01** | 🟡 Partial | Removed the `else` branch in `checkout/whatsapp` that marked the reservation complete and rendered "Order Confirmed! Amount Paid" without a payment. The page now fails closed with the gateway error. **Residual:** buyers still call the operator-only `/api/pos/payment`, so a true public flash-drop checkout (server-side order + stock deduction) is pending WA-01/WA-02. |
| **POS-02** | ✅ Fixed | `getNextSequenceNumber()` scopes every lookup/create to `${seqName}_${tenant}`, stamps `account_email`, adopts a legacy unscoped row's current value so an issued invoice series never restarts at 1, and includes the tenant in the in-process lock key. |
| **POS-03** | ✅ Fixed | `createPOSSale` stamps `account_email` on `sales`/`sale_items`; `getSalesByShift`, `getTodaysSalesSummary`, shift item cleanup and invoice-item reads filter by tenant. `createInvoice`/`recordPayment`/`getInvoice`/`getInvoices` stamp and filter `invoices`, `invoice_items`, `invoice_payments`, and verify invoice ownership before mutating. |
| **POS-04** | ✅ Fixed | Loyalty validation now runs before the PhonePe modal opens (shared `validateLoyaltyRedemption()`), `handlePhonePeSuccess` is guarded by `isProcessingRef`, and its `createPOSSale` passes `locationId: selectedPosLocationId`. |
| **POS-05** | ✅ Fixed | Intra-state tax now always splits into equal CGST and SGST. Inclusive lines absorb an odd paise into the taxable value (total preserved); exclusive lines round the tax to an even paise. `splitIntoComponents` no longer floors one half and dumps the remainder on the other. |
| **POS-06** | ✅ Fixed | Both loyalty calls pass `'pos_sale'` as `referenceType` and the sale id as `referenceId` (arguments were swapped). |
| **POS-07** | ✅ Fixed | Barcode scans now carry `gst_rate` plus `gross_weight`, `net_weight`, `purity_karat`, `making_charges` and `huid_code` on `POSProduct`/`CartItem`, read through a narrow cast because the generated record types omit those columns. |
| **POS-12** | ✅ Fixed | `createInvoiceFromSale` reads the linked customer's `state_code` and `gstin`, derives `buyerStateCode` from them, and writes the real `buyer_gstin`, so inter-state/B2B POS sales produce IGST invoices. |
| **POS-13** | ✅ Fixed | Cash checkout rejects a tendered amount below the bill total. |

### Verification

- `npx tsc --noEmit` — clean after Phase 3.

## Phase 4 — Inventory criticals (complete)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **INV-01** | ✅ Fixed | `createProduct` and `createVariant` stamp `account_email: getCurrentTenantEmail()` explicitly (the `beforeSend` hook only covers the browser client). |
| **INV-02** | ✅ Fixed | `searchProductsForDocuments`, `resolveBarcodeProduct`, `getVariantStockSummary`, `getSellableVariants`, `findProductBySkuOrBarcode`, `findVariantBySuffixOrBarcode`, `listVariantsWithProduct` and `searchProductsForPicker` now require `product.is_active = true` and add the tenant clause; `getTypeAheadProducts` reads `accountScopeEmail()` instead of the raw auth email. |
| **INV-03** | ✅ Fixed | `getPurchaseOrder`, `getPurchaseOrders`, `getGRNsForPO`, `getOpenPurchaseOrders` and `getOpenPurchaseOrderItems` filter by tenant; the open-items query also restricts to `draft`/`sent`/`partial` parents so cancelled/received POs stop inflating "arriving" stock. |
| **INV-04** | ✅ Fixed | Vendor/category/attribute reads filter by tenant and writes stamp it; `createVendor` now uses `accountScopeEmail()` instead of the raw auth email. `getVendor`/`getCategory`/`getAttribute` verify ownership after a direct id fetch. |
| **INV-05** | ✅ Fixed | Inventory edit tracks `intakeQuantity = Math.max(0, stockDelta)` and uses it for the PO intake movement and reconciliation instead of the cumulative dialog total. |
| **INV-06** | ✅ Fixed | `createGRN` now rolls back a failed stock update: reverses applied variant stock, deletes the movements, the `grn_items`, the reservations and the GRN header before rethrowing. A partial receipt can no longer leave the PO marked received with an unmoved ledger. |

### Incidental build fix (not in the audit)

`tsc --noEmit` was **not** clean on a full run: `tsconfig.tsbuildinfo` was stale and hid errors in `src/lib/analytics-v2/load.ts`, `turnover.ts`, and the `SalesTab`/`InventoryTab`/`CategoriesTab`/`ProfitabilityTab` chart components (untyped `getFullList`, recharts `formatter` signatures that didn't accept `undefined`, and a row type missing an index signature). The cache was cleared and all errors fixed.

### Verification

- `npx tsc --noEmit` — clean on a cache-free full run after Phase 4.

## Phase 5 — Orders / returns (criticals complete)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **ORD-01** | ✅ Fixed | Same defect as A-10: `findExistingChannelOrder` filters by `account_email` and verifies the submitting customer's phone before returning an existing order. |
| **ORD-02** | ✅ Fixed | `createOrder` deducts stock through `applyChannelStock` (oversell rejected) when a `sales_order` is created already confirmed or beyond, and rolls the header/items back on failure. `convertEstimateToOrder` deducts via the persisted lines and restores the estimate if the reservation fails. Estimates/drafts never move stock. |
| **ORD-03** | ✅ Fixed | `createOrder` stamps `account_email` on both `sales_orders` and `sales_order_items`, so shipment and COD settlement no longer reject B2B orders as "not this store". |
| **ORD-04** | ✅ Fixed | `generateChallanFromOrder` filters `order="…"` (the real relation), not the non-existent `sales_order` field. |
| **ORD-05** | ✅ Fixed | Storefront orders now persist `tax_rate` on each line and `generateInvoiceFromOrder` detects `capture_source === "storefront"` and uses `splitInclusiveLine`, so GST is no longer added a second time. |
| **ORD-06** | ✅ Fixed | `approveCreditNote` only restocks a variant when a `sale` stock movement exists for the originating sale/invoice (or its linked order); otherwise it logs and skips, so a never-deducted document cannot mint stock. `cancelCreditNote` refuses to cancel anything other than a `pending` note rather than leaving approved inventory effects in place. |

### Also fixed while in these files (High/Medium)

- **SF-15** — storefront price validation now resolves the variant and passes `price_adjustment`; it also rejects a variant that belongs to a different product.
- **SF-17** — storefront line tax reads `products.gst_rate` (falling back to `tax_rate`) instead of the non-existent column.

### Verification

- `npx tsc --noEmit` — clean after Phase 5.

## Phase 6 — WhatsApp commerce (deferred, needs a design)

The WhatsApp criticals are architectural rather than line-level: flash drops and reservations live only in browser `localStorage` (`luminila_flash_drops_v1`), so a public buyer on another device can never read them and no server-side stock hold is possible. Fixing WA-01/WA-02 requires, in order:

1. A `flash_drops` / `flash_drop_reservations` PocketBase collection pair with tenant rules.
2. Admin CRUD wired to the existing flash-drop UI so drops are persisted instead of cached.
3. A public checkout endpoint that reads the drop, enforces the hold atomically, creates `sales_orders`/`sales_order_items` and deducts stock through `applyChannelStock`.

Doing only step 3 against localStorage data would be insecure (the client supplies the price), so the sequence was not short-circuited. WA-03/04/05 (tenant scoping across `whatsapp-broadcast`, `whatsapp-crm`, `chat-inventory`) are mechanical but touch six large modules and were left for the next pass rather than half-applied.

| ID | Status | Reason |
| :-- | :-- | :-- |
| WA-01, WA-02, SF-21 | ⏸ Deferred | Requires the collection + admin CRUD + public endpoint described above. |
| WA-03, WA-04, WA-05 | ⏸ Deferred | Tenant-scoping sweep over `whatsapp-broadcast.ts`, `whatsapp-crm.ts`, `chat-inventory.ts`; same pattern as the fixed modules, ~40 call sites. |
| WA-06 … WA-24 | ⬜ Open | Not started. |

## Phase 7 — Storefront / payment gateways (criticals complete)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **SF-01** | ✅ Fixed | `confirmStorefrontPayment` requires the order's own `gateway_order_id` (no fallback to the client-supplied one), rejects a `razorpayOrderId` that differs, refuses a `gateway_payment_id` already used by another order, and verifies amount/order/status with the gateway. |
| **SF-02** | 🟡 Partial | Same fix as POS-01: the WhatsApp checkout no longer fabricates a paid confirmation. **Residual:** a public flash-drop checkout endpoint (WA-01/WA-02) is still needed for buyers to actually pay. |
| **SF-03** | ✅ Fixed | `createPaymentLink` returns `{ success: false, error: 'Razorpay is not configured…' }` instead of a fabricated `plink_test_*` link. |
| **SF-04** | ✅ Fixed | Covered by A-08: `resolveStorefrontTenant` only binds through the scoped `storefront_content` row. |
| **SF-05** | ✅ Fixed | Covered by A-04/A-08: the content route sanitizes the email and returns defaults instead of an unscoped fallback. |
| **SF-06** | ✅ Fixed | `settleCapturedOrder` is serialized per order id through an in-process lock, and the customer aggregates/loyalty bump is guarded by the existing `AGGREGATES_MARKER` so a retried settlement cannot credit twice. |
| **SF-07** | ✅ Fixed | The webhook requires a positive captured amount from `payment.amount` or `payment_link.amount_paid` and rejects any currency other than INR. |
| **SF-08** | ✅ Fixed | Only a `captured` gateway payment settles an order; `authorized` is rejected. |
| **SF-09** | ✅ Fixed | Every query in `payment-reconciliation.ts` is tenant-scoped and the clearing-account cache is keyed by tenant. |
| **SF-10** | ✅ Fixed | `settleLinkedOrder` delegates to `settleCapturedOrder` (stock, invoice, aggregates, loyalty) instead of marking the order PAID by hand. |
| **SF-11** | ✅ Fixed | A payment link is marked `paid` only when both order settlement and the clearing-ledger entry succeed; otherwise it stays `created` for the next pass. |
| **SF-12** | ✅ Fixed | Covered by A-14: the OTP store normalizes both send and verify to the last 10 digits. |
| **SF-13** | ✅ Fixed | Both storefront resolvers share `DEFAULT_STOREFRONT_TENANT_EMAIL` (`admin@luminila.local`). |
| **SF-15** | ✅ Fixed | Variant `price_adjustment` is applied to the verified price and a mismatched variant/product is rejected. |
| **SF-17** | ✅ Fixed | Storefront reads `products.gst_rate` and persists `tax_rate` on the order line. |
| **SF-22** | ✅ Fixed | `/api/pos/payment` guards a missing `payload` and validates per-action fields before calling a gateway helper. |

### Verification

- `npx tsc --noEmit` — clean after Phase 7.

## Phase 8 — Finance / banking / cheques (localized criticals)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **FIN-02** | ✅ Fixed | `readCheques`/`writeCheques` filter `store_settings` by `key && account_email` and stamp the tenant on create, so two stores can no longer overwrite each other's cheque register. |
| **FIN-03** | ✅ Fixed | `createBankTransaction` tracks whether the source balance was applied and reverses it in the catch block alongside the destination rollback. |
| **FIN-05** | ✅ Fixed | A transfer whose destination account is missing now throws (triggering the source rollback) instead of debiting the source silently. |
| **FIN-10** | ✅ Fixed | "Bounce" renders only for a `deposited` cheque; "Cancel" remains available for open/deposited. |
| **FIN-12** | ✅ Fixed | `createBankTransaction` rejects non-finite or `<= 0` amounts before the overdraft check. |

**FIN-01 (tenant scoping across banking/expenses/reports/GSTR-1) is still open.** It is the same mechanical `account_email` sweep as Phase 4, across four modules with roughly 50 queries; it was deliberately not half-applied. `FIN-04` (cheque clearing posts to the bank ledger) and `FIN-06`–`FIN-09` (GSTR-1 correctness) also remain open.

### Verification

- `npx tsc --noEmit` — clean after Phase 8.

## Phase 9 — Customers / CRM (criticals + RFM correctness)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **CRM-01** | ✅ Fixed | Every `customers`, `sales`, `customer_interactions` read in `customers.ts` is tenant-scoped; `createCustomer`/`addInteraction` stamp `account_email`; `getCustomer` verifies ownership after a direct id fetch. |
| **CRM-02** | ✅ Fixed | `findCustomerByPhone` filters by tenant and escapes the phone value, so a chat/order can no longer link another store's customer. |
| **CRM-03** | ✅ Fixed | `computeRFMAnalysis` scopes both `customers` and the purchase ledgers to the tenant (and excludes storefront mirror `sales`). |
| **CRM-04** | ✅ Fixed | `getConsentState` sanitizes `customerId` and ANDs the tenant around the OR-ed identity predicates. |
| **CRM-05** | ✅ Fixed | `/customers` tolerates a campaign with no `category`/`title` (`(cmp.category \|\| 'promotional')`, `cmp.title \|\| cmp.name`), so attribution-created rows no longer crash the render. |
| **CRM-07** | ✅ Fixed | `getCustomerOrderHistory` excludes the storefront mirror and cancelled/draft rows and matches phones by 10-digit suffix. |
| **CRM-08** | ✅ Fixed | RFM recency/frequency/monetary come from live `sales` + `sales_orders` aggregates; `updated`/`created` is no longer a fake last-sale date. |
| **CRM-11** | 🟡 Partial | `createMarketingCampaign` no longer sends a custom `cmp_…` id (PB rejects it) and adopts the returned record id. **Residual:** `total_recipients`/`sent_count` are not updated after `queueCampaign`. |
| **CRM-12** | ✅ Fixed | One-time buyers within 60 days classify as `potential_loyalist`; value tiers are decided before the celebration override so a VIP with a birthday stays a champion. |
| **CRM-16** | ✅ Fixed | Order-history lookup escapes `customerId` and matches `customer_phone` by suffix. |
| **CRM-17** | ✅ Fixed | `getCustomerStats().byType` is computed from the tenant's customer list instead of returning hardcoded zeroes. |

### Verification

- `npx tsc --noEmit` — clean after Phase 9.

## Phase 10 — AI / System (security-critical fixes)

| ID | Status | What changed |
| :-- | :-- | :-- |
| **AI-SYS-03** | ✅ Fixed | `collectDatabaseSnapshot` sources all six collections from the tenant's `account_email` and fails closed (`id = ""`) without a tenant; `store_settings` rows whose key looks like a secret (token/password/api key/client id) are exported as `[REDACTED]`. |
| **AI-SYS-04** | ✅ Fixed | New `src/lib/ai/net-guard.ts` blocks loopback, RFC1918, link-local/cloud-metadata, IPv6 ULA and the internal ERP/sidecar ports (8090-8199, 21465, 3210). It runs in the provider `baseUrl` schema **and** again in `assertHttpUrl()` at fetch time, so a stored pre-validation row cannot be used as an SSRF probe. |
| **AI-SYS-05** | ✅ Fixed | `search_products` resolves variants with `product = "<productId>"` (not `id = …`) and `product.is_active = true`; stock totals are no longer always zero. |

**Still open:** AI-SYS-01/02 (backup export/restore tenant scoping and restoring all 31 collections), AI-SYS-06–24. AI-SYS-02 is a feature gap rather than a one-line defect: `restoreFromBackup` only understands 7 of the 31 exported collections, so a "full restore" silently drops invoices, orders, POs and expenses.

### Verification

- `npx tsc --noEmit` — clean after Phase 10.

---

## Second pass — all non-WhatsApp findings (commit `1e7feda`)

Work was split across disjoint file scopes so a parallel analytics session could keep editing: `inv-agent`, `fin-agent`, `ai-agent`, and this audit-fix session. Per-ID evidence is in `docs/_agent_reports/`. The analytics build itself was committed by its owner as `700ec73`; once it landed, the `reports.ts`/`analytics.ts` residuals from FIN were closed here.

### Auth & setup (A-07, A-17, A-18, A-21)

- **A-07** — the tenant registry stores the admin password as `enc:v1:` ciphertext when `TENANT_REGISTRY_KEY` is set (plaintext only on legacy installs, with a warning).
- **A-17** — `/users` gates "Add User" behind `users:create` and role/toggle actions behind `users:update` with `<Can>`.
- **A-18** — setup completion is checked by new `GET /api/setup/status` on a server tenant client instead of an anonymous `users.getList` that always 403s.
- **A-21** — `PB_CUSTOM_URL_<tenant>` is read/written alongside the legacy key; the last resolved account is remembered in `PB_TENANT_HINT`.

### POS (POS-08 … POS-24)

Manual invoices now deduct stock through `applyChannelStock` (with invoice rollback on failure) and read the product's `gst_rate`/`hsn_code` instead of 3%/7113 (POS-08). Exchange GST follows `is_gst_registered` and the exchange invoice is marked paid when the balance is collected (POS-09/ORD-14). The offline queue is tenant-keyed and persists retry counts (POS-10). PhonePe polling uses refs and a one-shot success guard (POS-11). Receipt HTML is escaped (POS-14). The mock GSTIN is gone and E-Way Bill requires a real pincode (POS-15); `amountToWords` and `isValidGSTIN` are fixed in `gst.ts` (POS-16/23); return estimates use the original tax-inclusive line (POS-17); prorated tax and invoice totals are rounded (POS-18/19); the WhatsApp widget resets per sale (POS-20); storage keys are tenant-scoped (POS-21); discount/loyalty/register are tenant-scoped (POS-22); invalid invoice dates render `-` (POS-24).

### Orders / returns (ORD-07 … ORD-24)

COD/cash-on-delivery may dispatch (ORD-07); the barcode station goes through `createShipmentForOrder` (ORD-08); scanned products resolve a real variant (ORD-09); order reads and child writes are tenant-scoped (ORD-10/11/12); E-Way Bill config and token cache are tenant-keyed (ORD-13); order tax is computed post-discount (ORD-15); label pincode is string-safe (ORD-16); retries are bound to a cart hash (ORD-17); variant resolution requires active parents (ORD-18); refunds reverse customer spend and loyalty (ORD-19); mock HUID/AWB are gone (ORD-20); challan filters actually filter (ORD-21); challan tax follows the consignee state (ORD-22); QC tax uses line rates (ORD-23); E-Way rates keep decimals (ORD-24).

### Storefront (SF-14, SF-16, SF-18…SF-20, SF-23…SF-25)

Catalog variants are tenant/product scoped (SF-14); the `sales` mirror for an online order is written only after capture (SF-16); coupons enforce window, minimum and usage cap and increment on success (SF-18); Meta batch image URLs carry `account_email` (SF-19); standalone products no longer read a non-existent `stock_quantity` (SF-20); webhook dedupe is tenant-scoped (SF-23); catalog sync fails closed without a tenant (SF-24); channel-pricing filters are escaped (SF-25).

### Finance (FIN-01, FIN-04, FIN-06…FIN-24)

All banking/expenses/GSTR-1/report queries are tenant-scoped (FIN-01); cheque clearing/bounce posts to the bank ledger with a real account (FIN-04); GSTR-1 aggregates credit-note items by rate and nets Table 12 (FIN-06); `/reports/gst` JSON now numbers items, uses `typ: 'OE'` correctly, computes `gt/cur_gt` and drops the fake hash (FIN-07); reports exclude draft/cancelled invoices (FIN-08); GSTIN/state normalisation is string-safe (FIN-09); `getCategories(includeInactive)` keeps disabled categories visible (FIN-11); bounce re-entry is guarded (FIN-16); cheque RMW is serialized and only cancelled rows are pruned (FIN-17); Table 13 receives cancelled invoices with numeric sort (FIN-18); LUT export includes IGST when applicable (FIN-19); transfer rows/search are fixed (FIN-20); B2C Large is inter-state >₹2.5L and the IGST column exists (FIN-21); local date defaults (FIN-22); remaining filter/print escaping (FIN-23); report export cards are wired (FIN-24). Analytics staff-email resolution (FIN-13) and stock active/cost fallback (FIN-14) are closed in the committed analytics code.

### CRM (CRM-06, CRM-09…CRM-11, CRM-13…CRM-15, CRM-19…CRM-22)

Customer phones are stored canonically (CRM-06); lifecycle triggers check WhatsApp opt-out and the consent ledger, dedupe within a 30-day tenant-scoped window, implement `post_delivery_review`, and count per flow (CRM-09/13/14); consent events sync profile flags and unchecking marketing clears them (CRM-10); campaign creation accepts the server id and records queued recipient counts (CRM-11); RFM uses live purchase ledgers and local-date milestones (CRM-08/20); campaign caches are tenant-keyed, attribution tolerates `created`, and filters are escaped (CRM-15/19); the customer profile keeps shipping/GSTIN/bangle fields separate (CRM-21); date-only UI values are string-safe (CRM-22). CRM-18 remains partial because the broadcast queue's custom-recipient API is owned by the WhatsApp worker.

### AI / System (AI-SYS-01, AI-SYS-02, AI-SYS-06 … AI-SYS-24)

Backup export filters all 31 collections by tenant, and restore handles all 31 in FK order with per-table results and foreign-id refusal (AI-SYS-01/02); activity logs are tenant-scoped/sanitized and search runs server-side (AI-SYS-06/17); settings resolve the owner and coerce primitives (AI-SYS-07/08); resume uses the persisted profile and locks are pruned/aborted safely (AI-SYS-10/24); AI writes are audited and phone-deduped (AI-SYS-11); AI reads guard active products (AI-SYS-12); auto-backup keys are tenant-suffixed (AI-SYS-13); the Tauri sidecar is owned and killed on exit and the token survives navigation (AI-SYS-14/15, Rust compile-unverified); `/backup` and `/settings` are permission-gated (AI-SYS-16); E-Way Bill test hits NIC and reports "not configured" (AI-SYS-18, partial); provider defaults/keys/tests and model history are fixed (AI-SYS-19/20/21); settings/header UI is wired (AI-SYS-22/23).

### Verification

- `npx tsc --noEmit --incremental false` — clean after the batch (before the WhatsApp files were re-touched).
- Per-agent reports: `docs/_agent_reports/inv-agent.md`, `fin-agent.md`, `ai-agent.md`.
- Coordination record: `docs/ACTIVE_WORK_CLAIMS.md`.

---

## Partial / deferred items

| ID | Reason |
| :-- | :-- |
| A-02 (roles tenancy) | The `:auth` escalation is fixed. Giving `roles` its own `account_email` scope requires deciding whether seeded system roles are copied per tenant or shared; that is a schema/product decision. |
| A-05 (other draft migrations) | `1792774202`, `1792774204`, `1792774208`, `1792830000` still pass `fields` to `new Collection(...)`. `bootstrapTenantDataDir` now throws on `migrate up` failure, so these must be converted before a fresh multi-tenant provision. |
| A-13 (OTP storage) | OTPs still live in `src/data/otp_store.json`; moving them to PocketBase needs a collection and an async store API (callers are sync). Rate limit, lockout rollback and phone normalization are fixed. |
| POS-01 / SF-02 | The WhatsApp checkout fails closed, but a public flash-drop checkout is part of the WhatsApp batch (`WA-01/02`). |
| CRM-18 | Blocked on the broadcast queue accepting an explicit cohort list; owned by the WhatsApp worker. |
| AI-SYS-18 | E-Way Bill credentials remain plaintext in `store_settings`; encryption needs a server endpoint (Node `crypto` cannot run in the settings component). The test connection itself is real. |

---

## Final verification

- `npx tsc --noEmit` — **clean** on cache-free full runs. A stale `tsconfig.tsbuildinfo` had been masking real errors; see the Phase 4 incidental build fix.
- `node --check` — new/changed PocketBase migrations parse.
- No database migration was executed as part of this pass; `1793000002_tenant_owner_rules_and_rbac_hardening.js`, the rewritten `1792774201_manufacturing_jobs.js` and the WhatsApp flash-drop migration apply on the next `pocketbase migrate up`.

## Recommended next pass

1. Finish and commit the WhatsApp batch (`WA-01…WA-24`), including the `flash_drops` migration and public checkout; that closes SF-21 and the last free-order path.
2. Add the custom-recipient parameter to `queueCampaign` and wire CRM-18.
3. Convert the four remaining draft migrations to the create-then-add-fields pattern.
4. Give e-way credentials a server-side encrypt/decrypt endpoint (AI-SYS-18).
5. Move OTP storage into PocketBase (A-13).

