# Independent Adversarial Audit — UI & Tenant Isolation

**Revision:** 3 — remediation implemented and re-verified (2026-11-04)
**Date:** 2026-11-04
**Repo:** `E:\Local_GIT_2\luminila_inv_mgmt` (branch `feat/inventory-packing-v2`, HEAD `6633557`)
**Auditor stance:** adversarial, evidence-first. Every finding below is either source-verified with `file:line` or empirically reproduced against a throwaway PocketBase instance. Claims I could not reproduce are labelled **unverified**.

---

## 0. Verdict

**The app is not tenant-safe as a multi-tenant product, and its UI-layer data handling is not defensible even in the shipped single-account mode.**

- **In the shipped configuration** (`TENANT_MODE` unset → `single`, one account), the physical-DB boundary collapses every account to one database, so most cross-tenant read paths in this report cannot cross a real tenant. What remains is still serious: **any staff account can bypass the UI's role model through the PocketBase API**, a **Viewer can read OTP salts and recover customer login codes**, **the full customer/order/bank export sits in `localStorage`**, and **the storefront leaves the previous customer's name, phone and address on a shared device**.
- **If `TENANT_MODE=multi` is enabled** (documented, supported, one env var + rebuild away), three code paths become **anonymous cross-tenant read/write primitives** because public storefront routes accept a caller-supplied email and then open *that tenant's* database with *that tenant's superuser credentials*.
- The PocketBase rules are the only tenant boundary. Several of them are one missing `@request.body.account_email:isset = false` away from allowing tenant re-homing, and five collections deliberately share an `account_email=""` space across all authenticated users.

**Risk posture:** acceptable for a single-merchant deployment with a small, fully trusted staff; **not acceptable** for the multi-account product the code advertises, and **not acceptable** for a shared POS terminal.

**Revision 2 re-verification.** Another agent's uncommitted work added `pocketbase/pb_migrations/1793003000_seal_public_catalog.js` (canonical set is now 115 migrations), disabled web provisioning, sealed the setup wizard, and added a logout `localStorage` sweep. I rebuilt the isolated DB from the **current** migration set and re-ran every probe:

- **Fixed:** anonymous `products`/`product_variants` reads are now blocked (`R-01`, `R-02`), and product re-homing is blocked (`R-04`).
- **Unchanged and still reproducing:** Admin user re-homing → cross-tenant read (`R-05/R-06`), OTP salt recovery (`R-07`), OTP row re-homing (`R-08`), empty-owner location read/delete across tenants (`R-09/R-10`), anonymous consent read/create (`R-11`), Viewer deleting customers and listing users (`R-12/R-13`).
- **New regression:** the catalog seal breaks the storefront's anonymous PB fallback (`storefront/src/lib/pocketbase.ts:133-143`), which is now permanently empty/403. See L-04.
- **Caveat:** the new migration is **untracked**, is **not in `server-dist`** (still 96 migrations), and the live PB on 8091 was not reachable during re-verification, so live application is unconfirmed.

Full results in §8.1.

**Revision 3 — remediation.** The still-open findings were then fixed in code (uncommitted, per repo convention) and re-verified on a fresh 116-migration instance. Every rule-layer leak in this report is now empirically closed; the two remaining opens are a **product decision** (RBAC at the data plane, C-05) and the **browser-storage design** items (C-07 partial, C-08, M-04 partial, M-06). The fix manifest and the V-series probe results are in §8.2; the Rev-2 history is kept below for traceability.

---

## 1. Scope, method, and mode caveats

**In scope**
- All 25 API routes under `src/app/api`
- Server auth/tenancy: `src/lib/api-auth.ts`, `tenant-db-manager.ts`, `pocketbase.ts`, `storefront*.ts`, `otp-store.ts`, `razorpay-webhook-handler.ts`, `ai/*`
- Client state/UI: `AuthContext`, `usePermissions`, `rbac.ts`, storefront contexts/components, inventory quick-add, SKU taxonomy, WhatsApp sync, backup, POS, assistant
- PocketBase schema/rules: all 114 migrations + live rules read from the isolated instance
- Release artifact: `server-dist` vs canonical migrations

**Empirical harness**
- Fresh PocketBase 0.25.0 instance on `127.0.0.1:8099`, isolated data dir under `scratch/audit-pb`, all 114 migrations applied, synthetic users `alpha@shop.local` / `beta@shop.local` / `viewer@shop.local`, synthetic customers/products/OTP rows.
- Nothing was run against the live DB on 8091 and no live data was read.
- Probes and results are in §8.

**Mode caveat (important)**
- `src/lib/deployment-mode.ts:76-78` defaults to `single`; `.env.local` sets neither `TENANT_MODE` nor `NEXT_PUBLIC_TENANT_MODE`.
- In `single`, `SINGLE_ACCOUNT_EMAIL` defaults to `niththigal@gmail.com` (`deployment-mode.ts:18,117-121`), and `createTenantClient()` returns one primary client regardless of the email argument (`pocketbase.ts:133-142`).
- In `multi`, `createTenantClient(email)` **authenticates against the named tenant's database using that tenant's stored superuser credentials** (`pocketbase.ts:128-174` → `tenant-db-manager.ts:630-677`). This is the fact that turns caller-supplied emails into cross-tenant access.

Severity in this report is stated **per mode**. A finding marked “multi-only” is latent in the current deployment, not fictional.

---

## 2. Findings summary

