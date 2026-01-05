-- =====================================================
-- Luminila Inventory Management System
-- Migration: 004_purchase_orders.sql
-- Purpose: Purchase Orders and Goods Received Notes
-- =====================================================

-- PO Status enum
CREATE TYPE po_status AS ENUM ('draft', 'sent', 'partial', 'received', 'cancelled');

-- =====================================================
-- PURCHASE ORDERS
-- =====================================================
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(16) NOT NULL UNIQUE,
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
    
    status po_status DEFAULT 'draft',
    order_date DATE DEFAULT CURRENT_DATE,
    expected_date DATE,
    received_date DATE,
    
    -- Amounts (INR)
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    gst_amount DECIMAL(10,2) DEFAULT 0,
    shipping_cost DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    
    -- Additional
    shipping_address TEXT,
    notes TEXT,
    internal_notes TEXT,
    
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- PURCHASE ORDER ITEMS
-- =====================================================
CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    
    description VARCHAR(500),
    hsn_code VARCHAR(8),
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER DEFAULT 0,
    unit VARCHAR(10) DEFAULT 'PCS',
    unit_price DECIMAL(10,2) NOT NULL,
    gst_rate DECIMAL(5,2) DEFAULT 3.00,
    gst_amount DECIMAL(10,2) DEFAULT 0,
    total_price DECIMAL(10,2) NOT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- GOODS RECEIVED NOTES (GRN)
-- =====================================================
CREATE TABLE goods_received_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(16) NOT NULL UNIQUE,
    po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
    
    received_date DATE DEFAULT CURRENT_DATE,
    received_by VARCHAR(100),
    
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- GRN ITEMS
-- =====================================================
CREATE TABLE grn_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id UUID REFERENCES goods_received_notes(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    
    quantity_received INTEGER NOT NULL,
    quantity_rejected INTEGER DEFAULT 0,
    rejection_reason TEXT,
    
    -- For stock movement tracking
    stock_movement_id UUID REFERENCES stock_movements(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- PO NUMBERING
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS po_seq START 1;
CREATE SEQUENCE IF NOT EXISTS grn_seq START 1;

CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS VARCHAR(16) AS $$
BEGIN
    RETURN 'PO/' || TO_CHAR(CURRENT_DATE, 'YYMM') || '/' || LPAD(NEXTVAL('po_seq')::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_grn_number()
RETURNS VARCHAR(16) AS $$
BEGIN
    RETURN 'GRN/' || TO_CHAR(CURRENT_DATE, 'YYMM') || '/' || LPAD(NEXTVAL('grn_seq')::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGER: Update stock on GRN item creation
-- =====================================================
CREATE OR REPLACE FUNCTION process_grn_item()
RETURNS TRIGGER AS $$
DECLARE
    movement_id UUID;
BEGIN
    -- Only process if there's received quantity
    IF NEW.quantity_received > 0 AND NEW.variant_id IS NOT NULL THEN
        -- Insert stock movement
        INSERT INTO stock_movements (
            variant_id,
            movement_type,
            quantity,
            reference_id,
            source,
            notes
        ) VALUES (
            NEW.variant_id,
            'purchase',
            NEW.quantity_received,
            NEW.grn_id,
            'grn',
            'Goods received via GRN'
        )
        RETURNING id INTO movement_id;
        
        -- Update stock level
        UPDATE product_variants
        SET stock_level = stock_level + NEW.quantity_received
        WHERE id = NEW.variant_id;
        
        -- Link movement to GRN item
        NEW.stock_movement_id := movement_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER grn_item_stock_update
BEFORE INSERT ON grn_items
FOR EACH ROW
EXECUTE FUNCTION process_grn_item();

-- =====================================================
-- TRIGGER: Update PO status based on received quantities
-- =====================================================
CREATE OR REPLACE FUNCTION update_po_status()
RETURNS TRIGGER AS $$
DECLARE
    po_item RECORD;
    total_ordered INTEGER := 0;
    total_received INTEGER := 0;
    parent_po_id UUID;
BEGIN
    -- Get PO ID from GRN
    SELECT po_id INTO parent_po_id FROM goods_received_notes WHERE id = NEW.grn_id;
    
    IF parent_po_id IS NOT NULL THEN
        -- Calculate totals for this PO
        SELECT 
            COALESCE(SUM(quantity_ordered), 0),
            COALESCE(SUM(quantity_received), 0)
        INTO total_ordered, total_received
        FROM purchase_order_items
        WHERE po_id = parent_po_id;
        
        -- Also add current GRN item quantities
        UPDATE purchase_order_items 
        SET quantity_received = quantity_received + NEW.quantity_received
        WHERE id = NEW.po_item_id;
        
        -- Recalculate after update
        SELECT 
            COALESCE(SUM(quantity_ordered), 0),
            COALESCE(SUM(quantity_received), 0)
        INTO total_ordered, total_received
        FROM purchase_order_items
        WHERE po_id = parent_po_id;
        
        -- Update PO status
        IF total_received >= total_ordered THEN
            UPDATE purchase_orders 
            SET status = 'received', received_date = CURRENT_DATE, updated_at = NOW()
            WHERE id = parent_po_id;
        ELSIF total_received > 0 THEN
            UPDATE purchase_orders 
            SET status = 'partial', updated_at = NOW()
            WHERE id = parent_po_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER grn_item_update_po_status
AFTER INSERT ON grn_items
FOR EACH ROW
EXECUTE FUNCTION update_po_status();

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_po_number ON purchase_orders(po_number);
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_date ON purchase_orders(order_date DESC);
CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);
CREATE INDEX idx_grn_po ON goods_received_notes(po_id);
CREATE INDEX idx_grn_items_grn ON grn_items(grn_id);

-- =====================================================
-- AUTO-UPDATE TIMESTAMP
-- =====================================================
CREATE TRIGGER po_updated_at
BEFORE UPDATE ON purchase_orders
FOR EACH ROW
EXECUTE FUNCTION update_invoice_timestamp();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn_items ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users
CREATE POLICY "Authenticated users can manage POs"
ON purchase_orders FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage PO items"
ON purchase_order_items FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage GRNs"
ON goods_received_notes FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage GRN items"
ON grn_items FOR ALL
USING (auth.role() = 'authenticated');
