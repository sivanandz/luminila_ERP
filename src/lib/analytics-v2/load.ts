/**
 * Unified, deduplicated transaction loader (Analytics Deep-Insights).
 *
 * REVENUE TRUTH (see docs/plans/2026-11-02-analytics-deep-insights.md §0.1):
 * A storefront order exists TWICE in the DB — once as `sales_orders` and once
 * as a mirror `sales` row (channel='storefront'). Summing both double-counts
 * revenue; unpaid Razorpay mirrors also count revenue before it exists.
 *
 * Canonical rule applied here everywhere:
 *   revenue = Σ sales.total  WHERE channel != 'storefront'   (mirror excluded)
 *           + Σ sales_orders.total WHERE status ∈ confirmed|shipped|delivered|invoiced
 * Business date = sales_orders.order_date || created.
 *
 * All queries carry an explicit account_email filter (tenant-dual-layer rule);
 * PB rules are the second layer, never the only one.
 */

import { pb } from '../pocketbase';
import { inWindow, type DateWindow } from './range';
import type { Sale, SalesOrder, Product, ProductVariant } from '@/types/database';
import type { Category } from '../categories';

export const REVENUE_ORDER_STATUSES = ['confirmed', 'shipped', 'delivered', 'invoiced'];
export const MIRROR_CHANNEL = 'storefront';

