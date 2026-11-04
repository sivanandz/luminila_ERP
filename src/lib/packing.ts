/**
 * Packing & Dispatch Manager service layer (Packing Station 2.0).
 *
 * A packing session is one `order_packing` row per order. Scans resolve to a
 * `sales_order_items` line via the variant relation (jewelry tags carry the
 * SKU; `resolvePOSBarcodeVariant` resolves suffix/full-SKU/product barcode),
 * and each line must be scanned `quantity` times before the session can
 * complete (strict verification, cross-order guard).
 *
 * Packing Station 2.0 enhancements:
 * - Location-guided picking (`line.location`), product thumbnails (`line.image_url`),
 *   and current shelf stock (`line.stock_level`).
 * - Packaging Presets (`PACKAGING_PRESETS`) with weight and packaging material cost.
 * - Virtual Combo / Bridal Set explosion into scannable component lines.
 * - Multi-order Wave Pick List generation grouped by Tray/Location.
 * - Mid-pack damage quarantine & short-ship support with `-1` undo.
 * - Rapid 2-scan manifest dispatch support.
 */

import { pb, getCurrentTenantEmail, sanitizeFilter } from './pocketbase';
import { logActivity } from './activity';
import { resolvePOSBarcodeVariant, type ProductVariant, getProductDisplayImage } from './products';
import { parseSKUFromBarcode } from './barcode-generator';
import { getOrders, getOrderDetails } from './orders';
import type { OrderDetail, OrderDetailItem } from './orders';
import { markStockDiscrepancy } from './discrepancies';

export type PackingSessionStatus = 'in_progress' | 'completed' | 'cancelled';

/** Packaging Presets with tare weight and standard container cost */
export interface PackagingPreset {
    id: string;
    name: string;
    weightGrams: number;
    packagingCost: number;
    description: string;
}

export const PACKAGING_PRESETS: PackagingPreset[] = [
    { id: 'bubble_pouch', name: 'Bubble Mailer Pouch', weightGrams: 40, packagingCost: 8, description: 'Single rings, lightweight earrings, chains (40g)' },
    { id: 'velvet_box', name: 'Velvet Presentation Box', weightGrams: 90, packagingCost: 35, description: 'Bangles, earrings & pendant sets (90g)' },
    { id: 'rigid_bridal_box', name: 'Rigid Bridal Master Box', weightGrams: 280, packagingCost: 95, description: 'Heavy bridal sets, multi-piece necklaces (280g)' },
    { id: 'ecom_carton', name: 'Corrugated E-Com Box', weightGrams: 140, packagingCost: 22, description: 'Multi-item bulk orders & secure shipping (140g)' },
];

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

/** Quarantined or short-shipped items recorded during packing */
export interface ShortageItem {
    item_id: string;
    variant_id: string;
    product_id: string;
    sku: string;
    quantity: number;
    reason: string;
    flagged_at: string;
    status: 'quarantined' | 'short_shipped';
    spare_allocated?: boolean;
    customer_notified?: boolean;
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
    shortage_items?: ShortageItem[];
    packaging_preset?: string;
    weight_grams?: number;
    packaging_cost?: number;
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
    location?: string;
    image_url?: string | null;
    stock_level?: number;
    bundle_parent_sku?: string;
}

// ===========================================
// PURE LOGIC
// ===========================================

/**
 * sales_order_items as PocketBase returns them: the relation fields
 * stay record-id strings and the expanded records live under `expand`.
 */
interface ExpandedOrderItem extends Omit<OrderDetailItem, 'variant'> {
    variant?: ProductVariant | string;
    expand?: {
        variant?: ProductVariant;
        product?: {
            id?: string;
            sku?: string;
            name?: string;
            location?: string;
            image_url?: string;
            image_data?: string;
            is_bundle?: boolean;
            bundle_items?: Array<{
                variant_id?: string;
                product_id?: string;
                sku: string;
                name: string;
                quantity: number;
            }>;
        };
    };
}

