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

import { pb, accountScopeEmail } from "./pocketbase";
import { markStockDiscrepancy } from "./discrepancies";

/** Stable 15-char id for a per-item audit adjustment claim (S-14). */
function auditAdjustmentClaimId(auditId: string, kind: string, sku: string): string {
    const key = `${auditId}:${kind}:${sku}`;
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < key.length; index += 1) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `cca${hash.toString(36).padStart(12, '0').slice(0, 12)}`;
}

/** PocketBase reports a client-supplied id clash as a 400 validation_not_unique. */
function isDuplicateIdError(error: unknown): boolean {
    const candidate = error as { status?: number; data?: { data?: Record<string, { code?: string }> } };
    return candidate?.status === 400
        && candidate?.data?.data?.id?.code === 'validation_not_unique';
}

/**
 * S-14: atomically claim one audit adjustment. A retry after a crash (or after a
 * failed audit-row finalise) sees the duplicate and skips the item instead of
 * applying it twice. Claims are intentionally NOT released on a write failure —
 * a partial adjustment (stock moved, ledger row failed) must never be re-run;
 * delete the claim row to let an operator re-apply deliberately.
 */
async function claimAuditAdjustment(auditId: string, kind: string, sku: string): Promise<boolean> {
    try {
        await pb.collection("activity_logs").create({
            id: auditAdjustmentClaimId(auditId, kind, sku),
            account_email: accountScopeEmail(),
            entity_type: "audit_adjustment_claim",
            entity_id: auditId,
            action: kind,
            description: `Idempotency claim: ${kind} adjustment for ${sku} in audit ${auditId}`,
        });
        return true;
    } catch (err) {
        if (isDuplicateIdError(err)) return false;
        throw err;
    }
}

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
    auditedBy: string = "Staff",
    /** B4: the failed attempt's audit id, so a retry's claims collide with the
     *  succeeded items instead of double-applying them under a fresh id. */
    retryOfAuditId?: string
): Promise<CommitAuditResult> {
    const accountEmail = accountScopeEmail();
    let quarantinedCount = 0;
    let surplusAdjustedCount = 0;
    let locationMovedCount = 0;
    // H-09: a per-item failure used to be only warned, then the audit was
    // marked completed and the UI told the user everything was recorded.
    const failures: string[] = [];
    let auditRecordId = '';

    try {
        // S-14: create the audit row FIRST (in_progress). If the write is
        // refused, no stock has moved and a retry starts from a clean state;
        // the old ordering applied adjustments before a failed audit create
        // and a retry duplicated them.
        const record = await pb.collection("inventory_audits").create({
            account_email: accountEmail,
            location: diff.targetLocation,
            status: "in_progress",
            audited_by: auditedBy,
        });
        auditRecordId = record.id;
        // B4: every invocation mints a fresh record id, so claims keyed to it
        // could never dedupe a retry — succeeded items re-applied (double
        // quarantine rows, double surplus stock). Key claims to the failed
        // attempt's id when the caller passes one back.
        const claimBase = retryOfAuditId || record.id;

        // 1. Reconcile Missing Items
        if (decisions.quarantineMissing) {
            for (const item of diff.missing) {
                const missingQty = item.expectedQuantity - item.scannedQuantity;
                if (missingQty > 0 && item.variantId) {
                    if (!(await claimAuditAdjustment(claimBase, "missing", item.sku))) continue;
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
                        const msg = `Failed to quarantine missing item ${item.sku}: ${e instanceof Error ? e.message : String(e)}`;
                        console.warn(msg);
                        failures.push(msg);
                    }
                }
            }
        }

        // 2. Reconcile Surplus Items
        if (decisions.acceptSurplus) {
            for (const item of diff.surplus) {
                const surplusQty = item.scannedQuantity - item.expectedQuantity;
                if (surplusQty > 0 && item.variantId) {
                    if (!(await claimAuditAdjustment(claimBase, "surplus", item.sku))) continue;
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
                        const msg = `Failed to adjust surplus on ${item.sku}: ${e instanceof Error ? e.message : String(e)}`;
                        console.warn(msg);
                        failures.push(msg);
                    }
                }
            }
        }

        // 3. Reconcile Misplaced Items
        const misplacedMap = decisions.misplacedActions || {};
        for (const item of diff.misplaced) {
            if (misplacedMap[item.sku] === "move_to_tray") {
                if (!(await claimAuditAdjustment(claimBase, "misplaced", item.sku))) continue;
                try {
                    await pb.collection("products").update(item.productId, {
                        location: diff.targetLocation,
                    });
                    locationMovedCount++;
                } catch (e) {
                    const msg = `Failed to update location for misplaced ${item.sku}: ${e instanceof Error ? e.message : String(e)}`;
                    console.warn(msg);
                    failures.push(msg);
                }
            }
        }

        // 4. Finalize the audit row. "partial" is not an allowed status value
        // in inventory_audits (in_progress/completed/cancelled), which made the
        // old final create fail after every adjustment; per-item failures are
        // reported in the summary and the returned result instead.
        await pb.collection("inventory_audits").update(record.id, {
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
                failures,
            },
            completed_at: new Date().toISOString(),
        });

        return {
            success: failures.length === 0,
            auditId: record.id,
            quarantinedCount,
            surplusAdjustedCount,
            locationMovedCount,
            ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
        };
    } catch (err) {
        console.error("Failed to commit tray audit:", err);
        return {
            success: false,
            // B4: hand the audit id back even on a hard failure so the modal
            // can pass it as retryOfAuditId and the retry dedupes the items
            // that already applied.
            ...(auditRecordId ? { auditId: auditRecordId } : {}),
            quarantinedCount,
            surplusAdjustedCount,
            locationMovedCount,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
