/**
 * Analytics Service Layer
 * Dashboard queries and aggregations for Luminila Inventory Management
 */

import { supabase } from './supabase';

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
    revenueChange: number; // Percentage change vs last period
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // Last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    // Previous 30 days (for comparison)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyDaysAgoISO = sixtyDaysAgo.toISOString();

    // Total revenue & orders (last 30 days)
    const { data: salesData } = await supabase
        .from('sales')
        .select('total, created_at')
        .gte('created_at', thirtyDaysAgoISO);

    const totalRevenue = salesData?.reduce((sum: number, s: any) => sum + (s.total || 0), 0) || 0;
    const totalOrders = salesData?.length || 0;

    // Today's stats
    const { data: todayData } = await supabase
        .from('sales')
        .select('total')
        .gte('created_at', todayISO);

    const todayRevenue = todayData?.reduce((sum: number, s: any) => sum + (s.total || 0), 0) || 0;
    const todayOrders = todayData?.length || 0;

    // Previous period revenue
    const { data: prevData } = await supabase
        .from('sales')
        .select('total')
        .gte('created_at', sixtyDaysAgoISO)
        .lt('created_at', thirtyDaysAgoISO);

    const prevRevenue = prevData?.reduce((sum: number, s: any) => sum + (s.total || 0), 0) || 0;
    const revenueChange = prevRevenue > 0
        ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
        : 0;

    // Product counts
    const { count: totalProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true });

    // Low stock count
    const { count: lowStockCount } = await supabase
        .from('product_variants')
        .select('*', { count: 'exact', head: true })
        .lt('stock_level', 10);

    // Pending orders from orders table
    const { count: pendingOrders } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'processing']);

    return {
        totalRevenue,
        totalOrders,
        totalProducts: totalProducts || 0,
        lowStockCount: lowStockCount || 0,
        todayRevenue,
        todayOrders,
        pendingOrders: pendingOrders || 0,
        revenueChange,
    };
}

// ===========================================
// SALES TRENDS
// ===========================================

export async function getSalesTrend(days: number = 30): Promise<SalesDataPoint[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { data: sales } = await supabase
        .from('sales')
        .select('total, created_at')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

    // Group by date
    const byDate = new Map<string, { revenue: number; orders: number }>();

    // Initialize all dates
    for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const key = date.toISOString().split('T')[0];
        byDate.set(key, { revenue: 0, orders: 0 });
    }

    // Aggregate sales
    sales?.forEach((sale: any) => {
        const dateKey = new Date(sale.created_at).toISOString().split('T')[0];
        const existing = byDate.get(dateKey) || { revenue: 0, orders: 0 };
        byDate.set(dateKey, {
            revenue: existing.revenue + (sale.total || 0),
            orders: existing.orders + 1,
        });
    });

    return Array.from(byDate.entries()).map(([date, data]) => ({
        date,
        revenue: data.revenue,
        orders: data.orders,
    }));
}

// ===========================================
// TOP PRODUCTS
// ===========================================

export async function getTopProducts(limit: number = 10): Promise<TopProduct[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await supabase
        .from('sale_items')
        .select(`
            quantity,
            total_price,
            variant:product_variants(
                id,
                product:products(id, name, sku)
            )
        `)
        .gte('created_at', thirtyDaysAgo.toISOString());

    // Aggregate by product
    const byProduct = new Map<string, { name: string; sku: string; sold: number; revenue: number }>();

    data?.forEach((item: any) => {
        const product = item.variant?.product;
        if (!product) return;

        const existing = byProduct.get(product.id) || {
            name: product.name,
            sku: product.sku,
            sold: 0,
            revenue: 0,
        };

        byProduct.set(product.id, {
            ...existing,
            sold: existing.sold + (item.quantity || 0),
            revenue: existing.revenue + (item.total_price || 0),
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
}

// ===========================================
// CHANNEL BREAKDOWN
// ===========================================

export async function getChannelBreakdown(): Promise<ChannelBreakdown[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await supabase
        .from('orders')
        .select('channel, total')
        .gte('created_at', thirtyDaysAgo.toISOString());

    // Group by channel
    const byChannel = new Map<string, { orders: number; revenue: number }>();

    data?.forEach((order: any) => {
        const channel = order.channel || 'Unknown';
        const existing = byChannel.get(channel) || { orders: 0, revenue: 0 };
        byChannel.set(channel, {
            orders: existing.orders + 1,
            revenue: existing.revenue + (order.total || 0),
        });
    });

    // Add POS sales
    const { data: posData } = await supabase
        .from('sales')
        .select('total')
        .gte('created_at', thirtyDaysAgo.toISOString());

    if (posData && posData.length > 0) {
        const posRevenue = posData.reduce((sum: number, s: any) => sum + (s.total || 0), 0);
        byChannel.set('POS', {
            orders: posData.length,
            revenue: posRevenue,
        });
    }

    const totalRevenue = Array.from(byChannel.values()).reduce((sum, c) => sum + c.revenue, 0);

    return Array.from(byChannel.entries())
        .map(([channel, data]) => ({
            channel,
            orders: data.orders,
            revenue: data.revenue,
            percentage: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100) : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);
}

// ===========================================
// RECENT ACTIVITY
// ===========================================

export async function getRecentActivity(limit: number = 10): Promise<RecentActivity[]> {
    const activities: RecentActivity[] = [];

    // Recent sales
    const { data: sales } = await supabase
        .from('sales')
        .select('id, total, customer_name, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    sales?.forEach((sale: any) => {
        activities.push({
            id: sale.id,
            type: 'sale',
            title: 'New Sale',
            description: sale.customer_name || 'Walk-in customer',
            amount: sale.total,
            timestamp: sale.created_at,
        });
    });

    // Recent orders
    const { data: orders } = await supabase
        .from('orders')
        .select('id, total, customer_name, channel, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    orders?.forEach((order: any) => {
        activities.push({
            id: order.id,
            type: 'order',
            title: `${order.channel || 'New'} Order`,
            description: order.customer_name || 'Customer',
            amount: order.total,
            timestamp: order.created_at,
        });
    });

    // Recent stock movements
    const { data: movements } = await supabase
        .from('stock_movements')
        .select(`
            id, 
            quantity, 
            movement_type, 
            created_at,
            variant:product_variants(
                variant_name,
                product:products(name)
            )
        `)
        .order('created_at', { ascending: false })
        .limit(5);

    movements?.forEach((mov: any) => {
        const productName = mov.variant?.product?.name || 'Unknown';
        activities.push({
            id: mov.id,
            type: 'stock',
            title: `Stock ${mov.movement_type}`,
            description: `${productName} (${mov.quantity > 0 ? '+' : ''}${mov.quantity})`,
            timestamp: mov.created_at,
        });
    });

    // Sort by timestamp and limit
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

    const { data } = await supabase
        .from('sales')
        .select('total')
        .gte('created_at', startDate.toISOString());

    const revenue = data?.reduce((sum: number, s: any) => sum + (s.total || 0), 0) || 0;
    const orders = data?.length || 0;
    const avgOrderValue = orders > 0 ? Math.round(revenue / orders) : 0;

    return { revenue, orders, avgOrderValue };
}
