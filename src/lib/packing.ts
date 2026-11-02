/**
 * Packing & Dispatch Manager service layer.
 *
 * A packing session is one `order_packing` row per order. Scans resolve to a
 * `sales_order_items` line via the variant relation (jewelry tags carry the
 * SKU; `resolvePOSBarcodeVariant` resolves suffix/full-SKU/product barcode),
 * and each line must be scanned `quantity` times before the session can
 * complete (strict verification, cross-order guard).
 *
 * The pure helpers (`matchResolvedToLine`, `incrementPackedItem`,
 * `derivePackingQueue`, `findOrderBySlipScan`) are deliberately IO-free so
 * `src/scripts/test-packing.ts` can exercise the packing grammar without a
 * PocketBase connection.
 */

import { pb, getCurrentTenantEmail } from './pocketbase';
import { logActivity } from './activity';
import { resolvePOSBarcodeVariant, type ProductVariant } from './products';
import { parseSKUFromBarcode } from './barcode-generator';
import { getOrders } from './orders';
import type { OrderDetail, OrderDetailItem } from './orders';

export type PackingSessionStatus = 'in_progress' | 'completed' | 'cancelled';

/** One scanned piece against one order line, as persisted in packed_items. */
export interface PackedItemEntry {
    item_id: string;
    variant_id: string;
    product_id: string;
    sku: string;
    packed_qty: number;
    quantity: number;
    scanned_at: string;
}

export interface PackingSession {
    id: string;
    account_email: string;
    order_id: string;
    order_number: string;
    customer_name?: string;
    customer_phone?: string;
    status: PackingSessionStatus;
    packed_items: PackedItemEntry[];
    packed_by?: string;
    notes?: string;
    completed_at?: string;
    created?: string;
    updated?: string;
}

/** A sales_order_items row flattened for the station checklist. */
export interface PackingLine {
    item_id: string;
    variant_id: string;
    product_id: string;
    /** Best display code: full variant SKU, else parent SKU. */
    sku: string;
    description: string;
    quantity: number;
    variant_size?: string;
    variant_color?: string;
}

// ===========================================
// PURE LOGIC
// ===========================================

/**
 * sales_order_items as PocketBase actually returns them: the relation fields
 * stay record-id strings and the expanded records live under `expand`.
 * `OrderDetailItem` types `variant` as the object, so accept both shapes.
 */
interface ExpandedOrderItem extends Omit<OrderDetailItem, 'variant'> {
    variant?: ProductVariant | string;
    expand?: {
        variant?: ProductVariant;
        product?: { id?: string; sku?: string; name?: string };
    };
}

/** Build the checklist lines from an order's items (expand product,variant). */
export function buildPackingLines(items: Array<OrderDetailItem | ExpandedOrderItem> | undefined): PackingLine[] {
    return (items || []).map((item) => {
        const rawVariant = item.variant as ProductVariant | string | undefined;
        const expanded = (item as ExpandedOrderItem).expand;
        const variant = rawVariant && typeof rawVariant === 'object' ? rawVariant : expanded?.variant;
        const variantId = typeof rawVariant === 'string' ? rawVariant : variant?.id || '';
        const product = variant?.expand?.product || expanded?.product;
        const parentSku = String(product?.sku || '');
        const suffix = String(variant?.sku_suffix || '');
        // Quick-added products carry the full child SKU on the product record,
        // so the suffix may already be part of parentSku — don't append twice.
        const sku =
            suffix && parentSku && !parentSku.toUpperCase().endsWith(`-${suffix.toUpperCase()}`)
                ? `${parentSku}-${suffix}`
                : parentSku || suffix || item.description || item.id;
        return {
            item_id: item.id,
            variant_id: variantId,
            product_id: String(item.product || product?.id || ''),
            sku,
            description: item.description || product?.name || 'Item',
            quantity: item.quantity || 1,
            variant_size: variant?.size ? String(variant.size) : undefined,
            variant_color: variant?.color ? String(variant.color) : undefined,
        };
    });
}

export type ScanMatchType =
    | 'line' // resolves to a not-yet-complete order line
    | 'already_complete' // resolves to a line whose quantity is fully packed
    | 'not_in_order' // resolves to a real catalog item that is not on this order
    | 'ambiguous' // product-level tag matching several lines (multi-variant product)
    | 'unknown'; // not in the catalog at all

export interface ScanMatchResult {
    type: ScanMatchType;
    line?: PackingLine;
}

/**
 * Match a resolved catalog identity to the order's lines. Variant match is
 * strict (channel orders always carry an explicit variant); a product-level
 * tag only counts when exactly one line carries that product.
 */
