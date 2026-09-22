# Luminila Inventory Management — Complete Build & Deployment Guide

This guide provides end-to-end instructions for installing prerequisites, configuring environments, running local development servers, compiling binaries, and packaging production builds for **Desktop (Windows/macOS/Linux)** and **Mobile (Android)**. Any AI agent or developer can use this reference to build, run, and extend the system.

---

## 1. System Requirements & Prerequisites

### 1.1 Core Toolchain (All Platforms)

| Dependency | Minimum Version | Recommended | Notes |
|---|---|---|---|
| **Node.js** | `v18.17.0+` | `v20.x LTS` | Engine for Next.js and WPPConnect sidecar |
| **npm** | `v9.x+` | `v10.x+` | Package manager |
| **PocketBase** | `v0.26.0+` | `v0.26.5` | Embedded Go SQLite backend (included in `pocketbase/`) |
| **Rust / Cargo** | `1.75.0+` | `latest stable` | Required for Tauri v2 native shell compilation |
| **Git** | `2.40+` | `latest` | Version control |

### 1.2 Platform-Specific Prerequisites

#### Windows (Desktop)
1. **Microsoft Visual Studio C++ Build Tools**:
   - Install **Visual Studio 2022 Build Tools** (or VS Community).
   - Workloads required: **Desktop development with C++** (includes MSVC v143, Windows 10/11 SDK).
2. **WebView2 Runtime**:
   - Pre-installed on Windows 10/11. If missing, download the Evergreen Bootstrapper from Microsoft.
3. **WiX Toolset v3** (Optional, for `.msi` installers):
   - Tauri automatically handles bundle generation, but WiX 3.11 is required if building standalone `.msi` packages.

#### Android (Mobile App via Tauri v2)
1. **Java Development Kit (JDK)**: OpenJDK 17 (`JAVA_HOME` must point to JDK 17).
2. **Android Studio** (Ladybug / Hedgehog or newer):
   - **Android SDK Platform**: API Level 34 (Android 14) or API Level 35.
   - **Android SDK Build-Tools**: `34.0.0` or newer.
   - **Android NDK**: Version `25.2.9519653` or newer (r25c+).
   - **Android SDK Command-line Tools (latest)**.
   - **Android SDK Platform-Tools** (`adb`).
3. **Environment Variables**:
   ```powershell
   # Windows PowerShell profile ($PROFILE) or System Environment Variables
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr" # or C:\Program Files\Java\jdk-17
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   $env:NDK_HOME = "$env:ANDROID_HOME\ndk\<installed-ndk-version>"
   $env:PATH += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin"
   ```
4. **Rust Android Targets**:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

---

## 2. Environment Configuration

### 2.1 File Setup (`.env.local`)

Copy `env.example.txt` to `.env.local` in the project root:

```bash
cp env.example.txt .env.local
```

### 2.2 Environment Variables Reference

```ini
# ==============================================================================
# POCKETBASE CONFIGURATION
# ==============================================================================
# Base URL for the PocketBase REST and Realtime SSE API.
# - Desktop / Local browser: http://127.0.0.1:8090
# - Mobile device on same Wi-Fi: http://192.168.1.xxx:8090
# - Remote device over tunnel: https://xxxx.trycloudflare.com
NEXT_PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090

# ==============================================================================
# SHOPIFY INTEGRATION (Optional - for e-commerce sync)
# ==============================================================================
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ==============================================================================
# WOOCOMMERCE INTEGRATION (Optional - fallback e-commerce)
# ==============================================================================
WOOCOMMERCE_URL=https://your-store.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ==============================================================================
# TAURI DEVELOPMENT (For mobile / network dev)
# ==============================================================================
# Set this to your machine's LAN IP when running Tauri on Android or external browser
# TAURI_DEV_HOST=192.168.1.100
```

### 2.3 Runtime Dynamic URL Override

The app supports runtime database URL overrides without rebuilding. When running on Android or a remote browser:
- Set `localStorage.setItem("PB_CUSTOM_URL", "https://your-tunnel.trycloudflare.com")`
- Or use the built-in Server Configuration dialog in the mobile drawer.
- The `src/lib/pocketbase.ts` client automatically detects `PB_CUSTOM_URL` and repoints the singleton.

---

## 3. Local Development Workflows

### 3.1 Option A: Unified Launcher (`npm run dev:all`) — Recommended

The unified orchestrator (`scripts/dev-all.js`) concurrently manages all three backend/frontend services with color-coded logging and clean process termination:

```bash
npm run dev:all
```

**What it launches:**
1. **PocketBase Server**: `http://127.0.0.1:8090` (Admin: `http://127.0.0.1:8090/_/`)
2. **WhatsApp WPPConnect Sidecar**: `http://127.0.0.1:21465`
3. **Next.js Web Frontend**: `http://localhost:3000`