| ID | Severity | Mode | Finding | Evidence |
|---|---|---|---|---|
| C-01 | **Critical → fixed (Rev 3)** | multi | Anonymous caller selects any tenant and reads its CMS/contact/promo content through a per-tenant **superuser** client | `storefront/content/route.ts:259-300`; fixed via allow-list resolver |
| C-02 | **Critical → fixed (Rev 3)** | multi | Anonymous caller mints a 30-day customer session for any tenant and writes orders, stock movements and coupon usage into that tenant's DB | `verify-otp/route.ts:42-46,129-134`; fixed via allow-list resolver |
| C-03 | **High → fixed (Rev 3)** | shared DB | Tenant Admin can re-home a user into another tenant's `account_email`; that user then reads the victim's rows | `users` update rule; reproduced PB-10/11; **fixed + verified V-03/V-04** |
| C-04 | **High → fixed (WT)** | all | Anonymous product/variant read exposes `cost_price`, stock, HSN, barcode, making charges, wastage | live rule; reproduced PB-06; **fixed in current migration set — R-01/R-02/R-04** |
| C-05 | **High** | all | RBAC exists only in the UI; PocketBase rules do not check roles, so any staff token can delete/update most business records | `customers` delete rule; **reproduced PB-15** |
| C-06 | **High → fixed (Rev 3)** | all | `otp_codes` is readable by any authenticated tenant user; the salt is stored with the hash, so a 6-digit OTP is recoverable offline | reproduced PB-05b; **collection sealed + peppered hash, verified V-05..V-07** |
| C-07 | **High** | all | Full DB export (customers, orders, invoices, bank txns) is persisted in `localStorage`, keyed to the shared account in single mode, never cleared | `backup.ts:430-442`; `AuthContext.tsx:142-153` |
| C-08 | **High** | all | Storefront customer identity and cart are global `localStorage`, no expiry, no clear on shared device; checkout pre-fills the previous customer's address | `CustomerAuthContext.tsx:32-73`; `checkout/page.tsx:53-56,489` |
| C-09 | **High → fixed (Rev 3)** | multi | Module singletons (`quick-add-memory`, `sku-generator`) carry tenant A's data into tenant B and **write it into B's `store_settings`** | fixed with tenant-stamped `ensureTenantScope()` on every accessor |
| M-01 | Medium → **fixed (Rev 3)** | shared DB | Five collections share `account_email=""` rows with every authenticated user; `consent_events` is public read+create for empty rows | reproduced PB-07..13; **backfill + "" arm removed + owner required, verified V-08..V-11** |
| M-02 | Medium → **fixed (Rev 3)** | all | Storefront catalog resolves one tenant in single mode; OTP/order resolve a different legacy tenant → checkout mismatch | `getStorefrontBinding` now pins `SINGLE_ACCOUNT_EMAIL` in single mode |
| M-03 | Medium → **fixed (Rev 3)** | all | Flash-drop confirmation treats a missing phone and missing signature as “verified”; empty-owner orders/drops pass the tenant check | `belongsToTenant` strict + mandatory phone match |
| M-04 | Medium | multi | `/api/system/tenant-db` is an unauthenticated tenant/port oracle; provisioning is unauthenticated when no setup token is set; rate limit key is client-controlled | `system/tenant-db/route.ts:24-47,71-96,162` |
| M-05 | Medium → **fixed (Rev 3)** | shared DB | Razorpay webhook trusts client-settable `notes.order_id` and loads the order unscoped; payment status actions are not tenant-bound | order load now tenant-scoped, fail-closed; razorpay status tenant-bound |
| M-06 | Medium | release | Checked-in `server-dist` has 96 of 114 migrations; stale `users` rules are `@request.auth.id != ""` and `account_email` does not exist | `server-dist/pocketbase/pb_migrations`; `1700000000_initial_schema.js` |
| M-07 | Medium → **fixed (Rev 3)** | multi | PB base URL is sticky global state; logout does not reset it or scoped URL keys; a failed tenant resolve can authenticate against the previous tenant's DB | `resetPocketBaseClientState()` on logout: unsubscribe + realtime disconnect + URL keys + re-point default |
| M-08 | Medium → **fixed (Rev 3)** | all | AI conversation `created_by` is the tenant owner for every staff login, so staff share each other's transcripts | `operatorEmail` now uses `session.staffEmail` |
| L-01 | Low → **fixed (Rev 3)** | shared DB | E-way credential read has `|| account_email=""` and preserves an empty owner | strict owner filter; owner always stamped on write |
| L-02 | Low | all | Login prefills the account email; `/api/setup/status` is an anonymous setup oracle; catalog-image and legacy-order empty-owner paths | setup oracle **patched by concurrent agent**; the rest unchanged |
| L-03 | Low | all | OpenAI/Anthropic-style provider keys, e-way secrets and backup payloads all touch browser storage or browser-readable endpoints; `channel-pricing` cache uses staff email instead of tenant | unchanged |
| L-04 | Low (functional) → **fixed (Rev 3)** | all | Catalog seal breaks the storefront's anonymous PocketBase fallback; if the ERP API is unreachable the catalogue now renders empty instead of falling back | dead fallback removed deliberately; offline builds use `STOREFRONT_CATALOG_SNAPSHOT` |

**Count (Rev 3):** open = C-05 (RBAC, needs a decision), C-07 (partial), C-08, M-04 (partial), M-06, L-02 (partial), L-03. Everything else in this table is fixed in the working tree and — for every PocketBase-rule finding — empirically re-verified (§8.2).

### Revision 2 status (superseded by Revision 3)

The worktree changed **during** this audit; another session is actively patching. The findings above describe HEAD `6633557` plus the audit-time reads. Re-check these before acting:

| Finding | Status after re-verification (115-migration DB) | Caveat |
|---|---|---|
| C-04 public product/cost leak | **Fixed and empirically verified**: anonymous list returns 0, anonymous view-by-id returns 404, product re-home returns 404 (`R-01/R-02/R-04`) | Migration is **untracked**, **not in `server-dist`** (still 96), and live PB was unreachable during re-verification — live application is unconfirmed. |
| M-04 unauthenticated provisioning | **Partially patched**: `POST mode=provision` now always 403 | Unauthenticated `GET`/`resolve` still returns `pbUrl` (tenant/port oracle); rate-limit XFF issue unchanged. |
| C-07 full DB in localStorage | **Partially patched**: logout now iterates `localStorage` and removes everything except hardware-prefixed keys (`AuthContext.tsx:147-170`) | The export is still written to `localStorage` while signed in (`backup.ts:462-463`); closing the browser without logging out, or any XSS during the session, still exposes it. No IndexedDB/`pb.realtime` cleanup. |
| M-07 sticky PB URL | **Partially patched**: logout clears the hint/scoped keys via the localStorage sweep | `pb.baseUrl` in memory is **not reset** and `realtime` is not disconnected; a failed tenant resolve still leaves the previous tenant's URL in place for the SPA login. |
| L-02 setup oracle | **Patched**: `/api/setup/status` now returns `{complete:true}` unconditionally; `/setup` removed from public prefixes and the wizard gutted | Fine, but the endpoint is now a permanent “always complete” stub; remove it if unused. |
| L-04 storefront fallback | **New regression** caused by the catalog seal | The anonymous fallback at `storefront/src/lib/pocketbase.ts:133-143` can no longer read products; remove it or move it behind the ERP API. |
| C-01, C-02, C-03, C-05, C-06, C-08, C-09, M-01, M-02, M-03, M-05, M-06, M-08, L-01, L-03 | **Re-verified unchanged / still open**: `R-05`–`R-13` reproduce the same leaks | Storefront routes, `users`/`otp_codes`/phantom-collection rules, RBAC, client state and `server-dist` were not touched. |

Line numbers may have shifted in the changed files; citations for unchanged files are stable.

---

## 3. Critical findings (multi mode)

### C-01 — Anonymous tenant selection on `GET /api/storefront/content` (CMS/contact/promo leak)

**Code**
```ts
// src/app/api/storefront/content/route.ts
259  const queryEmail = normalizeBindingEmail(
260      req.nextUrl.searchParams.get("account_email") || req.headers.get("x-account-email") || ""
261  );
263  const client = await createTenantClient(queryEmail || undefined);
...
290  const targetEmail = normalizeBindingEmail(staffEmail) || queryEmail || DEFAULT_STOREFRONT_TENANT_EMAIL;
293  const readPb = isAuthorized ? pb : client;   // client is the per-tenant SUPERUSER client
298  record = await readPb.collection("store_settings").getFirstListItem(
299      `key="${PB_KEY}" && account_email="${sanitizeFilter(targetEmail)}"`
300  );
```

**Why it is a leak**
`createTenantClient(queryEmail)` is documented as “a fresh, authenticated client for one tenant” and, in multi mode, authenticates with that tenant's stored superuser credentials (`pocketbase.ts:160-172`). It is therefore **not** constrained by PocketBase rules; the only filter is the one on line 299, and the caller chose the tenant on line 259.

**Exploit (multi, no credentials)**
```
GET /api/storefront/content?account_email=victim@shop.com
```
returns the victim's `storefront_content`: brand/wordmark, `socialAndContact.whatsappPhone` and `supportEmail`, `promoBanner.code`, `vitrines`, store policies. `adminBinding` is stripped for anonymous callers (`:316-320`), so the bound-admin address does not leak — everything else does.

**Why the comment is wrong**
Lines 67-69 claim an unauthenticated caller “only receives the URL needed to connect, not the tenant inventory”. That is a different route. This route hands out the tenant's **content** once an email is known.

**Fix**
- Never call `createTenantClient()` with a request-supplied email on a public route.
- Resolve the storefront tenant from a server-side source: host header → configured tenant map, or a signed per-storefront key minted at deploy time.
- Fail closed when no mapping exists; do not fall back to `DEFAULT_STOREFRONT_TENANT_EMAIL`.
- If a superuser client is unavoidable, make the tenant parameter server-controlled and assert it equals the resolved mapping.

---

### C-02 — Anonymous storefront OTP/order writes into any named tenant's database

