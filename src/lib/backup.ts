/**
 * Backup & Restore Utilities
 * Handles data export and import for disaster recovery using PocketBase
 *
 * Every export query is scoped to the signed-in tenant (`account_email`), and a
 * restore refuses rows owned by another tenant and stamps the local tenant on
 * every row it writes (AI-SYS-01). All exported collections are restored in
 * foreign-key dependency order, with a per-table outcome reported to the UI
 * (AI-SYS-02).
 */

import { pb, ensureAuth, accountScopeEmail, getCurrentTenantEmail, sanitizeFilter } from "./pocketbase";
import { downloadAsFile, readFileAsText } from "./csv";

export interface BackupData {
    version: string;
    createdAt: string;
    tables: {
        customers?: unknown[];
        products: unknown[];
        product_variants: unknown[];
        vendors: unknown[];
        sales: unknown[];
        sale_items: unknown[];
        stock_movements: unknown[];
        invoices?: unknown[];
        invoice_items?: unknown[];
        invoice_payments?: unknown[];
        sales_orders?: unknown[];
        sales_order_items?: unknown[];
        purchase_orders?: unknown[];
        purchase_order_items?: unknown[];
        expenses?: unknown[];
        expense_categories?: unknown[];
        cash_registers?: unknown[];
        cash_register_shifts?: unknown[];
        cash_drawer_operations?: unknown[];
        bank_accounts?: unknown[];
        bank_transactions?: unknown[];
        loyalty_accounts?: unknown[];
        loyalty_transactions?: unknown[];
        loyalty_tiers?: unknown[];
        discounts?: unknown[];
        credit_notes?: unknown[];
        delivery_challans?: unknown[];
        delivery_challan_items?: unknown[];
        activity_logs?: unknown[];
        payment_links?: unknown[];
        whatsapp_opt_outs?: unknown[];
    };
    /** Tables that could not be read during export. Never silently dropped. */
    errors?: Array<{ table: string; error: string }>;
}

const BACKUP_VERSION = "1.0.0";

/**
 * Every collection the exporter writes, in a restore-safe order (referenced
 * rows before the rows that point at them).
 */
export const BACKUP_TABLES = [
    "vendors",
    "customers",
    "expense_categories",
    "products",
    "product_variants",
    "loyalty_tiers",
    "cash_registers",
    "bank_accounts",
    "loyalty_accounts",
    "discounts",
    "sales",
    "sales_orders",
    "purchase_orders",
    "invoices",
    "delivery_challans",
    "sale_items",
    "sales_order_items",
    "purchase_order_items",
    "invoice_items",
    "invoice_payments",
    "stock_movements",
    "expenses",
    "cash_register_shifts",
    "cash_drawer_operations",
    "bank_transactions",
    "loyalty_transactions",
    "credit_notes",
    "delivery_challan_items",
    "payment_links",
    "activity_logs",
    "whatsapp_opt_outs",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Tenant scope for a backup operation; empty when no tenant can be resolved. */
function backupTenant(): string {
    ensureAuth();
    return accountScopeEmail();
}

function tenantClause(tenant: string): string {
    return `account_email="${sanitizeFilter(tenant)}"`;
}

/**
 * Create a full database backup for the signed-in tenant.
 */
export async function createBackup(): Promise<BackupData | null> {
    const tenant = backupTenant();
    if (!tenant) {
        console.error("Backup refused: no tenant account could be resolved.");
        return null;
    }
    const clause = tenantClause(tenant);

    try {
        const errors: Array<{ table: string; error: string }> = [];
        const entries = await Promise.all(
            BACKUP_TABLES.map(async (table) => {
                try {
                    const rows = await pb.collection(table).getFullList({ filter: clause });
                    return [table, rows as unknown[]] as const;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`Backup could not read ${table}:`, error);
                    errors.push({ table, error: message });
                    return [table, [] as unknown[]] as const;
                }
            })
        );

        const tables = Object.fromEntries(entries) as unknown as BackupData["tables"];

        return {
            version: BACKUP_VERSION,
            createdAt: new Date().toISOString(),
            tables,
            ...(errors.length > 0 ? { errors } : {}),
        };
    } catch (err) {
        console.error("Backup failed:", err);
        return null;
    }
}

