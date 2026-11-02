/**
 * RBAC Service Layer
 * Role-Based Access Control utilities for PocketBase
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

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
    created: string;
    updated: string;
}

export interface UserRole {
    id: string;
    user: string;
    role: string;
    created: string;
}

export interface UserProfile {
    id: string;
    email: string;
    name: string;
    full_name?: string;
    avatar?: string;
    is_active?: boolean;
    last_login?: string;
    created: string;
    updated: string;
    // Expanded
    roles?: { role_name: string; role_id: string }[];
}


// ===========================================
// ROLES
// ===========================================

export async function getRoles(): Promise<Role[]> {
    try {
        const tenant = accountScopeEmail();
        // System roles and legacy unscoped rows are shared; custom roles are
        // visible only to the tenant that created them (A-02 residual).
        const filter = tenant
            ? `is_system = true || account_email = "" || account_email = "${sanitizeFilter(tenant)}"`
            : `is_system = true || account_email = ""`;
        const records = await pb.collection('roles').getFullList({
            filter,
            sort: 'name',
        });
        return records.map(r => ({
            id: r.id,
            name: r.name,
            description: r.description,
            permissions: r.permissions,
            is_system: r.is_system,
            created: r.created,
            updated: r.updated
        }));
    } catch (err) {
        console.error('Error fetching roles:', err);
        return [];
    }
}

/** System/legacy roles are shared; custom roles belong to one tenant (A-02). */
function roleAllowedForTenant(
    role: { is_system?: boolean; account_email?: string },
    tenant: string
): boolean {
    return Boolean(role.is_system) || !role.account_email || role.account_email === tenant;
}

export async function getRole(id: string): Promise<Role | null> {
    try {
        const record = await pb.collection('roles').getOne(id);
        if (!roleAllowedForTenant(record as { is_system?: boolean; account_email?: string }, accountScopeEmail())) return null;
        return {
            id: record.id,
            name: record.name,
            description: record.description,
            permissions: record.permissions,
            is_system: record.is_system,
            created: record.created,
            updated: record.updated
        };
    } catch {
        return null;
    }
}

export async function createRole(
    name: string,
    description: string,
    permissions: Record<Resource, Permission[]>
): Promise<Role> {
    const record = await pb.collection('roles').create({
        name,
        description,
        permissions,
        is_system: false,
        account_email: accountScopeEmail(),
    });
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        permissions: record.permissions,
        is_system: record.is_system,
        created: record.created,
        updated: record.updated
    };
}

export async function updateRole(
    id: string,
    updates: Partial<Omit<Role, 'id' | 'is_system' | 'created' | 'updated'>>
): Promise<Role> {
    const existing = await pb.collection('roles').getOne<{ is_system?: boolean; account_email?: string }>(id);
    if (existing.is_system) {
        throw new Error('System roles cannot be modified.');
    }
    const tenant = accountScopeEmail();
    if (tenant && existing.account_email && existing.account_email !== tenant) {
        throw new Error('Role does not belong to this store.');
    }
    const record = await pb.collection('roles').update(id, updates);
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        permissions: record.permissions,
        is_system: record.is_system,
        created: record.created,
        updated: record.updated
    };
}

export async function deleteRole(id: string): Promise<void> {
    const existing = await pb.collection('roles').getOne<{ is_system?: boolean; account_email?: string }>(id);
    if (existing.is_system) {
        throw new Error('System roles cannot be deleted.');
    }
    const tenant = accountScopeEmail();
    if (tenant && existing.account_email && existing.account_email !== tenant) {
        throw new Error('Role does not belong to this store.');
    }
    await pb.collection('roles').delete(id);
}

// ===========================================
// USER PROFILES (Users Collection)
// ===========================================

export async function getUsers(): Promise<UserProfile[]> {
    try {
        // users and user_roles are tenant-scoped; without this filter the
        // superuser client lists every account in the database (A-12).
        const tenant = accountScopeEmail();
        if (!tenant) return [];
        const tenantFilter = `account_email = "${sanitizeFilter(tenant)}"`;
        const records = await pb.collection('users').getFullList({
            filter: tenantFilter,
            sort: 'name'
        });

        // Fetch roles for all users
        // Optimization: Fetch all user_roles and map them, instead of N+1 queries
        const allUserRoles = await pb.collection('user_roles').getFullList({
            filter: tenantFilter,
            expand: 'role'
        });

        return records.map(u => {
            const userRoles = allUserRoles.filter(ur => ur.user === u.id);
            const roles = userRoles.map(ur => ({
                role_id: ur.role,
                role_name: ur.expand?.role?.name || 'Unknown'
            }));

            return {
                id: u.id,
                email: u.email,
                name: u.name,
                full_name: u.name || u.email?.split('@')[0],
                avatar: u.avatar ? pb.files.getUrl(u, u.avatar) : undefined,
                is_active: u.is_active !== false, // Default true if missing/undefined
                last_login: u.last_login ? u.last_login : undefined,
                created: u.created,
                updated: u.updated,
                roles
            };
        });
    } catch (err) {
        console.error('Error fetching users:', err);
        return [];
    }
}