**Chain (all code-verified)**
1. `POST /api/storefront/auth/send-otp` with `{phone: <attacker>, accountEmail: <victim>}`.
   - `send-otp/route.ts:69` → `getStorefrontBinding(reqEmail)`.
   - `storefront.ts:56-67` → `createTenantClient(cleanEmail)` (victim DB, **superuser**) and reads `store_name`/`storefront_content` by `account_email = victim`.
   - If found, `boundAdminEmail = victim` (`storefront.ts:74,88-93`).
   - `generateAndSaveOtp(phone, boundAdminEmail)` → `otp-store.ts:97` → `createTenantClient(scope)` → OTP row written into **victim's DB** with `account_email: victim`.
2. `POST /api/storefront/auth/verify-otp` with the same `accountEmail` and the OTP from the attacker's phone.
   - `verify-otp/route.ts:42-46` re-resolves the same victim binding.
   - `verifyOtp(...)` reads the OTP row from the victim DB.
   - Customer is created/updated in the victim DB with `account_email: boundAdminEmail` and `loyalty_points: 50` (`verify-otp/route.ts:69-88`).
   - `signCustomerToken({ tenant: boundAdminEmail, phone: <attacker>, exp: +30 days })` (`:129-134`).
3. `POST /api/storefront/order` with that token and `paymentMethod: "cod"`.
   - `order/route.ts:367` `boundAdminEmail = tenant` (from the signed token).
   - `:375` `createTenantClient(boundAdminEmail)` (victim DB, superuser).
   - `:595` product ownership check passes because the products are the victim's.
   - The route creates a `customers` row, confirmed `sales_orders` + items, **decrements real inventory** via `applyChannelStock`, bumps lifetime aggregates/loyalty, increments `discounts.used_count` and writes `discount_usage` (`order/route.ts:962-980,1095-1111`).

**Preconditions**
- Multi mode (in single mode every email resolves to one DB, so there is no second tenant to cross into).
- The target tenant has a `store_name` or `storefront_content` row (a live storefront).
- The target tenant has a working WhatsApp session, or `ALLOW_DEV_OTP=true` in a non-production build (delivery fails closed otherwise, `send-otp/route.ts:111-118`).

**Impact**
An unauthenticated attacker can create customer records, place COD orders, consume stock and burn coupon counters in **any storefront tenant whose email they can guess or learn**. Rate limits (5 orders / 10 min / phone, 5 OTPs / day / phone) bound the volume, not the direction.

**Fix**
- Server-side tenant mapping only (as C-01); ignore `body.accountEmail` entirely for OTP and order.
- If a hint is kept, allow it only when it matches a signed storefront key or the request Host mapping.
- Do not auto-provision a `customers` row from an unauthenticated OTP flow with a welcome-points grant.
- Require a payment intent (or explicit merchant confirmation) before any stock deduction.

---

## 4. High findings

### C-03 — Tenant Admin can re-home users; the re-homed user reads the victim tenant

**Rule (live, verified)**
```
users.updateRule =
  (id = @request.auth.id && @request.body.account_email:isset = false && ...)
  || (@request.auth.id != "" && (account_email = auth.email || ... ) && adminJoin)
```
The Admin branch has **no** `@request.body.account_email:isset = false`, unlike the self branch.

**Reproduced on the isolated instance**
- `PB-10`: tenant A Admin PATCHes user `gamma@shop.local` with `{account_email: "beta@shop.local"}` → **200**, `now=beta@shop.local`.
- `PB-11`: login as `gamma` → token tenant `beta@shop.local`; `GET /api/collections/customers/records` returns **Customer Beta** (tenant B).

**Precondition**
The DB holds more than one tenant's rows. In true per-tenant multi mode each tenant has its own DB, so A's Admin cannot see B's user. The precondition is met by (a) a legacy shared primary DB and (b) multi mode's fallback of every unregistered email to the primary DB (`tenant-db-manager.ts:611-624`). It is also met after any restore/merge/import that puts multiple tenants in one file.

**Impact**
Full tenant impersonation in a shared DB: read customers, orders, invoices, settings and `users.avatar`; write rows stamped as the victim.

**Fix**
- Add `@request.body.account_email:isset = false` to the Admin branch (and to every update rule in §5).
- Better: remove `account_email` from client-writable fields entirely; enforce it in a PocketBase hook (`onRecordCreateRequest` / `onRecordUpdateRequest`) or via API-mediated writes.
- Add a rule-contract test with two users and two tenants (see §9).

---

### C-04 — Anonymous product read exposes landed cost and margin

**Live rule (verified from the running 114-migration instance)**
```
products.listRule =
  (@request.auth.email != "" && (account_email = auth.email || account_email = auth.account_email))
  || (@request.auth.id = "" && is_active = true)
```
`product_variants.listRule` has the same public branch (`product.is_active = true`).

**Reproduced**
```
GET http://127.0.0.1:8099/api/collections/products/records
→ 200
{"sku":"A-RING","cost_price":640,"stock_quantity":9,"barcode":"","hsn_code":"",
 "making_charges":0,"wastage_percent":0,"account_email":"alpha@shop.local","base_price":1000}
```

**Why it matters beyond tenancy**
- In shared DBs this is a cross-tenant margin/stock leak.
- In **every** mode it exposes `cost_price`, `stock_quantity`, `barcode`, `hsn_code`, `making_charges`, `wastage_percent` and the merchant's `account_email` to any anonymous visitor who can reach the PocketBase endpoint. Competitors can compute landed margin per SKU.
- The storefront itself uses a direct PB fallback (`storefront/src/lib/pocketbase.ts:133-143`) when the ERP API is unavailable, so the PB endpoint is intended to be reachable from storefront browsers.

**Fix**
- Remove the public branch from `products`/`product_variants` and expose a curated `storefront_products` view/collection (or an API projection) containing only `name, sku, website_price, mrp, image_url, stock_status, variants`.
- If the public branch must stay, apply a PocketBase field projection or move cost fields to a separate `product_costs` collection with tenant-only rules.
- Never expose `account_email` on a public read.

**Revision 2:** an untracked migration `1793003000_seal_public_catalog.js` does exactly this (public branch removed, update rules gain `@request.body.account_email:isset = false`). I applied it to a fresh 115-migration DB and verified: anonymous list returns **0**, anonymous view-by-id returns **404**, product re-home returns **404** (`R-01/R-02/R-04`). It remains **untracked and absent from `server-dist`**; live PB was unreachable during re-verification, so live application is unconfirmed. Because the seal removes anonymous product reads, the storefront's PB fallback (`storefront/src/lib/pocketbase.ts:133-143`) is now dead — see L-04.

---

### C-05 — RBAC is a UI decoration; the data plane ignores roles

**UI**
```ts
// src/app/users/page.tsx:69-71
const canUpdateUsers = () => isAdmin || hasPermission("users", "update");
const canCreateUsers = () => isAdmin || hasPermission("users", "create");
```
Buttons/handlers check roles. Most business pages do the same.

**Data plane**
Live rules for `customers`, `invoices`, `sales_orders`, `expenses`, `vendors`, `products`, etc. are `@request.auth.id != "" && tenant-scope` only. There is **no role predicate** in any business collection rule. A staff token can call the PocketBase REST API directly, bypassing every React guard.

**Reproduced**
- `PB-15`: `viewer@shop.local` (no `user_roles` link, no permissions) `DELETE /api/collections/customers/records/<id>` → **204**.
- `PB-16`: the same Viewer lists all tenant users (emails, `account_email`, `last_login`) → **200, 3 users**.
- `PB-05b`: the same Viewer reads an `otp_codes` row and recovers the 6-digit code offline.

**Impact**
Any staff member — including a cashier or a read-only Viewer — can delete customers, rewrite invoices, change stock, read the staff directory and take over customer storefront identities by direct API calls. The UI's “you do not have permission” is not a security control.

