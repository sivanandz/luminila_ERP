-- =====================================================
-- Luminila Inventory Management System
-- Migration: 007_rbac.sql
-- Purpose: Role-Based Access Control
-- =====================================================

-- =====================================================
-- ROLES TABLE
-- =====================================================
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}',
    is_system BOOLEAN DEFAULT FALSE, -- System roles cannot be deleted
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- USER PROFILES (extends auth.users)
-- =====================================================
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    avatar_url TEXT,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- USER ROLES (many-to-many)
-- =====================================================
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- =====================================================
-- DEFAULT ROLES
-- =====================================================
INSERT INTO roles (name, description, permissions, is_system) VALUES
(
    'admin',
    'Full system access',
    '{
        "products": ["create", "read", "update", "delete"],
        "inventory": ["create", "read", "update", "delete"],
        "sales": ["create", "read", "update", "delete"],
        "invoices": ["create", "read", "update", "delete", "print"],
        "customers": ["create", "read", "update", "delete"],
        "vendors": ["create", "read", "update", "delete"],
        "purchase_orders": ["create", "read", "update", "delete"],
        "reports": ["read", "export"],
        "settings": ["read", "update"],
        "users": ["create", "read", "update", "delete"],
        "activity": ["read"]
    }',
    TRUE
),
(
    'manager',
    'Store manager with limited admin access',
    '{
        "products": ["create", "read", "update"],
        "inventory": ["create", "read", "update"],
        "sales": ["create", "read", "update"],
        "invoices": ["create", "read", "update", "print"],
        "customers": ["create", "read", "update"],
        "vendors": ["create", "read", "update"],
        "purchase_orders": ["create", "read", "update"],
        "reports": ["read", "export"],
        "settings": ["read"],
        "users": ["read"],
        "activity": ["read"]
    }',
    TRUE
),
(
    'cashier',
    'POS and sales operations only',
    '{
        "products": ["read"],
        "inventory": ["read"],
        "sales": ["create", "read"],
        "invoices": ["create", "read", "print"],
        "customers": ["create", "read"],
        "vendors": [],
        "purchase_orders": [],
        "reports": [],
        "settings": [],
        "users": [],
        "activity": []
    }',
    TRUE
),
(
    'viewer',
    'Read-only access',
    '{
        "products": ["read"],
        "inventory": ["read"],
        "sales": ["read"],
        "invoices": ["read"],
        "customers": ["read"],
        "vendors": ["read"],
        "purchase_orders": ["read"],
        "reports": ["read"],
        "settings": [],
        "users": [],
        "activity": []
    }',
    TRUE
);

-- =====================================================
-- HELPER FUNCTION: Check permission
-- =====================================================
CREATE OR REPLACE FUNCTION has_permission(
    p_user_id UUID,
    p_resource VARCHAR(50),
    p_action VARCHAR(20)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_permissions JSONB;
    v_resource_perms JSONB;
BEGIN
    -- Get all role permissions for user
    SELECT jsonb_agg(r.permissions)
    INTO v_permissions
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id;
    
    IF v_permissions IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if action exists in any role's permissions for resource
    FOR v_resource_perms IN SELECT * FROM jsonb_array_elements(v_permissions)
    LOOP
        IF v_resource_perms->p_resource ? p_action THEN
            RETURN TRUE;
        END IF;
    END LOOP;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- HELPER FUNCTION: Get user roles
-- =====================================================
CREATE OR REPLACE FUNCTION get_user_roles(p_user_id UUID)
RETURNS TABLE (role_name VARCHAR(50), role_id UUID) AS $$
BEGIN
    RETURN QUERY
    SELECT r.name, r.id
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- HELPER FUNCTION: Is admin
-- =====================================================
CREATE OR REPLACE FUNCTION is_admin(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id AND r.name = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGER: Create profile on signup
-- =====================================================
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
    
    -- Assign default 'viewer' role
    INSERT INTO user_roles (user_id, role_id)
    SELECT NEW.id, id FROM roles WHERE name = 'viewer';
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION create_user_profile();

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_user_profiles_active ON user_profiles(is_active);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Roles: anyone authenticated can read
CREATE POLICY "Authenticated can read roles"
ON roles FOR SELECT
USING (auth.role() = 'authenticated');

-- Roles: only admins can modify
CREATE POLICY "Admins can manage roles"
ON roles FOR ALL
USING (is_admin(auth.uid()));

-- User profiles: users can read all, update own
CREATE POLICY "Users can read profiles"
ON user_profiles FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Users can update own profile"
ON user_profiles FOR UPDATE
USING (id = auth.uid());

CREATE POLICY "Admins can manage profiles"
ON user_profiles FOR ALL
USING (is_admin(auth.uid()));

-- User roles: admins only
CREATE POLICY "Read own roles"
ON user_roles FOR SELECT
USING (user_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Admins manage user roles"
ON user_roles FOR ALL
USING (is_admin(auth.uid()));
