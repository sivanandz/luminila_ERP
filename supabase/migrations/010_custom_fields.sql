-- =====================================================
-- Luminila Inventory Management System
-- Migration: 010_custom_fields.sql
-- Purpose: Generalized ERP - Custom Categories & Attributes
-- =====================================================

-- =====================================================
-- CATEGORIES TABLE (User-defined, hierarchical)
-- =====================================================
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE,
    description TEXT,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    sort_order INTEGER DEFAULT 0,
    icon VARCHAR(50), -- Lucide icon name
    color VARCHAR(20), -- Hex color
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- PRODUCT ATTRIBUTES (User-defined custom fields)
-- =====================================================
CREATE TABLE product_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE,
    attribute_type VARCHAR(20) NOT NULL DEFAULT 'text', -- text, select, number, boolean, date
    options JSONB, -- For select type: ["Option 1", "Option 2"]
    default_value TEXT,
    is_required BOOLEAN DEFAULT FALSE,
    is_filterable BOOLEAN DEFAULT TRUE,
    is_visible_on_product BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- PRODUCT ATTRIBUTE VALUES (Links products to attributes)
-- =====================================================
CREATE TABLE product_attribute_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES product_attributes(id) ON DELETE CASCADE,
    value TEXT,
    UNIQUE(product_id, attribute_id)
);

-- =====================================================
-- UPDATE PRODUCTS TABLE
-- =====================================================
-- Add category reference (replace hardcoded category string)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- =====================================================
-- TRIGGERS
-- =====================================================
CREATE OR REPLACE FUNCTION update_category_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER category_updated
BEFORE UPDATE ON categories
FOR EACH ROW
EXECUTE FUNCTION update_category_timestamp();

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_active ON categories(is_active);
CREATE INDEX idx_product_attributes_type ON product_attributes(attribute_type);
CREATE INDEX idx_product_attribute_values_product ON product_attribute_values(product_id);
CREATE INDEX idx_product_attribute_values_attribute ON product_attribute_values(attribute_id);
CREATE INDEX idx_products_category_id ON products(category_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_attribute_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage categories"
ON categories FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage product_attributes"
ON product_attributes FOR ALL
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage product_attribute_values"
ON product_attribute_values FOR ALL
USING (auth.role() = 'authenticated');

-- =====================================================
-- SEED DEFAULT CATEGORIES (Can be customized by user)
-- =====================================================
INSERT INTO categories (name, slug, sort_order) VALUES
('Electronics', 'electronics', 1),
('Clothing', 'clothing', 2),
('Accessories', 'accessories', 3),
('Home & Office', 'home-office', 4),
('Other', 'other', 99);

-- =====================================================
-- SEED COMMON ATTRIBUTES
-- =====================================================
INSERT INTO product_attributes (name, slug, attribute_type, options, is_filterable) VALUES
('Material', 'material', 'select', '["Metal", "Plastic", "Wood", "Fabric", "Leather", "Glass", "Other"]', true),
('Color', 'color', 'select', '["Black", "White", "Silver", "Gold", "Blue", "Red", "Green", "Brown", "Other"]', true),
('Size', 'size', 'text', null, true),
('Weight', 'weight', 'text', null, false),
('Brand', 'brand', 'text', null, true);
