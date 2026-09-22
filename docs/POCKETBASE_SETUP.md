# PocketBase Setup & Administration Guide for Luminila

This guide describes how to configure, administer, migrate, and maintain the embedded **PocketBase** database engine powering the Luminila Inventory Management System.

---

## 1. Overview & Architecture

Luminila uses [PocketBase v0.25.0](https://pocketbase.io/) as its persistence server tier, paired with the PocketBase JS SDK `^0.26.5` on the client. PocketBase is an embedded Go application backed by **SQLite** running in Write-Ahead Logging (`WAL`) mode.

### Key Advantages:
- **Zero Cloud Subscriptions**: Runs 100% locally on store hardware.
- **Embedded Performance**: Single executable with zero setup friction; sub-millisecond query responses.
- **Concurrent Concurrency**: SQLite `WAL` mode allows concurrent non-blocking reads and serialized writes between Next.js, Tauri desktop, and remote showroom tablets.
- **Real-Time Subscriptions**: Built-in Server-Sent Events (SSE) provide instant UI updates across terminals when inventory or sales change.
- **Built-in JWT Auth & Storage**: Manages staff passwords, file attachments (jewelry images, expense receipts), and future PIN/QR quick-switch authentication (Roadmap).

---

## 2. Directory Structure

All database assets reside in the `pocketbase/` folder:

```
pocketbase/
├── pocketbase.exe          # PocketBase Go binary v0.25.0 (Windows executable)
├── CHANGELOG.md            # PocketBase changelog
├── LICENSE.md              # PocketBase license (MIT)
├── pb_migrations/          # Declarative migration scripts
└── pb_data/                # Database and file assets
    ├── data.db             # Primary SQLite relational database
    ├── data.db-wal         # Write-Ahead Log (active transactions)
    ├── data.db-shm         # Shared memory file for WAL indexing
    ├── auxiliary.db        # PocketBase system cache and logs
    └── storage/            # Uploaded files and product photos
```

---

## 3. Starting the PocketBase Server

### Option A: Unified Launcher (Recommended)
Starting all services together automatically spins up PocketBase and verifies health on port 8090:
```bash
npm run dev
# or:
npm run dev:all
```

### Option B: Standalone Service
To run PocketBase in a dedicated terminal (bound to `0.0.0.0:8090` by default):
```bash
npm run dev:pb
```
*Direct CLI equivalent:*
```powershell
./pocketbase/pocketbase.exe serve --http="0.0.0.0:8090" --dir="pocketbase/pb_data"
```

*Note: Binding to `0.0.0.0:8090` allows local loopback (`127.0.0.1`), showroom tablets on the local Wi-Fi, and Android emulators (`10.0.2.2`) to connect without additional network proxying.*

---

## 4. Admin Web Console & Staff Credentials

PocketBase provides a built-in administrative dashboard alongside application-level user accounts:

### 4.1 Database Superuser Admin Console
- **URL**: `http://127.0.0.1:8090/_/`
- **Email**: `admin@luminila.com`
- **Password**: `password123456`
- *Used for low-level collection inspection, rule edits, and system backups.*

### 4.2 Staff Application User
- **URL**: `http://localhost:3000/login`
- **Email**: `admin@luminila.local`
- **Password**: `Admin@123456`
- *Seeded via `src/scripts/create-admin-user.ts` for accessing POS, Inventory, and ERP modules.*

---

## 5. Schema Initialization & Migrations

All schema collections, fields, relation rules, and indexes are managed via TypeScript scripts in `src/scripts/`:

### 5.1 Initialize Complete Schema (38 Collections)
On a fresh installation, run:
```bash
npx tsx src/scripts/init-pocketbase.ts
```
This automatically authenticates and creates the full catalog of 38 collections (products, variants, sales, invoices, sales_orders, customers, vendors, banking, expenses, roles, shifts, etc.).

### 5.2 Schema Synchronization
When adding new fields or collections in code:
```bash
npx tsx src/scripts/sync-pb-schema.ts
```

### 5.3 Apply API Security Rules
To ensure secure access control for public, staff, and admin tiers:
```bash
npx tsx src/scripts/apply-pb-access-rules.ts
```

### 5.4 Seed RBAC Roles and Admin User
To populate default user roles (`Admin`, `Manager`, `Staff`, `Cashier`, `Viewer`) and seed default staff accounts:
```bash
npx tsx src/scripts/seed-roles.ts
npx tsx src/scripts/create-admin-user.ts
```

---

## 6. Remote Mobile & Multi-Terminal Connectivity

Because PocketBase is a local database running on the store's primary desktop or server PC, mobile devices connect over the network:

### 6.1 Showroom Local Wi-Fi (Same Subnet)
1. Find the host PC's local IP address (e.g. `192.168.1.100`).
2. Start PocketBase with `0.0.0.0`:
   ```powershell
   ./pocketbase/pocketbase.exe serve --http="0.0.0.0:8090" --dir="pocketbase/pb_data"
   ```
3. In the mobile Android app, open **Menu → Server Settings**, enter `http://192.168.1.100:8090`, and tap **Connect**.

### 6.2 Cloudflare Zero-Trust Tunnel (Cellular / Remote Access)
To connect securely from outside the showroom without port forwarding or static public IPs:
1. Run the built-in tunnel script:
   ```bash
   npm run tunnel
   ```
2. Copy the generated HTTPS URL (e.g., `https://random-words.trycloudflare.com`).
3. Enter this URL into the Android app's Server Settings. The client verifies latency and establishes end-to-end encrypted communication.

---

## 7. Backups, Restores & Compaction

### 7.1 Automated Snapshot via Admin Console
1. Open `http://127.0.0.1:8090/_/`.
2. Navigate to **Settings → Backups**.
3. Click **Create Backup**. PocketBase will create a timestamped ZIP archive containing `data.db` and the `storage/` directory without locking database writes.

### 7.2 Manual File Backup
```powershell
# Copy the entire pb_data directory to a backup location
Copy-Item -Recurse -Force pocketbase/pb_data "backups/pb_data_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
```

### 7.3 Database Compaction / Vacuum
SQLite databases can accumulate fragmentation after extensive deletions. PocketBase exposes an optimization routine under **Settings → System → Vacuum Database**.
