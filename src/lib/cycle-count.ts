/**
 * Tray & Bin Barcode Cycle-Count Service (Phase 4).
 *
 * Provides a rapid barcode audit station for physical showcase trays and storage bins.
 * Classifies scans into 4 distinct buckets:
 * 1. Matched: scanned count matches expected shelf quantity.
 * 2. Missing: expected units not found on tray (can be auto-quarantined to stock_discrepancies).
 * 3. Surplus: extra units scanned beyond recorded stock (reconciled as audit_surplus movements).
 * 4. Misplaced: piece belongs to a different location but was scanned on this tray (1-click move).
 */

import { pb, accountScopeEmail, sanitizeFilter } from "./pocketbase";
import { markStockDiscrepancy } from "./discrepancies";

export interface TrayAuditLineItem {
    productId: string;
    variantId: string;
    sku: string;
    name: string;
    expectedLocation: string;
    expectedQuantity: number;
    scannedQuantity: number;
    variance: number; // scanned - expected
    image_url?: string | null;
}

export interface TrayAuditDiff {
    targetLocation: string;
    totalExpected: number;
    totalScanned: number;
    matched: TrayAuditLineItem[];
    missing: TrayAuditLineItem[];
    surplus: TrayAuditLineItem[];
    misplaced: TrayAuditLineItem[];
}

export interface ReconcileDecision {
    quarantineMissing?: boolean;
    acceptSurplus?: boolean;
    misplacedActions?: Record<string, "move_to_tray" | "keep_original">;
}

// ===========================================
// PURE LOGIC (IO-FREE FOR UNIT TESTING)
// ===========================================

/**
 * Compare expected catalog stock for a location against physical barcode scan counts.
 */
export function computeTrayAuditDiff(
    allProductsInStore: Array<{
        id: string;
        variant_id?: string;
        sku: string;
        name: string;
        location?: string;
        stock: number;
        image_url?: string | null;
    }>,
    scannedCounts: Map<string, number>,
    targetLocation: string
): TrayAuditDiff {
    const matched: TrayAuditLineItem[] = [];
    const missing: TrayAuditLineItem[] = [];
    const surplus: TrayAuditLineItem[] = [];
    const misplaced: TrayAuditLineItem[] = [];

    const expectedOnTray = allProductsInStore.filter(
        (p) => (p.location || "Showcase Tray A") === targetLocation
    );

    const handledSkus = new Set<string>();

    let totalExpected = 0;
    let totalScanned = 0;

    for (const p of expectedOnTray) {
        handledSkus.add(p.sku.toUpperCase());
        const expected = Math.max(0, p.stock);
        totalExpected += expected;
        const scanned = scannedCounts.get(p.sku.toUpperCase()) || 0;
        totalScanned += scanned;

        const lineItem: TrayAuditLineItem = {
            productId: p.id,
            variantId: p.variant_id || "",
            sku: p.sku,
            name: p.name,
            expectedLocation: p.location || targetLocation,
            expectedQuantity: expected,
            scannedQuantity: scanned,
            variance: scanned - expected,
            image_url: p.image_url,
        };

        if (scanned === expected) {
            matched.push(lineItem);
        } else if (scanned < expected) {
            missing.push(lineItem);
        } else {
            surplus.push(lineItem);
        }
    }

    // Now check for misplaced items: items scanned on this tray whose catalog location is elsewhere
    for (const [scannedSku, count] of scannedCounts.entries()) {
        if (handledSkus.has(scannedSku)) continue;
        const foundProduct = allProductsInStore.find(
            (p) => p.sku.toUpperCase() === scannedSku
        );

        if (foundProduct) {
            totalScanned += count;
            misplaced.push({
                productId: foundProduct.id,
                variantId: foundProduct.variant_id || "",
                sku: foundProduct.sku,
                name: foundProduct.name,
                expectedLocation: foundProduct.location || "Other",
                expectedQuantity: foundProduct.stock,
                scannedQuantity: count,
                variance: count,
                image_url: foundProduct.image_url,
            });
        }
    }

    return {
        targetLocation,
        totalExpected,
        totalScanned,
        matched,
        missing,
        surplus,
        misplaced,
    };
}

