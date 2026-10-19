/**
 * Stock Discrepancies & Quarantine Management
 * Tracks items that are Damaged, Missing, or Returned to Vendor for Replacement.
 * Supports disabling the flag when replacements arrive to restore sellable inventory.
 */

import { pb } from './pocketbase';

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

    // 1. Fetch variant to verify available stock
    const variant = await pb.collection('product_variants').getOne<ProductVariantRecord>(input.variant_id);
    const availableStock = variant.stock_level || 0;

    if (input.quantity > availableStock) {
        throw new Error(
            `Cannot flag ${input.quantity} units. Only ${availableStock} units available in current stock.`
        );
    }

    // 2. Deduct from available sellable stock
    await pb.collection('product_variants').update(input.variant_id, {
        'stock_level-': input.quantity,
    });

    // 3. Create discrepancy record
    const accountEmail = (pb.authStore.model as any)?.email || '';
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
 */
export async function resolveStockDiscrepancy(
    discrepancyId: string,
    resolution: ResolveDiscrepancyInput
): Promise<StockDiscrepancy> {
    const discrepancy = await pb.collection('stock_discrepancies').getOne(discrepancyId);

    if (discrepancy.status === 'resolved') {
        throw new Error('This discrepancy has already been resolved.');
    }

    const action = resolution.action || resolution.resolution_action || 'replacement_received';
    const rawQty = resolution.received_quantity ?? resolution.quantity_received ?? discrepancy.quantity;
    const qtyToRestore = Math.min(rawQty, discrepancy.quantity);

    // Verify relation integrity before update to avoid PocketBase 400 validation error on orphaned relations
    let validVariantId: string | null = discrepancy.variant || null;
    let validProductId: string | null = discrepancy.product || null;

    if (validVariantId) {
        try {
            await pb.collection('product_variants').getOne(validVariantId);
        } catch {
            validVariantId = null;
            // Attempt to find current active variant by SKU if original record was deleted/reseeded
            if (discrepancy.sku) {
                try {
                    const matched = await pb.collection('product_variants').getFirstListItem(`sku = "${discrepancy.sku}"`);
                    if (matched) {
                        validVariantId = matched.id;
                    }
                } catch {
                    // No matching variant found
                }
            }
        }
    }

    if (validProductId) {
        try {
            await pb.collection('products').getOne(validProductId);
        } catch {
            validProductId = null;
        }
    }

    // Claim the flag before touching stock: the collection update rule only allows
    // updates while status is still "active", so of two concurrent resolves exactly
    // one wins and the loser fails here (404) instead of crediting stock twice.
    let updated: StockDiscrepancy;
    try {
        const updatePayload: Record<string, any> = {
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            resolved_by: resolution.resolved_by || 'Staff',
            resolution_action: action,
            resolution_note: resolution.resolution_note || '',
        };

        // If the stored relation points to a deleted entity, sanitize or link to recovered variant
        if (validVariantId !== discrepancy.variant) {
            updatePayload.variant = validVariantId;
        }
        if (validProductId !== discrepancy.product) {
            updatePayload.product = validProductId;
        }

        updated = (await pb.collection('stock_discrepancies').update(discrepancyId, updatePayload)) as unknown as StockDiscrepancy;
    } catch (err) {
        if ((err as { status?: number })?.status === 404) {
            throw new Error('This discrepancy has already been resolved.');
        }
        throw err;
    }

    const accountEmail = (pb.authStore.model as any)?.email || '';

    // If replacement arrived or item repaired, restore to available inventory stock
    if (action === 'replacement_received' || action === 'repaired') {
        if (qtyToRestore > 0 && validVariantId) {
            try {
                await pb.collection('product_variants').update(validVariantId, {
                    'stock_level+': qtyToRestore,
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
                quantity: qtyToRestore,
                reference_id: discrepancyId,
                source: 'replacement_arrival',
                notes: `Replacement received (${qtyToRestore} units) for SKU ${discrepancy.sku}. Flag resolved by ${resolution.resolved_by || 'Staff'}. Note: ${resolution.resolution_note || 'Returned to sellable stock'}`,
            }).catch(err => console.warn('Failed to log stock movement for replacement:', err));
        } else if (qtyToRestore > 0 && !validVariantId) {
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
                notes: `Discrepancy written off permanently (${discrepancy.quantity} units of ${discrepancy.sku}). Reason: ${resolution.resolution_note || 'Damaged beyond repair'}`,
            }).catch(err => console.warn('Failed to log stock movement for write off:', err));
        }
    }

    return updated;
}

/**
 * Fetch stock discrepancies with optional filter
 */
export async function getStockDiscrepancies(filterStatus?: DiscrepancyStatus | 'all'): Promise<StockDiscrepancy[]> {
    try {
        let filterStr = '';
        if (filterStatus && filterStatus !== 'all') {
            filterStr = `status="${filterStatus}"`;
        }

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
        const active = await pb.collection('stock_discrepancies').getFullList<StockDiscrepancy>({
            filter: 'status="active"',
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
