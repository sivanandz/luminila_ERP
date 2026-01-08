"use client";

import { useState, useEffect, useCallback } from "react";
import { pb } from "./pocketbase";

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

/**
 * Load alert configuration from localStorage
 */
export function loadAlertConfig(): AlertConfig {
    if (typeof window === "undefined") return DEFAULT_CONFIG;

    try {
        const stored = localStorage.getItem("luminila_alert_config");
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
    localStorage.setItem("luminila_alert_config", JSON.stringify(config));
}

/**
 * Fetch low stock items from database
 */
export async function fetchLowStockItems(threshold?: number): Promise<LowStockItem[]> {
    const config = loadAlertConfig();
    const effectiveThreshold = threshold ?? config.defaultThreshold;

    try {
        const data = await pb.collection('product_variants').getFullList({
            filter: `stock_level<=${effectiveThreshold}`,
            sort: 'stock_level',
            expand: 'product',
        });

        return (data || []).map((item: any) => ({
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
