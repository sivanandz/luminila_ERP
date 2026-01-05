-- Luminila Inventory Management System
-- Database Schema v1.0
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- PRODUCTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  base_price DECIMAL(10,2) NOT NULL,
  cost_price DECIMAL(10,2),
  image_url TEXT,
  barcode_data TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- PRODUCT VARIANTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  sku_suffix TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  material TEXT,
  size TEXT,
  color TEXT,
  price_adjustment DECIMAL(10,2) DEFAULT 0,
  stock_level INT DEFAULT 0,
  low_stock_threshold INT DEFAULT 5,
  shopify_inventory_id TEXT,
  woocommerce_product_id INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, sku_suffix)
);

-- =============================================
-- VENDORS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- VENDOR PRODUCTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS vendor_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  vendor_sku TEXT,
  vendor_price DECIMAL(10,2),
  lead_time_days INT DEFAULT 7
);

-- =============================================
-- SALES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel TEXT CHECK (channel IN ('pos', 'shopify', 'woocommerce', 'whatsapp')) NOT NULL,
  channel_order_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  subtotal DECIMAL(10,2) NOT NULL,
  discount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  payment_method TEXT,
  status TEXT CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- SALE ITEMS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id),
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- STOCK MOVEMENTS TABLE (Audit Trail)
-- =============================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id UUID REFERENCES product_variants(id),
  movement_type TEXT CHECK (movement_type IN ('sale', 'purchase', 'adjustment', 'return', 'sync')) NOT NULL,
  quantity INT NOT NULL,
  reference_id UUID,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_stock ON product_variants(stock_level);
CREATE INDEX IF NOT EXISTS idx_sales_channel ON sales(channel);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON stock_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);

-- =============================================
-- TRIGGERS
-- =============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sales_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Enable RLS on all tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (allow all operations for now)
-- In production, add role-based restrictions

CREATE POLICY "Allow authenticated read" ON products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert" ON products
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON products
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated delete" ON products
  FOR DELETE TO authenticated USING (true);

-- Repeat for other tables
CREATE POLICY "Allow authenticated all" ON product_variants
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated all" ON vendors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated all" ON vendor_products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated all" ON sales
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated all" ON sale_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated all" ON stock_movements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================
-- ENABLE REALTIME
-- =============================================

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE product_variants;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;
ALTER PUBLICATION supabase_realtime ADD TABLE stock_movements;

-- =============================================
-- SAMPLE DATA (Optional - for testing)
-- =============================================

-- Uncomment to insert sample data
/*
INSERT INTO products (sku, name, category, base_price, description) VALUES
  ('LUM-EAR-001', 'Pearl Drop Earrings', 'Earrings', 1290, 'Elegant pearl drop earrings with gold-plated hooks'),
  ('LUM-NEC-023', 'Layered Chain Necklace', 'Necklaces', 2450, 'Multi-layer sterling silver chain necklace'),
  ('LUM-BRC-015', 'Crystal Tennis Bracelet', 'Bracelets', 1890, 'Sparkling crystal tennis bracelet'),
  ('LUM-RNG-008', 'Solitaire Statement Ring', 'Rings', 990, 'Bold solitaire ring in rose gold finish');

INSERT INTO product_variants (product_id, sku_suffix, variant_name, material, stock_level) 
SELECT id, 'S', 'Small', 'Gold-Plated', 20 FROM products WHERE sku = 'LUM-EAR-001';
INSERT INTO product_variants (product_id, sku_suffix, variant_name, material, stock_level) 
SELECT id, 'M', 'Medium', 'Gold-Plated', 15 FROM products WHERE sku = 'LUM-EAR-001';
INSERT INTO product_variants (product_id, sku_suffix, variant_name, material, stock_level) 
SELECT id, 'L', 'Large', 'Gold-Plated', 10 FROM products WHERE sku = 'LUM-EAR-001';
*/
