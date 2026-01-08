-- =====================================================
-- Luminila Inventory Management System
-- Migration: 015_dev_rls_bypass.sql
-- Purpose: Allow anonymous access for local development
-- WARNING: Remove or disable these policies in production!
-- =====================================================

-- =====================================================
-- CUSTOMERS
-- =====================================================
CREATE POLICY "Allow anonymous access to customers"
ON customers FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to customer_interactions"
ON customer_interactions FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- VENDORS
-- =====================================================
CREATE POLICY "Allow anonymous access to vendors"
ON vendors FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to vendor_products"
ON vendor_products FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- RETURNS / CREDIT NOTES
-- =====================================================
CREATE POLICY "Allow anonymous access to credit_notes"
ON credit_notes FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to credit_note_items"
ON credit_note_items FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- INVOICES
-- =====================================================
CREATE POLICY "Allow anonymous access to invoices"
ON invoices FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to invoice_items"
ON invoice_items FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- SALES ORDERS
-- =====================================================
CREATE POLICY "Allow anonymous access to sales_orders"
ON sales_orders FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to sales_order_items"
ON sales_order_items FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- PURCHASE ORDERS
-- =====================================================
CREATE POLICY "Allow anonymous access to purchase_orders"
ON purchase_orders FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to purchase_order_items"
ON purchase_order_items FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to goods_received_notes"
ON goods_received_notes FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to grn_items"
ON grn_items FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- OTHER CORE TABLES (as needed)
-- =====================================================
CREATE POLICY "Allow anonymous access to products"
ON products FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to product_variants"
ON product_variants FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to sales"
ON sales FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to sale_items"
ON sale_items FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to stock_movements"
ON stock_movements FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anonymous access to activity_logs"
ON activity_logs FOR ALL
USING (true)
WITH CHECK (true);

-- =====================================================
-- NOTE: Run this migration in your Supabase project 
-- via the SQL Editor to enable anonymous access.
-- =====================================================
