-- Create Purchase Order Status Enum
CREATE TYPE po_status AS ENUM ('draft', 'sent', 'partial', 'received', 'cancelled');

-- Create Purchase Orders Table
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(20) NOT NULL UNIQUE,
    vendor_id UUID REFERENCES vendors(id),
    
    order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expected_date TIMESTAMP WITH TIME ZONE,
    received_date TIMESTAMP WITH TIME ZONE,
    
    status po_status DEFAULT 'draft',
    
    -- Financials
    subtotal DECIMAL(12,2) DEFAULT 0,
    gst_amount DECIMAL(12,2) DEFAULT 0,
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) DEFAULT 0,
    
    shipping_address TEXT,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Purchase Order Items Table
CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id),
    
    description TEXT,
    hsn_code VARCHAR(20) DEFAULT '7113',
    
    -- Quantities
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER DEFAULT 0,
    unit VARCHAR(10) DEFAULT 'PCS',
    
    -- Financials
    unit_price DECIMAL(10,2) NOT NULL,
    gst_rate DECIMAL(5,2) DEFAULT 3.00,
    gst_amount DECIMAL(12,2) DEFAULT 0,
    total_price DECIMAL(12,2) NOT NULL
);

-- Create Goods Received Notes (GRN) Table
CREATE TABLE goods_received_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(20) NOT NULL UNIQUE,
    po_id UUID REFERENCES purchase_orders(id),
    vendor_id UUID REFERENCES vendors(id),
    
    received_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    received_by VARCHAR(255),
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create GRN Items Table
CREATE TABLE grn_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id UUID REFERENCES goods_received_notes(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES purchase_order_items(id),
    variant_id UUID REFERENCES product_variants(id),
    
    quantity_received INTEGER NOT NULL,
    quantity_rejected INTEGER DEFAULT 0,
    rejection_reason TEXT
);

-- Indexes
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_order_number ON purchase_orders(po_number);
CREATE INDEX idx_grn_po ON goods_received_notes(po_id);

-- Sequence for PO Number
CREATE SEQUENCE po_seq START 1;

-- Function to generate PO Number (PO-00001)
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'PO-' || LPAD(nextval('po_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Sequence for GRN Number
CREATE SEQUENCE grn_seq START 1;

-- Function to generate GRN Number (GRN-00001)
CREATE OR REPLACE FUNCTION generate_grn_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'GRN-' || LPAD(nextval('grn_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on purchase_orders
CREATE TRIGGER update_purchase_orders_updated_at
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Simple: allow authenticated users to do everything)
CREATE POLICY "Enable all access for authenticated users" ON purchase_orders
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Enable all access for authenticated users" ON purchase_order_items
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Enable all access for authenticated users" ON goods_received_notes
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Enable all access for authenticated users" ON grn_items
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
