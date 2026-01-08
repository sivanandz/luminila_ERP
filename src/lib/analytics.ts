/**
 * Analytics Service Layer
 * Dashboard queries and aggregations for Luminila Inventory Management using PocketBase
 */

import { pb } from './pocketbase';

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
}

export interface RecentActivity {
    id: string;
    type: 'sale' | 'order' | 'stock' | 'invoice';
    title: string;
    description: string;
    amount?: number;
    timestamp: string;
}

// ===========================================
// DASHBOARD STATS
// ===========================================

export async function getDashboardStats(): Promise<DashboardStats> {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const sixtyDaysAgoISO = sixtyDaysAgo.toISOString();

        // Fetch sales data
        const salesData = await pb.collection('sales').getFullList({
            filter: `created>="${sixtyDaysAgoISO}"`,
        });

        // Fetch sales orders
        let ordersData: any[] = [];
        try {
            ordersData = await pb.collection('sales_orders').getFullList({
                filter: `created>="${sixtyDaysAgoISO}" && (status="confirmed" || status="shipped" || status="delivered" || status="invoiced")`,
            });
        } catch (e) {
            // Collection might not exist yet
        }

        const sumRevenue = (items: any[]) => items.reduce((sum, item) => sum + (item.total || 0), 0);

        const salesLast30 = salesData.filter((s: any) => s.created >= thirtyDaysAgoISO);
        const ordersLast30 = ordersData.filter((o: any) => o.created >= thirtyDaysAgoISO);

        const salesPrev30 = salesData.filter((s: any) => s.created < thirtyDaysAgoISO && s.created >= sixtyDaysAgoISO);
        const ordersPrev30 = ordersData.filter((o: any) => o.created < thirtyDaysAgoISO && o.created >= sixtyDaysAgoISO);

        const salesToday = salesData.filter((s: any) => s.created >= todayISO);
        const ordersToday = ordersData.filter((o: any) => o.created >= todayISO);

        const totalRevenue = sumRevenue(salesLast30) + sumRevenue(ordersLast30);
        const totalOrders = salesLast30.length + ordersLast30.length;

        const todayRevenue = sumRevenue(salesToday) + sumRevenue(ordersToday);
        const todayOrdersCount = salesToday.length + ordersToday.length;

        const prevRevenue = sumRevenue(salesPrev30) + sumRevenue(ordersPrev30);
        const revenueChange = prevRevenue > 0
            ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
            : 0;

        // Product count
        const products = await pb.collection('products').getList(1, 1, { filter: 'is_active=true' });
        const totalProducts = products.totalItems;

        // Low stock count
        const lowStock = await pb.collection('product_variants').getList(1, 1, { filter: 'stock_level<10' });
        const lowStockCount = lowStock.totalItems;

        // Pending orders
        let pendingOrders = 0;
        try {
            const pending = await pb.collection('sales_orders').getList(1, 1, {
                filter: 'status="draft" || status="sent" || status="confirmed" || status="shipped"',
            });
            pendingOrders = pending.totalItems;
        } catch (e) { }

        return {
            totalRevenue,
            totalOrders,
            totalProducts,
            lowStockCount,
            todayRevenue,
            todayOrders: todayOrdersCount,
            pendingOrders,
            revenueChange,
        };
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        return {
            totalRevenue: 0, totalOrders: 0, totalProducts: 0, lowStockCount: 0,
            todayRevenue: 0, todayOrders: 0, pendingOrders: 0, revenueChange: 0,
        };
    }
}

// ===========================================
// SALES TRENDS
// ===========================================