**Fix**
- Decide whether roles are real. If they are, enforce them in PocketBase hooks (the only place a client cannot bypass) or route every mutation through API routes that call `hasCapability`.
- Minimum viable: add a `role`/capability predicate to the destructive rules (`deleteRule`, sensitive `updateRule`) and keep the UI checks as UX only.
- Add a test that a Viewer token cannot delete a customer/invoice.

---

### C-06 — OTP salt is stored with the hash and readable by any authenticated tenant user

**Code**
- `otp_codes` rules are tenant-scoped but **not** superuser-only (`1793001200_otp_codes.js:52-57`): `@request.auth.email != "" && (account_email = auth.email || account_email = auth.account_email)` for list/view/create/update/delete.
- The row stores both `salt` and `hashed_otp` (`otp-store.ts:125-135`); the hash is `HMAC-SHA256(salt, otp)`.
- `verifyOtp` accepts the code and signs a 30-day customer token (`verify-otp/route.ts:129-134`).

**Reproduced**
- `PB-05b`: `viewer@shop.local` reads `otp_codes`, gets `salt` and `hashed_otp`, brute-forces 100000–999999 in-process and recovers `515151` exactly.
- The same staff can also **create** an OTP row for any phone with a chosen salt/hash (create rule is the same tenant rule), then verify it.

**Impact (same tenant)**
Any staff account, including a low-privilege Viewer, can mint a storefront customer session for any phone number in the tenant. In a shared DB, the update rule has no body guard (`PB-04` re-homed an OTP row to tenant B successfully), so the same primitive can be aimed at another tenant's storefront.

**Fix**
- Make `otp_codes` superuser-only (`null` rules). It is server-owned data; no client needs it.
- Do not store a per-row salt. Use `HMAC-SHA256(server_pepper, phone || otp)` and keep the pepper out of the DB.
- Hash the OTP with a slow KDF or at least a server-only pepper; add per-row attempt limits at the server (already present) and a short TTL (already 5 min).
- Treat OTP verification as authentication: bind the customer token to a server-side session record, not just a signed JWT.

---

### C-07 — Full business database export lives in `localStorage`

**Code**
- `BACKUP_TABLES` includes `customers`, `sales_orders`, `invoices`, `invoice_payments`, `bank_transactions`, `bank_accounts`, `expenses`, `whatsapp_opt_outs`, etc. (`backup.ts:61-93`).
- `scheduleAutoBackup()` writes the entire `BackupData` JSON to `localStorage[luminila_auto_backup_<tenant>]` (`backup.ts:430-442`).
- `getBackupStorageKeys()` uses `getCurrentTenantEmail()`; in single mode every staff user resolves to `SINGLE_ACCOUNT_EMAIL`, so all staff share the same key (`backup.ts:430-436`, `pocketbase.ts:187-195`).
- Logout clears only the auth token and `PB_CUSTOM_URL` (`AuthContext.tsx:142-153`).

**Impact**
- On a shared POS/office browser profile, a Viewer who is denied the Backup page can open DevTools and read `localStorage.luminila_auto_backup_niththigal@gmail.com`: full customer PII, order history, bank transactions and payment records.
- Any XSS on the origin can exfiltrate it with one `localStorage.getItem`.
- Browser storage is unencrypted and may be included in OS/browser sync/backup.
- In multi mode the key is tenant-scoped, but it still survives logout; the next user of the browser profile can read the previous tenant's export (see C-09/M-07 for account switching).

**Fix**
- Remove “auto backup to localStorage” entirely. If offline backup is required, move it to IndexedDB encrypted with a key derived from the user's password and never persist the full dataset by default.
- Clear all tenant-scoped caches on logout (see §6).
- Gate backup creation server-side (`hasCapability`) and stream the file to the user instead of storing it.

**Audit delta:** the working tree now sweeps `localStorage` on logout (`AuthContext.tsx:147-170`), which removes the export **if the user logs out**. The export is still written while signed in (`backup.ts:462-463`), so closing the browser/tab without logout or any XSS during the session still exposes it. The underlying design issue is not fixed.

---

### C-08 — Storefront customer identity and cart are global, non-expiring, and never cleared on a shared device

**Code**
```ts
// storefront/src/context/CustomerAuthContext.tsx
32  const STORAGE_USER_KEY = "luminila_storefront_customer";
33  const STORAGE_TOKEN_KEY = "luminila_storefront_token";
41-53  load both from localStorage, no `exp` check, no tenant in the key
55-72  login writes both; logout only on an explicit click
```
```ts
// storefront/src/context/CartContext.tsx
24  const CART_STORAGE_KEY = "luminila_storefront_cart_v1";  // global, no tenant
```
```tsx
// storefront/src/app/checkout/page.tsx
53  if (customer.name && !customerName) setCustomerName(customer.name);
54  if (customer.phone && !customerPhone) setCustomerPhone(customer.phone);
56  if (customer.address && !shippingAddress) setShippingAddress(customer.address);
489 Logged in as <strong>{customer.name}</strong> (+91 {customer.phone})
```
Header renders the saved name and phone (`Header.tsx:321-331,437-438`).

**Impact (single mode, today)**
On a shared kiosk/phone/desktop, the next visitor sees the previous customer's name, phone, address and loyalty points, and checkout **pre-fills the previous customer's shipping address**. A distracted buyer can ship an order to the previous customer's address. The token is valid for 30 days (`verify-otp/route.ts:132`) and is not checked client-side for expiry; the UI renders from `localStorage` before any server validation.

**Cross-tenant variant (multi)**
The keys have no tenant component. If one storefront origin ever serves multiple `accountEmail` values, customer A's identity is rendered on tenant B's storefront. The order API rejects the tenant mismatch (`resolveOrderTenant`), but the PII is already displayed.

**Fix**
- Key both storages by tenant: `luminila_storefront_<tenant>_customer/_token/_cart`.
- Store the session in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie scoped to the storefront host; validate `exp` on load.
- Clear identity and cart after order completion (or after a short idle timeout), and expose a prominent “Not you? Sign out”.
- Never pre-fill an address from a token that has not been refreshed server-side in this session.

---

### C-09 — Tenant data survives account switch in module singletons and is written into the next tenant

**Quick-add memory**
```ts
// src/lib/quick-add-memory.ts
167  let currentMemory: QuickAddMemory = { recent: [] };
~174 if (typeof window !== "undefined") { currentMemory = sanitizeMemory(JSON.parse(localStorage.getItem(getStorageKey()))); }
269-292 loadQuickAddMemory(): replaces currentMemory ONLY if the new tenant has a row
216-245 persistToPocketBase(): writes currentMemory into the new tenant's store_settings
```
There is no tenant guard (contrast `crm-lifecycle-triggers.ts:81-102`, which does guard).

**SKU taxonomies**
```ts
// src/lib/sku-generator.ts
258  let currentTaxonomies = getDefaultTaxonomies();
267  hydrated once at module import from localStorage
445-476 loadSKUTaxonomies(): if the new tenant has no row, keeps currentTaxonomies
481-509 saveSKUTaxonomies(): writes currentTaxonomies to the current tenant's store_settings
```

**Scenario (multi, same tab)**
1. Tenant A's admin signs in. `currentMemory`/`currentTaxonomies` hydrate with A's custom series/taxonomy.
2. A signs out; B signs in **without a page reload** (SPA logout, `AuthContext.tsx:142-153`).
3. B opens Quick Add / edits a taxonomy. The module singleton still holds A's data.
4. B saves. `persistToPocketBase()` writes A's recent series, cost prices, channel prices, HSN codes and custom taxonomy labels into **B's `store_settings`** under B's `account_email`.

**Impact**
Cross-tenant data injection and UI disclosure: B's staff see A's private product taxonomy and last-used commercial terms; on the first save, A's data is persisted into B's tenant and syncs to B's other devices.

