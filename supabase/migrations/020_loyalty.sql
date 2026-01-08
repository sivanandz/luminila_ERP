-- Migration: Loyalty Points System
-- Purpose: Customer loyalty program with points, tiers, and redemptions

-- =============================================
-- Loyalty Tiers
-- =============================================
CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    min_points INTEGER NOT NULL DEFAULT 0,
    max_points INTEGER,
    multiplier DECIMAL(3,2) DEFAULT 1.00,  -- Points earning multiplier
    discount_percent DECIMAL(5,2) DEFAULT 0,  -- Tier discount on purchases
    color TEXT DEFAULT '#C4A661',  -- Display color
    icon TEXT,
    benefits TEXT[],  -- Array of benefit descriptions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Customer Loyalty Accounts
-- =============================================
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tier_id UUID REFERENCES loyalty_tiers(id),
    total_points_earned INTEGER DEFAULT 0,
    total_points_redeemed INTEGER DEFAULT 0,
    current_balance INTEGER DEFAULT 0,
    lifetime_value DECIMAL(12,2) DEFAULT 0,
    member_since TIMESTAMPTZ DEFAULT NOW(),
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_id)
);

-- =============================================
-- Points Transactions
-- =============================================
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust', 'expire', 'bonus')),
    points INTEGER NOT NULL,  -- Positive for earn/bonus, negative for redeem/expire
    balance_after INTEGER NOT NULL,
    reference_type TEXT,  -- 'sale', 'invoice', 'return', 'manual', 'promotion'
    reference_id UUID,    -- ID of the related sale/invoice/etc
    description TEXT,
    performed_by UUID REFERENCES user_profiles(id),
    expires_at TIMESTAMPTZ,  -- When these points expire (if applicable)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Loyalty Settings
-- =============================================
CREATE TABLE IF NOT EXISTS loyalty_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    points_per_rupee DECIMAL(5,2) DEFAULT 1.00,  -- Points earned per ₹100 spent
    redemption_value DECIMAL(5,2) DEFAULT 0.25,  -- Value of 1 point in ₹
    min_redemption_points INTEGER DEFAULT 100,   -- Minimum points to redeem
    max_redemption_percent DECIMAL(5,2) DEFAULT 50,  -- Max % of bill payable with points
    points_validity_days INTEGER DEFAULT 365,    -- Days before points expire
    signup_bonus INTEGER DEFAULT 50,             -- Points on account creation
    birthday_bonus INTEGER DEFAULT 100,          -- Points on birthday
    referral_bonus INTEGER DEFAULT 200,          -- Points for referral
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Default Data
-- =============================================

-- Insert default tiers
INSERT INTO loyalty_tiers (name, min_points, max_points, multiplier, discount_percent, color, benefits) VALUES
    ('Bronze', 0, 999, 1.00, 0, '#CD7F32', ARRAY['Earn 1 point per ₹100', 'Birthday bonus']),
    ('Silver', 1000, 4999, 1.25, 2, '#C0C0C0', ARRAY['Earn 1.25x points', '2% discount', 'Early access to sales']),
    ('Gold', 5000, 19999, 1.50, 5, '#FFD700', ARRAY['Earn 1.5x points', '5% discount', 'Free gift wrapping', 'Priority support']),
    ('Platinum', 20000, NULL, 2.00, 10, '#E5E4E2', ARRAY['Earn 2x points', '10% discount', 'Exclusive events', 'Free shipping', 'Personal stylist'])
ON CONFLICT DO NOTHING;

-- Insert default settings
INSERT INTO loyalty_settings (points_per_rupee, redemption_value, min_redemption_points, max_redemption_percent, points_validity_days, signup_bonus)
VALUES (1.00, 0.25, 100, 50, 365, 50)
ON CONFLICT DO NOTHING;

-- =============================================
-- Indexes
-- =============================================
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_customer ON loyalty_accounts(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_tier ON loyalty_accounts(tier_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_account ON loyalty_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_type ON loyalty_transactions(type);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_created ON loyalty_transactions(created_at);

-- =============================================
-- RLS Policies
-- =============================================
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read tiers
CREATE POLICY "loyalty_tiers_select" ON loyalty_tiers FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to manage accounts
CREATE POLICY "loyalty_accounts_all" ON loyalty_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Allow authenticated users to manage transactions
CREATE POLICY "loyalty_transactions_all" ON loyalty_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Allow authenticated users to read settings
CREATE POLICY "loyalty_settings_select" ON loyalty_settings FOR SELECT TO authenticated USING (true);

-- =============================================
-- Function: Update tier based on points
-- =============================================
CREATE OR REPLACE FUNCTION update_loyalty_tier()
RETURNS TRIGGER AS $$
DECLARE
    new_tier_id UUID;
BEGIN
    -- Find appropriate tier based on total points earned
    SELECT id INTO new_tier_id
    FROM loyalty_tiers
    WHERE NEW.total_points_earned >= min_points
      AND (max_points IS NULL OR NEW.total_points_earned <= max_points)
    ORDER BY min_points DESC
    LIMIT 1;

    -- Update tier if changed
    IF new_tier_id IS DISTINCT FROM NEW.tier_id THEN
        NEW.tier_id := new_tier_id;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_loyalty_tier
    BEFORE UPDATE ON loyalty_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_loyalty_tier();

-- =============================================
-- Function: Auto-create loyalty account for customers
-- =============================================
CREATE OR REPLACE FUNCTION auto_create_loyalty_account()
RETURNS TRIGGER AS $$
DECLARE
    bronze_tier_id UUID;
    signup_pts INTEGER;
BEGIN
    -- Get bronze tier ID
    SELECT id INTO bronze_tier_id FROM loyalty_tiers WHERE name = 'Bronze' LIMIT 1;
    
    -- Get signup bonus from settings
    SELECT signup_bonus INTO signup_pts FROM loyalty_settings WHERE is_active = true LIMIT 1;
    signup_pts := COALESCE(signup_pts, 0);

    -- Create loyalty account
    INSERT INTO loyalty_accounts (customer_id, tier_id, total_points_earned, current_balance)
    VALUES (NEW.id, bronze_tier_id, signup_pts, signup_pts);

    -- Record signup bonus transaction if any
    IF signup_pts > 0 THEN
        INSERT INTO loyalty_transactions (account_id, type, points, balance_after, description)
        SELECT la.id, 'bonus', signup_pts, signup_pts, 'Welcome bonus'
        FROM loyalty_accounts la WHERE la.customer_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create loyalty account for new customers
CREATE TRIGGER trg_auto_create_loyalty
    AFTER INSERT ON customers
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_loyalty_account();
