# Documentation Verification Report — 2026-09-22

This report verifies every material claim in `docs/` against the actual codebase (no project files were modified; this document is the only file created). Evidence is given as file/line references or command output.

---

## 1. Executive Verdict

The docs are **architecturally accurate but operationally stale**:

1. **All six P1 defects registered in `PROJECT_STATE.md` are already fixed in the current code** — the "Milestone 2: Transactional Stability" checklist and the defect register describe the past, not the present. This is the single largest discrepancy.
2. **The embedded PocketBase server binary is v0.25.0, not v0.26.5** as every doc states (the 0.26.5 figure is the *JS SDK* version from `package.json`, not the server).
3. **Several documented features do not exist in code**: cashier PIN/QR quick-switch auth, split-tender payments, and the `sync_logs` collection.
4. **The documented default admin credentials do not match the seeded account.**
5. Minor inaccuracies: file locations (`ProtectedRoute.tsx`, `use-mobile.ts`), module counts (17 vs 18), role names, `npm run dev` behavior, and the PocketBase bind address.

Everything else checked out — tech stack versions, all 19 app routes, all claimed `src/lib` modules, the 38-collection count, the Rust sidecar supervisor behavior, dynamic PocketBase URL switching, tunnel script, and mobile feature set are all real and correctly described.

---

## 2. Verified Accurate (confirmed against code)

| Claim (docs) | Evidence |
|---|---|
| Next.js 16.1.0, React 19.2.3, TypeScript 5, Tailwind v4, React Compiler | `package.json` (`next 16.1.0`, `react 19.2.3`, `babel-plugin-react-compiler 1.0.0`); `next.config.ts:20` (`reactCompiler: true`) |
| Static export on production, unoptimized images | `next.config.ts:9` (`output: "export"` when `NODE_ENV === "production"`), `next.config.ts:13` |
| Tauri v2.9.x (crate 2.9.5, CLI ^2.9.6, API ^2.9.1), Rust 2021 | `src-tauri/Cargo.toml:22`, `package.json` devDeps |
| Sidecar binary `wppconnect-server-x86_64-pc-windows-msvc.exe` in `src-tauri/binaries/` | Directory listing; `wppconnect-sidecar/build.js:63-66` copies it there |
| WPPConnect `^2.3.3` on port 21465 | `wppconnect-sidecar/package.json:23`; `scripts/dev-all.js:127` (`WPPCONNECT_PORT: '21465'`); `src-tauri/src/lib.rs:16` health URL |
| All 19 `src/app` route modules exist (activity, banking, challan, customers, expenses, inventory, invoices, labels, login, orders, pos, purchase, reports, returns, settings, setup, users, vendors, whatsapp) | Directory listing of `src/app` |
| All claimed `src/lib` domain modules exist — including `mobile-scanner.ts`, `mobile-printer.ts`, `mobile-whatsapp.ts`, `offline-queue.ts`, `google-drive-sync.ts`, `sync/shopify.ts`, `sync/woocommerce.ts`, `sync-engine.ts` | Directory listing of `src/lib` and `src/lib/sync` |
| **38 collections** created by `src/scripts/init-pocketbase.ts` | Regex count of top-level `name:` entries = **38** |
| `use-viewport.ts` exposes `isMobile` (<768), `isTablet` (768–1024), `isDesktop` (≥1024), `isTauri`, `isAndroid` | `src/hooks/use-viewport.ts:30-42` |
| Rust supervisor: 5-second health poll, respawn after 3 consecutive failures, IPC commands `get_sidecar_status` / `restart_sidecar` | `src-tauri/src/lib.rs:66` (5s), `:94` (3 failures), `:104-147` (commands) |
| Dynamic PocketBase URL: `PB_CUSTOM_URL` localStorage override, `setPocketBaseUrl` repoints client + fires `pb:server-changed`, `checkServerStatus` measures latency and detects tunnels | `src/lib/pocketbase.ts:10-23, 35-54, 76-102` |
| `npm run tunnel` → `cloudflared tunnel --url http://127.0.0.1:8090` with trycloudflare URL extraction | `scripts/tunnel.js:40-58`; `package.json:17` |
| `scripts/dev-all.js` boots PocketBase + sidecar + Next.js with health pre-checks | `scripts/dev-all.js:92-142` |
| Mobile WhatsApp: sidecar dispatch with `whatsapp://send` / `wa.me` fallback | `src/lib/mobile-whatsapp.ts:96-110` |
| Offline mutation queue persists to localStorage and replays | `src/lib/offline-queue.ts:31, 44` |
| `MobileBottomNav` tabs: Home, Stock, Invoices (+ Menu & POS FAB structure) | `src/components/layout/MobileBottomNav.tsx:38-41` |
| CSP is protocol-based (`connect-src 'self' http: https: ws: wss:`) matching PROJECT_STATE's "CSP Cleanup (Completed)" | `src-tauri/tauri.conf.json:26` |
| Referenced root files exist: `CODEBASE.md`, `APP_LOGIC_AUDIT_REPORT_2026-03-07.md`, `env.example.txt`, `check-collections.ts` | Directory listings |
| `env.example.txt` variables match BUILD_AND_DEPLOYMENT §2.2 | File content |
| Audit date "March 2026" | `APP_LOGIC_AUDIT_REPORT_2026-03-07.md` exists |

