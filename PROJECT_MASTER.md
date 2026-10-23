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
| [`docs/STOREFRONT_WHATSAPP_CRM_CAPTURE_GAPS_2026-10-24.md`](docs/STOREFRONT_WHATSAPP_CRM_CAPTURE_GAPS_2026-10-24.md) | **Partially superseded.** Field-gap history; its status column is superseded by the §12.10 crosswalk and by the implementer's later stock work (§11.67–§11.68). Keep as history. |

### 0.3 How to keep this document true

1. Any change that alters a collection, a service contract, a port, or a documented defect updates this file **in the same commit**.
2. Section 7 entries carry `file:line` evidence. When a line moves, the entry moves with it; when a defect is fixed, move it to section 7.9 with the fixing commit.
3. Re-run section 10 before changing the status of anything in section 4.
4. Never reintroduce a superseded document as a source of truth.
5. **Concurrent editors (2026-10-24):** this document has two live writers. The implementer appends delivery-log entries (§11) and owns `src/**`; the document owner owns §0–§12 structure. Re-read the file immediately before writing, append rather than rewrite, and keep new log entries in numeric order.

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
| **Desktop (Tauri v2)** | Webview hosting the statically exported Next.js app; Rust supervisor starts and restarts the WhatsApp sidecar and PocketBase (see 5.2) | Database wired; artifact still blocked by D-08 |
| **Browser / PWA** | Next.js dev or `next start` server on a LAN machine; PocketBase beside it; installable via manifest | Working in development |
| **Android** | Tauri mobile build, or PWA in Chrome. Camera scanning and system print spooler paths exist | PWA usable; native APK build blocked on this workstation (5.3) |
| **Remote showroom device** | Cloudflare Quick Tunnel exposes PocketBase and the sidecar; device points at the tunnel URL via `PB_CUSTOM_URL` | Working, with security caveats in 6.4 |

### 1.3 Explicit non-goals and constraints

- **Single-tenant per database file, multi-tenant per installation.** Each merchant account gets its own SQLite file and its own PocketBase process. Cross-tenant reporting is out of scope.
- **No server-side rendering in production.** `output: "export"` means the packaged app has no Node server. This is the root cause of the largest open architectural conflict (5.1).
- **No cloud dependency for core billing.** Razorpay, PhonePe, Meta catalog, and WhatsApp are all optional integrations.
- **India-specific statutory output.** GST, HSN, e-way bill, GSTR-1. No other tax regime is supported.
- **Offline-first writes are queued, not merged.** `offline-queue.ts` replays mutations; it does not resolve conflicts.

---

## 2. Verified state at a glance

### 2.1 Repository facts

| Metric | Value |
|---|---|
| Branch / commit | `feat/finish-partial-features`, based on `fix/security-audit-remediation` @ `f0e96b4` |
| Last slice | Money and tax, 2026-10-23 (section 11) |
| TypeScript/TSX files | 257 |
| Lines of TypeScript/TSX | ~88,500 |
| Route pages (`src/app/**/page.tsx`) | 45 |
| Service modules (`src/lib/*.ts`) | 85 |
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
| Lint | `npx eslint src` | **324 problems: 0 errors, 324 warnings** |
| Lint errors | same | none |
| Tax math tests | `npx tsx src/scripts/test-invoice-math.ts` | **12 passed, 0 failed** (2026-10-23) |
| Return policy tests | `npx tsx src/scripts/test-returns-policy.ts` | **9 passed, 0 failed** (2026-10-23) |
| Tenant auth tests | `npx tsx src/scripts/test-tenant-auth.ts` | **16 passed, 0 failed** (2026-10-23) |
| Test command | `npm test` | 144 assertions across 20 suites, exit 0 |
| GSTR-1 builder tests | `npx tsx src/scripts/test-gstr1-period.ts` | **3 passed, 0 failed** (2026-10-23) |
| QC routing tests | `npx tsx src/scripts/test-returns-qc.ts` | **4 passed, 0 failed** (2026-10-23) |
| Karigar costing tests | `npx tsx src/scripts/test-manufacturing.ts` | **7 passed, 0 failed** (2026-10-23) |
| Cheque lifecycle tests | `npx tsx src/scripts/test-cheque-register.ts` | **9 passed, 0 failed** (2026-10-23) |
| Export invoice tests | `npx tsx src/scripts/test-cross-border.ts` | **6 passed, 0 failed** (2026-10-23) |
| Backup tests | `npx tsx src/scripts/test-backup.ts` | **6 passed, 0 failed** (2026-10-23) |
| Offline queue tests | `npx tsx src/scripts/test-offline-queue.ts` | **6 passed, 0 failed** (2026-10-23) |
| Landed-cost tests | `npx tsx src/scripts/test-valuation.ts` | **7 passed, 0 failed** (2026-10-23) |
| Imitation taxonomy tests | `npx tsx src/scripts/test-imitation.ts` | **8 passed, 0 failed** (2026-10-23) |
| Rate limiter tests | `npx tsx src/scripts/test-rate-limit.ts` | **6 passed, 0 failed** (2026-10-23) |
| Customer token tests | `npx tsx src/scripts/test-customer-token.ts` | **5 passed, 0 failed** (2026-10-23) |
| Sidecar token tests | `npx tsx src/scripts/test-whatsapp-secret.ts` | **6 passed, 0 failed** (2026-10-23) |
| Webhook dedupe tests | `npx tsx src/scripts/test-webhook-dedupe.ts` | **6 passed, 0 failed** (2026-10-23) |
| Tenant runtime tests | `npx tsx src/scripts/test-tenant-runtime.ts` | **5 passed, 0 failed** (2026-10-23) |
| Registry secret tests | `npx tsx src/scripts/test-tenant-secrets.ts` | **8 passed, 0 failed** (2026-10-23) |
| GSTIN tests | `npx tsx src/scripts/test-gstin.ts` | **7 passed, 0 failed** (2026-10-23) |
| POS quantity tests | `npx tsx src/scripts/test-pos-quantity.ts` | **4 passed, 0 failed** (2026-10-23) |
| CI | `.github/workflows/ci.yml` | typecheck, lint, tests on push and pull request |
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
| Build and release | Partially blocked | Export conflict remains (D-08); the bundle now ships and supervises PocketBase (D-09) |
| Frontend architecture | Uneven | 135 direct database calls in UI, three pages over 100 KB |
| Test coverage | Baseline | `npm test` runs three suites and CI re-runs them; no component or end-to-end layer yet |

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
   | ports 8090, 8091,    |     | Node + Puppeteer |     | ST Courier            |
   | 8092..8199           |     | + Chromium       |     |                       |
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

**Correction (2026-10-24):** the drift list above is historical. Migrations `1792774201`–`1792774208` are in `pb_migrations` and applied in the live database (§11.47): `shipments`, `inventory_locations`, `inventory_transfers`, `catalog_sync_logs`, `cash_registers` and `whatsapp_campaigns` now exist, and `sales.channel`/`sales.campaign` were added. Two column-level traps still bite the channel capture layer — `sales.campaign` is a **relation**, not text, while `sales.payment_method` keeps its five-value enum (§7.6 CO-04) — and `sales_orders` still has no `payment_method`/`channel`/gateway columns (§12.3.4).

#### 3.5.1 Applied migration bundle (2026-10-23)

These eight migrations were drafted under `docs/migrations-draft/` and were subsequently moved into `pocketbase/pb_migrations` and applied on 2026-10-23 (§11.47); this subsection is retained as the design record. Verify against the live schema before relying on it.

| Migration | Changes | Unblocks |
|---|---|---|
| `001_manufacturing_jobs.js` | New collection replacing the `store_settings` JSON | Karigar jobs as a queryable ledger |
| `002_cheques.js` | New `cheques` collection with a unique tenant cheque index | Cheque register out of JSON |
| `003_products_craft_and_gst_rate.js` | `products.craft`, `plating`, `occasion`, `base_metal`, `gst_rate` | Taxonomy persistence and D-14 |
| `004_landed_cost_and_channels.js` | PO overhead column, item landed cost, `sales.channel`, `whatsapp_campaigns`, `sales.campaign` | D-13, channel enum, campaign attribution |
| `005_indexes.js` | Unique `invoices.order` index and reporting indexes | D-20 hardening |
| `006_store_settings_rules.js` | Tenant-scoped collection rules on `store_settings`; legacy empty-`account_email` rows stay readable | Audit #8: rule-level tenant isolation in a shared instance |
| `007_purchase_inward_cost.js` | `purchase_orders.inward_cost` numeric column | D-13: atomic inward-cost accumulation |
| `008_phantom_collections.js` | `inventory_locations`, `inventory_transfers`, `catalog_sync_logs`, `shipments`, `cash_registers` | D-36: the five remaining phantom collections |

Each file was syntax-checked with `node --check`. None was executed, and no schema was inspected against a live database.

### 3.6 Integrations

| Integration | Module | Transport | State |
|---|---|---|---|
| WhatsApp send/receive | `whatsapp.ts`, `whatsapp-crm.ts`, sidecar | REST to `127.0.0.1:21465` with Bearer token and origin allowlist | Working; token default is compiled into the client bundle |
| Razorpay payment links | `razorpay.ts`, `payment-reconciliation.ts` | REST + polling; optional webhook | Link creation works; webhook secret absent, so webhook path returns 400 |
| PhonePe QR | `phonepe.ts` | Server-side signed requests | Works; secrets stay server-side |
| Meta catalog | `meta-catalog-batch.ts`, `catalog-sync.ts` | Graph API batch + CSV feed | Works; feed is unauthenticated |
| Shopify / WooCommerce | `src/lib/sync/*`, `sync-engine.ts` | REST/GraphQL clients | Scaffold; no scheduler |
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
| Five seeded roles | Live | Capabilities are enforced server-side on catalog push and storefront CMS writes, and navigation hides admin pages from other roles |
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
| Manufacturing BOM | Live | `/manufacturing` costs a job card: metal, five charge heads, scrap credit, per-gram cost and loss reconciliation (section 11.10) |
| Karigar job-work tracker | Live | Job cards persist with status and karigar name; metal issued and loss variance are visible, though no running artisan balance yet |
| Imitation jewelry taxonomy | Live | `/imitation` classifies craft, plating, occasion and base metal, prints the tag payload and applies wholesale tiers (section 11.17) |
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
| GSTR-1 engine | Live | `/reports/gst` builds the official GSTN v3.0.4 file (B2B, B2CL, B2CS, CDNR, CDNUR, HSN, DOCS) from invoices and credit notes (section 11.8) |
| GSTIN validation | **Partial** | Regex only, no checksum (D-11) |
| Credit notes against invoices | Live | Cumulative over-return guard, cash refunds hit the drawer, exchanges raise a GST invoice, and the QC grade routes the goods (section 11.9) |
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
| Cheque / PDC tracking | Live | `/cheques` registers post-dated cheques and drives the engine's lifecycle: deposit, clear, bounce, cancel, with maturity and stale warnings (section 11.11) |
| Returns QC routing | Live | Approval records a grade that restocks, sends to karigar repair, or writes off through the quarantine ledger |
| Cross-border LUT export | Live | `/reports/export` compiles a statutory export invoice (LUT zero-rated or IGST-paid) with live FX and JSON download (section 11.12) |
| Bank reconciliation import | Absent | Manual entry only |
| Day book / trial balance | Partial | Reports exist; no formal accounting statements |

### 4.8 Reporting and analytics

| Feature | Status | Notes |
|---|---|---|
| Executive KPI dashboard | Live | Today's sales, shift status, low stock |
| Sales, stock, and GST report pages | Live | `/reports`, `/reports/sales`, `/reports/stock`, `/reports/gst` |
| Inventory valuation | Live | Stock report values each variant at the weighted average of its received landed costs (unit price plus freight minus discount), falling back to the purchase price and labelling the basis (sections 11.16, 11.28) |
| Channel attribution (POS vs WhatsApp vs storefront) | Partial | Channel field exists; storefront writes its own channel |
| Scheduled report delivery | Absent | |

### 4.9 Storefront and public channels

| Feature | Status | Notes |
|---|---|---|
| Public storefront content API | Live | Unauthenticated read; tenant chosen by query or fallback |
| OTP login over WhatsApp | Partial | Works, but fails closed with 503 when `CUSTOMER_SESSION_SECRET` is unset (CO-13); no daily cap (S-09); token is no longer issued on DB failure (S-13 closed) |
| COD / concierge order intake | **Unsafe** | Customer session is now required by the route (S-03 closed), but the storefront client sends no token (CO-01), so real submits 401; item rows are schema-rejected (CO-02); online settlement is unmappable (CO-05). See §12. |
| Catalog CSV feed for Meta | Partial | Unauthenticated, tenant leakage (S-12) |
| Product image streaming | Partial | No tenant guard on single-record read (S-14) |
| Customer self-service delete | Live | Token-bound and tenant-checked |
| Remote order-capture fields | **Partial** | 2026-10-24 refactor captures email/state/shipping/tax/campaign/consent on paper; variant, payment fields and settlement references are missing or rejected (§12.3) |
| Online payment settlement | **Broken** | No gateway order reference, webhook cannot map a storefront payment, webhook secret unset (§12 F9; CO-05/CO-13) |

### 4.10 WhatsApp commerce

| Feature | Status | Notes |
|---|---|---|
| QR pairing and session persistence | Live | Session restore hardened across recent commits |
| Chat persistence and unread counts | Live | `whatsapp_chats`, `whatsapp_messages` |
| Contact resolution (customer/vendor/lead) | Live | E.164 normalization, lead auto-creation |
| Context actions (right click, long press) | Live | Desktop palette, mobile sheet with haptics |
| Add to POS cart bridge | Live | `BroadcastChannel('pos_cart')` plus localStorage event |
| Vendor ingestion with draft GRN | Live | Extracts purity/weight/price, queues barcode labels |
| Payment link send and polling settlement | Partial | Polling engine; chat payment-link ledger write is schema-rejected (CO-03); webhook path unarmed (CO-13) |
| Inbound intent router with approval banner | Partial | STOP opt-out and order-intent banner are live; the "draft order" is operator-triggered and goes through the broken E4 path (§12.2) |
| Product cards in chat | Live | Live stock and price |
| Catalog publishing | Partial | Publish path exists; Meta batch token doubles as API key |
| Broadcast campaigns with anti-ban pacing | Live | 8-22 s jitter, 150/day cap, opt-out filtering |
| WhatsApp admin bot | Scaffold (broken) | `whatsapp-commander.ts` has zero importers and writes uppercase statuses plus a non-existent `razorpay_link_id`, so its commands would fail at the database |
| Flash drops | Partial | `whatsapp-flash-drops.ts`; no scheduling UI |
| WhatsApp Flows (interactive) | Absent | Roadmap |
| Concierge order creation (chat cart) | **Partial** | Real `sales_orders` + shared stock path, but product-level cart (no variant/size), no address, operator-trusted prices not re-verified (§12 E3; CO-10) |
| Inbound catalog/draft order | **Partial** | Draft header only: item writes violate required relations and non-existent columns are written (§12 E4; CO-11) |
| Chat order ↔ CRM linkage | **Partial** | Order id lives in `internal_notes` text; no relation from chat or message (§12 A32) |

### 4.11 Platform, mobile, operations

| Feature | Status | Notes |
|---|---|---|
| Desktop shell with sidecar supervision | Live | Rust restarts sidecar after 3 failed health checks |
| Desktop shell with database | Live | PocketBase and its migrations are bundled; Rust starts it on 8090/8091/8092, supervises it, and stops it on exit (section 11.7) |
| Static export production build | **Broken** | 13 API routes cannot exist under `output: "export"` (D-25) |
| Android APK build | Blocked on this workstation | exFAT volume cannot host the required symlinks (5.3) |
| PWA install | Live | Manifest plus apple meta |
| Offline mutation queue | Live | `OfflineSync` drains the queue on reconnect and every 30 seconds; audit writes queue themselves when the database is unreachable (section 11.14) |
| Cloud sync | **Removed** | The mock engine and its modal were deleted; a sync that reports success and discards its log is worse than no sync. Backup & Restore covers recovery (section 11.15) |
| Backup and restore | Live | `/backup` downloads a 31-collection backup, previews a file before restoring, requires typed confirmation, and offers a daily browser snapshot (section 11.13) |
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

The bundle declares two payloads: the WhatsApp sidecar (`binaries/wppconnect-server`) and, since 2026-10-23, PocketBase plus its migrations as resources (`tauri.conf.json` `bundle.resources`).

At startup `src-tauri/src/lib.rs` now:

1. Reuses a healthy PocketBase if one is already listening on 8090, 8091 or 8092 (the dev launcher starts one).
2. Otherwise spawns `pocketbase serve` on the first free port from that list, with `--dir` under the OS app-data directory (`<app data>/pb_data`) and `--migrationsDir` pointing at the bundled migrations, bound to loopback.
3. Waits for `/api/health`, then records the port in managed state and emits `pocketbase-status`.
4. Restarts it after three failed health checks, and kills the child on `RunEvent::Exit`.

Those ports are the same three the webview probes, so the existing client resolution works without a build-time URL. The caveats are honest ones: only `pocketbase.exe` is checked in, so Linux and macOS installers need that binary dropped into `src-tauri/resources/pocketbase` before building; and the packaged app still cannot be produced until D-08 is resolved, because `beforeBuildCommand` runs a static export that fails on the API routes. The database problem is fixed; the artifact problem is not.

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

> **Status, 2026-10-23.** Closed: S-01, S-02, S-03, S-04, S-05, S-07, S-08, S-09, S-10, S-11, S-12, S-13, S-14, S-15, S-16 (section 11). **S-06 partially mitigated:** the encrypted format, read path and re-key script are implemented and tested, but the registry migration itself is deliberately unapplied and needs your approval (plan in `docs/registry-rekey-plan.md`).

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

> **Status update, 2026-10-23.** Closed: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-15, D-16, D-17, D-18, D-19, D-21, D-22, D-23, D-24, D-25, D-26, D-27, D-28, D-29, D-30, D-31, D-32, D-33, D-34, D-35, D-38, D-39, S-01, S-02, S-03, S-04, S-05, S-07, S-08, S-09, S-10, S-11, S-12, S-13, S-14, S-15, S-16. Partial: D-14 (needs the `products.gst_rate` migration, drafted in `docs/migrations-draft/003`), D-22 (redirect done, navigation still unfiltered), S-05 (per-request clients added on the control plane only), S-06 (fallback and network bind fixed, registry still holds passwords). Evidence and verification are in section 11. Entries below stay as written at audit time so the history remains readable.

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

### 7.6 Channel order-capture defects (2026-10-24)

Found by the §12 analysis and registered here with `file:line` evidence, per §0.3 rule 2. These are the code-level defects behind §12.5's failure modes; the behavioural cases are in §12.4.

| ID | Defect | Evidence | Consequence | Fix |
|---|---|---|---|---|
| CO-01 | Storefront submit never sends the customer session token, while the order route requires one | `storefront/src/lib/pocketbase.ts:201-215` (no `Authorization`); `src/app/api/storefront/order/route.ts:163-169` | Every web order 401s; the client then falls back to direct PocketBase writes | Send `Authorization: Bearer`; delete the fallback |
| CO-02 | Web order items omit the required `variant` relation | `route.ts:295-303,429-439` — the resolved variant is never carried into the item; `variantId` comes only from a payload field the client never sends; live schema requires it | Item creates are rejected and swallowed → header with zero lines; invoice/stock/settlement downstream broken | Carry the resolved variant into the item; add the selector; stop swallowing |
| CO-03 | Chat payment ledger write uses enum values the live schema rejects | `src/lib/chat-sales.ts:219-236` (`provider: 'manual_upi'`, `status: 'pending'`) vs the live `payment_links` enums | No payment trail on concierge orders | Map onto the enums or migrate them |
| CO-04 | Web `sales` mirror uses invalid enum/relation values and is swallowed | `route.ts:465-481` — `payment_method` outside `sales.payment_method`; UTM string into the `sales.campaign` relation | Storefront revenue never appears in the unified sales feed | Map the method; resolve a campaign id; assert the mirror row |
| CO-05 | Online checkout gives Razorpay no local order reference | `storefront/src/lib/razorpay.ts:58-84` (no `order_id`); `route.ts:418-422` (payment id only inside `internal_notes`) | `payment.captured` cannot be resolved to an order; paid orders stay `draft` | Create a gateway order server-side with `notes.order_id`; store the ids on `sales_orders` |
| CO-06 | Chat payment link is keyed to a `sales` id, not a `sales_orders` id | `src/app/whatsapp/page.tsx:1264` (`saleId`), `RazorpayPaymentModal.tsx:109-159`, `razorpay.ts:318-322` | Webhook looks the id up in `sales_orders` and fails; reconciliation cannot settle | Pass the order id from `createSaleFromChat` |
| CO-07 | Channel stock movements are written without `account_email` | `src/lib/channel-stock.ts:314-321` (no `account_email`) vs tenant rules on `stock_movements.account_email` | Remote-channel stock history is invisible to the tenant UI; reconciliation runs blind | Stamp the tenant on the movement |
| CO-08 | Webhook and web order paths mutate the shared PocketBase client's auth | `src/lib/pocketbase.ts:155-203` (`ensureServerAuth` rewrites `pb.baseUrl`/auth); used by `route.ts:209` and `razorpay-webhook-handler.ts:78` | Concurrent tenants can interleave; loyalty/aggregates can target the wrong tenant | Use `createTenantClient` only; no global auth mutation in request paths |
| CO-09 | Coupon rules are split between client and server and disagree | `storefront/src/app/checkout/page.tsx:128-155` (`MYCART49` client-only; FESTIVE10 min cart) vs `route.ts:336-362` (no min/limits; hardcoded fallback) | Charged amount ≠ recorded total → webhook refuses the payment | One server money function used for both charge and record |
| CO-10 | Concierge order path trusts operator price/total and has no address input | `src/app/whatsapp/page.tsx:1243-1250`; `chat-sales.ts:86-115,139-152` | Revenue leak and wrong totals; order unfulfillable without manual address edit | Re-price server-side; capture the address in the order builder |
| CO-11 | Catalog-order ingestion writes non-existent columns and empty required relations | `src/lib/whatsapp-order-ingestion.ts:128-165` (`whatsapp_order_id`, `payment_method`, `product: ''`, `variant: ''`) | Draft header only, zero lines, no payment method; customer path bypasses the shared upsert | Route E4 through the shared capture services |
| CO-12 | Concierge order has no idempotency and writes rows in unsafe order | `chat-sales.ts:65,139-152,169-188,219-236` (`Date.now()` ids; `sales` before `sales_orders`) | Double-click duplicates orders; a later failure leaves an orphan sale | Idempotency key + parent-first ordering + compensation |
| CO-13 | Webhook and customer-session secrets are not provisioned, with no startup validation | `.env.local` (PocketBase + tenant key only); `razorpay-webhook-handler.ts:30-34` fails closed; `verify-otp/route.ts:99-104` 503s | Both remote channels are inert in this deployment despite correct code paths | Fail-fast config check on boot + documented required keys |
| CO-14 | Buyer state code is never captured per order; the route passes seller state | `route.ts:377-386` (`buyerStateCode: storeTax.sellerStateCode`) | IGST never charged on inter-state web sales | Required buyer state code / place of supply (migration) |

