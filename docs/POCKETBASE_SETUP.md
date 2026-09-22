# PocketBase Setup & Administration Guide for Luminila

This guide describes how to configure, administer, migrate, and maintain the embedded **PocketBase** database engine powering the Luminila Inventory Management System.

---

## 1. Overview & Architecture

Luminila uses [PocketBase v0.26.5](https://pocketbase.io/) as its persistence tier. PocketBase is an embedded Go application backed by **SQLite** running in Write-Ahead Logging (`WAL`) mode.

### Key Advantages:
- **Zero Cloud Subscriptions**: Runs 100% locally on store hardware.
- **Embedded Performance**: Single executable with zero setup friction; sub-millisecond query responses.
- **Concurrent Concurrency**: SQLite `WAL` mode allows concurrent non-blocking reads and serialized writes between Next.js, Tauri desktop, and remote showroom tablets.
- **Real-Time Subscriptions**: Built-in Server-Sent Events (SSE) provide instant UI updates across terminals when inventory or sales change.
- **Built-in JWT Auth & Storage**: Manages staff passwords, PIN/QR authentication, and file attachments (jewelry images, expense receipts).

---

## 2. Directory Structure

All database assets reside in the `pocketbase/` folder:

```
pocketbase/
├── pocketbase.exe          # PocketBase Go binary (Windows executable)
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
npm run dev:all
```

### Option B: Standalone Service
To run PocketBase in a dedicated terminal:
```bash
npm run dev:pb
```
*Direct CLI equivalent:*
```powershell
./pocketbase/pocketbase.exe serve --http="127.0.0.1:8090" --dir="pocketbase/pb_data"
```

### Option C: Bound to All Network Interfaces (For Local Wi-Fi Terminals)
To allow showroom tablets and mobile phones on the same Wi-Fi network to connect directly:
```powershell
./pocketbase/pocketbase.exe serve --http="0.0.0.0:8090" --dir="pocketbase/pb_data"
```

---

## 4. Admin Web Console

PocketBase includes a built-in administrative dashboard:

- **URL**: `http://127.0.0.1:8090/_/`
- **First-Time Setup**: If visiting for the first time on a fresh database, you will be prompted to create an administrator account.
- **Default Recommended Credentials**:
  - **Email**: `admin@luminila.com`
  - **Password**: `password123456`

---

## 5. Schema Initialization & Migrations

All schema collections, fields, relation rules, and indexes are managed via TypeScript scripts in `src/scripts/`:

### 5.1 Initialize Complete Schema (38 Collections)
On a fresh installation, run:
```bash
npx tsx src/scripts/init-pocketbase.ts
```
This automatically authenticates and creates the full catalog of 38 collections (products, variants, sales, invoices, customers, vendors, banking, expenses, roles, shifts, etc.).

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
To populate default user roles (`admin`, `manager`, `cashier`, `inventory_clerk`) and create default staff accounts:
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
