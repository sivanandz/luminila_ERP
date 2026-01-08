/**
 * Backup & Restore Utilities
 * Handles data export and import for disaster recovery using PocketBase
 */

import { pb } from "./pocketbase";
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
        const [products, variants, vendors, sales, saleItems, movements] = await Promise.all([
            pb.collection("products").getFullList(),
            pb.collection("product_variants").getFullList(),
            pb.collection("vendors").getFullList(),
            pb.collection("sales").getFullList(),
            pb.collection("sale_items").getFullList(),
            pb.collection("stock_movements").getFullList(),
        ]);

        const backup: BackupData = {
            version: BACKUP_VERSION,
            createdAt: new Date().toISOString(),
            tables: {
                products: products || [],
                product_variants: variants || [],
                vendors: vendors || [],
                sales: sales || [],
                sale_items: saleItems || [],
                stock_movements: movements || [],
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

        if (data.version !== BACKUP_VERSION) {
            console.warn(`Backup version mismatch: ${data.version} vs ${BACKUP_VERSION}`);
        }

        // Restore in order (respecting foreign keys)
        // 1. Vendors first
        for (const vendor of data.tables.vendors as any[]) {
            try {
                const existing = await pb.collection("vendors").getOne(vendor.id).catch(() => null);
                if (existing) {
                    await pb.collection("vendors").update(vendor.id, vendor);
                } else {
                    await pb.collection("vendors").create(vendor);
                }
            } catch (e) {
                console.warn(`Failed to restore vendor ${vendor.id}:`, e);
            }
        }

        // 2. Products
        for (const product of data.tables.products as any[]) {
            try {
                const existing = await pb.collection("products").getOne(product.id).catch(() => null);
                if (existing) {
                    await pb.collection("products").update(product.id, product);
                } else {
                    await pb.collection("products").create(product);
                }
            } catch (e) {
                console.warn(`Failed to restore product ${product.id}:`, e);
            }
        }

        // 3. Product variants
        for (const variant of data.tables.product_variants as any[]) {
            try {
                const existing = await pb.collection("product_variants").getOne(variant.id).catch(() => null);
                if (existing) {
                    await pb.collection("product_variants").update(variant.id, variant);
                } else {
                    await pb.collection("product_variants").create(variant);
                }
            } catch (e) {
                console.warn(`Failed to restore variant ${variant.id}:`, e);
            }
        }

        // 4. Sales
        for (const sale of data.tables.sales as any[]) {
            try {
                const existing = await pb.collection("sales").getOne(sale.id).catch(() => null);
                if (existing) {
                    await pb.collection("sales").update(sale.id, sale);
                } else {
                    await pb.collection("sales").create(sale);
                }
            } catch (e) {
                console.warn(`Failed to restore sale ${sale.id}:`, e);
            }
        }

        // 5. Sale items
        for (const item of data.tables.sale_items as any[]) {
            try {
                const existing = await pb.collection("sale_items").getOne(item.id).catch(() => null);
                if (existing) {
                    await pb.collection("sale_items").update(item.id, item);
                } else {
                    await pb.collection("sale_items").create(item);
                }
            } catch (e) {
                console.warn(`Failed to restore sale item ${item.id}:`, e);
            }
        }

        // 6. Stock movements
        for (const movement of data.tables.stock_movements as any[]) {
            try {
                const existing = await pb.collection("stock_movements").getOne(movement.id).catch(() => null);
                if (existing) {
                    await pb.collection("stock_movements").update(movement.id, movement);
                } else {
                    await pb.collection("stock_movements").create(movement);
                }
            } catch (e) {
                console.warn(`Failed to restore movement ${movement.id}:`, e);
            }
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
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    let dailyInterval: NodeJS.Timeout;

    const initialTimeout = setTimeout(async () => {
        const backup = await createBackup();
        const success = backup !== null;

        if (backup && typeof window !== "undefined") {
            try {
                localStorage.setItem("luminila_auto_backup", JSON.stringify(backup));
                localStorage.setItem("luminila_last_backup", new Date().toISOString());
            } catch {
                console.warn("Failed to store auto backup in localStorage");
            }
        }

        onBackupComplete?.(success);

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

        const file = new File([backupData], "auto_backup.json", { type: "application/json" });
        const result = await restoreFromBackup(file);
        return result.success;
    } catch {
        return false;
    }
}