**Position in the fix order:** CO-01/CO-02/CO-05/CO-09 (plus CO-03/CO-04 to make writes honest) are release blockers for the public storefront, not hygiene — they either take money without an order or persist an order without lines. Insert them immediately after the security cluster in §7.5.

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
| Cloud sync of the change log | Removed with the mock engine; recovery is file-based through Backup & Restore |
| WhatsApp Flows and newsletter flash drops | Flash-drop module present; no scheduling surface |
| Customer-facing order tracking | Only courier tracking exists |
| Abandoned-cart recovery | Cart bridge exists; no persistence or follow-up |
| Remote order-capture integrity | Orders can persist without line items, payment method or settlement link (§12) |
| Payment settlement mapping | No gateway order/receipt reference; the webhook cannot resolve web orders (§12 F9) |
| COD settlement marking | No lifecycle after delivery (§12 S8) |
| Shipment/AWB capture from channel orders | `shipments` collection exists; no channel writer (§12.3.5) |
| Consent ledger | Boolean flags only; WhatsApp opt-out stored separately (§12 A68) |
| PIN / QR quick cashier switch | Roadmap only |

---

### 8.6 Built but not connected

This is the most misleading category in the repository: substantial code exists, is typed, is unit-tested by hand, and is reachable by no user action.

| Module | What it implements | Why it is unreachable |
|---|---|---|
| `omnichannel-buffer-engine.ts` | Channel buffers and cart reservations | No importer; in-memory state would not survive reload anyway |
| `sync-engine.ts` + `sync/shopify.ts` + `sync/woocommerce.ts` | E-commerce sync orchestration | Zero importers; seven TODOs; Settings shows "Coming Soon" |
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
| Verified (2026-10-24) | Re-read in code and against the live PocketBase schema for §12; §12.1 states its own limits |
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

### 11.5 Slice 5: quality gate (2026-10-23)

**Closed:** D-04, D-24.

| Change | Files | Why |
|---|---|---|
| WhatsApp quoted-reply hooks fixed | `src/app/whatsapp/page.tsx` | The early return moved below the hooks; the quoted block reads a local `quoted` value, so a plain message after a quoted reply no longer changes hook order and crashes the chat |
| Remaining lint errors fixed | `src/lib/excel-import.ts`, `src/lib/purchase.ts` | Two `prefer-const` errors; lint is now **0 errors** |
| One test command | `package.json` | `npm test` runs the three suites (tax math, returns policy, tenant auth), 33 assertions, non-zero exit on failure |
| Typecheck command | `package.json` | `npm run typecheck` runs `tsc --noEmit --incremental false`, which works on this volume |
| CI | `.github/workflows/ci.yml` (new) | Typecheck, lint and tests on push and pull request. `next build` is deliberately excluded until D-08 is settled |

**Verified:** `npm test` exit 0 (12 + 9 + 12 assertions); `npm run typecheck` exit 0; `npx eslint src` exit 0 with 324 warnings and **no errors**.

**Still open in this cluster:**

- No component or end-to-end layer: the suites cover pure policy and math, not the POS, drawer, or WhatsApp screens.
- The backup, offline queue and Drive sync items in this cluster are untouched; only the test and CI half landed.

### 11.6 Slice 6: capabilities and navigation (2026-10-23)

**Closed:** S-07, D-22.

| Change | Files | Why |
|---|---|---|
| Pure capability rule | `src/lib/api-auth.ts`, `src/scripts/test-tenant-auth.ts` | `roleGrantsCapability` is testable without a database; Admin and Super Admin pass by name, every other role needs `<resource>: [<action>]` |
| Catalog push requires `products:update` | `src/app/api/catalog/batch/route.ts` | A cashier token can no longer rewrite the Meta catalog; the server sync key still bypasses |
| Storefront CMS write requires `settings:update` | `src/app/api/storefront/content/route.ts` | Publishing storefront content is a settings change, not a read |
| Admin pages hidden from other roles | `src/components/layout/Sidebar.tsx`, `MobileDrawer.tsx` | User Management and Settings disappear for non-admins on desktop and in the drawer |

**Verified:** `npm run typecheck` clean; `npm test` 12 + 9 + 16 assertions, exit 0; targeted ESLint reports no errors.

**Still open in this cluster:**

- S-05: data routes still share the module PocketBase client.
- S-06: plaintext tenant registry needs an approved migration.
- Payment links and POS remain open to any authenticated operator by design, because a cashier must be able to take payment.

### 11.7 Slice 7: desktop database (2026-10-23)

**Closed:** D-09.

| Change | Files | Why |
|---|---|---|
| PocketBase and migrations ship with the app | `src-tauri/tauri.conf.json` | `bundle.resources` carries `pocketbase.exe` and `pb_migrations`, so an installed build has an engine |
| Rust owns the database process | `src-tauri/src/lib.rs` | Reuses a healthy instance on 8090/8091/8092, otherwise spawns one bound to loopback with `--dir` in app data and bundled migrations, waits for `/api/health`, and records the port |
| Supervision and shutdown | `src-tauri/src/lib.rs` | Three failed health checks restart the process; `RunEvent::Exit` kills the child so it never outlives the app |
| Diagnostics command | `src-tauri/src/lib.rs` | `get_pocketbase_status` reports managed, port and health for the UI and support |

**Verified:** `cargo check` finished clean in 1m 00s; `tauri-build` compiled the crate with the new resource config, which validates the JSON. TypeScript is untouched.

**Not verified, and stated as such:** no installer was produced, because `beforeBuildCommand` still runs the failing static export (D-08), so process start, restart and shutdown were not exercised on this machine. Only `pocketbase.exe` is checked in; Linux and macOS builds need their own binary at `src-tauri/resources/pocketbase`.

**Still open in this cluster:** D-08, the export-versus-routes decision.

### 11.8 Slice 8: official GSTR-1 (2026-10-23)

**Feature closed:** the GSTR-1 engine, previously scaffold with zero importers.

| Change | Files | Why |
|---|---|---|
| Period builder | `src/lib/gstr1-report.ts` (new) | Loads invoices, invoice items, credit notes and their items, maps them to the compiler's source shape, and computes turnover context |
| Official file behind the report | `src/app/reports/gst/page.tsx` | "GSTN JSON" builds and downloads `GSTR1_<MMYYYY>.json`, refuses to run without a valid store GSTIN, and shows validation errors |
| Period helpers tested | `src/scripts/test-gstr1-period.ts` (new) | MMYYYY formatting and the 1 April financial-year boundary |

**Verified:** `npm run typecheck` clean; `npm test` 12 + 9 + 16 + 3 assertions; targeted ESLint 0 errors. The payload is validated by the engine's own GSTN validator; it has not been uploaded to a live portal.

**Still open in this cluster:** returns QC routing, manufacturing/karigar, cheque/PDC, cross-border and imitation taxonomy wiring.

### 11.9 Slice 9: inward QC routing (2026-10-23)

**Feature closed:** returns QC routing, previously scaffold with zero importers.

| Change | Files | Why |
|---|---|---|
| Grade decides routing | `src/lib/returns.ts` | `qcGrade` on approval: Grade A restocks, repair routes to the karigar queue as a vendor-replacement discrepancy, write-off records a damaged discrepancy; no grade keeps the old reason-based rule |
| QC summary attached | `src/lib/returns.ts` | `executeInwardQcInspection` runs over the returned lines and its inspector summary is appended to the credit note notes |
| Grade selector | `src/app/returns/detail/page.tsx` | One select replaces the two radios and defaults to repair for defective or quality returns |
| Decision tests | `src/scripts/test-returns-qc.ts` (new) | Grade-to-action mapping, and deductions apply to remorse but not to store faults |

**Verified:** `npm run typecheck` clean; `npm test` 12 + 9 + 16 + 3 + 4 assertions; ESLint 0 errors.

**Scope note:** the engine also computes restocking-fee and reverse-shipping deductions. Only routing and the summary are wired, because reducing the credit note total after approval would change a GST document; that is left as a product decision.

**Still open in this cluster:** manufacturing/karigar, cheque/PDC, cross-border and imitation taxonomy wiring, plus the six phantom collections (D-36).

### 11.10 Slice 10: karigar jobs (2026-10-23)

**Feature closed:** manufacturing BOM and karigar job costing, previously scaffold with zero importers.

| Change | Files | Why |
|---|---|---|
| Job costing module | `src/lib/manufacturing-jobs.ts` (new) | Runs the engine's raw-cost, charge-sum and metal-reconciliation functions over a job card and stores results |
| Job cards | `src/app/manufacturing/page.tsx` (new) | Form, live cost panel, loss-tolerance badge, and a saved-job table with complete/reopen/delete |
| Navigation | `Sidebar.tsx`, `MobileDrawer.tsx` | Karigar Jobs sits under Inventory on desktop and in the drawer |
| Costing tests | `src/scripts/test-manufacturing.ts` (new) | Raw cost, charge sum, scrap credit, per-gram rate, tolerance pass and fail, zero-weight guard, daily numbering |

**Storage, and why it is shaped this way:** there is no `manufacturing_jobs` collection, and creating one needs a migration you have not approved. Job cards are therefore stored as a JSON array in the existing `store_settings` key/value table under `manufacturing_jobs`, capped at 500 entries. This works today and needs no schema change, but it is not a relational ledger: it cannot be queried per karigar and will need the migration before it grows.

**Verified:** `npm run typecheck` clean; `npm test` 12 + 9 + 16 + 3 + 4 + 7 assertions; targeted ESLint 0 errors.

**Still open in this cluster:** cheque/PDC, cross-border, imitation taxonomy, and the six phantom collections (D-36).

### 11.11 Slice 11: cheque register (2026-10-23)

**Feature closed:** cheque/PDC tracking, previously scaffold with no importer and no collection.

| Change | Files | Why |
|---|---|---|
| Register module | `src/lib/cheque-register.ts` (new) | Validates CTS numbers, stores cheques, and delegates every status change to `transitionChequeStatus`, so illegal jumps are refused with the engine's own message |
| Register screen | `src/app/cheques/page.tsx` (new) | Portfolio summary, registration form, and per-row deposit/clear/bounce/cancel/delete |
| Navigation | `Sidebar.tsx`, `MobileDrawer.tsx` | Cheque Register sits under Finance |
| Lifecycle tests | `src/scripts/test-cheque-register.ts` (new) | Validation, maturity, stale rule, illegal transitions, bank-account requirement, deposit-then-clear, portfolio totals |

**Storage:** same pattern as karigar jobs, for the same reason. Cheques live as JSON in `store_settings` under `cheque_register` (max 500) because a `cheques` collection needs an unapproved migration. Cleared cheques are protected from deletion because they are the bank audit trail; the JSON store cannot enforce that at the database level.

**Verified:** `npm run typecheck` clean; `npm test` 12 + 9 + 16 + 3 + 4 + 7 + 9 assertions; targeted ESLint clean.

**Still open in this cluster:** cross-border, imitation taxonomy, and the six phantom collections (D-36).

### 11.12 Slice 12: export invoice (2026-10-23)

**Feature closed:** cross-border LUT export, previously scaffold with no route.

| Change | Files | Why |
|---|---|---|
| Export invoice screen | `src/app/reports/export/page.tsx` (new) | Buyer, currency and FX, LUT/IGST switch, ARN, port and shipping bill, with editable line items |
| Live statutory preview | same | Shows the declaration, both totals, the IGST row when not LUT, and downloads the compiled JSON |
| Navigation | `Sidebar.tsx`, `MobileDrawer.tsx` | Export Invoice sits under Reports |
| Engine tests | `src/scripts/test-cross-border.ts` (new) | Conversion both ways, LUT zero-rating, foreign line maths, 3% IGST, declaration and LUT details |

**No persistence, by design:** the engine compiles a document; nothing is written. The FX rate defaults to the engine's table and is editable per shipment, which is the honest gap between a calculator and a booked export (a booked export still needs an invoice record and shipping-bill linkage).

**Verified:** `npm run typecheck` clean; `npm test` 12 + 9 + 16 + 3 + 4 + 7 + 9 + 6 assertions; targeted ESLint clean.

**Still open in this cluster:** imitation taxonomy, and the six phantom collections (D-36).

### 11.13 Slice 13: backup and restore (2026-10-23)

**Partial closure of D-39:** the backup half. `hooks.ts` and `alerts.ts` remain unused, so D-39 stays open with that note.

| Change | Files | Why |
|---|---|---|
| Backup screen | `src/app/backup/page.tsx` (new) | Download the 31-collection backup, toggle a daily browser snapshot, and restore the last snapshot |
| File restore with preview | same | Parses and validates a file, shows version, age and per-table counts, then requires a tick and the typed word RESTORE |
| Preview helpers | `src/lib/backup.ts` | `summariseBackup` and `isBackupOlderThan` are pure and tested; `BackupData` is exported for them |
| Navigation | `Sidebar.tsx`, `MobileDrawer.tsx` | Backup & Restore is an admin-only system page |

**Safety notes, stated plainly:** restore is an upsert by id, not a wipe: rows absent from the file are left in place, so a partial backup does not delete anything. The page says so before the confirmation. The automatic snapshot lives in browser local storage, which is small and per browser; the copy on the page recommends the downloaded file for real recovery. Nothing here touches `pocketbase/pb_data`.

**Verified:** `npm run typecheck` clean; `npm test` 12 + 9 + 16 + 3 + 4 + 7 + 9 + 6 + 6 assertions; targeted ESLint clean. A restore was not executed against the live database, by design.

**Still open in this cluster:** offline queue activation, Drive sync (real or removed), and the unused hooks and alerts.

### 11.14 Slice 14: offline queue activation (2026-10-23)

**Feature closed:** the offline mutation queue, previously scaffold with zero importers.

| Change | Where | Why |
|---|---|---|
| Queue drain and status | `src/components/system/OfflineSync.tsx` (new) | Drains on mount, on the `online` event and every 30 seconds; shows a pill while offline or while mutations wait; "Sync now" retries |
| First real producer | `src/lib/activity.ts` | When the audit write fails, the entry is enqueued instead of logged and lost; the queue replays it when the database is reachable |
| Mounted once | `src/app/layout.tsx` | Sits beside the WhatsApp sync provider, inside the auth gate |
| Queue mechanics tests | `src/scripts/test-offline-queue.ts` (new) | Enqueue create/update/delete, remove, clear, and a corrupt store safely yields an empty queue |

**Scope, stated plainly:** only audit entries queue themselves today. Sales, invoices and payments still require the server because they allocate document numbers; queueing them needs client-generated identity and conflict rules, which is a design decision, not a wiring task. The queue is last-write-wins on replay, so it must not be pointed at financial writes without that design.

**Verified:** `npm run typecheck` clean; `npm test` 78 assertions across 10 suites; targeted ESLint clean. Replay against PocketBase itself is not exercised by the tests.

**Still open in this cluster:** Drive sync (real or removed), the unused hooks and alerts, and the rest of D-39.

### 11.15 Slice 15: Drive sync removed (2026-10-23)

**Item closed:** "Drive sync real or removed" — removed, deliberately.

The module was not a stub in the harmless sense. `connect()` flipped a localStorage flag, and `sync()` waited 1.2 seconds, reported success, and **cleared the change log without uploading anything**. A user who trusted it would have believed their data was in the cloud while it was only on that device. That is worse than an absent feature, so it was deleted rather than left pretending.

| Change | Files |
|---|---|
| Deleted the simulated engine | `src/lib/google-drive-sync.ts` |
| Deleted its modal | `src/components/settings/GoogleDriveSyncModal.tsx` |
| Removed the drawer shortcut and the modal wiring | `MobileDrawer.tsx`, `MobileBottomNav.tsx` |
| Pointed recovery at the real screen | `/backup` (section 11.13) |

**What replaces it:** Backup & Restore downloads a full 31-collection JSON file, which can be copied to any cloud folder the user already trusts. That is a manual sync, and the documentation says so rather than implying continuous replication.

**Verified:** `npm run typecheck` clean; `npm test` unchanged at 78 assertions; `npx eslint src` 0 errors.

### 11.16 Slice 16: landed-cost valuation (2026-10-23)

**Feature closed:** inventory valuation now uses landed cost.

| Change | Files | Why |
|---|---|---|
| Allocation module | `src/lib/valuation.ts` (new) | Spreads a receipt's overhead (freight minus discount) across lines by value, in paise, with the remainder forced onto the last line |
| Stock report | `src/lib/reports.ts` | Builds the latest landed unit cost per variant from received and partial purchase orders, values each row on that basis, and reports `costBasis` |
| Report screen | `src/app/reports/stock/page.tsx` | Adds unit cost and basis columns and shows how many variants are valued at landed cost |
| Allocation tests | `src/scripts/test-valuation.ts` (new) | Proportional split, zero and negative overhead, rounding to the paise, quantity division, zero-quantity and free-goods lines, summary reconciliation |

**Limitations, stated plainly:** valuation uses the newest received purchase, not a weighted average cost; and the overhead is shipping minus discount only, because duties and other charges are not captured on the purchase order yet. D-13 remains open: landed cost is still written inside the PO notes blob, so two simultaneous receipts can lose one, and the report can only reflect what was stored.

**Verified:** `npm run typecheck` clean; `npm test` 85 assertions across 11 suites; targeted ESLint clean.

**Still open in this cluster:** weighted-average costing, channel enum, campaign attribution (the last two need the migration bundle).

### 11.17 Slice 17: imitation taxonomy (2026-10-23)

**Feature closed:** the last unwired domain engine.

| Change | Files | Why |
|---|---|---|
| Studio screen | `src/app/imitation/page.tsx` (new) | Craft, plating, occasion, base metal and stone inputs produce a label line, a dumbbell tag payload with craft and plating codes, plating durability, and tiered wholesale pricing |
| Navigation | `Sidebar.tsx`, `MobileDrawer.tsx` | Fashion Jewellery sits under Inventory |
| Engine tests | `src/scripts/test-imitation.ts` (new) | Label order, empty and unknown values, tag codes, durability, tier thresholds, rounding and savings, quantity clamping |

**Not persisted, by design:** the classification is not written to the product record because `products` has no craft, plating or occasion columns. Making it durable is part of the same migration bundle as channel and job cards; until then the studio is a classifying and pricing tool, and the page says so.

**Verified:** `npm run typecheck` clean; `npm test` 93 assertions across 12 suites; targeted ESLint clean.

**Cluster 6 status:** every domain engine that can work without a schema change is now wired. What remains is the phantom collections and their migrations (D-36).

### 11.18 Slice 18: migration bundle drafted (2026-10-23)

**No code changed. Nothing was applied.**

Five migrations were written under `docs/migrations-draft/`, outside the directory PocketBase scans, and presented in §3.5.1. Each has an `up` and a `down`, each was syntax-checked with `node --check`, and none has been executed. `pocketbase/pb_data` and `pb_tenants/registry.json` were not touched.

The bundle covers the three domains that currently store JSON in `store_settings` (job cards, cheques), the columns the reporting and POS work waits on (`products.gst_rate`, `sales.channel`, `purchase_orders.overhead_amount`, `purchase_order_items.landed_unit_cost`), the campaign table that `campaign-attribution.ts` already expects, and the unique `invoices.order` index.

**Deliberately excluded:** the six phantom collections, because their engines are still unwired and empty tables would recreate the original defect; tenant registry encryption, which is a re-key plan rather than a schema addition; and a weighted-average cost history, which is a follow-up.

**To proceed I need an explicit yes.** The README lists the steps: back up through `/backup`, check for duplicate invoice orders, copy the files into `pocketbase/pb_migrations`, restart, and verify four screens.

### 11.19 Slice 19: public surface hardening (2026-10-23)

**Closed:** S-15, S-16.

| Change | Files | Why |
|---|---|---|
| Fixed-window limiter | `src/lib/rate-limit.ts` (new) | 30 tracking lookups per minute per client address; the route now answers 429 with `Retry-After` |
| Courier proxy limited | `src/app/api/tracking/st-courier/route.ts` | The unauthenticated scraping proxy can no longer be used as an open fetcher |
| Catalog identity required | `src/app/api/catalog/batch/route.ts` | Hardcoded catalog id and phone removed; the route returns 503 until `META_CATALOG_ID` and `META_BUSINESS_PHONE` are set, so one shop's catalog cannot publish into another's account |
| Sync key separated from the Graph token | `catalog/batch/route.ts`, `catalog/feed/route.ts` | Only `CATALOG_SYNC_KEY` authorises sync, compared with `constantTimeEqual`; a Meta token no longer doubles as a shared bearer key |
| Constant-time comparison | `src/lib/api-auth.ts` | Shared-secret comparison no longer leaks length or content through timing |
| Tests | `test-rate-limit.ts` (new), `test-tenant-auth.ts` | Window behaviour, independence, pruning, client key extraction; secret comparison |

