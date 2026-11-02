"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { pb, autoDiscoverPocketBase, resolveTenantPocketBase, sanitizeFilter } from "@/lib/pocketbase";
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
    const [user, setUser] = useState<AuthModel | null>(null);
    const [isValid, setIsValid] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const checkUserIsAdmin = async (model: AuthModel | null): Promise<boolean> => {
        if (!model) return false;
        if (pb.authStore.isSuperuser) return true;
        try {
            const userRoles = await pb.collection("user_roles").getFullList({
                filter: `user="${sanitizeFilter(model.id)}"`,
                expand: "role"
            });
            return userRoles.some(ur => ur.expand?.role?.name === "Admin" || ur.expand?.role?.name === "Super Admin");
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
                    const status = err instanceof ClientResponseError ? err.status : 0;
                    if (status === 401 || status === 403) {
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
        let isSuperuser = false;

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
            }
            // Fallback: check if it's a superuser account
            try {
                authData = await pb.collection("_superusers").authWithPassword(email, password);
                isSuperuser = true;
            } catch {
                throw userErr;
            }
        }

        // Check is_active custom field (for regular users)
        if (!isSuperuser && authData?.record?.is_active === false) {
            pb.authStore.clear();
            throw new Error("Account is inactive");
        }

        // Update last_login
        if (!isSuperuser && authData?.record?.id) {
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
        if (typeof window !== "undefined") {
            localStorage.removeItem("PB_CUSTOM_URL");
        }
    };



    return (
        <AuthContext.Provider value={{ user, isValid, isAdmin, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