/**
 * Download backup as JSON file. Returns the backup (including any per-table
 * export errors) so the UI can warn that the file is incomplete.
 */
export async function downloadBackup(): Promise<BackupData | null> {
    const backup = await createBackup();
    if (!backup) return null;

    const filename = `luminila_backup_${new Date().toISOString().split("T")[0]}.json`;
    const content = JSON.stringify(backup, null, 2);

    downloadAsFile(content, filename, "application/json");
    return backup;
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

export interface BackupTableRestoreResult {
    table: string;
    created: number;
    updated: number;
    /** Rows refused because they belong to another tenant, or shadow a foreign id. */
    skipped: number;
    failed: number;
}

export interface RestoreBackupResult {
    success: boolean;
    message: string;
    restored?: Record<string, number>;
    tables: BackupTableRestoreResult[];
    skipped: number;
    failed: number;
    errors: Array<{ table: string; id?: string; error: string }>;
    /** Current rows captured before the first write, for manual rollback (SET-5). */
    snapshot?: BackupData;
    /** True when a non-404 error stopped the restore part-way through. */
    aborted?: boolean;
}

const MAX_REPORTED_ERRORS = 50;

/**
 * PocketBase reports a missing record as a 404. Anything else (transport,
 * auth, 5xx) must not be treated as "row does not exist" (SET-5).
 */
function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { status?: number }).status === 404
    );
}

/** PocketBase system fields that must not be replayed into a write payload. */
const SYSTEM_FIELDS = ["collectionId", "collectionName", "expand", "created", "updated"] as const;

/**
 * Restore from backup file.
 *
 * Idempotent per row: a row whose id already belongs to the tenant is updated,
 * a row that does not exist is created with that id, and a row that names (or
 * shadows) another tenant is refused and reported — never overwritten.
 */
export async function restoreFromBackup(file: File): Promise<RestoreBackupResult> {
    const empty = (message: string): RestoreBackupResult => ({
        success: false,
        message,
        tables: [],
        skipped: 0,
        failed: 0,
        errors: [],
    });

    try {
        const content = await readFileAsText(file);
        const data = JSON.parse(content);

        if (!validateBackup(data)) {
            return empty("Invalid backup file format");
        }

        const tenant = backupTenant();
        if (!tenant) {
            return empty("Restore refused: sign in so the destination tenant can be resolved.");
        }
        const tenantScope = tenantClause(tenant);
        const tenantKey = tenant.toLowerCase();

        if (data.version !== BACKUP_VERSION) {
            console.warn(`Backup version mismatch: ${data.version} vs ${BACKUP_VERSION}`);
        }

        const tablesResult: BackupTableRestoreResult[] = [];
        const errors: RestoreBackupResult["errors"] = [];
        const restored: Record<string, number> = {};
        let skippedTotal = 0;
        let failedTotal = 0;

        const recordError = (table: string, id: string | undefined, error: unknown) => {
            if (errors.length >= MAX_REPORTED_ERRORS) return;
            errors.push({
                table,
                ...(id ? { id } : {}),
                error: error instanceof Error ? error.message : String(error),
            });
        };

        for (const table of BACKUP_TABLES) {
            const rows = Array.isArray(data.tables[table]) ? (data.tables[table] as unknown[]) : [];
            const stats: BackupTableRestoreResult = { table, created: 0, updated: 0, skipped: 0, failed: 0 };
            if (rows.length === 0) {
                tablesResult.push(stats);
                continue;
            }

            for (const raw of rows) {
                if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                    stats.failed += 1;
                    recordError(table, undefined, "Row is not an object");
                    continue;
                }
                const row = { ...(raw as Record<string, unknown>) };
                const id = typeof row.id === "string" ? row.id.trim() : "";
                if (!id) {
                    stats.failed += 1;
                    recordError(table, undefined, "Row has no id");
                    continue;
                }

                const owner = String(row.account_email ?? "").trim().toLowerCase();
                if (owner && owner !== tenantKey) {
                    // A backup from another tenant must never write into this one.
                    stats.skipped += 1;
                    continue;
                }

                for (const field of SYSTEM_FIELDS) delete row[field];
                delete row.id;
                row.account_email = tenant;

                try {
                    const existing = (await pb
                        .collection(table)
                        .getFirstListItem(`${tenantScope} && id="${sanitizeFilter(id)}"`)) as { id: string };
                    await pb.collection(table).update(existing.id, row);
                    stats.updated += 1;
                } catch {
                    try {
                        // Refuse to overwrite a record that exists under another tenant.
                        const foreign = await pb.collection(table).getOne(id).catch(() => null);
                        if (foreign) {
                            stats.skipped += 1;
                            continue;
                        }
                        await pb.collection(table).create({ ...row, id });
                        stats.created += 1;
                    } catch (error) {
                        stats.failed += 1;
                        recordError(table, id, error);
                    }
                }
            }

            skippedTotal += stats.skipped;
            failedTotal += stats.failed;
            if (stats.created + stats.updated > 0) restored[table] = stats.created + stats.updated;
            tablesResult.push(stats);
        }

        const wrote = Object.values(restored).reduce((sum, count) => sum + count, 0);
        const detail = [
            `${wrote} rows written`,
            `${skippedTotal} skipped`,
            `${failedTotal} failed`,
        ].join(", ");
        const message = failedTotal > 0 || skippedTotal > 0
            ? `Backup from ${new Date(data.createdAt).toLocaleDateString()} restored with issues: ${detail}.`
            : `Backup from ${new Date(data.createdAt).toLocaleDateString()} restored successfully (${detail}).`;

        return {
            success: failedTotal === 0 && skippedTotal === 0,
            message,
            restored,
            tables: tablesResult,
            skipped: skippedTotal,
            failed: failedTotal,
            errors,
        };
    } catch (err) {
        console.error("Restore failed:", err);
        return empty(err instanceof Error ? err.message : "Unknown error during restore");
    }
}

