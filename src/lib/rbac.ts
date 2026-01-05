/**
 * RBAC Service Layer
 * Role-Based Access Control utilities
 */

import { supabase } from './supabase';

// ===========================================
// TYPES
// ===========================================

export type Permission = 'create' | 'read' | 'update' | 'delete' | 'print' | 'export';

export type Resource =
    | 'products'
    | 'inventory'
    | 'sales'
    | 'invoices'
    | 'customers'
    | 'vendors'
    | 'purchase_orders'
    | 'reports'
    | 'settings'
    | 'users'
    | 'activity';

export interface Role {
    id: string;
    name: string;
    description?: string;
    permissions: Record<Resource, Permission[]>;
    is_system: boolean;
    created_at: string;
}

export interface UserProfile {
    id: string;
    full_name?: string;
    avatar_url?: string;
    phone?: string;
    is_active: boolean;
    last_login?: string;
    created_at: string;
    email?: string; // From auth.users
    roles?: { role_name: string; role_id: string }[];
}

export interface UserRole {
    id: string;
    user_id: string;
    role_id: string;
    assigned_at: string;
}

// ===========================================
// ROLES
// ===========================================

export async function getRoles(): Promise<Role[]> {
    const { data, error } = await supabase
        .from('roles')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error fetching roles:', error);
        return [];
    }

    return data || [];
}

export async function getRole(id: string): Promise<Role | null> {
    const { data, error } = await supabase
        .from('roles')
        .select('*')
        .eq('id', id)
        .single();

    if (error) return null;
    return data;
}

export async function createRole(
    name: string,
    description: string,
    permissions: Record<Resource, Permission[]>
): Promise<Role> {
    const { data, error } = await supabase
        .from('roles')
        .insert({ name, description, permissions })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateRole(
    id: string,
    updates: Partial<Omit<Role, 'id' | 'is_system' | 'created_at'>>
): Promise<Role> {
    const { data, error } = await supabase
        .from('roles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function deleteRole(id: string): Promise<void> {
    const { error } = await supabase
        .from('roles')
        .delete()
        .eq('id', id)
        .eq('is_system', false); // Prevent system role deletion

    if (error) throw error;
}

// ===========================================
// USER PROFILES
// ===========================================

export async function getUsers(): Promise<UserProfile[]> {
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .order('full_name');

    if (error) {
        console.error('Error fetching users:', error);
        return [];
    }

    // Fetch roles for each user
    const users = data || [];

    for (const user of users) {
        const { data: roles } = await supabase.rpc('get_user_roles', { p_user_id: user.id });
        user.roles = roles || [];
    }

    return users;
}

export async function getUser(id: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', id)
        .single();

    if (error) return null;

    const { data: roles } = await supabase.rpc('get_user_roles', { p_user_id: id });
    data.roles = roles || [];

    return data;
}

export async function updateUserProfile(
    id: string,
    updates: Partial<Omit<UserProfile, 'id' | 'created_at' | 'roles'>>
): Promise<UserProfile> {
    const { data, error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function toggleUserActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
        .from('user_profiles')
        .update({ is_active: isActive })
        .eq('id', id);

    if (error) throw error;
}

// ===========================================
// USER ROLES ASSIGNMENT
// ===========================================

export async function assignRole(userId: string, roleId: string): Promise<void> {
    const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role_id: roleId });

    if (error && !error.message.includes('duplicate')) {
        throw error;
    }
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
    const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role_id', roleId);

    if (error) throw error;
}

export async function setUserRoles(userId: string, roleIds: string[]): Promise<void> {
    // Delete existing roles
    await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

    // Insert new roles
    if (roleIds.length > 0) {
        const { error } = await supabase
            .from('user_roles')
            .insert(roleIds.map(roleId => ({ user_id: userId, role_id: roleId })));

        if (error) throw error;
    }
}

// ===========================================
// PERMISSION CHECKING
// ===========================================

export async function checkPermission(
    userId: string,
    resource: Resource,
    action: Permission
): Promise<boolean> {
    const { data, error } = await supabase.rpc('has_permission', {
        p_user_id: userId,
        p_resource: resource,
        p_action: action,
    });

    if (error) {
        console.error('Error checking permission:', error);
        return false;
    }

    return data ?? false;
}

export async function isAdmin(userId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('is_admin', { p_user_id: userId });
    if (error) return false;
    return data ?? false;
}

export async function getCurrentUserPermissions(): Promise<Record<Resource, Permission[]>> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return {} as Record<Resource, Permission[]>;

    const { data: roles } = await supabase.rpc('get_user_roles', { p_user_id: user.id });

    if (!roles || roles.length === 0) {
        return {} as Record<Resource, Permission[]>;
    }

    // Fetch all role permissions
    const roleIds = roles.map((r: any) => r.role_id);
    const { data: roleData } = await supabase
        .from('roles')
        .select('permissions')
        .in('id', roleIds);

    // Merge permissions
    const merged: Record<Resource, Set<Permission>> = {} as any;

    roleData?.forEach((role: any) => {
        Object.entries(role.permissions || {}).forEach(([resource, perms]) => {
            if (!merged[resource as Resource]) {
                merged[resource as Resource] = new Set();
            }
            (perms as Permission[]).forEach(p => merged[resource as Resource].add(p));
        });
    });

    // Convert sets to arrays
    const result: Record<Resource, Permission[]> = {} as any;
    Object.entries(merged).forEach(([resource, perms]) => {
        result[resource as Resource] = Array.from(perms);
    });

    return result;
}

// ===========================================
// STATS
// ===========================================

export async function getRBACStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalRoles: number;
}> {
    const { count: totalUsers } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true });

    const { count: activeUsers } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const { count: totalRoles } = await supabase
        .from('roles')
        .select('*', { count: 'exact', head: true });

    return {
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
        totalRoles: totalRoles || 0,
    };
}
