# Luminila Inventory Management — User Guide

Welcome to the **Luminila Fashion Jewelry Inventory Management System**! This guide is designed for showroom owners, retail cashiers, warehouse managers, and store operators to master daily operations.

---

## 🚀 Quick Overview

Luminila is a dedicated fashion jewelry ERP and Point of Sale (POS) system. It runs as a native desktop application (Windows, macOS, Linux), a mobile/tablet app (Android), and a local web application.

### Key Capabilities at a Glance:
- **Fast Retail POS**: Touch-optimized interface, instant variant selection, and barcode scanning.
- **Physical Label Printing**: Crisp Code128 vector barcodes for jewelry dumbbell and butterfly tags.
- **Multi-Channel Catalog**: Multi-variant matrix (size, metal finish, gemstone material) with low-stock warnings.
- **Full Indian GST Compliance**: B2B/B2C tax invoices, CGST/SGST/IGST breakdown, delivery challans, and E-Way bill data prep.
- **Showroom Cash Drawer Shifts**: Shift opening float, mid-shift drops, blind closing, and automatic variance calculation.
- **Customer CRM & Loyalty**: Tiered points program (Bronze, Silver, Gold, Platinum) and customer purchase ledgers.
- **WhatsApp Integration**: Automated order dispatch and customer communications via local WPPConnect sidecar.
- **Mobile & Android Ready**: Thumb-friendly navigation, camera barcode scanning, mobile printer support, and remote Cloudflare tunneling.

---

## 🛠️ Setup & Installation Instructions

### Prerequisites

Before running Luminila, ensure you have:
- **Operating System**: Windows 10/11, macOS 12+, Linux, or Android (phones/tablets).
- **Hardware**: Minimum 4GB RAM (8GB recommended), 2GB free disk space.
- **Node.js**: v18.17+ or v20+ LTS (for development or running from source).
- **Local Database**: Embedded PocketBase v0.25.0 server (included in the `pocketbase/` folder with PocketBase JS SDK v0.26.5 — no external cloud database or monthly subscription required).

### Installation & Launch Options

#### Option 1: Native Desktop Application (Tauri v2)
1. Download the pre-built desktop installer (`Luminila_0.1.0_x64_en-US.msi` or `.exe`).
2. Run the installer and launch Luminila from your desktop or Start Menu.
3. The desktop shell supervises the WhatsApp sidecar natively. PocketBase runs locally on port 8090 (launched via store service or `npm run dev:all`).

#### Option 2: Unified Local Server (Developer / Store Server PC)
To boot all three core background services together on the store master PC:
```bash
# 1. Clone or extract the project
git clone https://github.com/yourusername/luminila_inv_mgmt.git
cd luminila_inv_mgmt

# 2. Install dependencies
npm install
cd wppconnect-sidecar && npm install && cd ..

# 3. Copy environment configuration
cp env.example.txt .env.local

# 4. Start all services concurrently (PocketBase 0.0.0.0:8090, WhatsApp Sidecar :21465, Next.js :3000)
npm run dev
# or:
npm run dev:all
```
- **Web App**: `http://localhost:3000`
- **PocketBase Admin Console**: `http://127.0.0.1:8090/_/`
- **WhatsApp Sidecar**: `http://127.0.0.1:21465`

#### Option 3: Mobile App (Android Phone or Tablet)
1. Install the Luminila Android APK on your phone or tablet.
2. Ensure your phone is connected to the same Wi-Fi network as the store PC, or start the Cloudflare tunnel on the store PC:
   ```bash
   npm run tunnel
   ```
3. Open the Luminila mobile app, tap **Menu → Server Settings**, enter the store server URL (e.g., `http://192.168.1.100:8090` or `https://xxxx.trycloudflare.com`), and tap **Connect**.

---

## 🗄️ Database Setup (PocketBase)

Luminila uses an embedded, high-performance SQLite database engine (**PocketBase v0.25.0**) running in Write-Ahead Logging (`WAL`) mode, bound to `0.0.0.0:8090`. Everything is stored locally on your machine in `pocketbase/pb_data/data.db`.

### Administrative & Staff Credentials

Luminila features two distinct credential sets:

1. **PocketBase Superuser / Database Admin Console** (`http://127.0.0.1:8090/_/`):
   - **Email**: `admin@luminila.com`
   - **Password**: `password123456`
   - *Use this console for low-level schema inspection, raw records, and database backups.*

2. **Luminila Staff Application Admin** (`/login`):
   - **Email**: `admin@luminila.local`
   - **Password**: `Admin@123456`
   - *Seeded via `src/scripts/create-admin-user.ts` for logging into the POS, Inventory, and ERP interface.*

