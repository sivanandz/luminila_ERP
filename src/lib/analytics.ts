/**
 * Analytics Service Layer
 * Dashboard queries and aggregations for Luminila Inventory Management using PocketBase
 *
 * 2026-11-02 (Analytics Deep-Insights): all queries now
 *   - scope via accountScopeEmail() (staff logins previously saw an empty
 *     dashboard because the raw auth email was used as the tenant key),
 *   - exclude storefront mirror sales so revenue stops double-counting
 *     storefront orders (canonical rule in analytics-v2/load.ts),
 *   - honor per-variant low_stock_threshold instead of a hardcoded <10.
 * getTopProducts unions POS sale_items with sales_order_items so
 * storefront/WhatsApp lines no longer vanish from the leaderboard.
 */

import { pb, accountScopeEmail } from './pocketbase';
import { loadUnifiedLines, loadTxWindow } from './analytics-v2/load';
import { buildChannelTable } from './analytics-v2/sales-metrics';
import { resolveRange, compare, type ComparedMetric } from './analytics-v2/range';
import type {
    ProductVariant,
    PurchaseOrder,
    Sale,
    SalesOrder,
    StockMovement,
    Vendor,
} from '@/types/database';

// ===========================================
// TYPES
// ===========================================
export interface DashboardStats {
    totalRevenue: number;
    totalOrders: number;
    totalProducts: number;
    lowStockCount: number;
    todayRevenue: number;
    todayOrders: number;
    pendingOrders: number;
    revenueChange: number;
    /** 30-day gross margin ₹ (revenue − COGS from unit_cost snapshots) */
    grossMargin: number;
    /** 30-day average order value ₹ */
    aov: number;
    /** margin % vs previous 30 days, for the KPI delta */
    marginChange: ComparedMetric;
}

export interface SalesDataPoint {
    date: string;
    revenue: number;
    orders: number;
}

export interface TopProduct {
    id: string;
    name: string;
    sku: string;
    totalSold: number;
    revenue: number;
}

export interface ChannelBreakdown {
    channel: string;
    orders: number;
    revenue: number;
    percentage: number;
    // Recharts v3 types chart rows as Record<string, unknown>, which requires
    // an index signature on plain data interfaces for assignability.
    [key: string]: string | number;
}

export interface RecentActivity {
    id: string;
    type: 'sale' | 'order' | 'stock' | 'invoice';
    title: string;
    description: string;
    amount?: number;
    timestamp: string;
}

/** Sale item with its variant (and the variant's product) expanded */
export interface SaleItemWithExpand extends Record<string, unknown> {
    expand?: {
        variant?: ProductVariant;
    };
}

/** Purchase order with its vendor record expanded */
export interface PurchaseOrderWithVendor extends PurchaseOrder {
    expand?: {
        vendor?: Vendor;
    };
}

/** Stock movement with its variant (and the variant's product) expanded */
export interface StockMovementWithVariant extends StockMovement {
    expand?: {
        variant?: ProductVariant;
    };
}

// ===========================================
// DASHBOARD STATS
// ===========================================