export async function getSalesTrend(days: number = 30): Promise<SalesDataPoint[]> {
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        const startDateISO = startDate.toISOString();

        const sales = await pb.collection('sales').getFullList({
            filter: `created>="${startDateISO}"`,
        });

        let orders: any[] = [];
        try {
            orders = await pb.collection('sales_orders').getFullList({
                filter: `created>="${startDateISO}" && (status="confirmed" || status="shipped" || status="delivered" || status="invoiced")`,
            });
        } catch (e) { }

        const byDate = new Map<string, { revenue: number; orders: number }>();

        for (let i = 0; i < days; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const key = date.toISOString().split('T')[0];
            byDate.set(key, { revenue: 0, orders: 0 });
        }

        const aggregate = (items: any[]) => {
            items.forEach((item: any) => {
                const dateKey = new Date(item.created).toISOString().split('T')[0];
                const existing = byDate.get(dateKey);
                if (existing) {
                    byDate.set(dateKey, {
                        revenue: existing.revenue + (item.total || 0),
                        orders: existing.orders + 1,
                    });
                }
            });
        };

        aggregate(sales);
        aggregate(orders);

        return Array.from(byDate.entries()).map(([date, data]) => ({
            date,
            revenue: data.revenue,
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

export async function getTopProducts(limit: number = 10): Promise<TopProduct[]> {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const saleItems = await pb.collection('sale_items').getFullList({
            filter: `created>="${thirtyDaysAgo.toISOString()}"`,
            expand: 'variant,variant.product',
        });

        const byProduct = new Map<string, { name: string; sku: string; sold: number; revenue: number }>();

        saleItems.forEach((item: any) => {
            const product = item.expand?.variant?.expand?.product;
            if (!product) return;

            const itemRevenue = (item.quantity || 0) * (item.unit_price || 0);
            const existing = byProduct.get(product.id) || {
                name: product.name,
                sku: product.sku,
                sold: 0,
                revenue: 0,
            };

            byProduct.set(product.id, {
                ...existing,
                sold: existing.sold + (item.quantity || 0),
                revenue: existing.revenue + itemRevenue,
            });
        });

        return Array.from(byProduct.entries())
            .map(([id, data]) => ({
                id,
                name: data.name,
                sku: data.sku,
                totalSold: data.sold,
                revenue: data.revenue,
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
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const byChannel = new Map<string, { orders: number; revenue: number }>();

        // Sales Orders
        try {
            const salesOrders = await pb.collection('sales_orders').getFullList({
                filter: `created>="${thirtyDaysAgo.toISOString()}" && status="confirmed"`,
            });

            salesOrders.forEach((order: any) => {
                const channel = 'B2B / Online';
                const existing = byChannel.get(channel) || { orders: 0, revenue: 0 };
                byChannel.set(channel, {
                    orders: existing.orders + 1,
                    revenue: existing.revenue + (order.total || 0),
                });
            });
        } catch (e) { }

        // POS Sales
        const posData = await pb.collection('sales').getFullList({
            filter: `created>="${thirtyDaysAgo.toISOString()}"`,
        });

        posData.forEach((sale: any) => {
            const channel = sale.channel === 'pos' ? 'In-Store (POS)' : (sale.channel || 'Other');
            const existing = byChannel.get(channel) || { orders: 0, revenue: 0 };
            byChannel.set(channel, {
                orders: existing.orders + 1,
                revenue: existing.revenue + (sale.total || 0),
            });
        });

        const totalRevenue = Array.from(byChannel.values()).reduce((sum, c) => sum + c.revenue, 0);

        return Array.from(byChannel.entries())
            .map(([channel, data]) => ({
                channel,
                orders: data.orders,
                revenue: data.revenue,
                percentage: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100) : 0,
            }))
            .sort((a, b) => b.revenue - a.revenue);
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

    try {
        // Recent sales
        const sales = await pb.collection('sales').getList(1, 5, { sort: '-created' });
        sales.items.forEach((sale: any) => {
            activities.push({
                id: sale.id,
                type: 'sale',
                title: 'New Sale (POS)',
                description: sale.customer_name || 'Walk-in customer',
                amount: sale.total,
                timestamp: sale.created,
            });
        });

        // Recent sales orders
        try {
            const orders = await pb.collection('sales_orders').getList(1, 5, { sort: '-created' });
            orders.items.forEach((order: any) => {
                activities.push({
                    id: order.id,
                    type: 'order',
                    title: `Order ${order.order_number}`,
                    description: `${order.customer_name} (${order.status})`,
                    amount: order.total,
                    timestamp: order.created,
                });
            });
        } catch (e) { }

        // Recent purchase orders
        try {
            const purchases = await pb.collection('purchase_orders').getList(1, 5, {
                sort: '-created',
                expand: 'vendor',
            });
            purchases.items.forEach((po: any) => {
                activities.push({
                    id: po.id,
                    type: 'invoice',
                    title: `PO ${po.po_number}`,
                    description: `${po.expand?.vendor?.name || 'Vendor'} (${po.status})`,
                    amount: po.total,
                    timestamp: po.created,
                });
            });
        } catch (e) { }

        // Recent stock movements
        try {
            const movements = await pb.collection('stock_movements').getList(1, 5, {
                sort: '-created',
                expand: 'variant,variant.product',
            });
            movements.items.forEach((mov: any) => {
                const productName = mov.expand?.variant?.expand?.product?.name || 'Unknown';
                activities.push({
                    id: mov.id,
                    type: 'stock',
                    title: `Stock ${mov.movement_type}`,
                    description: `${productName} (${mov.quantity > 0 ? '+' : ''}${mov.quantity})`,
                    timestamp: mov.created,
                });
            });
        } catch (e) { }
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
        const now = new Date();
        let startDate: Date;

        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate = new Date(now);
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            case 'year':
                startDate = new Date(now);
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
        }

        const startDateISO = startDate.toISOString();

        const sales = await pb.collection('sales').getFullList({
            filter: `created>="${startDateISO}"`,
        });

        let orders: any[] = [];
        try {
            orders = await pb.collection('sales_orders').getFullList({
                filter: `created>="${startDateISO}" && (status="confirmed" || status="shipped" || status="delivered" || status="invoiced")`,
            });
        } catch (e) { }

        const revenue = sales.reduce((sum: number, s: any) => sum + (s.total || 0), 0) +
            orders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);

        const count = sales.length + orders.length;
        const avgOrderValue = count > 0 ? Math.round(revenue / count) : 0;

        return { revenue, orders: count, avgOrderValue };
    } catch (error) {
        console.error('Error fetching revenue summary:', error);
        return { revenue: 0, orders: 0, avgOrderValue: 0 };
    }
}
