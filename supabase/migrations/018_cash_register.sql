-- Migration: Cash Register & Tender Tracking
-- Purpose: Enable cash drawer shifts, tender tracking, and reconciliation

-- =============================================
-- Cash Register Shifts Table
-- =============================================
CREATE TABLE IF NOT EXISTS cash_register_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    terminal_id VARCHAR(50), -- Optional: for multi-terminal setups
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(12,2),
    expected_balance DECIMAL(12,2),
    
    -- Transaction totals during shift
    total_cash_sales DECIMAL(12,2) DEFAULT 0,
    total_card_sales DECIMAL(12,2) DEFAULT 0,
    total_upi_sales DECIMAL(12,2) DEFAULT 0,
    total_cash_refunds DECIMAL(12,2) DEFAULT 0,
    
    -- Cash operations
    cash_added DECIMAL(12,2) DEFAULT 0,      -- Cash added to drawer
    cash_removed DECIMAL(12,2) DEFAULT 0,    -- Cash removed from drawer
    
    -- Reconciliation
    variance DECIMAL(12,2),                  -- Difference between expected and actual
    variance_notes TEXT,                     -- Explanation for variance
    
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'suspended')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- Add Tender Tracking to Sales
-- =============================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_tendered DECIMAL(12,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_given DECIMAL(12,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS register_shift_id UUID REFERENCES cash_register_shifts(id);

-- =============================================
-- Cash Drawer Operations Log
-- =============================================
CREATE TABLE IF NOT EXISTS cash_drawer_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES cash_register_shifts(id) ON DELETE CASCADE,
    operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('add', 'remove', 'sale', 'refund')),
    amount DECIMAL(12,2) NOT NULL,
    reason TEXT,
    performed_by UUID REFERENCES user_profiles(id),
    performed_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- Indexes
-- =============================================
CREATE INDEX IF NOT EXISTS idx_shifts_user_id ON cash_register_shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON cash_register_shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at ON cash_register_shifts(opened_at);
CREATE INDEX IF NOT EXISTS idx_sales_shift_id ON sales(register_shift_id);
CREATE INDEX IF NOT EXISTS idx_drawer_ops_shift ON cash_drawer_operations(shift_id);

-- =============================================
-- RLS Policies
-- =============================================
ALTER TABLE cash_register_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawer_operations ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage their own shifts
CREATE POLICY "Users can manage their shifts" ON cash_register_shifts
    FOR ALL USING (auth.uid() = user_id OR auth.uid() IN (
        SELECT user_id FROM user_roles WHERE role_id IN (
            SELECT id FROM roles WHERE name IN ('admin', 'manager')
        )
    ));

-- Allow viewing drawer operations for own shifts or admin/manager
CREATE POLICY "Users can view drawer operations" ON cash_drawer_operations
    FOR ALL USING (
        shift_id IN (SELECT id FROM cash_register_shifts WHERE user_id = auth.uid())
        OR auth.uid() IN (
            SELECT user_id FROM user_roles WHERE role_id IN (
                SELECT id FROM roles WHERE name IN ('admin', 'manager')
            )
        )
    );

-- =============================================
-- Trigger to update shift totals
-- =============================================
CREATE OR REPLACE FUNCTION update_shift_totals()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.register_shift_id IS NOT NULL THEN
        UPDATE cash_register_shifts
        SET 
            total_cash_sales = COALESCE(total_cash_sales, 0) + 
                CASE WHEN NEW.payment_method = 'cash' THEN NEW.total ELSE 0 END,
            total_card_sales = COALESCE(total_card_sales, 0) + 
                CASE WHEN NEW.payment_method = 'card' THEN NEW.total ELSE 0 END,
            total_upi_sales = COALESCE(total_upi_sales, 0) + 
                CASE WHEN NEW.payment_method = 'upi' THEN NEW.total ELSE 0 END,
            updated_at = now()
        WHERE id = NEW.register_shift_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_shift_totals ON sales;
CREATE TRIGGER trigger_update_shift_totals
    AFTER INSERT ON sales
    FOR EACH ROW
    EXECUTE FUNCTION update_shift_totals();