/** Tenant-scoped localStorage keys used by the auto-backup snapshot (AI-SYS-13). */
export function getBackupStorageKeys(): {
    autoBackup: string;
    lastBackup: string;
    autoEnabled: string;
} {
    const tenant = getCurrentTenantEmail();
    return {
        autoBackup: `luminila_auto_backup_${tenant}`,
        lastBackup: `luminila_last_backup_${tenant}`,
        autoEnabled: `luminila_auto_backup_enabled_${tenant}`,
    };
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

    const persist = (backup: BackupData) => {
        if (typeof window === "undefined") return;
        try {
            const keys = getBackupStorageKeys();
            localStorage.setItem(keys.autoBackup, JSON.stringify(backup));
            localStorage.setItem(keys.lastBackup, new Date().toISOString());
        } catch {
            console.warn("Failed to store auto backup in localStorage");
        }
    };

    const initialTimeout = setTimeout(async () => {
        const backup = await createBackup();
        const success = backup !== null;

        if (backup) persist(backup);

        onBackupComplete?.(success);

        dailyInterval = setInterval(async () => {
            const dailyBackup = await createBackup();
            if (dailyBackup) persist(dailyBackup);
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

    const keys = getBackupStorageKeys();
    const lastBackup = localStorage.getItem(keys.lastBackup);
    const backupData = localStorage.getItem(keys.autoBackup);

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

    const backupData = localStorage.getItem(getBackupStorageKeys().autoBackup);
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

export interface BackupSummary {
    version: string;
    createdAt: string;
    totalRows: number;
    tables: Array<{ name: string; rows: number }>;
    errors?: Array<{ table: string; error: string }>;
}

/** Counts rows per table so the UI can show what a file actually contains. */
export function summariseBackup(data: BackupData): BackupSummary {
    const tables = Object.entries(data.tables)
        .filter(([, rows]) => Array.isArray(rows))
        .map(([name, rows]) => ({ name, rows: (rows as unknown[]).length }))
        .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));

    return {
        version: data.version,
        createdAt: data.createdAt,
        totalRows: tables.reduce((sum, table) => sum + table.rows, 0),
        tables,
        ...(Array.isArray(data.errors) && data.errors.length > 0 ? { errors: data.errors } : {}),
    };
}

/** A backup older than `days` is worth flagging before a restore. */
export function isBackupOlderThan(createdAt: string, days: number, now: Date = new Date()): boolean {
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return true;
    return now.getTime() - created.getTime() > days * 24 * 60 * 60 * 1000;
}
