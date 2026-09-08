# Luminila - Fashion Jewelry Inventory Manager

<div align="center">

  **Premium inventory management for fashion jewelry brands**

  [![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
  [![PocketBase](https://img.shields.io/badge/PocketBase-Local_DB-violet)](https://pocketbase.io)
  [![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
</div>

---

## 📚 Documentation Suite

For detailed technical and operational documentation, consult the dedicated guides:

| Guide | Description | Link |
|---|---|---|
| **System Architecture** | Technical topology, Tauri v2, Next.js 16, PocketBase 38-collection data tier, services & RBAC | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **State of the Project** | Current release status, module maturity matrix, audit findings & technical debt | [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) |
| **Features Specification** | Complete functional specification across 15 domains (POS, Shifts, GST Invoicing, CRM, etc.) | [docs/FEATURES.md](docs/FEATURES.md) |
| **Workflows & Operations** | Service startup orchestration (`dev:all`), daily cashier flows, GRN, B2B, and maintenance | [docs/APP_WORKING.md](docs/APP_WORKING.md) |
| **Documentation Hub** | Master index and audience guide | [docs/README.md](docs/README.md) |
| **User Guide** | End-user showroom manual | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) |

---

## ✨ Features

### Multi-Channel Sync

- **Point of Sale (PoS)** - Touch-friendly interface with barcode scanning
- **Shopify Integration** - Real-time inventory sync via GraphQL API
- **WhatsApp Orders** - Parse customer messages and track orders
- **WooCommerce** - Optional fallback e-commerce integration

### Inventory Management

- Multi-variant products (size, color, material)
- Low stock alerts with configurable thresholds
- Batch barcode label printing (Code128)
- Bulk import/export (CSV/Excel)

### Premium Design

- **Midnight Navy** (#001F3F) + **Moonstone Silver** (#D1D1D1) + **Champagne Gold** (#F7E7CE)
- Glassmorphism effects and micro-animations
- Dark mode support
- Mobile-responsive layouts

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18.17+
- [Rust](https://rustup.rs/) (for Tauri desktop builds)
- [PocketBase](https://pocketbase.io/docs/) v0.26+ (included in `pocketbase/` directory)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/luminila_inv_mgmt.git
   cd luminila_inv_mgmt
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp env.example.txt .env.local
   # Edit .env.local — PocketBase URL defaults to http://127.0.0.1:8090
   ```

4. **Start PocketBase + Next.js together**

   ```bash
   npm run dev:all
   ```

   Or separately:

   ```bash
   # Terminal 1 — PocketBase
   ./pocketbase/pocketbase serve

   # Terminal 2 — Next.js
   npm run dev
   ```

5. **Build for desktop (Tauri)**

   ```bash
   npm run tauri:build
   ```

---

## 📁 Project Structure

```
luminila_inv_mgmt/
├── src/
│   ├── app/                    # Next.js 16 App Router pages
│   │   ├── page.tsx           # Dashboard
│   │   ├── inventory/         # Product management
│   │   ├── pos/               # Point of Sale
│   │   ├── orders/            # Order tracking
│   │   ├── invoices/          # GST invoices
│   │   ├── purchase/          # Purchase orders
│   │   ├── customers/         # Customer management
│   │   ├── vendors/           # Vendor management
│   │   ├── returns/           # Returns & credit notes
│   │   ├── challan/           # Delivery challans
│   │   ├── labels/            # Barcode printing
│   │   ├── reports/           # Analytics & reports
│   │   ├── settings/          # Configuration
│   │   └── login/             # Authentication
│   ├── components/
│   │   ├── layout/            # Sidebar, Header, ProtectedRoute
│   │   ├── dashboard/         # KPI Cards, Charts
│   │   └── ui/                # Reusable shadcn/base-ui components
│   ├── contexts/
│   │   └── AuthContext.tsx     # Auth state (PocketBase authStore)
│   ├── lib/
│   │   ├── pocketbase.ts      # PocketBase client singleton
│   │   ├── analytics.ts       # Dashboard KPIs & queries
│   │   ├── products.ts        # Product CRUD
│   │   ├── customers.ts       # Customer CRUD
│   │   ├── pos-sales.ts       # POS transactions
│   │   ├── invoice.ts         # GST invoicing
│   │   ├── sync/              # Shopify & WooCommerce sync
│   │   └── ...                # Other service modules
│   └── types/
│       └── database.ts        # TypeScript types
├── pocketbase/
│   ├── pocketbase(.exe)       # PocketBase binary
│   ├── pb_data/               # SQLite database (auto-created)
│   └── pb_migrations/         # Schema migrations
├── src-tauri/                 # Tauri desktop wrapper
├── scripts/                   # Utility scripts
├── next.config.ts
└── package.json
```

---

## 🗄️ Database

Luminila uses **PocketBase** as an embedded local database (SQLite under the hood). The schema is defined via collections and managed through migration scripts.

Key collections:

| Collection | Purpose |
| --- | --- |
| `products` | Base product catalog |
| `product_variants` | Size/color/material variants with stock levels |
| `customers` | Customer information |
| `vendors` | Supplier management |
| `sales` | POS transaction records |
| `sales_orders` | B2B / online sales orders |
| `invoices` | GST-compliant invoices |
| `purchase_orders` | Purchase order tracking |
| `stock_movements` | Inventory audit trail |

### Schema Setup

```bash
# Initialize all collections (requires PocketBase running)
npx tsx src/scripts/init-pocketbase.ts

# Or sync schema to latest definition
npx tsx src/scripts/sync-pb-schema.ts
```

---

## 🔧 Configuration

### PocketBase Setup

PocketBase runs locally and requires no account or cloud service.

1. The binary is included in the `pocketbase/` directory
2. On first run, visit `http://127.0.0.1:8090/_/` to create an admin account
3. Run the schema initialization script (see above)

### Shopify Setup (Optional)

1. In Shopify Admin, go to **Apps > Develop apps > Create app**
2. Configure scopes: `read_inventory`, `write_inventory`, `read_products`
3. Copy the access token to `.env.local`

---

## 🎨 Theme Customization

The Luminila theme is defined in `src/app/globals.css`:

```css
:root {
  --lum-navy: #001F3F;      /* Primary */
  --lum-silver: #D1D1D1;    /* Secondary */
  --lum-gold: #F7E7CE;      /* Accent */
}
```

---

## 📖 Roadmap

- [x] Project setup with Tauri v2 + Next.js 16
- [x] Luminila brand theme
- [x] Dashboard with analytics
- [x] Inventory management UI
- [x] Point of Sale interface
- [x] Barcode label generation
- [x] PocketBase integration
- [x] GST invoicing
- [x] Purchase orders & GRN
- [ ] Shopify sync engine
- [ ] WhatsApp automation (WPPConnect)
- [ ] Offline mode with sync
- [ ] Mobile PWA version

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">
  Made with ❤️ for <strong>Zennila</strong>
</div>
