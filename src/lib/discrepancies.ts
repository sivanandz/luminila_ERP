/**
 * Stock Discrepancies & Quarantine Management
 * Tracks items that are Damaged, Missing, or Returned to Vendor for Replacement.
 * Supports disabling the flag when replacements arrive to restore sellable inventory.
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

export type DiscrepancyType = 'damaged' | 'missing' | 'vendor_replacement';
export type DiscrepancyStatus = 'active' | 'resolved';
export type ResolutionAction = 'replacement_received' | 'repaired' | 'written_off';

export interface StockDiscrepancy {
    id: string;
    product: string;
    variant: string;
    sku: string;
    product_name: string;
    discrepancy_type: DiscrepancyType;
    quantity: number;
    vendor_name?: string;
    reason?: string;
    notes?: string;
    status: DiscrepancyStatus;
    flagged_by?: string;
    resolved_by?: string;
    resolved_at?: string;
    resolution_action?: ResolutionAction;
    resolution_note?: string;
    created?: string;
    updated?: string;
}

export interface MarkDiscrepancyInput {
    product_id?: string;
    variant_id: string;
    sku: string;
    product_name: string;
    discrepancy_type: DiscrepancyType;
    quantity: number;
    vendor_name?: string;
    reason?: string;
    notes?: string;
    flagged_by?: string;
}

export interface ResolveDiscrepancyInput {
    action?: ResolutionAction;
    resolution_action?: ResolutionAction;
    received_quantity?: number;
    quantity_received?: number;
    resolution_note?: string;
    resolved_by?: string;
}

/** Raw `product_variants` record fields consumed here; `sku` may be absent (legacy field). */
interface ProductVariantRecord {
    id: string;
    product?: string;
    stock_level?: number;
    variant_name?: string;
    sku?: string;
}

/**
 * Mark a specific quantity of an available SKU as damaged, missing, or returned to vendor for replacement.
 * Deducts the quantity from available sellable stock and logs a stock movement.
 */
export async function markStockDiscrepancy(input: MarkDiscrepancyInput): Promise<StockDiscrepancy> {
    if (!input.quantity || input.quantity <= 0) {
        throw new Error('Quantity must be greater than zero');
    }

    // 1. Fetch variant and verify it belongs to the signed-in tenant before any
    // stock mutation — superuser clients bypass PB rules (BIZ-1).
    const accountEmail = accountScopeEmail();
    if (!accountEmail) {
        throw new Error('No tenant account resolved; refusing to flag stock.');
    }
    const variant = await pb.collection('product_variants').getOne<ProductVariantRecord>(input.variant_id);
    const owner = String((variant as { account_email?: string }).account_email || '').trim().toLowerCase();
    if (owner && owner !== accountEmail) {
        throw new Error('This variant does not belong to your store.');
    }
    const availableStock = variant.stock_level || 0;

    if (input.quantity > availableStock) {
        throw new Error(
            `Cannot flag ${input.quantity} units. Only ${availableStock} units available in current stock.`
        );
    }

    // 2. Create the discrepancy record FIRST. Deducting first meant a failed
    // create left stock gone with no quarantine record (BIZ-6).
    const derivedSku = input.sku || variant.variant_name || variant.sku || 'SKU-UNKNOWN';
    const derivedProductName = input.product_name || derivedSku;
    const record = await pb.collection('stock_discrepancies').create({
        account_email: accountEmail,
        product: input.product_id || variant.product || '',
        variant: input.variant_id,
        sku: derivedSku,
        product_name: derivedProductName,
        discrepancy_type: input.discrepancy_type,
        quantity: input.quantity,
        vendor_name: input.vendor_name || '',
        reason: input.reason || '',
        notes: input.notes || '',
        status: 'active',
        flagged_by: input.flagged_by || 'Staff',
    });

    // 3. Deduct from available sellable stock; roll the record back if the
    // decrement fails so the ledger and the stock never disagree.
    try {
        await pb.collection('product_variants').update(input.variant_id, {
            'stock_level-': input.quantity,
        });
        // PB's `-` operator is atomic but unconditional. Re-read to detect a
        // concurrent sale that consumed the units between the check above and
        // this write; undo our decrement instead of leaving negative stock
        // (BIZ-5). Adding the same quantity back preserves the other sale.
        const after = await pb.collection('product_variants').getOne<ProductVariantRecord>(input.variant_id);
        if ((after.stock_level || 0) < 0) {
            await pb
                .collection('product_variants')
                .update(input.variant_id, { 'stock_level+': input.quantity })
                .catch((restoreErr) => console.warn('Failed to restore stock after a rejected discrepancy:', restoreErr));
            throw new Error(
                `Cannot flag ${input.quantity} units: another sale used the remaining stock. Nothing was quarantined.`
            );
        }
    } catch (deductErr) {
        await pb.collection('stock_discrepancies').delete(record.id).catch(() => {});
        throw deductErr;
    }

    // 4. Log stock movement
    await pb.collection('stock_movements').create({
        account_email: accountEmail,
        variant: input.variant_id,
        movement_type: 'quarantine',
        quantity: -input.quantity,
        reference_id: record.id,
        source: 'stock_discrepancy',
        notes: `Flagged as ${input.discrepancy_type.toUpperCase()} (${input.quantity} units). Reason: ${input.reason || input.notes || 'Routine audit'}${input.vendor_name ? ` • Vendor: ${input.vendor_name}` : ''}`,
    }).catch(err => console.warn('Failed to log stock movement for discrepancy:', err));

    return record as unknown as StockDiscrepancy;
}

