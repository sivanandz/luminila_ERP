-- =====================================================
-- Luminila Inventory Management System
-- Migration: 005_customers.sql
-- Purpose: Customer CRM - profiles, purchase history
-- =====================================================

-- =====================================================
-- CUSTOMERS TABLE
-- =====================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Info
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(15),
    email VARCHAR(255),
    
    -- Address
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    state_code VARCHAR(2),
    pincode VARCHAR(10),
    
    -- Business (for B2B)
    company_name VARCHAR(255),
    gstin VARCHAR(15),
    pan VARCHAR(10),
    
    -- CRM Fields
    customer_type VARCHAR(20) DEFAULT 'retail', -- retail, wholesale, vip
    date_of_birth DATE,
    anniversary DATE,
    notes TEXT,
    tags TEXT[], -- Array of tags for segmentation
    
    -- Loyalty
    loyalty_points INTEGER DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    
    -- Preferences
    preferred_contact VARCHAR(20) DEFAULT 'phone', -- phone, email, whatsapp
    opt_in_marketing BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    source VARCHAR(50) DEFAULT 'pos', -- pos, website, whatsapp, import
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- LINK EXISTING SALES TO CUSTOMERS
-- =====================================================
-- Add customer_id to sales table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales' AND column_name = 'customer_id'
    ) THEN
        ALTER TABLE sales ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- =====================================================
-- CUSTOMER INTERACTIONS (Activity Log)
-- =====================================================
CREATE TABLE customer_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    
    interaction_type VARCHAR(50) NOT NULL, -- purchase, inquiry, complaint, follow_up, reminder
    description TEXT,
    
    -- Optional links
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- TRIGGER: Update customer totals on sale
-- =====================================================
CREATE OR REPLACE FUNCTION update_customer_on_sale()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.customer_id IS NOT NULL THEN
        UPDATE customers
        SET 
            total_spent = total_spent + NEW.total,
            total_orders = total_orders + 1,
            updated_at = NOW()
        WHERE id = NEW.customer_id;
        
        -- Log interaction
        INSERT INTO customer_interactions (customer_id, interaction_type, description, sale_id)
        VALUES (NEW.customer_id, 'purchase', 'Sale completed', NEW.id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sale_update_customer
AFTER INSERT ON sales
FOR EACH ROW
EXECUTE FUNCTION update_customer_on_sale();

-- =====================================================
-- AUTO-UPDATE TIMESTAMP
-- =====================================================
CREATE OR REPLACE FUNCTION update_customer_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customer_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
EXECUTE FUNCTION update_customer_timestamp();

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_gstin ON customers(gstin);
CREATE INDEX idx_customers_type ON customers(customer_type);
CREATE INDEX idx_customers_dob ON customers(date_of_birth);
CREATE INDEX idx_customers_anniversary ON customers(anniversary);
CREATE INDEX idx_customer_interactions_customer ON customer_interactions(customer_id);
CREATE INDEX idx_sales_customer ON sales(customer_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage customers"
ON customers FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage interactions"
ON customer_interactions FOR ALL
USING (auth.role() = 'authenticated');

-- =====================================================
-- VIEW: Customer with latest purchase
-- =====================================================
CREATE OR REPLACE VIEW customer_summary AS
SELECT 
    c.*,
    (
        SELECT MAX(created_at) 
        FROM sales 
        WHERE customer_id = c.id
    ) as last_purchase_date,
    (
        SELECT COUNT(*) 
        FROM sales 
        WHERE customer_id = c.id
    ) as purchase_count
FROM customers c;
