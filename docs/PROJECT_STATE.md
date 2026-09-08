# Luminila Inventory Management — State of the Project

This document provides an objective, transparent status report on the Luminila Inventory Management System, tracking completed features, module maturity, known architectural and logic defects, technical debt, and immediate roadmap priorities.

---

## 1. Executive Status

- **Project Version:** `0.1.0` (Active Local Development)
- **Primary Backend:** PocketBase v0.26.5 (Local embedded SQLite in WAL mode)
- **Frontend Stack:** Next.js 16.1.0 (App Router) + React 19.2.3 + Tailwind CSS v4
- **Desktop Runtime:** Tauri v2.9.x
- **Last Comprehensive Logic Audit:** March 7, 2026

The project has successfully transitioned from an initial cloud-hosted prototype (Supabase) to a local-first, privacy-respecting embedded architecture powered by PocketBase and Tauri. The UI layer and feature surfaces are broadly complete across retail POS, inventory, procurement, and invoicing, but transactional hardening and compensation logic are required in several domain services.

---

## 2. Module Maturity Matrix

The matrix below details the current implementation status and operational readiness of each application module:

| Module | Status | Maturity | Notes / Current State |
|---|---|---|---|
| **Point of Sale (POS)** | ✅ Implemented | 🟡 Needs Hardening | Touch and barcode cart flows are functional. Requires atomic multi-step write rollback. |
| **Register / Shifts** | ✅ Implemented | 🟡 Needs Hardening | Open/close shifts and drawer tracking working; reconciliation formula requires float fix. |
| **Catalog & Inventory** | ✅ Implemented | 🟢 Production Ready | Full CRUD, variant matrix (size/color/material), stock level triggers, and low stock warnings. |
| **Barcode Labels** | ✅ Implemented | 🟢 Production Ready | Code128 generation via `jsbarcode`, customizable dimensions, batch sheet printing. |
| **GST Invoicing** | ✅ Implemented | 🟢 Production Ready | B2B & B2C tax invoices, CGST/SGST/IGST breakdown, number sequencing, PDF printing. |
| **Sales Orders & Estimates** | ✅ Implemented | 🟡 Needs Hardening | Order creation and quotes complete; invoice generation workflow requires record creation link. |
| **Delivery Challans** | ✅ Implemented | 🟢 Production Ready | Job work, stock transfer, exhibition tracking, delivery dates, and E-Way bill data prep. |
| **Returns & Credit Notes** | ✅ Implemented | 🟡 Needs Hardening | Credit notes generation complete; automated stock restoration hook requires verification. |
| **Procurement (PO & GRN)** | ✅ Implemented | 🟡 Needs Hardening | PO creation and GRN receiving complete; over-receipt validation guard needs enforcement. |
| **Customer CRM & Loyalty** | ✅ Implemented | 🟢 Production Ready | Customer directory, ledger, tiered point accrual, and redemption calculation working. |
| **Vendor Management** | ✅ Implemented | 🟢 Production Ready | Vendor database, SKU mapping, lead times, and purchase history. |
| **Banking Ledger** | ✅ Implemented | 🟡 Needs Hardening | Bank account management and transaction tracking functional; balance checks need server-side atomicity. |
| **Expense Management** | ✅ Implemented | 🟢 Production Ready | Categorized expense entries, payment modes, and voucher tracking. |
| **Reports & Analytics** | ✅ Implemented | 🟢 Production Ready | Dashboard KPIs, revenue trends, inventory valuation, and tax summaries. |
| **RBAC & Auth** | ✅ Implemented | 🟢 Production Ready | PocketBase JWT auth, role capabilities, PIN/QR cashier switching. |
| **WhatsApp Automation** | 🚧 Beta | 🟡 In Progress | WPPConnect sidecar server runs locally; QR pairing and order message parsing in active refinement. |
| **E-Commerce Sync** | 🚧 Partial | 🟠 Planned | Shopify & WooCommerce sync clients designed; background webhook listener under testing. |

---

## 3. Database & Migration Status

### PocketBase Migration (Completed)
- **Migration Origin:** Deprecated Supabase PostgreSQL cloud instances in favor of local-first PocketBase.
- **Active Collections:** 38 collections fully declared and operational in `pocketbase/pb_data`.
- **Initialization Tooling:** Schema definitions and rules managed by `src/scripts/init-pocketbase.ts` and `src/scripts/sync-pb-schema.ts`.
- **Concurrency Mode:** SQLite configured in `WAL` (Write-Ahead Logging) mode to allow concurrent reads and writes between Next.js and Tauri.

---

## 4. Known Defects & Logic Audit Register