export async function getDashboardStats(): Promise<DashboardStats> {
    const empty: DashboardStats = {
        totalRevenue: 0, totalOrders: 0, totalProducts: 0, lowStockCount: 0,
        todayRevenue: 0, todayOrders: 0, pendingOrders: 0, revenueChange: 0,
        grossMargin: 0, aov: 0,
        marginChange: { current: 0, previous: 0, deltaPct: 0 },
    };
    try {
        const tenant = accountScopeEmail();
        if (!tenant) return empty;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();

        const win = resolveRange({ preset: '30d' });

        // Canonical, deduped transactions (mirror rows excluded in load.ts)
        const txs = await loadTxWindow(tenant, win.current);
        const prevTxs = await loadTxWindow(tenant, win.previous);

        const sumRevenue = (list: typeof txs) => list.reduce((sum, t) => sum + t.revenue, 0);

        const totalRevenue = sumRevenue(txs);
        const totalOrders = txs.length;

        const todayTx = txs.filter((t) => t.dateISO >= todayISO);
        const todayRevenue = sumRevenue(todayTx);
        const todayOrdersCount = todayTx.length;

        const prevRevenue = sumRevenue(prevTxs);
        const revenueChange = prevRevenue > 0
            ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
            : 0;

        // Margin from canonical line items (unit_cost snapshots; current-cost
        // fallback inside load.ts — unknown costs count as 0-cost).
        const lines = await loadUnifiedLines(tenant, win.current);
        const cogs = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
        const grossMargin = Math.round(totalRevenue - cogs);
        const prevLines = await loadUnifiedLines(tenant, win.previous);
        const prevCogs = prevRevenue - prevLines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
        const marginChange = compare(grossMargin, Math.round(prevCogs));

        // Product count strictly scoped to tenant
        const products = await pb.collection('products').getList(1, 1, {
            filter: `account_email="${tenant}" && is_active=true`
        });
        const totalProducts = products.totalItems;

        // Low stock honors each variant's own threshold (PB can't compare two
        // columns in a filter, so count over a light tenant-scoped fetch).
        const variants = await pb.collection('product_variants').getFullList<ProductVariant>({
            filter: `account_email="${tenant}" && stock_level>0`,
            expand: 'product',
            fields: 'id,stock_level,low_stock_threshold,expand.product.is_active',
        }).catch(() => [] as ProductVariant[]);
        const lowStockCount = variants.filter((v) => {
            const product = (v as unknown as { expand?: { product?: { is_active?: boolean } } }).expand?.product;
            if (product && product.is_active === false) return false;
            return v.stock_level < (v.low_stock_threshold || 10);
        }).length;

        // Pending orders strictly scoped to tenant
        let pendingOrders = 0;
        try {
            const pending = await pb.collection('sales_orders').getList(1, 1, {
                filter: `account_email="${tenant}" && (status="draft" || status="sent" || status="confirmed" || status="shipped")`,
            });
            pendingOrders = pending.totalItems;
        } catch (e) {
            console.error('Failed to fetch pending orders:', e);
        }

        return {
            totalRevenue: Math.round(totalRevenue),
            totalOrders,
            totalProducts,
            lowStockCount,
            todayRevenue: Math.round(todayRevenue),
            todayOrders: todayOrdersCount,
            pendingOrders,
            revenueChange,
            grossMargin,
            aov: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
            marginChange,
        };
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        return empty;
    }
}

// ===========================================
// SALES TRENDS
// ===========================================

export async function getSalesTrend(days: number = 30): Promise<SalesDataPoint[]> {
    try {
        const tenant = accountScopeEmail();
        if (!tenant) return [];

        const preset = days <= 7 ? '7d' : days <= 30 ? '30d' : days <= 90 ? '90d' : '12m';
        const win = resolveRange({ preset: preset as '7d' | '30d' | '90d' | '12m' });
        const txs = await loadTxWindow(tenant, win.current);

        const byDate = new Map<string, { revenue: number; orders: number }>();
        for (const key of win.current.days) {
            byDate.set(key, { revenue: 0, orders: 0 });
        }

        for (const tx of txs) {
            const existing = byDate.get(tx.day);
            if (existing) {
                byDate.set(tx.day, {
                    revenue: existing.revenue + tx.revenue,
                    orders: existing.orders + 1,
                });
            }
        }

        return Array.from(byDate.entries()).map(([date, data]) => ({
            date,
            revenue: Math.round(data.revenue),
            orders: data.orders,
        }));
    } catch (error) {
        console.error('Error fetching sales trend:', error);
        return [];
    }
}

// ===========================================
// TOP PRODUCTS
// ===========================================

/**
 * Top products across ALL channels: canonical lines union POS sale_items with
 * sales_order_items (storefront/WhatsApp were previously invisible here).
 */
