# Luminila User Guide

## Quick Start

### 1. First Launch

When you first open Luminila, you'll see the **Dashboard** with:

- Today's sales summary
- Low stock alerts
- Recent transactions
- Quick action buttons

### 2. Connect to Supabase

Before using the app, connect to your database:

1. Go to **Settings** → **Integrations**
2. Enter your Supabase URL and Anon Key
3. Click **Test Connection**
4. If successful, click **Save**

---

## Features Guide

### Dashboard

The dashboard gives you an at-a-glance view of:

- **Total Products** - Active items in inventory
- **Today's Sales** - Number of transactions today
- **Revenue** - Total sales amount today
- **Low Stock Items** - Products below threshold

### Inventory Management

**View Products**

- Browse all products in a grid layout
- Filter by category using tabs
- Search by name or SKU

**Add New Product**

1. Click **Add Product** button
2. Fill in SKU, name, category, price
3. Add variants (size, color, material)
4. Set stock levels per variant
5. Click **Create Product**

**Bulk Import (CSV)**

1. Click **Import** button
2. Download the template
3. Fill in your products
4. Upload the CSV file

### Point of Sale (PoS)

**Scan Products**

1. Click **Start Scanner**
2. Point camera at barcode
3. Item adds to cart automatically

**Manual Search**

1. Click **Search**
2. Type product name or SKU
3. Click to add to cart

**Complete Sale**

1. Adjust quantities as needed
2. Apply discount (optional)
3. Select payment method
4. Click **Complete Sale**
5. Print receipt if needed

### Barcode Labels

**Generate Labels**

1. Go to **Labels** page
2. Select products to print
3. Set quantity per product
4. Click **Add to Queue**
5. Click **Print Labels**

*Note: Use 2" x 1" thermal labels for best results*

### Orders

**View Orders**

- See all orders across channels
- Filter by status or channel
- Click an order for details

**Order Statuses**

- Pending → Confirmed → Shipped → Delivered
- Cancelled orders marked in red

### WhatsApp Integration

**Connect WhatsApp**

1. Go to **WhatsApp** page
2. Click **Connect**
3. Scan QR code with your phone
4. Wait for connection confirmation

**Auto-Replies**

- Toggle on/off in sidebar
- System detects order intent
- Sends automated responses

### Settings

**Store Configuration**

- Store name and contact info
- Default currency (₹ INR)

**Integrations**

- Supabase database
- Shopify sync
- WooCommerce sync

**Notifications**

- Low stock threshold
- Desktop notifications
- Email alerts (optional)

**Appearance**

- Light / Dark / System theme

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Global Search | `Ctrl + K` |
| New Sale | `Ctrl + N` |
| Focus Scanner | `F2` |
| Complete Sale | `Ctrl + Enter` |

---

## Troubleshooting

**Camera not working?**

- Check browser permissions
- Ensure no other app is using camera
- Try refreshing the page

**Barcode not scanning?**

- Ensure good lighting
- Hold barcode steady
- Try different distance

**Sync not working?**

- Check internet connection
- Verify API keys in Settings
- Try manual sync

**Data not loading?**

- Check Supabase connection
- Verify credentials
- Check browser console for errors

---

## Support

For help, contact: <support@zennila.com>

Version: 1.0.0
