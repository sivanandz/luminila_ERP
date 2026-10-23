/**
 * Unified channel stock.
 *
 * POS, WhatsApp concierge orders and the web storefront all sell the same
 * variants, but each surface had its own stock logic. The web route decremented
 * the product's first variant and silently swallowed ledger failures, WhatsApp
 * orders never moved stock at all, and none of them checked availability before
 * accepting an order — so the last unit could be sold twice across channels.
 *
 * This service is the single implementation used by the channel order paths:
 *   1. resolve the real variant (explicit, the product's only variant, or the
 *      product-level fallback for legacy rows with no variants),
 *   2. check availability up front so callers can reject before writing,
 *   3. apply an atomic decrement (`stock_level-`) and a stock_movements ledger
 *      row per line, compensating earlier lines if a later one fails,
 *   4. restore stock and reverse the ledger entries for cancellations.
 *
 * PocketBase enforces the number field's minimum at the database level, so the
 * decrement itself is the authoritative last-unit guard; the pre-checked
 * availability is best-effort UX on top of it.
 */

import type PocketBase from 'pocketbase';

export type ChannelStockChannel = 'pos' | 'whatsapp' | 'storefront';

export interface ChannelStockLine {
    productId: string;
    /** Explicit variant; omit for single-variant or legacy product-level rows. */
    variantId?: string;
    quantity: number;
    name?: string;
}

export interface ChannelStockAccount {
    accountEmail: string;
}

export interface ChannelStockOptions extends ChannelStockAccount {
    channel: ChannelStockChannel;
    referenceId: string;
    notes?: string;
    /**
     * What to do when the atomic decrement crosses zero.
     * - "reject" (default): throw InsufficientStockError and roll the order back.
     * - "clamp": settle what is available, keep the ledger truthful and report
     *   the shortfall. Used by the paid webhook: a captured payment must fulfil.
     */
    oversell?: 'reject' | 'clamp';
}

export interface StockTarget {
    kind: 'variant' | 'product';
    id: string;
    productId: string;
    name: string;
    quantity: number;
    stockLevel: number;
}

export interface StockShortage {
    productId: string;
    variantId?: string;
    name: string;
    requested: number;
    available: number;
}

export type StockAvailability =
    | { ok: true; targets: StockTarget[] }
    | { ok: false; targets: StockTarget[]; shortages: StockShortage[] };

export interface StockRestoreResult {
    restored: number;
    alreadyRestored: boolean;
}

interface VariantRecord {
    id: string;
    product: string;
    stock_level?: number;
}

interface ProductRecord {
    id: string;
    name?: string;
    stock_level?: number;
    account_email?: string;
}

interface MovementRecord {
    id: string;
    variant: string;
    quantity: number;
    movement_type: string;
}

interface StockCollection {
    getOne<T = Record<string, unknown>>(id: string): Promise<T>;
    update<T = Record<string, unknown>>(id: string, body: Record<string, unknown>): Promise<T>;
    create<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T>;
    getFullList<T = Record<string, unknown>>(options?: Record<string, unknown>): Promise<T[]>;
    delete(id: string): Promise<void>;
}

/** Minimal structural subset of the PocketBase client this service needs. */
export interface StockDb {
    collection(name: string): StockCollection;
}

export const PB_ID_PATTERN = /^[a-z0-9]{15}$/;

export class InsufficientStockError extends Error {
    readonly code = 'INSUFFICIENT_STOCK';
    constructor(
        readonly productId: string,
        readonly requested: number,
        readonly available: number,
        name?: string
    ) {
        super(`${name || productId} has only ${available} in stock (requested ${requested})`);
        this.name = 'InsufficientStockError';
    }
}

export class VariantRequiredError extends Error {
    readonly code = 'VARIANT_REQUIRED';
    constructor(readonly productId: string, name: string, readonly variantCount: number) {
        super(`${name} has ${variantCount} variants; select one before selling it`);
        this.name = 'VariantRequiredError';
    }
}

export class VariantMismatchError extends Error {
    readonly code = 'VARIANT_MISMATCH';
    constructor(readonly productId: string, readonly variantId: string) {
        super(`Variant ${variantId} does not belong to product ${productId}`);
        this.name = 'VariantMismatchError';
    }
}

