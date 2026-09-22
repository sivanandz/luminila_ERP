# Luminila Inventory Management — State of the Project

This document provides an objective, transparent status report on the Luminila Inventory Management System, tracking completed features, module maturity, known architectural and logic defects, technical debt, and immediate roadmap priorities.

---

## 1. Executive Status

- **Project Version:** `0.1.0` (Active Local Development)
- **Primary Backend:** PocketBase Server v0.25.0 (Embedded Go SQLite in WAL mode; JS SDK v0.26.5)
- **Frontend Stack:** Next.js 16.1.0 (App Router) + React 19.2.3 + Tailwind CSS v4
- **Desktop & Mobile Runtime:** Tauri v2.9.x (Windows, macOS, Linux, Android) & Standalone PWA
- **Last Comprehensive Architecture & Logic Audit:** March 2026 (Android Emulator & Codebase Audit Verified: September 2026)

The project has successfully transitioned from an initial cloud-hosted prototype (Supabase) to a local-first, privacy-respecting embedded architecture powered by PocketBase and Tauri. The UI layer and feature surfaces are complete across retail POS, inventory, procurement, invoicing, and responsive Android/tablet layouts, with dual-tier internet synchronization (Cloudflare Tunnel + Google Drive changelog sync) and offline mutation queues active.

---

## 2. Module Maturity Matrix

The matrix below details the current implementation status and operational readiness of each application module:

| Module | Status | Maturity | Notes / Current State |
|---|---|---|---|
| **Point of Sale (POS)** | ✅ Implemented | 🟢 Production Ready | Single-tender retail cart flows (Cash with change calculator, Card, UPI, PhonePe QR). Camera scanner and elevated mobile POS FAB verified live on Android 16 emulator. Split-tender scheduled for future milestone. |
| **Register / Shifts** | ✅ Implemented | 🟢 Production Ready | Open/close shifts and drawer tracking working; reconciliation opening float double-count fixed. |
| **Catalog & Inventory** | ✅ Implemented | 🟢 Production Ready | Full CRUD, variant matrix (size/color/material), stock level triggers, and low stock warnings. |
| **Barcode Labels** | ✅ Implemented | 🟢 Production Ready | Code128 generation via `jsbarcode`, customizable dimensions, batch sheet printing for jewelry tags. |
| **GST Invoicing** | ✅ Implemented | 🟢 Production Ready | B2B & B2C tax invoices, CGST/SGST/IGST breakdown, number sequencing, PDF printing. |
| **Sales Orders & Estimates** | ✅ Implemented | 🟢 Production Ready | Order creation and quotes complete; invoice generation now persists full invoice and line items. |
| **Delivery Challans** | ✅ Implemented | 🟢 Production Ready | Job work, stock transfer, exhibition tracking, delivery dates, and E-Way bill data prep. |
| **Returns & Credit Notes** | ✅ Implemented | 🟢 Production Ready | Credit notes generation complete; automated inventory restock and stock movements verified on approval. |
| **Procurement (PO & GRN)** | ✅ Implemented | 🟢 Production Ready | PO creation and GRN receiving complete; over-receipt bounded against ordered quantities. |
| **Customer CRM & Loyalty** | ✅ Implemented | 🟢 Production Ready | Customer directory, ledger, tiered point accrual, and redemption calculation working. |
| **Vendor Management** | ✅ Implemented | 🟢 Production Ready | Vendor database, SKU mapping, lead times, and purchase history. |
| **Banking Ledger** | ✅ Implemented | 🟢 Production Ready | Bank account management, overdraft balance validation, and transactional rollback protection active. |
| **Expense Management** | ✅ Implemented | 🟢 Production Ready | Categorized expense entries, payment modes, and voucher tracking. |
| **Reports & Analytics** | ✅ Implemented | 🟢 Production Ready | Dashboard KPIs, revenue trends, inventory valuation, and tax summaries. |
| **RBAC & Auth** | ✅ Implemented | 🟢 Production Ready | PocketBase JWT auth, 5 seeded roles (`Admin`, `Manager`, `Staff`, `Cashier`, `Viewer`). Fast PIN/QR cashier switching scheduled in Milestone 3 roadmap. |
| **Mobile & Android Support** | ✅ Implemented | 🟢 Production Ready | Verified live on Android 16 emulator (`1080x2400`). Thumb navigation (`MobileBottomNav`), slide-over drawer (`MobileDrawer` with 17 modules), `useViewport` detection, dynamic server switching (`ServerConfigModal`), Cloudflare Tunnel (`npm run tunnel`), offline queue (`offline-queue.ts`), mobile thermal printing (`mobile-printer.ts`), and camera scanner. |
| **Internet Sync & Backup** | ✅ Implemented | 🟢 Production Ready | Dual-tier sync active: Tier 1 real-time Cloudflare Tunnel (`scripts/tunnel.js`) + Tier 2 decentralized Google Drive atomic changelog sync scaffold & offline mutation queue (`google-drive-sync.ts`, `GoogleDriveSyncModal.tsx`). |
| **WhatsApp Automation** | 🚧 Beta | 🟡 In Progress | WPPConnect sidecar server runs locally on desktop; mobile automatically falls back to native Android `whatsapp://send` intent. |
| **E-Commerce Sync** | 🚧 Partial | 🟠 Planned | Shopify & WooCommerce sync clients designed; background webhook listener under testing. |