**Configuration is now required for catalog sync:** `CATALOG_SYNC_KEY`, `META_CATALOG_ID` and `META_BUSINESS_PHONE`. An installation without them gets a clear 503 instead of silent use of the previous hardcoded values.

**Verified:** `npm run typecheck` clean; `npm test` 100 assertions across 13 suites; targeted ESLint 0 errors.

**Still open in this cluster:** S-08 (sidecar token shipped to the client), S-10 (webhook secret unset), S-11 (ephemeral customer-session secret), plus the S-05 and S-06 items that need your approval.

### 11.20 Slice 20: customer session secret (2026-10-23)

**Closed:** S-11.

| Change | Files | Why |
|---|---|---|
| Signing requires a configured secret | `src/lib/customer-token.ts` | The per-process fallback is gone; `signCustomerToken` throws `MissingSessionSecretError` instead of minting tokens that die on restart |
| Verification fails closed | same | A missing secret returns null; a length-mismatched signature is rejected before `timingSafeEqual`, and payload shape is checked |
| OTP sign-in refuses without configuration | `api/storefront/auth/verify-otp/route.ts` | Returns 503 with a clear message rather than a token nobody can verify |
| Tests | `src/scripts/test-customer-token.ts` (new) | Roundtrip, tamper, expiry, missing secret, and the `JWT_SECRET` fallback |

**Configuration now required for storefront sign-in:** `CUSTOMER_SESSION_SECRET` (or `JWT_SECRET`). Without it the storefront returns 503 on OTP verification. That is deliberate: a token signed with a random per-process key is worse than an explicit failure.

**Verified:** `npm run typecheck` clean; `npm test` 105 assertions across 14 suites; targeted ESLint 0 errors.

**Still open in this cluster:** S-08 (sidecar token shipped to the client), S-10 (webhook secret and dedupe), plus the approval-bound S-05 and S-06.

### 11.21 Slice 21: sidecar token out of the bundle (2026-10-23)

**Closed:** S-08.

| Change | Files | Why |
|---|---|---|
| Token generated per launch | `src-tauri/src/lib.rs` | `RandomState` (OS-seeded) builds a 256-bit value at startup; no literal exists in source or in the compiled frontend |
| Delivered at runtime | `lib.rs`, `src/lib/whatsapp.ts` | Rust passes it to the sidecar environment and injects `window.__WPPCONNECT_SECRET__` into the webview; the client resolves runtime, then a browser-stored value, then a dev-only build value |
| Sidecar refuses defaults | `wppconnect-sidecar/server.js` | Exits when `WPPCONNECT_SECRET` is missing or shorter than 16 characters; token comparison is constant-time |
| Dev flow keeps working | `scripts/dev-all.js` | Generates a random token per dev run and passes it to both the sidecar and Next |
| Tests | `src/scripts/test-whatsapp-secret.ts` (new) | Resolution order, minimum length, no-default behaviour, trimming |

**Verified:** `cargo check` finished clean (1m 35s, warnings only); `node --check` on the sidecar and dev launcher; `npm run typecheck` clean; `npm test` 111 assertions across 15 suites.

**What this does not do:** the browser still talks to the sidecar directly, so the token is present in webview memory while the app runs. Loopback binding and the origin allowlist remain the controls against other local processes; this change removes the token from the shipped bundle, which was the part an attacker could read statically.

**Still open in this cluster:** S-10 (Razorpay webhook secret, dedupe, amount check), plus the approval-bound S-05 and S-06.

### 11.22 Slice 22: Razorpay webhook integrity (2026-10-23)

**Closed:** S-10.

| Change | Files | Why |
|---|---|---|
| Event-id dedupe | `src/lib/webhook-dedupe.ts` (new), handler | Events are keyed by event name plus payment or link id and remembered in `store_settings` (last 200), so a replay cannot repeat side effects |
| Amount comparison | same | Captured paise must equal the order total in rupees; a mismatch is refused and logged instead of settling the order |
| Error mapping | `api/webhooks/razorpay/route.ts` | 503 when the secret is unset, 401 for a bad signature, 409 for an amount mismatch, 400 otherwise, instead of a blanket 400 |
| Tests | `src/scripts/test-webhook-dedupe.ts` (new) | Key rules, duplicate detection, idempotent remembering, cap trimming, exact paise matching, non-numeric refusal |

**Configuration still required:** `RAZORPAY_WEBHOOK_SECRET`. With it unset the route answers 503 and settlement stays on the client-side poller; that is now explicit rather than a blanket 400.

**Verified:** `npm run typecheck` clean; `npm test` 117 assertions across 16 suites; targeted ESLint 0 errors.

**Still open in this cluster:** S-05 (shared client) and S-06 (plaintext registry), both waiting on your approval; everything else in the security register is closed.

### 11.23 Slice 23: dead client layer removed (2026-10-23)

**Closed:** D-39.

D-39 had two halves. The first — unreachable backup and restore — closed in §11.13. The second was a dead data layer: `hooks.ts` (20 KB of `useProducts`, `useSales`, `useDashboardStats`, `useLowStockAlerts`) and `alerts.ts` (burned into a duplicate hook) had zero importers while the dashboard, inventory and product screens each recompute the same queries inline.

**Decision: removed, not adopted.** Adopting them would have meant re-verifying every recomputed screen against a second implementation for no user-visible gain; deleting them removes the duplication instead of blessing it.

| Change | Files |
|---|---|
| Deleted unused hooks | `src/lib/hooks.ts` |
| Deleted duplicate alerts module | `src/lib/alerts.ts` |
| Updated the module inventory and orphan count | this document |

**Verified:** `npm run typecheck` clean; `npm test` 117 assertions across 16 suites; `npx eslint src` 0 errors. No behaviour changed, because nothing imported them.

**What remains unwired:** three modules (`omnichannel-buffer-engine.ts`, `sync-engine.ts`, `whatsapp-commander.ts`), all deliberate — their features need schema or external credentials.

### 11.24 Slice 24: per-request clients, first tranche (2026-10-23)

**S-05 partially mitigated.** The mechanism and the first three conversions land here; five routes remain for the next slice.

| Change | Files | Why |
|---|---|---|
| Tenant runtime resolution | `src/lib/pocketbase.ts` | `resolveTenantRuntime` picks the URL and credentials from the registry, environment or fallback without touching the shared client |
| `createTenantClient` | same | Fresh PocketBase per call, authenticated as that tenant; the shared `pb` keeps its base URL and auth store untouched |
| Converted routes | `catalog/image`, `catalog/feed`, `storefront/auth/delete-customer` | Each now reads through its own client, so an interleaved request cannot inherit another tenant's session |
| Resolution tests | `src/scripts/test-tenant-runtime.ts` (new) | Registered tenant, active-tenant fallback, environment fallback, no-registry case, case and space handling |

**Still on the shared client:** `storefront/order`, `storefront/auth/verify-otp`, `storefront/content`, `catalog/batch`, `pos/payment`, and `inventory/template` (whose generator function takes no client yet). Each conversion is mechanical but touches financial or media writes, so they are being done in small batches with a typecheck and test run between.

**Verified:** `npm run typecheck` clean; `npm test` 122 assertions across 17 suites; targeted ESLint 0 errors.

### 11.25 Slice 25: per-request clients, second tranche (2026-10-23)

**S-05 now covers eight of nine routes.**

| Route | Change |
|---|---|
| `storefront/order` | Order intake, customer creation, stock movement and sales row all run through one tenant client |
| `storefront/auth/verify-otp` | Customer lookup, creation and rename use the tenant client instead of the shared one |
| `storefront/content` | GET and POST build a tenant client; the staff token is still verified on a separate instance so it cannot replace the tenant session |
| `catalog/batch` | Token verification and the product/variant reads use clients built for the caller's tenant |
| `inventory/template` | Passes the tenant client into the template generator, which already accepted one |

**Remaining:** `pos/payment`. Its two `ensureServerAuth` calls exist because the Razorpay helper it calls takes no client; that helper needs a client parameter before the route can be converted safely.

**Verified:** `npm run typecheck` clean; `npm test` 122 assertions across 17 suites; full `npx eslint src` 0 errors.

### 11.26 Slice 26: per-request clients complete (2026-10-23)

**Closed:** S-05.

| Change | Files | Why |
|---|---|---|
| Payment route uses a tenant client | `api/pos/payment/route.ts` | Token verification runs against a client built for the operator's tenant; the shared client is never authenticated or re-pointed |
| Second `ensureServerAuth` removed | same | The Razorpay and PhonePe helpers read their configuration from the environment on the server, so the extra session was unnecessary; it existed only to satisfy the shared-client pattern |
| Unused email tracking removed | same | `verifiedEmail` was assigned and never read once the second auth call went away |

**All nine tenant-scoped API routes now build their own client.** The only remaining `ensureServerAuth` callers are the `pocketbase.ts` export itself and non-route helpers, so a request can no longer inherit another tenant's superuser session.

**Verified:** `npm run typecheck` clean; `npm test` 122 assertions across 17 suites; full `npx eslint src` 0 errors.

**Still open in this cluster:** S-06 only, which needs a re-key of `pb_tenants/registry.json` and your approval.

### 11.27 Slice 27: registry re-key prepared (2026-10-23)

**No registry was modified.** `pocketbase/pb_tenants/registry.json` does not exist on this machine (no tenants provisioned), and the migration script was run in dry-run only.

| Change | Files | Why |
|---|---|---|
| Encrypted secret format | `src/lib/tenant-secrets.ts` (new) | AES-256-GCM, `enc:v1:` prefix, plaintext passthrough so the migration can be incremental |
| Read path | `pocketbase.ts`, `tenant-db-manager.ts` | Registry passwords are decrypted where they are consumed; an encrypted value without `TENANT_REGISTRY_KEY` fails loudly instead of falling back |
| Migration tool | `scripts/rekey-tenant-registry.ts` (new) | Dry-run by default, `--verify` for CI, `--apply` writes a timestamped backup then replaces the file atomically |
| Plan | `docs/registry-rekey-plan.md` (new) | Key custody, steps, rollback, risks |
| Tests | `src/scripts/test-tenant-secrets.ts` (new) | Round-trip, fresh IV, wrong key, tamper detection, plaintext passthrough, key parsing, environment read |

**What is still true:** until someone runs `--apply` with a key, the registry stays plaintext. The code now supports both forms, so the migration is a data step rather than a deploy step.

**Verified:** `npm run typecheck` clean; `npm test` 130 assertions across 18 suites; dry run and `--verify` both exit cleanly on the missing registry.

### 11.28 Slice 28: weighted-average valuation (2026-10-23)

| Change | Files | Why |
|---|---|---|
| `weightedAverageCost` | `src/lib/valuation.ts` | Averages landed cost by received quantity, so one expensive or cheap receipt cannot revalue all older stock |
| Report uses it | `src/lib/reports.ts` | Per variant, accumulates every received line's landed cost and stores the weighted average; zero history still falls back to the purchase price |
| Tests | `src/scripts/test-valuation.ts` | Quantity weighting beats a plain average, empty and zero-quantity inputs return zero, negative quantities are ignored |

**Verified:** `npm run typecheck` clean; `npm test` 133 assertions across 18 suites; targeted ESLint 0 errors.

**Still open in this cluster:** channel enum and campaign attribution, both waiting on the migration bundle.

### 11.29 Slice 29: GSTIN check digit (2026-10-23)

**Closed:** D-16.

| Change | Files | Why |
|---|---|---|
| Checksum module | `src/lib/gstin.ts` (new) | Implements the GSTN mod-36 check digit: alternate factors, quotient plus remainder per character |
| One validator everywhere | `gstr1-engine.ts`, `gst.ts`, `eway-bill.ts`, `reports.ts` | Shape-only checks are replaced by shape plus check digit, so a mistyped GSTIN cannot reach an invoice, an export file or a B2B classification |
| Empty GSTIN handling | `eway-bill.ts` | An empty value is no longer treated as valid; `URP` still passes as the unregistered marker |
| Fixtures corrected | `test-gstr1-engine.ts` | Two fixture GSTINs and the supplier GSTIN had invalid check digits; they were replaced with checksum-valid specimens |
| Tests | `src/scripts/test-gstin.ts` (new) | Three published valid GSTINs, wrong check digits, lowercase and padding, malformed input, state code |

**Verified:** `npm run typecheck` clean; `npm test` 140 assertions across 19 suites; the legacy 58-assertion GSTR-1 suite passes with corrected fixtures; targeted ESLint 0 errors.

**Still open in this cluster:** D-12 (GRN race), D-13 (landed-cost notes blob), D-14 (product GST rate), D-15 (order invoice rate/HSN), D-21 (discount gaps), D-27 and D-28.

### 11.30 Slice 30: four correctness fixes (2026-10-23)

**Closed:** D-18, D-26, D-27, D-28.

| Defect | Fix | Files |
|---|---|---|
| D-18 negative quantities | `validateSaleQuantities` refuses non-positive or non-finite cart lines before any write, so a negative line cannot inflate stock while shrinking the bill | `pos-sales.ts` |
| D-26 expense filter injection | Search text is sanitized before interpolation and amount detection is a strict numeric pattern rather than `Number()` coercion | `expenses.ts` |
| D-27 paid-amount fallback | `markInvoicePaid` uses nullish coalescing and clamps the settled amount to the invoice total, so a zero-value or fully discounted invoice settles at zero instead of the billed total | `invoice.ts` |
| D-28 e-way state default | State codes resolve from the setting, then the GSTIN; generation throws with a clear message when either side is unknown instead of filing from Karnataka | `eway-bill.ts` |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; full ESLint 0 errors.

**Still open in this cluster:** D-12, D-13, D-14, D-15, D-17, D-19, D-21, D-23, D-30 to D-33, plus D-08 and S-06.

### 11.31 Slice 31: navigation, viewport and port alignment (2026-10-23)

**Closed:** D-30, D-31, D-33.

| Change | Files | Why |
|---|---|---|
| Default port aligned | `pocketbase.ts` | Client default is now 8090, matching the dev launcher and the desktop shell instead of relying on the discovery probe |
| Dead navigation entry removed | `Sidebar.tsx` | The Support link pointed at a route that does not exist; it no longer 404s |
| Drawer parity | `MobileDrawer.tsx` | Expense Categories, reachable on desktop, is now in the mobile drawer too |
| Zoom restored | `layout.tsx` | `maximumScale: 1` and `userScalable: false` are gone, so pinch zoom works again |
| Safe area reserved | `layout.tsx` | The content area pads by `env(safe-area-inset-bottom)` so the last row is not hidden behind the mobile navigation on notched devices |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; full ESLint 0 errors.

**Note on D-30:** the two values are aligned but still written twice (the dev launcher is plain JS and cannot import the TS constant). A shared source is possible but would need a generated config or a JS module both can import; the practical inconsistency is gone.

### 11.32 Slice 32: order invoice verification (2026-10-23)

**Closed:** D-15, by verifying the already-shipped money slice rather than adding code.

`generateInvoiceFromOrder` resolves the rate as `item.tax_rate ?? product.gst_rate ?? GST_RATES.JEWELRY` and the HSN from the product with `7113` as the fallback (`src/lib/orders.ts:276,283`), and the invoice is created idempotently per order (§11.1). The audit entry described the pre-slice state; the register has been corrected.

**Still partially open:** D-14. The POS and order paths now consume a line rate, but `products.gst_rate` does not exist, so the fallback still applies. Migration `003_products_craft_and_gst_rate.js` supplies the column; until it is applied, behaviour is as documented.

### 11.33 Slice 33: unused admin bot removed (2026-10-23)

**Closed:** D-38.

`whatsapp-commander.ts` had zero importers and wrote values the schema rejects: uppercase order statuses and a `razorpay_link_id` column that does not exist. Wiring it would have meant fixing the schema and then building a command surface nobody asked for, so it was deleted instead, as was the Drive mock in §11.15.

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; full ESLint 0 errors. No behaviour changed because nothing imported it.

**Still open in this cluster:** D-34 (sync stubs), D-17, D-21, D-32, and the schema-bound and decision-bound items.

### 11.34 Handover state (2026-10-23)

**Register:** 40 fixed, 15 open, 2 P1. Branch `feat/finish-partial-features`.

Verified commands at this point: `npm run typecheck` exit 0; `npm test` 144 assertions across 20 suites; `npx eslint src` 0 errors; `cargo check` clean in `src-tauri`; explorer script parses.

**Remaining P1s, and the exact next action for each:**

| Item | Action |
|---|---|
| **D-08** | Choose server-backed (recommended) or endpoint-free. Server-backed: remove `output: "export"` from `next.config.ts`, have Rust supervise `next start` the way it supervises PocketBase, and drop the static-export assumptions from §5. Endpoint-free: move the 13 route handlers into the sidecar instead. |
| **S-06** | Generate a 64-hex `TENANT_REGISTRY_KEY`, put it in the environment, then `npx tsx scripts/rekey-tenant-registry.ts --apply` followed by `--verify`. Plan: `docs/registry-rekey-plan.md`. |

**Remaining schema-bound work:** apply `docs/migrations-draft/` per its README (backup, duplicate-order check, copy into `pocketbase/pb_migrations`, restart, verify four screens). That closes D-13, D-14, D-36, D-37 and the channel/campaign reporting items.

**Remaining code-only work, with locations:** D-17 (`loyalty.ts` redemption cap and lost updates), D-21 (`discounts.ts` BOGO, sanitization, usage race, return reversal), D-12 (`purchase.ts` GRN race), D-19 (`sequence-generator.ts` cross-process allocation), D-23 (pages calling `pb.collection` directly), D-32 (`globals.css` tokens and 145 hex literals), D-34 (sync stubs: implement or remove).

**What this session deliberately did not do:** apply any migration, modify `pocketbase/pb_data` or `pb_tenants/registry.json`, or run a restore against live data. Every such change has a prepared, reviewable artefact instead.

### 11.35 Slice 34: dead sync modules removed (2026-10-23)

**D-34 partially closed:** the stub clients and their orchestrator are deleted.

`src/lib/sync/` (Shopify, WooCommerce, index) and `src/lib/sync-engine.ts` had zero importers and seven unimplemented TODOs. They are gone. The Settings page still shows the Shopify and WooCommerce cards, whose buttons only alert "Coming Soon"; removing those cards is the remaining half and is a UI edit rather than an integration decision.

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites. No behaviour changed because nothing imported the deleted files.

**Still open:** D-17, D-21, D-32, the Settings cards for D-34, plus the schema-bound and decision-bound items.

### 11.36 Slice 35: server-backed release (2026-10-23)

**Closed:** D-08, by decision and configuration.

| Change | Files | Why |
|---|---|---|
| Static export removed; `output: "standalone"` in production | `next.config.ts` | The 13 API route handlers now exist at runtime instead of being impossible |
| External `frontendDist` | `src-tauri/tauri.conf.json` | Tauri loads `http://127.0.0.1:3210`, which the schema explicitly supports for a server-backed app |
| Next supervisor in Rust | `src-tauri/src/lib.rs` | Starts `server.js`, waits for health, re-points the webview, and kills the child on exit, reusing the PocketBase pattern |
| Server assembly | `scripts/prepare-server-dist.mjs` (new), `server-dist/README.md`, `package.json` | Copies the standalone output plus static assets into the committed placeholder the bundle ships |
| Build uses webpack | `package.json` | Matches the dev script; Turbopack cannot create the symlinks this volume needs |

**Verified:** `cargo check` finished clean in 30s and validated the new config; `npm run typecheck` and `npm test` (144 assertions, 20 suites) pass.

**Build status, stated precisely (updated 2026-10-24):** the route-versus-export conflict was removed here. The remaining exFAT `readlink … EISDIR` blocker was then solved by a parallel agent with `scripts/fix-exfat-readlink.cjs` (normalizes the spurious error to `EINVAL`, loaded via `NODE_OPTIONS` in the build scripts). I verified the result independently: `server-dist/server.js` and its traced `node_modules`/static output exist, the standalone server boots on the loopback port, `/login` returns 200, and an API handler executes (400 validation rather than 404). The Tauri installer itself was still not produced.

**Remaining P1:** S-06 only.

### 11.37 Slice 36: e-commerce surface removed from Settings (2026-10-23)

**Closed:** D-34, second half. The modules were deleted in §11.35; this removes the surface that promised them.

| Change | Files |
|---|---|
| Shopify card deleted, including its "Coming Soon" alert and the credential fields that stored nothing | `src/app/settings/page.tsx` |
| Notification trigger no longer claims a Shopify source | same |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; full ESLint 0 errors.

### 11.38 Slice 37: loyalty atomicity and the redemption cap (2026-10-23)

**Closed:** D-17.

| Gap | Fix | File |
|---|---|---|
| Adjustments lost concurrent updates | `adjustPoints` now uses PocketBase's `+` operators instead of writing a balance read moments earlier; a resulting negative balance is compensated and refused | `loyalty.ts` |
| Redemption cap lived only in the screen | `redeemPoints` accepts the bill amount and enforces the percentage cap at the service boundary, refusing over-redemption even for direct callers | `loyalty.ts` |
| Callers | Both POS paths pass `max(0, subtotal - discountAmount)` so the cap applies to the same base the screen uses | `pos/page.tsx` |
| Input hygiene | Redemptions must be positive and finite; adjustments must be non-zero and finite | `loyalty.ts` |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; full ESLint 0 errors.

### 11.39 Slice 38: the four discount gaps (2026-10-23)

**Closed:** D-21.

| Gap | Fix | File |
|---|---|---|
| BOGO silently returned zero | `buy_x_get_y` now returns an explicit unsupported error instead of a "valid" discount of zero; no UI ever offered it, so nothing is lost | `discounts.ts` |
| Code lookup reached a raw filter | `getDiscountByCode` sanitizes the code before interpolation | `discounts.ts` |
| Check-then-increment usage race | `recordDiscountUsage` reserves a slot with `used_count+`, rolls back when the result exceeds the limit, and undoes the use when the usage row cannot be written; the per-customer cap is checked after writing and rolled back the same way | `discounts.ts` |
| Returned orders burned the coupon | New `reverseDiscountUsage` deletes the usage rows for a sale, order or invoice and decrements `used_count`; called from `processRefund` | `discounts.ts`, `returns.ts` |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

