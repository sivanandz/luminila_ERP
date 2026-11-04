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
// ROLE GUARDS
// ===========================================

/** Names reserved for the seeded system roles (A2). */
const RESERVED_ADMIN_ROLE_NAMES = new Set(['admin', 'super admin']);

/**
 * Admin authority comes from a SYSTEM role only. A tenant admin can create a
 * custom role, so matching on the name alone would let them mint an "Admin"
 * role and escalate every member it is assigned to.
 */
export function isSystemAdminRole(role?: { name?: string; is_system?: boolean } | null): boolean {
    if (!role?.name) return false;
    if (role.is_system === false) return false;
    return RESERVED_ADMIN_ROLE_NAMES.has(role.name.trim().toLowerCase());
}

function assertRoleNameAllowed(name: string): void {
    if (RESERVED_ADMIN_ROLE_NAMES.has(name.trim().toLowerCase())) {
        throw new Error('That role name is reserved for a system role.');
    }
}

/** `&& account_email = "…"` for user_roles queries (A3). */
function userRoleTenantClause(tenant: string): string {
    return tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
}

/**
 * Resolve the caller's tenant or fail closed. Setup/bootstrap paths use the
 * superuser client and have no tenant; they must pass their own explicit email.
 */
function requireTenant(): string {
    const tenant = accountScopeEmail();
    if (!tenant) {
        throw new Error('No tenant context: sign in as a store account before managing users or roles.');
    }
    return tenant;
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
    assertRoleNameAllowed(name);
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
    if (updates.name !== undefined) assertRoleNameAllowed(updates.name);
    // Fail closed (A4): a tenant caller may only mutate a role it owns. Shared
    // legacy rows have no owner and are therefore superuser-only.
    if (!pb.authStore.isSuperuser) {
        const tenant = requireTenant();
        if (existing.account_email !== tenant) {
            throw new Error('Role does not belong to this store.');
        }
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
    // Fail closed (A4): see updateRole.
    if (!pb.authStore.isSuperuser) {
        const tenant = requireTenant();
        if (existing.account_email !== tenant) {
            throw new Error('Role does not belong to this store.');
        }
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
    const accountEmail = requireTenant();

    // A5: only an administrator may rewrite roles, and only for a user that
    // belongs to the same tenant. Otherwise any signed-in staff account could
    // grant itself Admin.
    if (!(await isAdmin(pb.authStore.model?.id ?? ''))) {
        throw new Error('Only administrators can change user roles.');
    }
    const target = await pb
        .collection('users')
        .getOne<{ account_email?: string }>(userId)
        .catch(() => null);
    if (!target) throw new Error('User not found.');
    if (target.account_email !== accountEmail) {
        throw new Error('User does not belong to this store.');
    }

    // A role id from another tenant must not be assignable even though the
    // join row itself would carry this tenant's stamp.
    for (const roleId of roleIds) {
        const role = await pb.collection('roles').getOne<{ is_system?: boolean; account_email?: string }>(roleId);
        if (!roleAllowedForTenant(role, accountEmail)) {
            throw new Error('Role does not belong to this store.');
        }
    }
    const safeUserId = sanitizeFilter(userId);
    // Remove all existing roles this tenant owns for the user.
    const existingRoles = await pb.collection('user_roles').getFullList({
        filter: `user="${safeUserId}"${userRoleTenantClause(accountEmail)}`
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
    // A6: tenant + admin + self + last-admin guards. The users collection is
    // tenant-scoped, so an unscoped update here could deactivate a user who
    // belongs to a different store.
    const accountEmail = requireTenant();
    const callerId = pb.authStore.model?.id ?? '';
    if (!(await isAdmin(callerId))) {
        throw new Error('Only administrators can change user status.');
    }
    if (!isActive && callerId === userId) {
        throw new Error('You cannot deactivate your own account.');
    }

    const target = await pb
        .collection('users')
        .getOne<{ account_email?: string; is_active?: boolean }>(userId)
        .catch(() => null);
    if (!target) throw new Error('User not found.');
    if (target.account_email !== accountEmail) {
        throw new Error('User does not belong to this store.');
    }

    if (!isActive && target.is_active !== false) {
        const tenantFilter = `account_email = "${sanitizeFilter(accountEmail)}"`;
        const links = await pb.collection('user_roles').getFullList({
            filter: tenantFilter,
            expand: 'role',
        });
        const adminUserIds = new Set(
            links
                .filter((link) => isSystemAdminRole(link.expand?.role as { name?: string; is_system?: boolean } | undefined))
                .map((link) => String(link.user || ''))
        );
        if (adminUserIds.has(userId)) {
            const tenantUsers = await pb.collection('users').getFullList({
                filter: tenantFilter,
            });
            const activeAdmins = tenantUsers.filter(
                (user) => adminUserIds.has(user.id) && user.is_active !== false
            );
            if (activeAdmins.length <= 1) {
                throw new Error('Cannot deactivate the last active administrator.');
            }
        }
    }

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
    const tenant = accountScopeEmail();
    const record = await pb.collection('user_roles').getFirstListItem(
        `user="${sanitizeFilter(userId)}" && role="${sanitizeFilter(roleId)}"${userRoleTenantClause(tenant)}`
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

    // 2. Check if assigned a system 'Admin' role for this tenant (A2/A3).
    try {
        const tenant = accountScopeEmail();
        const userRoles = await pb.collection('user_roles').getFullList({
            filter: `user="${sanitizeFilter(userId)}"${userRoleTenantClause(tenant)}`,
            expand: 'role'
        });
        return userRoles.some((ur) =>
            isSystemAdminRole(ur.expand?.role as { name?: string; is_system?: boolean } | undefined)
        );
    } catch {
        return false;
    }
}

export async function getCurrentUserPermissions(): Promise<Record<Resource, Permission[]>> {
    const userId = pb.authStore.model?.id;
    if (!userId) return {} as Record<Resource, Permission[]>;

    const tenant = accountScopeEmail();
    // 1. Get User Roles
    const userRoles = await pb.collection('user_roles').getFullList({
        filter: `user="${sanitizeFilter(userId)}"${userRoleTenantClause(tenant)}`,
        expand: 'role'
    });

    if (userRoles.length === 0) return {} as Record<Resource, Permission[]>;

    // 2. Merge Permissions
    const merged: Record<Resource, Set<Permission>> = {} as Record<Resource, Set<Permission>>;

    userRoles.forEach(ur => {
        const role = ur.expand?.role as Role;
        // Ignore a role row that belongs to another tenant (A3).
        if (role && role.permissions && roleAllowedForTenant(role, tenant)) {
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