**Fix**
- Stamp the singleton with the tenant it was hydrated for.
- On every read/write, compare `getCurrentTenantEmail()`; if it differs, reload from that tenant's key/PB and reset to defaults when absent.
- Clear the singleton on logout (`pb.authStore.onChange` or an explicit `clearTenantClientState()`).

---

## 5. Medium findings

### M-01 — Empty-owner shared space and public consent events

**Rules**
```js
// pocketbase/pb_migrations/1792774208_phantom_collections.js:16
const TENANT_RULE = '@request.auth.id != "" && (account_email = "" || account_email = @request.auth.email)';
// inventory_locations, inventory_transfers, catalog_sync_logs, shipments, cash_registers
// all five rules (L/V/C/U/D)
```
```js
// 1792830000_roadmap_capture.js:114-118
consent_events: listRule = createRule = '(account_email = @request.auth.email || account_email = @request.auth.account_email)'
// no @request.auth.id guard, update/delete = null
```

**Reproduced**
- `PB-07`: tenant A creates `inventory_locations` without `account_email` → 200, `account_email=""`.
- `PB-08`: tenant B reads it → 200.
- `PB-09`: tenant B **deletes** it → 204.
- `PB-12b`: anonymous list `consent_events` after an anonymous create → 200, phone `9111111111`.
- `PB-13`: anonymous create `consent_events` → 200.

**Impact (shared DB)**
Any authenticated user can read/write/delete every empty-owner location, transfer, shipment, cash register and catalog sync log, regardless of tenant; any anonymous caller can read and spam consent events, including any legacy consent rows with empty `account_email`.

**Fix**
- Remove the `account_email = ""` arm from all five rules; make `account_email` required on create.
- Backfill legacy rows to a named owner.
- Make `consent_events` authenticated + tenant-scoped on read/create; make update/delete superuser-only; require `account_email` on create.

---

### M-02 — Storefront tenant split in single mode (checkout mismatch)

**Code**
- Catalog: `resolveStorefrontTenant()` returns `SINGLE_ACCOUNT_EMAIL` in single mode (`storefront-tenant.ts:29-34`).
- OTP/order: `getStorefrontBinding(undefined)` returns `DEFAULT_BINDING` = `admin@luminila.local` (`storefront.ts:16-20,62`).
- The storefront client sends **no** `accountEmail` in send-otp, verify-otp or order payloads (`storefront/src/components/CustomerAuthModal.tsx:64,143`; `storefront/src/lib/pocketbase.ts:302,362`).
- Order product check compares `dbProd.account_email !== boundAdminEmail` (`order/route.ts:595`).

**Impact**
With `SINGLE_ACCOUNT_EMAIL = niththigal@gmail.com` (the default) and products stamped `niththigal@gmail.com`, the legitimate storefront flow binds OTP/orders to `admin@luminila.local` and rejects every product: “Product does not belong to this store tenant.” The catalog renders fine because it uses a different resolver. A hand-crafted request that passes `accountEmail=niththigal@gmail.com` works — i.e., the attack path is more functional than the product's own UI.

**Fix**
- Make `getStorefrontBinding()` return `SINGLE_ACCOUNT_EMAIL` when `isSingleAccountMode()`, before any lookup.
- Add a single storefront-tenant resolver used by catalog, content, OTP and order; assert it is the same value in all four.
- Add an integration test that runs the storefront checkout with no `accountEmail` in single mode.

---

### M-03 — Flash-drop confirmation accepts missing identity evidence

**Code**
- `belongsToTenant()` returns true for an empty `account_email` (`flash-drop/route.ts:186-189`).
- `loadDrop()` does an unscoped `getOne(dropId)` then the lenient check (`:210-213`).
- On `action:"order"`: `if (phone && orderPhone && orderPhone !== phone)` — omitting `phone` skips verification (`:905-911`).
- Signature is optional: `if (signature) { verify... }` (`:942-951`).
- Settlement then relies on `fetchGatewayPayment` (status/order/amount) — a real but weaker gate.

**Impact**
Given an order id and a captured payment id for that order, a caller can settle it without proving they own the phone. With a legacy empty-owner drop, naming any `accountEmail` returns the drop. In multi mode the per-tenant client makes the drop readable regardless of the lenient owner check.

**Fix**
- `belongsToTenant` must be strict: `stored === accountEmail` (fail on empty).
- Require `phone` on confirmation; compare unconditionally.
- Require the signature **or** rely solely on the gateway fetch (never on optional fields for identity).
- Scope the `getOne` by `account_email` in the filter.

---

### M-04 — Tenant provisioning endpoint: oracle + fail-open + rate-limit bypass

**Code**
```ts
// src/app/api/system/tenant-db/route.ts
42-47  setupTokenValid(): returns true when TENANT_SETUP_TOKEN/SETUP_TOKEN is unset
24-27  clientAddress(): uses the first X-Forwarded-For value (client-controlled)
71-96  GET: returns { success, pbUrl } to an unauthenticated caller
132-135 POST resolve: same, no auth
```
`pbUrl` is `http://127.0.0.1:<port>`; the port is the tenant's identity (8092–8199) in multi mode.

**Impact (multi)**
- Anonymous tenant existence/port oracle, despite the comment claiming the opposite.
- With no setup token configured, an anonymous caller can provision new tenants (spawn PocketBase, write `registry.json`, consume ports/disk) up to 5 attempts/10 min **per spoofable X-Forwarded-For value**.
- Resolve can spawn a tenant process (`ensureTenantPocketBaseRunning`) for an unauthenticated caller.
- In single mode the route returns a constant and refuses provisioning, so this is multi-only.

**Fix**
- Require the setup token **unconditionally** for `provision` (fail closed when unset).
- Require a valid operator session for `resolve`/`GET`; return only a boolean to unauthenticated callers.
- Rate-limit on the socket address, not `X-Forwarded-For`, or use a trusted-proxy allowlist.
- Do not start a tenant process from an unauthenticated resolve.

---

### M-05 — Webhook trusts client-settable `notes.order_id`; payment status actions unscoped

**Code**
```ts
// src/app/api/pos/payment/route.ts:60-63
notes: {
  ...((p.notes && typeof p.notes === "object" ? p.notes : {}) as Record<string, string>),
  ...(tenantEmail ? { account_email: tenantEmail } : {}),
}
// razorpay-webhook-handler.ts:431-452
const orderId = paymentLink?.notes?.order_id || paymentLink?.reference_id || payment?.notes?.order_id;
const tenantEmail = paymentLink?.notes?.account_email || payment?.notes?.account_email;
const existingOrder = await db.collection('sales_orders').getOne(orderId);   // no account filter
```
`order_id` is not overwritten on link creation, and the webhook loads it without a tenant filter.

**Impact (shared DB)**
An operator of tenant A with `sales:create` can mint a payment link whose notes point at tenant B's order id and pay B's order total; the signed webhook then marks B's order PAID, deducts B's stock and raises B's invoice. The attacker pays money to the merchant, so this is integrity/griefing rather than theft, but it writes across tenants.

Also: `razorpay_fetch_status` / `phonepe_status` accept a caller-supplied id and call the deployment-wide gateway with no check that the link belongs to the session tenant (`pos/payment/route.ts:68-75,97-104`).

**Fix**
- Load the order with `id = {:id} && account_email = {:tenant}`; fail closed on empty tenant.
- Whichever tenant the order belongs to must equal `notes.account_email`; reject otherwise.
- Whitelist `notes` keys in `razorpay_create_link`; never forward caller notes verbatim.
- Tenant-bind the status actions.

---

### M-06 — Checked-in `server-dist` is 18 migrations behind and unsafe if shipped

