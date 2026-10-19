# Luminila Luxury Jewels - Standalone E-Commerce Storefront

This storefront is a bespoke, high-performance e-commerce frontend directly synced with the **Luminila ERP & Inventory System**.

## 🚀 Key Features
- **Omnichannel Stock Pool**: Real-time stock counts aggregated across Central Warehouse + all POS counters.
- **Channel Pricing**: Automatically loads `website` channel rates with MRP strikethrough and discount tags.
- **Dual Checkout System**:
  1. **Instant Online Prepaid**: Instant gateway intent with automated stock lock.
  2. **1-Click WhatsApp Concierge**: Instant cart serialization sent to the store's verified styling phone.
- **Dual-Mode Deployment Architecture**:
  - **Tier 1 (Free & Legal)**: Deployed to **Cloudflare Pages** ($0/month, unlimited bandwidth, 100% commercially permitted).
  - **Tier 2 (Self-Hosted)**: 1-click containerized migration to **Hostinger VPS** using Docker.

---

## 🛠️ Local Development

```bash
cd storefront
npm install
npm run dev
```
Runs at `http://localhost:3001` (avoids conflict with ERP at `localhost:3000`).

---

## ☁️ Deployment Option 1: Cloudflare Pages ($0/mo, Commercial Ready)

1. Push this repo to GitHub.
2. In Cloudflare Dashboard -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
3. Set Build Settings:
   - **Framework Preset**: Next.js (Static HTML Export)
   - **Root directory**: `storefront`
   - **Build command**: `npm run build`
   - **Build output directory**: `out`
4. Set Environment Variables:
   - `NEXT_PUBLIC_POCKETBASE_URL`: Your PocketBase URL (e.g. `https://api.yourdomain.com` or Cloudflare Tunnel)
   - `NEXT_PUBLIC_WHATSAPP_PHONE`: `919876543210`
5. Click **Save and Deploy**. Done!

---

## 🖥️ Deployment Option 2: VPS / Dedicated Server (Unified Single-Domain Architecture)

When running the entire suite (Storefront + ERP + PocketBase) under your custom domain (e.g. `shop.yourdomain.com`):

### 1. Docker / Process Topology
- **Storefront (Next.js)**: Runs on `http://127.0.0.1:3001`
- **ERP Backend & Admin API**: Runs on `http://127.0.0.1:3000`
- **PocketBase SQLite Engine**: Runs on `http://127.0.0.1:8091`

### 2. Unified Nginx Reverse Proxy Configuration
Save this to `/etc/nginx/sites-available/shop.yourdomain.com`:

```nginx
server {
    listen 80;
    server_name shop.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name shop.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/shop.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shop.yourdomain.com/privkey.pem;

    client_max_body_size 50M;

    # 1. Storefront Web App
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    # 2. ERP Management Backend & Storefront Order/CMS APIs
    location /api/storefront/ {
        proxy_pass http://127.0.0.1:3000/api/storefront/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    # 3. PocketBase API & Media Storage
    location /api/pb/ {
        proxy_pass http://127.0.0.1:8091/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

### 3. Benefits of this Architecture
- **Single SSL Certificate**: No need to purchase or configure separate certificates for 3 subdomains.
- **Zero CORS Issues**: All requests to `/`, `/api/storefront/`, and `/api/pb/` originate from the exact same origin (`shop.yourdomain.com`).
- **No Mixed Content Warnings**: Everything is natively encrypted through the HTTPS proxy.

