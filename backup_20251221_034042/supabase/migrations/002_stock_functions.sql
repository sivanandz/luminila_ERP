-- Supabase Edge Function: decrement_stock RPC
-- Run this in Supabase SQL Editor after initial schema

-- Function to atomically decrement stock
CREATE OR REPLACE FUNCTION decrement_stock(
  p_variant_id UUID,
  p_quantity INT
)
RETURNS VOID AS $$
BEGIN
  UPDATE product_variants 
  SET stock_level = stock_level - p_quantity
  WHERE id = p_variant_id;
  
  -- Log the movement
  INSERT INTO stock_movements (variant_id, movement_type, quantity, source)
  VALUES (p_variant_id, 'sale', -p_quantity, 'pos');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to atomically increment stock (for returns/purchases)
CREATE OR REPLACE FUNCTION increment_stock(
  p_variant_id UUID,
  p_quantity INT,
  p_reason TEXT DEFAULT 'purchase'
)
RETURNS VOID AS $$
BEGIN
  UPDATE product_variants 
  SET stock_level = stock_level + p_quantity
  WHERE id = p_variant_id;
  
  -- Log the movement
  INSERT INTO stock_movements (variant_id, movement_type, quantity, source, notes)
  VALUES (p_variant_id, p_reason, p_quantity, 'manual', p_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to set stock level (for inventory count)
CREATE OR REPLACE FUNCTION set_stock(
  p_variant_id UUID,
  p_new_quantity INT,
  p_reason TEXT DEFAULT 'adjustment'
)
RETURNS VOID AS $$
DECLARE
  v_current INT;
  v_diff INT;
BEGIN
  -- Get current stock
  SELECT stock_level INTO v_current 
  FROM product_variants 
  WHERE id = p_variant_id;
  
  -- Calculate difference
  v_diff := p_new_quantity - COALESCE(v_current, 0);
  
  -- Update stock
  UPDATE product_variants 
  SET stock_level = p_new_quantity
  WHERE id = p_variant_id;
  
  -- Log the movement
  INSERT INTO stock_movements (variant_id, movement_type, quantity, source, notes)
  VALUES (p_variant_id, 'adjustment', v_diff, 'manual', p_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION decrement_stock(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_stock(UUID, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION set_stock(UUID, INT, TEXT) TO authenticated;
