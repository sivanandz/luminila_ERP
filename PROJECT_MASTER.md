# LUMINILA PROJECT MASTER

**The single authoritative document for the Luminila Inventory Management system.**

| Field | Value |
|---|---|
| Document ID | `LUMINILA-MASTER-2026-10-23` |
| Status | **SUPERSEDING**. Replaces every other project document on architecture, features, defects, and build state. |
| Verified against | audit baseline `f0e96b4` (2026-10-21). Slice 1 landed on `feat/finish-partial-features` as `dc70a9b`. |
| Verification date | 2026-10-23 |
| Verification performed by | static analysis + targeted line-level code audit + `tsc` + ESLint; production build attempted |
| Scope | `E:\Local_GIT_2\luminila_inv_mgmt` (frontend, service layer, PocketBase schema, Tauri shell, WhatsApp sidecar, API routes) |
| Companion artifact | [`PROJECT_EXPLORER.html`](PROJECT_EXPLORER.html), an interactive version of this document |

---

## 0. Read this first

### 0.1 Why this document exists

The repository accumulated 30+ documents across eight months of audits. They disagree with each other and with the code: `docs/PROJECT_STATE.md` declares "zero-defect production status" while `BUG_AUDIT_REPORT_2026-10-22.md` found four P1 defects in the same tree; several documents still describe Supabase, PocketBase 0.25, 44 collections, and port 8090 as the client default. None of them describe the 30+ domain engines added in the last three commits.

This file was produced by re-reading the current tree, not by copying earlier reports. Where an older document and this one disagree, **this one wins**. Where this document and the code disagree, the code wins and this document is wrong.

### 0.2 Supersession map

| Document | Disposition |
|---|---|
| [`CODEBASE.md`](CODEBASE.md) | **Superseded**. Its directory map, architecture rules, and "resolved defects" list are absorbed into sections 3, 7, and 8. Keep as history only. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **Superseded** by section 3. Its "44 collections" and port-8090 assumptions are stale. |
| [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) | **Superseded** by sections 3 and 5. |
| [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) | **Superseded and corrected**. Maturity labels in section 4 replace its matrix; its "zero-defect" claim is withdrawn. |
| [`docs/FEATURES.md`](docs/FEATURES.md) | **Superseded** by section 4. Feature descriptions are preserved there for prose detail, but status labels here are authoritative. |
| [`README.md`](README.md), [`docs/README.md`](docs/README.md) | **Superseded** for setup and commands by section 9. |
| [`PROJECT_AUDIT_REPORT.md`](PROJECT_AUDIT_REPORT.md) (Feb 2026) | **Historical**. Most findings were remediated; the document is kept for the audit trail only. Do not act on it. |
| [`APP_LOGIC_AUDIT_REPORT_2026-03-07.md`](APP_LOGIC_AUDIT_REPORT_2026-03-07.md) | **Historical**. Its findings are re-verified in section 7; it must not be quoted as current. |
| [`BUG_AUDIT_REPORT_2026-10-22.md`](BUG_AUDIT_REPORT_2026-10-22.md) | **Absorbed** into section 7 with re-verification. It remains accurate for the paths it cites, but is incomplete: it predates this pass and misses the security cluster and the new engines. |
| [`docs/SECURITY_AUDIT_2026-10-17.md`](docs/SECURITY_AUDIT_2026-10-17.md), [`docs/PENTEST_AND_TENANT_ISOLATION_REPORT_2026-10-19.md`](docs/PENTEST_AND_TENANT_ISOLATION_REPORT_2026-10-19.md) | **Absorbed** into section 6. The pentest report is the source of the tenancy model; its remediations are partially verified here. |
| [`docs/LIVE_STORE_ONBOARDING_LIFECYCLE_AUDIT_2026-10-19.md`](docs/LIVE_STORE_ONBOARDING_LIFECYCLE_AUDIT_2026-10-19.md) | **Absorbed** into section 4 as lifecycle evidence. Its "remediated" claims are only trusted where code confirms them. |
| [`docs/WHATSAPP_*.md`](docs/) (7 files), [`docs/CRM_AND_WHATSAPP_CAMPAIGN_GROWTH_PLAN.md`](docs/CRM_AND_WHATSAPP_CAMPAIGN_GROWTH_PLAN.md) | **Absorbed** into sections 3.6 and 4.10. Specifications remain useful; audit verdicts are superseded. |
| [`docs/SETUP_WIZARD_*.md`](docs/) | **Absorbed** into section 4.1 (onboarding). |
| [`docs/DOC_VERIFICATION_2026-09-22.md`](docs/DOC_VERIFICATION_2026-09-22.md) | **Historical**. |
| [`AGENT_COLLABORATION_FORUM.md`](docs/AGENT_COLLABORATION_FORUM.md) | **Historical record only**. Do not treat its claims as verification. |
| [`docs/Jewelry Inventory SKU Architecture.md`](docs/Jewelry%20Inventory%20SKU%20Architecture.md) | **Partially absorbed** into sections 3.5 and 4.2. The SKU grammar itself is still the reference. |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md), [`docs/APP_WORKING.md`](docs/APP_WORKING.md) | **Not superseded for operator instructions**; superseded wherever they state system behaviour. |
| [`docs/BUILD_AND_DEPLOYMENT.md`](docs/BUILD_AND_DEPLOYMENT.md), [`docs/POCKETBASE_SETUP.md`](docs/POCKETBASE_SETUP.md) | **Superseded** by section 5 and 9. They describe a build that currently cannot complete; see 5.1. |
| [`.agents/ARCHITECTURE.md`](.agents/ARCHITECTURE.md), [`DEPENDENCY_GRAPH.md`](.agents/DEPENDENCY_GRAPH.md), [`.agents/memory/*`](.agents/memory/) | **Superseded for architectural claims**. Agent workflow rules stay in force. |
| [`PYTHON_LOGIC_AUDIT_REPORT_2026-03-07.md`](PYTHON_LOGIC_AUDIT_REPORT_2026-03-07.md), [`vasy-imitation-omnichannel-features.md`](vasy-imitation-omnichannel-features.md) | **Historical / specification input**. |

### 0.3 How to keep this document true

1. Any change that alters a collection, a service contract, a port, or a documented defect updates this file **in the same commit**.
2. Section 7 entries carry `file:line` evidence. When a line moves, the entry moves with it; when a defect is fixed, move it to section 7.9 with the fixing commit.
3. Re-run section 10 before changing the status of anything in section 4.
4. Never reintroduce a superseded document as a source of truth.

---

## 1. What this product is

Luminila is a **local-first retail ERP and point-of-sale system for Indian jewelry businesses**, sold as a desktop/tablet application for a single showroom at a time, with an optional online storefront and a WhatsApp sales channel attached to the same data.

It is not a cloud SaaS. The design premise is that a showroom with unreliable internet must still be able to bill a customer, print a GST invoice, tag inventory, and close a cash drawer. Every architectural decision follows from that premise.

### 1.1 Primary jobs

| Job | Who does it | Where |
|---|---|---|
| Bill a walk-in customer, take cash/card/UPI, print a GST invoice | Cashier | `/pos` |
| Tag and receive stock, print barcode labels | Store staff | `/inventory`, `/purchase`, `/labels` |
| Track gold/silver rate, making charges, purity, weight | Owner / manager | `/inventory`, `/settings` |
| Raise purchase orders, receive goods, reconcile vendor bills | Purchase manager | `/purchase` |
| Handle returns, exchanges, credit notes | Manager | `/returns` |
| Sell over WhatsApp, send payment links, run broadcasts | Sales staff | `/whatsapp`, `/checkout/whatsapp` |
| File GST (GSTR-1, HSN summary), reconcile bank and cash | Accountant / owner | `/reports/gst`, `/banking`, `/expenses` |
| Onboard a new store or a new tenant | Owner | `/setup` |
| Run an online storefront with OTP login and COD/prepaid checkout | Customer | storefront routes + `/storefront-control` |

### 1.2 Deployment shapes

| Shape | What runs | Status |
|---|---|---|
| **Desktop (Tauri v2)** | Webview hosting the statically exported Next.js app; Rust supervisor restarts the WhatsApp sidecar; PocketBase is **not** started by the shell (see 5.3) | Partially wired |
| **Browser / PWA** | Next.js dev or `next start` server on a LAN machine; PocketBase beside it; installable via manifest | Working in development |
| **Android** | Tauri mobile build, or PWA in Chrome. Camera scanning and system print spooler paths exist | PWA usable; native APK build blocked on this workstation (5.3) |
| **Remote showroom device** | Cloudflare Quick Tunnel exposes PocketBase and the sidecar; device points at the tunnel URL via `PB_CUSTOM_URL` | Working, with security caveats in 6.4 |

### 1.3 Explicit non-goals and constraints

- **Single-tenant per database file, multi-tenant per installation.** Each merchant account gets its own SQLite file and its own PocketBase process. Cross-tenant reporting is out of scope.
- **No server-side rendering in production.** `output: "export"` means the packaged app has no Node server. This is the root cause of the largest open architectural conflict (5.1).
- **No cloud dependency for core billing.** Google Drive sync, Razorpay, PhonePe, Meta catalog, and WhatsApp are all optional integrations.
- **India-specific statutory output.** GST, HSN, e-way bill, GSTR-1. No other tax regime is supported.
- **Offline-first writes are queued, not merged.** `offline-queue.ts` replays mutations; it does not resolve conflicts.

---

## 2. Verified state at a glance

### 2.1 Repository facts

| Metric | Value |
|---|---|
| Branch / commit | `feat/finish-partial-features`, based on `fix/security-audit-remediation` @ `f0e96b4` |
| Last slice | Money and tax, 2026-10-23 (section 11) |
| TypeScript/TSX files | 229 |
| Lines of TypeScript/TSX | ~84,400 |
| Route pages (`src/app/**/page.tsx`) | 40 |
| Service modules (`src/lib/*.ts`) | 79 |
| API route handlers (`src/app/api/**/route.ts`) | 13 |
| PocketBase collections in schema | 55 (49 business + 6 system) |
| Files starting with `"use client"` | 115 |
| `pb.collection(...)` calls inside UI files | 135 |
| Largest page | `/whatsapp` at 231 KB, `/storefront-control` at 192 KB, `/pos` at 126 KB |
| TODO/FIXME/HACK markers in `src` | 8 |
| PocketBase | server v0.25.0 binary, JS SDK 0.26.5, SQLite WAL |
| Next.js / React | 16.1.0 / 19.2.3 with React Compiler |
| Tauri | v2, one external binary declared (`wppconnect-server`) |

### 2.2 Verification log (reproducible)

| Check | Command | Result |
|---|---|---|
| Type safety | `npx tsc --noEmit --incremental false` | **Clean** (exit 0) |
| Type safety, default | `npx tsc --noEmit` | Fails with `TS5033 EPERM` writing `tsconfig.tsbuildinfo` on this volume (see 5.3) |
| Lint | `npx eslint src` | **332 problems: 7 errors, 325 warnings** |
| Lint errors | same | 4 × `react-hooks/rules-of-hooks` in `src/app/whatsapp/page.tsx`; `prefer-const` in `excel-import.ts`, `purchase.ts`, `storefront.ts` |
| Tax math tests | `npx tsx src/scripts/test-invoice-math.ts` | **12 passed, 0 failed** (2026-10-23) |
| Return policy tests | `npx tsx src/scripts/test-returns-policy.ts` | **9 passed, 0 failed** (2026-10-23) |
| Tenant auth tests | `npx tsx src/scripts/test-tenant-auth.ts` | **12 passed, 0 failed** (2026-10-23) |
| Production build | `npm run build` | **Could not complete on this workstation**; blocked at `.next/trace-build` by file permissions. The static-export conflict in 5.1 is structural and independent of this. |
| Migration file check | `pocketbase/pb_migrations` | 1 generated migration file (~88 KB) containing the full schema plus rule revisions |