---

## 3. Inaccuracies Found

### 3.1 HIGH — All six registered P1 defects are already fixed (PROJECT_STATE.md §4, §6 are stale)

| # | Defect (documented as open) | Actual state in code |
|---|---|---|
| 1 | Shift opening balance double-counted (`register.ts`) | **FIXED.** `openShift` now writes a `cash_drawer_operations` record with `operation_type: 'opening_float'` and explicitly does **not** increment `cash_added` (`src/lib/register.ts:102-112`, comment: "without incrementing cash_added"). `closeShift` counts the float exactly once (`register.ts:177-183`). |
| 2 | Non-atomic POS sale write (`pos-sales.ts`) | **FIXED (client-side compensating rollback).** `createPOSSale` tracks created records and, on error, restores stock, deletes stock movements, sale items, and the sale (`src/lib/pos-sales.ts:151-188`). *Residual note:* this is not a server-side transaction — shift-total updates and a partially created invoice are not rolled back — but the documented resolution plan ("compensating rollback hooks") is implemented. |
| 3 | Order→Invoice missing invoice persistence (`orders.ts`) | **FIXED.** `generateInvoiceFromOrder` calls `createInvoice({…items})` (`src/lib/orders.ts:189-218`) **before** marking the order `invoiced` (`orders.ts:221`). |
| 4 | Returns never restock inventory (`returns.ts`) | **FIXED.** `approveCreditNote` increments `stock_level` per variant and logs a `stock_movements` record with `movement_type: 'return'` (`src/lib/returns.ts:267-304`), guarded against double-restock. |
| 5 | GRN unbounded over-receipt (`purchase.ts`) | **FIXED.** `createGRN` caps `quantity_received` at `ordered − alreadyReceived` with a `[GRN Guard]` warning (`src/lib/purchase.ts:406-422`). |
| 6 | Banking overdraft + split write (`banking.ts`) | **FIXED.** `createBankTransaction` throws on insufficient funds for withdrawals/transfers (`src/lib/banking.ts:149-154`) and deletes the orphaned transaction if the balance update fails (`banking.ts:172-180`). |

**Consequence:** `PROJECT_STATE.md` Milestone 2 ("Current Focus", all 6 items unchecked), the Module Maturity "Needs Hardening" reasons tied to these defects, and the "Known Defects & Logic Audit Register" all need updating. Milestone 2 is effectively complete (modulo the residual non-transactional nature of POS/banking writes noted above).

### 3.2 HIGH — PocketBase server version is 0.25.0, not 0.26.5

- Verified by running `pocketbase\pocketbase.exe --version` → **`pocketbase.exe version 0.25.0`**. The bundled `pocketbase/CHANGELOG.md` top entry is also `v0.25.0`.
- Every doc claims v0.26.5 (ARCHITECTURE §1/§2, PROJECT_STATE §1, TECHNICAL_REPORT §2.2, BUILD_AND_DEPLOYMENT §1.1, POCKETBASE_SETUP §1, USER_GUIDE).
- Source of confusion: `package.json` has `"pocketbase": "^0.26.5"` — that is the **JS client SDK**, not the server.
- Practical impact: server 0.25 vs SDK 0.26 may have API-compatibility implications (e.g., note that `create-admin-user.ts:18` uses `pb.admins.authWithPassword`, an API removed in newer PocketBase/SDK releases in favor of the `_superusers` collection).

### 3.3 HIGH — Documented features that do not exist in code

