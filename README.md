# Luminila - Fashion Jewelry Inventory Manager

<div align="center">
  <img src="docs/logo-placeholder.png" alt="Luminila Logo" width="120" />
  
  **Premium inventory management for fashion jewelry brands**
  
  [![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
  [![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
  [![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?logo=supabase)](https://supabase.com)
  [![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
</div>

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

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (for Tauri)
- [Supabase Account](https://supabase.com) (free tier)

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
   # Edit .env.local with your Supabase credentials
   ```

4. **Run in development mode**

   ```bash
   npm run tauri dev
   ```

5. **Build for production**

   ```bash
   npm run tauri build
   ```

---

## 📁 Project Structure

```
luminila_inv_mgmt/
├── src/
│   ├── app/                    # Next.js 15 App Router pages
│   │   ├── page.tsx           # Dashboard
│   │   ├── inventory/         # Product management
│   │   ├── pos/               # Point of Sale
│   │   ├── orders/            # Order tracking
│   │   ├── whatsapp/          # WhatsApp integration
│   │   ├── labels/            # Barcode printing
│   │   └── settings/          # Configuration
│   ├── components/
│   │   ├── layout/            # Sidebar, Header
│   │   ├── pos/               # Cart, Scanner (coming)
│   │   └── ui/                # Reusable components
│   ├── lib/
│   │   ├── supabase.ts        # Database client
│   │   ├── utils.ts           # Helper functions
│   │   └── sync/              # E-commerce sync (coming)
│   └── types/
│       └── database.ts        # TypeScript types
├── src-tauri/
│   ├── src/main.rs            # Tauri entry point
│   ├── tauri.conf.json        # Tauri configuration
│   └── binaries/              # WPPConnect sidecar (coming)
├── supabase/
│   └── migrations/            # Database schema
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## 🗄️ Database Schema

Run the following SQL in your Supabase SQL Editor:

```sql
-- See supabase/migrations/001_initial_schema.sql
```

Key tables:

- `products` - Base product information
- `product_variants` - Size/color/material variants
- `vendors` - Supplier management
- `sales` - Transaction records
- `sale_items` - Line items per sale
- `stock_movements` - Audit trail

---

## 🔧 Configuration

### Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL migration in the SQL Editor
3. Copy your project URL and anon key to `.env.local`

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

- [x] Project setup with Tauri v2 + Next.js 15
- [x] Luminila brand theme
- [x] Dashboard with analytics
- [x] Inventory management UI
- [x] Point of Sale interface
- [x] Barcode label generation
- [ ] Supabase integration
- [ ] Shopify sync engine
- [ ] WhatsApp automation (WPPConnect)
- [ ] Offline mode with sync
- [ ] Mobile PWA version

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

---

<div align="center">
  Made with ❤️ for <strong>Zennila</strong>
</div>