**Evidence**
- Canonical: 114 `.js` files in `pocketbase/pb_migrations`.
- `server-dist/pocketbase/pb_migrations`: **96** files.
- Missing include: `1792800000_users_tenant_scoping`, `1793000002_tenant_owner_rules_and_rbac_hardening`, `1793001200_otp_codes`, `1793001500_tenant_rules_dual_identity`, `1793002000_inventory_packing_v2`, and 13 others.
- Stale `users` rules in `1700000000_initial_schema.js`: `viewRule/listRule = "@request.auth.id != \"\""`, `createRule = "@request.auth.id != \"\""`, and the `account_email` field does not exist.
- `scripts/prepare-server-dist.mjs` deletes `server-dist` and copies `.next/standalone`; that directory currently has all 114, so a proper `npm run build:desktop` fixes the artifact.

**Impact if `server-dist` is deployed as-is**
- No `otp_codes`, flash drops or packing-v2 collections → runtime 404s.
- No tenant scoping on `users`/`user_roles`; any authenticated user can list every user and create users.
- The app's `account_email` field is absent from `users`, so tenancy code fails or silently writes unstamped rows.

**Fix**
- Never ship the checked-in `server-dist`; rebuild in CI.
- Add a CI check that compares the migration count/hash between `pocketbase/pb_migrations` and `server-dist/pocketbase/pb_migrations`.
- Add a build-time assertion that `users.account_email` exists and the rule contains `account_email`.

---

### M-07 — Sticky global PocketBase URL survives logout and failed tenant resolution

**Code**
- `setPocketBaseUrl()` writes both `PB_CUSTOM_URL` and `PB_CUSTOM_URL_<hint>` (`pocketbase.ts:339-363`).
- `resolveTenantPocketBase()` writes `PB_TENANT_HINT` **before** the request and, on failure, returns `getPocketBaseUrl()` without re-pointing `pb` (`:479-512`).
- `AuthContext.login()` ignores the resolver's return and immediately authenticates on the shared `pb` (`AuthContext.tsx:97-121`).
- `logout()` removes only `PB_CUSTOM_URL`; it does not clear the hint, the scoped key, or reset `pb.baseUrl` (`:142-153`).

**Impact (multi)**
On a shared shop PC, tenant A signs in → `pb.baseUrl` = A. A signs out (SPA, no reload) → `pb.baseUrl` is still A. If tenant B's `/api/system/tenant-db` resolve fails (API down, timeout, 500), `login()` posts B's plaintext password to A's PocketBase. If B's credentials also exist in A's DB (cloned/seeded DBs), B lands inside A's tenant and every write is stamped as A.

**Fix**
- Make the base URL a function of the authenticated tenant, not sticky global state.
- On logout: `pb.authStore.clear(); pb.baseUrl = getPocketBaseUrl();` and delete `PB_TENANT_HINT` + `PB_CUSTOM_URL_<email>`.
- Make `login()` fail closed when `resolveTenantPocketBase()` did not return a URL for the requested tenant.
- Do not write the hint until resolution succeeds.

**Audit delta:** the working-tree logout sweep deletes the stored keys, but still does **not** reset `pb.baseUrl` in memory or disconnect realtime. The failed-resolve window on the SPA login remains.

---

### M-08 — AI transcripts are shared by all staff of a tenant

`authenticateOperator` sets `email = accountEmail` (`api-auth.ts:100`), `authenticateAiRequest` uses `session.email` as `operatorEmail` (`ai/http.ts:91`), and session reads filter `created_by = operatorEmail` (`ai/sessions.ts:117,133`). For staff, `accountEmail` is the owner's email, so every staff member shares the same `created_by` and can list/read/archive each other's AI conversations. No cross-tenant leak (`account_email` is still checked), but it contradicts the intent comment in `sessions.ts`.

**Fix:** pass `session.staffEmail` as `operatorEmail`; keep `account_email` for tenant scoping.

---

## 6. Low / latent findings

### L-01 — E-way credential fail-open is currently masked (downgraded after verification)
`settings/eway/route.ts:57` filters `key="eway_bill" && (account_email="tenant" || account_email="")`, and `:197` preserves `existing.account_email || tenant`, so a legacy empty-owner row stays global. **However**, the live `store_settings` list rule is `@request.auth.id != "" && auth.email != "" && (account_email = auth.email || account_email = auth.account_email)`; empty-owner rows are invisible to operator tokens. I created such a row and a Viewer query returned **0 rows** (verified). The leak is therefore **latent**, not active, and becomes live if the rule regresses or a superuser token is used. Fix anyway: drop the `|| account_email=""` arm and refuse to preserve an empty owner.

### L-02 — Assorted information disclosure
- Login page pre-fills `SINGLE_ACCOUNT_EMAIL` (`login/page.tsx:48`) — reveals the merchant's login address to anyone who opens the page.
- `/api/setup/status` returns `{complete}` unauthenticated (`setup/status/route.ts:13-23`) — free setup oracle.
- `/api/catalog/image` admits `account_email=""` product images (`catalog/image/route.ts:16-35`).
- Storefront order confirmation accepts an order with empty `account_email` (`order/route.ts:183`), so a legacy order passes the tenant check.
- `channel-pricing` caches under the staff email while the row/module cache uses the tenant (`channel-pricing.ts:51-54` vs `103-105`).
- `analytics-v2/load.ts:56` reads `categories` unscoped; harmless in a one-tenant DB, leaks category names if the DB ever holds more than one tenant.

### L-04 — Catalog seal breaks the storefront's anonymous PocketBase fallback (new regression)

`getStorefrontCatalog()` tries the ERP API first, then falls back to direct PB reads:
```ts
// storefront/src/lib/pocketbase.ts:133-143
const records = await pb.collection("products").getFullList({ ... });
const variants = await pb.collection("product_variants").getFullList().catch(() => []);
```
With `1793003000_seal_public_catalog.js` applied, `products.listRule`/`viewRule` require an authenticated tenant member, so an anonymous storefront browser gets **0 rows** (verified `R-01`). The fallback's whole purpose was to keep the catalogue rendering when the ERP API is unreachable; it now silently returns an empty catalogue instead.

**Fix:** delete the direct-PB fallback and let the ERP API be the only catalogue source; if a fallback is required, put it behind the ERP (server-side) with a short-lived cache, not behind an anonymous PocketBase rule.

---

## 7. What I tried to break and could not (verified controls)

These are real controls, and the report should not be read as “everything is broken”:

- **Cross-tenant customer reads are blocked.** `customers.listRule` is `@request.auth.id != "" && auth.email != "" && (account_email = auth.email || account_email = auth.account_email)`; `PB-01` returned only the caller's row and `PB-02` returned 404 for the other tenant's id.
- **Customer re-homing is blocked.** `customers.updateRule` includes `@request.body.account_email:isset = false`; `PB-03` returned 404.
- **Self-service privilege changes are blocked.** A Viewer cannot set `is_active:false` or `account_email` on their own user (`PB-18` 404), and cannot create a role (`PB-17` 400).
- **OTP rate limits and fail-closed delivery are real.** Daily caps, resend cooldown, atomic `day_count+`, and a 502 when WhatsApp delivery fails (`send-otp/route.ts:111-118`).
- **Razorpay webhook signature is verified before any read** (`razorpay-webhook-handler.ts:374-386`), and currency/amount are checked.
- **AI provider rows are tenant-scoped** on every read/write (`ai/providers.ts`), and `ai_*` collections are superuser-only.
- **`sanitizeFilter` is used consistently** where caller values reach a filter; I found no filter injection.
- **Offline queue stamps and skips** mutations whose `accountEmail` differs from the current tenant (`offline-queue.ts:218-224`).
- **`beforeSend` forces `account_email`** on POST/PATCH for non-superuser sessions (`pocketbase.ts:243-254`).
- **Backup reads are tenant-scoped** (`backup.ts:97-123`), even though the storage location is unsafe (C-07).

---

## 8. Empirical proof (isolated instance, port 8099)

Method: fresh PocketBase 0.25.0, all 114 migrations, synthetic users A (`alpha@shop.local`), B (`beta@shop.local`), Viewer (`viewer@shop.local`), synthetic rows. No live data touched.

