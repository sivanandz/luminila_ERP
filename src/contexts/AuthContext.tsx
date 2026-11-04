"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { pb, autoDiscoverPocketBase, resolveTenantPocketBase, sanitizeFilter, accountScopeEmail } from "@/lib/pocketbase";
import { isSystemAdminRole } from "@/lib/rbac";
import type { AuthModel, RecordAuthResponse } from "pocketbase";
import { ClientResponseError } from "pocketbase";

interface AuthContextType {
    user: AuthModel | null;
    isValid: boolean;
    isAdmin: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    isValid: false,
    isAdmin: false,
    isLoading: true,
    login: async () => { },
    logout: () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [user, setUser] = useState<AuthModel | null>(null);
    const [isValid, setIsValid] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const checkUserIsAdmin = async (model: AuthModel | null): Promise<boolean> => {
        if (!model) return false;
        if (pb.authStore.isSuperuser) return true;
        try {
            const tenant = accountScopeEmail();
            const tenantClause = tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
            const userRoles = await pb.collection("user_roles").getFullList({
                filter: `user="${sanitizeFilter(model.id)}"${tenantClause}`,
                expand: "role"
            });
            // Admin authority requires a system role, not just the name (A2/A3).
            return userRoles.some((ur) =>
                isSystemAdminRole(ur.expand?.role as { name?: string; is_system?: boolean } | undefined)
            );
        } catch {
            return false;
        }
    };

    useEffect(() => {
        const updateAuthState = async (model: AuthModel | null) => {
            setUser(model);
            setIsValid(pb.authStore.isValid);
            if (model) {
                const adminStatus = await checkUserIsAdmin(model);
                setIsAdmin(adminStatus);
            } else {
                setIsAdmin(false);
            }
            setIsLoading(false);
        };

        // Initialize from stored auth after verifying connection. A stored token
        // proves nothing about the account's current state: deactivated users
        // keep their old JWT until they reload, so refresh it and drop the
        // session when the server rejects it (A-20).
        autoDiscoverPocketBase().finally(async () => {
            if (pb.authStore.isValid) {
                try {
                    await pb.collection("users").authRefresh();
                } catch (err) {
                    // Any server-side rejection means the stored token no longer
                    // represents a live account (A-20/A10). Only a transport
                    // failure (status 0 / no status) may keep the session.
                    if (err instanceof ClientResponseError) {
                        pb.authStore.clear();
                    }
                }
            }
            updateAuthState(pb.authStore.model);
        });

        // Subscribe to auth changes
        const unsubscribe = pb.authStore.onChange(async (token, model) => {
            await updateAuthState(model);
        });

        return () => {
            unsubscribe();
        };
    }, []);

    const login = async (email: string, password: string) => {
        let authData: RecordAuthResponse | null = null;

        // Route to and wake up this account's isolated PocketBase instance (if provisioned)
        await resolveTenantPocketBase(email);
        await autoDiscoverPocketBase();

        try {
            authData = await pb.collection("users").authWithPassword(email, password);
        } catch (userErr) {
            // If connection failed without status code, try discovering port again
            if (!(userErr instanceof ClientResponseError) || !userErr.status) {
                await resolveTenantPocketBase(email);
                await autoDiscoverPocketBase();
                try {
                    authData = await pb.collection("users").authWithPassword(email, password);
                } catch {
                    throw userErr;
                }
            } else {
                // A9: never fall back to the _superusers collection on the normal
                // login path — that grants full database admin from the app login.
                throw userErr;
            }
        }

        // Treat a missing flag as inactive: the users authRule is is_active=true,
        // and the old `=== false` check let null through (A11).
        if (authData?.record?.is_active !== true) {
            pb.authStore.clear();
            throw new Error("Account is inactive");
        }

        // Update last_login
        if (authData?.record?.id) {
            try {
                await pb.collection("users").update(authData.record.id, {
                    last_login: new Date()
                });
            } catch (err) {
                console.error("Failed to update last_login:", err);
            }
        }
    };

    const logout = () => {
        pb.authStore.clear();
        // Reset explicitly instead of relying on the authStore onChange
        // callback (A15); a stale user could stay rendered with admin UI.
        setUser(null);
        setIsValid(false);
        setIsAdmin(false);
        if (typeof window !== "undefined") {
            localStorage.removeItem("PB_CUSTOM_URL");
            router.replace("/login");
        }
    };



    return (
        <AuthContext.Provider value={{ user, isValid, isAdmin, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
