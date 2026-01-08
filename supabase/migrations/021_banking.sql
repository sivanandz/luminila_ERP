-- Bank Accounts Table
CREATE TABLE IF NOT EXISTS bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(50),
    bank_name VARCHAR(100),
    ifsc_code VARCHAR(20),
    currency VARCHAR(3) DEFAULT 'INR',
    opening_balance DECIMAL(15,2) DEFAULT 0,
    current_balance DECIMAL(15,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Bank Transactions Table
CREATE TABLE IF NOT EXISTS bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer')),
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    reference_number VARCHAR(50),
    
    -- Links to other entities for auto-reconciliation
    related_entity_type VARCHAR(50), -- 'sale', 'purchase', 'expense', 'transfer'
    related_entity_id UUID,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES user_profiles(id),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_bank_transactions_account ON bank_transactions(account_id);
CREATE INDEX idx_bank_transactions_date ON bank_transactions(transaction_date);
CREATE INDEX idx_bank_transactions_entity ON bank_transactions(related_entity_type, related_entity_id);

-- Trigger to update current_balance on transaction insert
CREATE OR REPLACE FUNCTION update_bank_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.type = 'deposit') THEN
            UPDATE bank_accounts 
            SET current_balance = current_balance + NEW.amount 
            WHERE id = NEW.account_id;
        ELSIF (NEW.type = 'withdrawal') THEN
            UPDATE bank_accounts 
            SET current_balance = current_balance - NEW.amount 
            WHERE id = NEW.account_id;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        IF (OLD.type = 'deposit') THEN
            UPDATE bank_accounts 
            SET current_balance = current_balance - OLD.amount 
            WHERE id = OLD.account_id;
        ELSIF (OLD.type = 'withdrawal') THEN
            UPDATE bank_accounts 
            SET current_balance = current_balance + OLD.amount 
            WHERE id = OLD.account_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_bank_balance_trigger
AFTER INSERT OR DELETE ON bank_transactions
FOR EACH ROW
EXECUTE FUNCTION update_bank_balance();

-- Function to initialize balance
CREATE OR REPLACE FUNCTION set_initial_bank_balance()
RETURNS TRIGGER AS $$
BEGIN
    NEW.current_balance := NEW.opening_balance;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_initial_bank_balance_trigger
BEFORE INSERT ON bank_accounts
FOR EACH ROW
EXECUTE FUNCTION set_initial_bank_balance();