| Probe | Result | Evidence |
|---|---|---|
| PB-01 A lists `customers` | **blocked** | only `Customer Alpha`, B not visible |
| PB-02 A reads B's customer by id | **blocked** | 404 |
| PB-03 A re-homes own customer to B | **blocked** | 404 (body guard works) |
| PB-04 A re-homes own `otp_codes` row to B | **LEAK** | 200, `account_email=beta@shop.local` |
| PB-05b Viewer reads OTP salt/hash and recovers code | **LEAK** | recovered `515151` offline |
| PB-06 anonymous `products` list | **LEAK** | `cost_price:640`, `stock_quantity:9`, `hsn_code`, `account_email` |
| PB-07 A creates `inventory_locations` without owner | **LEAK** | 200, `account_email=""` |
| PB-08 B reads A's empty-owner location | **LEAK** | 200 |
| PB-09 B deletes A's empty-owner location | **LEAK** | 204 |
| PB-10 A Admin re-homes user to B | **LEAK** | 200, `now=beta@shop.local` |
| PB-11 re-homed user reads B's customers | **LEAK** | sees `Customer Beta` |
| PB-12b anonymous lists `consent_events` | **LEAK** | 200, phone `9111111111` |
| PB-13 anonymous creates `consent_event` | **LEAK** | 200 |
| PB-15 Viewer deletes a customer | **LEAK** | 204 (UI would hide the button) |
| PB-16 Viewer lists all users | **LEAK** | 200, 3 users |
| PB-17 Viewer creates a role | **blocked** | 400 |
| PB-18 Viewer sets own `is_active=false` | **blocked** | 404 |
| E-way: Viewer sees empty-owner `store_settings` row | **blocked** | 0 rows (rule hides it) |

Live rules read from the same instance confirm `products`/`product_variants` public read, `otp_codes` tenant-scoped (not superuser-only), `consent_events` without an auth guard, and `inventory_locations` with the `account_email=""` arm.

### 8.1 Revision 2 — re-verification against the current 115-migration set

Same harness, rebuilt from scratch after the concurrent edits (including `1793003000_seal_public_catalog.js`). Synthetic users A, B, Viewer; fresh DB; no live data.

| Probe | Result | Detail |
|---|---|---|
| R-01 anonymous `products` list | **FIXED** | 200, 0 items (rule now requires auth) |
| R-02 anonymous product view by id | **FIXED** | 404 |
| R-03 Viewer sees own tenant products only | **PASS** | `["A-RING"]`, B's `B-CHAIN` absent |
| R-04 product re-home to B | **BLOCKED** | 404 (new body guard) |
| R-05 Admin re-homes user to B | **LEAK** | 200, `now=beta@shop.local` |
| R-06 re-homed user reads B's customers | **LEAK** | 200, sees `Customer Beta` |
| R-07 Viewer reads OTP salt/hash + recovers code | **LEAK** | recovered `515151` |
| R-08 `otp_codes` re-home to B | **LEAK** | 200, `now=beta@shop.local` |
| R-09 create empty-owner location | **LEAK** | 200, `account_email=""` |
| R-10 tenant B reads/deletes A's empty-owner location | **LEAK** | read 200, delete 204 |
| R-11 anonymous consent create/list | **LEAK** | create 200, list 200 with the new row |
| R-12 Viewer deletes a customer | **LEAK** | 204 |
| R-13 Viewer lists all users | **LEAK** | 200, 2 users |
| R-14 Viewer sees empty-owner eway row | **BLOCKED** | 0 rows (latent only) |

**Conclusion:** exactly one rule-layer finding (C-04) is fixed. The tenant-takeover, OTP, empty-owner, consent and RBAC findings are unchanged. The one new issue is the functional regression L-04.

Live status: `http://127.0.0.1:8091` refused connections during re-verification, so I could not confirm whether the live DB has applied `1793003000`. The migration is untracked and absent from `server-dist`; treat it as **not shipped** until it is committed, copied into the artifact, and applied with a verified migration run.

### 8.2 Revision 3 — remediation manifest and verification

**New migration** `pocketbase/pb_migrations/1793003100_tenant_update_guards_and_otp_seal.js` (canonical set now 116):
- Wraps every `updateRule` that scopes by `account_email` with `&& @request.body.account_email:isset = false` (idempotent via suffix check; 17 rules wrapped on a fresh DB, the rest already carried the guard). `users` — an **auth**-type collection — is included, closing the C-03 takeover.
- `otp_codes`: all five rules → `null` (superuser-only). Server routes use superuser clients, so nothing else changes.
- `consent_events`: list/view/create now require an authenticated, tenant-matching session; create freezes the owner.
- The five phantom collections: empty-owner rows are backfilled to the single tenant this DB serves (only when provable), the shared `account_email = ""` arm is removed, and **create now requires an explicit owner** — an unstamped row would be invisible to everyone, so a refused write beats a silent orphan. If orphan rows cannot be backfilled, the old rule is kept and the migration logs loudly.

**Server code (all uncommitted):**
| File | Change |
|---|---|
| `src/lib/storefront.ts` | `resolvePublicStorefrontTenant()`: single mode → `SINGLE_ACCOUNT_EMAIL`; multi mode → `STOREFRONT_TENANTS` allow-list, else `""` (fail closed). `getStorefrontBinding()` pins single mode to `SINGLE_ACCOUNT_EMAIL` (M-02). |
| `api/storefront/content/route.ts` | Tenant from the resolver only; no DB client is opened for unsanctioned callers (C-01). Capability session now carries `accountEmail` (SK-10). |
| `api/storefront/auth/send-otp` + `verify-otp` | 404 fail-closed when the caller-named tenant is not allow-listed (C-02). |
| `api/storefront/flash-drop/route.ts` | Resolver via allow-list; `belongsToTenant` strict (no empty-owner pass); phone proof mandatory when the order carries one (M-03). |
| `src/lib/otp-store.ts` | HMAC key is a server-side pepper (`OTP_HASH_PEPPER` → `TENANT_REGISTRY_KEY` → `CUSTOMER_SESSION_SECRET` → superuser password) bound to the phone; the per-row salt no longer carries security weight (C-06). |
| `src/lib/razorpay-webhook-handler.ts` | Order loaded with `id = X && account_email = tenant`; fail-closed when the signed notes carry no tenant (M-05). |
| `api/pos/payment/route.ts` | `razorpay_fetch_status` rejects links whose echoed `notes.account_email` differs from the session tenant. |
| `api/settings/eway/route.ts` | Strict owner filter (no `""` arm); owner always stamped on write (L-01). |
| `src/lib/pocketbase.ts` | `resetPocketBaseClientState()`: unsubscribe `*`, realtime disconnect, auth clear, hint/scoped/legacy URL keys removed, singleton re-pointed to the deployment default (M-07). |
| `src/contexts/AuthContext.tsx` | Logout calls `resetPocketBaseClientState()` before the localStorage sweep. |
| `src/lib/quick-add-memory.ts`, `src/lib/sku-generator.ts` | Tenant-stamped singletons: every accessor calls `ensureTenantScope()`, which resets to the new tenant's cache/defaults on change (C-09). |
| `src/lib/ai/http.ts` | `operatorEmail` uses `session.staffEmail` — transcripts are per-login, not per-tenant (M-08). |
| `storefront/src/lib/pocketbase.ts` | Dead anonymous PB catalog fallback removed; ERP API is the only source, offline builds use `STOREFRONT_CATALOG_SNAPSHOT` (L-04). |
| `env.example.txt` | Documents `STOREFRONT_TENANTS` and `OTP_HASH_PEPPER`. |

**Verification (fresh 116-migration DB, isolated port 8099):**

