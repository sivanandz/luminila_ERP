# Luminila Inventory Management — Codebase Architecture & Agent Guide

> **AI Agent Context File**: Read this file first when navigating, developing, building, or refactoring in this repository.

---

## 1. Project Overview & Quick Reference

Luminila is a fashion jewelry ERP and Point of Sale (POS) application designed to run as a native desktop application (Windows/macOS/Linux via Tauri v2), a mobile app (Android via Tauri v2 or PWA), or a web application (Next.js 16 + React 19). It connects to an embedded local database (PocketBase v0.25.0 server running SQLite in WAL mode, with JS client SDK ^0.26.5) and a WhatsApp Web automation sidecar (Node.js WPPConnect).

### Quick Build & Run Commands

```bash
# Install all dependencies (Frontend + Sidecar)
npm install
cd wppconnect-sidecar && npm install && cd ..

# Run all services concurrently (PocketBase :8090, WPPConnect :21465, Next.js :3000)
npm run dev
# or:
npm run dev:all

# Run Cloudflare Tunnel (expose PocketBase for remote Android devices)
npm run tunnel

# Run individual services
npm run dev:frontend   # Next.js (port 3000)
npm run dev:pb         # PocketBase (port 8090)
npm run dev:sidecar    # WPPConnect Sidecar (port 21465)

# Run Native Desktop Dev (Tauri v2)
npm run tauri:dev

# Run Native Android Dev (Tauri v2)
npx tauri android dev

# Compile Production Desktop App (Tauri Installer)
npm run build          # Static export to out/
cd wppconnect-sidecar && npm run build && cd .. # Compile sidecar binary
npm run tauri:build    # Build Windows MSI / Executable

# Compile Production Android APK
npx tauri android build --apk

# Database & Schema Management
npx tsx src/scripts/init-pocketbase.ts       # Initialize all 38 core collections
npx tsx src/scripts/update-whatsapp-crm-schema.ts # Add the 4 WhatsApp CRM collections (42 total)
npx tsx src/scripts/sync-pb-schema.ts        # Sync schema modifications
npx tsx src/scripts/apply-pb-access-rules.ts # Set collection security rules
npx tsx src/scripts/seed-roles.ts            # Seed RBAC roles & capabilities
npx tsx src/scripts/create-admin-user.ts     # Seed initial admin user
```

---

## 2. Technology Stack

| Layer | Framework / Library | Version | Configuration / Location |
|---|---|---|---|
| **Shell Container** | Tauri v2 (Rust) | `^2.9.1` | `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` |
| **Frontend Framework** | Next.js App Router | `16.1.0` | `next.config.ts` (`output: 'export'` in prod) |
| **UI Runtime** | React | `19.2.3` | React Compiler enabled (`babel-plugin-react-compiler`) |
| **Styling** | Tailwind CSS v4 | `^4.0.0` | `src/app/globals.css`, `@tailwindcss/postcss` |
| **UI Primitives** | `@base-ui/react`, Shadcn UI | `1.0.0`, `3.6.2` | `src/components/ui/` |
| **Icons** | Lucide React | `^0.562.0` | `lucide-react` |
| **Database Engine** | PocketBase (Go SQLite) | `0.25.0 (Server)` | `pocketbase/pocketbase.exe`, `pb_data/data.db` |
| **Client Database SDK** | PocketBase JS SDK | `^0.26.5` | `src/lib/pocketbase.ts` |
| **WhatsApp Sidecar** | Express + WPPConnect | `2.3.3` | `wppconnect-sidecar/server.js` |
| **Barcodes** | JSBarcode, HTML5-QRCode | `3.12.1`, `2.3.8` | Code128 generation & camera scanner |
| **Spreadsheets** | ExcelJS, JSZip | `4.4.0`, `3.10.1` | Bulk catalog import/export |

---

## 3. Directory Layout & Module Map