The seven lint errors are not cosmetic. Four of them are the React hooks violation that can crash the WhatsApp chat view (D-04 in section 7).

### 2.3 Maturity summary

| Layer | Rating | Basis |
|---|---|---|
| Core catalog and inventory | Solid | Schema constrained, stock arithmetic uses atomic operators, audit trail present |
| POS billing | Improving | Tax model unified, invoice totals equal payments, rollback covers shift and invoice; cash refunds now reach the drawer (section 11) |
| GST invoicing | Improving | Tax base and line rates correct on the POS and order paths; GSTIN checksum and a real product rate column remain open |
| Procurement | Mostly solid | Over-receipt guard exists but is racy; inward cost reconciliation lossy |
| Returns | Improving | Refunds reach the drawer, over-return is blocked, exchanges raise their own invoice (section 11) |
| Banking and expenses | Mostly solid | Double-entry with pre-checks; still process-local locking |
| WhatsApp CRM | Feature-rich, unevenly hardened | Large surface, strong UX, weak authorization boundaries |
| Storefront and API routes | Improving | Order intake needs a verified WhatsApp session; feed and image endpoints are tenant-scoped (section 11.4). Remaining public endpoints are listed in 6.3. |
| Multi-tenancy | Improving | Physical isolation is real; the control plane now requires a session for existing tenants. Shared client and plaintext registry remain (section 11). |
| Build and release | **Blocked** | Static export vs 13 API routes; Tauri bundle omits PocketBase |
| Frontend architecture | Uneven | 135 direct database calls in UI, three pages over 100 KB |
| Test coverage | Weak | Hand-rolled scripts under `src/scripts`, no test runner in `package.json` |

---

## 3. Architecture

### 3.1 Runtime topology

```
                        +---------------------------------------+
                        |  Showroom device (Tauri / browser)    |
                        |  Next.js 16 static bundle, React 19   |
                        |  localStorage: auth, PB_CUSTOM_URL,   |
                        |  cart, offline queue                  |
                        +----------------+----------------------+
                                         |
              +--------------------------+---------------------------+
              |                          |                           |
   HTTP (PocketBase SDK)        HTTP (sidecar REST)        HTTPS (optional)
              |                          |                           |
   +----------v-----------+     +--------v---------+     +-----------v-----------+
   | PocketBase process   |     | WPPConnect       |     | Razorpay / PhonePe /  |
   | one per tenant       |     | sidecar :21465   |     | Meta Graph /          |
   | ports 8090, 8091,    |     | Node + Puppeteer |     | Google Drive /        |
   | 8092..8199           |     | + Chromium       |     | ST Courier            |
   | SQLite WAL           |     +------------------+     +-----------------------+
   +----------+-----------+
              |
   pocketbase/pb_data/data.db           (default / legacy tenant)
   pocketbase/pb_tenants/<slug>/data.db (provisioned tenants)

   Control plane, only when a Node server is running:
   Next.js API routes under /api/**  ->  tenant-db-manager  ->  spawns PocketBase,
   writes registry.json, upserts superusers, flips the global active tenant.
```

Ports as they exist in code:

| Service | Port | Source |
|---|---|---|
| Next.js dev | 3000 | `scripts/dev-all.js` |
| PocketBase (dev default) | 8090, fallback 8091 | `scripts/dev-all.js:106-123` |
| PocketBase (client default URL) | **8091** | `src/lib/pocketbase.ts:4` |
| PocketBase (provisioned tenants) | 8092 down to 8199 | `src/lib/tenant-db-manager.ts` |
| WhatsApp sidecar | 21465 | `wppconnect-sidecar/server.js` |

The client default and the dev script default disagree (8091 vs 8090). It works only because `autoDiscoverPocketBase()` probes `[8091, 8090, 8092]` when the first health check fails. Any new caller that builds a URL directly inherits the inconsistency.

### 3.2 The request path that matters: a POS sale

This is the money path, and it is the best lens on the architecture.

```
Cashier taps Charge
  -> src/app/pos/page.tsx            builds cart, computes total (NO GST)
  -> src/lib/pos-sales.ts            createPOSSale()
       1. sales row                    (channel, cashier, shift, totals)
       2. sale_items rows              (no gst_rate written)
       3. product_variants.stock_level- (atomic operator per item)
       4. stock_movements rows         (negative quantity)
       5. cash_register_shifts totals  (total_cash_sales / total_upi_sales)
       6. src/lib/invoice.ts createInvoiceFromSale()
            6a. invoices row           (status paid, is_paid true)
            6b. invoice_items rows     (GST computed here, on pre-discount base)
            6c. grand_total = taxable + tax - discount
            6d. paid_amount = sale.total
  -> UI prints receipt, optionally WhatsApp receipt + Razorpay link
```

Six writes across four collections, no transaction. Failure after step 3 triggers a compensating rollback that restores stock and deletes movements, items, and the sale, but **not** the shift totals and **not** an already-created invoice. The invoice it creates claims to be paid for an amount that is larger than what the customer paid. Both facts are defects D-01 and D-06 in section 7.

### 3.3 Tenancy model

Two independent mechanisms, deliberately layered:

1. **Physical isolation.** `tenant-db-manager.ts` provisions `pocketbase/pb_tenants/<slug>/data.db`, spawns a dedicated PocketBase process on a free port in 8092..8199, runs `pocketbase superuser upsert <email> <password>` against that data directory, and records `{port, dataDir, adminPassword}` in `pocketbase/pb_tenants/registry.json`. The registry also carries a single process-global `activeTenantEmail`.
2. **Row ownership.** Every business collection carries `account_email`. PocketBase API rules enforce `account_email = @request.auth.email` on list/view/update/delete and accept create only when the body's `account_email` is absent or equals the caller. `src/lib/pocketbase.ts` auto-injects `account_email` on every POST from the authenticated session.

Server-side code adds a third layer of sorts: `ensureServerAuth()` re-points the shared PocketBase client at the tenant named by `registry.activeTenantEmail` (or a caller-supplied email) and authenticates as that tenant's superuser.

Strengths: row rules are consistently applied across the schema; `updateRule` blocks attempts to change `account_email`; `user_roles` writes are Admin-gated, so direct database self-escalation is not possible.

Weakness: the control plane that decides *which* tenant the shared client talks to is a mutable module global with an unauthenticated HTTP entry point. See 6.3.

### 3.4 Layer rules (normative)

These are the rules the code is supposed to follow. Compliance is measured, not assumed.

| Rule | Intent | Compliance today |
|---|---|---|
| R1 | UI never talks to PocketBase directly; all access goes through `src/lib/*` | **Violated**: 135 `pb.collection()` calls in `src/app` and `src/components` |
| R2 | No hardcoded PocketBase URL; always use `pb` and `PB_CUSTOM_URL` | Mostly held; default port mismatch noted in 3.1 |
| R3 | Every page usable below 768 px; mobile nav via `MobileBottomNav` / `MobileDrawer` | Held on the pages reviewed; three oversized pages are hard to maintain |
| R4 | No Node-only features in app code (static export) | **Violated** by design: 13 API route handlers and `fs`/`child_process` usage inside `src/lib/tenant-db-manager.ts` |
| R5 | Sidecar binary named with target triple, supervised by Rust | Declared and supervised, but not verified on a packaged build |
| R6 | WhatsApp surfaces go through `whatsapp-crm.ts`, never ad-hoc collections | Partially held; the hub page still queries collections directly |
| R7 | Money and stock mutations go through domain services with rollback | Held for writes; rollback is incomplete (D-06) |
| R8 | Tenant selection never depends on unauthenticated input | **Violated**: `/api/system/tenant-db`, `/api/storefront/order` (section 6) |

R1 and R4 are the two rules that most explain the current defect profile: direct UI writes bypass the service layer's guards, and the API routes cannot exist in the shipping artifact.

### 3.5 Data model

The canonical schema is `pocketbase/pb_migrations/1700000000_initial_schema.js` plus `1791409408_created_stock_discrepancies.js`: **55 collections**, of which 49 are business collections and 6 are PocketBase system collections (`_superusers`, `_mfas`, `_otps`, `_externalAuths`, `_authOrigins`, and the `users` auth collection).

There is **no `src/scripts/init-pocketbase.ts`**, no `sync-pb-schema.ts`, no `apply-pb-access-rules.ts`, and no `update-whatsapp-crm-schema.ts`. Every earlier document that tells you to run them is wrong. Schema lives in migrations; `src/scripts` contains only test and seed scripts (13 files).

| Domain | Count | Collections |
|---|---|---|
| Catalog | 7 | `products`, `product_variants`, `categories`, `product_attributes`, `product_attribute_values`, `stock_movements`, `stock_discrepancies` |
| Sales | 13 | `sales`, `sale_items`, `sales_orders`, `sales_order_items`, `invoices`, `invoice_items`, `invoice_payments`, `delivery_challans`, `delivery_challan_items`, `credit_notes`, `credit_note_items`, `discounts`, `discount_usage` |
| Purchase | 6 | `purchase_orders`, `purchase_order_items`, `vendors`, `vendor_products`, `goods_received_notes`, `grn_items` |
| Finance | 8 | `bank_accounts`, `bank_transactions`, `cash_register_shifts`, `cash_drawer_operations`, `expenses`, `expense_categories`, `number_sequences`, `payment_links` |
| CRM and WhatsApp | 11 | `customers`, `customer_interactions`, `loyalty_accounts`, `loyalty_tiers`, `loyalty_settings`, `loyalty_transactions`, `whatsapp_chats`, `whatsapp_messages`, `whatsapp_opt_outs`, `broadcast_messages`, `label_print_queue` |
| System | 10 | `users`, `roles`, `user_roles`, `store_settings`, `activity_logs` plus the five PocketBase internals |

**Tenant key.** Tenancy is not a PocketBase feature here. It is a hand-rolled `account_email` text field appended to roughly 30 collections by migrations `1791804087` and `1792410185` through `1792410191`, enforced by API rules of the form `@request.auth.id != "" && account_email = @request.auth.email`.

Constraints that matter operationally:

- `product_variants.stock_level` carries a database `min: 0`, and stock is deducted with the `field-` operator, so an oversell fails at the database instead of going negative. The application then misreads that failure (D-03).
- Unique indexes exist on document numbers (`invoice_number`, `order_number`, `po_number`, `grn_number`, `credit_note_number`, `expense_number`, `challan_number`) and on `number_sequences.name`, all filtered `WHERE != ''`. There is **no** unique index on `invoices.order` or `sales.channel_order_id`, which is why order-to-invoice retries duplicate (D-20).
- `invoice_payments.amount` has no minimum, so negative payment rows are accepted; the exchange flow depends on that loophole (D-07).
- `store_settings` is key/value rows rather than a typed record, so a partial write can leave GSTIN and state code inconsistent (D-29).
- `sales.channel` accepts only `pos`, `shopify`, `whatsapp`, while `channel-pricing.ts` defines seven or more channel ids. Website, wholesale, and exhibition sales cannot be tagged correctly (D-37).

#### Schema drift: collections the code uses that do not exist

Six collection names are read or written by live code and are absent from every migration. Each call site wraps the failure in a silent catch, so the symptom is "no data" rather than an error, which is why this survived several audits.

| Missing collection | Used by | Consequence |
|---|---|---|
| `whatsapp_campaigns` | `campaign-attribution.ts:10,89,141,220` | Campaign attribution and the customer campaign panel cannot persist |
| `inventory_locations` | `multi-location.ts:133,212,214,352,458,513` | Multi-location silently falls back to localStorage, becoming device-local |
| `inventory_transfers` | `multi-location.ts` (same paths) | Inter-location transfers are never persisted |
| `catalog_sync_logs` | `catalog-sync.ts:54,149,163` | Catalog syncs run unlogged |
| `shipments` | `components/logistics/BarcodeScanDispatchModal.tsx:286` | AWB dispatch records are lost |
| `cash_registers` | `backup.ts` | Backup enumerates a collection that does not exist |