export async function getTopProducts(limit: number = 10): Promise<TopProduct[]> {
    try {
        const tenant = accountScopeEmail();
        if (!tenant) return [];

        const win = resolveRange({ preset: '30d' });
        const lines = await loadUnifiedLines(tenant, win.current);

        const byProduct = new Map<string, { name: string; sku: string; sold: number; revenue: number }>();
        for (const line of lines) {
            if (!line.productId) continue;
            const existing = byProduct.get(line.productId) || {
                name: line.productName,
                sku: line.sku,
                sold: 0,
                revenue: 0,
            };
            byProduct.set(line.productId, {
                ...existing,
                sold: existing.sold + line.quantity,
                revenue: existing.revenue + line.netRevenue,
            });
        }

        return Array.from(byProduct.entries())
            .map(([id, data]) => ({
                id,
                name: data.name,
                sku: data.sku,
                totalSold: data.sold,
                revenue: Math.round(data.revenue),
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, limit);
    } catch (error) {
        console.error('Error fetching top products:', error);
        return [];
    }
}

// ===========================================
// CHANNEL BREAKDOWN
// ===========================================

export async function getChannelBreakdown(): Promise<ChannelBreakdown[]> {
    try {
        const tenant = accountScopeEmail();
        if (!tenant) return [];

        const win = resolveRange({ preset: '30d' });
        const txs = await loadTxWindow(tenant, win.current);
        const rows = buildChannelTable(txs, []);

        return rows.map((r) => ({
            channel: r.channel,
            orders: r.orders,
            revenue: r.revenue,
            percentage: r.percentage,
        }));
    } catch (error) {
        console.error('Error fetching channel breakdown:', error);
        return [];
    }
}

// ===========================================
// RECENT ACTIVITY
// ===========================================

export async function getRecentActivity(limit: number = 10): Promise<RecentActivity[]> {
    const activities: RecentActivity[] = [];
    const tenant = accountScopeEmail();
    if (!tenant) return [];

    try {
        // Recent sales (mirror rows still appear in the activity feed — they
        // are real events, just excluded from revenue math)
        const sales = await pb.collection('sales').getList<Sale>(1, 5, {
            filter: `account_email="${tenant}"`,
            sort: '-created'
        });
        sales.items.forEach((sale) => {
            activities.push({
                id: sale.id,
                type: 'sale',
                title: sale.channel === 'pos' ? 'New Sale (POS)' : `New Sale (${sale.channel || 'Other'})`,
                description: sale.customer_name || 'Walk-in customer',
                amount: sale.total,
                timestamp: sale.created,
            });
        });

        // Recent sales orders
        try {
            const orders = await pb.collection('sales_orders').getList<SalesOrder>(1, 5, {
                filter: `account_email="${tenant}"`,
                sort: '-created'
            });
            orders.items.forEach((order) => {
                activities.push({
                    id: order.id,
                    type: 'order',
                    title: `Order ${order.order_number}`,
                    description: `${order.customer_name} (${order.status})`,
                    amount: order.total,
                    timestamp: order.created,
                });
            });
        } catch (e) {
            console.error('Failed to fetch sales_orders for recent activity:', e);
        }

        // Recent purchase orders
        try {
            const purchases = await pb.collection('purchase_orders').getList<PurchaseOrderWithVendor>(1, 5, {
                filter: `account_email="${tenant}"`,
                sort: '-created',
                expand: 'vendor',
            });
            purchases.items.forEach((po) => {
                activities.push({
                    id: po.id,
                    type: 'invoice',
                    title: `PO ${po.po_number}`,
                    description: `${po.expand?.vendor?.name || 'Vendor'} (${po.status})`,
                    amount: po.total,
                    timestamp: po.created,
                });
            });
        } catch (e) {
            console.error('Failed to fetch purchase_orders for recent activity:', e);
        }

        // Recent stock movements
        try {
            const movements = await pb.collection('stock_movements').getList<StockMovementWithVariant>(1, 5, {
                filter: `account_email="${tenant}"`,
                sort: '-created',
                expand: 'variant,variant.product',
            });
            movements.items.forEach((mov) => {
                const productName = mov.expand?.variant?.expand?.product?.name || 'Unknown';
                activities.push({
                    id: mov.id,
                    type: 'stock',
                    title: `Stock ${mov.movement_type}`,
                    description: `${productName} (${mov.quantity > 0 ? '+' : ''}${mov.quantity})`,
                    timestamp: mov.created,
                });
            });
        } catch (e) {
            console.error('Failed to fetch stock_movements for recent activity:', e);
        }
    } catch (error) {
        console.error('Error fetching recent activity:', error);
    }

    return activities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
}

// ===========================================
// SUMMARY BY PERIOD
// ===========================================

export async function getRevenueSummary(period: 'today' | 'week' | 'month' | 'year'): Promise<{
    revenue: number;
    orders: number;
    avgOrderValue: number;
}> {
    try {
        const tenant = accountScopeEmail();
        if (!tenant) return { revenue: 0, orders: 0, avgOrderValue: 0 };

        const preset = period === 'today' ? '7d' : period === 'week' ? '7d' : period === 'month' ? '30d' : '12m';
        const win = resolveRange({ preset: preset as '7d' | '30d' | '12m' });
        const txs = await loadTxWindow(tenant, win.current);

        const revenue = txs.reduce((sum, t) => sum + t.revenue, 0);
        const count = txs.length;
        const avgOrderValue = count > 0 ? Math.round(revenue / count) : 0;

        return { revenue: Math.round(revenue), orders: count, avgOrderValue };
    } catch (error) {
        console.error('Error fetching revenue summary:', error);
        return { revenue: 0, orders: 0, avgOrderValue: 0 };
    }
}
