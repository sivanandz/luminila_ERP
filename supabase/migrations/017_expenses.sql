-- Expenses and Accounting Schema

-- Enum for payment modes
CREATE TYPE expense_payment_mode AS ENUM ('cash', 'card', 'upi', 'bank_transfer', 'cheque', 'other');

-- Expense Categories (e.g., Rent, Salaries)
CREATE TABLE expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Expenses Table
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_number VARCHAR(20) NOT NULL UNIQUE,
    date DATE DEFAULT CURRENT_DATE,
    category_id UUID REFERENCES expense_categories(id),
    amount DECIMAL(12,2) NOT NULL,
    payment_mode expense_payment_mode DEFAULT 'cash',
    payee VARCHAR(255),
    description TEXT,
    receipt_url TEXT,
    reference_number VARCHAR(100), -- Invoice no, Transaction ID
    created_by UUID, -- Reference to auth.users if needed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_category ON expenses(category_id);

-- Enable RLS
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Development RLS Policy (Permissive)
CREATE POLICY "Allow anonymous access" ON expense_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anonymous access" ON expenses FOR ALL USING (true) WITH CHECK (true);

-- Sequence for Expense Numbering (EXP-0001)
CREATE SEQUENCE expense_number_seq;

CREATE OR REPLACE FUNCTION generate_expense_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.expense_number IS NULL THEN
        NEW.expense_number := 'EXP-' || LPAD(nextval('expense_number_seq')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_expense_number
BEFORE INSERT ON expenses
FOR EACH ROW
EXECUTE FUNCTION generate_expense_number();

-- Seed Default Categories
INSERT INTO expense_categories (name, description) VALUES
('Rent', 'Store rent and premises costs'),
('Salaries', 'Staff salaries and wages'),
('Utilities', 'Electricity, Water, Internet bills'),
('Office Supplies', 'Stationery, cleaning supplies, printables'),
('Maintenance', 'Repairs and maintenance work'),
('Marketing', 'Ads, promotions, and branding'),
('Logistics', 'Couriers, transport, and delivery charges'),
('Tea & Refreshments', 'Daily staff tea and snacks'),
('Other', 'Miscellaneous expenses');