1. **Cashier PIN/QR quick-switch.** Claimed in ARCHITECTURE §9.1 ("4-to-6 digit PIN or an authenticated badge QR code"), TECHNICAL_REPORT §6.1, PROJECT_STATE (RBAC row: "PIN/QR cashier switching"). Reality: a full-text search of `src/` for `pin`, `pin_hash`, `loginWithPin`, `qr_token`, `qrToken`, `switchUser`, etc. returns **zero** hits. `AuthContext.tsx:7-15` supports only email/password login, register, logout, and role-based admin detection.
2. **Split-tender payments.** FEATURES §1 ("Split tender transactions across multiple payment modes") and USER_GUIDE §POS ("Split payments across multiple tenders are fully supported"). Reality: a sale has a single `payment_method` (`pos-sales.ts:39`: `'cash' | 'card' | 'upi' | 'phonepe'`); the POS page implements only cash tendered / change calculation (`src/app/pos/page.tsx:469,495`). No split-tender structure exists.
3. **`sync_logs` collection.** Listed in ARCHITECTURE §4 and TECHNICAL_REPORT §4 as one of the 38. Reality: not created by `init-pocketbase.ts`; the only sync-log collection referenced anywhere in code is `catalog_sync_logs` (`src/lib/catalog-sync.ts:34`) — which is *also* absent from the init script (and from the docs).
4. **Google Drive sync presented as functional.** FEATURES §16 / ARCHITECTURE §5 describe a working Tier-2 sync engine. `google-drive-sync.ts` exists, but the actual Drive upload call is commented out and connect supports a "Mock Mode" (`src/lib/google-drive-sync.ts:136, 176`) — it is a scaffold, not a working sync engine.

### 3.4 MEDIUM — Version / tooling inaccuracies

- **WPPConnect build tool:** BUILD_AND_DEPLOYMENT §5.2 says `build.js` "Uses `@yao-pkg/pkg`". Actual: devDependency is `pkg ^5.8.1` and `build.js:55` invokes `npx pkg` (`wppconnect-sidecar/package.json:31`).

### 3.5 MEDIUM — Operational doc inaccuracies

1. **`npm run dev` is not "Next.js only".** APP_WORKING §1 Option B, Terminal 3 says `npm run dev` starts the Next.js app. Reality: `package.json:6` maps `dev` → `node scripts/dev-all.js` (the unified launcher). The frontend-only command is `dev:frontend`. (Worse, `tauri.conf.json:9` uses `npm run dev` as `beforeDevCommand`, so `tauri:dev` boots the whole stack.)
2. **APP_WORKING §1 attributes the unified launcher to `scripts/start-all.ps1`.** Reality: `npm run dev:all` runs `scripts/dev-all.js` (`package.json:10`). `start-all.ps1` exists but is wired to no npm script.
3. **PocketBase bind address.** Docs' standalone command shows `--http=127.0.0.1:8090` (APP_WORKING §1, POCKETBASE_SETUP §3, BUILD_AND_DEPLOYMENT §3.2). Reality: `dev:pb` and `dev-all.js` both bind **`0.0.0.0:8090`** (`package.json:8`, `scripts/dev-all.js:100`) — i.e., the real default exposes the database to the whole LAN, broader than documented. Worth flagging as a security-posture note.
4. **Default admin credentials mismatch.** POCKETBASE_SETUP §4, BUILD_AND_DEPLOYMENT §4.1, APP_WORKING §3, and USER_GUIDE all cite `admin@luminila.com` / `password123456`. Reality: `src/scripts/create-admin-user.ts:10-11` seeds the staff admin as **`admin@luminila.local` / `Admin@123456`**; the `.com`/`password123456` pair appears only in a legacy superuser auth attempt (`create-admin-user.ts:18`) using the removed `pb.admins` API.
5. **Desktop shell does not start PocketBase.** USER_GUIDE Option 1 says "The desktop shell automatically starts background services", and ARCHITECTURE §1's diagram shows `TauriCore -- Spawns / Manages --> PB`. Reality: `src-tauri/src/lib.rs` supervises **only the WPPConnect sidecar**. Nothing in the Tauri app spawns or monitors `pocketbase.exe`. As documented, production desktop builds have no answer for how PocketBase starts — a genuine architectural gap, not just a doc typo.
6. **Stale CSP troubleshooting.** BUILD_AND_DEPLOYMENT §8 Issue 3 says `connect-src` should include `http://127.0.0.1:* … https://*.trycloudflare.com`. The actual CSP is broader protocol-based config (`tauri.conf.json:26`), consistent with PROJECT_STATE's completed "CSP Cleanup". The troubleshooting entry describes the old state.

### 3.6 LOW — Structure / naming inaccuracies