/**
 * Resolve a stock discrepancy. When replacement arrives from vendor, staff resolves the flag
 * and the quantity is automatically credited back to available inventory.
 *
 * Partial recovery keeps the flag active: the restored units are credited, the stored
 * `quantity` is decremented by the same amount, and only the units that are still
 * quarantined stay on the active list.
 */
export async function resolveStockDiscrepancy(
    discrepancyId: string,
    resolution: ResolveDiscrepancyInput
): Promise<StockDiscrepancy> {
    const discrepancy = await pb.collection('stock_discrepancies').getOne<StockDiscrepancy>(discrepancyId);

    const currentTenant = accountScopeEmail();
    if (currentTenant && (discrepancy as unknown as { account_email?: string }).account_email && (discrepancy as unknown as { account_email?: string }).account_email !== currentTenant) {
        throw new Error('Access denied: Unauthorized discrepancy record.');
    }

    if (discrepancy.status === 'resolved') {
        throw new Error('This discrepancy has already been resolved.');
    }

    const action = resolution.action || resolution.resolution_action || 'replacement_received';
    const rawQty = resolution.received_quantity ?? resolution.quantity_received ?? discrepancy.quantity;
    const requestedQty = Math.max(0, Math.min(Number(rawQty) || 0, discrepancy.quantity));

    // Verify relation integrity before update to avoid PocketBase 400 validation error on orphaned relations
    let validVariantId: string | null = discrepancy.variant || null;
    let validProductId: string | null = discrepancy.product || null;

    if (validVariantId) {
        try {
            await pb.collection('product_variants').getOne(validVariantId);
        } catch {
            validVariantId = null;
        }
    }
    // `product_variants` has no `sku` column; the SKU lives on the parent product,
    // so look the product up first and take its stockiest variant.
    if (!validVariantId && discrepancy.sku) {
        validVariantId = await findVariantIdByProductSku(discrepancy.sku);
    }

    if (validProductId) {
        try {
            await pb.collection('products').getOne(validProductId);
        } catch {
            validProductId = null;
        }
    }

    // Claim the flag before touching stock. A full resolve is serialized by the
    // collection update rule (status must still be "active", so the loser gets a
    // 404). A partial resolve keeps the record active, so it needs an explicit
    // claim: re-read the remaining quantity, write it, then verify the write
    // survived. A concurrent resolver that overwrote it forces a retry from the
    // value it left behind, so the same units are never credited twice (BIZ-14).
    let updated: StockDiscrepancy | null = null;
    let claimedQty = 0;
    let remainingAfter = 0;
    let fullyResolved = false;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const fresh = await pb.collection('stock_discrepancies').getOne<StockDiscrepancy>(discrepancyId);
        if (fresh.status === 'resolved') {
            throw new Error('This discrepancy has already been resolved.');
        }
        const claimQty = Math.max(0, Math.min(requestedQty, fresh.quantity));
        const remainingQty = Math.max(0, fresh.quantity - claimQty);
        const isFullyResolved = remainingQty === 0;

        const updatePayload: Record<string, any> = {
            resolved_by: resolution.resolved_by || 'Staff',
            resolution_note: resolution.resolution_note || '',
        };

        if (isFullyResolved) {
            updatePayload.status = 'resolved';
            updatePayload.resolved_at = new Date().toISOString();
            updatePayload.resolution_action = action;
        } else {
            // Partially recovered: only the restored units leave quarantine.
            updatePayload.quantity = remainingQty;
        }

        // If the stored relation points to a deleted entity, sanitize or link to recovered variant
        if (validVariantId !== discrepancy.variant) {
            updatePayload.variant = validVariantId;
        }
        if (validProductId !== discrepancy.product) {
            updatePayload.product = validProductId;
        }

        try {
            updated = (await pb.collection('stock_discrepancies').update(discrepancyId, updatePayload)) as unknown as StockDiscrepancy;
        } catch (err) {
            if ((err as { status?: number })?.status === 404) {
                throw new Error('This discrepancy has already been resolved.');
            }
            throw err;
        }

        // Verify the claim landed; otherwise retry from the fresh quantity.
        const verified = await pb.collection('stock_discrepancies').getOne<StockDiscrepancy>(discrepancyId);
        if (isFullyResolved ? verified.status === 'resolved' : verified.quantity === remainingQty) {
            claimedQty = claimQty;
            remainingAfter = remainingQty;
            fullyResolved = isFullyResolved;
            break;
        }
        updated = null;
    }

    if (!updated) {
        throw new Error('The discrepancy was modified by another request; please retry the resolution.');
    }

    const accountEmail = accountScopeEmail();

    // If replacement arrived or item repaired, restore to available inventory stock
    if (action === 'replacement_received' || action === 'repaired') {
        if (claimedQty > 0 && validVariantId) {
            try {
                await pb.collection('product_variants').update(validVariantId, {
                    'stock_level+': claimedQty,
                });
            } catch (err) {
                // The claimed flag can no longer be reverted via the API (the update
                // rule requires status = "active"), so surface the mismatch clearly.
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`Flag marked resolved but stock restore failed — adjust variant stock manually. ${detail}`);
            }

            await pb.collection('stock_movements').create({
                account_email: accountEmail,
                variant: validVariantId,
                movement_type: 'restock',
                quantity: claimedQty,
                reference_id: discrepancyId,
                source: 'replacement_arrival',
                notes: `Replacement received (${claimedQty} units) for SKU ${discrepancy.sku}. ${fullyResolved ? 'Flag resolved' : `Flag still active for ${remainingAfter} quarantined units`} by ${resolution.resolved_by || 'Staff'}. Note: ${resolution.resolution_note || 'Returned to sellable stock'}`,
            }).catch(err => console.warn('Failed to log stock movement for replacement:', err));
        } else if (claimedQty > 0 && !validVariantId) {
            console.warn(`Discrepancy ${discrepancyId} resolved, but associated SKU ${discrepancy.sku} has no matching inventory variant to restore stock to.`);
        }
    } else if (action === 'written_off') {
        if (validVariantId) {
            await pb.collection('stock_movements').create({
                account_email: accountEmail,
                variant: validVariantId,
                movement_type: 'adjustment',
                quantity: 0,
                reference_id: discrepancyId,
                source: 'discrepancy_write_off',
                notes: `Discrepancy written off permanently (${claimedQty} units of ${discrepancy.sku}${fullyResolved ? '' : `, ${remainingAfter} units still quarantined`}). Reason: ${resolution.resolution_note || 'Damaged beyond repair'}`,
            }).catch(err => console.warn('Failed to log stock movement for write off:', err));
        }
    }

    return updated;
}