/** Minimal PB-like client shape so server routes can pass their own session client. */
export interface AnalyticsDb {
    collection: (name: string) => {
        getFullList: (opts: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
    };
}

/** Orders joined to the PB rules need the tenant email explicitly. */
export function tenantEmail(): string {
    const model = pb.authStore.model as { email?: string; account_email?: string } | null;
    return String(model?.account_email || model?.email || '').trim().toLowerCase();
}

/** Fetch categories via an explicit db (client pb by default). */
export async function loadCategoryMeta(db: AnalyticsDb): Promise<Map<string, { name: string; parentName: string }>> {
    const meta = new Map<string, { name: string; parentName: string }>();
    try {
        const cats = (await db.collection('categories').getFullList({})) as unknown as Category[];
        const byId = new Map(cats.map((c) => [c.id, c]));
        for (const c of cats) {
            const parent = c.parent ? byId.get(String(c.parent)) : undefined;
            meta.set(c.id, { name: c.name, parentName: parent?.name || '' });
        }
    } catch (e) {
        console.warn('[analytics-v2] category lookup failed; categories will show as Unclassified:', e);
    }
    return meta;
}

/** Channel label for a sales_orders row via capture_source / gateway / whatsapp marker. */
export function orderChannel(o: SalesOrder): string {
    const source = String((o as unknown as Record<string, unknown>).capture_source || '').toLowerCase();
    if (source === 'storefront') return 'Storefront';
    if (o.whatsapp_order_id) return 'WhatsApp';
    if (source === 'whatsapp') return 'WhatsApp';
    if (String((o as unknown as Record<string, unknown>).gateway || '').toLowerCase() === 'razorpay') return 'Online (Razorpay)';
    return 'B2B / Orders';
}

export function saleChannelLabel(s: Sale): string {
    if (s.channel === 'pos') return 'In-Store (POS)';
    if (s.channel === MIRROR_CHANNEL) return 'Storefront';
    const map: Record<string, string> = {
        shopify: 'Shopify',
        woocommerce: 'WooCommerce',
        whatsapp: 'WhatsApp',
        wholesale: 'Wholesale',
        exhibition: 'Exhibition',
        marketplace: 'Marketplace',
        other: 'Other',
    };
    return map[s.channel] || s.channel || 'Other';
}

/** One canonical transaction (either a POS-style sale or a sales order). */
export interface UnifiedTx {
    id: string;
    kind: 'sale' | 'order';
    /** business date key YYYY-MM-DD */
    day: string;
    /** ISO instant of the business date */
    dateISO: string;
    revenue: number;
    discount: number;
    channel: string;
    paymentMethod: string;
    customerKey: string;
    /** order-level totals (taxes incl.) */
    total: number;
}

/** Fetch the deduped transaction set for a window (tx-level only, no items). */
export async function loadTxWindow(tenant: string, win: DateWindow, db: AnalyticsDb = pb as unknown as AnalyticsDb): Promise<UnifiedTx[]> {
    if (!tenant) return [];

    const salesFilter = `account_email="${tenant}" && channel!="${MIRROR_CHANNEL}" && created>="${win.startISO}" && created<"${win.endISO}"`;
    const ordersFilter =
        `account_email="${tenant}" && (order_date>="${win.startISO}" || (order_date="" && created>="${win.startISO}"))` +
        ` && (order_date<"${win.endISO}" || (order_date="" && created<"${win.endISO}"))` +
        ` && (${REVENUE_ORDER_STATUSES.map((s) => `status="${s}"`).join(' || ')})`;

    const [salesRows, orderRows] = await Promise.all([
        db.collection('sales').getFullList({ filter: salesFilter }).catch(() => []),
        db.collection('sales_orders').getFullList({ filter: ordersFilter }).catch(() => []),
    ]);
    // AnalyticsDb deliberately exposes a minimal, untyped client shape so server
    // routes can pass their own session client; the row types are asserted here.
    const sales = salesRows as unknown as Sale[];
    const orders = orderRows as unknown as SalesOrder[];

    const txs: UnifiedTx[] = [];

    for (const s of sales) {
        if (!inWindow(s.created, win)) continue;
        txs.push({
            id: s.id,
            kind: 'sale',
            day: s.created.slice(0, 10),
            dateISO: s.created,
            revenue: Number(s.total || 0),
            discount: Number(s.discount || 0),
            channel: saleChannelLabel(s),
            paymentMethod: String(s.payment_method || ''),
            customerKey: String(s.customer_phone || s.customer_name || 'walk-in').trim().toLowerCase(),
            total: Number(s.total || 0),
        });
    }

    for (const o of orders) {
        const dateISO = o.order_date || o.created;
        if (!inWindow(dateISO, win)) continue;
        txs.push({
            id: o.id,
            kind: 'order',
            day: dateISO.slice(0, 10),
            dateISO,
            revenue: Number(o.total || 0),
            discount: Number(o.discount_total || 0),
            channel: orderChannel(o),
            paymentMethod: String(o.payment_method || ''),
            customerKey: String(o.customer_phone || o.customer_email || o.customer_name || '').trim().toLowerCase(),
            total: Number(o.total || 0),
        });
    }

    return txs;
}

/** One canonical sale line with cost + category resolved. */
export interface UnifiedLine {
    txId: string;
    kind: 'sale' | 'order';
    day: string;
    productId: string;
    variantId: string;
    productName: string;
    sku: string;
    /** category id ('' when unclassified) and display name */
    categoryId: string;
    categoryName: string;
    /** parent category name (top-level ancestor), '' when none */
    parentCategoryName: string;
    quantity: number;
    /** line gross (pre-line-discount) = qty × unit_price */
    gross: number;
    /** line-level discount from the item row */
    lineDiscount: number;
    /** qty × unit_price − lineDiscount (order-level discounts handled by callers) */
    netRevenue: number;
    /** cost snapshot; 0 means UNKNOWN (never claim margin) */
    unitCost: number;
    purityKarat: string;
    makingCharges: number;
}

interface ItemRowWithExpand extends Record<string, any> {
    sale?: string;
    order?: string;
    product?: string;
    variant?: string;
    quantity?: number;
    unit_price?: number;
    unit_cost?: number;
    discount?: number;
    discount_amount?: number;
    purity_karat?: string;
    making_charges?: number;
    created?: string;
    expand?: {
        variant?: (ProductVariant & { expand?: { product?: Product } });
        product?: Product;
    };
}

/** Chunk an `x="id" || x="id"` filter — 25 ids max keeps URLs under proxy limits. */
async function fetchByChunks(
    db: AnalyticsDb,
    collection: string,
    field: string,
    ids: string[],
    extraFilter: string,
    expand?: string
): Promise<ItemRowWithExpand[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));

    const results = await Promise.all(
        chunks.map((chunk) => {
            const filter = `${extraFilter} && (${chunk.map((id) => `${field}="${id}"`).join(' || ')})`;
            return db
                .collection(collection)
                .getFullList({ filter, expand })
                .catch(() => [] as ItemRowWithExpand[]);
        })
    );
    return results.flat();
}

