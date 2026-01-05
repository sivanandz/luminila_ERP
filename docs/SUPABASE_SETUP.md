# Supabase Setup Guide for Luminila

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign in or create account
3. Click **New Project**
4. Enter:
   - **Name**: `luminila-inventory`
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose nearest to you
5. Click **Create new project**
6. Wait 2-3 minutes for setup

## Step 2: Get API Credentials

1. In Supabase dashboard, go to **Settings** → **API Keys**
2. If you don't have new keys, click **Create new API Keys**
3. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **Publishable key** (starts with `sb_publishable_...`)

> **Note**: Supabase now uses new publishable keys (`sb_publishable_xxx`) instead of legacy `anon` keys. Both work, but new keys are recommended.

## Step 3: Configure Environment

Create `.env.local` in project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxx
```

> Both `sb_publishable_xxx` (new) and `eyJhbG...` (legacy anon) keys work.

## Step 4: Run Database Migrations

1. In Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Copy and paste contents of:
   - `supabase/migrations/001_initial_schema.sql`
   - Click **Run**
4. Then paste and run:
   - `supabase/migrations/002_stock_functions.sql`

## Step 5: Add Sample Data (Optional)

Run this SQL to add test products:

```sql
INSERT INTO products (sku, name, category, base_price, description) VALUES
  ('LUM-EAR-001', 'Pearl Drop Earrings', 'Earrings', 1290, 'Elegant pearl drop earrings'),
  ('LUM-NEC-023', 'Layered Chain Necklace', 'Necklaces', 2450, 'Multi-layer chain necklace'),
  ('LUM-BRC-015', 'Crystal Tennis Bracelet', 'Bracelets', 1890, 'Sparkling crystal bracelet'),
  ('LUM-RNG-008', 'Statement Ring', 'Rings', 990, 'Bold solitaire ring');

-- Add variants for first product
INSERT INTO product_variants (product_id, sku_suffix, variant_name, material, stock_level, price_adjustment) 
SELECT id, 'GP-S', 'Gold Small', 'Gold-Plated', 20, 0 FROM products WHERE sku = 'LUM-EAR-001';

INSERT INTO product_variants (product_id, sku_suffix, variant_name, material, stock_level, price_adjustment) 
SELECT id, 'GP-M', 'Gold Medium', 'Gold-Plated', 15, 200 FROM products WHERE sku = 'LUM-EAR-001';

INSERT INTO product_variants (product_id, sku_suffix, variant_name, material, stock_level, price_adjustment) 
SELECT id, 'SS-S', 'Silver Small', 'Sterling Silver', 12, 300 FROM products WHERE sku = 'LUM-EAR-001';

-- Variants for necklace
INSERT INTO product_variants (product_id, sku_suffix, variant_name, size, stock_level) 
SELECT id, '16', '16 inch', '16"', 10 FROM products WHERE sku = 'LUM-NEC-023';

INSERT INTO product_variants (product_id, sku_suffix, variant_name, size, stock_level) 
SELECT id, '18', '18 inch', '18"', 8 FROM products WHERE sku = 'LUM-NEC-023';

-- Simple variants for others
INSERT INTO product_variants (product_id, sku_suffix, variant_name, stock_level) 
SELECT id, 'DEF', 'Default', 25 FROM products WHERE sku = 'LUM-BRC-015';

INSERT INTO product_variants (product_id, sku_suffix, variant_name, size, stock_level) 
SELECT id, 'S7', 'Size 7', '7', 18 FROM products WHERE sku = 'LUM-RNG-008';

INSERT INTO product_variants (product_id, sku_suffix, variant_name, size, stock_level) 
SELECT id, 'S8', 'Size 8', '8', 15 FROM products WHERE sku = 'LUM-RNG-008';
```

## Step 6: Verify Setup

Run in Supabase SQL Editor:

```sql
SELECT p.name, v.variant_name, v.stock_level 
FROM product_variants v
JOIN products p ON v.product_id = p.id
ORDER BY p.name;
```

You should see products with their variants!

## Step 7: Enable Realtime (Optional)

1. Go to **Database** → **Replication**
2. Enable realtime for:
   - `products`
   - `product_variants`
   - `sales`
   - `stock_movements`

## Done

Now start the app:

```bash
npm run tauri dev
```