export async function setUserRoles(userId: string, roleIds: string[]): Promise<void> {
    // user_roles rows are tenant-scoped by account_email; stamp the acting
    // tenant so the assignment stays visible to this store only.
    const accountEmail = accountScopeEmail();
    // A role id from another tenant must not be assignable even though the
    // join row itself would carry this tenant's stamp.
    for (const roleId of roleIds) {
        const role = await pb.collection('roles').getOne<{ is_system?: boolean; account_email?: string }>(roleId);
        if (!roleAllowedForTenant(role, accountEmail)) {
            throw new Error('Role does not belong to this store.');
        }
    }
    const safeUserId = sanitizeFilter(userId);
    // Remove all existing roles
    const existingRoles = await pb.collection('user_roles').getFullList({
        filter: `user="${safeUserId}"`
    });
    for (const ur of existingRoles) {
        await pb.collection('user_roles').delete(ur.id);
    }
    // Add new roles
    for (const roleId of roleIds) {
        await pb.collection('user_roles').create({ user: userId, role: roleId, account_email: accountEmail });
    }
}

export async function toggleUserActive(userId: string, isActive: boolean): Promise<void> {
    await pb.collection('users').update(userId, { is_active: isActive });
}

export async function getRBACStats(): Promise<{ totalUsers: number; activeUsers: number; totalRoles: number }> {
    try {
        const tenant = accountScopeEmail();
        if (!tenant) return { totalUsers: 0, activeUsers: 0, totalRoles: 0 };
        const tenantFilter = `account_email = "${sanitizeFilter(tenant)}"`;
        const usersResult = await pb.collection('users').getList(1, 1, { filter: tenantFilter });
        const activeUsersResult = await pb.collection('users').getList(1, 1, { filter: `${tenantFilter} && is_active=true` });
        // roles is the shared RBAC catalog (no tenant PII), so it stays global.
        const rolesResult = await pb.collection('roles').getList(1, 1);

        return {
            totalUsers: usersResult.totalItems,
            activeUsers: activeUsersResult.totalItems,
            totalRoles: rolesResult.totalItems,
        };
    } catch {
        return { totalUsers: 0, activeUsers: 0, totalRoles: 0 };
    }
}

// ===========================================
// USER ROLES ASSIGNMENT
// ===========================================

export async function assignRole(userId: string, roleId: string): Promise<void> {
    // user_roles.createRule requires the caller's tenant on the row.
    const accountEmail = accountScopeEmail();
    const role = await pb.collection('roles').getOne<{ is_system?: boolean; account_email?: string }>(roleId);
    if (!roleAllowedForTenant(role, accountEmail)) {
        throw new Error('Role does not belong to this store.');
    }
    await pb.collection('user_roles').create({
        user: userId,
        role: roleId,
        account_email: accountEmail
    });
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
    // Need to find the ID of the user_role record first
    const record = await pb.collection('user_roles').getFirstListItem(
        `user="${sanitizeFilter(userId)}" && role="${sanitizeFilter(roleId)}"`
    );
    if (record) {
        await pb.collection('user_roles').delete(record.id);
    }
}

// ===========================================
// PERMISSION CHECKING
// ===========================================

export async function isAdmin(userId: string): Promise<boolean> {
    // 1. Check if actually Super Admin (context usually knows this efficiently)
    if (pb.authStore.isSuperuser) return true;

    // 2. Check if assigned 'Admin' role
    try {
        const userRoles = await pb.collection('user_roles').getFullList({
            filter: `user="${sanitizeFilter(userId)}"`,
            expand: 'role'
        });
        return userRoles.some(ur => ur.expand?.role?.name === 'Admin' || ur.expand?.role?.name === 'Super Admin');
    } catch {
        return false;
    }
}

export async function getCurrentUserPermissions(): Promise<Record<Resource, Permission[]>> {
    const userId = pb.authStore.model?.id;
    if (!userId) return {} as Record<Resource, Permission[]>;

    // 1. Get User Roles
    const userRoles = await pb.collection('user_roles').getFullList({
        filter: `user="${sanitizeFilter(userId)}"`,
        expand: 'role'
    });

    if (userRoles.length === 0) return {} as Record<Resource, Permission[]>;

    // 2. Merge Permissions
    const merged: Record<Resource, Set<Permission>> = {} as Record<Resource, Set<Permission>>;

    userRoles.forEach(ur => {
        const role = ur.expand?.role as Role;
        if (role && role.permissions) {
            Object.entries(role.permissions).forEach(([resource, perms]) => {
                if (!merged[resource as Resource]) {
                    merged[resource as Resource] = new Set();
                }
                (perms as Permission[]).forEach(p => merged[resource as Resource].add(p));
            });
        }
    });

    // 3. Convert to Array
    const result: Record<Resource, Permission[]> = {} as Record<Resource, Permission[]>;
    Object.entries(merged).forEach(([resource, set]) => {
        result[resource as Resource] = Array.from(set);
    });

    return result;
}

// Helper for UI checks (Client-side mainly, after loading permissions)
export function checkPermissionLocally(
    permissions: Record<Resource, Permission[]>,
    resource: Resource,
    action: Permission
): boolean {
    return permissions[resource]?.includes(action) || false;
}