/** Resolve the parent product by SKU, then return one of its variants (prefers stocked). */
async function findVariantIdByProductSku(sku: string): Promise<string | null> {
    const tenant = accountScopeEmail();
    const tenantFilter = tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
    const safeSku = sanitizeFilter(sku);
    try {
        const product = await pb
            .collection('products')
            .getFirstListItem<{ id: string }>(`sku = "${safeSku}"${tenantFilter}`);
        const variant = await pb
            .collection('product_variants')
            .getFirstListItem<{ id: string }>(`product = "${sanitizeFilter(product.id)}"${tenantFilter}`, {
                sort: '-stock_level',
            });
        return variant?.id || null;
    } catch {
        return null;
    }
}

/**
 * Fetch stock discrepancies with optional filter
 */
export async function getStockDiscrepancies(filterStatus?: DiscrepancyStatus | 'all'): Promise<StockDiscrepancy[]> {
    try {
        const tenant = accountScopeEmail();
        const clauses: string[] = [];
        if (tenant) {
            clauses.push(`account_email = "${sanitizeFilter(tenant)}"`);
        }
        if (filterStatus && filterStatus !== 'all') {
            clauses.push(`status = "${filterStatus}"`);
        }
        const filterStr = clauses.join(' && ');

        const records = await pb.collection('stock_discrepancies').getFullList({
            filter: filterStr,
            sort: '-created',
            requestKey: null,
        });

        return records as unknown as StockDiscrepancy[];
    } catch (err) {
        console.error('Failed to fetch stock discrepancies:', err);
        return [];
    }
}

/**
 * Aggregated discrepancy counts for inventory badges & quick-action drawers
 */
export async function getDiscrepancyStats(): Promise<{
    activeCount: number;
    damagedCount: number;
    missingCount: number;
    vendorReplacementCount: number;
    totalUnitsQuarantined: number;
}> {
    try {
        const tenant = accountScopeEmail();
        const filterStr = tenant
            ? `status = "active" && account_email = "${sanitizeFilter(tenant)}"`
            : 'status = "active"';
        const active = await pb.collection('stock_discrepancies').getFullList<StockDiscrepancy>({
            filter: filterStr,
            requestKey: null,
        });

        let damagedCount = 0;
        let missingCount = 0;
        let vendorReplacementCount = 0;
        let totalUnits = 0;

        for (const item of active) {
            const q = item.quantity || 0;
            totalUnits += q;
            if (item.discrepancy_type === 'damaged') damagedCount += q;
            else if (item.discrepancy_type === 'missing') missingCount += q;
            else if (item.discrepancy_type === 'vendor_replacement') vendorReplacementCount += q;
        }

        return {
            activeCount: active.length,
            damagedCount,
            missingCount,
            vendorReplacementCount,
            totalUnitsQuarantined: totalUnits,
        };
    } catch {
        return {
            activeCount: 0,
            damagedCount: 0,
            missingCount: 0,
            vendorReplacementCount: 0,
            totalUnitsQuarantined: 0,
        };
    }
}