1. **`ProtectedRoute.tsx` location:** ARCHITECTURE §3 places it in `src/components/layout/`; it actually lives in **`src/components/auth/ProtectedRoute.tsx`**.
2. **`use-mobile.ts` does not exist.** ARCHITECTURE §3 lists it under `src/hooks/`; only `use-viewport.ts` and `usePermissions.ts` exist.
3. **MobileDrawer module count:** docs repeatedly say "all 18 ERP modules" (ARCHITECTURE §6.2, PROJECT_STATE Milestone 1, FEATURES §16, USER_GUIDE). The drawer defines **17** nav entries (5 Sales & POS + 4 Inventory & Catalog + 3 Finance & Accounts + 5 Showroom & System) — `MobileDrawer.tsx:43-81`.
4. **RBAC role names:** ARCHITECTURE §9.2 shows roles `admin, manager, cashier, inventory_clerk`. Actual seeded roles (`src/scripts/seed-roles.ts`): **`Admin, Manager, Staff, Cashier, Viewer`** — there is no `inventory_clerk`.
5. **38-collection catalog composition.** The *count* is correct, but the catalog list in ARCHITECTURE §4 / TECHNICAL_REPORT §4 omits **`sales_orders` and `sales_order_items`** (present in the init script and heavily used by `orders.ts`) and includes **`users` and `sync_logs`** (not created by the init script; `users` is PocketBase's default auth collection modified by later scripts).
6. **`pocketbase/` tree omissions (cosmetic):** the folder also contains `pb_migrations/`, `CHANGELOG.md`, `LICENSE.md`, not shown in docs' directory trees.
7. **Undocumented but useful:** `getPocketBaseUrl()` auto-detects LAN/emulator hosts — if the page hostname is not localhost/127.0.0.1 it defaults to `http://<host>:8090` (`src/lib/pocketbase.ts:16-20`). Docs describe only the env-var → localStorage fallback chain.
8. **Order status lifecycle:** FEATURES §7 lists `draft → sent → confirmed → shipped → delivered → invoiced`; the type also includes `cancelled` (`src/lib/orders.ts:10`). Trivial.

---

## 4. Per-Document Summary

| Document | Verdict | Notes |
|---|---|---|
| `README.md` | ✅ Accurate | Index, commands, URLs all check out. |
| `ARCHITECTURE.md` | 🟡 Mostly accurate | Stack, structure, service layering, supervisor, URL switching all real. Wrong: `use-mobile.ts`, `ProtectedRoute` path, `sync_logs`/collection catalog composition, role names, PIN/QR auth, "TauriCore spawns PB", drawer "18 modules". |
| `PROJECT_STATE.md` | 🔴 Stale | All 6 P1 defects fixed; Milestone 2 items done; several "Needs Hardening" reasons obsolete. |
| `TECHNICAL_REPORT.md` | 🟡 Mostly accurate | Same architectural accuracy/issues as ARCHITECTURE; PocketBase version wrong; PIN/QR auth claim false; `<100MB RAM` claim unverifiable. |
| `FEATURES.md` | 🟡 Mostly accurate | POS split-tender overstated; Drive-sync described as functional while scaffolded; drawer "18 modules"; rest is faithful (incl. mobile scanner/printer/WhatsApp fallback). |
| `APP_WORKING.md` | 🟡 Mostly accurate | `npm run dev` mislabeled as frontend-only; launcher attributed to start-all.ps1; PB bind address and admin credentials differ from code. |
| `USER_GUIDE.md` | 🟡 Mostly accurate | Same credential/service-supervision issues; split-tender overstated; otherwise faithful. |
| `BUILD_AND_DEPLOYMENT.md` | 🟡 Mostly accurate | PocketBase version, `@yao-pkg/pkg` name, stale CSP troubleshooting; otherwise commands and pipelines match `package.json`/scripts. |
| `POCKETBASE_SETUP.md` | 🟡 Mostly accurate | Server version wrong (0.25.0); default credentials mismatch; tree omits `pb_migrations/`. |

---

## 5. Recommended Follow-ups (not performed — no files were edited)

1. Update `PROJECT_STATE.md`: move all six defects to a "Resolved" register (with the residual "not a server-side transaction" caveat for POS/banking), mark Milestone 2 complete, and set the current focus to Milestones 3–4.
2. Correct the PocketBase **server** version to 0.25.0 everywhere (or upgrade the binary to match the 0.26.x SDK), and fix the `@yao-pkg/pkg` reference.
3. Remove or mark as roadmap: PIN/QR cashier switching, split-tender, `sync_logs` collection, and present Google Drive sync as scaffolded/beta.
4. Fix operational details: `npm run dev` vs `dev:frontend`, `start-all.ps1` attribution, `0.0.0.0` bind default, seeded credentials (`admin@luminila.local` / `Admin@123456`), `ProtectedRoute` path, drop `use-mobile.ts`, drawer count 17, actual role names, and add `sales_orders`/`sales_order_items` to the collection catalog (drop `sync_logs`).
5. Decide and document how production desktop builds obtain a running PocketBase instance (currently nothing spawns it in the Tauri shell).

---

*Verification method: direct file reads, directory listings, full-text searches of `src/`, regex counts of `src/scripts/init-pocketbase.ts`, and execution of `pocketbase.exe --version`. All line references are to the working tree as of 2026-09-22 (branch `main`, commit `d365cb3`).*