The following issues were identified during formal code logic audits (see [APP_LOGIC_AUDIT_REPORT_2026-03-07.md](file:///e:/Local_GIT_2/luminila_inv_mgmt/APP_LOGIC_AUDIT_REPORT_2026-03-07.md)) and are cataloged here for ongoing resolution:

### Defect 1: Shift Opening Balance Double-Counted in Reconciliation
- **Severity:** P1
- **File:** [`src/lib/register.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/register.ts#L103-L174)
- **Description:** When a cashier opens a shift with an initial float, `addCashToDrawer` is called immediately, which increments `cash_added`. During closing reconciliation, the calculation adds both `opening_balance` and `cash_added`, overstating the expected balance by the opening float amount.
- **Resolution Plan:** Ensure opening float is counted only once in the expected balance calculation.

### Defect 2: Non-Atomic POS Sales Write Lifecycle
- **Severity:** P1
- **File:** [`src/lib/pos-sales.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/pos-sales.ts#L68-L145)
- **Description:** A POS checkout sequentially creates the sale, creates sale items, updates inventory levels, logs stock movements, and generates invoices. If an error occurs in the final steps, earlier records remain committed without rollback or compensation.
- **Resolution Plan:** Wrap POS commit in a server-side transactional routine or add compensating rollback hooks with client-side idempotency keys.

### Defect 3: Sales Order "Generate Invoice" Missing Invoice Persistence
- **Severity:** P1
- **File:** [`src/lib/orders.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/orders.ts#L148-L155)
- **Description:** Converting a sales order to an invoice marks the sales order status as `invoiced`, but does not create the corresponding record in the `invoices` collection.
- **Resolution Plan:** Call `createInvoiceFromOrder` inside `src/lib/orders.ts` to persist invoice and invoice items prior to updating the order status.

### Defect 4: Return Processing Missing Stock Restoration
- **Severity:** P1
- **File:** [`src/lib/returns.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/returns.ts#L267-L281)
- **Description:** Approving or refunding a customer return marks the credit note as approved, but does not increment `stock_level` on the associated `product_variants` or generate a restorative `stock_movements` record.
- **Resolution Plan:** Add an automated inventory restock execution step when a credit note is marked `approved` or `refunded`.

### Defect 5: Goods Received Note (GRN) Unbounded Over-Receipt
- **Severity:** P1
- **File:** [`src/lib/purchase.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/purchase.ts#L404-L442)
- **Description:** GRN receiving increments received quantities on purchase orders without checking whether `quantity_received > quantity_ordered`.
- **Resolution Plan:** Add invariant validation: `quantity_received <= quantity_ordered - existing_received`, unless explicit over-delivery is authorized.

### Defect 6: Banking Ledger Negative Overdraft & Split Write
- **Severity:** P1
- **File:** [`src/lib/banking.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/banking.ts#L145-L169)
- **Description:** Transactions are saved before updating account balances. If balance mutation fails, the transaction persists. Furthermore, withdrawals do not validate sufficient funds, allowing silent overdrafts.
- **Resolution Plan:** Add insufficient balance checks before debit execution and transactional rollbacks.

---

## 5. Technical Debt & Cleanup

1. **Residual Supabase Keys**:
   - `.env.local` contains obsolete Supabase credentials. These should be removed to avoid confusion.
2. **Tauri CSP Cleanup**:
   - `src-tauri/tauri.conf.json` still whitelists `*.supabase.co` domains in its `connect-src` CSP header. This should be trimmed to local loopback endpoints.
3. **Redundant Dependencies**:
   - `package.json` includes both `exceljs` and historical Excel utilities. Unification on `exceljs` is underway.
4. **Script Organization**:
   - Utility scripts are currently split between `scripts/` and `src/scripts/`. Operational maintenance scripts should be organized uniformly.

---

## 6. Development & Release Roadmap

### Milestone 1: Transactional Stability (Current Focus)
- [ ] Implement compensating rollback in `pos-sales.ts`.
- [ ] Fix shift opening balance reconciliation in `register.ts`.
- [ ] Connect order invoice generation in `orders.ts`.
- [ ] Implement inventory restoration in `returns.ts`.

### Milestone 2: WhatsApp & Sidecar Hardening
- [ ] Automated headless Chromium download validation for WPPConnect.
- [ ] Robust QR re-connection and session caching.
- [ ] Inbound WhatsApp order template parsing.

### Milestone 3: Multi-Channel Synchronization
- [ ] Bi-directional Shopify inventory sync via GraphQL webhooks.
- [ ] WooCommerce REST API order import polling.
- [ ] Offline-first reconciliation queue for desktop client disconnection.