/**
 * Load canonical line items for a window:
 *  - sale_items whose sale is a NON-mirror sale in the window
 *  - sales_order_items whose order is a revenue-status order in the window
 * Category names come from the categories collection (relation ids resolved
 * once); cost prefers the unit_cost snapshot, falling back to current
 * product cost (flagged by callers via `unitCost === 0` = unknown).
 */
export async function loadUnifiedLines(tenant: string, win: DateWindow, db: AnalyticsDb = pb as unknown as AnalyticsDb): Promise<UnifiedLine[]> {
    if (!tenant) return [];

    const txs = await loadTxWindow(tenant, win, db);
    const saleIds = txs.filter((t) => t.kind === 'sale').map((t) => t.id);
    const orderIds = txs.filter((t) => t.kind === 'order').map((t) => t.id);

    const txById = new Map(txs.map((t) => [t.id, t]));

    const [saleItems, orderItems] = await Promise.all([
        saleIds.length ? fetchByChunks(db, 'sale_items', 'sale', saleIds, `account_email="${tenant}"`, 'variant.product') : [],
        orderIds.length ? fetchByChunks(db, 'sales_order_items', 'order', orderIds, `account_email="${tenant}"`, 'variant.product,product') : [],
    ]);

    // category id → {name, parent name}
    const categoryMeta = await loadCategoryMeta(db);

    const lines: UnifiedLine[] = [];

    const push = (row: ItemRowWithExpand, kind: 'sale' | 'order') => {
        const txId = String(kind === 'sale' ? row.sale : row.order || '');
        const tx = txById.get(txId);
        if (!tx) return; // window guard — item of a tx outside the canonical set

        const variant = row.expand?.variant;
        const product = variant?.expand?.product || row.expand?.product;
        const productId = String(row.product || product?.id || '');
        const variantId = String(row.variant || variant?.id || '');

        const quantity = Number(row.quantity || 0);
        const unitPrice = Number(row.unit_price || 0);
        const lineDiscount = Number((kind === 'sale' ? row.discount : row.discount_amount) || 0);
        const gross = quantity * unitPrice;

        // Order-level discounts are NOT pushed into lines here; profitability
        // allocates them pro-rata explicitly where margin is computed.
        const netRevenue = gross - lineDiscount;

        // Cost: snapshot first; missing snapshot falls back to current product
        // cost so backfill-less history still shows an ESTIMATE (basis loss is
        // acceptable, silent zero is not).
        let unitCost = Number(row.unit_cost || 0);
        if (!unitCost && product) {
            const p = product as unknown as Record<string, unknown>;
            unitCost = Number(p.cost_price || 0);
        }

        const catId = String((product as unknown as Record<string, unknown>)?.category || '');
        const meta = categoryMeta.get(catId);

        lines.push({
            txId,
            kind,
            day: tx.day,
            productId,
            variantId,
            productName: product?.name || 'Unknown',
            sku: String((product as unknown as Record<string, unknown>)?.sku || ''),
            categoryId: catId,
            categoryName: meta?.name || 'Unclassified',
            parentCategoryName: meta?.parentName || '',
            quantity,
            gross,
            lineDiscount,
            netRevenue,
            unitCost,
            purityKarat: String(row.purity_karat || ''),
            makingCharges: Number(row.making_charges || 0),
        });
    };

    saleItems.forEach((row) => push(row, 'sale'));
    orderItems.forEach((row) => push(row, 'order'));

    return lines;
}
