"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

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
        const { data, error } = await supabase
            .from("product_variants")
            .select(`
        id,
        product_id,
        variant_name,
        sku_suffix,
        stock_level,
        low_stock_threshold,
        product:products(id, name, sku)
      `)
            .lte("stock_level", effectiveThreshold)
            .order("stock_level", { ascending: true });

        if (error) throw error;

        interface VariantWithProduct {
            id: string;
            product_id: string;
            variant_name: string;
            sku_suffix: string;
            stock_level: number;
            low_stock_threshold: number;
            product: { id: string; name: string; sku: string } | null;
        }

        const typedData = data as unknown as VariantWithProduct[];

        return (typedData || []).map((item) => {
            return {
                variantId: item.id,
                productId: item.product?.id || "",
                productName: item.product?.name || "Unknown",
                variantName: item.variant_name,
                sku: `${item.product?.sku || ""}-${item.sku_suffix}`,
                currentStock: item.stock_level,
                threshold: item.low_stock_threshold || effectiveThreshold,
            };
        });
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

    // Check if notifications are supported
    if (!("Notification" in window)) {
        console.warn("Desktop notifications not supported");
        return false;
    }

    // Request permission if needed
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

    // Desktop notification
    if (config.notifyDesktop) {
        const count = lowStockItems.length;
        const criticalCount = lowStockItems.filter((i) => i.currentStock <= 0).length;

        let message = `${count} item${count !== 1 ? "s" : ""} below threshold`;
        if (criticalCount > 0) {
            message = `⚠️ ${criticalCount} OUT OF STOCK! ${message}`;
        }

        await sendDesktopNotification("Low Stock Alert", message);
    }

    // TODO: Email notification (requires backend)
    // TODO: WhatsApp notification (requires WPPConnect)

    return lowStockItems;
}

/**
 * React hook for low stock alerts
 */
export function useLowStockAlerts() {
    const [alerts, setAlerts] = useState<LowStockItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [config, setConfig] = useState<AlertConfig>(DEFAULT_CONFIG);

    // Load config on mount
    useEffect(() => {
        setConfig(loadAlertConfig());
    }, []);

    // Check alerts
    const checkAlerts = useCallback(async () => {
        setIsLoading(true);
        const items = await fetchLowStockItems(config.defaultThreshold);
        setAlerts(items);
        setIsLoading(false);
        return items;
    }, [config.defaultThreshold]);

    // Initial check and periodic polling
    useEffect(() => {
        checkAlerts();

        if (config.enabled && config.checkIntervalMs > 0) {
            const interval = setInterval(checkAlerts, config.checkIntervalMs);
            return () => clearInterval(interval);
        }
    }, [checkAlerts, config.enabled, config.checkIntervalMs]);

    // Update config
    const updateConfig = useCallback((updates: Partial<AlertConfig>) => {
        const newConfig = { ...config, ...updates };
        setConfig(newConfig);
        saveAlertConfig(newConfig);
    }, [config]);

    // Dismiss single alert
    const dismissAlert = useCallback((variantId: string) => {
        setAlerts((prev) => prev.filter((a) => a.variantId !== variantId));
    }, []);

    // Dismiss all alerts
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