export function matchResolvedToLine(
    resolved: { productId?: string; variantId?: string },
    lines: PackingLine[],
    packedItems: PackedItemEntry[]
): ScanMatchResult {
    const packedFor = (line: PackingLine): number =>
        packedItems.find((entry) => entry.item_id === line.item_id)?.packed_qty || 0;

    if (resolved.variantId) {
        const line = lines.find((entry) => entry.variant_id === resolved.variantId);
        if (!line) return { type: 'not_in_order' };
        return packedFor(line) >= line.quantity
            ? { type: 'already_complete', line }
            : { type: 'line', line };
    }

    if (resolved.productId) {
        const candidates = lines.filter((entry) => entry.product_id === resolved.productId);
        if (candidates.length === 0) return { type: 'not_in_order' };
        if (candidates.length > 1) return { type: 'ambiguous' };
        const line = candidates[0];
        return packedFor(line) >= line.quantity
            ? { type: 'already_complete', line }
            : { type: 'line', line };
    }

    return { type: 'unknown' };
}

/** Bump (or create) the packed entry for a line. Pure; a full line is a no-op. */
export function incrementPackedItem(
    packedItems: PackedItemEntry[],
    line: PackingLine,
    now: string = new Date().toISOString()
): PackedItemEntry[] {
    const existingIndex = packedItems.findIndex((entry) => entry.item_id === line.item_id);
    if (existingIndex >= 0) {
        const existing = packedItems[existingIndex];
        if (existing.packed_qty >= line.quantity) return packedItems;
        const next = [...packedItems];
        next[existingIndex] = {
            ...existing,
            packed_qty: existing.packed_qty + 1,
            scanned_at: now,
        };
        return next;
    }
    return [
        ...packedItems,
        {
            item_id: line.item_id,
            variant_id: line.variant_id,
            product_id: line.product_id,
            sku: line.sku,
            packed_qty: 1,
            quantity: line.quantity,
            scanned_at: now,
        },
    ];
}

/** Every line fully scanned? Pure. */
export function isSessionComplete(lines: PackingLine[], packedItems: PackedItemEntry[]): boolean {
    if (lines.length === 0) return false;
    return lines.every((line) => {
        const packed = packedItems.find((entry) => entry.item_id === line.item_id);
        return (packed?.packed_qty || 0) >= line.quantity;
    });
}

/** Lines still missing scans (for the strict override prompt). */
export function incompleteLines(lines: PackingLine[], packedItems: PackedItemEntry[]): PackingLine[] {
    return lines.filter((line) => {
        const packed = packedItems.find((entry) => entry.item_id === line.item_id);
        return (packed?.packed_qty || 0) < line.quantity;
    });
}

export interface QueueOrder {
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone?: string;
    status: string;
    payment_status?: string;
    payment_method?: string;
    capture_source?: string;
    total: number;
    item_count: number;
    created?: string;
    order_date?: string;
    shipping_address?: string;
    /** true when an in_progress session exists (half-packed). */
    packing_in_progress?: boolean;
}

export interface PackingQueue {
    /** Confirmed/invoiced orders without a completed session, oldest first. */
    toPack: QueueOrder[];
    /** Packed (completed session) but not yet shipped, oldest first. */
    packedAwaitingDispatch: QueueOrder[];
}

const PACKABLE_STATUSES = new Set(['confirmed', 'invoiced']);

/** Split queued orders into to-pack vs packed-awaiting-dispatch. Pure. */
export function derivePackingQueue(
    orders: Array<{
        id: string;
        order_number?: string;
        customer_name?: string;
        customer_phone?: string | null;
        status?: string;
        payment_status?: string;
        payment_method?: string;
        total?: number;
        created?: string;
        order_date?: string;
        shipping_address?: string;
        capture_source?: string;
        item_count?: number;
    }>,
    sessions: PackingSession[]
): PackingQueue {
    const completedOrderIds = new Set(
        sessions.filter((session) => session.status === 'completed').map((session) => session.order_id)
    );
    const inProgressOrderIds = new Set(
        sessions.filter((session) => session.status === 'in_progress').map((session) => session.order_id)
    );

    const toBucket = (order: (typeof orders)[number]): QueueOrder => ({
        id: order.id,
        order_number: order.order_number || order.id,
        customer_name: order.customer_name || 'Walk-in',
        customer_phone: order.customer_phone || undefined,
        status: order.status || '',
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        capture_source: order.capture_source,
        total: order.total || 0,
        item_count: order.item_count || 0,
        created: order.created,
        order_date: order.order_date,
        shipping_address: order.shipping_address,
        packing_in_progress: inProgressOrderIds.has(order.id),
    });

    const packable = orders
        .filter((order) => PACKABLE_STATUSES.has(order.status || ''))
        .sort((a, b) => (a.order_date || a.created || '').localeCompare(b.order_date || b.created || ''));

    return {
        toPack: packable.filter((order) => !completedOrderIds.has(order.id)).map(toBucket),
        packedAwaitingDispatch: packable.filter((order) => completedOrderIds.has(order.id)).map(toBucket),
    };
}

