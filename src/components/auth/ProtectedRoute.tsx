"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldX } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions, type Resource, type Permission } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
    children: React.ReactNode;
    resource: Resource;
    action?: Permission;
    fallback?: React.ReactNode;
    redirectTo?: string;
}

export function ProtectedRoute({
    children,
    resource,
    action = "read",
    fallback,
    redirectTo,
}: ProtectedRouteProps) {
    const router = useRouter();
    const { user, isValid } = useAuth();
    const { hasPermission, loading, isAdmin, permissions } = usePermissions();
    // Derived during render from the permission state — same value the old effect
    // wrote via setAuthorized, without the extra setState-in-effect render pass.
    const authorized = loading
        ? null
        : isAdmin || hasPermission(resource, action);

    const hasAnyPermissions = isAdmin || Object.keys(permissions || {}).length > 0;

    useEffect(() => {
        if (!loading && !authorized && redirectTo) {
            router.replace(redirectTo);
        }
    }, [loading, authorized, redirectTo, router]);

    if (loading || authorized === null) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-muted-foreground">Checking permissions...</div>
            </div>
        );
    }

    if (!authorized) {
        if (fallback) {
            return <>{fallback}</>;
        }

        const isUnauthenticated = !user || !isValid;

        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <ShieldX className="w-16 h-16 text-red-400" />
                <h2 className="text-xl font-semibold">
                    {isUnauthenticated
                        ? "Authentication Required"
                        : !hasAnyPermissions
                        ? "No Roles Assigned"
                        : "Access Denied"}
                </h2>
                <p className="text-muted-foreground text-center max-w-md">
                    {isUnauthenticated
                        ? "Please sign in to access this page."
                        : !hasAnyPermissions
                        ? "This account has not been assigned any roles yet. Please assign a role via the administrator account or re-run setup."
                        : "You don't have permission to access this resource. Contact your administrator if you believe this is an error."}
                </p>
                <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={() => router.back()}>
                        Go Back
                    </Button>
                    {isUnauthenticated ? (
                        <Button onClick={() => router.push('/login')}>
                            Sign In
                        </Button>
                    ) : !hasAnyPermissions ? (
                        <Button onClick={() => router.push('/setup')}>
                            Check Setup
                        </Button>
                    ) : (
                        <Button onClick={() => router.push('/')}>
                            Dashboard
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

// ===========================================
// CONDITIONAL RENDER COMPONENT
// ===========================================

interface CanProps {
    do: Permission;
    on: Resource;
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export function Can({ do: action, on: resource, children, fallback }: CanProps) {
    const { hasPermission, loading, isAdmin } = usePermissions();

    if (loading) return null;

    if (isAdmin || hasPermission(resource, action)) {
        return <>{children}</>;
    }

    return fallback ? <>{fallback}</> : null;
}

// ===========================================
// ADMIN ONLY COMPONENT
// ===========================================

interface AdminOnlyProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export function AdminOnly({ children, fallback }: AdminOnlyProps) {
    const { isAdmin, loading } = usePermissions();

    if (loading) return null;
    if (isAdmin) return <>{children}</>;
    return fallback ? <>{fallback}</> : null;
}


