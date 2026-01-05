-- =====================================================
-- Luminila Inventory Management System
-- Migration: 006_activity_logs.sql
-- Purpose: Activity logging for audit trail
-- =====================================================

-- =====================================================
-- ACTIVITY LOGS TABLE
-- =====================================================
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Action details
    action VARCHAR(50) NOT NULL, -- create, update, delete, login, logout, export, print, etc.
    entity_type VARCHAR(50) NOT NULL, -- product, invoice, order, customer, sale, etc.
    entity_id UUID, -- Optional reference to the affected record
    
    -- Metadata
    description TEXT NOT NULL,
    old_values JSONB, -- Previous values for update/delete
    new_values JSONB, -- New values for create/update
    
    -- Context
    user_id UUID,
    user_name VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read logs
CREATE POLICY "Authenticated users can read activity logs"
ON activity_logs FOR SELECT
USING (auth.role() = 'authenticated');

-- Allow insert from service role or authenticated
CREATE POLICY "Service can insert activity logs"
ON activity_logs FOR INSERT
WITH CHECK (true);

-- =====================================================
-- HELPER FUNCTION: Log Activity
-- =====================================================
CREATE OR REPLACE FUNCTION log_activity(
    p_action VARCHAR(50),
    p_entity_type VARCHAR(50),
    p_entity_id UUID DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO activity_logs (
        action, 
        entity_type, 
        entity_id, 
        description,
        old_values,
        new_values,
        user_id
    )
    VALUES (
        p_action,
        p_entity_type,
        p_entity_id,
        COALESCE(p_description, p_action || ' ' || p_entity_type),
        p_old_values,
        p_new_values,
        auth.uid()
    )
    RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGERS: Auto-log key operations
-- =====================================================

-- Log invoice creation
CREATE OR REPLACE FUNCTION log_invoice_created()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activity_logs (action, entity_type, entity_id, description, new_values)
    VALUES (
        'create',
        'invoice',
        NEW.id,
        'Invoice ' || NEW.invoice_number || ' created for ' || NEW.buyer_name,
        jsonb_build_object(
            'invoice_number', NEW.invoice_number,
            'buyer_name', NEW.buyer_name,
            'grand_total', NEW.grand_total
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_created_log
AFTER INSERT ON invoices
FOR EACH ROW
EXECUTE FUNCTION log_invoice_created();

-- Log sale creation
CREATE OR REPLACE FUNCTION log_sale_created()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activity_logs (action, entity_type, entity_id, description, new_values)
    VALUES (
        'create',
        'sale',
        NEW.id,
        'Sale completed: ' || NEW.total::text,
        jsonb_build_object(
            'total', NEW.total,
            'payment_method', NEW.payment_method,
            'customer_name', NEW.customer_name
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sale_created_log
AFTER INSERT ON sales
FOR EACH ROW
EXECUTE FUNCTION log_sale_created();

-- Log product changes
CREATE OR REPLACE FUNCTION log_product_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO activity_logs (action, entity_type, entity_id, description, new_values)
        VALUES ('create', 'product', NEW.id, 'Product created: ' || NEW.name, 
            jsonb_build_object('name', NEW.name, 'sku', NEW.sku));
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO activity_logs (action, entity_type, entity_id, description, old_values, new_values)
        VALUES ('update', 'product', NEW.id, 'Product updated: ' || NEW.name,
            jsonb_build_object('name', OLD.name, 'sku', OLD.sku),
            jsonb_build_object('name', NEW.name, 'sku', NEW.sku));
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO activity_logs (action, entity_type, entity_id, description, old_values)
        VALUES ('delete', 'product', OLD.id, 'Product deleted: ' || OLD.name,
            jsonb_build_object('name', OLD.name, 'sku', OLD.sku));
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_changes_log
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW
EXECUTE FUNCTION log_product_changes();

-- Log PO status changes
CREATE OR REPLACE FUNCTION log_po_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status <> NEW.status THEN
        INSERT INTO activity_logs (action, entity_type, entity_id, description, old_values, new_values)
        VALUES (
            'status_change',
            'purchase_order',
            NEW.id,
            'PO ' || NEW.po_number || ' status: ' || OLD.status || ' → ' || NEW.status,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER po_status_log
AFTER UPDATE ON purchase_orders
FOR EACH ROW
EXECUTE FUNCTION log_po_status_change();
