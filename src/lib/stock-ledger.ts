/**
 * Stock Ledger Service
 * Provides a unified, chronological audit trail of all inventory events
 * for any given product or variant (sales, PO receipts, quarantine flags,
 * cycle count adjustments, returns, transfers) with running balance.
 */

import { pb, accountScopeEmail, sanitizeFilter } from "./pocketbase";

export interface StockLedgerEntry {
    id: string;
    date: string;
    movement_type: string;
    type_label: string;
    type_color: "emerald" | "amber" | "red" | "blue" | "purple" | "slate";
    quantity: number; // e.g. +10, -1
    running_balance: number;
    reference_id?: string;
    source?: string;
    notes?: string;
}

export interface ProductStockSummary {
    productId: string;
    sku: string;
    name: string;
    currentStock: number;
    location: string;
    entries: StockLedgerEntry[];
}

const TYPE_CONFIG: Record<
    string,
    { label: string; color: StockLedgerEntry["type_color"] }
> = {
    sale: { label: "Sale (POS/Channel)", color: "red" },
    intake: { label: "Manual Inward Intake", color: "emerald" },
    grn: { label: "PO Receipt (GRN)", color: "emerald" },
    purchase: { label: "Purchase Order Receipt", color: "emerald" },
    quarantine: { label: "Quarantined / Defect", color: "amber" },
    audit_surplus: { label: "Cycle-Count Surplus", color: "blue" },
    audit_deficit: { label: "Cycle-Count Missing", color: "amber" },
    return: { label: "Customer Return Restock", color: "purple" },
    transfer_in: { label: "Transfer Inward", color: "blue" },
    transfer_out: { label: "Transfer Outward", color: "slate" },
    adjustment: { label: "Stock Adjustment", color: "slate" },
};

/**
 * Fetch chronological stock ledger for a product and its variants.
 */
export async function getProductStockLedger(
    productId: string,
    variantId?: string
): Promise<StockLedgerEntry[]> {
    try {
        const tenant = accountScopeEmail();
        const tenantFilter = tenant ? `account_email = "${sanitizeFilter(tenant)}"` : "";

        // 1. Gather all variant IDs for this product if variantId not passed
        let targetVariantIds: string[] = [];
        if (variantId) {
            targetVariantIds = [variantId];
        } else {
            const variants = await pb.collection("product_variants").getFullList({
                filter: `product = "${sanitizeFilter(productId)}"${tenantFilter ? ` && ${tenantFilter}` : ""}`,
                fields: "id",
            });
            targetVariantIds = variants.map((v) => v.id);
        }

        if (targetVariantIds.length === 0) return [];

        // 2. Fetch stock movements matching any of these variants
        const variantClauses = targetVariantIds.map((id) => `variant = "${id}"`).join(" || ");
        const filter = `(${variantClauses})${tenantFilter ? ` && ${tenantFilter}` : ""}`;

        const movements = await pb.collection("stock_movements").getFullList<{
            id: string;
            variant: string;
            movement_type: string;
            quantity: number;
            reference_id?: string;
            source?: string;
            notes?: string;
            created: string;
        }>({
            filter,
            sort: "created", // Ascending for accurate running balance calculation
        });

        // 3. Compute running balance chronologically
        let runningBalance = 0;
        const entries: StockLedgerEntry[] = [];

        for (const mov of movements) {
            const qty = Number(mov.quantity) || 0;
            runningBalance += qty;

            const config = TYPE_CONFIG[mov.movement_type] || {
                label: mov.movement_type.toUpperCase(),
                color: qty > 0 ? "emerald" : "slate",
            };

            entries.push({
                id: mov.id,
                date: mov.created,
                movement_type: mov.movement_type,
                type_label: config.label,
                type_color: config.color,
                quantity: qty,
                running_balance: runningBalance,
                reference_id: mov.reference_id,
                source: mov.source,
                notes: mov.notes,
            });
        }

        // Return newest first for ledger display
        return entries.reverse();
    } catch (err) {
        console.error("Failed to load stock ledger:", err);
        return [];
    }
}