Column and enum drift adds four more:

- `sales_orders.razorpay_link_id` is written by `whatsapp-commander.ts:84` and typed in `types/database.ts:227`, but does not exist; `order.total_amount` is read at `:69` although the column is `total`.
- `sales_orders.status` enumerates lowercase values, while `whatsapp-commander.ts:61,65` writes `"SHIPPED"` and `"CANCELLED"`, which the database rejects.
- `types/database.ts` declares nine interfaces with no backing collection: `ManufacturingTransaction`, `Cheque`, `ChannelBufferRule`, `ShipmentRecord`, `DispatchManifest`, `ReturnQcInspection`, `CrossBorderExportInvoice`, `LocationRecord`, `StockTransferRecord`.
- `docs/WHATSAPP_ERP_CRM_SPECIFICATION.md:457` still points at the non-existent `init-pocketbase.ts`.

### 3.6 Integrations

| Integration | Module | Transport | State |
|---|---|---|---|
| WhatsApp send/receive | `whatsapp.ts`, `whatsapp-crm.ts`, sidecar | REST to `127.0.0.1:21465` with Bearer token and origin allowlist | Working; token default is compiled into the client bundle |
| Razorpay payment links | `razorpay.ts`, `payment-reconciliation.ts` | REST + polling; optional webhook | Link creation works; webhook secret absent, so webhook path returns 400 |
| PhonePe QR | `phonepe.ts` | Server-side signed requests | Works; secrets stay server-side |
| Meta catalog | `meta-catalog-batch.ts`, `catalog-sync.ts` | Graph API batch + CSV feed | Works; feed is unauthenticated |
| Shopify / WooCommerce | `src/lib/sync/*`, `sync-engine.ts` | REST/GraphQL clients | Scaffold; no scheduler |
| Google Drive sync | `google-drive-sync.ts` | Changelog JSON files | Scaffold with mock mode |
| ST Courier tracking | `logistics-engine.ts`, `/api/tracking/st-courier` | Scrapes carrier site | Works; unauthenticated proxy |
| Cloudflare Tunnel | `scripts/tunnel.js` | `cloudflared` | Working helper for remote devices |

---

## 4. Feature inventory

Status vocabulary, applied strictly:

- **Live**: implemented and used by a shipped screen; code path verified.
- **Partial**: implemented but with a known functional gap, an unenforced invariant, or a screen that can reach an inconsistent state.
- **Scaffold**: modules and types exist; no user-facing flow completes.
- **Absent**: specified in a document but not present in code.

### 4.1 Onboarding, auth, tenancy

| Feature | Status | Notes |
|---|---|---|
| First-run setup wizard | Live | `/setup` provisions a tenant database, seeds collections, creates the admin user |
| Email/password login against tenant database | Live | `/login` routes through `AuthContext`; tenant resolved by email before auth |
| Session persistence and restore | Live | Auth store hydration in `pocketbase.ts`; `PB_CUSTOM_URL` survives reloads |
| Five seeded roles | Partial | Roles exist; capability checks run only in the UI, never in API routes (S-07) |
| Per-tenant physical database | Live, with caveats | Provisioning works; control plane is unauthenticated (S-01, S-02) |
| Account switching | Partial | `activeTenantEmail` is process-global; concurrent users can cross tenants (S-05) |
| PIN / QR quick cashier switch | Absent | Roadmap only |

### 4.2 Catalog, inventory, and tagging

| Feature | Status | Notes |
|---|---|---|
| Product and variant CRUD | Live | Size/color/material matrix with per-variant price delta and stock |
| Category and attribute taxonomy | Live | Normalized attribute values |
| Barcode generation (Code128) | Live | `jsbarcode`, SVG and canvas |
| Batch label printing | Live | Thermal roll and A4 sheet layouts; queue fed by vendor ingestion |
| Low stock alerts | Live | Threshold per variant; dashboard and inventory badges |
| Stock movement audit trail | Live | Every increment and decrement logged with source |
| Excel bulk import | Live | `excel-import.ts` (36 KB) with template download route |
| SKU generator with jewelry grammar | Live | `sku-generator.ts` encodes category, metal, purity, size |
| Metal rate engine | Live | `jewelry-engine.ts` computes rate-based pricing |
| Manufacturing BOM | Scaffold | `manufacturing-engine.ts` implements BOM cost, metal-loss reconciliation, and tolerance checks; zero importers and no route |
| Karigar job-work tracker | Scaffold | Challan types support job work; `manufacturing-engine.ts` holds the reconciliation math but no artisan ledger screen exists |
| Imitation jewelry taxonomy | Scaffold | `imitation-jewelry-engine.ts` models kundan/polki/CZ crafts and wholesale tier pricing; zero importers |
| Anti-oversell cart reservations | Scaffold | `omnichannel-buffer-engine.ts` implements per-channel buffers and an in-memory reservation manager; zero importers, and in-memory state cannot survive a reload |
| Multi-location stock | Partial | `multi-location.ts` is wired to three screens but reads phantom collections and falls back to localStorage, so transfers are device-local |
| Stock discrepancy audit | Partial | `discrepancies.ts` plus a seeding script; no reconciliation UI |
| Old gold / trade-in exchange | Absent | Roadmap |
| HUID / hallmark certificate vault | Absent | Roadmap |
| Savings scheme (11+1) | Absent | Roadmap |

### 4.3 POS and cash control

| Feature | Status | Notes |
|---|---|---|
| Cart, item and bill discounts | Live | Full and percentage discounts |
| Variant picker and fast search | Live | Grid, keyboard, barcode wedge |
| Hardware barcode scanner | Live | Keyboard-wedge listener with context routing |
| Camera scanning | Live | `html5-qrcode` |
| Cash / card / UPI / PhonePe QR tenders | Live | Single tender per sale |
| Split tender | Absent | Roadmap; tenders are exclusive |
| Cash drawer open/close and variance | Partial | Reconciliation formula correct, but refunds never reach it (D-07) |
| Blind shift close | Live | Expected balance hidden during count |
| POS receipt printing | Live | Browser print and Android spooler paths |
| POS GST display | **Absent** | The cart shows no tax at all, which is the root of D-01 |
| Offline sale queue | Partial | Queues mutations; replay is last-write-wins |
| Held carts / park sale | Absent | Not found in POS code |

### 4.4 GST invoicing and statutory

| Feature | Status | Notes |
|---|---|---|
| B2B and B2C invoices | Live | Seller/buyer state drives CGST+SGST vs IGST |
| Invoice numbering | Partial | In-process mutex plus unique-index retry; cross-process not safe (D-24) |
| Amount in words | Live | Indian numbering; handles negatives |
| Reverse charge flag | Live | Field and print output |
| E-way bill JSON | Partial | Payload builder exists; defaults to Karnataka state code 29 when unset (D-13) |
| GSTR-1 engine | Scaffold (unused) | `gstr1-engine.ts` implements the GSTN v3.0.4 schema with CDNR, CDNUR, HSN and DOCS, but has zero importers; `/reports/gst` uses the simplified builder in `reports.ts`, so credit-note and HSN tables never reach filing (D-09) |
| GSTIN validation | **Partial** | Regex only, no checksum (D-11) |
| Credit notes against invoices | Partial | Created and restocked; cumulative over-return unchecked (D-08) |
| Invoice PDF | Live | Print stylesheet based |
| E-invoice / IRN | Absent | Not implemented |

### 4.5 Orders, challans, procurement

| Feature | Status | Notes |
|---|---|---|
| Quotations and estimates | Live | Validity dates, conversion to order |
| Order status lifecycle | Live | draft to invoiced, with cancel |
| Order to invoice | Partial | Creates real invoice; retry can duplicate (D-10) |
| Delivery challans | Live | Job work, stock transfer, exhibition, approval; delivery date mapping normalized |
| Purchase orders and GRN | Live | Line-level accepted/rejected with reasons |
| GRN over-receipt guard | Partial | Present but racy across processes (D-12) |
| Vendor SKU mapping and lead times | Live | |
| Advance / down payment tracking | Partial | Fields exist; no ledger integration |
| Landed cost reconciliation | Partial | Stored inside a notes blob, concurrent batches lose data (D-12b) |

### 4.6 Customers, loyalty, CRM

| Feature | Status | Notes |
|---|---|---|
| Customer directory and ledger | Live | Lifetime value, GSTIN, addresses |
| Interaction log | Live | Preferences, ring size, anniversaries |
| Loyalty accrual and tiers | Partial | Accrual works; redemption cap not enforced server-side (D-14) |
| Points ledger | Live | Earn, redeem, expire, adjust |
| RFM segmentation | Partial | `crm-rfm.ts` computes segments; campaign targeting uses simpler audience queries |
| Campaign attribution | Partial (broken) | `campaign-attribution.ts` reads the phantom `whatsapp_campaigns` collection, so attribution never persists (D-36) |
| Lifecycle triggers | Partial | `crm-lifecycle-triggers.ts`; templates must remain editable per project rule |

### 4.7 Finance

| Feature | Status | Notes |
|---|---|---|
| Bank account registry and double-entry transactions | Live | Overdraft pre-check, transfer compensation |
| Expense vouchers and categories | Live | Filter injection fixed in some modules, still open in expenses (D-20) |
| Cash refunds | **Absent** | No code path writes cash refunds to the drawer or ledger (D-07) |
| Cheque / PDC tracking | Scaffold | `cheque-engine.ts` models the clearing lifecycle; zero importers, no screen, no collection |
| Returns QC routing | Scaffold | `returns-qc-engine.ts` grades returns into restock, repair, or write-off; not called by `/returns` |
| Cross-border LUT export | Scaffold | `cross-border-engine.ts` compiles zero-rated export invoices against a static FX table; no route |
| Bank reconciliation import | Absent | Manual entry only |
| Day book / trial balance | Partial | Reports exist; no formal accounting statements |

### 4.8 Reporting and analytics

| Feature | Status | Notes |
|---|---|---|
| Executive KPI dashboard | Live | Today's sales, shift status, low stock |
| Sales, stock, and GST report pages | Live | `/reports`, `/reports/sales`, `/reports/stock`, `/reports/gst` |
| Inventory valuation | Partial | Cost-based; ignores landed cost accuracy issue |
| Channel attribution (POS vs WhatsApp vs storefront) | Partial | Channel field exists; storefront writes its own channel |
| Scheduled report delivery | Absent | |

### 4.9 Storefront and public channels

| Feature | Status | Notes |
|---|---|---|
| Public storefront content API | Live | Unauthenticated read; tenant chosen by query or fallback |
| OTP login over WhatsApp | Partial | Works; no daily cap, token issued on DB failure (S-09, S-13) |
| COD / concierge order intake | **Unsafe** | Unauthenticated stock decrement for any tenant (S-03) |
| Catalog CSV feed for Meta | Partial | Unauthenticated, tenant leakage (S-12) |
| Product image streaming | Partial | No tenant guard on single-record read (S-14) |
| Customer self-service delete | Live | Token-bound and tenant-checked |

### 4.10 WhatsApp commerce