/**
 * A scanned packing slip carries the exact order number. Match it against the
 * live queue first so an item SKU that happens to contain the digits of an
 * order number can never hijack the flow. Pure.
 */
export function findOrderBySlipScan(
    scanned: string,
    queue: PackingQueue
): QueueOrder | null {
    const normalized = (scanned || '').trim().toUpperCase();
    if (!normalized) return null;
    const all = [...queue.toPack, ...queue.packedAwaitingDispatch];
    return all.find((order) => order.order_number.trim().toUpperCase() === normalized) || null;
}

// ===========================================
// IO LAYER
// ===========================================

function tenantFilter(): string {
    const email = getCurrentTenantEmail();
    return email && email !== 'default' ? `account_email = "${email.replace(/"/g, '\\"')}"` : '';
}

function toSession(record: Record<string, unknown>): PackingSession {
    return {
        id: String(record.id),
        account_email: String(record.account_email || ''),
        order_id: String(record.order_id || ''),
        order_number: String(record.order_number || ''),
        customer_name: record.customer_name ? String(record.customer_name) : undefined,
        customer_phone: record.customer_phone ? String(record.customer_phone) : undefined,
        status: (record.status as PackingSessionStatus) || 'in_progress',
        packed_items: Array.isArray(record.packed_items) ? (record.packed_items as PackedItemEntry[]) : [],
        packed_by: record.packed_by ? String(record.packed_by) : undefined,
        notes: record.notes ? String(record.notes) : undefined,
        completed_at: record.completed_at ? String(record.completed_at) : undefined,
        created: record.created ? String(record.created) : undefined,
        updated: record.updated ? String(record.updated) : undefined,
    };
}

/** All packing sessions for this tenant (API rules + explicit tenant filter). */
export async function fetchPackingSessions(): Promise<PackingSession[]> {
    try {
        const filter = tenantFilter();
        const records = await pb.collection('order_packing').getFullList({
            filter: filter || undefined,
            sort: '-updated',
        });
        return records.map((record) => toSession(record as unknown as Record<string, unknown>));
    } catch (error) {
        console.error('Failed to fetch packing sessions:', error);
        return [];
    }
}

/**
 * Resolve a scanned code to catalog identity (product + variant ids).
 * DataMatrix/QR jewelry tags encode the SKU; hardware guns stream the same.
 */
export async function resolveScannedCode(
    code: string
): Promise<{ productId?: string; variantId?: string; label?: string } | null> {
    const normalized = parseSKUFromBarcode(code) || code.trim().toUpperCase();
    if (!normalized) return null;

    try {
        const variant = await resolvePOSBarcodeVariant(normalized);
        if (variant) {
            const expandedProduct = (variant as { expand?: { product?: { id?: string; sku?: string } } }).expand?.product;
            return {
                variantId: variant.id,
                productId: expandedProduct?.id || String(variant.product || ''),
                label: expandedProduct?.sku && variant.sku_suffix
                    ? `${expandedProduct.sku}-${variant.sku_suffix}`
                    : normalized,
            };
        }
    } catch (error) {
        console.warn('Variant resolution failed:', error);
    }
    return null;
}

/**
 * Get the tenant's in_progress session for an order, or create one seeded
 * with the order's line quantities.
 */
export async function getOrCreateSession(
    order: { id: string; order_number: string; customer_name?: string; customer_phone?: string },
    lines: PackingLine[],
    packedBy?: string
): Promise<PackingSession> {
    const accountEmail = getCurrentTenantEmail() || '';
    const filterParts = [
        `order_id = "${order.id.replace(/"/g, '\\"')}"`,
        `status = "in_progress"`,
    ];
    const tenant = tenantFilter();
    if (tenant) filterParts.push(tenant);

    try {
        const existing = await pb.collection('order_packing').getList(1, 1, {
            filter: filterParts.join(' && '),
        });
        if (existing.items.length > 0) {
            return toSession(existing.items[0] as unknown as Record<string, unknown>);
        }
    } catch (error) {
        console.warn('Session lookup failed, creating a new one:', error);
    }

    const created = await pb.collection('order_packing').create({
        account_email: accountEmail,
        order_id: order.id,
        order_number: order.order_number,
        customer_name: order.customer_name || '',
        customer_phone: order.customer_phone || '',
        status: 'in_progress',
        packed_items: [] as PackedItemEntry[],
        packed_by: packedBy || '',
    });
    const session = toSession(created as unknown as Record<string, unknown>);
    void logActivity('create', 'order', `Packing started for ${order.order_number} (${lines.length} lines)`, {
        entityId: order.id,
        userName: packedBy,
    });
    return session;
}

