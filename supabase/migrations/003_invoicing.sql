-- =====================================================
-- Luminila Inventory Management System
-- Migration: 003_invoicing.sql
-- Purpose: GST-compliant invoicing system for India
-- =====================================================

-- Invoice types enum
CREATE TYPE invoice_type AS ENUM ('regular', 'credit_note', 'debit_note');

-- =====================================================
-- INVOICES TABLE (GST Compliant)
-- =====================================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(16) NOT NULL UNIQUE,
    invoice_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invoice_type invoice_type DEFAULT 'regular',
    
    -- Seller Info (loaded from store settings)
    seller_gstin VARCHAR(15),
    seller_name VARCHAR(255),
    seller_address TEXT,
    seller_state_code VARCHAR(2),
    
    -- Buyer Info
    buyer_name VARCHAR(255),
    buyer_gstin VARCHAR(15),
    buyer_phone VARCHAR(15),
    buyer_email VARCHAR(255),
    buyer_address TEXT,
    buyer_state_code VARCHAR(2),
    place_of_supply VARCHAR(2),
    
    -- Linked sale (optional - can create standalone invoices)
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    
    -- Amounts (All in INR)
    taxable_value DECIMAL(12,2) NOT NULL DEFAULT 0,
    cgst_amount DECIMAL(10,2) DEFAULT 0,
    sgst_amount DECIMAL(10,2) DEFAULT 0,
    igst_amount DECIMAL(10,2) DEFAULT 0,
    cess_amount DECIMAL(10,2) DEFAULT 0,
    total_tax DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    shipping_charges DECIMAL(10,2) DEFAULT 0,
    grand_total DECIMAL(12,2) NOT NULL DEFAULT 0,
    amount_in_words VARCHAR(500),
    
    -- Additional Fields
    is_reverse_charge BOOLEAN DEFAULT FALSE,
    transport_mode VARCHAR(50),
    vehicle_number VARCHAR(20),
    
    -- Payment info
    payment_terms VARCHAR(100),
    due_date DATE,
    is_paid BOOLEAN DEFAULT FALSE,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    
    -- Metadata
    notes TEXT,
    internal_notes TEXT,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INVOICE LINE ITEMS
-- =====================================================
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    
    -- Item details
    sr_no INTEGER NOT NULL,
    description VARCHAR(500) NOT NULL,
    hsn_code VARCHAR(8) DEFAULT '7113', -- Default: Jewelry
    
    -- Quantity & Price
    quantity DECIMAL(10,3) NOT NULL,
    unit VARCHAR(10) DEFAULT 'PCS',
    unit_price DECIMAL(10,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    
    -- GST breakdown (Jewelry: 3% total)
    taxable_amount DECIMAL(10,2) NOT NULL,
    gst_rate DECIMAL(5,2) DEFAULT 3.00,
    cgst_rate DECIMAL(5,2) DEFAULT 1.5,
    cgst_amount DECIMAL(10,2) DEFAULT 0,
    sgst_rate DECIMAL(5,2) DEFAULT 1.5,
    sgst_amount DECIMAL(10,2) DEFAULT 0,
    igst_rate DECIMAL(5,2) DEFAULT 0,
    igst_amount DECIMAL(10,2) DEFAULT 0,
    cess_rate DECIMAL(5,2) DEFAULT 0,
    cess_amount DECIMAL(10,2) DEFAULT 0,
    
    total_amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INVOICE NUMBERING
-- =====================================================

-- Sequence for invoice numbers per financial year
CREATE SEQUENCE IF NOT EXISTS invoice_seq_2526 START 1; -- FY 2025-26
CREATE SEQUENCE IF NOT EXISTS invoice_seq_2627 START 1; -- FY 2026-27

-- Function to get current financial year prefix
CREATE OR REPLACE FUNCTION get_fy_prefix()
RETURNS VARCHAR(5) AS $$
BEGIN
    IF EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
        RETURN TO_CHAR(CURRENT_DATE, 'YY') || TO_CHAR(CURRENT_DATE + INTERVAL '1 year', 'YY');
    ELSE
        RETURN TO_CHAR(CURRENT_DATE - INTERVAL '1 year', 'YY') || TO_CHAR(CURRENT_DATE, 'YY');
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS VARCHAR(16) AS $$
DECLARE
    fy_prefix VARCHAR(5);
    seq_name VARCHAR(20);
    seq_num INTEGER;
BEGIN
    fy_prefix := get_fy_prefix();
    seq_name := 'invoice_seq_' || fy_prefix;
    
    -- Try to get next value from appropriate sequence
    BEGIN
        EXECUTE 'SELECT NEXTVAL($1)' INTO seq_num USING seq_name;
    EXCEPTION WHEN undefined_table THEN
        -- Create sequence if it doesn't exist
        EXECUTE 'CREATE SEQUENCE IF NOT EXISTS ' || seq_name || ' START 1';
        EXECUTE 'SELECT NEXTVAL($1)' INTO seq_num USING seq_name;
    END;
    
    RETURN 'INV/' || SUBSTRING(fy_prefix, 1, 2) || '-' || SUBSTRING(fy_prefix, 3, 2) || '/' || LPAD(seq_num::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STORE SETTINGS TABLE (for GST details)
-- =====================================================
CREATE TABLE IF NOT EXISTS store_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default store settings
INSERT INTO store_settings (key, value) VALUES
    ('store_name', 'Luminila Jewelry'),
    ('store_gstin', ''),
    ('store_address', ''),
    ('store_city', ''),
    ('store_state', ''),
    ('store_state_code', ''),
    ('store_pincode', ''),
    ('store_phone', ''),
    ('store_email', ''),
    ('store_pan', ''),
    ('bank_name', ''),
    ('bank_account_no', ''),
    ('bank_ifsc', ''),
    ('bank_branch', ''),
    ('invoice_prefix', 'INV'),
    ('invoice_terms', 'Payment due within 30 days'),
    ('invoice_footer', 'Thank you for your business!'),
    ('store_logo', ''),
    ('default_print_mode', 'regular')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_date ON invoices(invoice_date DESC);
CREATE INDEX idx_invoices_buyer ON invoices(buyer_name);
CREATE INDEX idx_invoices_sale ON invoices(sale_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_invoice_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_invoice_timestamp();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

-- Policies (allow authenticated users full access for now)
CREATE POLICY "Authenticated users can read invoices"
ON invoices FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create invoices"
ON invoices FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update invoices"
ON invoices FOR UPDATE
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read invoice items"
ON invoice_items FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage invoice items"
ON invoice_items FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read store settings"
ON store_settings FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update store settings"
ON store_settings FOR UPDATE
USING (auth.role() = 'authenticated');