*To stop all services: Press `Ctrl+C` in the terminal.*

### 3.2 Option B: Individual Standalone Services

If debugging a specific subsystem, run each process in an independent terminal:

```bash
# Terminal 1: PocketBase Server
npm run dev:pb
# Equivalent to: pocketbase\pocketbase.exe serve --http=127.0.0.1:8090 --dir=pocketbase\pb_data

# Terminal 2: WhatsApp Sidecar
npm run dev:sidecar
# Equivalent to: node wppconnect-sidecar/server.js

# Terminal 3: Next.js Frontend
npm run dev:frontend
# Equivalent to: next dev
```

### 3.3 Option C: Tauri Desktop Development Mode

Run the native desktop shell wrapping the live Next.js dev server:

```bash
npm run tauri:dev
```

- Hooks into `http://localhost:3000`.
- Supports Hot Module Replacement (HMR).
- Tauri automatically supervises the WPPConnect sidecar via `src-tauri/src/lib.rs`.

### 3.4 Option D: Android Development Mode

To test and debug on an Android physical device (connected via USB with USB debugging enabled) or an Android Virtual Device (AVD):

```bash
# 1. Initialize Android project if running for the first time
npx tauri android init

# 2. Start Android live-reload dev session
npx tauri android dev
```

*Tip: If testing on a physical phone, ensure `TAURI_DEV_HOST` in `.env.local` is set to your PC's LAN IP (e.g. `192.168.1.100`), or configure `PB_CUSTOM_URL` via Cloudflare tunnel.*

---

## 4. PocketBase Database Setup & Migrations

PocketBase stores everything locally in `pocketbase/pb_data/data.db` (SQLite in WAL mode).

### 4.1 First-Time Initialization

If starting with a clean repository or fresh database:

1. **Start PocketBase**:
   ```bash
   npm run dev:pb
   ```
2. **Access Admin Console**:
   Visit `http://127.0.0.1:8090/_/` and create the primary admin credentials:
   - **Default Admin Email**: `admin@luminila.com`
   - **Default Admin Password**: `password123456`
3. **Execute Schema Creation**:
   ```bash
   npx tsx src/scripts/init-pocketbase.ts
   ```
   This script creates all **38 collections** (products, variants, sales, invoices, customers, vendors, banking, expenses, roles, shifts, etc.).

### 4.2 Schema Synchronization & Updates

When schema definitions in code evolve:

```bash
# Sync schema modifications against existing collections
npx tsx src/scripts/sync-pb-schema.ts

# Apply access rules (public/user/admin permissions)
npx tsx src/scripts/apply-pb-access-rules.ts

# Seed system roles and RBAC capabilities
npx tsx src/scripts/seed-roles.ts

# Seed default admin user in the users collection
npx tsx src/scripts/create-admin-user.ts
```

### 4.3 Database Backup & Restores

- **Live Snapshot via Admin Console**: Go to `Settings > Backups > Create Backup`.
- **Manual File Backup**:
  ```powershell
  # Ensure PocketBase is stopped or in WAL mode
  Copy-Item -Recurse -Force pocketbase/pb_data "backups/pb_data_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  ```

---

## 5. Production Build Pipelines

### 5.1 Step 1: Next.js Static Web Export

Tauri requires a static frontend bundle (`output: 'export'` in `next.config.ts`), generating static HTML/CSS/JS in `out/`:

```bash
npm run build
```

- Output directory: `out/`
- Verified: `next.config.ts` automatically switches `output: "export"` when `NODE_ENV === "production"`.
- Images are unoptimized (`images.unoptimized = true`) to allow direct local file serving without a Node.js server.

### 5.2 Step 2: Compiling the WPPConnect Sidecar Binary

Tauri embeds the WhatsApp sidecar as a standalone executable in `src-tauri/binaries/`. Before building Tauri desktop bundles, compile the sidecar:

```bash
cd wppconnect-sidecar
npm install
npm run build
cd ..
```

**What `build.js` does:**
1. Uses `@yao-pkg/pkg` to package `server.js` and assets into `dist/wppconnect-server.exe`.
2. Renames and copies the binary to:
   `src-tauri/binaries/wppconnect-server-x86_64-pc-windows-msvc.exe` (or `apple-darwin` / `unknown-linux-gnu` depending on host OS).

### 5.3 Step 3: Packaging Desktop App (Tauri Windows/macOS/Linux)

Once steps 5.1 and 5.2 are ready:

```bash
npm run tauri:build
```

**Build Artifacts:**
- Windows Executable: `src-tauri/target/release/luminila.exe`
- Windows Installer (NSIS/MSI): `src-tauri/target/release/bundle/msi/Luminila_0.1.0_x64_en-US.msi`
- Windows Portable / Setup: `src-tauri/target/release/bundle/nsis/`

