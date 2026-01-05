"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
    getCurrentUserPermissions,
    checkPermission,
    isAdmin,
    type Resource,
    type Permission,
} from "@/lib/rbac";

interface UsePermissionsResult {
    permissions: Record<Resource, Permission[]>;
    loading: boolean;
    isAdmin: boolean;
    hasPermission: (resource: Resource, action: Permission) => boolean;
    can: (resource: Resource, action: Permission) => boolean;
    canCreate: (resource: Resource) => boolean;
    canRead: (resource: Resource) => boolean;
    canUpdate: (resource: Resource) => boolean;
    canDelete: (resource: Resource) => boolean;
    refresh: () => Promise<void>;
}

export function usePermissions(): UsePermissionsResult {
    const [permissions, setPermissions] = useState<Record<Resource, Permission[]>>(
        {} as Record<Resource, Permission[]>
    );
    const [loading, setLoading] = useState(true);
    const [admin, setAdmin] = useState(false);

    const loadPermissions = useCallback(async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (user) {
                const [perms, adminStatus] = await Promise.all([
                    getCurrentUserPermissions(),
                    isAdmin(user.id),
                ]);
                setPermissions(perms);
                setAdmin(adminStatus);
            } else {
                setPermissions({} as Record<Resource, Permission[]>);
                setAdmin(false);
            }
        } catch (error) {
            console.error("Error loading permissions:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPermissions();

        // Refresh on auth change
        const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
            loadPermissions();
        });

        return () => subscription.unsubscribe();
    }, [loadPermissions]);

    const hasPermission = useCallback(
        (resource: Resource, action: Permission): boolean => {
            if (admin) return true; // Admins have all permissions
            const resourcePerms = permissions[resource] || [];
            return resourcePerms.includes(action);
        },
        [permissions, admin]
    );

    const can = hasPermission;
    const canCreate = (resource: Resource) => hasPermission(resource, "create");
    const canRead = (resource: Resource) => hasPermission(resource, "read");
    const canUpdate = (resource: Resource) => hasPermission(resource, "update");
    const canDelete = (resource: Resource) => hasPermission(resource, "delete");

    return {
        permissions,
        loading,
        isAdmin: admin,
        hasPermission,
        can,
        canCreate,
        canRead,
        canUpdate,
        canDelete,
        refresh: loadPermissions,
    };
}

// ===========================================
// SPECIFIC RESOURCE HOOKS
// ===========================================

export function useCanManageUsers(): boolean {
    const { can, isAdmin } = usePermissions();
    return isAdmin || can("users", "update");
}

export function useCanAccessReports(): boolean {
    const { can } = usePermissions();
    return can("reports", "read");
}

export function useCanManageSettings(): boolean {
    const { can, isAdmin } = usePermissions();
    return isAdmin || can("settings", "update");
}

export function useCanCreateInvoices(): boolean {
    const { can } = usePermissions();
    return can("invoices", "create");
}

export function useCanManageInventory(): boolean {
    const { can } = usePermissions();
    return can("inventory", "update");
}