/** Persist scan progress on the session row. */
export async function saveSessionProgress(session: PackingSession): Promise<void> {
    await pb.collection('order_packing').update(session.id, {
        packed_items: session.packed_items,
    });
}

/**
 * Most recent session for an order regardless of status. Lets the station
 * re-open a completed checklist read-only instead of silently starting a new
 * empty session when a packed order is clicked from the queue.
 */
export async function getLatestSessionForOrder(orderId: string): Promise<PackingSession | null> {
    const filterParts = [`order_id = "${orderId.replace(/"/g, '\\"')}"`];
    const tenant = tenantFilter();
    if (tenant) filterParts.push(tenant);
    try {
        const list = await pb.collection('order_packing').getList(1, 1, {
            filter: filterParts.join(' && '),
            sort: '-created',
        });
        return list.items.length > 0
            ? toSession(list.items[0] as unknown as Record<string, unknown>)
            : null;
    } catch (error) {
        console.warn('Latest packing session lookup failed:', error);
        return null;
    }
}

/** Mark the session completed (strict gate is the caller's responsibility). */
export async function completePackingSession(session: PackingSession, packedBy?: string): Promise<void> {
    await pb.collection('order_packing').update(session.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        packed_by: packedBy || session.packed_by || '',
    });
    void logActivity('status_change', 'order', `Packing completed for ${session.order_number}`, {
        entityId: session.order_id,
        newValues: { packing_status: 'completed', pieces: session.packed_items.reduce((sum, entry) => sum + entry.packed_qty, 0) },
        userName: packedBy,
    });
}

/** Cancel a session (order was cancelled, or packing restarted). */
export async function cancelPackingSession(sessionId: string): Promise<void> {
    await pb.collection('order_packing').update(sessionId, { status: 'cancelled' });
}

/**
 * Live queue for the station: sales orders in packable statuses joined with
 * their packing sessions, item totals collapsed per order.
 */
export async function loadPackingQueue(): Promise<PackingQueue> {
    const [orderRows, sessions, itemRows] = await Promise.all([
        getOrders('sales_order'),
        fetchPackingSessions(),
        pb
            .collection('sales_order_items')
            .getFullList({ fields: 'order,quantity' })
            .catch(() => [] as Array<Record<string, unknown>>),
    ]);

    const itemCounts = new Map<string, number>();
    for (const row of itemRows as Array<Record<string, unknown>>) {
        const orderId = String(row.order || '');
        itemCounts.set(orderId, (itemCounts.get(orderId) || 0) + (Number(row.quantity) || 0));
    }

    return derivePackingQueue(
        orderRows.map((row) => {
            const record = row as Record<string, unknown>;
            return {
                id: String(record.id),
                order_number: record.order_number ? String(record.order_number) : '',
                customer_name: record.customer_name ? String(record.customer_name) : 'Walk-in',
                customer_phone: record.customer_phone ? String(record.customer_phone) : undefined,
                status: record.status ? String(record.status) : '',
                payment_status: record.payment_status ? String(record.payment_status) : undefined,
                payment_method: record.payment_method ? String(record.payment_method) : undefined,
                capture_source: record.capture_source ? String(record.capture_source) : undefined,
                total: Number(record.total) || 0,
                item_count: itemCounts.get(String(record.id)) || 0,
                created: record.created ? String(record.created) : undefined,
                order_date: record.order_date ? String(record.order_date) : undefined,
                shipping_address: record.shipping_address ? String(record.shipping_address) : undefined,
            };
        }),
        sessions
    );
}

/**
 * Cross-order guard: which queued orders contain this variant? Used to name
 * the owning order when a stray piece is scanned, and to jump to the right
 * order when a piece is scanned with no order open. Best-effort — an empty
 * result degrades to a generic message.
 */
export async function findOpenOrdersForVariant(
    variantId: string,
    queue: PackingQueue
): Promise<QueueOrder[]> {
    if (!variantId) return [];
    try {
        const rows = await pb.collection('sales_order_items').getFullList({
            filter: `variant="${variantId.replace(/"/g, '\\"')}"`,
            fields: 'order',
        });
        const orderIds = new Set(rows.map((row) => String(row.order || '')));
        return [...queue.toPack, ...queue.packedAwaitingDispatch].filter((order) => orderIds.has(order.id));
    } catch (error) {
        console.warn('Cross-order lookup failed:', error);
        return [];
    }
}

export type { OrderDetail };
