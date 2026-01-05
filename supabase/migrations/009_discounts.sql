-- =====================================================
-- Luminila Inventory Management System
-- Migration: 009_discounts.sql
-- Purpose: Discounts, Coupons, and Promotional Offers
-- =====================================================

-- =====================================================
-- DISCOUNTS TABLE
-- =====================================================
CREATE TABLE discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identification
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Type and Value
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage', -- percentage, fixed, buy_x_get_y
    value DECIMAL(10,2) NOT NULL, -- Percentage or fixed amount
    max_discount DECIMAL(12,2), -- Cap for percentage discounts
    
    -- Conditions
    min_purchase DECIMAL(12,2) DEFAULT 0, -- Minimum order value
    min_items INTEGER DEFAULT 0, -- Minimum number of items
    
    -- Applicability
    applies_to VARCHAR(20) DEFAULT 'all', -- all, category, product, customer_type
    applies_to_ids TEXT[], -- Category IDs, Product IDs, or customer types
    
    -- Usage Limits
    usage_limit INTEGER, -- Max total uses (null = unlimited)
    per_customer_limit INTEGER DEFAULT 1, -- Max uses per customer
    used_count INTEGER DEFAULT 0,
    
    -- Validity
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- DISCOUNT USAGE TRACKING
-- =====================================================
CREATE TABLE discount_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id UUID REFERENCES discounts(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    
    -- Applied Amount
    discount_amount DECIMAL(12,2) NOT NULL,
    order_value DECIMAL(12,2) NOT NULL,
    
    -- Timestamp
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- TRIGGER: Update usage count
-- =====================================================
CREATE OR REPLACE FUNCTION increment_discount_usage()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE discounts
    SET used_count = used_count + 1,
        updated_at = NOW()
    WHERE id = NEW.discount_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER discount_used
AFTER INSERT ON discount_usage
FOR EACH ROW
EXECUTE FUNCTION increment_discount_usage();

-- =====================================================
-- TRIGGER: Update timestamp
-- =====================================================
CREATE OR REPLACE FUNCTION update_discount_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER discount_updated
BEFORE UPDATE ON discounts
FOR EACH ROW
EXECUTE FUNCTION update_discount_timestamp();

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_discounts_code ON discounts(code);
CREATE INDEX idx_discounts_active ON discounts(is_active, start_date, end_date);
CREATE INDEX idx_discount_usage_discount ON discount_usage(discount_id);
CREATE INDEX idx_discount_usage_customer ON discount_usage(customer_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read discounts"
ON discounts FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage discounts"
ON discounts FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage discount usage"
ON discount_usage FOR ALL
USING (auth.role() = 'authenticated');

-- =====================================================
-- SAMPLE DISCOUNTS (Optional)
-- =====================================================
INSERT INTO discounts (code, name, discount_type, value, description) VALUES
('WELCOME10', 'Welcome Discount', 'percentage', 10, 'First purchase 10% off'),
('FLAT500', 'Flat ₹500 Off', 'fixed', 500, 'Flat discount on orders above ₹5000');

UPDATE discounts SET min_purchase = 5000 WHERE code = 'FLAT500';