/** Build the checklist lines from an order's items (expand product,variant + bundle explosion). */
export function buildPackingLines(items: Array<OrderDetailItem | ExpandedOrderItem> | undefined): PackingLine[] {
    const lines: PackingLine[] = [];

    for (const item of items || []) {
        const rawVariant = item.variant as ProductVariant | string | undefined;
        const expanded = (item as ExpandedOrderItem).expand;
        const variant = rawVariant && typeof rawVariant === 'object' ? rawVariant : expanded?.variant;
        const variantId = typeof rawVariant === 'string' ? rawVariant : variant?.id || '';
        const product = variant?.expand?.product || expanded?.product;
        const parentSku = String(product?.sku || '');
        const suffix = String(variant?.sku_suffix || '');

        const sku =
            suffix && parentSku && !parentSku.toUpperCase().endsWith(`-${suffix.toUpperCase()}`)
                ? `${parentSku}-${suffix}`
                : parentSku || suffix || item.description || item.id;

        const image = getProductDisplayImage({ image_data: product?.image_data, image_url: product?.image_url });
        const location = product?.location || 'Showcase Tray A';
        const stockLevel = Number(variant?.stock_level) || 0;
        const itemQuantity = item.quantity || 1;

        // Virtual Bundle explosion: if product has component bundle items, explode into individual scannable lines
        if (product?.is_bundle && Array.isArray(product.bundle_items) && product.bundle_items.length > 0) {
            for (const [compIdx, comp] of product.bundle_items.entries()) {
                const compQty = (Number(comp.quantity) || 1) * itemQuantity;
                lines.push({
                    item_id: `${item.id}_comp_${compIdx}`,
                    variant_id: ('variant_id' in comp ? (comp as any).variant_id : '') || '',
                    product_id: comp.product_id || '',
                    sku: comp.sku,
                    description: comp.name || `Component of ${sku}`,
                    quantity: compQty,
                    location,
                    image_url: image,
                    stock_level: stockLevel,
                    bundle_parent_sku: sku,
                });
            }
        } else {
            lines.push({
                item_id: item.id,
                variant_id: variantId,
                product_id: String(item.product || product?.id || ''),
                sku,
                description: item.description || product?.name || 'Item',
                quantity: itemQuantity,
                variant_size: variant?.size ? String(variant.size) : undefined,
                variant_color: variant?.color ? String(variant.color) : undefined,
                location,
                image_url: image,
                stock_level: stockLevel,
            });
        }
    }

    return lines;
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
 * strict; a product-level tag only counts when exactly one line carries that product.
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

/** Decrement (-1 undo) the packed entry for a line. Pure. */
export function decrementPackedItem(
    packedItems: PackedItemEntry[],
    line: PackingLine
): PackedItemEntry[] {
    const existingIndex = packedItems.findIndex((entry) => entry.item_id === line.item_id);
    if (existingIndex < 0) return packedItems;
    const existing = packedItems[existingIndex];
    if (existing.packed_qty <= 0) return packedItems;

    const next = [...packedItems];
    next[existingIndex] = {
        ...existing,
        packed_qty: existing.packed_qty - 1,
    };
    return next;
}

/** Every line fully scanned or short-shipped? Pure. */
export function isSessionComplete(
    lines: PackingLine[],
    packedItems: PackedItemEntry[],
    shortageItems?: ShortageItem[]
): boolean {
    if (lines.length === 0) return false;
    return lines.every((line) => {
        const packed = packedItems.find((entry) => entry.item_id === line.item_id)?.packed_qty || 0;
        const shortQty = (shortageItems || [])
            .filter((s) => s.item_id === line.item_id && s.status === 'short_shipped')
            .reduce((sum, s) => sum + s.quantity, 0);
        return (packed + shortQty) >= line.quantity;
    });
}

/** Lines still missing scans (for the strict override prompt). Pure. */
export function incompleteLines(
    lines: PackingLine[],
    packedItems: PackedItemEntry[],
    shortageItems?: ShortageItem[]
): PackingLine[] {
    return lines.filter((line) => {
        const packed = packedItems.find((entry) => entry.item_id === line.item_id)?.packed_qty || 0;
        const shortQty = (shortageItems || [])
            .filter((s) => s.item_id === line.item_id && s.status === 'short_shipped')
            .reduce((sum, s) => sum + s.quantity, 0);
        return (packed + shortQty) < line.quantity;
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

/** Multi-order Wave Pick List item */
export interface WavePickItem {
    sku: string;
    description: string;
    totalQuantity: number;
    orders: Array<{ order_number: string; quantity: number }>;
    location: string;
    image_url?: string | null;
}

export interface WavePickGroup {
    location: string;
    items: WavePickItem[];
}

/** Consolidates multiple queued orders into a unified Tray-by-Tray Wave Pick List. Pure. */
export function buildWavePickList(
    orders: QueueOrder[],
    orderLinesMap: Map<string, PackingLine[]>
): WavePickGroup[] {
    const locationMap = new Map<string, Map<string, WavePickItem>>();

    for (const order of orders) {
        const lines = orderLinesMap.get(order.id) || [];
        for (const line of lines) {
            const loc = line.location || 'Showcase Tray A';
            if (!locationMap.has(loc)) {
                locationMap.set(loc, new Map());
            }
            const itemsInLoc = locationMap.get(loc)!;
            const existing = itemsInLoc.get(line.sku);
            if (existing) {
                existing.totalQuantity += line.quantity;
                existing.orders.push({ order_number: order.order_number, quantity: line.quantity });
            } else {
                itemsInLoc.set(line.sku, {
                    sku: line.sku,
                    description: line.description,
                    totalQuantity: line.quantity,
                    orders: [{ order_number: order.order_number, quantity: line.quantity }],
                    location: loc,
                    image_url: line.image_url,
                });
            }
        }
    }

    const groups: WavePickGroup[] = [];
    for (const [location, itemMap] of locationMap.entries()) {
        groups.push({
            location,
            items: Array.from(itemMap.values()).sort((a, b) => a.sku.localeCompare(b.sku)),
        });
    }

    return groups.sort((a, b) => a.location.localeCompare(b.location));
}

// ===========================================
// IO LAYER
// ===========================================

/**
 * Tenant clause for every packing read. Fail closed: an unresolved tenant used
 * to yield '' and the query then scanned every store's sessions, including
 * customer name and phone (SET-2).
 */
function tenantFilter(): string {
    const email = getCurrentTenantEmail();
    if (!email || email === 'default') return 'id = ""';
    return `account_email = "${sanitizeFilter(email)}"`;
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
        shortage_items: Array.isArray(record.shortage_items) ? (record.shortage_items as ShortageItem[]) : [],
        packaging_preset: record.packaging_preset ? String(record.packaging_preset) : undefined,
        weight_grams: typeof record.weight_grams === 'number' ? record.weight_grams : undefined,
        packaging_cost: typeof record.packaging_cost === 'number' ? record.packaging_cost : undefined,
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
            filter,
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
    // The lookup below matches nothing without a tenant, so creating here would
    // mint an orphan session that no store owns.
    if (!accountEmail || accountEmail === 'default') {
        throw new Error('No tenant account resolved; packing sessions are unavailable.');
    }
    const filterParts = [
        `order_id = "${sanitizeFilter(order.id)}"`,
        `status = "in_progress"`,
        // Always present; the unresolved-tenant case matches nothing.
        tenantFilter(),
    ];

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

    const defaultPreset = PACKAGING_PRESETS[0];
    const created = await pb.collection('order_packing').create({
        account_email: accountEmail,
        order_id: order.id,
        order_number: order.order_number,
        customer_name: order.customer_name || '',
        customer_phone: order.customer_phone || '',
        status: 'in_progress',
        packed_items: [] as PackedItemEntry[],
        shortage_items: [] as ShortageItem[],
        packaging_preset: defaultPreset.id,
        weight_grams: defaultPreset.weightGrams,
        packaging_cost: defaultPreset.packagingCost,
        packed_by: packedBy || '',
    });
    const session = toSession(created as unknown as Record<string, unknown>);
    void logActivity('create', 'order', `Packing started for ${order.order_number} (${lines.length} lines)`, {
        entityId: order.id,
        userName: packedBy,
    });
    return session;
}

/** Persist scan progress & packaging preset on the session row. */
export async function saveSessionProgress(session: PackingSession): Promise<void> {
    const payload: Record<string, unknown> = {
        packed_items: session.packed_items,
    };
    if (session.shortage_items) payload.shortage_items = session.shortage_items;
    if (session.packaging_preset) payload.packaging_preset = session.packaging_preset;
    if (typeof session.weight_grams === 'number') payload.weight_grams = session.weight_grams;
    if (typeof session.packaging_cost === 'number') payload.packaging_cost = session.packaging_cost;

    await pb.collection('order_packing').update(session.id, payload);
}

/**
 * Most recent session for an order regardless of status.
 */
export async function getLatestSessionForOrder(orderId: string): Promise<PackingSession | null> {
    const filterParts = [`order_id = "${sanitizeFilter(orderId)}"`, tenantFilter()];
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

/** Mark the session completed. */
export async function completePackingSession(
    session: PackingSession,
    packedBy?: string
): Promise<void> {
    const payload: Record<string, unknown> = {
        status: 'completed',
        completed_at: new Date().toISOString(),
        packed_by: packedBy || session.packed_by || '',
    };
    if (session.packaging_preset) payload.packaging_preset = session.packaging_preset;
    if (typeof session.weight_grams === 'number') payload.weight_grams = session.weight_grams;
    if (typeof session.packaging_cost === 'number') payload.packaging_cost = session.packaging_cost;
    if (session.shortage_items) payload.shortage_items = session.shortage_items;

    await pb.collection('order_packing').update(session.id, payload);
    void logActivity('status_change', 'order', `Packing completed for ${session.order_number}`, {
        entityId: session.order_id,
        newValues: {
            packing_status: 'completed',
            pieces: session.packed_items.reduce((sum, entry) => sum + entry.packed_qty, 0),
            packaging_preset: session.packaging_preset,
            weight_grams: session.weight_grams,
        },
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
    const tenant = tenantFilter();
    const [orderRows, sessions, itemRows] = await Promise.all([
        getOrders('sales_order'),
        fetchPackingSessions(),
        pb
            .collection('sales_order_items')
            .getFullList({
                // Tenant-scoped: an unscoped read counted every store's lines (SET-12).
                filter: tenant,
                fields: 'order,quantity',
            })
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

/** Load detailed packing lines for any order id on demand */
export async function loadPackingLinesForOrder(orderId: string): Promise<PackingLine[]> {
    try {
        const details = await getOrderDetails(orderId);
        if (!details) return [];
        return buildPackingLines(details.items);
    } catch (err) {
        console.warn(`Could not load packing lines for order ${orderId}:`, err);
        return [];
    }
}

/**
 * Handle mid-pack damaged piece exception:
 * 1. Checks if spare unit is available on shelf (`variant.stock_level >= 1`).
 * 2. If spare exists: calls `markStockDiscrepancy` to quarantine 1 shelf unit and returns { action: 'spare_allocated' }.
 * 3. If no spare: registers shortage in `stock_discrepancies` and returns { action: 'short_ship_required' }.
 */
export async function handleMidPackDamage(
    session: PackingSession,
    line: PackingLine,
    reason: string,
    flaggedBy: string = 'Packer'
): Promise<{
    action: 'spare_allocated' | 'short_ship_required';
    availableStock: number;
    updatedSession: PackingSession;
}> {
    let availableStock = 0;
    if (line.variant_id) {
        try {
            const variant = await pb.collection('product_variants').getOne<{ stock_level?: number }>(line.variant_id);
            availableStock = variant.stock_level || 0;
        } catch {
            availableStock = 0;
        }
    }

    const hasSpare = availableStock >= 1;
    const now = new Date().toISOString();

    // If the packer had already scanned this unit before discovering the defect,
    // decrement the scanned count so the replacement unit can be scanned cleanly
    // or the shortage is accurately excluded from packed counts.
    let updatedPackedItems = session.packed_items;
    const existingEntry = session.packed_items.find((entry) => entry.item_id === line.item_id);
    if (existingEntry && existingEntry.packed_qty > 0) {
        updatedPackedItems = decrementPackedItem(session.packed_items, line);
    }

    if (hasSpare && line.variant_id) {
        // Quarantine 1 shelf spare
        await markStockDiscrepancy({
            product_id: line.product_id,
            variant_id: line.variant_id,
            sku: line.sku,
            product_name: line.description,
            discrepancy_type: 'damaged',
            quantity: 1,
            reason: `Damaged piece spotted at packing station for Order #${session.order_number}. ${reason}`.trim(),
            flagged_by: flaggedBy,
        });

        const newShortage: ShortageItem = {
            item_id: line.item_id,
            variant_id: line.variant_id,
            product_id: line.product_id,
            sku: line.sku,
            quantity: 1,
            reason,
            flagged_at: now,
            status: 'quarantined',
            spare_allocated: true,
        };

        const updatedShortages = [...(session.shortage_items || []), newShortage];
        const updatedSession = { ...session, packed_items: updatedPackedItems, shortage_items: updatedShortages };
        await saveSessionProgress(updatedSession);

        return {
            action: 'spare_allocated',
            availableStock: availableStock - 1,
            updatedSession,
        };
    }

    // Zero spares remaining: short-ship flow
    const accountEmail = getCurrentTenantEmail();
    await pb.collection('stock_discrepancies').create({
        account_email: accountEmail,
        product: line.product_id || '',
        variant: line.variant_id || '',
        sku: line.sku,
        product_name: line.description,
        discrepancy_type: 'damaged',
        quantity: 1,
        reason: `Order #${session.order_number} short-shipped: 0 spare units on shelf. ${reason}`.trim(),
        status: 'active',
        flagged_by: flaggedBy,
    }).catch((err) => console.warn('Discrepancy write warning:', err));

    const newShortage: ShortageItem = {
        item_id: line.item_id,
        variant_id: line.variant_id,
        product_id: line.product_id,
        sku: line.sku,
        quantity: 1,
        reason,
        flagged_at: now,
        status: 'short_shipped',
        spare_allocated: false,
    };

    const updatedShortages = [...(session.shortage_items || []), newShortage];
    const updatedSession = { ...session, packed_items: updatedPackedItems, shortage_items: updatedShortages };
    await saveSessionProgress(updatedSession);

    return {
        action: 'short_ship_required',
        availableStock: 0,
        updatedSession,
    };
}

/**
 * Cross-order guard: which queued orders contain this variant?
 */
export async function findOpenOrdersForVariant(
    variantId: string,
    queue: PackingQueue
): Promise<QueueOrder[]> {
    if (!variantId) return [];
    try {
        const filterParts = [`variant="${sanitizeFilter(variantId)}"`];
        // Always tenant-scoped; matches nothing when no tenant is resolved (SET-12).
        filterParts.push(tenantFilter());
        const rows = await pb.collection('sales_order_items').getFullList({
            filter: filterParts.join(' && '),
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
