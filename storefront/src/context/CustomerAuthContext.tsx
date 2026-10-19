"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export interface CustomerUser {
    id: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    loyalty_points?: number;
    account_email?: string;
}

interface CustomerAuthContextType {
    customer: CustomerUser | null;
    token: string | null;
    isAuthenticated: boolean;
    isAuthModalOpen: boolean;
    openAuthModal: () => void;
    closeAuthModal: () => void;
    login: (customer: CustomerUser, token: string) => void;
    logout: () => void;
    updateCustomer: (data: Partial<CustomerUser>) => void;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(undefined);

const STORAGE_USER_KEY = "luminila_storefront_customer";
const STORAGE_TOKEN_KEY = "luminila_storefront_token";

export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
    const [customer, setCustomer] = useState<CustomerUser | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        try {
            const savedUser = localStorage.getItem(STORAGE_USER_KEY);
            const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
            if (savedUser && savedToken) {
                setCustomer(JSON.parse(savedUser));
                setToken(savedToken);
            }
        } catch (e) {
            console.warn("Failed to load customer session from storage:", e);
        }
    }, []);

    const login = (newCustomer: CustomerUser, newToken: string) => {
        setCustomer(newCustomer);
        setToken(newToken);
        try {
            localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(newCustomer));
            localStorage.setItem(STORAGE_TOKEN_KEY, newToken);
        } catch {}
        setIsAuthModalOpen(false);
    };

    const logout = () => {
        setCustomer(null);
        setToken(null);
        try {
            localStorage.removeItem(STORAGE_USER_KEY);
            localStorage.removeItem(STORAGE_TOKEN_KEY);
        } catch {}
    };

    const updateCustomer = (data: Partial<CustomerUser>) => {
        if (!customer) return;
        const updated = { ...customer, ...data };
        setCustomer(updated);
        try {
            localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updated));
        } catch {}
    };

    const openAuthModal = () => setIsAuthModalOpen(true);
    const closeAuthModal = () => setIsAuthModalOpen(false);

    return (
        <CustomerAuthContext.Provider
            value={{
                customer: mounted ? customer : null,
                token: mounted ? token : null,
                isAuthenticated: mounted && !!customer,
                isAuthModalOpen,
                openAuthModal,
                closeAuthModal,
                login,
                logout,
                updateCustomer,
            }}
        >
            {children}
        </CustomerAuthContext.Provider>
    );
}

export function useCustomerAuth() {
    const context = useContext(CustomerAuthContext);
    if (!context) {
        throw new Error("useCustomerAuth must be used within a CustomerAuthProvider");
    }
    return context;
}
