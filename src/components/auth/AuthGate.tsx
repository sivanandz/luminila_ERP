"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isPublicAppPath } from "@/lib/public-surfaces";

/**
 * Route-level authentication gate.
 *
 * The shell used to render every page to every visitor and only show a sign-in
 * card on two of them. This redirects an unauthenticated visitor to the login
 * screen and keeps the public routes reachable: the storefront checkout and
 * tracking pages (hosted on a public host) and first-run setup.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
    const { isValid, isLoading } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    const isPublic = isPublicAppPath(pathname);
    const mustRedirect = !isLoading && !isValid && !isPublic;

    useEffect(() => {
        if (!mustRedirect) return;
        const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
        router.replace(`/login${next}`);
    }, [mustRedirect, pathname, router]);

    if (mustRedirect) {
        return (
            <div className="flex h-full w-full flex-1 items-center justify-center bg-background text-sm text-moonstone">
                Redirecting to sign in...
            </div>
        );
    }

    return <>{children}</>;
}