**Note:** no production path currently calls `recordDiscountUsage` — discounts are validated but their usage is not recorded outside tests. That is recorded here rather than papered over; wiring it belongs with the POS checkout that already computes the discount.

### 11.40 Slice 39: closing verification (2026-10-23)

Every gate re-run after slice 38, from the repository as committed:

| Gate | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Tests | `npm test` | **144 assertions across 20 suites**, 0 failed |
| Lint | `npx eslint src` | **0 errors**, 323 warnings |
| Rust | `cargo check` in `src-tauri` | finished clean, including the server-backed config |
| Explorer | extracted script + `node --check` | exit 0 |

**Register: 54 fixed, 1 open, 1 P1 (S-06).**

Remaining, after the applied bundle (§11.47):

| Item | What it needs |
|---|---|
| S-06 | Approval plus a `TENANT_REGISTRY_KEY` to run `scripts/rekey-tenant-registry.ts --apply` (no registry exists on this machine, so there is nothing to re-key locally). D-23 is closed (§11.57). |

**What is proven and what is not:** the server-backed build is now verified end-to-end for the Next side (§11.58) — standalone output assembled, server booted, pages and API handlers responding. A Tauri installer was still **not** produced. Migrations **were applied on 2026-10-23** (§11.47) after sandbox and rollback tests; the tenant registry was not modified.

### 11.41 Slice 40: two findings verified closed (2026-10-23)

Both were already fixed by earlier slices; the register had not caught up.

| Finding | Evidence |
|---|---|
| D-29 settings writer invisible to the reader | The writer now stamps `account_email` from the authenticated user (`src/lib/invoice.ts:482,546`), matching the reader's `account_email` filter at line 310 |
| D-35 hardcoded catalog id and phone | `src/app/api/catalog/batch/route.ts:86-96` reads `META_CATALOG_ID` and `META_BUSINESS_PHONE` from the environment and returns a configuration error when either is missing; `whatsapp.ts` no longer contains either literal |

**Register corrected to 46 fixed, 9 open, 1 P1.** The nine open items are D-12, D-13, D-14, D-19, D-23, D-32, D-36, D-37 and S-06.

### 11.42 Crosswalk: BUG_AUDIT_REPORT_2026-10-22 (2026-10-23)

The 16-item audit is a subset of the 55-item register with its own numbering. Status of each finding, verified against the current tree:

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | POS adds GST on tax-exclusive totals; paid amount wrong | Fixed | Inclusive back-compute in `invoice.ts`; `paid_amount` equals grand total |
| 2 | POS GST computed pre-discount | Fixed | Discount allocated before tax; §11.1 |
| 3 | `tenant-db` unauthenticated | Fixed | `authenticateOperator` + `tenantAccessAllowed` at `tenant-db/route.ts:37,79` |
| 4 | Conditional hooks in `QuotedBlock` | Fixed | Hooks at `whatsapp/page.tsx:296-319`, early return moved after them at `:321-324` |
| 5 | Any 400 clamps stock to zero | Fixed | Only `validation_min_number_constraint` matches (`pos-sales.ts:195-196`) |
| 6 | POS rollback skips shift totals and invoice | Fixed | Negative `updateShiftTotals` at `pos-sales.ts:304`; atomic invoice item loop |
| 7 | OTP no daily cap; fake-customer token | Fixed | Cap at `otp-store.ts:111`; fail-closed 503 at `verify-otp/route.ts:79-87` |
| 8 | `store_settings` rules unscoped; dead writer | **Fixed** | Dead writer deleted (`invoice.ts`); `006_store_settings_rules.js` applied on 2026-10-23, live rules are tenant-scoped (§11.47) |
| 9 | Build broken two ways | Fixed (with caveat) | Server-backed config and webpack build; an installer was not produced because this volume refuses symlinks (§11.36) |
| 10 | Expense search injection | Fixed | `sanitizeFilter` in `expenses.ts` |
| 11 | `opening_float` violates enum | Fixed | Writes `operation_type: 'add'` with a reason (`register.ts:107-112`) |
| 12 | Order invoice state fallback, missing GSTIN, duplicates | **Fixed** | GSTIN written, duplicates prevented, and the seller state now derives from the store GSTIN before the `'27'` last resort (`orders.ts:248-252`) |
| 13 | Banking overdraft race | Fixed | Serialized via `enqueueTask` (`banking.ts:160`) with atomic operators |
| 14 | Cross-process numbering | **Fixed** | Allocation is an atomic `current_value+` update, serialized by PocketBase across processes (`sequence-generator.ts`) |
| 15 | Storefront binding chosen by request body | **Mitigated (tightened)** | Input normalized and sanitized, and a requested storefront is now honoured only when that tenant has settings; otherwise the default binding is used (`storefront.ts`) |
| 16 | Unauthenticated tracking proxy | Fixed | `FixedWindowRateLimiter`, 30/min (`st-courier/route.ts:6,14`) |

**Summary after slice 41: 15 fixed, 1 mitigated.** The only residual is #8's rule half: `006_store_settings_rules.js` is drafted, syntax-checked and awaiting approval. Until it is applied, the live rules stay permissive; per-tenant SQLite instances keep that theoretical, which is why it is not one of the eight open register items.

### 11.43 Slice 41: audit partials and the numbering race (2026-10-23)

| Item | Change | Files |
|---|---|---|
| #12 order state fallback | Seller state derives from `store_state_code`, then the store GSTIN's leading digits, and only then `'27'` | `orders.ts` |
| #14 / D-19 cross-process numbering | Sequence allocation now uses PocketBase's atomic `current_value+` update; the returned record carries the allocated value, so two processes cannot read the same number | `sequence-generator.ts` |
| #8 dead settings writer | `updateStoreSettings` deleted: zero callers, wrote rows without `account_email`, unreadable by its own reader | `invoice.ts` |
| #8 collection rules | Draft `006_store_settings_rules.js` tenant-scopes list/view/update/delete while keeping legacy rows readable; **not applied** | `docs/migrations-draft/` |
| #15 binding selection | A requested storefront is honoured only when that tenant has settings in the database; otherwise the default binding is used and a warning is logged | `storefront.ts` |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors; the new migration passes `node --check`.