```
luminila_inv_mgmt/
├── src/
│   ├── app/                      # Next.js Pages (Routes)
│   │   ├── layout.tsx            # Global HTML wrap, fonts, MobileBottomNav, Sidebar
│   │   ├── page.tsx              # Executive KPI dashboard
│   │   ├── pos/                  # Point of Sale touch terminal & cart
│   │   ├── inventory/            # Product catalog & variant matrix
│   │   ├── invoices/             # GST B2B/B2C tax invoices & PDF printing
│   │   ├── orders/               # Sales orders & quotation estimates
│   │   ├── purchase/             # Purchase orders & Goods Received Notes (GRN)
│   │   ├── challan/              # Delivery challans & transport documentation
│   │   ├── returns/              # Returns & GST credit notes
│   │   ├── labels/               # Barcode label batch printer (Code128)
│   │   ├── customers/            # Customer CRM & loyalty accounts
│   │   ├── vendors/              # Supplier management
│   │   ├── banking/              # Bank accounts & double-entry ledger
│   │   ├── expenses/             # Expense vouchers & accounting taxonomy
│   │   ├── reports/              # Financial, tax, and sales analytics
│   │   ├── activity/             # System audit & mutation timeline
│   │   ├── users/                # Staff accounts & RBAC assignment
│   │   ├── settings/             # Store configuration, tax rates, sync
│   │   ├── setup/                # First-run admin initialization wizard
│   │   └── login/                # Authentication
│   ├── components/
│   │   ├── auth/                 # ProtectedRoute.tsx
│   │   ├── layout/               # Sidebar.tsx, Header.tsx, MobileBottomNav.tsx, MobileDrawer.tsx
│   │   ├── pos/                  # POSWhatsAppWidget.tsx (checkout WhatsApp receipt & payment links)
│   │   ├── whatsapp/             # MessageActionMenu.tsx, VendorIngestionModal.tsx, WhatsAppDrawer.tsx,
│   │   │                         #   BroadcastComposerModal.tsx, ChatContextMenu.tsx, SlashCommandPalette.tsx,
│   │   │                         #   RazorpayPaymentModal.tsx
│   │   ├── settings/             # ServerConfigModal, GoogleDriveSyncModal
│   │   ├── dashboard/            # KPI cards, charts, alerts
│   │   └── ui/                   # Button, Dialog, Input, Table, Card, etc.
│   ├── contexts/
│   │   └── AuthContext.tsx       # PocketBase auth state, user role, session persistence
│   ├── hooks/
│   │   ├── use-viewport.ts       # isMobile, isTablet, isDesktop, isTauri, isAndroid
│   │   ├── use-long-press.ts     # 500ms long-press gesture (10px tolerance, 40ms haptics)
│   │   └── usePermissions.ts     # RBAC capability flags hook
│   ├── lib/                      # Business Logic & Database Services
│   │   ├── pocketbase.ts         # PocketBase singleton, getPocketBaseUrl, setPocketBaseUrl, checkServerStatus
│   │   ├── pos-sales.ts          # POS checkout & inventory decrement
│   │   ├── register.ts           # Cash drawer shifts & closing variance
│   │   ├── products.ts           # Product CRUD & variant matrix helpers
│   │   ├── invoice.ts            # Tax invoice generation & sequence numbers
│   │   ├── gst.ts                # CGST, SGST, IGST calculations
│   │   ├── eway-bill.ts          # NIC E-Way Bill JSON generation
│   │   ├── purchase.ts           # Purchase orders & GRN receiving
│   │   ├── returns.ts            # Credit notes & stock restoration
│   │   ├── challan.ts            # Delivery challan lifecycle
│   │   ├── customers.ts          # Customer CRM history
│   │   ├── loyalty.ts            # Point accrual & tier calculations
│   │   ├── banking.ts            # Double-entry banking transactions
│   │   ├── expenses.ts           # Expense vouchers
│   │   ├── rbac.ts               # Role permissions & capability flags
│   │   ├── barcode-generator.ts  # Code128 vector barcode generation
│   │   ├── whatsapp.ts           # WPPConnect sidecar REST client
│   │   ├── whatsapp-crm.ts       # Conversational CRM: contact resolution, chat persistence, staff
│   │   │                         #   attribution, intent detection, vendor ingestion, label queue,
│   │   │                         #   POS cart broadcast bridge, product cards, STOP opt-outs
│   │   ├── payment-reconciliation.ts # Razorpay payment-link polling settlement engine
│   │   ├── whatsapp-broadcast.ts # Anti-ban staggered broadcast queue (jitter, quota, segments)
│   │   ├── mobile-scanner.ts     # Unified hardware/camera/Tauri barcode scanner
│   │   ├── mobile-printer.ts     # Android system print spooler & ESC/POS receipt engine
│   │   ├── mobile-whatsapp.ts    # Dual-mode WhatsApp (WPPConnect or native wa.me intent)
│   │   ├── offline-queue.ts      # IndexedDB/localStorage offline mutation queue & auto-replay
│   │   ├── google-drive-sync.ts  # Decentralized Google Drive incremental changelog sync
│   │   └── sync/                 # Shopify & WooCommerce sync connectors
│   ├── scripts/                  # PocketBase migration and maintenance scripts
│   └── types/
│       └── database.ts           # TypeScript interfaces for all collections
├── src-tauri/                    # Native Rust container
│   ├── tauri.conf.json           # Window setup, permissions, externalBin declarations
│   ├── Cargo.toml                # Rust dependencies (tauri, reqwest, tokio, shell)
│   ├── binaries/                 # Precompiled sidecar executables
│   └── src/
│       ├── lib.rs                # Rust supervisor, sidecar health loop, IPC handlers
│       └── main.rs               # Rust entry point
├── pocketbase/                   # Embedded PocketBase Server
│   ├── pocketbase.exe            # PocketBase Go binary
│   └── pb_data/                  # SQLite data directory (data.db, auxiliary.db)
├── wppconnect-sidecar/           # Node.js Puppeteer sidecar for WhatsApp
│   ├── server.js                 # Express server on port 21465
│   ├── build.js                  # Compiles server.js into native executable using pkg
│   └── package.json              # Sidecar dependencies
├── scripts/                      # Operational automation scripts (dev-all.js, start-all.ps1)
├── docs/                         # Detailed documentation suite
│   ├── ARCHITECTURE.md           # System architecture, topology, data tier, service layer
│   ├── BUILD_AND_DEPLOYMENT.md   # Step-by-step build, packaging, Android, and deploy guide
│   ├── POCKETBASE_SETUP.md       # PocketBase administration, schemas, and networking
│   ├── PROJECT_STATE.md          # Release maturity matrix, known defects, and roadmap
│   ├── TECHNICAL_REPORT.md       # Comprehensive technical report & architecture benchmarks
│   ├── APP_WORKING.md            # Daily operational workflows for cashiers and store admins
│   ├── FEATURES.md               # Complete functional specification across 17 domains
│   ├── USER_GUIDE.md             # End-user showroom and cashier operations manual
│   └── README.md                 # Documentation suite index
└── package.json
```

