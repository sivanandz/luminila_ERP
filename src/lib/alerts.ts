"use client";

import { useState, useEffect, useCallback } from "react";
import { pb, ensureAuth, getCurrentTenantEmail, getTenantStorageKey } from "./pocketbase";
import type { ProductVariant } from "@/types/database";

interface LowStockItem {
    variantId: string;
    productId: string;
    productName: string;
    variantName: string;
    sku: string;
    currentStock: number;
    threshold: number;
}

interface AlertConfig {
    enabled: boolean;
    checkIntervalMs: number;
    defaultThreshold: number;
    notifyEmail: boolean;
    notifyDesktop: boolean;
    notifyWhatsApp: boolean;
    emailAddress?: string;
    whatsAppNumber?: string;
}

const DEFAULT_CONFIG: AlertConfig = {
    enabled: true,
    checkIntervalMs: 300000, // 5 minutes
    defaultThreshold: 5,
    notifyEmail: false,
    notifyDesktop: true,
    notifyWhatsApp: false,
};

const getAlertStorageKey = () => getTenantStorageKey("luminila_alert_config_v1");

/**
 * Load alert configuration from localStorage
 */
export function loadAlertConfig(): AlertConfig {
    if (typeof window === "undefined") return DEFAULT_CONFIG;

    try {
        const stored = localStorage.getItem(getAlertStorageKey());
        if (stored) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
        }
    } catch {
        console.error("Failed to load alert config");
    }
    return DEFAULT_CONFIG;
}

/**
 * Save alert configuration to localStorage
 */
export function saveAlertConfig(config: AlertConfig): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(getAlertStorageKey(), JSON.stringify(config));
}

/**
 * Fetch low stock items from database
 */
export async function fetchLowStockItems(threshold?: number): Promise<LowStockItem[]> {
    ensureAuth();
    const config = loadAlertConfig();
    const effectiveThreshold = threshold ?? config.defaultThreshold;
    const userEmail = getCurrentTenantEmail();

    try {
        const filter = userEmail 
            ? `account_email="${userEmail}" && stock_level<=${effectiveThreshold}`
            : `stock_level<=${effectiveThreshold}`;

        const data = await pb.collection('product_variants').getFullList<ProductVariant>({
            filter,
            sort: 'stock_level',
            expand: 'product',
        });

        // Filter out inactive products
        const activeItems = (data || []).filter(item => {
            const prod = item.expand?.product as any;
            return !prod || prod.is_active !== false;
        });

        return activeItems.map((item) => ({
            variantId: item.id,
            productId: item.expand?.product?.id || "",
            productName: item.expand?.product?.name || "Unknown",
            variantName: item.variant_name,
            sku: `${item.expand?.product?.sku || ""}-${item.sku_suffix}`,
            currentStock: item.stock_level,
            threshold: item.low_stock_threshold || effectiveThreshold,
        }));
    } catch (err) {
        console.error("Failed to fetch low stock items:", err);
        return [];
    }
}

/**
 * Send desktop notification
 */
export async function sendDesktopNotification(
    title: string,
    body: string
): Promise<boolean> {
    if (typeof window === "undefined") return false;

    if (!("Notification" in window)) {
        console.warn("Desktop notifications not supported");
        return false;
    }

    if (Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return false;
    }

    if (Notification.permission === "granted") {
        new Notification(title, {
            body,
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            tag: "low-stock-alert",
        });
        return true;
    }

    return false;
}

/**
 * Check low stock and trigger alerts
 */
export async function checkAndAlert(): Promise<LowStockItem[]> {
    const config = loadAlertConfig();
    if (!config.enabled) return [];

    const lowStockItems = await fetchLowStockItems();

    if (lowStockItems.length === 0) return [];

    if (config.notifyDesktop) {
        const count = lowStockItems.length;
        const criticalCount = lowStockItems.filter((i) => i.currentStock <= 0).length;

        let message = `${count} item${count !== 1 ? "s" : ""} below threshold`;
        if (criticalCount > 0) {
            message = `⚠️ ${criticalCount} OUT OF STOCK! ${message}`;
        }

        await sendDesktopNotification("Low Stock Alert", message);
    }

    return lowStockItems;
}

/**
 * React hook for low stock alerts
 */
export function useLowStockAlerts() {
    const [alerts, setAlerts] = useState<LowStockItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [config, setConfig] = useState<AlertConfig>(DEFAULT_CONFIG);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- alert config lives in localStorage, an external store that is unavailable during SSR render, so it can only be read and set after mount
        setConfig(loadAlertConfig());
    }, []);

    const checkAlerts = useCallback(async () => {
        setIsLoading(true);
        const items = await fetchLowStockItems(config.defaultThreshold);
        setAlerts(items);
        setIsLoading(false);
        return items;
    }, [config.defaultThreshold]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- checkAlerts intentionally flips isLoading true before its first await so the loading state shows for the initial and interval-driven stock checks; deferring it would change loading behavior
        checkAlerts();

        if (config.enabled && config.checkIntervalMs > 0) {
            const interval = setInterval(checkAlerts, config.checkIntervalMs);
            return () => clearInterval(interval);
        }
    }, [checkAlerts, config.enabled, config.checkIntervalMs]);

    const updateConfig = useCallback((updates: Partial<AlertConfig>) => {
        const newConfig = { ...config, ...updates };
        setConfig(newConfig);
        saveAlertConfig(newConfig);
    }, [config]);

    const dismissAlert = useCallback((variantId: string) => {
        setAlerts((prev) => prev.filter((a) => a.variantId !== variantId));
    }, []);

    const dismissAll = useCallback(() => {
        setAlerts([]);
    }, []);

    return {
        alerts,
        isLoading,
        config,
        updateConfig,
        checkAlerts,
        dismissAlert,
        dismissAll,
        criticalCount: alerts.filter((a) => a.currentStock <= 0).length,
        warningCount: alerts.filter((a) => a.currentStock > 0).length,
    };
}

/**
 * Alert notification bell component logic
 */
export function getAlertBadgeColor(criticalCount: number, warningCount: number): string {
    if (criticalCount > 0) return "bg-error";
    if (warningCount > 0) return "bg-warning";
    return "bg-success";
}

export function getAlertIcon(stock: number): "critical" | "warning" | "ok" {
    if (stock <= 0) return "critical";
    if (stock <= 5) return "warning";
    return "ok";
}