**Register: 48 fixed, 7 open, 1 P1.** D-12 and D-19 closed; the audit crosswalk is now 15 fixed, 1 mitigated (#15), with #8's rule half waiting on approval to apply `006`.

### 11.44 Slice 42: the GRN over-receipt guard is a reservation (2026-10-23)

**Closed:** D-12.

| Problem | Fix |
|---|---|
| Two concurrent GRNs both read `quantity_received`, compared, then wrote later, so both passed the guard | The guard now increments first with `quantity_received+` and compares the returned total; PocketBase serializes that update, so the second receipt sees the first one's value |
| When the reservation would exceed the order, the old code silently capped and continued | The reservation is rolled back, the allowed remainder is reserved (or the receipt is refused when nothing remains), and the cap is logged |
| A failed PO-item read was swallowed (`console.warn`) and the receipt proceeded unverified | It now throws with the item id and the underlying error |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

**Still open:** D-13, D-14, D-36, D-37 (all need the migration bundle), D-23 (service-layer adoption), D-32 (design tokens), S-06 (P1, needs approval).

### 11.45 Slice 43: one theme strategy and working font tokens (2026-10-23)

**Closed:** D-32.

| Symptom | Fix | Files |
|---|---|---|
| Theme hardcoded on `<html>` (`className="dark …"`) | A pre-paint script follows `prefers-color-scheme` and toggles `.dark`; both palettes are now reachable and dark: utilities branch honestly | `src/app/layout.tsx` |
| `--font-sans: var(--font-sans)` referenced itself | next/font now exposes `--font-inter` and the Tailwind token is `var(--font-inter), ui-sans-serif, …` | `layout.tsx`, `globals.css` |
| Display font `--font-display` pointed at Manrope, which was never loaded | Manrope is loaded with `variable: "--font-manrope"` and the token resolves it | `layout.tsx`, `globals.css` |
| Mono token named a font string rather than the loaded variable | `--font-mono: var(--font-jetbrains), …` | `globals.css` |

**Colour literals, stated honestly:** a recursive scan finds 224 hex matches in `src/`, concentrated in print/PDF/barcode components (`InvoicePrint`, `ShippingLabelPrintModal`, `barcode-generator`) where literal ink colours are intentional, plus dashboard pages. They were not mass-replaced: a blind token substitution across print documents would change printed output. The functional defects above are fixed; the literal sweep is recorded as separate visual debt rather than claimed.

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; layout lint clean. A production build still stops at the volume's `readlink` limitation before CSS asset emission, so the theme was not visually verified in a packaged artifact.

### 11.46 Slice 44: first page moved behind the service layer (2026-10-23)

**D-23 progress:** `src/app/challan/create/page.tsx` no longer imports PocketBase or builds its own filters; its direct `pb.collection` count is **zero** (was four).

| Change | Files |
|---|---|
| New `searchProductsForDocuments(query)` — sanitized term, batched variant lookup, shared by document builders | `src/lib/products.ts` |
| New `resolveBarcodeProduct(code)` — product by sku or barcode plus first variant | same |
| Challan builder uses both; search input is now sanitized in the service instead of interpolated in the page | `src/app/challan/create/page.tsx` |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors (unused type imports remain warnings).

**D-23 stays open** by design: the audit counts 135 direct calls outside `src/lib` across 26 files, with `setup` (17) and `inventory` (13) as the named next targets. The pattern is established; each remaining page is a mechanical pass.

### 11.47 Slice 45: migrations applied and verified (2026-10-23)

**Closed:** D-13, D-14, D-36, D-37.

The eight-file bundle was applied to `pocketbase/pb_data` with PocketBase stopped, after a full backup at `C:\Users\sivan\AppData\Local\Temp\luminila_pb_backup_20261023-221832` and a duplicate-invoice check (8 invoices, zero duplicate `order` values).

| Step | Result |
|---|---|
| Sandbox run from the pre-migration backup | all eight applied (`migrate up` exit 0) |
| Sandbox rollback (`migrate down 6`, then `down 2`) | every file reverted: tables dropped, columns removed, channel enum and rules restored |
| Live apply | `1792774201_…` through `1792774208_…` applied, exit 0 |
| Live schema | all eight collections present; `products.gst_rate`, `purchase_orders.overhead_amount`, `inward_cost`, `purchase_order_items.landed_unit_cost`, `sales.campaign` present |
| Live data | invoices 8, products 5, sales 5, channel rows `pos` 3 / `whatsapp` 2 — unchanged |
| Capture and sync | PocketBase restarted once for the health check: `/api/health` 200 |

**Two defects found by testing that the draft would otherwise have shipped:**

1. **Destructive enum replacement.** `004` replaced the live `sales.channel` select (`pos, shopify, wholesale, exhibition, marketplace, woocommerce, other`, required) with a narrower enum and `required: false`. Existing rows used `pos`, which the replacement dropped. The migration now merges the current values with the app's additions (`counter`, `storefront`, `phone`, `export`), keeps `required`, and its down restores the original list.
2. **JSVM field mutation does not persist.** Setting `field.values` on a fetched field silently did nothing, and `field.type` is a function proxy rather than the string `"select"`. The migration re-adds a `SelectField` with the carried-over flags, which persists correctly.

**Code changes that make the schema real:**

| Item | Change |
|---|---|
| D-13 | `reconcilePOWithInwardBatch` now accumulates with `'inward_cost+': batchTotalCost` (atomic) and reads the returned total, instead of read-blob → add → write-blob; the PO-number fallback filter is sanitized. |
| D-36 | The five missing collections are created in `008_phantom_collections.js` with the fields their call sites write. |
| D-14, D-37 | Closed by the columns/enum now existing; the code paths that read `products.gst_rate` and write `sales.channel` no longer fall back or drop values. |

**Register: 53 fixed, 2 open (D-23, S-06).**

### 11.48 Slice 46: setup wizard behind a service, hardcoded superuser removed (2026-10-23)

**D-23 progress:** `src/app/setup/page.tsx` no longer touches PocketBase directly — its direct `pb.collection` count is **zero** (was 17).

| Change | Files |
|---|---|
| New `src/lib/setup.ts`: setup-complete check, health check, superuser authentication, role seeding, admin user creation/linking, settings seeding, tenant-scoped demo purge, admin login | `src/lib/setup.ts` (new) |
| The wizard orchestrates those calls; `DEFAULT_ROLES` moved with the logic | `src/app/setup/page.tsx` |
| **Hardcoded credential removed** | `admin@luminila.local` / `LuminilaInit2026!` was a working superuser fallback compiled into the client bundle. Provisioning now authenticates only with the credentials the operator chose and fails with a clear message otherwise. |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint reports no problems; `grep` confirms no `pb.collection` call remains in the setup page.

**D-23 stays open:** two pages migrated (`challan/create`, `setup`), `inventory` (13) and the remaining ~24 files still call PocketBase directly.

### 11.49 Slice 47: inventory listing behind services (2026-10-23)

**D-23 progress:** `src/app/inventory/page.tsx` has **zero** direct PocketBase calls (was 13: variant aggregation, open PO lines, five realtime subscriptions and a stock-movement insert).

| Change | Files |
|---|---|
| `getVariantStockSummary()` — one pass over variants returning per-product stock, material and variant→product map | `src/lib/products.ts` |
| `recordManualIntakeMovement()` — tenant-stamped restock movement | same |
| `getOpenPurchaseOrderItems()` — pending-quantity source | `src/lib/purchase.ts` |
| `subscribeInventoryChanges()` — five subscriptions with one cleanup function | `src/lib/inventory-feed.ts` (new) |
| Page now composes those calls instead of driving PocketBase | `src/app/inventory/page.tsx` |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

**D-23 stays open:** three pages migrated (`challan/create`, `setup`, `inventory`); the remaining ~22 files still call PocketBase directly.

### 11.50 Slice 48: settings export and order builder behind services (2026-10-23)

**D-23 progress:** two more pages now hold **zero** direct PocketBase calls.

| Page | Before | After |
|---|---|---|
| `settings/page.tsx` | 6 inline collection fetches assembling the export snapshot | `collectDatabaseSnapshot(exportedBy)` in `src/lib/database-snapshot.ts` (new); page only triggers the download |
| `orders/create/page.tsx` | 4 direct calls (product search, variant filter, barcode lookup ×2) | reuses `searchProductsForDocuments` and `resolveBarcodeProduct`; the search term is now sanitized in the service |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

**D-23 stays open:** five pages migrated (`challan/create`, `setup`, `inventory`, `settings`, `orders/create`); the remaining ~20 files still call PocketBase directly, largest of which are the WhatsApp catalog editor (9) and WhatsApp page (8).

### 11.51 Slice 49: invoice builder and customer profile behind services (2026-10-23)

**D-23 progress:** two more pages hold **zero** direct PocketBase calls.

| Page | Before | After |
|---|---|---|
| `invoices/create/page.tsx` | 3 calls (in-stock variants with expanded product, barcode lookup ×2) | `getSellableVariants()` in `products.ts` and the existing `resolveBarcodeProduct`; search term now sanitized in the service |
| `customers/detail/page.tsx` | 3 calls (sales list, sales-orders list, jewelry profile patch) | `getCustomerOrderHistory(customerId, phone)` and `updateCustomerJewelryProfile()` in `customers.ts`; the phone filter is sanitized |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors; `grep` confirms no `pb.collection` remains in either page.

**D-23 stays open:** seven pages migrated (`challan/create`, `setup`, `inventory`, `settings`, `orders/create`, `invoices/create`, `customers/detail`); the largest remaining are the WhatsApp catalog editor (9) and WhatsApp page (8), then components/modals.

### 11.52 Slice 50: WhatsApp catalog editor behind a service (2026-10-23)

**D-23 progress:** `WhatsAppCatalogEditorModal.tsx` has **zero** direct PocketBase calls (was 9).

| Change | Files |
|---|---|
| `getWhatsAppCatalogInventory(tenantEmail)` — tenant-scoped products and variants with the tenant filter built (and sanitized) once | `src/lib/whatsapp-catalog.ts` |
| `setWhatsAppCatalogPrice(productId, price)` — merges the WhatsApp channel price and stamps the sync time | same |
| `markWhatsAppCatalogSynced(productId)` — the two "touch timestamp" call sites | same |
| `linkWhatsAppCatalogItem(productId, catalogItemId)` — link and publish paths | same |
| `unlinkWhatsAppCatalogItem(productId)` — unlink and delete paths | same |
| Modal composes those calls; the inline tenant filter and pb import are gone | `src/components/whatsapp/WhatsAppCatalogEditorModal.tsx` |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors; `grep` confirms no `pb.` reference remains in the editor.

**D-23 stays open:** eight surfaces migrated (`challan/create`, `setup`, `inventory`, `settings`, `orders/create`, `invoices/create`, `customers/detail`, WhatsApp catalog editor). The WhatsApp chat page (8 calls, including sale creation from a chat) and the remaining modals are next.

### 11.53 Slice 51: WhatsApp chat page behind two services (2026-10-23)

**D-23 progress:** `src/app/whatsapp/page.tsx` has **zero** direct PocketBase calls (was 8), split by responsibility rather than one generic passthrough.

| Service | Functions | Covers |
|---|---|---|
| `src/lib/chat-inventory.ts` (new) | `listChatProducts`, `listActiveChatProducts`, `findProductByImageHash`, `createChatProduct` | Product picker, the image-hash duplicate guard (hash sanitized), product + default-variant creation, post-create refresh |
| `src/lib/chat-sales.ts` (new) | `createSaleFromChat` | Sale plus sale_items creation, including the per-line variant lookup and quantity maths, with an empty-cart guard |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors; `grep` confirms no `pb.collection` remains in the page.

**D-23 stays open:** nine surfaces migrated (`challan/create`, `setup`, `inventory`, `settings`, `orders/create`, `invoices/create`, `customers/detail`, WhatsApp catalog editor, WhatsApp chat page). Remaining: `DiscrepancyModal` (5), `EwayBillSettings` (4), `BarcodeScanDispatchModal` (3), POS page (3), and settings sub-components.

### 11.54 Slice 52: discrepancy, e-way and dispatch surfaces (2026-10-23)

**D-23 progress:** three more components hold **zero** direct PocketBase calls (12 calls removed).

| Component | Before | After |
|---|---|---|
| `DiscrepancyModal.tsx` | 5 calls: barcode product lookup, variant lookup ×2, vendor list | `resolveBarcodeProduct`, new `getVariantById` / `getVariantForProduct`, and `getVendors()` |
| `EwayBillSettings.tsx` | 4 calls: read and upsert the `eway_bill` settings row | `getEwayBillConfig` / `saveEwayBillConfig` in new `src/lib/eway-bill-settings.ts`; tenant filter and sanitized email live in one place |
| `BarcodeScanDispatchModal.tsx` | 3 calls: dispatchable orders, order status, shipment row | `getDispatchableOrders` / `markSalesOrderShipped` in `orders.ts`, `createShipment` in new `src/lib/shipments.ts` (the `shipments` collection created by migration 008 is now written through a service) |

**Census after this slice:** 31 direct calls remain outside `src/lib` — 13 in API route handlers and 18 across 15 pages/components (POS page 3, POS WhatsApp widget 2, quick barcode 2, then single-call sites).

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

### 11.55 Slice 53: POS page behind services, client-side tail counted (2026-10-23)

**D-23 progress:** `src/app/pos/page.tsx` has **zero** direct PocketBase calls and no longer reads `pb.authStore` (3 collection calls plus two authStore reads removed).

| Change | Files |
|---|---|
| `getPOSQuickAddVariants(limit)` — recent active variants, tenant-filtered | `src/lib/products.ts` |
| `resolvePOSBarcodeVariant(code)` — exact suffix/barcode/full-SKU resolution with parent-SKU fallback, tenant-filtered, sanitized once | same |
| POS page uses both and reads the tenant via `getCurrentTenantEmail()` instead of the global client | `src/app/pos/page.tsx` |

**API route note:** `api/storefront/content` already creates one PocketBase client per request (`new PocketBase(client.baseUrl)`) for both GET and POST; its nine `pb.` references are per-request clients, not the global singleton. API routes are therefore excluded from the remaining D-23 count, and only the client-side tail is tracked.

**Census after this slice:** **15 direct calls remain in client pages/components** across 13 files (two barcode modals at 2 each, then single-call sites in purchase, returns, users, vendors and WhatsApp/inventory modals).

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

### 11.56 Slice 54: six more tail surfaces (2026-10-23)

| Surface | Calls removed | Service used |
|---|---|---|
| `POSWhatsAppWidget` | 2 | `getCustomerSummary` (customers), `createPaymentLinkLedger` (new `payment-links.ts`) |
| `QuickProductModal` | 1 | existing `getCategories()` instead of an inline collection chain |
| `WhatsAppDrawer` | 1 | `findVendorByPhone` (vendors, sanitized digits) |
| `RazorpayPaymentModal` | 1 | `createPaymentLinkLedger` |
| `ProductPhotoTaggingModal` | 1 | new `whatsapp-message-store.ts` (`listStoredWhatsAppMessages`) |

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

**Census after this slice:** **9 direct calls remain in 8 client files** — `QuickBarcodeScanModal` (2), then one each in purchase create/detail, returns detail, users, vendors detail, FlashDrop and ProductBroadcast.

### 11.57 Slice 55: D-23 closed — the client tree no longer touches PocketBase directly (2026-10-24)

**Closed:** D-23.

Final pass removed the last nine direct calls across eight files:

| Surface | Service |
|---|---|
| `QuickBarcodeScanModal` (2) | `findProductBySkuOrBarcode`, `findVariantBySuffixOrBarcode` (both sanitized) |
| purchase create, purchase detail, returns detail, vendors detail (4) | one shared `listVariantsWithProduct({ filter?, sort? })` |
| users (1) | new `src/lib/app-users.ts` (`createAppUser`) |
| FlashDrop, ProductBroadcast (2) | `searchProductsForPicker(query, { expandVariants })`, sanitized search term |

**Evidence:** a recursive scan of `src/app` (excluding API routes) and `src/components` for `pb.collection(` returns **zero** results. API routes were verified earlier to create one PocketBase client per request (`new PocketBase(client.baseUrl)`), so they do not use the shared global singleton either.

**Verified:** `npm run typecheck` clean; `npm test` 144 assertions across 20 suites; targeted ESLint 0 errors.

**Register: 54 fixed, 1 open — S-06 only.**

### 11.58 Shared-workspace verification and build unblock (2026-10-24)

**Coordination.** A second agent works in this checkout. Its changes were present as uncommitted work when this round ran; this round did not stage, modify or revert any of them. My edits stay in this document.

| Parallel work (uncommitted at the time of writing) | Effect |
|---|---|
| `scripts/fix-exfat-readlink.cjs` + `NODE_OPTIONS` wiring in `package.json` | Normalizes libuv's exFAT `EISDIR` to `EINVAL`, removing the last build blocker |
| `next.config.ts` comment, `.gitignore` ignores for `server-dist/` | Documentation and generated-output hygiene |
| Header comment on `pb_migrations/1792774206_store_settings_rules.js` | Removes the stale "DRAFT — not applied" banner; comment-only change to an applied migration. The same stale banner remains on the other seven applied migration files and should be cleaned by their owner |
| Re-verification appendix in `BUG_AUDIT_REPORT_2026-10-22.md` | Independently re-checked all 16 findings; conclusions match §11.42 |

**Verified by me (not taken on trust):** standalone output exists and is complete (`server-dist/server.js`, traced `node_modules`, `.next/static`); booting it on loopback returned **200** for `/login` and **400** from `/api/tracking/st-courier`, proving a route handler executed. Before this, all repository gates were green: typecheck exit 0, 144 assertions across 20 suites, 0 lint errors, explorer script parses, `cargo check` clean, re-key tooling dry-run and `--verify` exit cleanly with no registry present.

**Residual risk carried forward (from the parallel re-verification):** first-run provisioning of a *brand-new* tenant remains anonymous and uncapped. Authenticated tenant control covers existing tenants (S-01/S-02); a provision allow-list or cap is recommended before hosting beyond the desktop/tunnel model. This is recorded, not silently accepted.

**Still open:** S-06 only (deployment-time registry re-key; no registry exists on this machine).

### 11.59 Final completion audit (2026-10-24)

All eight objective clusters were re-checked against the code, not against slice notes.

| Cluster | Evidence |
|---|---|
| Money and tax | `invoice.ts` imports the integer-paise module (`allocateDiscountPaise`, `splitInclusiveLine`, `computeInclusiveLines`) and treats POS totals as tax-inclusive; `paid_amount = grand_total`; order invoices idempotent with the unique order index applied |
| Returns and refunds | `processRefund` records the cash ledger entry via `recordCashRefund`; `validateReturnQuantities` guards cumulative over-return; exchange invoices created with GST |
| Tenancy and auth | 13 API routes audited: tenant/provisioning/payment routes call `authenticateOperator` or `createTenantClient`; POS payment has explicit 401 paths; Razorpay webhook verifies its signature and maps failures to 401/409/400; tracking has a rate limiter; OTP is capped and fail-closed |
| Release and packaging | Server-backed config; PocketBase and Next supervised from Rust; `server-dist` assembled; standalone server booted with `/login` 200 and an API handler executing (verified independently in §11.58) |
| Channel surfaces | Storefront order intake bound to the session token with tenant fallback rules; catalog feed/image keyed; OTP capped; Meta publish protected by `CATALOG_SYNC_KEY` |
| Domain engines | Manufacturing, cheque, QC, GSTR-1, cross-border and imitation engines wired; all eight migrations applied; live schema confirms the collections and columns |
| Ops and tests | Backup UI with guarded restore, offline drain, Drive mock removed; `npm test` runs 20 suites / 144 assertions |
| Reporting | Weighted-average landed cost, channel enum extended in the live schema, campaign attribution backed by a real collection |

**Client-side architecture:** recursive scan of `src/app` (excluding API routes) and `src/components` for `pb.collection(` returns **0**.

**Gates:** typecheck exit 0; 144 assertions / 20 suites; ESLint 0 errors; explorer script parses; `cargo check` clean; registry re-key tooling dry-run and `--verify` exit clean.

**Register: 54 fixed, 1 open.** The single open item is S-06 (tenant registry plaintext passwords). Its code, migration script, plan and tests are complete, but applying it needs a human-supplied `TENANT_REGISTRY_KEY` and an actual registry — this machine has none (`pocketbase/pb_tenants/registry.json` does not exist). Native Android packaging and a Tauri installer remain blocked by this workstation's exFAT volume, documented in §5.3.

**Shared workspace:** a second agent's build-unblock work was verified but left uncommitted and untouched by this round (§11.58).

### 11.60 S-06 re-key authorised and executed on this checkout (2026-10-24)

The user authorised the re-key. It was executed, and the honest result is that there was nothing to migrate.

| Step | Result |
|---|---|
| Key generation | 64-hex AES-256 key generated with `crypto.randomBytes(32)` |
| Key storage | Written to `.env.local` (verified ignored: `git check-ignore` reports `.gitignore:56:**.env.local`) plus an offline copy outside the repository. The key is deliberately **not** recorded in this document or any committed file |
| Dry run | `npx tsx scripts/rekey-tenant-registry.ts` → exit 0, "No registry … nothing to re-key yet." |
| Verify | `--verify` → exit 0, same message |
| Apply | `--apply` → exit 0, same message; `pocketbase/pb_tenants/registry.json` still does not exist and no file or database was modified |

**Why it could not complete:** this checkout has never provisioned a tenant. There is no `pb_tenants/` directory and no registry, so there are no plaintext passwords to encrypt. S-06 remains open as a **deployment data step**, not a code gap; the tooling is now exercised and armed.

**Procedure for a deployment that has tenants:**

1. Put a `TENANT_REGISTRY_KEY` (64 hex) in that deployment's environment. Generate a fresh key there rather than reusing this checkout's, and keep an offline copy — losing it means stored tenant superuser passwords must be reset.
2. Run `npx tsx scripts/rekey-tenant-registry.ts` (dry run) and confirm the tenant list is what you expect.
3. Run `--apply`; the script writes a timestamped `registry.json.bak-*` before replacing the file atomically.
4. Restart PocketBase and the app.
5. Run `--verify`; it exits non-zero if any plaintext password remains.

**Caveat:** the key created here lives only in this checkout's git-ignored env file and the offline copy; a different deployment must not assume it has the same one.

### 11.61 Document audit: the explorer caught up with the code (2026-10-24)

With the code objective exhausted, both documents were checked against the tree. The explorer carried pre-remediation statuses; corrected rows:

| Was | Now |
|---|---|
| ORPHANS listed deleted `sync-engine.ts` and sync clients | removed; only `omnichannel-buffer-engine.ts` remains unwired (1 module, matching the vital) |
| Vital "13 API routes that cannot ship" | "13 API handlers served by the bundled server" |
| VERIFY: production build *blocked* | *pass* — standalone output assembled and booted (§11.58) |
| VERIFY: schema drift *fail* (six collections absent) | *pass* — eight migrations applied, live schema confirmed (§11.47) |
| Features marked partial for D-12, D-13, D-16, D-17, D-19, D-28, D-36, D-37, S-05, S-11 | live, each citing the fixing slice |
| Offline queue marked scaffold; admin bot marked scaffold | offline queue live (drains on reconnect); admin bot absent (deleted) |
| Static production build marked absent | live (server-backed) |
| Automated tests "three suites" | 20 suites / 144 assertions |

Still accurately non-live: absence-category features (PIN/QR cashier switch, old-gold trade-in, HUID vault, savings scheme, split tender, held carts, e-invoice/IRN, bank reconciliation, scheduled reports, WhatsApp Flows), the unwired anti-oversell buffer, the still-blocked native Android APK, and cloud sync (removed mock). Those are product scope or environment, not regressions.

### 11.62 Hosting profile: private ERP, public storefront (2026-10-24)

Requested deployment model: only the storefront is publicly reachable; the ERP and the WhatsApp sidecar are owner-only.

**Code added**

| File | Purpose |
|---|---|
| `src/lib/host-guard.ts` | Pure policy: normalize hosts, parse `ADMIN_HOSTS`/`STOREFRONT_HOSTS`, classify admin vs storefront (unknown hosts get the public-safe view, loopback is admin), and decide whether a path may be served |
| `src/proxy.ts` | Next 16 proxy convention (middleware is deprecated in 16.1): storefront hosts get only `/checkout`, `/tracking`, `/api/storefront/*`, `/api/tracking/*` and static assets; everything else is a 404. Guard is a no-op when the env lists are unset, so desktop/dev/CI are unchanged |
| `src/lib/public-surfaces.ts` | Shared public-path list used by both the auth gate and the chrome split |
| `src/components/layout/AppChrome.tsx` | Public pages no longer render the operations sidebar, WhatsApp drawer or realtime sync providers |
| `src/components/auth/AuthGate.tsx` | `/checkout` added to the public paths (the storefront checkout previously redirected customers to /login) |
| `src/lib/pocketbase-url.ts` + `src/lib/pocketbase.ts` | Browser PocketBase URL resolver: explicit `NEXT_PUBLIC_POCKETBASE_URL` wins; stored override second; https without configuration uses same-origin `/pb` instead of an unreachable `http://<host>:8090`; Tauri/Android/LAN behaviour preserved |

**Deployment kit (`deploy/`)**

- `README.md` — topology, install, systemd, Cloudflare Tunnel (storefront host only), Tailscale, first run, S-06 re-key, backups, security checklist.
- `env.example` — every required variable, with `NEXT_PUBLIC_*` marked build-time.
- `cloudflared/config.yml` — one public ingress (storefront); no ERP/PB/sidecar entry.
- `tailscale.md` — tailnet HTTPS on 443 (ERP), 10000 (PocketBase), 8443 (sidecar), plus firewall rules.
- `systemd/{luminila-pocketbase,luminila-next,luminila-whatsapp}.service` — loopback-bound services with hardening.
- `backup/backup.sh` + cron — online SQLite snapshots of primary and tenant DBs, storage and encrypted registry, with retention.

**Behaviour**

| Request | Public storefront host | Private tailnet host |
|---|---|---|
| `/checkout/whatsapp`, `/tracking/*` | served (no login) | served |
| `/api/storefront/*`, `/api/tracking/*` | served | served |
| `/inventory`, `/settings`, `/login`, `/api/system/*`, `/api/pos/*`, `/backup` | **404** | served (auth gate applies) |
| Unknown host (e.g. direct IP) | public-safe view only | — |

**Verified:** host-guard tests 7/7 and PocketBase-URL tests 6/6 pass; my six changed/new source files pass ESLint with the Next page-linking rule disabled (that rule currently crashes on a half-deleted directory); the pure modules compile under an isolated strict tsc; repository-wide typecheck was clean after these edits (exit 0) but **became red later due to the parallel agent's in-flight refactor** (deleted `imitation/page.tsx`, inventory/rbac edits), and repo-wide ESLint currently crashes on `src/app/imitation` permissions. Both are workspace-state issues, not this change; re-run gates once the other agent's refactor settles.

**Not wired yet:** the two new test scripts are run manually because `package.json` is under the other agent's active edit; add them to the `npm test` chain once ownership is clear.

### 11.63 Proxy execution verified; runtime env confirmed (2026-10-24)

Two questions left open by §11.62 are now answered with evidence.

**The file convention is correct.** Next 16.1's own build template loads
`(isProxy ? mod.proxy : mod.middleware) || mod.default` and throws
"must export a function named proxy or a default function" otherwise. A new
execution test imports `src/proxy.ts` and calls it with synthetic `NextRequest`
objects — no build required — and proves:

| Case | Result |
|---|---|
| `shop.example.com/checkout/whatsapp`, `/api/storefront/order` | pass through |
| `shop.example.com/inventory`, `/pos`, `/settings`, `/login`, `/backup` | **404** |
| `shop.example.com/api/system/tenant-db`, `/api/pos/payment`, `/api/catalog/batch` | **404** |
| unknown host `/inventory` / `/tracking/ABC` | 404 / pass through (public-safe default) |
| `erp.tail1234.ts.net/inventory` | pass through + `X-Frame-Options: DENY`, `X-Robots-Tag: noindex`, `nosniff` |
| host lists unset | guard disabled, everything passes (desktop/dev/CI unchanged) |

8/8 assertions pass (`npx tsx src/scripts/test-proxy.ts`).

**Runtime env is valid here.** Next 16 forces proxy files onto the Node.js
runtime: its build manifest sets `runtime: 'nodejs'` when `isProxyFile(page)`.
That matters because guard lists are secrets-adjacent configuration: with the
Edge runtime they would be inlined at build time, so changing `ADMIN_HOSTS`
would need a rebuild. As shipped, `ADMIN_HOSTS`/`STOREFRONT_HOSTS` are read at
request time. `NEXT_PUBLIC_POCKETBASE_URL` and `NEXT_PUBLIC_WPPCONNECT_URL`
remain build-time inlined by design.

`deploy/README.md` now states this distinction.

**Test totals for this profile:** 7 host-guard + 6 URL + 8 proxy = **21 assertions**.

**Still blocked at the repository level:** the parallel agent's in-flight
refactor keeps `tsc` red (their `inventory/page.tsx` `string | null` typing,
plus stale `.next` route types for the deleted `imitation/page.tsx`) and crashes
repo-wide ESLint on the half-deleted `src/app/imitation` directory. The
directory is empty but handle-locked (exFAT has no ACLs to repair), so it cannot
be removed from this session. This affects verification only, not the committed
files.

### 11.64 Committed HEAD verified independently, and the host split proven over HTTP (2026-10-24)

The shared working tree could not be gated: the parallel agent's uncommitted refactor keeps `tsc` red and crashes repo-wide ESLint on a handle-locked empty directory. So the **committed deliverable** was verified on its own: a detached `git worktree` at `a7b045d` on NTFS, with a real copied `node_modules` (a cross-volume junction broke webpack resolution).

| Gate (committed HEAD `a7b045d`) | Result |
|---|---|
| `next typegen` | success |
| `tsc --noEmit --incremental false` | **exit 0** |
| `npx eslint src` | **0 errors, 338 warnings** |
| `npm test` | all suites pass |
| `npx next build --webpack` | **success**; route list includes `ƒ Proxy (Middleware)` |
| standalone boot | ready in ~76 ms |

**Host split, exercised over real HTTP against the built server:**

| Request (Host header) | Status |
|---|---|
| `shop.example.com/inventory`, `/settings`, `/` | **404**, body exactly "Not Found" (guard, not Next's HTML 404) |
| `shop.example.com/checkout/whatsapp`, `/tracking/st-courier` | 200 |
| `shop.example.com/api/tracking/st-courier` | 400 (handler ran; not blocked) |
| `erp.tail1234.ts.net/inventory`, `/login`, `/api/system/tenant-db` | 200 |
| `random.example.net/inventory` / `/checkout/whatsapp` | 404 / 200 (public-safe default) |
| admin host response headers | `X-Frame-Options: DENY`, `x-robots-tag: noindex, nofollow`, `nosniff` |
| guard-disabled mode (desktop/dev) | `/inventory` and `/api/system/tenant-db` → 200 on every host |

This closes the two doubts from §11.62–11.63: the proxy runs in a real production build with the expected Node runtime semantics, and the ERP is genuinely unreachable from the public hostname without disturbing the desktop path.

**Objective status:** every code cluster is complete and, for the committed tree, all gates pass. The only open register item remains **S-06**, which is a deployment data step: it needs a checkout where tenants exist plus its own `TENANT_REGISTRY_KEY` (§11.60). The working tree still carries the parallel agent's uncommitted refactor; that state is theirs to commit.

### 11.65 Pair-programming brief: storefront & WhatsApp order capture (2026-10-24)

Authored by the parallel agent (capture-layer implementer) as the pair-programming brief for the agent that owns this document. Ground truth: the uncommitted capture refactor in the working tree (`src/lib/channel-orders.ts`, `src/app/api/storefront/order/route.ts`, `src/lib/chat-sales.ts`, `storefront/src/app/checkout/page.tsx`, `src/app/whatsapp/page.tsx` — that tree is ours to commit) plus `docs/STOREFRONT_WHATSAPP_CRM_CAPTURE_GAPS_2026-10-24.md`.

> **Reader note (doc owner, 2026-10-24 03:10):** this entry is retained as the implementer's handoff record, not as the normative reference. The verified capture contract, the expanded case catalogue, the failure-mode register and the reply to the implementer are in **§12**; where this brief and §12 disagree, §12 wins (it was checked against the live schema and the current working tree). Several brief entries were already stale when this entry was written — corrections are listed in §12.4.1.

**What the capture layer stores today** (post-refactor): identity (name, canonical `+91…` phone, email, DPDP consent), address (street/city/state/pincode — shipping only), commercial (per-line DB-verified price, server-recomputed coupon, shipping+COD charges, tax-inclusive GST split on the post-discount base, UTM campaign), payment (method, Razorpay id, idempotent order number, `payment_links` trail on chat orders), fulfilment (status `draft|confirmed`, `payment_status`), CRM side-effects (customer upsert with blank-field merge, atomic `total_spent/total_orders/last_purchase_date`, loyalty: online at paid webhook, COD/concierge at confirmation).

#### A. Case matrix — verified against current code

| # | Case | Current behaviour | Verdict |
|---|---|---|---|
| A1 | Price changed between catalog load and submit | Server re-verifies from DB and recomputes; client's Razorpay charge used the stale total | **FAILS CLOSED** — see F1 |
| A2 | Qty > 100 or ≤ 0 in payload | Clamped to 1..100 silently; charged total may differ from cart display | Partial — feeds F1 |
| A3 | Product deactivated mid-cart | 400 `Product is unavailable` | handled |
| A4 | Coupon deactivated / wrong tenant between display and submit | Server recomputes; discount silently drops to 0 (customer pays more than quoted) | Partial → F1 class |
| A5 | `FESTIVE10` with no discounts row | Hardcoded 10%/₹500 fallback still in the route | Open — remove |
| A6 | Retried submit (network flap, double-click) | Same-session idempotency key returns original order | handled within a session |
| A7 | Page refresh mid-retry | Key lived in a `useRef`; refresh mints a new key → duplicate order | Open — persist key in `sessionStorage` keyed by cart hash |
| A8 | Two buyers, one piece, both pay (online) | Drafts hold no stock; both captures match; second confirms with clamped-to-0 stock | **Open — F2 (no reservation)** |
| A9 | COD order placed with 0 stock | Confirmed; decrement clamps to 0; oversell logged | By-design oversell, no reservation |
| A10 | WhatsApp chat order | Confirmed but **no stock movement, no decrement at all** | **Open — F3** |
| A11 | Webhook never delivered (tunnel down, endpoint error) | Money captured; order stuck `draft`; no reconciliation sweep | **Open — F4** |
| A12 | Duplicate/replayed webhook | Event-key dedupe + `payment_status === 'PAID'` guard | handled |
| A13 | Captured amount ≠ order total | Refused, left for a human | handled (fail-closed) |
| A14 | Refund events (`payment.refund` etc.) | Not handled at all; ERP returns never link to online payments | Open |
| A15 | Customer token (30d) expires mid-payment; `onSuccess` submits afterwards | 401; money captured, order not recorded | Open — rare; needs re-verify-before-pay or webhook-only settle |
| A16 | Order phone ≠ OTP-verified phone | 403 | handled |
| A17 | Phone recycled to a new person | CRM identity is phone-keyed; stale profile silently attaches to the new human | Open — periodic re-verify or order-count heuristic |
| A18 | Family shares one WhatsApp number | One merged CRM customer (LIKE last-10) | accepted design |
| A19 | Address containing commas/newlines | Joined `, ` string scrambles the address fields | Partial — structured address fields exist on the schema; the join is legacy |
| A20 | `state` omitted (optional field) | Tax split falls back buyer = seller (intra-state) | Documented in code; wrong IGST if inter-state — capture state as required |
| A21 | Pincode not serviceable / COD unavailable there | Accepted server-side; Shiprocket check is display-only | Open |
| A22 | Order-number collision (CSPRNG 6 hex ≈ 16.7M/day space) | Unique index rejects; client sees 503 and retries with a fresh id | handled by index |
| A23 | Idempotency key reused with a *different* cart | Returns the first order; second cart silently dropped | Partial — key should bind to a cart hash |
| A24 | Attacker spams 5 orders on a victim's phone | In-memory limiter 429s the *victim* for 10 minutes | Open — raise cap, key on phone+IP |
| A25 | Unknown-host storefront, tenant has no settings row | `getStorefrontBinding` falls back to an arbitrary first `store_settings` row | Residual P3-15 — bind hard to the session tenant or 400 |
| A26 | Storefront API unreachable → client "fallback" | Direct PB `sales` create with client prices, no sales_order, no customer, no idempotency, orphan stock movements (no variant/product field) — dead today only because rules block anonymous writes | **Open — delete the fallback (F5)** |
| A27 | Chat order's payment never verified manually | `payment_links` row stays `pending` forever; no expiry sweep | Open — reuse draft-order reconciliation (F4) |
| A28 | Out-of-stock chat sale (operator enters any total) | Confirmed; no stock effect anywhere (see A10); total is operator-trusted | Accepted for concierge; revisit when chat scales |
| A29 | Order cancelled / returned later | Aggregates (`total_spent`…) and COD-awarded points never reverse | **Open — F6** |
| A30 | `marketingConsent` vs `whatsapp_opt_out` | Two disconnected stores; broadcast composer reads neither | Open — one consent ledger |
| A31 | Flash-drop reservation expires while payment is in flight | Stock released; payment can still complete → confirmed order with no stock | Open — extend hold on payment initiation |
| A32 | Guest without OTP session | 401 before any write | handled |

#### B. Failure modes, ranked

| ID | Mode | Trigger | Blast radius | Fix direction |
|---|---|---|---|---|
| F1 | **Charged ≠ recorded** (price/coupon/qty drift between display and settle) | Any catalog edit or coupon change during an open checkout | Money captured, webhook refuses the mismatch, order stuck `draft`; a support incident per occurrence | Re-verify price at payment-link creation and pass the *server* total to Razorpay; return the recomputed line set to the client before charging |
| F2 | **No stock reservation on cart checkout** | Two concurrent buyers, one piece | Oversold sale confirmed; the clamp hides it until the audit log is read | Reservation service (the flash-drop engine already has reserve/expire/release) — hold at checkout, release on expiry |
| F3 | **Chat orders bypass inventory entirely** | Any WhatsApp concierge sale | Stock parity broken silently for the whole channel | Add movement+decrement to `createSaleFromChat` (same shape as the storefront's COD branch) |
| F4 | **Settlement reconciliation gap** | Webhook undelivered (A11) or chat payment never confirmed (A27) | Paid-but-draft orders; unclaimed revenue | Scheduled sweep: drafts older than N hours with a Razorpay reference → query Razorpay status API → settle or flag |
| F5 | **Storefront direct-PB fallback** | API route down *and* rules permissive someday | Client-trusted prices/totals written as revenue; bypasses every guard | Delete the fallback in `storefront/src/lib/pocketbase.ts` (`2. Secondary` block); on API failure show retry (the route already 503s honestly) |
| F6 | **Aggregates/loyalty never reverse** | Any return, cancellation, or COD refusal | Lifetime value inflated; tiers and campaigns target the wrong customers | Compensating `applyPurchaseReversal` in the returns/cancel path |

#### C. Data still not captured (P3 tail from the gap report)

Billing address & GSTIN (A3/A4), enrichment fields (A6 — DOB/anniversary/sizes have no capture surface), coupon usage ledger (B4), shipment/AWB records (C2), expected-delivery date (C3), COD settlement marking (D2), customer-initiated cancellation (D3), abandoned carts (E3), reviews (E4), wishlist (E5).

#### D. Handoff — asks for the parallel agent

1. **F2/F3 share one fix**: a stock-reservation primitive (the flash-drop engine already has reserve/expire/release) lifted into a service both the cart checkout and chat sales call. Suggest slicing it as the next 11.x entry.
2. **F5 is a two-line deletion** in `storefront/src/lib/pocketbase.ts` — safe to fold into any storefront commit.
3. **F1 needs a decision before code**: re-price-at-link-creation (the charge may differ from the cart display by rupees) vs block-on-mismatch at link time. The first is what marketplaces do.
4. **Ownership**: the capture refactor listed at the top of this section is this agent's uncommitted work; per §11.64 practice, worktree verification on committed HEAD remains the reliable gate until it lands.
5. The 22-suite gate in `package.json` now includes `test-channel-orders.ts` (pure, no DB) — it must stay green through any storefront touch.

**Objective status:** capture surface verified for the happy paths; of 32 enumerated cases, 14 are handled fail-safe. Six named failure modes (F1–F6) remain open, ranked, with fix directions — none blocks the current desktop/tunnel deployment, and F1/F2 are the two that will generate real money incidents at any meaningful order volume.

### 11.66 Unified channel inventory (2026-10-24)

Requirement from the owner: one inventory across POS, WhatsApp and the web storefront. The hosted instance is the only topology that can satisfy it (the desktop installer serves no public storefront and has no sync), and the channels did share one database — but their stock writes had quietly diverged.

**Defects found while implementing it**

| # | Defect | Consequence |
|---|---|---|
| 1 | The web order route wrote `stock_movements` with a `product` field and `account_email`; the collection requires `variant` and has neither field | Every storefront ledger row was rejected and swallowed by `.catch(() => {})`, so storefront sales left no stock ledger at all |
| 2 | The route decremented the product's **first** variant rather than the purchased one | Multi-variant products drifted |
| 3 | WhatsApp concierge orders never deducted stock anywhere (`chat-sales.ts` and `generateInvoiceFromOrder`) | The same unit could be sold on the web after a WhatsApp sale |
| 4 | Storefront sales were written with `channel: "website"`, which is not in the `sales.channel` enum (valid: pos, shopify, whatsapp, wholesale, exhibition, marketplace, woocommerce, other, counter, storefront, phone, export) | The row was rejected and swallowed: storefront revenue never appeared in the unified sales feed |
| 5 | No channel checked available quantity before accepting an order | Last-unit oversell across concurrent channels |

**Implementation**

- `src/lib/channel-stock.ts` — one service both surfaces now use: resolve the real variant (explicit id; the only variant; or the product-level fallback for legacy rows with no variants), refuse ambiguous multi-variant lines instead of guessing, pre-check availability, apply an atomic `stock_level-` decrement with a `stock_movements` ledger row per line, compensate earlier lines if a later line or ledger write fails, and restore stock with reversal rows for cancellations (idempotent). PocketBase enforces the field minimum, so the atomic decrement is the authoritative last-unit guard.
- `/api/storefront/order`: accepts `variantId` per item (400 when a multi-variant product is ambiguous), returns **409 with shortage details** when unfulfillable, deducts through the service for COD/offline (online still deducts at the paid webhook), records `channel: "storefront"` (valid enum, no migration needed), and cancels the just-created order if the decrement loses a race.
- `chat-sales.ts`: refuses an unresolved multi-variant cart line, checks availability before writing any rows, deducts through the service after the order rows exist, and marks the order `cancelled` if the race guard rejects it.
- `restoreChannelStockForReference()` is exported and tested for cancellation flows; no order-cancel UI call exists yet.

**Verification**

| Check | Result |
|---|---|
| `npx tsx src/scripts/test-channel-stock.ts` | **12/12** — variant resolution, ambiguity, tenant scoping, availability, decrement + ledger, insufficient stock, multi-line rollback, ledger-failure restore, idempotent cancellation restore |
| `npm run typecheck` | exit 0 across the repository at capture time |
| `npm test` | all suites pass |
| ESLint on the changed files | 0 errors (4 pre-existing `any` warnings in the route); the repo-wide run still crashes because the Next page-linking rule cannot scan directories containing the exFAT workspace's locked edit temp dirs |

**Commit state (important):** the storefront and chat-sales integration is applied and verified in the working tree, but those two files also carry another agent's uncommitted rewrite. An earlier attempt to commit them pulled that rewrite in and referenced a module that was never committed, so that commit was reset. Only the self-contained service, its tests and this documentation are committed here; the integration is uncommitted with the parallel owner's change set and must land with it. The service itself has no dependency on their rewrite.

**Remaining, stated honestly**

- POS keeps its existing implementation (already correct: variant id, atomic decrement, ledger, clamp-on-oversell with an activity log) rather than being migrated to the shared service; both paths now behave consistently for the last-unit guard, but the code is not yet one path.
- The Razorpay paid webhook still deducts with its own clamp logic; a pending online payment can sit for a while after intake availability passed, so a late payment could clamp. Moving the webhook to the service is the next cleanup.
- `restoreChannelStockForReference` has no caller yet: no sales-order cancellation UI exists in the app.
- No migration was needed: the existing `storefront` enum value is reused instead of adding `website`.

> **Superseded (2026-10-24 03:15–03:24):** POS and the Razorpay webhook no longer run their own stock logic; both call this service (`oversell: 'clamp'`). The two bullets immediately above describe the state at 03:00. See §11.67 and §11.68.

### 11.67 Online payments join the unified stock path (2026-10-24)

§11.65 left one channel outside the shared service: the Razorpay paid webhook deducted stock with its own logic. Inspecting it showed the same defects the storefront had.

**What the webhook did before**

- Wrote `stock_movements` with a `product` field, `source: 'website'` and `account_email` — the collection requires `variant` and has none of those fields, so every ledger row was rejected and swallowed. Paid online orders left no stock ledger at all.
- Decremented the product's **first** variant (or set stock to 0 when the decrement failed), so multi-variant products drifted and shortfalls were hidden.
- Used `channel: 'website'`-era conventions that do not match the current enum.

**What changed**

- `src/lib/channel-stock.ts` now takes an explicit oversell policy: `oversell: 'reject'` (default) for intake surfaces (storefront checkout, WhatsApp concierge) and `oversell: 'clamp'` for the paid webhook. Clamp mode settles at the stock that actually exists, writes a truthful negative ledger entry with an `[OVERSELL: requested N, only M in stock]` note, returns the shortage list, and never silently writes the requested quantity against a clamped count.
- `razorpay-webhook-handler.ts` now deducts through the service with clamp mode, resolving each line from `sales_order_items.variant` when present (else the product's only variant). A captured payment is therefore never failed by a stock shortfall: the order fulfils, the ledger matches reality, and the shortage is logged.
- Order rows now persist the variant reference: storefront and chat-sales item creation write `variant` when known. (Those two files still carry the parallel agent's rewrite, so the variant-persistence hunks remain part of the uncommitted integration, together with §11.65's changes.)
- Legacy multi-variant orders captured before variant references existed cannot be attributed to a unit; the webhook logs a warning and continues instead of failing an already-captured payment.

**Verification**

| Check | Result |
|---|---|
| `npx tsx src/scripts/test-channel-stock.ts` | **15/15** (12 from §11.65 plus clamp-settles, clamp-at-zero, reject-never-clamps) |
| `npm run typecheck` | exit 0 |
| `npm test` | all suites pass |
| ESLint on the changed committed files | 0 problems |

**Remaining, stated honestly**

- POS still uses its own stock path. It is already correct (explicit variant, atomic decrement, ledger, clamp with an activity-log warning), but it is not yet the shared implementation.
- `restoreChannelStockForReference()` remains uncalled: no sales-order cancellation UI exists.
- The storefront/chat-sales integration and variant persistence stay uncommitted with the parallel agent's change set (see §11.65's commit-state note).

### 11.68 POS joins the unified stock path — all four channels now share one implementation (2026-10-24)

POS was the last channel with its own stock logic: per-line movement creation, atomic decrement, first-variant fallback, a clamp-on-oversell branch and the audit row were all inline in `pos-sales.ts`.

**What changed**

- `createPOSSale` now builds one stock pass for the sale and calls `applyChannelStock` with `oversell: 'clamp'` — the same service the storefront, WhatsApp concierge orders and the paid webhook use.
- The POS-specific behaviours were preserved, not dropped:
  - clamp-on-oversell still completes the sale at available stock and emits the `INVENTORY_OVERSELL_WARNING` activity row with requested/available metadata;
  - the customer-facing warnings list still explains each shortfall;
  - facility/store stock is still adjusted by the quantity that actually left stock (previously the requested quantity, even when clamped);
  - the compensating rollback still restores stock and deletes the ledger rows if a later step (shift totals, invoice) fails, and now handles product-level targets as well as variants.
- The service's tenant gate skips validation when the account email is empty: that is the local desktop path where no tenant is selected. Server-side callers always pass the resolved tenant.
- Sales lines with no `productId` (manual/custom lines) are excluded from stock, as before.

**Verification**

| Check | Result |
|---|---|
| `npx tsx src/scripts/test-channel-stock.ts` | **16/16** (new: empty account email skips the tenant gate) |
| `npm run typecheck` | exit 0 |
| `npm test` | all suites pass |
| ESLint on the changed files | 0 problems |

**Coverage now:** POS, WhatsApp concierge, web checkout intake, and the paid Razorpay webhook all dedupe inventory through one implementation — variant-accurate, ledger-backed, atomic and rollback-safe.

**Remaining, stated honestly**

- `restoreChannelStockForReference()` is still uncalled until a sales-order cancellation flow exists.
- The storefront/chat-sales variant-persistence hunks remain with the uncommitted parallel integration (§11.65-11.66).
- Legacy multi-variant orders captured before variant references were stored cannot be attributed to a unit; the webhook logs those.

### 11.69 Order-capture contract, case analysis and pairing reply integrated (2026-10-24)

The parallel agent's §11.65 brief asked the document owner for a verified capture contract and a decision set. This pass delivered it as **§12** after re-reading every capture path against the **live** PocketBase schema.

- §12.2 documents the five entry paths, each with a different credential and trust boundary; treating them as one path was hiding several defects.
- §12.3 is the field-by-field capture contract (identity/address, items/variants, money/tax, payment, fulfilment, attribution/consent, audit/linkage, CRM) with a verdict and `file:line` evidence per field.
- §12.4 keeps the brief's A1–A32 with corrections and adds A33–A79 across persistence, auth/tenant, gateway settlement, WhatsApp specifics and money/identity edges.
- §12.5 expands F1–F6 into F1–F14; F3 and F10 are marked closed by the implementer's stock work (§11.65–§11.68), with residuals kept. §12.6 maps twelve partial-write states to recovery, §12.7 states the fourteen invariants that would have caught the P0s, §12.8 sequences the fixes, §12.9 is the reply (six P0 corrections plus decisions on the five handoff asks), §12.10 crosswalks the gap report.
- §7.6 registers the fourteen code-level defects (CO-01…CO-14).
- Corrected stale claims in §3.5/§3.5.1 (migrations now applied), §4.9/§4.10 statuses, §8.5 channel gaps, §10.1 freshness, Appendix C module list.

**Verification limit, so it is not mistaken for a green run:** the app on `:3000` returned 500 for `/api/storefront/content` and `/api/storefront/order` at 03:05, and `tsc` cannot write `tsconfig.tsbuildinfo` on this volume (TS5033 EPERM); the implementer separately reports typecheck/tests green. The findings are code-and-schema verified; the end-to-end gate and the working-tree re-verification remain open (§11.64).

## 12. Storefront and WhatsApp order capture: contract, cases, edge cases, failure modes (2026-10-24)

This section answers one question: **what must an order from the web storefront or WhatsApp carry, and what happens when any part of that chain is absent, malformed, duplicated, delayed, concurrent or hostile?** It is the normative reference for the remote channels. §11.65 keeps the implementer's original handoff brief for the audit trail; where the two disagree, this section wins because it was checked against the live schema and the current working tree.

The analysis was produced in pair-programming mode with the parallel agent that owns the capture-layer source files. Division of ownership: **the implementer owns `src/**` and `storefront/**`; this document is owned here.** §12.9 is the reply that agent asked for (§11.65:D).

### 12.1 Status and verification basis

| Item | Value |
|---|---|
| Code basis | Working tree at 2026-10-24 ~03:15, i.e. the parallel agent's uncommitted capture refactor — including the webhook and POS stock unifications of 03:09/03:24 (§11.67–§11.68) — on top of `c4b1437` (which `§11.64` verified clean). |
| Schema basis | **Live** schema read directly from `pocketbase/pb_data/data.db` (`_collections.fields`), 2026-10-24 03:0x. This matters: §3.5's drift list and §3.5.1's "not yet run" note are stale — migrations `1792774201`–`1792774208` are present and applied. Capture-relevant live facts are in §12.3. |
| Route probes | `POST /api/storefront/order` with a syntactically valid COD payload returned **500 "Internal Server Error"** (not the route's own 400/401 JSON), and `GET /api/storefront/content` also returned **500**, on `127.0.0.1:3000` at 03:05. The app server was not serving the storefront API during this pass, so no end-to-end order could be exercised. This is a verification limitation, not necessarily a shipped defect (the parallel agent was mid-edit). |
| Type gate | `npx tsc --noEmit` fails with `TS5033 EPERM` writing `tsconfig.tsbuildinfo` on this volume, and `§11.64` records the working tree as separately red. Capture-layer correctness therefore rests on code + schema reading, not on a green gate. |
| Test basis | `npm test` was not re-run for this section: the shared working tree is explicitly not the gate (`§11.64`), and the parallel agent's `test-channel-orders.ts` covers pure helpers only. Gaps in that coverage are named in §12.7. |

**Bottom line:** the happy-path capture surface was improved by the 2026-10-24 refactor, but the channel is **not end-to-end correct**; six of the defects below are P0 because they either lose money or persist a false order record. They are listed with evidence, not inferred.

### 12.2 Entry paths, credentials and trust boundaries

A "storefront/WhatsApp order" is not one code path. There are **five**, and they capture different field sets and trust different inputs. Any analysis that treats them as one will be wrong.

| # | Path | Trigger / actor | Credential today | Writes | State |
|---|---|---|---|---|---|
| E1 | Web checkout → `POST /api/storefront/order` | Customer on the public storefront | Bearer customer session (HMAC, 30 d, claims `{id, phone, tenant, exp}`) — **required by the route** | `customers`, `sales_orders`, `sales_order_items`, channel stock + ledger (COD/concierge only), `sales` mirror, aggregates, loyalty (COD/concierge) | **Broken client-side:** the storefront never sends the bearer token (§12.4.2 A41), so every submit is a 401 in a correctly configured environment. No `CUSTOMER_SESSION_SECRET` exists in `.env.local`, so OTP verification itself returns 503 first (A39). |
| E2 | Web checkout, Razorpay online branch | Customer; Razorpay JS `handler` callback | None beyond E1; the gateway payment is not verified server-side at intake | Same as E1, but stock deferred to the webhook, order left `draft` | **Unreconcilable:** no Razorpay order/receipt is created with local notes, so `payment.captured` cannot be mapped back to the order (A50). |
| E3 | WhatsApp concierge cart → `createSaleFromChat` (`src/lib/chat-sales.ts`) | ERP operator building a chat order | Client-side operator session (the service runs in the browser via the shared `pb` client) | `sales`, `sale_items`, `sales_orders`, `sales_order_items`, channel stock + ledger, `payment_links`, aggregates | **Partially works:** stock now deducts, but the UI passes no address and no variants (A59/A60), multi-variant products are refused (A59), `payment_links` insert is rejected by the schema (A35), and the model is product-level. |
| E4 | WhatsApp inbound catalog/draft → `ingestWhatsAppCatalogOrder` (`src/lib/whatsapp-order-ingestion.ts`) | Operator approval of an inbound chat order ("Book/order" banner) | Operator session, client-side | `customers`, `sales_orders` draft, `sales_order_items` | **Writes a header with zero items:** `variant: ''` and `product: ''` violate required relations and every item insert is swallowed (A34); writes three non-existent fields (`whatsapp_order_id`, `payment_method`) that are silently dropped. |
| E5 | WhatsApp payment link → `RazorpayPaymentModal` → `POST /api/pos/payment` | Operator, from a chat or the concierge order | Operator bearer, verified server-side against `users`/`_superusers` | Razorpay payment link + `payment_links` ledger; settlement by webhook or polling reconciler | **Link cannot be tied to the order:** `createPaymentLink` puts `notes.order_id = refId` where the modal passes a `sales` id on the E3 path (A56); the webhook then looks that id up in `sales_orders` and fails. On the E4 path the id is a real `sales_orders` id, so the same modal behaves differently by entry point. |

Two settlement paths observe these writes: the **Razorpay webhook** (`src/lib/razorpay-webhook-handler.ts`, HMAC fail-closed, secret absent in `.env.local`) and the **polling reconciler** (`src/lib/payment-reconciliation.ts`, only for `payment_links` rows with an `order` relation). Neither is reachable for E2 orders.

Also relevant: POS shares the same stock and customer tables, and as of 03:24 it also routes through `channel-stock` (§11.68), so stock is one implementation across four channels. Intake and settlement semantics still differ per path, and the channel services must not assume they are the only writer (§12.5 F2, F10).

### 12.3 The capture contract — data that must be captured

The schema already has most of the columns this table needs. The defect is the **capture layer**: fields exist empty, are written to the wrong column type, or are silently rejected. Verdict vocabulary: **Captured** = written correctly today; **Partial** = written for one path/condition only; **Rejected** = a write is attempted but the live schema refuses it; **Missing** = no surface or column.

#### 12.3.1 Identity, address and place of supply

| Field | Why the order must carry it | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| Customer display/billing name | Invoice, dispatch label, CRM identity | yes | yes (chat contact name) | Captured, but concierge and ingestion use three different customer-upsert paths, so name/lead status can diverge (F12) |
| Canonical phone (E.164 / +91) | The only cross-channel customer key | yes — `upsertChannelCustomer` → `canonicalPhone` | E3 yes; E4 uses its own `findCustomerByPhone`/`normalizePhone` | Partial — one shared path (E1/E3) plus two legacy paths (E4, OTP: `verify-otp` stores bare `cleanDigits`); see crosswalk F5 in §12.10. |
| Verified-session phone ↔ order phone | Prevents ordering on somebody else's number | route compares last 10 digits | n/a | Captured for E1 only; the client cannot send the token (A41) |
| Email | Confirmation, B2B invoice, marketing | yes (`customer_email` + `customers.email`) | missing | Missing on WhatsApp |
| WhatsApp chat id / message id | Provenance of a chat order; "which conversation sold this" | n/a | chat rows exist, but order has no relation: E3 puts `[chat <id>]` in `internal_notes`; E4 writes non-existent `whatsapp_order_id` | Missing — `whatsapp_messages` has no order relation (`F3` still open; A32 in §11.65 is only a text trail) |
| Operator / staff identity | Accountability for concierge pricing and orders | n/a | not stored: `sales_orders.created_by` exists but neither chat path writes it | Missing (no case yet; see §12.3.7) |
| Recipient name/phone (if different) | Gift orders, delivery to family | missing | missing | Missing |
| Address line 1/2, landmark, district | Courier booking, returns, avoid garbled labels | one free-text field; flattened to `address, city, state, pincode` | E3: service accepts address but UI passes none; E4: takes the CRM profile address | Partial — `sales_orders.shipping_address` is a single text blob; customers has structured `city/state/pincode` but no lines/landmark |
| State **code** (not just name) | CGST/SGST vs IGST; GSTR-1 place of supply | name sent; code never stored on the order (only `customers.state_code`) | missing | Missing — the route literally passes seller state as buyer state (A69) |
| Billing address + `same_as_shipping` | B2B/GST invoice | missing | missing | Missing (gap report A3) |
| Customer GSTIN / company / PAN | B2B invoice legality | missing from checkout; customers columns exist | missing | Missing (gap report A4) |
| Serviceability + shipping quote id | Charge and promise accuracy | display-only Shiprocket check; quote amount client-supplied and only clamped 0–5000 | missing | Partial — server accepts an unserviceable pincode and any quote (A72) |
| COD availability by pincode | Accepting undeliverable COD | not checked server-side | n/a | Missing (A21) |

#### 12.3.2 Line items and variant identity

| Field | Why | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| Product id + tenant check | Price/stock authority | validated server-side (`products.getOne`, tenant compare) | E3 reads product for name; E4 trusts `item.productId` | Partial — E4 allows `''` and swallows the failed insert |
| **Variant id** | Sized rings/bangles are distinct sellable units; stock is variant-level | resolved for stock but **never persisted**; UI has no variant selector, so route throws `VariantRequiredError` for multi-variant products | E3 resolves/throws but persists nothing; cart has no variant | **Rejected** — `sales_order_items.variant` is a **required live relation**; every item create without it fails and is swallowed (A33/A34). Chat order lines now persist once a variant is resolved (fixed 2026-10-24 03:10, §11.67); the web client still supplies no variant, so web orders persist a header with **zero lines**. Net effect unchanged for the web channel. |
| SKU / name | Human-readable line | `description` only | `description` only | Partial — no `sku` column on the item |
| Quantity | Money + stock | clamped 1–100 | unbounded in cart; stock service floors at 1 | Partial — silent clamping means the charged amount can differ from the displayed cart (F1) |
| Unit price **and its source** | Price integrity | re-read from `channel_prices.website \|\| base_price` | E3 trusts `item.base_price` from the operator UI; E4 trusts `unitPrice` from the parsed message | Partial — no re-price on any WhatsApp path (A63); no price-source snapshot on the item |
| Price snapshot / MRP | What the customer saw; later catalog edits must not rewrite history | not stored on the order | not stored | Missing |
| Line discount + `tax_rate` + HSN | Per-line tax and statutory reporting | columns exist, unused | unused | Missing |
| Jewellery attributes (metal, purity, gross/net weight, making charge, stone, size, engraving/personalisation) | The order is a jewellery order; these are what get shipped | not on the order line | not on the order line | Missing (gap report A6) |

#### 12.3.3 Money, discount and tax

| Field | Why | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| Subtotal | Reconciles to items | written from server prices | E3 from operator cart; E4 from parsed message | Partial — E3/E4 subtotal may not equal item lines if a negotiated discount is folded in |
| Coupon code + validated discount | Revenue leak, usage limits, audit | recomputed, but only `is_active` + tenant are checked | none | Partial — min-order, validity window, max uses, per-customer limit and `applies_to` are ignored; `discount_usage` never written and `used_count` never incremented (A71) |
| Discount ledger | Per-customer limits, reports | missing | missing | Missing |
| Shipping charge | Margin accounting | persisted, but client-quoted/clamped | missing (0) | Partial (A72) |
| COD handling fee, kept separate | Reportable service revenue; GST treatment differs from freight | folded into `shipping_charges` | n/a | Missing (A72, F1) |
| Rounding | Gateway amount must equal recorded total | implicit | implicit | Partial — exact-paise comparison at webhook turns any drift into an unsettled order (F14) |
| Tax components (CGST/SGST/IGST), taxable value | Invoice and GSTR-1 | tax **total** computed; components only in `internal_notes` text; no order columns | 0 | Partial — place of supply is forced to seller state (A69); unregistered fallback silently writes zero tax |
| Advance / partial payment / balance on delivery | Standard jewellery purchase pattern | unsupported | unsupported | Missing (§8.2 capability gap) |
| Store credit | Reuses CRM value | unused | unused | Missing |

#### 12.3.4 Payment and settlement

| Field | Why | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| Payment method | COD vs prepaid changes the whole lifecycle | **no column on `sales_orders`** — only `internal_notes` text; `sales` mirror write uses values not in its enum | E3 hardcodes `upi`; E4 writes non-existent `payment_method` | Rejected/Partial — `sales.payment_method` ∈ {cash, card, upi, split, phonepe}, so the mirror create fails for every storefront order (F7) |
| Gateway order id + payment id + signature | Proof of payment | payment id only in `internal_notes`; no server-side verify | link is created on Razorpay, but ref is a `sales` id (E3) | Partial — no local field, no verification |
| Payment link id + status | Settlement and reminders | n/a | `payment_links` insert from E3 is **rejected** (`provider: 'manual_upi'`, `status: 'pending'` are outside the enums) and swallowed | Rejected (A35) |
| UTR / UPI ref for manual transfer | COD-to-UPI and "send screenshot" payments | n/a | no capture surface | Missing (A66) |
| COD collected marker + settlement date | Bank/revenue reconciliation | never set after delivery | n/a | Missing (gap report D2) |
| Refund / chargeback reference | Returns against a remote order | no `payment.refund` handling; no channel credit-note path | same | Missing (A57) |
| Reconciliation state | Distinguish "paid at gateway, unsettled locally" | absent | absent | Missing (F4/F9) |

#### 12.3.5 Fulfilment

| Field | Why | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| Order lifecycle status | Dispatch queue | `draft` for online, `confirmed` for COD/concierge | E3 `confirmed` before payment; E4 `draft` | Partial — statuses valid, but transitions assume a webhook that cannot fire (A50) |
| Expected delivery date | Promise + late-order report | column exists, never written | never written | Missing (gap report C3) |
| Shipment id, courier, AWB, tracking, COD amount | Dispatch and tracking | `shipments` collection exists, no writer; courier only in notes text | same | Missing (gap report C2) |
| Delivery mode (ship / pickup / store visit), gift message | Fulfilment choice | not captured | not captured | Missing |
| Cancellation / return link back to stock ledger | Reversal correctness | `restoreChannelStockForReference` has no caller; only variant rows can be restored | same | Missing (F6, A29) |

#### 12.3.6 Attribution, consent and DPDP

| Field | Why | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| UTM source/medium/campaign/term/content, referrer, landing page | Campaign ROI | only `utm_source/utm_campaign` joined into one string; `sales.campaign` is a **relation** to `whatsapp_campaigns`, so the string write fails and the whole sales-mirror create is swallowed | missing | Rejected (A37, F7) |
| Consent to marketing + its source/time/policy version | DPDP compliance and defensible opt-in | boolean only, merged into `customers.opt_in_marketing`; no timestamp/policy/version, never set back to false | separate `whatsapp_opt_out` + `whatsapp_opt_outs` | Partial — two consent stores, no ledger (brief A30; A68) |
| T&C / cancellation-policy acceptance | Consumer-protection record | missing | missing | Missing |
| Language, first/last-touch, session id | Personalisation, attribution | missing | missing | Missing |

#### 12.3.7 Audit, idempotency and channel linkage

| Field | Why | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| Idempotency key + **cart hash** | Prevent double orders; detect key reuse with a different cart | per-session `useRef`; not persisted across refresh; no cart hash; checked **after** the rate limiter | none | Partial (brief A7/A23; A61) |
| Unique order number | DB-level duplicate guard | yes — route txn id, partial unique index on `sales_orders.order_number`; collision on race returns 503 instead of the existing order | `WA-<date>-<4 digits>` and `Date.now()`-based ids — small spaces, no dedupe | Partial (A22) |
| Raw request snapshot / API version | Replay and dispute evidence | missing | missing | Missing |
| Channel + campaign + operator correlation id | Attribution and accountability | `account_email` written; channel only in notes | missing | Missing |
| Order ↔ chat ↔ message linkage | Support: "what did the customer actually say" | n/a | text in `internal_notes` only | Missing |
| Customer-visible order reference | Support lookup | `order_number` returned | same | Captured |

#### 12.3.8 CRM enrichment and aftercare

| Field | Why | Web | WhatsApp | Verdict / evidence |
|---|---|---|---|---|
| Lifetime aggregates `total_spent/total_orders/last_purchase_date` | Tiering, RFM, reports | written at **intake** (including unpaid online orders) | E3 written; E4 not | Partial — not reversed on cancellation/failure (F12, S7) |
| Loyalty earn/reversal | Rewards correctness | online at paid webhook; COD/concierge at confirmation; no reversal | E3 none (no award) | Partial (F6) |
| DOB / anniversary / ring & bangle size / preferred metal | The jewellery CRM's point | no capture surface | no capture surface | Missing (gap report A6) |
| Multiple addresses / address book | Returning customers | single `customers.address`; existing non-empty values are never refreshed | same | Partial (A78) |
| Customer-initiated cancel / return | Self-service | absent | absent | Missing (gap report D3) |

### 12.4 Case catalogue

#### 12.4.1 Corrections to §11.65's A1–A32

The brief's cases remain useful; these entries are wrong or incomplete as of the current tree and are corrected here.

| Brief ID | Correction |
|---|---|
| A10, F3 ("chat order — no stock movement, no decrement") | **Stale.** `createSaleFromChat` now calls `applyChannelStock` (`chat-sales.ts:205-215`). The open chat problems are variant refusal, absent address, non-verified price, invalid payment-link row and partial writes — not absent stock. |
| A15 ("token expires mid-payment → 401, rare") | **Understated.** The storefront client never sends `Authorization` at all (`storefront/src/lib/pocketbase.ts:206-210`), so E1/E2 always 401 when the route is reached. "Customer token 30 d" is moot. |
| A16 ("order phone ≠ OTP phone → 403, handled") | The guard exists (`route.ts:180-188`) but no real request can reach it because of A41/A42. |
| A19 ("joined address string scrambles fields") | Correct, and worse: `sales_orders.billing_address` is never written at all, so the order cannot support a B2B invoice even later. |
| A22 ("order-number collision handled by the index") | The index exists (live schema), but the loser of a concurrent create gets a **500/503**, and the cross-tenant order-number namespace is global in one database. The correct behaviour is catch-unique → re-read → return existing. |
| A23 ("key reused with different cart returns first order") | Confirmed by design (`findExistingChannelOrder` filters by `order_number` only). The key should be bound to a cart hash; otherwise a tampered re-submit silently drops the new cart. |
| A26 ("direct-PB fallback dead today only because rules block anonymous writes") | The fallback would fail even with permissive rules: `channel: "website"` is accepted now, but `stock_movements.variant` is required, so the movement insert fails; the fallback also writes client-trusted totals. Delete it, do not revive it. |
| A29/F6 ("aggregates/loyalty never reverse") | Correct, plus: the web route increments aggregates at **intake** for `razorpay_online`, so unpaid and failed online orders inflate lifetime spend before any payment exists. |
| Brief B3/implementation claim ("payment_links trail on chat orders") | The row is attempted but **rejected by the schema** (`provider: 'manual_upi'` not in enum, `status: 'pending'` not in enum) — the trail does not exist. |
| Brief claim "typecheck exit 0 at capture time" | Not reproducible on this tree: `tsc` cannot write its buildinfo here (`TS5033 EPERM`) and `§11.64` records the working tree as red. Keep the claim out of verification until re-run on NTFS. |

#### 12.4.2 New cases (A33–A58)

**A. Persistence and schema**

| ID | Case / edge | Current behaviour | Severity |
|---|---|---|---|
| A33 | Web order line (multi- or single-variant product) | `sales_order_items.variant` is required; the storefront client never sends `variantId` and the route does not carry the resolved variant into the item, so the create is rejected and swallowed → web order persists with **zero items**. Chat E3 lines now persist when a variant is resolved (fixed 2026-10-24 03:10, §11.67); product-level legacy lines still omit it. | **P0** (web) |
| A34 | E4 catalog/draft order lines | `product: ''` and `variant: ''` violate required relations; every item insert fails silently; the draft header survives with no items | P0 |
| A35 | E3 chat payment-trail insert | `payment_links.provider='manual_upi'`, `status='pending'` are outside the live enums; create rejected and swallowed | P1 |
| A36 | Web `sales` mirror | `payment_method: 'cod'/'razorpay_online'/'whatsapp_concierge'` are outside the `sales.payment_method` enum; every mirror create fails and is swallowed → storefront revenue never reaches the unified sales feed | P1 |
| A37 | Web campaign mirror | `sales.campaign` is a relation to `whatsapp_campaigns`; a UTM string is written → invalid relation value (or a create failure, depending on validation) → attribution lost | P2 |
| A38 | Stock ledger tenant visibility | `applyChannelStock` creates `stock_movements` **without `account_email`**; tenant API rules filter on it → remote-channel movements are invisible in the ERP stock history | P1 |
| A39 | Product-level (legacy, no-variant) cancel | `restoreChannelStockForReference` only restores `variant` movements; product-level decrements write no movement at all, so support cannot reverse them | P2 |
| A40 | Order items discount/tax columns | `tax_rate`/`discount_amount` exist on the item but are never written; tax exists only as an order-level number | P2 |

**B. Authentication, session and tenant boundaries**

| ID | Case / edge | Current behaviour | Severity |
|---|---|---|---|
| A41 | Storefront submit (E1/E2) | Client fetch has no `Authorization` header; route requires a customer session → 401; then the client falls back to direct PB writes | **P0** |
| A42 | OTP login before A41 | `CUSTOMER_SESSION_SECRET`/`JWT_SECRET` unset in `.env.local`; `verify-otp` returns 503 by design; no token can exist | P0 (config) |
| A43 | Multi-tenant shared instance, concurrent web orders | Route calls `ensureServerAuth(boundAdminEmail)`, which **mutates the module-level client's baseUrl/auth**; loyalty then writes through that shared client. Two tenants' requests can interleave and the later one can retarget the first one's write | **P0** (S-class) |
| A44 | Customer token from tenant A used with `accountEmail` of tenant B | `resolveOrderTenant` rejects (`storefront.ts:31-44`) | handled |
| A45 | Token tenant = default binding (`admin@luminila.internal`) because the store has no settings row | Orders are written under a fabricated tenant; `getStorefrontBinding` falls back after a warning | P2 |
| A46 | CORS | `Access-Control-Allow-Origin: *` on the order route, which accepts a bearer token from `localStorage`; any XSS on the storefront domain can place orders as the customer | P2 |
| A47 | Retried submit counts against the rate limiter before the idempotency lookup | A flaky network can 429 a request whose order already exists; limiter is in-memory, unbounded and resets on restart | P2 |
| A48 | Rate limiter keyed on raw digits | `+91…` vs `0…` vs `91…` spellings get separate buckets; a shared family/store phone hits the 5/10-min cap | P2 |

**C. Gateway and settlement**

| ID | Case / edge | Current behaviour | Severity |
|---|---|---|---|
| A49 | Online payment captured | Checkout charges first, then posts the order. If the post 401s/503s/409s (all reachable today), the customer has paid and nothing exists in the CRM | **P0** |
| A50 | `payment.captured` arrives for a web order | No local Razorpay order/receipt was created with `notes.order_id`, so the webhook's `orderId` resolves to `undefined`; the handler returns success without settling | **P0** |
| A51 | Webhook secret | `RAZORPAY_WEBHOOK_SECRET` unset in `.env.local` → every webhook is refused; E2 orders remain `draft` forever | **P0** (config) |
| A52 | Webhook settles an order whose items failed (A33) | Item list is empty → no stock movement, no invoice lines; loyalty and status still flip to PAID/confirmed | P1 |
| A53 | ~~Webhook stock path~~ — **closed 2026-10-24 03:09** | The webhook now calls `applyChannelStock` with `oversell: 'clamp'`, resolves each line from `sales_order_items.variant` when present, and writes a truthful negative ledger entry for the shortage (§11.67). Residual: pre-fix multi-variant orders cannot be attributed; clamp knowingly fulfils an oversold unit (F2 policy) | Fixed; residual P2 |
| A54 | Duplicate webhook | Event-key dedupe + `payment_status === 'PAID'` guard | handled |
| A55 | Captured amount ≠ recorded total | Refused, order left for a human. Correct fail-closed, but compounds F1/F14 because recorded totals can legitimately drift from the charged one | P1 |
| A56 | Chat payment link on the E3 path | Modal receives `sale.saleId` (a `sales` id) as the order ref; Razorpay notes carry it; webhook `sales_orders.getOne` fails; `payment_links.order` relation points at the wrong collection | P1 |
| A57 | Refund / partial refund / chargeback | No webhook event handling and no channel credit-note path; ERP returns do not link to remote payment ids | P2 |
| A58 | Polling reconciler | Only settles `payment_links` rows with a resolvable `order`; cannot settle E2 drafts or E3 rows rejected by A35 | P1 |

**D. WhatsApp specifics**

| ID | Case / edge | Current behaviour | Severity |
|---|---|---|---|
| A59 | Multi-variant product added to chat cart | Cart stores product-level only; `createSaleFromChat` throws `VariantRequiredError`; the operator sees a failed order with no path to pick the size | **P0** for sized stock |
| A60 | Shipping address for a chat order | UI passes none; order is created with an empty address; only the CRM profile's stale address is used by E4 | P0 for fulfilment |
| A61 | Operator double-clicks "Create order" / retries after a timeout | No idempotency; duplicate `sales`, `sales_orders`, stock movements and aggregates | P1 |
| A62 | Chat order partially fails | `sales` + `sale_items` are written before `sales_orders`; a later failure leaves an orphan sale; a stock failure cancels the order header but leaves the sale `pending` | P1 |
| A63 | Price negotiated in chat | E3 trusts `base_price`/`total` from the operator; no DB re-price, and item totals may not sum to subtotal | P1 |
| A64 | Duplicate cart lines / quantity 0 / negative | E3 floors quantity at 1 but does not merge duplicate product lines; E4 accepts any parsed quantity | P2 |
| A65 | Voice note, location pin, live location, contact card | `whatsapp_messages.message_type` has no such values; order intent and shared address from those message types cannot be persisted | P2 |
| A66 | Payment screenshot / manual UPI reference | No capture surface and no field on the order; "paid" cannot be proven except by a human reading chat | P2 |
| A67 | Catalog order created while the customer already exists | E4 uses `findCustomerByPhone` and its own field set, bypassing the shared upsert/aggregate path; lead status is overwritten to `awaiting_payment` | P2 |
| A68 | User clicks "STOP" and later orders | Opt-out is honoured for broadcasts; the order path never checks `whatsapp_opt_out`/`whatsapp_opt_outs` before sending order/payment messages | P2 |

**E. Money, tax and identity edge cases**

| ID | Case / edge | Current behaviour | Severity |
|---|---|---|---|
| A69 | Inter-state web order | Route passes `buyerStateCode = sellerStateCode`; always CGST/SGST; IGST impossible on the web channel | **P1** statutory |
| A70 | Store GST settings missing/partial | `loadStoreTaxContext` falls back to `gstRegistered: false`; tax silently 0 | P1 |
| A71 | Coupon `MYCART49` / `FESTIVE10` below its minimum | Client displays a discount the server does not reproduce (MYCART49) or reproduces without the minimum-cart check (FESTIVE10 fallback); charged ≠ recorded → webhook refuses the payment (A55) | **P0** money |
| A72 | Client-supplied shipping/COD amount | Server only clamps 0–5000; a tampered client can underpay shipping; COD fee is not separable in reports | P1 |
| A73 | Product price changed between catalog render and submit | Server re-prices and records the new total, but Razorpay already charged the old one → mismatch → unsettled | P0 (same class as A71) |
| A74 | Quantity clamped 1–100 | Customer is charged for the displayed quantity but the order records the clamp | P2 |
| A75 | International / non-+91 number | Customer matching uses last-10 digits; an international number can collide with an Indian number and merge two people's CRM records | P2 |
| A76 | Phone recycled to a new person | Phone is the identity key; a new owner inherits the profile, aggregates and loyalty | P2 |
| A77 | Two concurrent first orders for the same new phone | `getFirstListItem` then `create`; no unique phone index → duplicate customers, aggregates split | P1 |
| A78 | Existing customer moves house | `upsertChannelCustomer` backfills blanks only; a stale non-empty CRM address is never updated by the new order | P2 |
| A79 | Order placed for a product in another tenant | Web route rejects (`route.ts:277-282`); E3/E4 rely on the tenant-scoped client (partial) | handled / P2 |

### 12.5 Failure-mode register

F1–F6 are the implementer's ranked modes (§11.65:B), retained with corrections. F7–F14 are added by this analysis. "Money" modes are the ones that produce a support incident per occurrence.

| ID | Mode | Trigger | Failure signature | Blast radius | Detection | Recovery | Fix direction |
|---|---|---|---|---|---|---|---|
| F1 | **Charged ≠ recorded** | price/coupon/qty drift during an open checkout; client-only coupons | Razorpay paid, webhook refuses / order draft, customer has a receipt | Money + trust | Razorpay settlement report vs `sales_orders` | manual refund or manual settle | Re-price server-side **before** creating the gateway obligation; pass the server total; block on drift |
| F2 | **No stock reservation on online checkout** | two buyers, last unit, both pay | Two confirmed orders, second clamped to 0 | Oversell | stock ledger negative attempts / clamp logs | cancel + refund later buyer | reservation primitive shared with flash-drops |
| F3 | ~~Chat orders bypass inventory~~ — **closed 2026-10-24** | — | — | — | — | — | kept for history; chat now deducts via `channel-stock` |
| F4 | **Settlement reconciliation gap** | webhook undelivered, secret unset, mapping unresolvable | Paid-but-draft; unclaimed revenue | Money | daily gateway-vs-ERP delta | reconciler sweep by gateway ref | one settlement service used by webhook + poller |
| F5 | **Direct-PB fallback** | API unreachable | client-trusted totals written as revenue, no customer/order/stock coherence | Money + stock | code review; rules | delete fallback | remove `storefront/src/lib/pocketbase.ts:222-258`; show retry |
| F6 | **Aggregates/loyalty never reverse** | return, cancel, COD refusal, failed online payment | lifetime value inflated; tier/campaign targeting wrong; COD points awarded before delivery | CRM trust | RFM outliers | compensating writes script | `applyPurchaseReversal` in cancel/return/payment-failure paths |
| **F7** | **Schema-rejected silent partial writes** | order lines (A33/A34), payment links (A35), sales mirror (A36/A37), stock ledger (A38/A53) | `create()` rejects; `.catch()` swallows; UI reports success; header exists, children do not | Data integrity across both channels | reconciliation: orders with zero items; sales missing; paid orders with no stock movement | backfill scripts; operator manual repair | stop swallowing; validate against a typed port; add an integrity report |
| **F8** | **Client/server auth contract broken** | storefront fetch omits bearer; OTP secret unset | Every web order 401/503; fallback path; no order | Whole web channel | 401 rate on the route | configure secret; send token; delete fallback | E2E test that a real checkout creates one order |
| **F9** | **Payment unreconcilable by construction** | no gateway order/receipt with local notes; link ref uses `sales` id | `payment.captured` cannot find the order; payment link can never settle it | Money | gateway-vs-order join returns nothing | manual matching by phone/amount | create gateway order with `notes.order_id` = `sales_orders` id; store payment id on the order |
| **F10** | ~~Webhook stock double-write~~ — **closed 2026-10-24 03:09** | any settled online order with item rows | no longer reachable: the webhook calls `channel-stock` in clamp mode with an explicit shortage ledger row (§11.67) | Stock | ledger matches decrements | stock-take only for pre-fix orders | keep the one stock path; review the clamp policy (it settles an oversold unit on purpose) |
| **F11** | **Place-of-supply collapse** | state optional / buyer=server-side seller state | IGST never charged on inter-state web sales; GSTR-1 place of supply wrong | Statutory | GST report review | credit notes/refile | capture buyer state code as required; derive place of supply; fail closed |
| **F12** | **Partial-write and compensation gaps** | chat E3 failure ordering (A62); web stock failure after header; customer created before validation | orphan `sales`, cancelled header with pending sale, failed order leaves customer/consent | Data hygiene | orphan query | cleanup jobs | write in dependency order with a single transaction-like compensation; validate before any write |
| **F13** | **Cross-tenant mutation race** | `ensureServerAuth` on shared client while another tenant's request runs | loyalty/aggregate written to wrong tenant (or wrong DB URL) | Isolation breach | tenant-code audit on written rows | audit + repair | use `createTenantClient` exclusively in request paths; no global auth mutation |
| **F14** | **Amount-equality brittleness** | client coupon/shipping/qty differences; paise rounding | exact-paise compare refuses legitimate payments | Money | webhook refusal logs | manual settle | compute the gateway amount and the stored total from one server-side function; tolerance zero but drift impossible |

### 12.6 Partial-write states and recovery playbook

These are the states an operator or on-call engineer will actually encounter. The point is that every one of them must be *detectable* from stored data; today most are not.

| # | State (observed surface) | How it arises | Data evidence today | Recovery |
|---|---|---|---|---|
| S1 | `sales_orders` row, no items | A33/A34, COD web or either chat path | items query returns empty; totals non-zero | Rebuild items from request evidence — none is stored; manual rebuild only. Fix the write path first. |
| S2 | Customer paid, no order | A41/A49/A73 | Razorpay payment with no matching order ref | Match by amount+timestamp+phone in gateway dashboard; refund or re-create; needs a sweep |
| S3 | `sales_orders.status='draft'`, no stock movement | A50/A51 | order with payment id only in notes; `payment_status` not PAID | gateway status poll → settle (F4) |
| S4 | E3 chat: sale + order + stock, no payment row | A35 | `payment_links` missing; `internal_notes` references order | manual UPI verification; fix enum and backfill |
| S5 | Header `cancelled`, `sales` still `pending` | stock race path (`route.ts:452-461`, `chat-sales.ts:212-215`) | sale status/order status disagree | cancel the sale and restore anything already applied; add a status-invariant report |
| S6 | Orphan `sale`/`sale_items` with no order | E3 failure after sale create | `sales.channel='whatsapp'` + no `sales_orders` join | link or delete; move creation after the durable parent |
| S7 | Unpaid online order counted in lifetime spend | aggregates at intake (`route.ts:484`) | `total_spent` ahead of settled orders | recompute aggregates from settled orders; move increment to settlement |
| S8 | COD delivered, still `UNPAID` | no COD settlement writer (D2) | payment_status UNPAID forever | add delivery-confirmation writer; reconciliation report |
| S9 | Cancelled/returned order, aggregates and points intact | F6 | no reversal rows | compensating script keyed by order id |
| S10 | Customer/consent created for a failed order | customer upsert precedes validation (`route.ts:225`) | customer with no order, recent `created` | acceptable if flagged; ensure consent is only recorded on a real submit |
| S11 | Duplicate customers for one phone | A77 | two customer ids, same last-10, split aggregates | merge tool + unique partial index (tenant, phone) |
| S12 | Stock decremented but order vanished | any crash between stock apply and order visibility | ledger reference id with no order | scan ledger references; restore via `restoreChannelStockForReference` |

### 12.7 Invariants the capture layer must satisfy (what tests would prove it)

These are the assertions that turn "it looks right" into a gate. Each maps to a test that can run without the UI; only the ones marked ✔ have any coverage today (pure helper tests), and none cover the database writes.

| ID | Invariant | Where it must hold | Test today |
|---|---|---|---|
| I-01 | `sales_orders` row exists ⇒ `sales_order_items` count ≥ 1 and sum(unit_price×qty) = subtotal | both channels | ✗ |
| I-02 | `total = subtotal − discount + shipping` and `total = taxable_value + tax_total` (tax-inclusive model) | both channels | partial (invoice math helper ✔) |
| I-03 | Charged gateway amount (paise) ≡ recorded total × 100, computed from one server function | web online | ✗ |
| I-04 | Payment `PAID` ⇒ item rows exist, stock applied exactly once (one ledger pair per line), aggregates bumped once | web | ✗ |
| I-05 | Duplicate submit with the same idempotency key returns the same order and writes zero new rows | web | ✗ |
| I-06 | Every written row's `account_email` equals the token tenant | both channels | ✗ |
| I-07 | `stock_level` delta for a variant equals the sum of ledger quantities for the reference | both channels | partial (`channel-stock` unit tests) |
| I-08 | Cancellation reverses stock and aggregates exactly once | both channels | ✗ (no caller) |
| I-09 | Line variant id belongs to the line product and is persisted on the item | both channels | ✗ |
| I-10 | `sales` mirror exists for every confirmed `sales_orders` with valid channel/payment enums | web + chat | ✗ |
| I-11 | `payment_links.order` points at a `sales_orders` id; a Razorpay payment can be resolved to exactly one order | chat/web | ✗ |
| I-12 | Consent status and opt-out are consistent across `customers.opt_in_marketing`, `customers.whatsapp_opt_out`, `whatsapp_opt_outs` at order time | both | ✗ |
| I-13 | Adding the same order twice across channels (same physical unit) cannot both confirm | cross-channel | partial (last-unit atomic decrement ✔) |
| I-14 | A failed/abandoned order leaves no header+children incoherence (see S1–S12) | both | ✗ |

### 12.8 Priority and sequencing

| Priority | Work | Modes closed | Owner |
|---|---|---|---|
| **P0** | Send the bearer token from the storefront; provision `CUSTOMER_SESSION_SECRET`; delete the direct-PB fallback | F8, F5 | implementer |
| **P0** | Persist `variant_id` on every item: carry the resolved variant into the web item write and add the storefront selector; stop swallowing item-create failures; integrity query for orders without items. Chat E3 now persists resolved variants; E4 does not. | F7, A33/A34/A59 | implementer |
| **P0** | Create the Razorpay order/receipt server-side with `notes.order_id`; verify payment server-side; store payment id and method on `sales_orders` (migration: `payment_method`, `channel`, `gateway_payment_id`, `razorpay_order_id`, `state_code`, `cod_fee`) | F9, A49/A50/A56 | implementer + migration |
| **P0** | One server-side money function used for both the gateway charge and the stored total (coupon rules, shipping, COD fee) | F1, F14, A71/A72/A73 | implementer |
| **P1** | ~~Route the webhook through `channel-stock`~~ — **closed 03:09/03:24 (§11.67–§11.68)**; residual: channel ledger rows still omit `account_email` | F10, A52/A53, A38 | implementer |
| **P1** | Move aggregates/loyalty to settlement; add reversal on cancel/return/failure | F6, A29, S7/S9 | implementer |
| **P1** | Required buyer state code + place-of-supply capture; IGST correctness; fail closed when store GST settings are absent | F11, A69/A70 | implementer + migration |
| **P1** | Idempotency for chat orders; write-order/compensation for E3/E4; unify E4 onto `upsertChannelCustomer`; fix the E4 item writes and payment-method field | F12, A61–A63/A67 | implementer |
| **P1** | Restrict request-path writes to `createTenantClient`; remove shared-client auth mutation from order paths | F13 | implementer |
| **P2** | Campaign attribution (relation row or text column), coupon usage ledger, COD settlement, shipments/AWB + expected date, consent ledger, message-type coverage for media/location, refund webhook, address validation and serviceability | F4 tail, A37/A57/A65/A66 | implementer |
| **P2** | Integrity report page: orders without items, paid-without-stock, stock-without-order, aggregates variance, duplicate phones | all | doc owner can specify; implementer builds |

### 12.9 Reply to the capture-layer implementer (pair protocol)

Channel: this section and `§11.65` are the two halves of one working thread inside this document. The implementer wrote the brief; this is the doc owner's reply and the integration. No other synchronisation file exists.

**Ownership.** `src/**` and `storefront/**` are the implementer's uncommitted work and stay theirs to commit. This document (`PROJECT_MASTER.md`, including §7.6, §12 and the delivery-log entries) is owned here. If a fix touches both, the implementer lands code and reports the verified behaviour; the doc owner updates the contract/status. I have not edited source files in this pass.

**P0 corrections to behaviour the brief claims is captured** — please pick these up in the current branch before calling the capture refactor done:

1. **The storefront client never sends the bearer token.** `submitStorefrontOrder` (`storefront/src/lib/pocketbase.ts:201-215`) posts only `Content-Type`; the token exists in `CustomerAuthContext` (`:55-61`). The route now 401s every real submit. Add `Authorization: Bearer ${token}` (token from context/localStorage) and delete the direct-PB fallback (`:222-258`), which is unsound even if rules ever permit it.
2. **`sales_order_items.variant` is a required live relation.** Both `route.ts:429-439` and `chat-sales.ts:190-200` omit it and swallow the rejection; E4 (`whatsapp-order-ingestion.ts:149-161`) writes `''`. Every channel order currently has zero lines. Persist the resolved variant (add per-line `variantId` to the payload type, cart model and UI selector), stop swallowing, and check `select count(*) from sales_order_items` against `sales_orders` as a gate.
3. **The chat payment trail is rejected by the schema.** `payment_links.provider` ∈ {razorpay,phonepe} and `status` ∈ {created,paid,partially_paid,expired,cancelled}; `chat-sales.ts:219-236` writes `manual_upi`/`pending`. Use `razorpay` + `created` once a real link exists, or add an enum migration for manual UPI; do not `catch` the ledger write.
4. **The `sales` mirror cannot be written.** The route writes `payment_method` values outside the `sales.payment_method` enum and a UTM string into the `sales.campaign` relation (`route.ts:465-481`); both are swallowed. Add a proper order→sale projection (map to `upi`/`cash`, set campaign only with a real campaign id) and assert mirror existence.
5. **The webhook cannot resolve a storefront payment.** No Razorpay order is created with local notes (`razorpay.ts:306-323` builds `notes.order_id` only when there is a ref, and checkout passes none), so `payment.captured` yields no `orderId`. The stock half is fixed (03:09): `razorpay-webhook-handler.ts:138-144` now uses `applyChannelStock` with clamp mode (§11.67). The unresolved half is the gateway→order mapping and the absent payment fields: create the gateway order server-side and store `gateway_payment_id` on the order.
6. **Checkout accepts coupons/totals the server will not reproduce.** `MYCART49` is client-only (`checkout/page.tsx:139-145`), the `FESTIVE10` fallback has no minimum (`route.ts:354-360`), and the client-sent `discountAmount` is ignored. Move the coupon rule into one server function that returns both the charge amount and the recorded total.

**Answers to your five asks (§11.65:D).**

1. *F2/F3 unified reservation:* yes — lift the flash-drop reserve/expire/release primitive into a shared service and use it at checkout for `razorpay_online`; `channel-stock`'s atomic decrement remains the last-unit guard. Do not add a second stock model.
2. *Delete the fallback:* yes, delete it in the same storefront commit; on API failure show a retry, not a client-trusted write.
3. *F1 re-price vs block:* re-price at gateway-obligation creation and pass the server total; if the price changed beyond a small tolerance, do not create the obligation — return the recomputed cart to the customer for confirmation. Never charge first and reconcile later.
4. *Ownership/commit:* your tree, your commit. Once it lands, tell me the commit hash and the applied/verified migration list; §12, §7.6 and the delivery log will be re-pointed to it (§11.64 practice: a worktree on NTFS verifies committed HEAD).
5. *Test gate:* keep `test-channel-orders.ts` green, but it is not the gate for this item. Add a database-level test (or a script that can run against a scratch PB data dir) for I-01, I-04, I-05 and I-09 — those four would have caught P0s 1–5.

**What I changed and did not change.** Added §12 (this section), §7.6 (defect register), corrected §3.5's "not yet run/absent" claims, updated §4.9–§4.10 status rows, §8.5 channel gaps, §10.1 freshness and Appendix C. Renamed the duplicate §11.65 heading (brief = §11.65, inventory = §11.66) and renumbered the implementer's appended stock entries to §11.67 (webhook) and §11.68 (POS), placed above this section; added §7.6 and the delivery-log entry §11.69. No source files were touched; the working-tree re-verification remains the implementer's to run.

### 12.10 Crosswalk to the 2026-10-24 gap report (A1–F7)

`docs/STOREFRONT_WHATSAPP_CRM_CAPTURE_GAPS_2026-10-24.md` remains the field-gap history. Its statuses moved as follows; where this table and that document disagree, this one reflects the 03:10 tree.

| Gap | Status after the capture refactor | Remaining evidence |
|---|---|---|
| A1 email | **Closed** for web (`route.ts:406`); open for WhatsApp | — |
| A2 state | **Partial** — captured on order/note but no state code; used as buyer state code | A69 |
| A3/A4 billing+GSTIN | Open | no checkout/WA surface |
| A5 chat address | **Partial** — service accepts it, UI never passes it; E4 only uses the stale profile | A60 |
| A6 enrichment | Open | no surface |
| B1 shipping | **Closed** (server-clamped client quote) | A40/A72 |
| B2 web tax | **Partial** — total computed; components not stored; inter-state wrong | A69 |
| B3 chat discount/method | Partial — method still hardcoded `upi`; no discount | A36 |
| B4 coupon usage | Open | A60 |
| C1 chat order record | **Closed** as a header; E3 line items persist after the 03:10 fix; E4 still writes none | A33/A34 |
| C2 shipments/AWB | Open | §12.3.5 |
| C3 expected delivery | Open | §12.3.5 |
| D1 chat payment link | **Attempted but rejected by schema** | A35 |
| D2 COD settlement | Open | S8 |
| D3 self-serve cancel | Open | — |
| E1 campaign | **Attempted but writes an invalid relation** | A37 |
| E2 consent | Partial — boolean only | A30/A51 |
| E3–E5 | Open | — |
| F1 aggregates | **Closed** at intake for both channels; not reversed and over-counts unpaid online | F6/S7 |
| F2 loyalty parity | **Closed** (COD/concierge at confirmation, online at webhook); no reversal | F6 |
| F3 chat linkage | Partial — text in notes only | A32 |
| F4 profile merge | **Closed** for blanks (`channel-orders.ts:80-101`); stale non-empty values not refreshed | A78 |
| F5 phone canonicalisation | **Closed** in the shared path; legacy OTP/E4 paths still differ | A53/A75 |
| F6 idempotency | **Closed** for web E1/E2; absent for chat | A61 |
| F7 variant pick | Partial — resolved for stock, not persisted or collectable from the UI | A33/A59 |

### 11.68 Cancellation closes the inventory lifecycle (2026-10-24)

`restoreChannelStockForReference()` had no caller: stock could be deducted by any channel but nothing put it back when an order was cancelled.

**Service**

- `restoreChannelStockForReference` now accepts an optional channel. When omitted it reverses **every** sale movement for the order reference (WhatsApp, storefront, POS), which is what an order-level cancellation needs; each reversal row inherits the movement's channel. Reversal stays idempotent: a second call sees the return rows and no-ops.
- `src/lib/orders.ts` gained:
  - `canCancelSalesOrder(status)` — draft/sent/confirmed only. Shipped, delivered and invoiced orders are reversed through returns/credit notes, not cancellation.
  - `cancelSalesOrder(orderId, { reason?, cancelledBy? })` — refuses ineligible statuses, restores stock from the ledger, then marks the order cancelled and appends a timestamped audit line to `internal_notes` (with the optional reason). Cancelling an already-cancelled order is a safe no-op.

**UI**

- The order detail page has a **Cancel Order / Cancel Estimate** button for eligible statuses, behind a confirm dialog; it reports how many stock lines were restored and refreshes the order. Refusals surface their reason as a toast.

**Verification**

| Check | Result |
|---|---|
| `npx tsx src/scripts/test-channel-stock.ts` | **17/17** (new: channel-less restore reverses storefront and WhatsApp movements for one order) |
| `npm run typecheck` | exit 0 |
| `npm test` | all suites pass |
| ESLint on the changed files | 0 errors (17 existing warnings in the touched UI/service files) |

**Remaining, stated honestly**

- Only sales orders can be cancelled this way. POS sales are immediate `sales` records with no cancellation flow, and invoiced orders intentionally require a return/credit note.
- The order list has no row-level cancel shortcut; cancellation lives on the detail page.
- The storefront/chat-sales integration remains uncommitted with the parallel agent's change set (§11.65-11.67).

## Appendix A: Route inventory

45 route pages, all client components.

| Route | Purpose | Size |
|---|---|---|
| `/` | Executive dashboard | 5 KB |
| `/activity` | Audit timeline | 12 KB |
| `/backup` | Backup, restore and snapshots | 13 KB |
| `/banking` | Accounts and balances | 14 KB |
| `/banking/transactions` | Transaction ledger | 17 KB |
| `/challan` | Delivery challans | 12 KB |
| `/cheques` | Cheque and PDC register | 15 KB |
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
| `/imitation` | Fashion jewellery taxonomy and tiers | 15 KB |
| `/manufacturing` | Karigar job cards and metal-loss costing | 14 KB |
| `/login` | Authentication | 7 KB |
| `/orders` | Sales orders | 24 KB |
| `/orders/create` | Order authoring | 33 KB |
| `/orders/detail` | Order detail and invoicing | 18 KB |
| `/pos` | Point of sale terminal | 126 KB |
| `/purchase` | Purchase orders | 14 KB |
| `/purchase/create` | PO authoring | 60 KB |
| `/purchase/detail` | PO and GRN receiving | 69 KB |
| `/reports` | Reports hub | 5 KB |
| `/reports/export` | Export invoice with LUT and FX | 18 KB |
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

100 modules in `src/lib`, grouped by responsibility. Modules marked *orphan* have no importer outside their own tests or no importer at all.

**Database and platform**: `pocketbase.ts`, `tenant-db-manager.ts`, `concurrency.ts`, `sequence-generator.ts`, `settings.ts`, `backup.ts`, `activity.ts`, `offline-queue.ts`

**Catalog**: `products.ts`, `categories.ts`, `attributes.ts`, `sku-generator.ts`, `barcode-generator.ts`, `excel-import.ts`, `image-matcher.ts`, `catalog-sync.ts`, `meta-catalog-batch.ts`

**Sales**: `pos-sales.ts`, `invoice.ts`, `orders.ts`, `order-milestones.ts`, `returns.ts`, `challan.ts`, `discounts.ts`, `register.ts`, `payment-reconciliation.ts`

**Channel order capture**: `channel-orders.ts`, `channel-stock.ts` (remote-channel capture helpers and the one stock path; §12)

**Procurement**: `purchase.ts`, `vendors.ts`, `discrepancies.ts`

**Finance**: `banking.ts`, `expenses.ts`, `gst.ts`, `gstr1-engine.ts`, `eway-bill.ts`, `cheque-engine.ts`, `razorpay.ts`, `razorpay-webhook-handler.ts`, `phonepe.ts`

**Customers**: `customers.ts`, `customer-lookup.ts`, `customer-token.ts`, `loyalty.ts`, `crm-rfm.ts`, `crm-lifecycle-triggers.ts`, `campaign-attribution.ts`, `otp-store.ts`, `storefront.ts`

**Jewelry domain**: `jewelry-engine.ts`, `imitation-jewelry-engine.ts`, `manufacturing-engine.ts`, `omnichannel-buffer-engine.ts`, `returns-qc-engine.ts`, `cross-border-engine.ts`, `channel-pricing.ts`, `multi-location.ts`, `logistics-engine.ts`

**WhatsApp**: `whatsapp.ts`, `whatsapp-crm.ts`, `whatsapp-broadcast.ts`, `whatsapp-catalog.ts`, `whatsapp-commander.ts`, `whatsapp-event-sync.ts`, `whatsapp-flash-drops.ts`, `whatsapp-notifications.ts`, `whatsapp-order-ingestion.ts`, `whatsapp-binding.ts`, `mobile-whatsapp.ts`

**Mobile**: `mobile-scanner.ts`, `mobile-printer.ts`, `sound-effects.ts`

**Reporting**: `analytics.ts`, `reports.ts`, `sync-engine.ts`, `utils.ts`, `csv.ts`

**Modules with zero importers outside their own test scripts**: `omnichannel-buffer-engine.ts`, `sync-engine.ts`, `whatsapp-commander.ts`. These are the gap between "code exists" and "the product does it": 3 modules, all in sync, omnichannel buffering and chat commands.

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
