-- =====================================================
-- Luminila Inventory Management System
-- Migration: 008_returns.sql
-- Purpose: Sales Returns and Credit Notes
-- =====================================================

-- =====================================================
-- CREDIT NOTES TABLE
-- =====================================================
CREATE TABLE credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Reference
    credit_note_number VARCHAR(50) UNIQUE NOT NULL,
    original_invoice_id UUID REFERENCES invoices(id),
    original_sale_id UUID REFERENCES sales(id),
    
    -- Reason
    return_reason VARCHAR(100) NOT NULL, -- defective, wrong_item, customer_request, etc.
    notes TEXT,
    
    -- Party details (copied from invoice)
    buyer_name VARCHAR(255) NOT NULL,
    buyer_address TEXT,
    buyer_gstin VARCHAR(15),
    buyer_state_code VARCHAR(2),
    
    -- Amounts
    taxable_value DECIMAL(12,2) NOT NULL DEFAULT 0,
    cgst_amount DECIMAL(12,2) DEFAULT 0,
    sgst_amount DECIMAL(12,2) DEFAULT 0,
    igst_amount DECIMAL(12,2) DEFAULT 0,
    total_tax DECIMAL(12,2) DEFAULT 0,
    grand_total DECIMAL(12,2) NOT NULL DEFAULT 0,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, refunded, cancelled
    
    -- Refund tracking
    refund_method VARCHAR(50), -- cash, card, upi, credit
    refund_reference VARCHAR(100),
    refunded_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    created_by UUID,
    approved_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- CREDIT NOTE ITEMS
-- =====================================================
CREATE TABLE credit_note_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_note_id UUID REFERENCES credit_notes(id) ON DELETE CASCADE,
    
    -- Product reference
    variant_id UUID REFERENCES product_variants(id),
    original_invoice_item_id UUID REFERENCES invoice_items(id),
    
    -- Item details
    description VARCHAR(500) NOT NULL,
    hsn_code VARCHAR(10) DEFAULT '7113',
    
    -- Quantity & Price
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    taxable_amount DECIMAL(12,2) NOT NULL,
    
    -- Tax
    gst_rate DECIMAL(5,2) DEFAULT 3,
    cgst_amount DECIMAL(12,2) DEFAULT 0,
    sgst_amount DECIMAL(12,2) DEFAULT 0,
    igst_amount DECIMAL(12,2) DEFAULT 0,
    
    total_amount DECIMAL(12,2) NOT NULL,
    
    -- Stock restored
    stock_restored BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- SEQUENCE FOR CREDIT NOTE NUMBERS
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS credit_note_seq START 1;

CREATE OR REPLACE FUNCTION generate_credit_note_number()
RETURNS TRIGGER AS $$
DECLARE
    v_year TEXT := to_char(CURRENT_DATE, 'YY');
    v_month TEXT := to_char(CURRENT_DATE, 'MM');
    v_seq INT := nextval('credit_note_seq');
BEGIN
    NEW.credit_note_number := 'CN/' || v_year || v_month || '/' || LPAD(v_seq::TEXT, 5, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_credit_note_number
BEFORE INSERT ON credit_notes
FOR EACH ROW
WHEN (NEW.credit_note_number IS NULL OR NEW.credit_note_number = '')
EXECUTE FUNCTION generate_credit_note_number();

-- =====================================================
-- TRIGGER: Restore stock on return approval
-- =====================================================
CREATE OR REPLACE FUNCTION restore_stock_on_return()
RETURNS TRIGGER AS $$
BEGIN
    -- Only trigger when status changes to 'approved'
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status <> 'approved') THEN
        -- Restore stock for each item
        UPDATE credit_note_items cni
        SET stock_restored = TRUE
        WHERE cni.credit_note_id = NEW.id AND cni.stock_restored = FALSE;
        
        -- Actually update stock levels
        UPDATE product_variants pv
        SET stock_level = stock_level + cni.quantity,
            updated_at = NOW()
        FROM credit_note_items cni
        WHERE cni.credit_note_id = NEW.id
          AND cni.variant_id = pv.id
          AND cni.stock_restored = FALSE;
        
        -- Log stock movement
        INSERT INTO stock_movements (variant_id, quantity, movement_type, reference_id, notes)
        SELECT 
            cni.variant_id,
            cni.quantity,
            'return',
            NEW.id,
            'Stock restored from credit note ' || NEW.credit_note_number
        FROM credit_note_items cni
        WHERE cni.credit_note_id = NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_note_stock_restore
AFTER UPDATE ON credit_notes
FOR EACH ROW
EXECUTE FUNCTION restore_stock_on_return();

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_credit_notes_invoice ON credit_notes(original_invoice_id);
CREATE INDEX idx_credit_notes_sale ON credit_notes(original_sale_id);
CREATE INDEX idx_credit_notes_status ON credit_notes(status);
CREATE INDEX idx_credit_notes_created ON credit_notes(created_at DESC);
CREATE INDEX idx_credit_note_items_cn ON credit_note_items(credit_note_id);
CREATE INDEX idx_credit_note_items_variant ON credit_note_items(variant_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage credit notes"
ON credit_notes FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage credit note items"
ON credit_note_items FOR ALL
USING (auth.role() = 'authenticated');