// ===========================================
// IO LAYER
// ===========================================

export interface CommitAuditResult {
    success: boolean;
    auditId?: string;
    quarantinedCount: number;
    surplusAdjustedCount: number;
    locationMovedCount: number;
    error?: string;
}

/**
 * Persist audit results and apply reconciliation decisions:
 * 1. Auto-quarantine missing items to stock_discrepancies ('missing').
 * 2. Add audit_surplus movements & increment stock for surplus items.
 * 3. Update products.location for misplaced items if decision === 'move_to_tray'.
 * 4. Record session in inventory_audits collection.
 */
export async function commitTrayAudit(
    diff: TrayAuditDiff,
    decisions: ReconcileDecision,
    auditedBy: string = "Staff"
): Promise<CommitAuditResult> {
    const accountEmail = accountScopeEmail();
    let quarantinedCount = 0;
    let surplusAdjustedCount = 0;
    let locationMovedCount = 0;

    try {
        // 1. Reconcile Missing Items
        if (decisions.quarantineMissing) {
            for (const item of diff.missing) {
                const missingQty = item.expectedQuantity - item.scannedQuantity;
                if (missingQty > 0 && item.variantId) {
                    try {
                        await markStockDiscrepancy({
                            product_id: item.productId,
                            variant_id: item.variantId,
                            sku: item.sku,
                            product_name: item.name,
                            discrepancy_type: "missing",
                            quantity: missingQty,
                            reason: `Cycle-Count Shortage during audit of ${diff.targetLocation} (Expected ${item.expectedQuantity}, Scanned ${item.scannedQuantity})`,
                            flagged_by: auditedBy,
                        });
                        quarantinedCount++;
                    } catch (e) {
                        console.warn(`Failed to quarantine missing item ${item.sku}:`, e);
                    }
                }
            }
        }

        // 2. Reconcile Surplus Items
        if (decisions.acceptSurplus) {
            for (const item of diff.surplus) {
                const surplusQty = item.scannedQuantity - item.expectedQuantity;
                if (surplusQty > 0 && item.variantId) {
                    try {
                        await pb.collection("product_variants").update(item.variantId, {
                            "stock_level+": surplusQty,
                        });
                        await pb.collection("stock_movements").create({
                            account_email: accountEmail,
                            variant: item.variantId,
                            movement_type: "audit_surplus",
                            quantity: surplusQty,
                            source: "cycle_count",
                            notes: `Cycle-Count Surplus on ${diff.targetLocation}: adjusted +${surplusQty} units`,
                        });
                        surplusAdjustedCount++;
                    } catch (e) {
                        console.warn(`Failed to adjust surplus on ${item.sku}:`, e);
                    }
                }
            }
        }

        // 3. Reconcile Misplaced Items
        const misplacedMap = decisions.misplacedActions || {};
        for (const item of diff.misplaced) {
            if (misplacedMap[item.sku] === "move_to_tray") {
                try {
                    await pb.collection("products").update(item.productId, {
                        location: diff.targetLocation,
                    });
                    locationMovedCount++;
                } catch (e) {
                    console.warn(`Failed to update location for misplaced ${item.sku}:`, e);
                }
            }
        }

        // 4. Save audit log record in inventory_audits
        const record = await pb.collection("inventory_audits").create({
            account_email: accountEmail,
            location: diff.targetLocation,
            status: "completed",
            scanned_items: {
                matchedCount: diff.matched.length,
                missingCount: diff.missing.length,
                surplusCount: diff.surplus.length,
                misplacedCount: diff.misplaced.length,
            },
            summary: {
                totalExpected: diff.totalExpected,
                totalScanned: diff.totalScanned,
                quarantined: quarantinedCount,
                surplusAdded: surplusAdjustedCount,
                locationsUpdated: locationMovedCount,
            },
            audited_by: auditedBy,
            completed_at: new Date().toISOString(),
        });

        return {
            success: true,
            auditId: record.id,
            quarantinedCount,
            surplusAdjustedCount,
            locationMovedCount,
        };
    } catch (err) {
        console.error("Failed to commit tray audit:", err);
        return {
            success: false,
            quarantinedCount,
            surplusAdjustedCount,
            locationMovedCount,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