### Initialization Sequence:
1. Start PocketBase (`npm run dev:pb` or `npm run dev:all`).
2. Run schema initialization and user/role seeding:
   ```bash
   npx tsx src/scripts/init-pocketbase.ts
   npx tsx src/scripts/seed-roles.ts
   npx tsx src/scripts/create-admin-user.ts
   ```
3. All 38 collections, indexes, staff roles, and the administrator account are now ready.

---

## 🧭 Navigation & Showroom Interface

Luminila adapts automatically to desktop monitors, tablets, and mobile devices:

### Desktop Navigation (Sidebar)
On desktop screens, the left sidebar provides direct access to all departments:
- **🏠 Dashboard**: Real-time sales, gross revenue, active cashier shifts, and low-stock alerts.
- **💰 Point of Sale (POS)**: High-speed retail checkout, barcode scanning, and multi-tender payments.
- **📋 Orders & Estimates**: B2B quotations, customer orders, and wholesale tracking.
- **📄 GST Invoices**: Tax-compliant B2B/B2C invoices, PDF printing, and payment recording.
- **🚚 Delivery Challans**: Goods dispatch for job work, inter-branch transfers, exhibitions, and approval.
- **↩️ Returns & Credit Notes**: Customer return processing, GST credit notes, and restock tracking.
- **📦 Inventory & Stock**: Product catalog, variant matrix, cost prices, and stock movements.
- **🏷️ Barcode Labels**: Batch barcode generation (Code128) on thermal jewelry dumbbell tags.
- **📥 Purchase & GRN**: Supplier purchase orders and warehouse Goods Received Notes with QA inspection.
- **👥 Suppliers & Vendors**: Vendor profiles, contact details, and procurement history.
- **👥 Customer CRM**: Customer database, purchase ledgers, and tiered loyalty points.
- **🏦 Banking & Ledger**: Cash drawer reconciliation, bank deposits, and inter-account transfers.
- **👛 Expense Vouchers**: Showroom operating expenses and category accounting.
- **📊 Reports & GST**: Financial analytics, inventory valuation, and GST tax liability reports.
- **💬 WhatsApp**: Sidecar status, QR pairing, and customer message history.
- **⚙️ Settings & Users**: Store configuration, tax rates, staff accounts, and RBAC roles.

### Mobile Navigation (Bottom Nav & Drawer)
On smartphones and small tablets:
- **Bottom Navigation Bar**: Instant thumb access to **Home**, **Stock**, **Invoices**, and a prominent elevated center **POS FAB** button.
- **Slide-Over Drawer**: Tap **Menu** to access all 17 ERP modules grouped logically into Sales & POS, Inventory, Finance, and System.
- **Server Switcher**: Tap **Server Settings** inside the drawer to test latency or switch database endpoints.

---

## 💍 Core Showroom Operations

### 1. Daily Cashier Routine (Shift & Cash Drawer)
1. **Open Shift**: At the start of the business day, open `/pos`. Enter the opening cash float (e.g., ₹5,000) to unlock the terminal.
2. **Mid-Day Adjustments**: If adding cash for change, use **Cash In**. If making a bank deposit or petty cash expense, use **Cash Out** with an explanatory note.
3. **Closing Shift**: At the end of the day, click **Close Shift**. Perform a blind physical cash count and enter the total. The system calculates the variance against expected cash sales and logs the shift summary.

### 2. Point of Sale (POS) Checkout Flow
1. **Add Items**: Scan physical jewelry tags using a barcode scanner or tap the camera icon to use your phone's camera. You can also search by product name or SKU.
2. **Variant Selection**: For items with variants, select the desired ring size, metal tone (Rose Gold, 925 Silver, Yellow Gold), or material.
3. **Customer & Loyalty**: Look up the customer's phone number to earn points or redeem accrued loyalty balance.
4. **Select Payment Mode**: Choose Cash (with dynamic change due calculation), Card, UPI, or dynamic PhonePe QR. *(Note: Each sale currently settles through a single selected tender; multi-mode split tenders are slated for Milestone 3).*
5. **Complete & Print**: Click **Complete Sale**. Print a thermal receipt (58mm/80mm) or generate an official GST tax invoice.

### 3. Printing Barcode Tags for Jewelry
1. Navigate to `/labels`.
2. Select the variants to tag and specify quantities.
3. Choose the label template (Jewelry Dumbbell / Butterfly barbell tags for thermal roll printers, or A4 multi-column sheets).
4. Click **Print Labels**. The system generates Code128 barcodes with SKU, price, and variant specifications.

