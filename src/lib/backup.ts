/**
 * Backup & Restore Utilities
 * Handles data export and import for disaster recovery
 */

import { supabase } from "./supabase";
import { downloadAsFile, readFileAsText } from "./csv";

interface BackupData {
    version: string;
    createdAt: string;
    tables: {
        products: unknown[];
        product_variants: unknown[];
        vendors: unknown[];
        sales: unknown[];
        sale_items: unknown[];
        stock_movements: unknown[];
    };
}

const BACKUP_VERSION = "1.0.0";

/**
 * Create a full database backup
 */
export async function createBackup(): Promise<BackupData | null> {
    try {
        // Fetch all tables
        const [products, variants, vendors, sales, saleItems, movements] = await Promise.all([
            supabase.from("products").select("*"),
            supabase.from("product_variants").select("*"),
            supabase.from("vendors").select("*"),
            supabase.from("sales").select("*"),
            supabase.from("sale_items").select("*"),
            supabase.from("stock_movements").select("*"),
        ]);

        if (products.error || variants.error || vendors.error ||
            sales.error || saleItems.error || movements.error) {
            throw new Error("Failed to fetch data from one or more tables");
        }

        const backup: BackupData = {
            version: BACKUP_VERSION,
            createdAt: new Date().toISOString(),
            tables: {
                products: products.data || [],
                product_variants: variants.data || [],
                vendors: vendors.data || [],
                sales: sales.data || [],
                sale_items: saleItems.data || [],
                stock_movements: movements.data || [],
            },
        };

        return backup;
    } catch (err) {
        console.error("Backup failed:", err);
        return null;
    }
}

/**
 * Download backup as JSON file
 */
export async function downloadBackup(): Promise<boolean> {
    const backup = await createBackup();
    if (!backup) return false;

    const filename = `luminila_backup_${new Date().toISOString().split("T")[0]}.json`;
    const content = JSON.stringify(backup, null, 2);

    downloadAsFile(content, filename, "application/json");
    return true;
}

/**
 * Validate backup file structure
 */
export function validateBackup(data: unknown): data is BackupData {
    if (!data || typeof data !== "object") return false;

    const backup = data as BackupData;

    if (!backup.version || !backup.createdAt || !backup.tables) return false;

    const requiredTables = [
        "products",
        "product_variants",
        "vendors",
        "sales",
        "sale_items",
        "stock_movements",
    ];

    return requiredTables.every(
        (table) => Array.isArray(backup.tables[table as keyof typeof backup.tables])
    );
}

/**
 * Restore from backup file
 * WARNING: This will replace all existing data
 */
export async function restoreFromBackup(file: File): Promise<{
    success: boolean;
    message: string;
    restored?: {
        products: number;
        variants: number;
        vendors: number;
        sales: number;
    };
}> {
    try {
        const content = await readFileAsText(file);
        const data = JSON.parse(content);

        if (!validateBackup(data)) {
            return { success: false, message: "Invalid backup file format" };
        }

        // Check version compatibility
        if (data.version !== BACKUP_VERSION) {
            console.warn(`Backup version mismatch: ${data.version} vs ${BACKUP_VERSION}`);
        }

        // Restore in order (respecting foreign keys)
        // 1. Vendors first (no dependencies)
        if (data.tables.vendors.length > 0) {
            const { error } = await supabase
                .from("vendors")
                .upsert(data.tables.vendors as never, { onConflict: "id" });
            if (error) throw new Error(`Vendors restore failed: ${error.message}`);
        }

        // 2. Products
        if (data.tables.products.length > 0) {
            const { error } = await supabase
                .from("products")
                .upsert(data.tables.products as never, { onConflict: "id" });
            if (error) throw new Error(`Products restore failed: ${error.message}`);
        }

        // 3. Product variants
        if (data.tables.product_variants.length > 0) {
            const { error } = await supabase
                .from("product_variants")
                .upsert(data.tables.product_variants as never, { onConflict: "id" });
            if (error) throw new Error(`Variants restore failed: ${error.message}`);
        }

        // 4. Sales
        if (data.tables.sales.length > 0) {
            const { error } = await supabase
                .from("sales")
                .upsert(data.tables.sales as never, { onConflict: "id" });
            if (error) throw new Error(`Sales restore failed: ${error.message}`);
        }

        // 5. Sale items
        if (data.tables.sale_items.length > 0) {
            const { error } = await supabase
                .from("sale_items")
                .upsert(data.tables.sale_items as never, { onConflict: "id" });
            if (error) throw new Error(`Sale items restore failed: ${error.message}`);
        }

        // 6. Stock movements
        if (data.tables.stock_movements.length > 0) {
            const { error } = await supabase
                .from("stock_movements")
                .upsert(data.tables.stock_movements as never, { onConflict: "id" });
            if (error) throw new Error(`Stock movements restore failed: ${error.message}`);
        }

        return {
            success: true,
            message: `Backup from ${new Date(data.createdAt).toLocaleDateString()} restored successfully`,
            restored: {
                products: data.tables.products.length,
                variants: data.tables.product_variants.length,
                vendors: data.tables.vendors.length,
                sales: data.tables.sales.length,
            },
        };
    } catch (err) {
        console.error("Restore failed:", err);
        return {
            success: false,
            message: err instanceof Error ? err.message : "Unknown error during restore",
        };
    }
}

/**
 * Schedule automatic daily backup
 */
export function scheduleAutoBackup(
    onBackupComplete?: (success: boolean) => void
): () => void {
    // Calculate time until next midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    let dailyInterval: NodeJS.Timeout;

    // First backup at midnight
    const initialTimeout = setTimeout(async () => {
        const backup = await createBackup();
        const success = backup !== null;

        // Store backup in localStorage as fallback
        if (backup && typeof window !== "undefined") {
            try {
                localStorage.setItem("luminila_auto_backup", JSON.stringify(backup));
                localStorage.setItem("luminila_last_backup", new Date().toISOString());
            } catch {
                console.warn("Failed to store auto backup in localStorage");
            }
        }

        onBackupComplete?.(success);

        // Then every 24 hours
        dailyInterval = setInterval(async () => {
            const dailyBackup = await createBackup();
            if (dailyBackup && typeof window !== "undefined") {
                try {
                    localStorage.setItem("luminila_auto_backup", JSON.stringify(dailyBackup));
                    localStorage.setItem("luminila_last_backup", new Date().toISOString());
                } catch {
                    console.warn("Failed to store auto backup");
                }
            }
            onBackupComplete?.(dailyBackup !== null);
        }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);

    // Return cleanup function
    return () => {
        clearTimeout(initialTimeout);
        if (dailyInterval) clearInterval(dailyInterval);
    };
}

/**
 * Get last backup info
 */
export function getLastBackupInfo(): { date: string | null; available: boolean } {
    if (typeof window === "undefined") {
        return { date: null, available: false };
    }

    const lastBackup = localStorage.getItem("luminila_last_backup");
    const backupData = localStorage.getItem("luminila_auto_backup");

    return {
        date: lastBackup,
        available: !!backupData,
    };
}

/**
 * Restore from last auto backup
 */
export async function restoreFromAutoBackup(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    const backupData = localStorage.getItem("luminila_auto_backup");
    if (!backupData) return false;

    try {
        const data = JSON.parse(backupData);
        if (!validateBackup(data)) return false;

        // Create a fake File object
        const file = new File([backupData], "auto_backup.json", { type: "application/json" });
        const result = await restoreFromBackup(file);
        return result.success;
    } catch {
        return false;
    }
}