---

## 3. Database & Migration Status

### PocketBase Migration (Completed)
- **Migration Origin:** Deprecated Supabase PostgreSQL cloud instances in favor of local-first PocketBase.
- **Active Collections:** 38 collections fully declared and operational in `pocketbase/pb_data/data.db`.
- **Initialization Tooling:** Schema definitions and rules managed by `src/scripts/init-pocketbase.ts` and `src/scripts/sync-pb-schema.ts`.
- **Concurrency Mode:** SQLite configured in `WAL` (Write-Ahead Logging) mode to allow concurrent reads and writes between Next.js, Android, and Tauri.
- **Dynamic Connectivity:** `src/lib/pocketbase.ts` supports runtime URL overrides (`PB_CUSTOM_URL`), allowing showroom Android devices on Wi-Fi or cellular networks to connect to the database via LAN IP (`http://192.168.x.x:8090`) or HTTPS tunnels (`https://*.trycloudflare.com`).

---

## 4. Known Defects & Logic Audit Register
 
The following issues were identified during formal code logic audits (see [APP_LOGIC_AUDIT_REPORT_2026-03-07.md](file:///e:/Local_GIT_2/luminila_inv_mgmt/APP_LOGIC_AUDIT_REPORT_2026-03-07.md)) and have been resolved:

### Defect 1: Shift Opening Balance Double-Counted in Reconciliation
- **Severity:** P1 (✅ RESOLVED)
- **File:** [`src/lib/register.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/register.ts#L85-L115)
- **Resolution:** Replaced initial `addCashToDrawer` call in `openShift` with direct audit recording (`operation_type: 'opening_float'`), keeping `cash_added` at 0 so `opening_balance` is counted strictly once during closing reconciliation.

### Defect 2: Non-Atomic POS Sales Write Lifecycle
- **Severity:** P1 (✅ RESOLVED)
- **File:** [`src/lib/pos-sales.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/pos-sales.ts#L63-L160)
- **Resolution:** Implemented compensating rollback handler tracking created sale items, stock movements, and inventory deductions. In case of downstream failures, the handler restores stock levels and purges partial records.

### Defect 3: Sales Order "Generate Invoice" Missing Invoice Persistence
- **Severity:** P1 (✅ RESOLVED)
- **File:** [`src/lib/orders.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/orders.ts#L145-L215)
- **Resolution:** Wired `createInvoice` and `getStoreSettings` into `generateInvoiceFromOrder`, transforming order items into GST invoice items and saving records in `invoices` and `invoice_items` before updating order status.

### Defect 4: Return Processing Missing Stock Restoration
- **Severity:** P1 (✅ RESOLVED)
- **File:** [`src/lib/returns.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/returns.ts#L265-L305)
- **Resolution:** Added automated inventory restock loop inside `approveCreditNote`, incrementing variant `stock_level` and logging restorative entries in `stock_movements`.

### Defect 5: Goods Received Note (GRN) Unbounded Over-Receipt
- **Severity:** P1 (✅ RESOLVED)
- **File:** [`src/lib/purchase.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/purchase.ts#L400-L435)
- **Resolution:** Implemented invariant boundary checks in `createGRN` verifying `quantity_received <= quantity_ordered - already_received`, clamping and warning against over-receipt.

### Defect 6: Banking Ledger Negative Overdraft & Split Write
- **Severity:** P1 (✅ RESOLVED)
- **File:** [`src/lib/banking.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/banking.ts#L141-L180)
- **Resolution:** Added balance pre-flight validation preventing withdrawals/transfers exceeding current funds, combined with rollback deletion of created transactions if balance mutation fails.

---

## 5. Technical Debt & Platform Considerations

1. **Documentation Purge (Completed)**:
   - All obsolete Supabase and PostgreSQL references across `docs/` have been removed and replaced with PocketBase v0.26.5 and Tauri v2 Android specifications.
2. **Tauri CSP Cleanup (Completed)**:
   - `src-tauri/tauri.conf.json` Content Security Policy cleaned up to standard protocol origins (`http: https: ws: wss:`), removing legacy third-party cloud domain whitelists.
3. **PWA Standalone App Support (Completed)**:
   - Added `public/manifest.json` and `appleWebApp` meta tags in `src/app/layout.tsx`. On Android tablets and smartphones, users can tap "Add to Home Screen" to install Luminila as a dedicated standalone app with zero browser address bar, persistent storage, and full camera/printer integration.
4. **Script Organization**:
   - Operational launch scripts are centralized in `scripts/`, while PocketBase migration/maintenance scripts reside in `src/scripts/`.
5. **Filesystem Architecture & Android Build Targets**:
   - The primary development drive `E:\` is formatted as `exFAT`. Windows does not support filesystem symbolic links on exFAT drives (`os error 1`), which causes Tauri's automated CLI to abort when symlinking `libapp_lib.so` to `jniLibs/x86_64/libapp_lib.so`.
   - **Recommended Android Distribution**:
     - *Immediate Showroom Deployment*: Install Luminila as a Progressive Web App (PWA) on showroom Android tablets and phones via Chrome (`http://<LAN-IP>:3000` or `https://<tunnel>.trycloudflare.com`). Provides a standalone immersive window, persistent storage, and full camera/hardware print integration with zero browser chrome.
     - *Native Standalone APK Compilation*: When compiling the release `.apk` binary via Tauri/Gradle, run the build on an NTFS partition (e.g. `C:\`), where Windows symbolic links and cross-drive root paths are supported by the Android Gradle Plugin.

---

## 6. Development & Release Roadmap

### Milestone 1: Mobile & Android Feature Parity (Completed)
- [x] Responsive navigation with `MobileBottomNav` and elevated POS FAB.
- [x] Full slide-over drawer (`MobileDrawer`) organizing all 18 modules.
- [x] Viewport detection hook (`useViewport`) detecting mobile/tablet/desktop/Android.
- [x] Dynamic runtime PocketBase URL switching with health check & latency measurement (`ServerConfigModal.tsx`).
- [x] Camera barcode scanning support on mobile via `html5-qrcode`.
- [x] Dual-tier internet sync: Cloudflare Tunnel helper (`npm run tunnel`) and decentralized Google Drive mutation queue (`GoogleDriveSyncModal.tsx`).
- [x] Offline transaction queue (`offline-queue.ts`) with automatic replay on reconnect.
- [x] Android native print spooler (`mobile-printer.ts`) and WhatsApp intent fallback (`mobile-whatsapp.ts`).
- [x] Live Android 16 emulator test on 1080x2400 screen verified (POS, drawer, presets, connection ping).
- [x] Standalone PWA installation manifest (`public/manifest.json`) and mobile fullscreen meta.
- [x] Android Studio / Gradle project generated in `src-tauri/gen/android` with Gradle 8.14.3.

### Milestone 2: Transactional Stability (Completed)
- [x] Implement compensating rollback in `pos-sales.ts`.
- [x] Fix shift opening balance reconciliation in `register.ts`.
- [x] Connect order invoice generation in `orders.ts`.
- [x] Implement inventory restoration in `returns.ts`.
- [x] Add GRN over-receipt guard in `purchase.ts`.
- [x] Add overdraft protection in `banking.ts`.

### Milestone 3: WhatsApp & Sidecar Hardening (Current Focus)
- [ ] Automated headless Chromium download validation for WPPConnect.
- [ ] Robust QR re-connection and session caching.
- [ ] Inbound WhatsApp order template parsing.

### Milestone 4: Multi-Channel Synchronization
- [ ] Bi-directional Shopify inventory sync via GraphQL webhooks.
- [ ] WooCommerce REST API order import polling.
- [ ] Offline-first reconciliation queue for desktop client disconnection.

