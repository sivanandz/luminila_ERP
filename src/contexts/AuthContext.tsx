"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { pb } from "@/lib/pocketbase";
import type { AuthModel } from "pocketbase";

interface AuthContextType {
    user: AuthModel | null;
    isValid: boolean;
    isAdmin: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, name: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    isValid: false,
    isAdmin: false,
    isLoading: true,
    login: async () => { },
    register: async () => { },
    logout: () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthModel | null>(null);
    const [isValid, setIsValid] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Initialize from stored auth
        setUser(pb.authStore.model);
        setIsValid(pb.authStore.isValid);
        setIsLoading(false);

        // Subscribe to auth changes
        const unsubscribe = pb.authStore.onChange((token, model) => {
            setUser(model);
            setIsValid(pb.authStore.isValid);
        });

        return () => {
            unsubscribe();
        };
    }, []);

    const login = async (email: string, password: string) => {
        const authData = await pb.collection("users").authWithPassword(email, password);

        // Check is_active custom field (if verified is not used)
        if (authData.record.is_active === false) {
            pb.authStore.clear();
            throw new Error("Account is inactive");
        }

        // Update last_login
        try {
            await pb.collection("users").update(authData.record.id, {
                last_login: new Date()
            });
        } catch (err) {
            console.error("Failed to update last_login:", err);
        }
    };

    const register = async (email: string, password: string, name: string) => {
        // Create user
        const user = await pb.collection("users").create({
            email,
            password,
            passwordConfirm: password,
            name,
            emailVisibility: true,
            is_active: true, // Default to active
        });

        // Assign default "Viewer" role
        try {
            const viewerRole = await pb.collection("roles").getFirstListItem('name="Viewer"');
            await pb.collection("user_roles").create({
                user: user.id,
                role: viewerRole.id,
            });
        } catch (e) {
            console.warn("Could not assign default role:", e);
        }

        // Auto-login after registration
        await pb.collection("users").authWithPassword(email, password);
    };

    const logout = () => {
        pb.authStore.clear();
    };

    const isAdmin = pb.authStore.isSuperuser;

    return (
        <AuthContext.Provider value={{ user, isValid, isAdmin, isLoading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
