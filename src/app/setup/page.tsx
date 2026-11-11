"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Setup wizard decommissioned for security: initial tenant and admin seeding
 * occurs exclusively via automated server/container CLI scripts.
 */
export default function SetupWizardPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/login");
    }, [router]);

    return (
        <div className="flex h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
            Setup is managed via server bootstrap. Redirecting to sign in...
        </div>
    );
}
