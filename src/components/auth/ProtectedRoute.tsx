"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldX } from "lucide-react";
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
    const { hasPermission, loading, isAdmin } = usePermissions();
    const [authorized, setAuthorized] = useState<boolean | null>(null);

    useEffect(() => {
        if (!loading) {
            const canAccess = isAdmin || hasPermission(resource, action);
            setAuthorized(canAccess);

            if (!canAccess && redirectTo) {
                router.replace(redirectTo);
            }
        }
    }, [loading, hasPermission, resource, action, isAdmin, router, redirectTo]);

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

        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <ShieldX className="w-16 h-16 text-red-400" />
                <h2 className="text-xl font-semibold">Access Denied</h2>
                <p className="text-muted-foreground text-center max-w-md">
                    You don't have permission to access this resource.
                    Contact your administrator if you believe this is an error.
                </p>
                <Button variant="outline" onClick={() => router.back()}>
                    Go Back
                </Button>
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


