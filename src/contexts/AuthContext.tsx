"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { pb } from "@/lib/pocketbase";
import type { AuthModel } from "pocketbase";

interface AuthContextType {
    user: AuthModel | null;
    isValid: boolean;
    isAdmin: boolean;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    isValid: false,
    isAdmin: false,
    logout: () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthModel | null>(pb.authStore.model);
    const [isValid, setIsValid] = useState(pb.authStore.isValid);

    useEffect(() => {
        // Subscribe to auth changes
        const unsubscribe = pb.authStore.onChange((token, model) => {
            setUser(model);
            setIsValid(pb.authStore.isValid);
        }, true); // trigger immediately

        return () => {
            unsubscribe();
        };
    }, []);

    const logout = () => {
        pb.authStore.clear();
    };

    // Simple check: In PB, admins are a specific type, or we can check a field.
    // For now, if the model has 'admin' or if it is from the 'users' collection with specific fields, we count it.
    // Actually, PB Admin account is separate from "users" collection.
    // pb.authStore.isSuperuser tells us if it's a real Admin (dashboard access).
    const isAdmin = pb.authStore.isSuperuser;

    return (
        <AuthContext.Provider value={{ user, isValid, isAdmin, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
