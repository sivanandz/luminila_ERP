-- =============================================
-- Migration: 016_delivery_challan.sql
-- Delivery Challan (Material Outward) Schema
-- =============================================

-- Challan Types
-- job_work: Goods sent for processing
-- stock_transfer: Movement between locations
-- sale_return: Goods returned by customer
-- exhibition: Items for display/demo
-- approval: Goods on approval basis
-- other: Miscellaneous movements
CREATE TYPE IF NOT EXISTS challan_type AS ENUM ('job_work', 'stock_transfer', 'sale_return', 'exhibition', 'approval', 'other');

-- Challan Status
CREATE TYPE IF NOT EXISTS challan_status AS ENUM ('draft', 'issued', 'in_transit', 'delivered', 'returned', 'cancelled');

-- Challan Number Sequence
CREATE SEQUENCE IF NOT EXISTS challan_number_seq START 1;

-- Generate Challan Number
CREATE OR REPLACE FUNCTION generate_challan_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'DC-' || LPAD(NEXTVAL('challan_number_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Main Delivery Challan Table
CREATE TABLE IF NOT EXISTS delivery_challans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challan_number VARCHAR(20) NOT NULL UNIQUE DEFAULT generate_challan_number(),
    challan_date DATE NOT NULL DEFAULT CURRENT_DATE,
    challan_type challan_type NOT NULL DEFAULT 'other',
    status challan_status NOT NULL DEFAULT 'draft',
    
    -- Consignor (Sender) - Usually the store
    consignor_name VARCHAR(255) NOT NULL,
    consignor_gstin VARCHAR(15),
    consignor_address TEXT,
    consignor_state_code VARCHAR(2),
    
    -- Consignee (Receiver)
    consignee_id UUID, -- Optional link to customers/vendors
    consignee_name VARCHAR(255) NOT NULL,
    consignee_gstin VARCHAR(15),
    consignee_address TEXT,
    consignee_state_code VARCHAR(2),
    place_of_supply VARCHAR(100),
    
    -- References
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    related_challan_id UUID REFERENCES delivery_challans(id) ON DELETE SET NULL, -- For returns
    
    -- Transport Details
    vehicle_number VARCHAR(20),
    transporter_name VARCHAR(255),
    driver_name VARCHAR(100),
    driver_phone VARCHAR(15),
    transport_mode VARCHAR(50) DEFAULT 'road', -- road, rail, air, ship
    eway_bill_number VARCHAR(20),
    eway_bill_date DATE,
    
    -- Totals (calculated from items)
    total_quantity INTEGER DEFAULT 0,
    taxable_value DECIMAL(12,2) DEFAULT 0,
    cgst_amount DECIMAL(10,2) DEFAULT 0,
    sgst_amount DECIMAL(10,2) DEFAULT 0,
    igst_amount DECIMAL(10,2) DEFAULT 0,
    total_value DECIMAL(12,2) DEFAULT 0,
    
    -- Additional Info
    reason TEXT, -- Purpose of movement
    notes TEXT,
    internal_notes TEXT,
    
    -- Timestamps
    expected_delivery_date DATE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Challan Items
CREATE TABLE IF NOT EXISTS delivery_challan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challan_id UUID NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    
    sr_no INTEGER NOT NULL,
    description VARCHAR(500) NOT NULL,
    hsn_code VARCHAR(8),
    
    quantity INTEGER NOT NULL DEFAULT 1,
    unit VARCHAR(10) DEFAULT 'PCS',
    unit_price DECIMAL(10,2) DEFAULT 0,
    taxable_value DECIMAL(10,2) DEFAULT 0,
    
    gst_rate DECIMAL(5,2) DEFAULT 0,
    cgst_rate DECIMAL(5,2) DEFAULT 0,
    cgst_amount DECIMAL(10,2) DEFAULT 0,
    sgst_rate DECIMAL(5,2) DEFAULT 0,
    sgst_amount DECIMAL(10,2) DEFAULT 0,
    igst_rate DECIMAL(5,2) DEFAULT 0,
    igst_amount DECIMAL(10,2) DEFAULT 0,
    
    total DECIMAL(10,2) DEFAULT 0,
    remarks TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_challans_date ON delivery_challans(challan_date);
CREATE INDEX IF NOT EXISTS idx_challans_type ON delivery_challans(challan_type);
CREATE INDEX IF NOT EXISTS idx_challans_status ON delivery_challans(status);
CREATE INDEX IF NOT EXISTS idx_challans_consignee ON delivery_challans(consignee_name);
CREATE INDEX IF NOT EXISTS idx_challan_items_challan ON delivery_challan_items(challan_id);

-- Enable RLS
ALTER TABLE delivery_challans ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_challan_items ENABLE ROW LEVEL SECURITY;

-- Permissive RLS Policies for development
DROP POLICY IF EXISTS "anon_delivery_challans" ON delivery_challans;
CREATE POLICY "anon_delivery_challans" ON delivery_challans FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delivery_challan_items" ON delivery_challan_items;
CREATE POLICY "anon_delivery_challan_items" ON delivery_challan_items FOR ALL USING (true) WITH CHECK (true);

-- Update Trigger
CREATE OR REPLACE FUNCTION update_challan_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS challan_updated_at ON delivery_challans;
CREATE TRIGGER challan_updated_at
    BEFORE UPDATE ON delivery_challans
    FOR EACH ROW
    EXECUTE FUNCTION update_challan_updated_at();