### 5.4 Step 4: Packaging Android App

There are two primary distribution mechanisms for running Luminila on Android tablets and smartphones:

#### Option A: Progressive Web App (PWA) Standalone Installation (Recommended for Showroom)
Luminila includes a full web application manifest (`public/manifest.json`) and mobile fullscreen meta tags:
1. On the Android device (or emulator), open Chrome and navigate to the showroom server URL (e.g. `http://<LAN-IP>:3000` or `https://<tunnel>.trycloudflare.com`).
2. Tap the Chrome three-dot menu and select **"Add to Home screen"** or **"Install app"**.
3. A standalone "Luminila" app icon will be placed on the device launcher.
4. When opened, it runs in full-screen standalone windowing (no browser URL bar or navigation controls), with full access to device camera barcode scanning, Bluetooth/Wi-Fi printing, and local IndexedDB offline storage.

#### Option B: Tauri v2 Standalone APK Compilation
To compile a native `.apk` binary:

```bash
# Debug APK:
npx tauri android build --apk --debug

# Release APK (Unsigned):
npx tauri android build --apk
```

> [!WARNING]
> **Windows exFAT Drive Symlink Limitation:**  
> If the project workspace is located on an **exFAT** formatted drive (such as an external SSD or USB drive), Windows does not support filesystem symbolic links at the OS kernel level (`Incorrect function. (os error 1)`). To compile the release `.apk`, copy or clone the repository to an **NTFS** partition (e.g. `C:\`), where Windows symlinks and cross-drive Gradle paths are fully supported.

**Output APK Locations:**
- Debug APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

**Installing onto Connected Device:**
```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

---

## 6. Remote Mobile Connectivity & Cloudflare Tunneling

Because PocketBase is an embedded SQLite service running on the store desktop PC or a server, mobile Android devices need to connect over the network.

### 6.1 Option 1: Local Wi-Fi (Same Subnet)
1. Find host PC's local IP:
   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*" | Select-Object IPAddress
   ```
2. Start PocketBase bound to all interfaces:
   ```powershell
   ./pocketbase/pocketbase.exe serve --http="0.0.0.0:8090" --dir="pocketbase/pb_data"
   ```
3. In the mobile app, set the server URL to `http://192.168.1.xxx:8090`.

### 6.2 Option 2: Cloudflare Zero-Trust Tunnel (Anywhere / 4G / 5G)
Using a free Cloudflare Tunnel enables end-to-end HTTPS access without port forwarding or static public IPs:

1. Install Cloudflare CLI (`cloudflared`):
   ```powershell
   winget install Cloudflare.cloudflared
   ```
2. Launch quick ad-hoc tunnel pointing to PocketBase:
   ```powershell
   npm run tunnel
   # (Or manually: cloudflared tunnel --url http://127.0.0.1:8090)
   ```
3. Copy the output HTTPS tunnel URL (e.g. `https://random-words.trycloudflare.com`).
4. In the Luminila Android app, open **Menu > Server Settings**, paste the URL, and click **Connect**. The app immediately verifies latency and syncs with the database.

---

## 7. Verification & Quality Gates

Run these validation commands prior to committing changes:

```bash
# 1. Check TypeScript types
npx tsc --noEmit

# 2. Run ESLint checks
npm run lint

# 3. Test Next.js static build export
npm run build

# 4. Verify PocketBase schema integrity
npx tsx src/scripts/check-collections.ts
```

---

## 8. Troubleshooting Common Build & Runtime Issues

### Issue 1: `PocketBase port 8090 is already in use`
- **Cause**: An existing `pocketbase.exe` instance is still running in the background.
- **Fix**:
  ```powershell
  Stop-Process -Name "pocketbase" -Force -ErrorAction SilentlyContinue
  ```

### Issue 2: `WPPConnect sidecar binary missing during tauri:build`
- **Cause**: Tauri expects `src-tauri/binaries/wppconnect-server-<target-triple>.exe` to exist because it is declared under `bundle.externalBin` in `tauri.conf.json`.
- **Fix**: Run `cd wppconnect-sidecar && npm run build` to compile the binary before running `tauri:build`.

### Issue 3: `Tauri CSP blocks connection to PocketBase`
- **Cause**: The Content Security Policy in `src-tauri/tauri.conf.json` restricts network origins.
- **Fix**: Ensure `connect-src` in `tauri.conf.json` includes:
  `'self' http://127.0.0.1:* ws://127.0.0.1:* https://*.trycloudflare.com`

### Issue 4: Android Build Fails with `NDK not found`
- **Cause**: `NDK_HOME` or `ANDROID_HOME` is not set or points to an incompatible NDK.
- **Fix**: Verify with `ls "$env:ANDROID_HOME\ndk"` and export `NDK_HOME` pointing to `25.x` or `26.x`.
