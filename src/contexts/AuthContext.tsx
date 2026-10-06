"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { pb, autoDiscoverPocketBase } from "@/lib/pocketbase";
import type { AuthModel } from "pocketbase";

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
                filter: `user="${model.id}"`,
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

        // Initialize from stored auth after verifying connection
        autoDiscoverPocketBase().finally(() => {
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
        let authData: any = null;
        let isSuperuser = false;

        // Ensure active PocketBase server is reachable
        await autoDiscoverPocketBase();

        try {
            authData = await pb.collection("users").authWithPassword(email, password);
        } catch (userErr: any) {
            // If connection failed without status code, try discovering port again
            if (!userErr.status) {
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
    };



    return (
        <AuthContext.Provider value={{ user, isValid, isAdmin, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
