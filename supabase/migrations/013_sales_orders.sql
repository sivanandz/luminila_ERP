-- =====================================================
-- Luminila Inventory Management System
-- Migration: 013_sales_orders.sql
-- Purpose: Sales Orders and Estimates (Quotations) Management
-- =====================================================

-- ENUMS
CREATE TYPE order_status AS ENUM ('draft', 'sent', 'confirmed', 'shipped', 'delivered', 'cancelled', 'invoiced');
CREATE TYPE order_type AS ENUM ('estimate', 'sales_order');

-- =====================================================
-- SALES ORDERS TABLE
-- =====================================================
CREATE TABLE sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(20) NOT NULL UNIQUE, -- EST-0001 or ORD-0001
    order_type order_type DEFAULT 'sales_order',
    
    -- Customer Info
    customer_id UUID REFERENCES customers(id),
    customer_name VARCHAR(255),
    customer_phone VARCHAR(20),
    customer_email VARCHAR(255),
    billing_address TEXT,
    shipping_address TEXT,
    
    -- Order Details
    order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE, -- Specifically for estimates
    expected_delivery_date TIMESTAMP WITH TIME ZONE,
    
    status order_status DEFAULT 'draft',
    
    -- Financials (All in INR)
    subtotal DECIMAL(12,2) DEFAULT 0,
    tax_total DECIMAL(12,2) DEFAULT 0,
    discount_total DECIMAL(12,2) DEFAULT 0,
    shipping_charges DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) DEFAULT 0,
    
    -- Metadata
    notes TEXT,
    internal_notes TEXT,
    created_by UUID, -- References auth.users implicitly
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ORDER ITEMS TABLE
-- =====================================================
CREATE TABLE sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
    
    -- Product Link
    product_id UUID REFERENCES products(id),
    variant_id UUID REFERENCES product_variants(id),
    
    -- Item Details (Snapshot)
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL, -- Price at time of order
    tax_rate DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL
);

-- =====================================================
-- INDEXES & TRIGGERS
-- =====================================================

CREATE INDEX idx_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX idx_sales_orders_status ON sales_orders(status);
CREATE INDEX idx_sales_orders_type ON sales_orders(order_type);
CREATE INDEX idx_sales_order_items_order ON sales_order_items(order_id);

-- Auto-update updated_at
CREATE TRIGGER sales_orders_updated_at
BEFORE UPDATE ON sales_orders
FOR EACH ROW
EXECUTE FUNCTION update_invoice_timestamp(); -- Reusing existing function

-- =====================================================
-- NUMBER GENERATION (EST/ORD)
-- =====================================================

CREATE SEQUENCE IF NOT EXISTS so_seq START 1;
CREATE SEQUENCE IF NOT EXISTS est_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL THEN
        IF NEW.order_type = 'estimate' THEN
            NEW.order_number := 'EST-' || LPAD(nextval('est_seq')::TEXT, 5, '0');
        ELSE
            NEW.order_number := 'ORD-' || LPAD(nextval('so_seq')::TEXT, 5, '0');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_order_number
BEFORE INSERT ON sales_orders
FOR EACH ROW
EXECUTE FUNCTION generate_order_number();

-- =====================================================
-- RLS POLICIES
-- =====================================================
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage orders"
ON sales_orders FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage order items"
ON sales_order_items FOR ALL
USING (auth.role() = 'authenticated');