| Probe | Result | Detail |
|---|---|---|
| V-01 anonymous `products` list | **FIXED** | 200, 0 items |
| V-02 product re-home to B | **BLOCKED** | 404 |
| V-03 Admin re-homes user to B | **BLOCKED** (was LEAK) | 404 — takeover closed |
| V-04 gamma (re-home refused) stays in A, cannot read B's customers | **BLOCKED** | sees only own tenant |
| V-05 staff reads `otp_codes` | **FIXED** | 403 |
| V-06/07 staff/anonymous create `otp_codes` | **BLOCKED** | 403 |
| V-08 create location without owner | **BLOCKED** | 400 (owner now required) |
| V-09 create location with own owner | **PASS** | 200 |
| V-10 tenant B reads/deletes A's owned location | **BLOCKED** | 404 / 404 |
| V-11 anonymous consent create/list | **BLOCKED** | 400 / 0 rows |
| V-12 Viewer deletes a customer | **OPEN (RBAC)** | 204 — needs the C-05 decision |
| V-13 Viewer lists all users | **OPEN (RBAC)** | 200 |
| V-14 Viewer sees empty-owner eway row | **BLOCKED** | 0 rows |

`npm run typecheck` — clean. `npx eslint` on every changed file — 0 errors (pre-existing `any` warnings only). **Nothing is committed.**

**Honest limits of Rev 3:**
- The route-level fixes (C-01/C-02/M-02/M-03/M-05/L-01/M-07/C-09/M-08) are code-verified and lint/type-checked but **not exercised end-to-end through a running Next server**. The rule-layer changes are runtime-verified.
- The update-rule freeze means a tenant Admin can no longer move users across tenants. No legitimate flow in the code needed that; if one appears, it must go through a server route with explicit authorization — never through a client-writable `account_email`.
- Deploying requires: commit → run `migrate up` on every tenant DB (live included) → rebuild `server-dist` (M-06). OTPs minted before the pepper change are invalid for their 5-minute TTL — acceptable.
- Two PB 0.25 JS-bridge traps cost three migration iterations and are recorded here for the next person: direct property assignment on a collection wrapper silently no-ops (`unmarshal()` is required), `findAllCollections()`/field proxies/string coercion are unreliable (`String(collection.updateRule)` was the difference between 0 and 17 guarded rules), and a stale server on the test port will quietly answer probes with old rules.

---

## 9. Prioritized remediation

### P0 — before the next multi-tenant deployment
1. ✅ **Kill caller-controlled tenant selection** — `resolvePublicStorefrontTenant()` allow-list; content/OTP/flash-drop fail closed on unlisted tenants (Rev 3).
2. ✅ **Never open a tenant DB for an unsanctioned anonymous request** — the content route no longer creates a client at all when the caller is not allow-listed (Rev 3).
3. ✅ **Freeze `account_email` on update** — migration `1793003100`, verified (`V-03/V-04`).
4. ✅ **`otp_codes` superuser-only + server-side pepper** — verified (`V-05..V-07`).
5. ✅ **Seal public catalog** — `1793003000` (Rev 2) + dead storefront fallback removed (Rev 3, L-04).
6. ✅ **Single-mode storefront split** — `getStorefrontBinding()` pins `SINGLE_ACCOUNT_EMAIL` (Rev 3).

### P1 — before letting a second staff role or a shared device near the app
7. ✅ **`resetPocketBaseClientState()` on logout** — subscriptions, realtime, auth store, URL keys, default re-point (Rev 3). Tenant-change resets for in-page account switching are still worth wiring into the login flow.
8. ⏳ **Full DB export in `localStorage`** — logout sweeps it now, but the export is still written while signed in; move to IndexedDB-encrypted or server-side.
9. ⏳ **Storefront identity/cart** — still global, non-expiring, never cleared on a shared device (C-08).
10. ⏳ **RBAC at the data plane** (C-05) — the remaining decision: enforce in PB hooks / API-mediated writes, or document that every staff account is fully trusted. Probes V-12/V-13 stay open until then.
11. ✅ **Module singletons tenant-stamped** — `quick-add-memory`, `sku-generator` (Rev 3); `whatsapp-event-sync` queue reset is still worth the same treatment.

### P2 — hardening and release hygiene
12. ✅ **Webhook order binding + status scoping** (Rev 3).
13. ⏳ **tenant-db route** — provisioning is disabled (concurrent agent); unauthenticated `resolve` still returns `pbUrl`, and the rate limit keys on a spoofable `X-Forwarded-For`.
14. ⏳ **Rebuild `server-dist`** (still 96 of 116 migrations) and add a migration-parity CI check.
15. ✅ **Eway fail-open** (Rev 3).
16. ⏳ **Formal contract test** — the probe suites in §8.1/§8.2 are the template; port them into `src/scripts/test-tenant-isolation.ts` behind the throwaway-PB harness and add to `npm test`.

### The test that would have caught most of this
Add `src/scripts/test-tenant-isolation.ts` that boots a throwaway PocketBase (8099), provisions two users in one DB with two `account_email` values, and asserts:
- A cannot list/read B's customers, invoices, products, OTP rows.
- A cannot PATCH its own row's `account_email` in any collection.
- A cannot PATCH a user's `account_email` (Admin branch).
- A non-admin cannot delete a customer/invoice.
- Anonymous cannot read `products.cost_price`, `consent_events`, or `otp_codes`.
- Anonymous cannot select a tenant in any storefront route.

The probes in §8 are a ready-made template.

---

## 10. Residual risk and unverified items

- **Route-level exploitation of C-01/C-02 is code-verified, not end-to-end executed.** I did not boot the Next app in multi mode with two provisioned tenant DBs and a WhatsApp session. The code path is unambiguous, but the runtime precondition (registered tenant + store settings + working WhatsApp) should be confirmed in a staging environment.
- **Live DB drift.** The live `analytics_daily_snapshots` rule differs from the migration text (owner-only vs dual-identity); other live rules may have drifted from the 114-file set. The audit of rules is based on a fresh 114-migration instance; production should be re-read with the superuser API before relying on any rule statement.
- **`server-dist` deployment status is unknown.** If the shipped desktop/standalone build is always produced by `npm run build:desktop`, M-06 is stale-artifact hygiene; if anyone ships the checked-in directory, it is a live vulnerability.
- **Whether multi mode is actually sold/deployed** is a business fact I cannot determine from the repo. The code, docs, and env example support it; the default is single.
- **Relation-expansion filtering** in PocketBase 0.25 (whether an expanded relation is filtered by the target collection's `viewRule`) was not tested; if it is not, a tenant could read a foreign record by referencing a known id from a record it owns. Worth a dedicated probe.
- **The `/grill-me` slash command was not available in this session** (no command file found); I proceeded on the task as written and used the empirical harness to resolve ambiguity instead of asking.

---

## 11. Bottom line

The **database-per-tenant** design is sound when it is actually used and when each tenant keeps its own DB. The failure is at the seams:

- Public routes treat an email as an authentication token and then hand it superuser access to that email's database.
- The rule layer protects tenants from each other only if every update rule remembers to freeze `account_email`; several do not.
- The UI treats PocketBase as a trusted backend while the browser holds the superuser-equivalent session of a tenant and can call the API directly.
- The browser keeps everything: backups, customer identity, OTP salts, tenant singletons.

If this app is sold as multi-tenant, **do not ship it in multi mode until P0 is closed**. If it stays single-tenant, close P1 items 7-11 before a second staff role or a shared POS terminal is introduced.

As of Revision 3, every PocketBase-rule leak in this report is **fixed and empirically verified** on an isolated instance, and the storefront/API tenant-selection holes are closed in code. The remaining opens are deliberate: the RBAC decision (C-05), the browser-storage designs (C-07 partial, C-08), the unauthenticated tenant-db oracle (M-04 partial), and release hygiene (M-06). All of it is **uncommitted** — commit, migrate every tenant DB, and rebuild `server-dist` before this is real.