### 4. B2B Wholesale & Delivery Challans
1. **Create Estimate**: In `/orders`, create a price estimate for wholesale clients.
2. **Convert to Order**: When confirmed, convert the estimate into an active Sales Order.
3. **Dispatch with Delivery Challan**: In `/challan`, generate a delivery challan for transport (job work, exhibition, or inter-branch transfer). If consignment value exceeds ₹50,000, export the E-Way Bill JSON payload.
4. **Issue Tax Invoice**: Convert the order to a legal GST Tax Invoice in `/invoices`.

### 5. Receiving Shipments (Goods Received Notes - GRN)
1. Create a Purchase Order in `/purchase` with agreed vendor costs.
2. When the shipment arrives, click **Receive Goods (GRN)**.
3. Inspect pieces: enter accepted quantity vs rejected quantity with rejection notes (e.g., *"stone loose"* or *"plating blemish"*).
4. Commit the GRN. The system automatically increments variant stock levels and updates the PO status.

---

## ❓ Frequently Asked Questions (FAQ)

**Q: What platforms does Luminila support?**  
A: Luminila supports Windows 10/11, macOS, Linux desktop, and Android (phones and tablets).

**Q: Do I need an internet connection to run Luminila?**  
A: No! Luminila runs on a 100% local database (**PocketBase**). The desktop and showroom counter continue working even if your internet connection goes down. An internet connection is only needed for WhatsApp notifications, Shopify sync, or remote Cloudflare tunnels.

**Q: Can multiple cashiers or showroom sales staff use Luminila simultaneously?**  
A: Yes. PocketBase operates in SQLite `WAL` mode for concurrent read/write operations. Multiple showroom tablets or terminals can connect over your local showroom Wi-Fi network (`http://192.168.1.xxx:8090`) or via a secure Cloudflare tunnel.

**Q: How do I back up my showroom data?**  
A: Go to PocketBase Admin (`http://127.0.0.1:8090/_/`) under **Settings → Backups** and click **Create Backup**. Alternatively, simply copy the `pocketbase/pb_data` folder to a secure flash drive or cloud storage drive.

---

## 🔧 Troubleshooting

### 1. Database Connection Issues
**Issue**: "Cannot connect to database" or network error.
- **Check PocketBase Server**: Verify PocketBase is running on port 8090 (`npm run dev:pb` or `npm run dev:all`).
- **Check Port Availability**: Ensure port 8090 is not blocked by another service.
- **Mobile Devices**: If using an Android device, ensure the server URL in **Menu → Server Settings** points to your PC's LAN IP (`http://192.168.1.xxx:8090`) or active Cloudflare tunnel URL (`https://xxxx.trycloudflare.com`), not `localhost`.

### 2. Camera Barcode Scanner Issues
**Issue**: Camera not activating for barcode scanning.
- **Permissions**: Ensure camera permissions are granted in your browser or Android app settings.
- **HTTPS on Mobile**: Modern mobile browsers require HTTPS for camera access. If accessing remotely, connect via the secure Cloudflare tunnel (`npm run tunnel`).

### 3. WhatsApp Sidecar Issues
**Issue**: WhatsApp status indicates disconnected or QR code not generating.
- **Check Sidecar Process**: Verify the sidecar server is running on port 21465 (`npm run dev:sidecar` or check Tauri sidecar status).
- **Re-Pair Device**: Go to `/whatsapp`, click **Restart Session**, and re-scan the QR code using WhatsApp on your phone (**Linked Devices → Link a Device**).

---

## 🆘 Support & Resources

- **Full Architecture Guide**: [`docs/ARCHITECTURE.md`](file:///e:/Local_GIT_2/luminila_inv_mgmt/docs/ARCHITECTURE.md)
- **Complete Build & Deployment Guide**: [`docs/BUILD_AND_DEPLOYMENT.md`](file:///e:/Local_GIT_2/luminila_inv_mgmt/docs/BUILD_AND_DEPLOYMENT.md)
- **PocketBase Setup Guide**: [`docs/POCKETBASE_SETUP.md`](file:///e:/Local_GIT_2/luminila_inv_mgmt/docs/POCKETBASE_SETUP.md)
- **Features Specification**: [`docs/FEATURES.md`](file:///e:/Local_GIT_2/luminila_inv_mgmt/docs/FEATURES.md)
- **Operational Workflows**: [`docs/APP_WORKING.md`](file:///e:/Local_GIT_2/luminila_inv_mgmt/docs/APP_WORKING.md)
- **Support Contact**: `support@zennila.com`