| Feature | Status | Notes |
|---|---|---|
| QR pairing and session persistence | Live | Session restore hardened across recent commits |
| Chat persistence and unread counts | Live | `whatsapp_chats`, `whatsapp_messages` |
| Contact resolution (customer/vendor/lead) | Live | E.164 normalization, lead auto-creation |
| Context actions (right click, long press) | Live | Desktop palette, mobile sheet with haptics |
| Add to POS cart bridge | Live | `BroadcastChannel('pos_cart')` plus localStorage event |
| Vendor ingestion with draft GRN | Live | Extracts purity/weight/price, queues barcode labels |
| Payment link send and polling settlement | Live | Polling engine; webhook path unarmed |
| Inbound intent router with approval banner | Live | STOP opt-out, draft order, send link |
| Product cards in chat | Live | Live stock and price |
| Catalog publishing | Partial | Publish path exists; Meta batch token doubles as API key |
| Broadcast campaigns with anti-ban pacing | Live | 8-22 s jitter, 150/day cap, opt-out filtering |
| WhatsApp admin bot | Scaffold (broken) | `whatsapp-commander.ts` has zero importers and writes uppercase statuses plus a non-existent `razorpay_link_id`, so its commands would fail at the database |
| Flash drops | Partial | `whatsapp-flash-drops.ts`; no scheduling UI |
| WhatsApp Flows (interactive) | Absent | Roadmap |

### 4.11 Platform, mobile, operations

| Feature | Status | Notes |
|---|---|---|
| Desktop shell with sidecar supervision | Live | Rust restarts sidecar after 3 failed health checks |
| Desktop shell with database | **Absent** | Tauri does not start or bundle PocketBase (D-26) |
| Static export production build | **Broken** | 13 API routes cannot exist under `output: "export"` (D-25) |
| Android APK build | Blocked on this workstation | exFAT volume cannot host the required symlinks (5.3) |
| PWA install | Live | Manifest plus apple meta |
| Offline mutation queue | Scaffold | `offline-queue.ts` has a `flush()` replay but zero importers and no online/offline listener, so nothing is ever queued |
| Google Drive sync | Scaffold (mock) | `google-drive-sync.ts:169-182` is a 1.2 s timeout that clears the changelog; `connect()` only flips a localStorage flag |
| Backup and restore | Partial | `backup.ts` covers 31 collections but has no UI importer; `/settings` exports only a 6-collection snapshot with no restore path |
| Activity log / audit trail | Live | Before/after JSON snapshots |
| Automated test suite | **Absent as infrastructure** | Hand-rolled scripts under `src/scripts`; no runner in `package.json` |
| CI pipeline | Absent | No workflow files |

---

## 5. Build and release truth

### 5.1 The central contradiction

`next.config.ts:9` enables `output: "export"` whenever `NODE_ENV=production`. Static export requires every route to be statically renderable. The repository contains 13 route handlers under `src/app/api/**`, and three of them explicitly declare `export const dynamic = 'force-dynamic'`:

- `src/app/api/catalog/feed/route.ts:6`
- `src/app/api/catalog/batch/route.ts:7`
- `src/app/api/catalog/image/route.ts:4`

`force-dynamic` is the exact opposite of what export permits. The remaining ten handlers make no static declaration at all and are dynamic by default because they read request bodies, headers, or query strings.

Consequences, in order of severity:

1. `npm run build` cannot produce the artifact `src-tauri/tauri.conf.json` points at (`frontendDist: "../out"`). The documented release command `npm run tauri:build` chains `npm run build`, so it cannot ship.
2. Even if the export were forced through, every API route would be absent from the packaged app. That removes tenant provisioning, storefront checkout, OTP login, Razorpay links, PhonePe initiation, the Meta catalog feed, and courier tracking. The desktop product would silently lose its online surfaces.
3. The development server hides all of this, because `output` is only set in production.

Two coherent resolutions exist. Pick one before writing more feature code:

| Option | Shape | Cost |
|---|---|---|
| **A. Server-backed** | Drop `output: "export"`; run `next start` inside the Tauri app or beside it; keep API routes | Requires the Rust shell to supervise a Node process, and the installer to ship Node or a bundled server |
| **B. Endpoint-free** | Keep static export; move the 13 handlers into the existing WPPConnect Node sidecar (already a supervised process) | Rewrites the API surface into the sidecar; loses Next routing conveniences |

The current code is a hybrid that satisfies neither.

### 5.2 What the desktop installer actually contains

`src-tauri/tauri.conf.json` declares exactly one external binary, `binaries/wppconnect-server`. There is no `resources` entry, no PocketBase binary, and no startup code for PocketBase in `src-tauri/src/lib.rs` (the Rust supervisor starts only the sidecar and polls `http://127.0.0.1:21465/health`).

Therefore a packaged desktop build, if it could be produced, would launch a webview whose only local service is WhatsApp. The database would have to be started by the user from a separate terminal. The product's central claim, an embedded local database, is not delivered by the packaging configuration.

### 5.3 Environment blockers observed on this workstation

