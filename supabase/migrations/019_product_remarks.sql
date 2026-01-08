-- Migration: Product-wise Remarks
-- Purpose: Allow adding remarks/notes to individual items in sales and invoices

-- Add remarks column to sale_items table
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Add remarks column to invoice_items table  
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Add remarks column to order_items table (for sales orders/estimates)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Add remarks column to purchase_order_items table
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Create index for searching remarks
CREATE INDEX IF NOT EXISTS idx_sale_items_remarks ON sale_items(remarks) WHERE remarks IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_items_remarks ON invoice_items(remarks) WHERE remarks IS NOT NULL;