---

## 4. Architectural Rules & File Dependencies

Before modifying any file, maintain the following architectural boundaries:

1. **Database Access Encapsulation**:
   - UI components (`src/app/`, `src/components/`) **must NOT** make raw `pb.collection()` calls directly.
   - All database mutations must go through dedicated domain services in `src/lib/` (e.g., `pos-sales.ts`, `products.ts`, `invoice.ts`).

2. **PocketBase Server URL Handling**:
   - Never hardcode `http://127.0.0.1:8090` in application code.
   - Always import and use `pb` from `src/lib/pocketbase.ts`, which respects dynamic URL overrides (`PB_CUSTOM_URL` from `localStorage`) for LAN/tunnel support.

3. **Responsive Design Discipline**:
   - Every layout and page must be usable on mobile screens (`< 768px`) as well as desktop monitors.
   - Mobile navigation is governed by `MobileBottomNav.tsx` and `MobileDrawer.tsx`.
   - Use `useViewport()` from `src/hooks/use-viewport.ts` to detect mobile/tablet/desktop/Android states.

4. **Next.js Static Export Constraint**:
   - In production builds (`npm run build`), Next.js exports static HTML/CSS/JS (`output: 'export'`).
   - Do not use dynamic Node.js server features (`headers()`, `cookies()`, dynamic `API routes` running server-side Node).
   - Use client-side data fetching via the PocketBase SDK directly from the browser/webview.

5. **Tauri Sidecar Process Supervision**:
   - The WhatsApp sidecar binary must be located in `src-tauri/binaries/` with the target triple name (e.g., `wppconnect-server-x86_64-pc-windows-msvc.exe`).
   - The Rust core (`src-tauri/src/lib.rs`) automatically restarts the sidecar if it crashes.

6. **Conversational CRM Boundaries**:
   - UI surfaces (hub page, drawer, POS widget) must talk to the sidecar and `whatsapp_*` collections through `src/lib/whatsapp-crm.ts` (contact resolution, persistence, attribution) rather than calling `pb.collection('whatsapp_*')` ad hoc.
   - Cross-surface cart hand-offs must go through the `broadcastAddToPOS` / `subscribeRemoteCartItems` bridge in `whatsapp-crm.ts` (BroadcastChannel `pos_cart` + localStorage `pos:cart-updated`), never through ad-hoc channels.

---

## 5. Resolved Logic Defects & Active Work
 
Refer to [`docs/PROJECT_STATE.md`](file:///e:/Local_GIT_2/luminila_inv_mgmt/docs/PROJECT_STATE.md) for full details:
 
1. **Shift Reconciliation Formula** ([`src/lib/register.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/register.ts)): **RESOLVED** — Opening float recorded directly as `operation_type: 'opening_float'` without incrementing `cash_added`, preventing duplicate summation upon shift close.
2. **Non-Atomic POS Sales Write** ([`src/lib/pos-sales.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/pos-sales.ts)): **RESOLVED** — Implemented compensating rollback hooks to restore inventory and remove orphaned sale items and stock movement records on failure.
3. **Sales Order Invoicing Link** ([`src/lib/orders.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/orders.ts)): **RESOLVED** — Order-to-invoice conversion explicitly invokes `createInvoice` to persist the GST invoice with line items before setting order status to `invoiced`.
4. **Customer Return Restock Hook** ([`src/lib/returns.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/returns.ts)): **RESOLVED** — Approving a credit note restores variant inventory levels and writes audit records to `stock_movements`.
5. **GRN Over-Receipt Guard** ([`src/lib/purchase.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/purchase.ts)): **RESOLVED** — `createGRN` validates received quantity against `ordered - already_received`.
6. **Banking Overdraft Protection** ([`src/lib/banking.ts`](file:///e:/Local_GIT_2/luminila_inv_mgmt/src/lib/banking.ts)): **RESOLVED** — Pre-flight balance check prevents overdraft on debits and transfers; transactions roll back if balance persistence fails.