These are specific to `E:\`, which is formatted **exFAT**:

| Blocker | Evidence | Effect |
|---|---|---|
| Repository cannot store Windows ACLs | volume owner resolves to `Everyone` with a single full-control entry | The agent sandbox, which provisions write access through permissions, denies all file writes here; `tsc` fails writing `tsconfig.tsbuildinfo`, `next build` fails writing `.next/trace-build` |
| Hard links unsupported | file-creation through link-based tooling fails with `EISDIR` | Some tooling cannot write atomically to this volume |
| Android symlink step fails | Tauri/Gradle must symlink `libapp_lib.so` into `jniLibs` | Native APK build aborts; PWA is the working Android path |

None of these is a defect in the application. They do change what "verified" can mean in this document: the production build could not be executed here, so the build verdict rests on configuration and route declarations, which are unambiguous.

### 5.4 Commands that are known good

```bash
npm run dev            # Next 3000 + PocketBase (8090/8091) + sidecar 21465
npm run dev:frontend   # Next only
npm run dev:pb         # PocketBase only, 0.0.0.0:8090, pb_data
npm run dev:sidecar    # WPPConnect sidecar only
npm run tunnel         # Cloudflare quick tunnels for LAN/remote devices
npx tsc --noEmit --incremental false
npx eslint src
# Schema is applied by PocketBase itself from pocketbase/pb_migrations on startup.
# There is no init/sync/seed-roles script in src/scripts; the 13 files there are
# test and seed utilities (for example test-phase2-phase3.ts, setup-discrepancies.js).
```

`npm run build` is **not** known good (5.1). Treat any document that presents it as a supported step as superseded.

---

## 6. Security posture

### 6.1 Authentication model

- Staff authenticate against the tenant's PocketBase `users` collection. Sessions are JWT-based, persisted in localStorage.
- API routes that require staff authenticate by calling `ensureServerAuth()` and then validating `pb.authStore` against a bearer token. `src/app/api/pos/payment/route.ts` is the reference pattern.
- Customers authenticate through WhatsApp OTP and receive a signed HMAC token (`customer-token.ts`) with a 30-day TTL.
- Webhooks authenticate with an HMAC signature (`razorpay.ts`). This implementation is correct and fails closed.

### 6.2 What actually protects data

1. PocketBase rules restrict every business collection to `account_email = @request.auth.email`, and block attempts to change `account_email` on update.
2. Physical database separation per provisioned tenant.
3. Relational guards in routes that run as superuser (product tenant checks, discount scoping, catalog filters).
4. `sanitizeFilter` applied in the catalog and product paths.
5. Customer tokens carry the tenant and are validated against the record they modify.

### 6.3 Open security findings

Severity here reflects exploitability of the deployed system, not code aesthetics. All are reachable without credentials unless stated.

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| S-01 | **P1** | `POST /api/system/tenant-db` accepts `{mode:"provision", email, password}` and runs `pocketbase superuser upsert <email> <password>` against that tenant's data directory. An anonymous caller can reset any merchant's superuser password and take the database. | `src/app/api/system/tenant-db/route.ts:36-64`, `src/lib/tenant-db-manager.ts:310`, `:196-207` |
| S-02 | **P1** | `GET /api/system/tenant-db?email=X` writes the process-global `activeTenantEmail` and returns tenant existence and port. Unauthenticated tenant enumeration plus global re-pointing. | `route.ts:14-20`, `tenant-db-manager.ts:376-377`, `:392-393` |
| S-03 | **P1** | `POST /api/storefront/order` takes `accountEmail` from the request body, authenticates as that tenant's superuser, and for `paymentMethod:"cod"` decrements product and variant stock with no payment and no auth. Repeat calls zero a competitor's inventory. | `src/app/api/storefront/order/route.ts:86-87`, `:220-239`, `:257-283` |
| S-04 | **P1** | `getStorefrontBinding` interpolates caller input into a PocketBase filter without sanitization, letting an unauthenticated caller choose which tenant's binding is used downstream. | `src/lib/storefront.ts:22-26` |
| S-05 | **P1** | The PocketBase client is a process-global singleton re-pointed per request while holding a superuser session. Concurrent requests for different tenants race, and any route that forgets to re-authenticate inherits the previous tenant's session. `pos/payment` calls the resolver with an unverified body email before checking the JWT. | `src/lib/pocketbase.ts:32`, `:80-128`; `src/app/api/pos/payment/route.ts:32` |
| S-06 | **P1** | Tenant superuser passwords are stored in plaintext in `pocketbase/pb_tenants/registry.json`, a hardcoded fallback `LuminilaInit2026!` exists, and tenant databases bind `0.0.0.0`. | `tenant-db-manager.ts:286`, `:325`, `:428`, `:442`, `:230` |
| S-07 | P2 | RBAC is UI-only. No API route checks capabilities; any valid staff token can create payment links, push to Meta, and write storefront content. `rbac.ts` has exactly one importer. | `src/lib/rbac.ts:241-300`; `src/app/users/page.tsx:53` |
| S-08 | P2 | The WhatsApp sidecar bearer token defaults to a literal (`luminila-secret-key`) exposed through a `NEXT_PUBLIC_` variable and imported by 12 client files. Binding to `127.0.0.1` with an origin allowlist is the only control. | `src/lib/whatsapp.ts:10`; `wppconnect-sidecar/server.js:18`, `:98-104`, `:3055` |
| S-09 | P2 | OTP has no daily cap; `requestCount` is recorded and never read. OTP is keyed by phone, not tenant, so a code minted for one tenant verifies against another. `send-otp` returns success even when delivery fails. | `src/lib/otp-store.ts:76`, `:98`; `src/app/api/storefront/auth/send-otp/route.ts:66-87` |
| S-10 | P2 | Razorpay webhook: `RAZORPAY_WEBHOOK_SECRET` is absent from `.env.local`, so every webhook returns 400 and settlement depends on the client-side poller. No event-id dedupe, no timestamp tolerance, no amount comparison. Tenant comes from `notes.account_email`. | `src/lib/razorpay.ts:20-25`, `:639-665`; `razorpay-webhook-handler.ts:23-35` |
| S-11 | P2 | Customer session secret is ephemeral when `CUSTOMER_SESSION_SECRET` / `JWT_SECRET` are unset: a random per-process key is generated, so tokens break on restart and in multi-worker deployments. | `src/lib/customer-token.ts:4-14` |
| S-12 | P2 | Unauthenticated catalog feed returns an arbitrary tenant's catalog when no account is given, can be poisoned through `x-forwarded-host`, and is cached publicly for 300 s. | `src/app/api/catalog/feed/route.ts:20-53`, `:179`; `meta-catalog-batch.ts:40-44` |
| S-13 | P2 | `verify-otp` still signs a valid 30-day token bound to a non-persisted `temp_<timestamp>` id when PocketBase is unreachable, and auto-creates customers with 50 loyalty points for any phone. | `src/app/api/storefront/auth/verify-otp/route.ts:70-90` |
| S-14 | P3 | Unauthenticated single-record reads ignore the tenant parameter (`catalog/image` uses a server superuser `getOne`), and the inventory template route serves whichever tenant the global client is authenticated as. | `src/app/api/catalog/image/route.ts:19-21`; `src/app/api/inventory/template/route.ts:4-8` |
| S-15 | P3 | Unauthenticated outbound scraping proxy to ST Courier with no rate limit and a 60 s public cache. | `src/app/api/tracking/st-courier/route.ts:44`, `:162-168` |
| S-16 | P3 | Meta catalog id and phone number are hardcoded; the internal sync key is compared to a Meta Graph token with `===`, making a Meta token a bearer-equivalent key. | `src/app/api/catalog/batch/route.ts:39`, `:70-72` |

> **Status, 2026-10-23.** Closed: S-01, S-02, S-03, S-04, S-09, S-12, S-13, S-14 (section 11). S-05 and S-06 are partially mitigated. S-07, S-08, S-10, S-11, S-15 and S-16 remain open.

Two honest qualifications:

- Most of these routes **do not exist in the shipped static export** (5.1). The deployed risk depends on whether the operator runs a Node server. That does not make them acceptable: the dev server, the documented `npm run dev` flow, and any tunnel-exposed deployment all serve them.
- No live third-party secrets are committed. `.env.local` is untracked and contains only the PocketBase URL and superuser credentials.

### 6.4 What is genuinely well built

- Row-level tenant rules are consistent and correctly written, including the `@request.body.account_email:isset = false` guard on updates.
- `user_roles` create/delete is Admin-gated at the database, closing the obvious self-escalation path.
- The webhook HMAC implementation is correct and fails closed on a missing secret.
- The sidecar binds loopback, checks a bearer token, and enforces an origin allowlist.
- Customer deletion validates token tenant, body id, and stored record tenant before deleting.

---

## 7. Defect register

Format: **ID | severity | status | evidence | impact | required fix**. Line numbers were verified on 2026-10-23 against `f0e96b4`.

Severity definitions used here:

- **P1**: corrupts money, stock, tenant data, or blocks release. Fix before any deployment.
- **P2**: produces wrong output in a normal workflow, or fails under concurrency, or creates a durable inconsistency. Fix before release.
- **P3**: hygiene, dead code, maintainability, accessibility, or cosmetic correctness. Batch fix.

> **Status update, 2026-10-23.** Closed: D-01, D-02, D-03, D-05, D-06, D-07, D-10, D-11, D-20, D-25, S-01, S-02, S-03, S-04, S-09, S-12, S-13, S-14. Partial: D-14 (needs a product rate column), D-22 (redirect done, navigation still unfiltered), S-05 (per-request clients added on the control plane only), S-06 (fallback and network bind fixed, registry still holds passwords). Evidence and verification are in section 11. Entries below stay as written at audit time so the history remains readable.

### 7.1 P1 defects

#### D-01 POS invoices claim to be paid for more than the customer paid
- **Evidence**: `src/lib/invoice.ts:1082-1090` (GST per line), `:1142` (`grand_total = taxable + tax`), `:1168` (`status: 'paid'`), `:1182`, `:1188` (`paid_amount: sale.total || ...`); POS cart totals at `src/app/pos/page.tsx:714-717` contain no tax.
- **Impact**: every POS invoice says paid while `grand_total` exceeds `paid_amount` by the tax amount. GST reports overstate output tax; drawer takings never reconcile to invoices.
- **Fix**: choose one tax model. Recommended: treat POS totals as tax-inclusive, back-compute `taxable = total / (1 + rate)`, set `paid_amount = grand_total`, and show the tax component in the cart. Then migrate historical rows or mark them.

#### D-02 POS GST is computed on the pre-discount base
- **Evidence**: `invoice.ts:1085-1090` taxes the undiscounted line and forces line discounts to zero at `:1110-1111`; `sale.discount` is subtracted only at document level (`:1172`). `src/lib/orders.ts:246-251` does the opposite and taxes `gross - discount_amount`.
- **Impact**: on discounted sales CGST/SGST are overstated, which is both a statutory error (GST Act s.15 requires discount-adjusted taxable value) and an internal contradiction between two invoice creation paths.
- **Fix**: apply the discount to the taxable base before tax in both paths, and share one calculation function.

#### D-03 Any 400 on a stock update is treated as "insufficient stock" and writes stock to zero
- **Evidence**: `src/lib/pos-sales.ts:166-168` matches `pbErr?.status === 400`; `:170-176` writes `stock_level: 0` and continues the sale. Stock movements (`:138-146`) still record `-qty`.
- **Impact**: a permissions error, a validation error, or a malformed request silently destroys a variant's stock count and leaves the movement ledger permanently inconsistent with the variant row.
- **Fix**: match only the `validation_min_number_constraint` error code; on anything else, fail the line and compensate.

#### D-04 Conditional React hooks can crash the WhatsApp chat view
- **Evidence**: `src/app/whatsapp/page.tsx:295-299`; `if (!msg.quotedMsg) return null;` executes before three `useState` calls and one `useEffect`. Confirmed by ESLint `react-hooks/rules-of-hooks` (four errors, the only error-severity React findings in the repo).
- **Impact**: when React reuses a slot for a message without a quoted reply after one with a reply, the hook count changes and the whole chat page throws "Rendered fewer hooks than expected".
- **Fix**: move the early return after the hooks.

#### D-05 Cash refunds are never recorded, so the drawer is always wrong after a return
- **Evidence**: `src/lib/returns.ts:424-435` (`processRefund`) only flips refund status and fields. `cash_register_shifts.total_cash_refunds` has **no writer anywhere in `src/`**; it is read at `register.ts:183-184` and `:427-428`.
- **Impact**: expected drawer balance ignores every cash refund, so every cash return produces a false variance and a manager override. The refund also never appears in banking.
- **Fix**: write a refund row (`cash_drawer_operations` type `refund`) and increment `total_cash_refunds` in the same logical operation as the status change.

#### D-06 Returns can exceed the invoiced quantity
- **Evidence**: `src/lib/returns.ts:458-499`, quantities used verbatim at `:470`; the only cap is per-form in `src/app/returns/create/page.tsx:119`.
- **Impact**: two sequential returns of the same line credit double the value and restock double the goods. This is a direct financial loss path with a plausible innocent trigger (customer returns in two visits).
- **Fix**: sum prior non-cancelled `credit_note_items` per `original_invoice_item` and reject anything above the remaining quantity.

#### D-07 Exchanges ship goods with no tax document and book a negative payment
- **Evidence**: `returns.ts:660-670`, `:742-771`, `:787-793`; the difference is written as `amount: balanceDue` (negative) against the original invoice; `invoice_payments.amount` has no minimum; `invoice.ts:172-175` re-sums payments with `Math.max`.
- **Impact**: output GST on replacement jewelry is never recorded, and a later `recordPayment` includes the negative row, misstating `paid_amount` and therefore the customer's outstanding balance.
- **Fix**: create an exchange invoice or debit note for replacement goods, record refunds as their own documents, and keep payment rows non-negative.

#### D-08 The release pipeline cannot produce the artifact it is configured to use
- **Evidence**: `next.config.ts:9` (`output: "export"` in production); 13 handlers under `src/app/api/**`; `force-dynamic` at `catalog/feed/route.ts:6`, `catalog/batch/route.ts:7`, `catalog/image/route.ts:4`; `tauri.conf.json:7` (`frontendDist: "../out"`) and `:10` (`beforeBuildCommand: "npm run build"`); `out/` was last written 2026-10-17, contains no `api/` directory, and predates `/storefront-control`.
- **Impact**: `npm run tauri:build` cannot ship. If the export were forced, every API route would vanish from the packaged app, removing tenant provisioning, storefront checkout, OTP, payments, and catalog sync.
- **Fix**: decide between the two architectures in 5.1, then delete the losing path. Do not add a 14th route handler before this decision.

#### D-09 The desktop package contains no database engine
- **Evidence**: `src-tauri/tauri.conf.json:32-34` declares only `binaries/wppconnect-server`; no `resources` entry; `src-tauri/src/lib.rs` starts only the sidecar (`:24-58`) and polls `:21465/health` (`:16`). PocketBase is started only by `scripts/dev-all.js:15-16`.
- **Impact**: an installed desktop build opens a UI with no database. The product's core promise (embedded local-first database) is unmet by the packaging, and the failure is silent to the user.
- **Fix**: ship `pocketbase.exe` as a resource or external binary, start it from Rust on a free port, pass the resolved URL to the webview, and stop it on exit.

### 7.2 P2 defects

#### D-10 POS rollback leaves shift totals inflated and an orphan invoice
- **Evidence**: `pos-sales.ts:211` (shift totals), `:215` (invoice creation) both outside the try/catch compensation at `:226-262`; the clamped stock at `:174` is never restored because `stockDeductions.push` only happens on success (`:153`).
- **Impact**: a failure late in checkout leaves the money summary overstated and an invoice with no sale behind it.
- **Fix**: move steps 5 and 6 inside the compensated block and add invoice deletion plus shift decrement.

#### D-11 Invoice headers and items are written without rollback
- **Evidence**: `invoice.ts:522-527` creates the header, `:531-580` loops items with no try/catch; the sequence number is consumed at creation.
- **Impact**: an item failure leaves an empty invoice and a burned document number; the next invoice skips a number, which auditors notice.
- **Fix**: create items first in a staging collection, or delete the header and release the number on failure.

#### D-12 GRN over-receipt guard is racy and its failures are swallowed
- **Evidence**: `purchase.ts:678-685` reads `quantity_received`, `:728-735` writes it back; `:720-722` and `:736-738` only log stock and PO update failures.
- **Impact**: two concurrent GRNs both pass the cap and over-receive; a failed stock write leaves `quantity_received` ahead of physical stock, and the next GRN cannot correct it.
- **Fix**: serialize per PO item (the repo already has `concurrency.ts`) and fail the GRN if any stock or PO write fails.

#### D-13 Landed cost is stored inside a notes blob and lost on concurrency
- **Evidence**: `purchase.ts:1244-1300`: read blob at `:1254`, add, write whole blob at `:1297`; unsanitized filter at `:1246`.
- **Impact**: two reconciliations running close together lose one inward cost, understating inventory valuation. The unsanitized filter is also an injection point.
- **Fix**: add a numeric `inward_cost` field to the PO collection and use atomic increments; sanitize the filter.

#### D-14 POS hardcodes 3% jewelry GST and ignores the line rate field
- **Evidence**: `invoice.ts:1082` applies `GST_RATES.JEWELRY`; `sale_items.gst_rate` exists (schema) but `pos-sales.ts:114-133` never writes it.
- **Impact**: imitation jewelry (18%) and separately billed making charges (5%) are under-taxed on every POS invoice.
- **Fix**: persist the line rate at sale time and use it at invoicing.

#### D-15 Order-to-invoice emits 0% GST and a wrong HSN
- **Evidence**: `orders.ts:156` (`tax_rate: item.tax_rate || 0`), `:250` (`gstRate = item.tax_rate || 0`), `:256` (hardcoded HSN `7117`).
- **Impact**: a GST-registered store can issue a 0% tax invoice from an order, and every line is reported as imitation jewelry, so GSTR-1 HSN summaries disagree with the invoice.
- **Fix**: derive the rate from HSN/category, default to the store's configured rate, and derive HSN from the product.

#### D-16 GSTIN is validated by regex only, never by checksum
- **Evidence**: `gst.ts:226-237`, duplicated at `eway-bill.ts:689-694`.
- **Impact**: any 15-character string of the right shape is printed on invoices and EWB payloads, causing filing rejection.
- **Fix**: implement the GSTIN mod-36 check digit once and reuse it.

#### D-17 Loyalty balances lose updates and the redemption cap is not enforced
- **Evidence**: `loyalty.ts:371-387` writes an absolute `current_balance` outside `enqueueTask`; `:313-363` never enforces `max_redemption_percent` (only the advisory helper at `:334` computes it).
- **Impact**: concurrent adjustments lose points (a real liability), and a customer can pay 100% of a bill in points.
- **Fix**: use atomic increments inside the queue and enforce the cap at redemption.

#### D-18 Negative quantities invert stock movements
- **Evidence**: `pos-sales.ts:113-152`; schema `quantity` fields have no minimum; `:141` writes `quantity: -item.quantity`.
- **Impact**: a negative cart line increases stock while reducing the bill, which is an inventory-loss primitive.
- **Fix**: validate `quantity > 0` and finite at every write boundary.

#### D-19 Document numbering is only safe inside one process
- **Evidence**: `sequence-generator.ts:68-82` read-modify-write, in-process mutex only (`concurrency.ts:7-34`); unique indexes exist on all document numbers but not on `invoices.order`.
- **Impact**: two windows (or the desktop app plus a browser) can allocate the same number. The unique index converts corruption into a user-visible failure, not into correctness.
- **Fix**: allocate with a PocketBase transaction or a single-writer sidecar endpoint.

#### D-20 Order-to-invoice retries duplicate invoices
- **Evidence**: `orders.ts:287-326` creates the invoice then updates the order; if the update fails the function throws and a retry creates a second invoice. No unique index on `invoices.order`.
- **Impact**: duplicate revenue and duplicate tax liability for one order.
- **Fix**: add a unique index on `invoices.order` and make the write idempotent.

#### D-21 Discount engine has four independent gaps
- **Evidence**: `discounts.ts:12` (`buy_x_get_y`), `:156` (`discountAmount = 0` for BOGO), `:266` (unsanitized `code="${...}"`), `:315-323` (check-then-increment usage), `:362` (no reversal on return).
- **Impact**: a configured BOGO silently does nothing; usage limits can be exceeded; coupons are never returned to inventory, so a returned order burns the coupon.
- **Fix**: implement BOGO or remove it from the UI, sanitize, serialize usage, and reverse usage on return.

#### D-22 Authentication is decorative on the client
- **Evidence**: `usePermissions` has one importer (`src/components/auth/ProtectedRoute.tsx:7`), used by two pages (`src/app/page.tsx:88`, `src/app/users/page.tsx`); the sidebar and mobile drawer render every item to every role; nothing redirects an unauthenticated visitor to `/login`; `ProtectedRoute` renders a sign-in card instead of redirecting.
- **Impact**: a visitor with no session can browse the shell of every page and trigger the data calls those pages make; a Cashier sees User Management and Settings. Combined with S-07, UI gating is the only gate.
- **Fix**: add a route-level guard in the app shell that redirects to `/login`, filter navigation by capability, and enforce capabilities in API routes.

#### D-23 Architectural debt: UI bypasses the service layer at scale
- **Evidence**: 135 `pb.collection(...)` calls outside `src/lib` (97 in pages and components across 26 files, 38 in API routes). Worst offenders: `src/app/setup/page.tsx` (17), `src/app/inventory/page.tsx` (13), `WhatsAppCatalogEditorModal.tsx` (9), `src/app/whatsapp/page.tsx` (8). Three pages exceed 100 KB (`whatsapp` 231 KB, `storefront-control` 192 KB, `pos` 126 KB) and all 40 pages are client components.
- **Impact**: rules R1 and R6 are unenforceable, so validation, tenancy injection, and rollback live in some paths and not others. Large client pages make every change risky.
- **Fix**: extract page-level data access into hooks backed by `src/lib` services, starting with `setup` and `inventory`; split the three large pages by feature.

#### D-24 No automated test infrastructure and no CI
- **Evidence**: `package.json` has no test runner or test script; verification lives in `src/scripts/test-*.ts` executed by hand (`tsx`), plus `test-phase2-phase3.ts` at 90 KB.
- **Impact**: every regression listed in this register was findable by a test that does not exist. "181 tests passing" in older documents refers to a hand-run script, not to a suite any change re-runs.
- **Fix**: adopt Vitest for service-layer units and Playwright for the POS, return, and drawer flows; wire both into CI.

#### D-36 Six collections the code uses do not exist
- **Evidence**: `whatsapp_campaigns` (`campaign-attribution.ts:10,89,141,220`), `inventory_locations` and `inventory_transfers` (`multi-location.ts:133,212,214,352,458,513`), `catalog_sync_logs` (`catalog-sync.ts:54,149,163`), `shipments` (`BarcodeScanDispatchModal.tsx:286`), `cash_registers` (`backup.ts`). None appear in any migration.
- **Impact**: each call site catches the 404 and continues, so campaign attribution, multi-location transfers, sync logging, AWB dispatch, and part of the backup silently produce nothing. Users see empty screens rather than errors, which is why this survived multiple audits. Multi-location also degrades to localStorage, so two devices disagree about stock locations.
- **Fix**: either create the six collections in a migration, or delete the features and their UI entry points. Do not leave code that cannot persist.

### 7.3 P3 defects

| ID | Defect | Evidence | Fix |
|---|---|---|---|
| D-25 | Opening float is written with `operation_type: 'opening_float'`, which is not in the schema enum `add\|remove\|sale\|refund`. The create fails and is swallowed, so the opening-float audit row never exists. | `register.ts:107-114`; schema enum in `pb_migrations/1700000000_initial_schema.js:3595-3600` | Add the enum value, and stop swallowing the error |
| D-26 | Expense search interpolates raw input into a filter, reintroducing filter injection in the one module not yet sanitized. | `expenses.ts:113-119`; `sanitizeFilter` available at `pocketbase.ts:301-303` | Import and apply `sanitizeFilter` |
| D-27 | `paid_amount` uses `\|\|`, so a legitimately zero-value invoice (100% discount) is stamped with a positive amount. | `invoice.ts:1188` | Use `??` and clamp to `grand_total` |
| D-28 | E-way bills silently default the seller and buyer state to Karnataka (29) when the state code is empty. | `eway-bill.ts:629`, `:635`, `:638` | Block generation until state codes and GSTIN are set |
| D-29 | The `updateStoreSettings` writer creates rows without `account_email`, which the reader filters on, so any saved value becomes invisible. It currently has zero callers. | `invoice.ts:390-408` vs `:304` | Delete the dead writer; use `settings.ts` |
| D-30 | The client default PocketBase URL is port 8091 while the dev script serves 8090; correctness depends on a fallback probe. | `pocketbase.ts:4`; `dev-all.js:106-123` | Single source of truth for the port |
| D-31 | The sidebar links `/support`, which does not exist; several routes exist only as in-page links; the drawer omits `/expenses/categories`. | `Sidebar.tsx:121`; `MobileDrawer` link set | Add the route or remove the link; align both navs with the route table |
| D-32 | The design system is half-applied: dark mode is hardcoded on `<html>`, making the entire light palette dead and 74 `dark:` utilities inert; `--font-sans: var(--font-sans)` is self-referential; `--font-display` references Manrope, which is never loaded; 145 hex literals bypass tokens in 11 components. | `layout.tsx:45`; `globals.css:172-174`; `storefront-control/page.tsx:254-257` (68 literals) | Remove the fork in theming, fix the token block, replace hex with tokens |
| D-33 | Pinch zoom is disabled and content can sit under the mobile nav on notched devices. | `layout.tsx:21-22` (`maximumScale: 1`, `userScalable: false`); fixed `pb-16` in `layout.tsx` versus `env(safe-area-inset-bottom)` padding in the nav | Allow scaling, reserve safe-area space |
| D-34 | Sync clients are stubs with "Upsert to PocketBase" TODOs; 8 TODO markers remain in `src`. | `lib/sync/shopify.ts:298,309,334,341`; `woocommerce.ts:184,188,216`; `customers.ts:377` | Either implement or remove from the UI |
| D-35 | The catalog integration hardcodes a catalog id and phone number. | `catalog/batch/route.ts:70-72`; `meta-catalog-batch.ts:113`; `whatsapp.ts:1504-1505` | Move to store settings |
| D-37 | The channel enum cannot represent the pricing engine: `sales.channel` allows `pos\|shopify\|whatsapp`, while `channel-pricing.ts` defines website, wholesale, exhibition, and custom channels. | schema select on `sales.channel`; `channel-pricing.ts`; `pos-sales.ts:92` | Extend the enum, or store channel as text with a validated list |
| D-38 | The WhatsApp admin bot writes invalid data: uppercase statuses and a non-existent `razorpay_link_id`, and nothing imports the module. | `whatsapp-commander.ts:61,65,69,84`; `types/database.ts:227` | Fix the enum casing and column, then wire it to the inbound handler or delete it |
| D-39 | A dead client data layer coexists with inline queries: `hooks.ts` and `alerts.ts` have zero importers while the dashboard recomputes stats inline; `backup.ts` has no UI, so full backup and restore are unreachable. | `hooks.ts`; `alerts.ts`; `src/app/page.tsx`; `backup.ts`; `settings/page.tsx:126-148` | Adopt the hooks and expose backup/restore, or remove them |

### 7.4 Defect interaction map

Several defects compound. These combinations are the ones that produce incidents:

1. **D-01 + D-02 + D-14** produce a tax liability that is wrong in direction and magnitude, and every downstream report inherits it. Fix them as one change.
2. **D-03 + D-18** are the two ways stock silently inverts or vanishes. Both are reachable from normal POS use.
3. **D-05 + D-06 + D-07** form the returns cluster: refunds unbooked, returns unbounded, exchanges untaxed. A single dishonest or confused operator can extract value through all three.
4. **S-01 + S-02 + S-05** form the tenancy cluster: an anonymous take-over route, a global tenant switch, and a shared client that carries superuser sessions.
5. **D-08 + D-09** mean no build ships, and if one did, it would have no database. Release work must start here, not with features.

### 7.5 Recommended fix order

| Order | Items | Rationale |
|---|---|---|
| 1 | D-08, D-09 | Nothing ships until the artifact exists and contains a database |
| 2 | S-01, S-02, S-03, S-04, S-06 | Unauthenticated data and tenant take-over |
| 3 | D-01, D-02, D-14, D-15 | One tax-model change, four defects |
| 4 | D-04, D-05, D-06, D-07 | Crash and money-loss paths |
| 5 | D-03, D-10, D-11, D-12, D-20 | Containment: stop silent corruption |
| 6 | D-22, S-07 | Make authorization real, server and client |
| 7 | D-16 through D-21, D-23, D-24, D-36 | Hardening, phantom collections, and test safety net |
| 8 | P3 batch | Hygiene, in one pass, after the rest |

---

## 8. Missing capabilities

Everything below was checked for absence in code, not merely for absence in the UI. Grouped by the decision that unblocks it.

### 8.1 Blocked on the build decision (D-08)

| Capability | Why it is missing |
|---|---|
| Packaging of the 13 API routes into the shipped app | They cannot survive static export. Either the app gains a server, or the routes move to the sidecar. |
| Reliable storefront in the desktop build | Storefront checkout depends on `/api/storefront/*`, which is absent from `out/`. |
| Webhook-driven payments | The webhook route is dynamic, and its secret is unset. |

### 8.2 Money and statutory gaps

| Capability | Evidence of absence |
|---|---|
| Split tender (part cash, part UPI) | POS models one tender per sale; no allocation table |
| Cash refund accounting | No writer for `total_cash_refunds` (D-05) |
| Purchase returns / debit notes | No collection, no service, no screen |
| E-invoice / IRN generation | No IRN field, no NIC integration |
| GSTIN checksum validation | Regex only (D-16) |
| Formal accounting statements (P&L, trial balance) | Reports are operational, not statutory |
| Bank statement import and reconciliation | Manual entry only |
| Payment reconciliation for PhonePe | Initiation and status exist; no settlement loop |
| Multi-currency | INR only |

### 8.3 Jewelry-domain gaps (competitive, from the roadmap)

| Capability | Note |
|---|---|
| Old gold / trade-in at POS | Mentioned in the roadmap; no purity deduction math, no valuation, no POS surface |
| Karigar job-work ledger | Challan types exist; no artisan account, no metal-loss reconciliation |
| HUID and lab certificate vault | No field, no storage, no print block |
| Savings scheme (11+1) | No installment plan model |
| Metal rate feed | Rate engine takes a stored rate; no live feed |
| Hallmarking print compliance (BIS layout) | Not implemented |

### 8.4 Operations and platform gaps

| Capability | Note |
|---|---|
| Automated tests and CI | D-24 |
| Error monitoring / crash reporting | No Sentry or equivalent |
| Service worker / true offline app shell | Manifest exists; no SW caching strategy |
| Desktop auto-update | Tauri updater plugin not configured |
| Localised UI (Hindi, Gujarati, Marathi) | English only; no i18n layer |
| Accessibility pass | Pinch zoom disabled, focus management inconsistent |
| Audit log coverage | `activity_logs` is written by some services only |

### 8.5 Channel gaps

| Capability | Note |
|---|---|
| Shopify / WooCommerce two-way sync | Clients are stubs with TODOs |
| Google Drive sync beyond mock mode | Changelog engine exists; no real conflict policy |
| WhatsApp Flows and newsletter flash drops | Flash-drop module present; no scheduling surface |
| Customer-facing order tracking | Only courier tracking exists |
| Abandoned-cart recovery | Cart bridge exists; no persistence or follow-up |
| PIN / QR quick cashier switch | Roadmap only |

---

### 8.6 Built but not connected

This is the most misleading category in the repository: substantial code exists, is typed, is unit-tested by hand, and is reachable by no user action.

| Module | What it implements | Why it is unreachable |
|---|---|---|
| `manufacturing-engine.ts` | Karigar BOM cost, metal loss, tolerance | No route, no importer |
| `imitation-jewelry-engine.ts` | Craft taxonomy, plating, wholesale tiers | No route, no importer |
| `gstr1-engine.ts` | Full GSTN v3.0.4 GSTR-1 including CDNR/CDNUR/HSN | `/reports/gst` uses the simpler `reports.ts` builder instead |
| `returns-qc-engine.ts` | QC grading and routing | `/returns` does not call it |
| `cross-border-engine.ts` | LUT export invoice with static FX | No route |
| `cheque-engine.ts` | PDC lifecycle and maturity math | No route, no collection |
| `omnichannel-buffer-engine.ts` | Channel buffers and cart reservations | No importer; in-memory state would not survive reload anyway |
| `sync-engine.ts` + `sync/shopify.ts` + `sync/woocommerce.ts` | E-commerce sync orchestration | Zero importers; seven TODOs; Settings shows "Coming Soon" |
| `backup.ts` | 31-collection backup, restore, scheduling | Zero importers; Settings has a 6-collection export and no restore |
| `offline-queue.ts` | Queued mutation replay | Zero importers; no connectivity listener |
| `hooks.ts`, `alerts.ts` | Client data hooks, low-stock alerts | Zero importers; dashboard and inventory recompute inline |
| `whatsapp-commander.ts` | Admin commands in chat | Zero importers, and its writes are schema-invalid |

The practical consequence: the product's advertised surface is smaller than its code, and any estimate based on module count is wrong. Section 4 labels these **Scaffold** for exactly this reason.

---

## 9. Operations runbook

### 9.1 First run on a clean machine

```bash
npm install
cd wppconnect-sidecar && npm install && cd ..

# start everything (PocketBase 8090/8091, sidecar 21465, Next 3000)
npm run dev
```

Then open `http://localhost:3000/setup` and complete the wizard. It provisions a tenant database, seeds schema, and creates the admin user. If the wizard fails, check in this order:

1. Is PocketBase reachable at the URL the browser resolved (`PB_CUSTOM_URL`, otherwise 8091 then 8090)?
2. Does `pocketbase/pb_tenants/registry.json` exist and contain the new tenant?
3. Are ports 8092..8199 free for the tenant process?

### 9.2 Daily operation

| Task | Route | Preconditions |
|---|---|---|
| Open shift and count opening float | `/pos` | Authenticated; no other open shift for the terminal |
| Bill customers | `/pos` | Open shift; stock loaded |
| Receive goods | `/purchase` | PO exists |
| Print labels | `/labels` | Queue populated or items selected |
| Close shift | `/pos` | Blind count; variance note if mismatch |
| Backup | Settings or `backup.ts` script | Write access to the backup directory |

### 9.3 Recovery

| Symptom | First check | Action |
|---|---|---|
| App shows data from the wrong store | `registry.activeTenantEmail`; browser `PB_CUSTOM_URL` | Clear the override, re-login; if registry is wrong, fix it and restart the Next server |
| Stock is zero after a sale error | `product_variants.stock_level` versus `stock_movements` sum | Recompute from movements; D-03 is the likely cause |
| Drawer variance on a day with returns | `total_cash_refunds` is always zero | Expected until D-05 is fixed; record the variance manually |
| Invoice number gap | `number_sequences` and `invoices` | Expected after D-11; note it for the auditor |
| WhatsApp disconnected | Sidecar `:21465/health`, session directory | Re-pair from `/whatsapp`; check Chromium presence |

### 9.4 Data locations

| Data | Path |
|---|---|
| Default tenant database | `pocketbase/pb_data/data.db` (+ `-wal`, `-shm`) |
| Provisioned tenants | `pocketbase/pb_tenants/<slug>/data.db` |
| Tenant registry (contains plaintext superuser passwords) | `pocketbase/pb_tenants/registry.json` |
| WhatsApp session | sidecar user-data directory, plus `WPP_SESSION_ID` in storage |
| Browser state | localStorage: `pocketbase_auth`, `PB_CUSTOM_URL`, `WA_CUSTOM_URL`, cart and offline queue keys |
| Static build output | `out/` (stale; see D-08) |

---

## 10. Verification protocol

Run this before changing any status in this document.

```bash
# 1. types
npx tsc --noEmit --incremental false          # expect: exit 0

# 2. lint
npx eslint src                                # expect: 7 errors, 325 warnings (2026-10-23 baseline)

# 3. routes present
Get-ChildItem src/app -Recurse -Filter page.tsx | Measure-Object   # expect 40
Get-ChildItem src/app/api -Recurse -Filter route.ts | Measure-Object # expect 13

# 4. build (only on NTFS, with Developer Mode enabled)
npm run build                                  # expect: FAILS on static export while D-08 is open

# 5. schema drift
Select-String pocketbase/pb_migrations/*.js -Pattern 'findCollectionByNameOrId\("(\w+)"\)' -AllMatches |
  ForEach-Object { $_.Matches.Groups[1].Value } | Sort-Object -Unique
# compare that list, plus the collection names in section 3.5, against the drift table in 3.5.1
```

Interpretation rules:

- A clean `tsc` does not mean the money paths are correct; none of section 7's logic defects are type errors.
- A lint count change is meaningful only against the baseline above.
- If `npm run build` starts succeeding, D-08 was resolved: update 5.1, 5.2, D-08, and the maturity table together.

### 10.1 Document freshness markers

| Marker | Meaning |
|---|---|
| Verified | Re-read in code on 2026-10-23 |
| Inherited | From a prior audit, not re-verified this pass (used only where the audit is the sole source, e.g. sidecar internals) |
| Unverified | Plausible but not confirmed; the document says so explicitly |

The WhatsApp sidecar internals (`wppconnect-sidecar/server.js`, ~3,000 lines) were **not** re-audited in this pass. Claims about session lifecycle, Chromium download, and broadcast pacing are inherited from the audits listed in 0.2 and should be treated as unverified until read.

---

---

## 11. Delivery log

Chronological record of work done after the audit. Each entry lists what changed, how it was verified, and what remains. The defect register above is not rewritten; this log carries the current status.

### 11.1 Slice 1: money and tax (2026-10-23)

**Closed:** D-01, D-02, D-03, D-10, D-11, D-20. **Partially closed:** D-14.

| Change | Files | Why |
|---|---|---|
| New pure tax module | `src/lib/invoice-math.ts` (new), `src/scripts/test-invoice-math.ts` (new) | One place decides the inclusive split, discount allocation, and rounding, in integer paise |
| POS invoice rebuilt on inclusive prices | `src/lib/invoice.ts` (`createInvoiceFromSale`) | Tax is back-computed from the amount collected; `paid_amount === grand_total`; GST applies to the post-discount base |
| Invoice writes are atomic | `src/lib/invoice.ts` (`createInvoice`) | An item failure deletes the header and created items, so no item-less invoice remains |
| POS rollback covers shift and invoice | `src/lib/pos-sales.ts` | A failure after stock now reverses shift totals and removes the invoice |
| Oversell handling no longer destroys stock | `src/lib/pos-sales.ts` | Only `validation_min_number_constraint` counts as oversell; movement and variant are reconciled to what was actually available; other 400s fail the sale |
| Per-line rate captured | `src/lib/pos-sales.ts`, `src/app/pos/page.tsx` | `sale_items.gst_rate` is written; the invoice prefers the line rate, then the product rate, then 3 percent |
| Cart shows included GST | `src/app/pos/page.tsx` | The cashier sees the tax inside the quoted total, only when the store is GST registered |
| Order to invoice is idempotent | `src/lib/orders.ts` | An existing invoice for the order is reused; buyer GSTIN is written; HSN and rate come from the product |
| Product types carry `gst_rate` | `src/types/database.ts`, `src/lib/products.ts` | Type-level plumbing; the database column does not exist yet |

**Verified:** `npx tsc --noEmit --incremental false` clean; `npx tsx src/scripts/test-invoice-math.ts` 12 passed, 0 failed; targeted ESLint reports no new errors.

**Still open in this cluster:**

- D-14 needs a `products.gst_rate` column (migration) and a field in the inventory form before rates can actually differ per product.
- D-20 has a code-level guard but no unique index on `invoices.order`; the index is a proposed migration, not applied.
- POS invoices created before this change still carry the old mismatch. They are left untouched; a backfill is a separate decision.

### 11.2 Slice 2: returns and refunds (2026-10-23)

**Closed:** D-05, D-06, D-07, D-25.

| Change | Files | Why |
|---|---|---|
| Cash refunds reach the drawer | `src/lib/register.ts`, `src/lib/returns.ts` | `recordCashRefund` writes the drawer operation and increments `total_cash_refunds`, which `closeShift` already subtracts |
| Refund is a state machine, not a field write | `src/lib/returns.ts` | Only approved notes refund; duplicates are ignored; a failed drawer write reverts the note so a retry is safe |
| Refunds outside a shift stay visible | `src/lib/returns.ts` | With no open shift the event is logged as `CASH_REFUND_OUTSIDE_SHIFT` instead of silently losing the money |
| Cumulative over-return guard | `src/lib/returns-policy.ts` (new), `src/lib/returns.ts` | Prior non-cancelled credit note lines are summed per invoice item and validated before any write |
| Exchange raises its own tax invoice | `src/lib/returns.ts` | Replacement goods are invoiced with GST; the balance is a payment on the new invoice, never a negative row against the original |
| Exchange cash difference hits the drawer | `src/lib/returns.ts` | A negative balance records a drawer refund against the open shift |
| Opening float uses a valid enum | `src/lib/register.ts` | `opening_float` was rejected by the schema and swallowed; it is now an `add` with an explicit reason |
| Errors reach the cashier | `src/app/returns/create/page.tsx`, `src/app/returns/detail/page.tsx` | Over-return and refund failures show the real message instead of a generic alert |

**Verified:** `npx tsc --noEmit --incremental false` clean; `npx tsx src/scripts/test-returns-policy.ts` 9 passed, 0 failed; targeted ESLint reports no errors.

**Still open in this cluster:**

- Exchange invoices assume the 3 percent jewelry rate, the same limitation as D-14.
- Bank and UPI refunds are recorded on the credit note but do not create a bank transaction; that belongs with banking reconciliation.

### 11.3 Slice 3: tenancy and auth (2026-10-23)

**Closed:** S-01, S-02, S-04. **Partial:** S-05, S-06, D-22.

| Change | Files | Why |
|---|---|---|
| Per-request operator authentication | `src/lib/api-auth.ts` (new), `src/scripts/test-tenant-auth.ts` (new) | The token is verified against the tenant's own database with a fresh client; the hint only selects which database to check |
| Provisioning an existing tenant requires a session | `src/app/api/system/tenant-db/route.ts` | Anonymous callers can still create a brand-new tenant because setup runs before login, but cannot reset an existing tenant's superuser password |
| Tenant lookup no longer switches the active tenant | `src/lib/tenant-db-manager.ts`, `route.ts` | Activation is opt-in; an unauthenticated lookup returns only the URL needed to connect |
| Tenant databases bind loopback | `src/lib/tenant-db-manager.ts` | `0.0.0.0` exposure is now an explicit `PB_TENANT_BIND` opt-in |
| Hardcoded superuser fallback removed | `src/lib/tenant-db-manager.ts` | Missing credentials fail loudly instead of authenticating with a password that shipped in code |
| Storefront binding validates the email | `src/lib/storefront.ts` | An injection string can no longer select another tenant; malformed values fall back to the default binding |
| Client route guard | `src/components/auth/AuthGate.tsx` (new), `src/app/layout.tsx` | Unauthenticated visitors are redirected to `/login`; `/login` and `/setup` stay public |

**Verified:** `npx tsc --noEmit --incremental false` clean; `npx tsx src/scripts/test-tenant-auth.ts` 8 passed, 0 failed; targeted ESLint clean.

**Still open in this cluster:**

- S-05: data routes still use the shared module client. The per-request factory exists, but only the control plane uses it.
- S-06: `registry.json` still stores plaintext superuser passwords. Rewriting it needs an approved migration of existing tenants, so it was left alone.
- S-07: `hasCapability` exists in `api-auth.ts` but no route enforces a capability yet.
- D-22: the redirect landed; navigation still renders every item to every role.
- S-03 (unauthenticated storefront order intake) stays queued with the channel-surfaces slice.

### 11.4 Slice 4: channel surfaces (2026-10-23)

**Closed:** S-03, S-09, S-12, S-13, S-14. **Partial:** S-16.

| Change | Files | Why |
|---|---|---|
| Storefront order requires a verified session | `src/app/api/storefront/order/route.ts`, `src/lib/storefront.ts` | The tenant and phone come from the signed customer token; the body cannot choose either. Phone mismatch and cross-tenant bodies are rejected |
| OTP codes are tenant-scoped | `src/lib/otp-store.ts` | Key is tenant plus phone, so a code minted for one storefront cannot verify against another |
| Daily OTP cap | `src/lib/otp-store.ts` | Five accepted requests per phone per tenant per day (configurable with `OTP_DAILY_LIMIT`), with counters preserved when a code is consumed |
| OTP delivery fails closed | `src/app/api/storefront/auth/send-otp/route.ts` | A message that was not delivered is no longer reported as sent, and the tenant's WhatsApp session id is not echoed to anonymous callers |
| Sign-in fails closed | `src/app/api/storefront/auth/verify-otp/route.ts` | A token is only issued after the customer record really exists; the `temp_<timestamp>` fallback is gone |
| Catalog feed is authenticated | `src/app/api/catalog/feed/route.ts` | Requires the catalog sync key or an operator session, requires a tenant, and no longer falls back to an arbitrary tenant |
| Feed cache is private | same | `private, no-store` replaces the public five-minute cache that let a poisoned response reach other callers |
| Catalog images are tenant-checked | `src/app/api/catalog/image/route.ts` | Requires an account, verifies row ownership and active state, and refuses to serve another tenant's product |
| Import template requires a session | `src/app/api/inventory/template/route.ts` | The template is generated from store settings, so it can no longer serve whichever tenant the global client held |

**Verified:** `npx tsc --noEmit --incremental false` clean; `npx tsx src/scripts/test-tenant-auth.ts` 12 passed, 0 failed (the four new cases cover order tenant resolution); targeted ESLint reports no errors.

**Still open in this cluster:**

- S-16: the feed phone default was removed, but the catalog id and phone are still hardcoded in `catalog/batch`, and the sync key still doubles as a Meta token.
- S-10 and S-11 need secrets to be provisioned before they can be enforced; S-15 needs a rate limit; S-07 needs route-level capability checks.

## Appendix A: Route inventory

40 route pages, all client components.

| Route | Purpose | Size |
|---|---|---|
| `/` | Executive dashboard | 5 KB |
| `/activity` | Audit timeline | 12 KB |
| `/banking` | Accounts and balances | 14 KB |
| `/banking/transactions` | Transaction ledger | 17 KB |
| `/challan` | Delivery challans | 12 KB |
| `/challan/create` | New challan | 37 KB |
| `/challan/detail` | Challan detail | 25 KB |
| `/checkout/whatsapp` | WhatsApp checkout surface | 24 KB |
| `/customers` | Customer directory | 115 KB |
| `/customers/detail` | Customer ledger | 37 KB |
| `/expenses` | Expense vouchers | 22 KB |
| `/expenses/categories` | Expense taxonomy | 7 KB |
| `/inventory` | Catalog and variant matrix | 102 KB |
| `/invoices` | Invoice list | 28 KB |
| `/invoices/create` | Invoice authoring | 45 KB |
| `/invoices/detail` | Invoice print and payments | 42 KB |
| `/labels` | Barcode label printing | 35 KB |
| `/login` | Authentication | 7 KB |
| `/orders` | Sales orders | 24 KB |
| `/orders/create` | Order authoring | 33 KB |
| `/orders/detail` | Order detail and invoicing | 18 KB |
| `/pos` | Point of sale terminal | 126 KB |
| `/purchase` | Purchase orders | 14 KB |
| `/purchase/create` | PO authoring | 60 KB |
| `/purchase/detail` | PO and GRN receiving | 69 KB |
| `/reports` | Reports hub | 5 KB |
| `/reports/gst` | GST summary | 18 KB |
| `/reports/sales` | Sales analysis | 11 KB |
| `/reports/stock` | Stock valuation | 11 KB |
| `/returns` | Returns list | 12 KB |
| `/returns/create` | Return authoring | 18 KB |
| `/returns/detail` | Return approval | 50 KB |
| `/settings` | Store configuration | 101 KB |
| `/setup` | First-run wizard | 38 KB |
| `/storefront-control` | Storefront CMS and orders | 192 KB |
| `/tracking/st-courier` | Courier tracking | 17 KB |
| `/users` | Staff and roles | 21 KB |
| `/vendors` | Vendor directory | 12 KB |
| `/vendors/detail` | Vendor profile and history | 27 KB |
| `/whatsapp` | Conversational CRM hub | 231 KB |

## Appendix B: API surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/system/tenant-db` | GET, POST | **None** | Resolve or provision a tenant database (S-01, S-02) |
| `/api/storefront/order` | POST | **None** | Create storefront customer, order, sale; stock decrement (S-03) |
| `/api/storefront/auth/send-otp` | POST | **None** | Send WhatsApp OTP (S-09) |
| `/api/storefront/auth/verify-otp` | POST | OTP | Verify and issue customer token (S-13) |
| `/api/storefront/auth/delete-customer` | POST, DELETE | Customer token | Self-service deletion |
| `/api/storefront/content` | GET, POST | GET none, POST staff JWT | Storefront CMS |
| `/api/pos/payment` | POST | Staff JWT | Razorpay link, PhonePe initiate/status |
| `/api/webhooks/razorpay` | POST | HMAC | Payment settlement (S-10) |
| `/api/catalog/feed` | GET | **None** | Meta CSV feed (S-12) |
| `/api/catalog/batch` | POST | Staff JWT or sync key | Meta batch push (S-16) |
| `/api/catalog/image` | GET | **None** | Product image stream (S-14) |
| `/api/inventory/template` | GET | **None** | XLSX import template (S-14) |
| `/api/tracking/st-courier` | GET | **None** | Courier tracking proxy (S-15) |

## Appendix C: Service module index

79 modules in `src/lib`, grouped by responsibility. Modules marked *orphan* have no importer outside their own tests or no importer at all.

**Database and platform**: `pocketbase.ts`, `tenant-db-manager.ts`, `concurrency.ts`, `sequence-generator.ts`, `settings.ts`, `backup.ts`, `activity.ts`, `offline-queue.ts`, `google-drive-sync.ts`

**Catalog**: `products.ts`, `categories.ts`, `attributes.ts`, `sku-generator.ts`, `barcode-generator.ts`, `excel-import.ts`, `image-matcher.ts`, `catalog-sync.ts`, `meta-catalog-batch.ts`

**Sales**: `pos-sales.ts`, `invoice.ts`, `orders.ts`, `order-milestones.ts`, `returns.ts`, `challan.ts`, `discounts.ts`, `register.ts`, `payment-reconciliation.ts`

**Procurement**: `purchase.ts`, `vendors.ts`, `discrepancies.ts`

**Finance**: `banking.ts`, `expenses.ts`, `gst.ts`, `gstr1-engine.ts`, `eway-bill.ts`, `cheque-engine.ts`, `razorpay.ts`, `razorpay-webhook-handler.ts`, `phonepe.ts`

**Customers**: `customers.ts`, `customer-lookup.ts`, `customer-token.ts`, `loyalty.ts`, `crm-rfm.ts`, `crm-lifecycle-triggers.ts`, `campaign-attribution.ts`, `otp-store.ts`, `storefront.ts`

**Jewelry domain**: `jewelry-engine.ts`, `imitation-jewelry-engine.ts`, `manufacturing-engine.ts`, `omnichannel-buffer-engine.ts`, `returns-qc-engine.ts`, `cross-border-engine.ts`, `channel-pricing.ts`, `multi-location.ts`, `logistics-engine.ts`

**WhatsApp**: `whatsapp.ts`, `whatsapp-crm.ts`, `whatsapp-broadcast.ts`, `whatsapp-catalog.ts`, `whatsapp-commander.ts`, `whatsapp-event-sync.ts`, `whatsapp-flash-drops.ts`, `whatsapp-notifications.ts`, `whatsapp-order-ingestion.ts`, `whatsapp-binding.ts`, `mobile-whatsapp.ts`

**Mobile**: `mobile-scanner.ts`, `mobile-printer.ts`, `sound-effects.ts`

**Reporting**: `analytics.ts`, `reports.ts`, `alerts.ts`, `sync-engine.ts`, `hooks.ts`, `utils.ts`, `csv.ts`

**Modules with zero importers outside their own test scripts**: `imitation-jewelry-engine.ts`, `manufacturing-engine.ts`, `gstr1-engine.ts`, `omnichannel-buffer-engine.ts`, `returns-qc-engine.ts`, `cross-border-engine.ts`, `cheque-engine.ts`, `sync-engine.ts`, `hooks.ts`, `backup.ts`, `offline-queue.ts`, `whatsapp-commander.ts`. `alerts.ts` duplicates `useLowStockAlerts` and is also unused. These are the gap between "code exists" and "the product does it": 12 modules, including three entire statutory and manufacturing domains.

## Appendix D: Glossary

| Term | Meaning in this codebase |
|---|---|
| Tenant | One merchant account, backed by one PocketBase SQLite file and process |
| GRN | Goods Received Note, the stock-inbound document against a PO |
| Challan | Delivery challan, goods movement without a sale (job work, transfer, exhibition) |
| Credit note | Return document that reverses invoice tax |
| Variant | Concrete sellable unit (size, metal, material) holding stock |
| Shift | Cash drawer session from open to blind close |
| Sidecar | Node process running WPPConnect and Puppeteer, supervised by Rust |
| Static export | Next.js build mode producing HTML and JS with no server |
| KB | Used loosely for file bytes ÷ 1024 throughout this document |

*End of master document. Regenerate section 2.2 and 10 baselines with every audit.*