export class StockTenantMismatchError extends Error {
    readonly code = 'STOCK_TENANT_MISMATCH';
    constructor(readonly productId: string) {
        super(`Product ${productId} belongs to a different tenant`);
        this.name = 'StockTenantMismatchError';
    }
}

function assertId(id: string, label: string): void {
    if (!PB_ID_PATTERN.test(id)) {
        throw new Error(`Invalid ${label} id: ${id}`);
    }
}

function normalizeQuantity(quantity: number): number {
    const value = Math.floor(Number(quantity));
    if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Invalid stock quantity: ${quantity}`);
    }
    return value;
}

function escapeFilter(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** PocketBase rejects a decrement that would cross the field's min (0). */
export function isMinStockConstraint(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes('validation_min_number_constraint')) return true;
    const data = (error as { data?: { data?: { stock_level?: { code?: string } } } })?.data;
    return data?.data?.stock_level?.code === 'validation_min_number_constraint';
}

/**
 * Resolve each line to what will actually be decremented. Ambiguous products
 * (more than one variant, none chosen) are refused instead of guessing.
 */
export async function resolveStockTargets(
    db: StockDb,
    lines: ChannelStockLine[],
    account: ChannelStockAccount
): Promise<StockTarget[]> {
    const targets: StockTarget[] = [];

    for (const line of lines) {
        const quantity = normalizeQuantity(line.quantity);
        assertId(line.productId, 'product');

        const product = await db
            .collection('products')
            .getOne<ProductRecord>(line.productId)
            .catch(() => null);
        if (!product) throw new Error(`Product not found: ${line.productId}`);
        // An empty account email is the local desktop path (no tenant selected);
        // server-side callers always pass the resolved tenant.
        if (account.accountEmail && product.account_email && product.account_email !== account.accountEmail) {
            throw new StockTenantMismatchError(line.productId);
        }
        const name = line.name || product.name || line.productId;

        if (line.variantId) {
            assertId(line.variantId, 'variant');
            const variant = await db
                .collection('product_variants')
                .getOne<VariantRecord>(line.variantId)
                .catch(() => null);
            if (!variant || variant.product !== line.productId) {
                throw new VariantMismatchError(line.productId, line.variantId);
            }
            targets.push({
                kind: 'variant',
                id: variant.id,
                productId: product.id,
                name,
                quantity,
                stockLevel: Number(variant.stock_level ?? 0),
            });
            continue;
        }

        const variants = await db.collection('product_variants').getFullList<VariantRecord>({
            filter: `product="${escapeFilter(line.productId)}"`,
            fields: 'id,product,stock_level',
        });

        if (variants.length > 1) {
            throw new VariantRequiredError(line.productId, name, variants.length);
        }
        if (variants.length === 1) {
            targets.push({
                kind: 'variant',
                id: variants[0].id,
                productId: product.id,
                name,
                quantity,
                stockLevel: Number(variants[0].stock_level ?? 0),
            });
            continue;
        }

        // Legacy product with no variant rows: track stock on the product itself.
        targets.push({
            kind: 'product',
            id: product.id,
            productId: product.id,
            name,
            quantity,
            stockLevel: Number(product.stock_level ?? 0),
        });
    }

    return targets;
}

/** Best-effort availability check callers run before writing any order rows. */
export async function assertStockAvailable(
    db: StockDb,
    lines: ChannelStockLine[],
    account: ChannelStockAccount
): Promise<StockAvailability> {
    const targets = await resolveStockTargets(db, lines, account);
    const shortages: StockShortage[] = targets
        .filter((target) => target.stockLevel < target.quantity)
        .map((target) => ({
            productId: target.productId,
            variantId: target.kind === 'variant' ? target.id : undefined,
            name: target.name,
            requested: target.quantity,
            available: target.stockLevel,
        }));
    if (shortages.length > 0) return { ok: false, targets, shortages };
    return { ok: true, targets };
}

/**
 * Decrement stock and write the ledger for a channel order. Compensates every
 * already-applied line if a later line or ledger write fails.
 */
export async function applyChannelStock(
    db: StockDb,
    lines: ChannelStockLine[],
    options: ChannelStockOptions
): Promise<{ targets: StockTarget[]; movementIds: string[]; shortages: StockShortage[] }> {
    const targets = await resolveStockTargets(db, lines, options);
    const applied: { target: StockTarget; quantity: number }[] = [];
    const movementIds: string[] = [];
    const shortages: StockShortage[] = [];
    const oversell = options.oversell ?? 'reject';

    const rollback = async (): Promise<void> => {
        for (const movementId of movementIds) {
            if (movementId) await db.collection('stock_movements').delete(movementId).catch(() => {});
        }
        for (const entry of [...applied].reverse()) {
            const collection = entry.target.kind === 'variant' ? 'product_variants' : 'products';
            await db
                .collection(collection)
                .update(entry.target.id, { 'stock_level+': entry.quantity })
                .catch(() => {});
        }
    };

    try {
        for (const target of targets) {
            const collection = target.kind === 'variant' ? 'product_variants' : 'products';
            let quantity = target.quantity;

            try {
                await db.collection(collection).update(target.id, { 'stock_level-': quantity });
            } catch (error) {
                if (!isMinStockConstraint(error)) throw error;
                if (oversell !== 'clamp' || target.kind !== 'variant') {
                    throw new InsufficientStockError(
                        target.productId,
                        target.quantity,
                        target.stockLevel,
                        target.name
                    );
                }
                // Settle at the stock that actually exists and keep the ledger
                // truthful, exactly like the POS oversell reconciliation.
                const latest = await db
                    .collection(collection)
                    .getOne<{ stock_level?: number }>(target.id)
                    .catch(() => null);
                const available = Math.max(0, Math.floor(Number(latest?.stock_level ?? 0)));
                shortages.push({
                    productId: target.productId,
                    variantId: target.id,
                    name: target.name,
                    requested: target.quantity,
                    available,
                });
                if (available === 0) continue;
                await db.collection(collection).update(target.id, { stock_level: 0 });
                quantity = available;
            }

            applied.push({ target, quantity });

            if (target.kind === 'variant') {
                try {
                    const movement = await db.collection('stock_movements').create({
                        variant: target.id,
                        movement_type: 'sale',
                        quantity: -quantity,
                        reference_id: options.referenceId,
                        source: options.channel,
                        notes:
                            quantity < target.quantity
                                ? `${options.notes || `${options.channel} order ${options.referenceId}`} [OVERSELL: requested ${target.quantity}, only ${quantity} in stock]`
                                : options.notes || `${options.channel} order ${options.referenceId}`,
                    });
                    movementIds.push(String((movement as { id?: string }).id || ''));
                } catch (error) {
                    // The ledger is required for reconciliation: restore this line
                    // and let the outer handler compensate the others.
                    await db.collection(collection).update(target.id, { 'stock_level+': quantity }).catch(() => {});
                    applied.pop();
                    throw error;
                }
            }
        }
    } catch (error) {
        await rollback();
        throw error;
    }

    return { targets, movementIds, shortages };
}

/**
 * Put stock back for an order that is being cancelled. Idempotent: a second call
 * sees the reversal movements and does nothing.
 */
export async function restoreChannelStockForReference(
    db: StockDb,
    options: { referenceId: string; channel: ChannelStockChannel; notes?: string }
): Promise<StockRestoreResult> {
    const reference = escapeFilter(options.referenceId);
    const source = escapeFilter(options.channel);

    const movements = await db.collection('stock_movements').getFullList<MovementRecord>({
        filter: `reference_id="${reference}" && source="${source}" && movement_type="sale"`,
    });
    if (movements.length === 0) return { restored: 0, alreadyRestored: false };

    const reversals = await db.collection('stock_movements').getFullList<MovementRecord>({
        filter: `reference_id="${reference}" && source="${source}" && movement_type="return"`,
    });
    if (reversals.length > 0) return { restored: 0, alreadyRestored: true };

    let restored = 0;
    for (const movement of movements) {
        const quantity = Math.abs(Number(movement.quantity) || 0);
        if (quantity === 0) continue;
        await db
            .collection('product_variants')
            .update(movement.variant, { 'stock_level+': quantity });
        await db.collection('stock_movements').create({
            variant: movement.variant,
            movement_type: 'return',
            quantity,
            reference_id: options.referenceId,
            source: options.channel,
            notes: options.notes || `Stock restored for cancelled ${options.channel} order ${options.referenceId}`,
        });
        restored += 1;
    }

    return { restored, alreadyRestored: false };
}

/** Convenience cast so call sites can pass the PocketBase client directly. */
export function toStockDb(pb: PocketBase): StockDb {
    return pb as unknown as StockDb;
}
