/**
 * Read-only ERP tools.
 *
 * Every handler is tenant-scoped from the bound context and returns compact,
 * model-friendly JSON. These tools are safe to expose to the analyst profile.
 */

import { z } from 'zod';
import type { AiTool } from './registry';
import {
    accountFilter,
    asNumber,
    asText,
    containsClause,
    dayKey,
    escapeFilterValue,
    idOrClause,
    listRecords,
    rollingWindow,
    findFirstRecord,
    findRecordById,
} from './pb-util';
import type { RecordModel } from 'pocketbase';

const DAYS = z.number().int().min(1).max(365);
const LIMIT = z.number().int().min(1).max(25);

const overviewInput = z.object({
    days: DAYS.optional().describe('Rolling window in days for the revenue summary. Default 7.').default(7),
});

const searchProductsInput = z.object({
    query: z.string().trim().max(120).optional().describe('Product name or SKU fragment.'),
    category: z.string().trim().max(80).optional().describe('Exact category name.'),
    inStockOnly: z.boolean().optional().describe('Only include products with at least one unit in stock.'),
    limit: LIMIT.optional().default(10),
});

const lowStockInput = z.object({
    threshold: z.number().int().min(1).max(100).optional().describe('Stock-level ceiling. Default 5.').default(5),
    limit: LIMIT.optional().default(15),
});

const searchCustomersInput = z.object({
    query: z.string().trim().min(1).max(120).describe('Customer name, phone or email fragment.'),
    limit: LIMIT.optional().default(10),
});

const listOrdersInput = z.object({
    status: z
        .enum(['draft', 'sent', 'confirmed', 'shipped', 'delivered', 'cancelled', 'invoiced'])
        .optional()
        .describe('Filter by order status.'),
    days: DAYS.optional().describe('Only orders created in the last N days. Default 30.').default(30),
    limit: LIMIT.optional().default(10),
});

const getOrderInput = z.object({
    orderNumber: z.string().trim().min(1).max(60).describe('The sales order number, e.g. SO-2026-0007.'),
});

const listInvoicesInput = z.object({
    status: z
        .enum(['paid', 'pending', 'overdue', 'partially_paid', 'cancelled'])
        .optional()
        .describe('Filter by invoice status.'),
    days: DAYS.optional().describe('Only invoices dated in the last N days. Default 30.').default(30),
    limit: LIMIT.optional().default(10),
});

const salesReportInput = z.object({
    days: DAYS.optional().describe('Rolling window in days. Default 7.').default(7),
    groupBy: z.enum(['day', 'channel']).optional().describe('How to group the breakdown. Default channel.').default('channel'),
});

const expensesInput = z.object({
    days: DAYS.optional().describe('Rolling window in days. Default 30.').default(30),
});

interface SalesRow {
    id: string;
    total: number;
    channel: string;
    created: string;
    status: string;
}

function asSalesRows(records: RecordModel[]): SalesRow[] {
    return records.map((record) => {
        const row = record as Record<string, unknown>;
        return {
            id: asText(row.id),
            total: asNumber(row.total),
            channel: asText(row.channel) || 'other',
            created: asText(row.created) || asText(row.order_date),
            status: asText(row.status) || 'pending',
        };
    });
}

function currencySummary(storeCurrency: string): string {
    return storeCurrency || 'INR';
}

export const readTools: AiTool[] = [
    {
        name: 'get_store_overview',
        title: 'Store overview',
        description:
            'Snapshot of revenue, sales count, average order value, pending sales orders, low-stock variants and unpaid invoices for the last N days.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'reports', action: 'read' },
        input: overviewInput,
        execute: async (context, rawArgs) => {
            const args = overviewInput.parse(rawArgs);
            const window = rollingWindow(args.days, context.now);
            const tenant = accountFilter(context.accountEmail);

            const [sales, orders, variants, invoices] = await Promise.all([
                listRecords(context.client, 'sales', {
                    filter: `${tenant} && created >= "${window.fromIso}"`,
                    fields: 'id,total,channel,created,status',
                    perPage: 500,
                }),
                listRecords(context.client, 'sales_orders', {
                    filter: `${tenant} && status != "delivered" && status != "cancelled" && status != "invoiced"`,
                    fields: 'id,status,total',
                    perPage: 500,
                }).catch(() => []),
                listRecords(context.client, 'product_variants', {
                    filter: tenant,
                    fields: 'id,stock_level,low_stock_threshold',
                    perPage: 500,
                }).catch(() => []),
                listRecords(context.client, 'invoices', {
                    filter: `${tenant} && (status = "pending" || status = "partially_paid" || status = "overdue")`,
                    fields: 'id,grand_total,total,paid_amount,status',
                    perPage: 500,
                }).catch(() => []),
            ]);

            const rows = asSalesRows(sales).filter((row) => row.status !== 'cancelled');
            const revenue = rows.reduce((sum, row) => sum + row.total, 0);
            const todayKey = window.toDate;
            const revenueToday = rows.filter((row) => dayKey(row.created) === todayKey).reduce((sum, row) => sum + row.total, 0);
            const lowStock = variants.filter((variant) => {
                const record = variant as Record<string, unknown>;
                const stock = asNumber(record.stock_level);
                const threshold = asNumber(record.low_stock_threshold) || 5;
                return stock <= threshold;
            }).length;
            const outstanding = invoices.reduce((sum, invoice) => {
                const record = invoice as Record<string, unknown>;
                const total = asNumber(record.grand_total) || asNumber(record.total);
                return sum + Math.max(0, total - asNumber(record.paid_amount));
            }, 0);

            const data = {
                windowDays: args.days,
                currency: currencySummary(''),
                revenue: Math.round(revenue * 100) / 100,
                revenueToday: Math.round(revenueToday * 100) / 100,
                salesCount: rows.length,
                averageOrderValue: rows.length > 0 ? Math.round((revenue / rows.length) * 100) / 100 : 0,
                pendingSalesOrders: orders.length,
                lowStockVariantCount: lowStock,
                unpaidInvoiceCount: invoices.length,
                outstandingReceivable: Math.round(outstanding * 100) / 100,
            };
            const summary =
                `Last ${args.days} days: ${data.salesCount} sales, revenue ${data.revenue} ${data.currency}` +
                ` (today ${data.revenueToday}). Pending orders ${data.pendingSalesOrders}, low-stock variants ${data.lowStockVariantCount},` +
                ` unpaid invoices ${data.unpaidInvoiceCount} worth ${data.outstandingReceivable}.`;
            return { summary, data };
        },
    },
    {
        name: 'search_products',
        title: 'Search products',
        description: 'Find active products by name/SKU/category and report their price and stock across variants.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'products', action: 'read' },
        input: searchProductsInput,
        execute: async (context, rawArgs) => {
            const args = searchProductsInput.parse(rawArgs);
            const clauses: string[] = [accountFilter(context.accountEmail), 'is_active = true'];
            if (args.query) {
                clauses.push(`(${containsClause('name', args.query)} || ${containsClause('sku', args.query)})`);
            }
            if (args.category) clauses.push(`category = "${escapeFilterValue(args.category)}"`);
            const products = await listRecords(context.client, 'products', {
                filter: clauses.join(' && '),
                sort: 'name',
                perPage: args.limit,
                fields: 'id,name,sku,category,base_price,is_active',
            });
            if (products.length === 0) {
                return { summary: 'No active products matched.', data: { products: [] } };
            }
            const productIds = products.map((product) => asText((product as Record<string, unknown>).id));
            const idClause = idOrClause(productIds);
            const variants = await listRecords(context.client, 'product_variants', {
                filter: `${accountFilter(context.accountEmail)} && (${idClause})`,
                fields: 'id,product,stock_level,price_adjustment,variant_name,size,color',
                perPage: 300,
            }).catch(() => []);

            const rows = products.map((product) => {
                const record = product as Record<string, unknown>;
                const id = asText(record.id);
                const productVariants = variants.filter(
                    (variant) => asText((variant as Record<string, unknown>).product) === id
                );
                const stock = productVariants.reduce(
                    (sum, variant) => sum + asNumber((variant as Record<string, unknown>).stock_level),
                    0
                );
                const basePrice = asNumber(record.base_price);
                return {
                    id,
                    name: asText(record.name),
                    sku: asText(record.sku),
                    category: asText(record.category),
                    basePrice,
                    totalStock: stock,
                    variantCount: productVariants.length,
                    inStock: stock > 0,
                    variants: productVariants.slice(0, 5).map((variant) => {
                        const value = variant as Record<string, unknown>;
                        return {
                            name: asText(value.variant_name),
                            size: asText(value.size),
                            color: asText(value.color),
                            stock: asNumber(value.stock_level),
                            priceAdjustment: asNumber(value.price_adjustment),
                        };
                    }),
                };
            });
            const filtered = args.inStockOnly ? rows.filter((row) => row.inStock) : rows;
            const summary = filtered.length === 0
                ? 'No products matched those filters.'
                : filtered
                      .slice(0, 5)
                      .map((row) => `${row.name} (${row.sku}): ${row.totalStock} in stock`)
                      .join('; ');
            return { summary, data: { count: filtered.length, products: filtered } };
        },
    },
    {
        name: 'get_low_stock',
        title: 'Low-stock variants',
        description: 'List product variants at or below a stock threshold, with their parent product name and SKU.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'inventory', action: 'read' },
        input: lowStockInput,
        execute: async (context, rawArgs) => {
            const args = lowStockInput.parse(rawArgs);
            const variants = await listRecords(context.client, 'product_variants', {
                filter: `${accountFilter(context.accountEmail)} && stock_level <= ${args.threshold}`,
                sort: 'stock_level',
                perPage: args.limit,
                expand: 'product',
                fields: 'id,product,stock_level,low_stock_threshold,variant_name,size,color,expand',
            });
            const items = variants.map((variant) => {
                const record = variant as Record<string, unknown>;
                const product = ((record.expand as Record<string, unknown> | undefined)?.product ?? {}) as Record<string, unknown>;
                return {
                    variantId: asText(record.id),
                    product: asText(product.name),
                    sku: asText(product.sku),
                    variant: asText(record.variant_name),
                    size: asText(record.size),
                    color: asText(record.color),
                    stock: asNumber(record.stock_level),
                    reorderAt: asNumber(record.low_stock_threshold) || 5,
                };
            });
            const summary = items.length === 0
                ? `No variants at or below ${args.threshold} units.`
                : items.slice(0, 8).map((item) => `${item.product || item.sku} ${item.variant}: ${item.stock} left`).join('; ');
            return { summary, data: { threshold: args.threshold, count: items.length, variants: items } };
        },
    },
    {
        name: 'search_customers',
        title: 'Search customers',
        description: 'Find customers by name, phone or email and return tier, loyalty points, lifetime value and order count.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'customers', action: 'read' },
        input: searchCustomersInput,
        execute: async (context, rawArgs) => {
            const args = searchCustomersInput.parse(rawArgs);
            const customers = await listRecords(context.client, 'customers', {
                filter: `${accountFilter(context.accountEmail)} && (${containsClause('name', args.query)} || ${containsClause('phone', args.query)} || ${containsClause('email', args.query)})`,
                sort: '-total_spent',
                perPage: args.limit,
                fields: 'id,name,phone,email,city,customer_type,tier,loyalty_points,total_spent,total_orders,last_purchase_date',
            });
            const items = customers.map((customer) => {
                const record = customer as Record<string, unknown>;
                return {
                    id: asText(record.id),
                    name: asText(record.name),
                    phone: asText(record.phone),
                    email: asText(record.email),
                    city: asText(record.city),
                    customerType: asText(record.customer_type),
                    tier: asText(record.tier),
                    loyaltyPoints: asNumber(record.loyalty_points),
                    totalSpent: asNumber(record.total_spent),
                    totalOrders: asNumber(record.total_orders),
                    lastPurchaseDate: asText(record.last_purchase_date),
                };
            });
            const summary = items.length === 0
                ? 'No customers matched.'
                : items.slice(0, 5).map((item) => `${item.name || item.phone} (${item.totalOrders} orders, ${item.totalSpent} spent)`).join('; ');
            return { summary, data: { count: items.length, customers: items } };
        },
    },
    {
        name: 'list_orders',
        title: 'List sales orders',
        description: 'List sales orders in a date window, optionally filtered by status.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'sales', action: 'read' },
        input: listOrdersInput,
        execute: async (context, rawArgs) => {
            const args = listOrdersInput.parse(rawArgs);
            const window = rollingWindow(args.days, context.now);
            const clauses = [accountFilter(context.accountEmail), `created >= "${window.fromIso}"`];
            if (args.status) clauses.push(`status = "${args.status}"`);
            const orders = await listRecords(context.client, 'sales_orders', {
                filter: clauses.join(' && '),
                sort: '-created',
                perPage: args.limit,
                fields: 'id,order_number,order_type,customer_name,customer_phone,status,total,payment_status,order_date,created',
            });
            const items = orders.map((order) => {
                const record = order as Record<string, unknown>;
                return {
                    id: asText(record.id),
                    orderNumber: asText(record.order_number),
                    type: asText(record.order_type),
                    customer: asText(record.customer_name) || asText(record.customer_phone),
                    status: asText(record.status),
                    total: asNumber(record.total),
                    paymentStatus: asText(record.payment_status),
                    orderDate: asText(record.order_date) || asText(record.created),
                };
            });
            const summary = items.length === 0
                ? 'No sales orders matched.'
                : items.slice(0, 5).map((item) => `${item.orderNumber} ${item.customer} ${item.status} ${item.total}`).join('; ');
            return { summary, data: { count: items.length, windowDays: args.days, orders: items } };
        },
    },
    {
        name: 'get_order',
        title: 'Get sales order',
        description: 'Fetch one sales order by order number, including its line items.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'sales', action: 'read' },
        input: getOrderInput,
        execute: async (context, rawArgs) => {
            const args = getOrderInput.parse(rawArgs);
            const order = await findFirstRecord(
                context.client,
                'sales_orders',
                `order_number = "${escapeFilterValue(args.orderNumber)}"`,
                context.accountEmail
            );
            if (!order) {
                return { summary: `No sales order found with number ${args.orderNumber}.`, data: { found: false } };
            }
            const record = order as Record<string, unknown>;
            const orderId = asText(record.id);
            const items = await listRecords(context.client, 'sales_order_items', {
                filter: `${accountFilter(context.accountEmail)} && order = "${escapeFilterValue(orderId)}"`,
                perPage: 100,
                fields: 'id,description,quantity,unit_price,tax_rate,total',
            }).catch(() => []);
            const data = {
                found: true,
                order: {
                    id: orderId,
                    orderNumber: asText(record.order_number),
                    type: asText(record.order_type),
                    customer: asText(record.customer_name),
                    phone: asText(record.customer_phone),
                    status: asText(record.status),
                    paymentStatus: asText(record.payment_status),
                    total: asNumber(record.total),
                    subtotal: asNumber(record.subtotal),
                    taxTotal: asNumber(record.tax_total),
                    orderDate: asText(record.order_date),
                    expectedDelivery: asText(record.expected_delivery_date),
                    notes: asText(record.notes),
                },
                items: items.map((item) => {
                    const value = item as Record<string, unknown>;
                    return {
                        description: asText(value.description),
                        quantity: asNumber(value.quantity),
                        unitPrice: asNumber(value.unit_price),
                        taxRate: asNumber(value.tax_rate),
                        total: asNumber(value.total),
                    };
                }),
            };
            const summary = `Order ${data.order.orderNumber} for ${data.order.customer || 'customer'}: ${data.order.status}, ${data.order.total}, ${data.items.length} line items.`;
            return { summary, data };
        },
    },
    {
        name: 'list_invoices',
        title: 'List invoices',
        description: 'List GST invoices in a date window with totals, paid amounts and status.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'invoices', action: 'read' },
        input: listInvoicesInput,
        execute: async (context, rawArgs) => {
            const args = listInvoicesInput.parse(rawArgs);
            const window = rollingWindow(args.days, context.now);
            const clauses = [accountFilter(context.accountEmail), `invoice_date >= "${window.fromDate}"`];
            if (args.status) clauses.push(`status = "${args.status}"`);
            const invoices = await listRecords(context.client, 'invoices', {
                filter: clauses.join(' && '),
                sort: '-invoice_date',
                perPage: args.limit,
                fields: 'id,invoice_number,invoice_date,buyer_name,grand_total,total,paid_amount,status,balance_due',
            }).catch(() => []);
            const items = invoices.map((invoice) => {
                const record = invoice as Record<string, unknown>;
                const total = asNumber(record.grand_total) || asNumber(record.total);
                const paid = asNumber(record.paid_amount);
                return {
                    id: asText(record.id),
                    invoiceNumber: asText(record.invoice_number),
                    invoiceDate: asText(record.invoice_date) || asText(record.created),
                    buyer: asText(record.buyer_name),
                    total,
                    paidAmount: paid,
                    balanceDue: Math.round((total - paid) * 100) / 100,
                    status: asText(record.status) || (paid >= total && total > 0 ? 'paid' : 'pending'),
                };
            });
            const outstanding = items.reduce((sum, item) => sum + Math.max(0, item.balanceDue), 0);
            const summary = items.length === 0
                ? 'No invoices matched.'
                : `${items.length} invoices, outstanding ${Math.round(outstanding * 100) / 100}.`;
            return { summary, data: { count: items.length, outstanding, invoices: items } };
        },
    },
    {
        name: 'get_sales_report',
        title: 'Sales report',
        description: 'Aggregate sales revenue, counts and average order value over a rolling window, grouped by day or sales channel.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'reports', action: 'read' },
        input: salesReportInput,
        execute: async (context, rawArgs) => {
            const args = salesReportInput.parse(rawArgs);
            const window = rollingWindow(args.days, context.now);
            const sales = await listRecords(context.client, 'sales', {
                filter: `${accountFilter(context.accountEmail)} && created >= "${window.fromIso}"`,
                fields: 'id,total,channel,created,status',
                perPage: 500,
            });
            const rows = asSalesRows(sales).filter((row) => row.status !== 'cancelled');
            const groups = new Map<string, { revenue: number; count: number }>();
            for (const row of rows) {
                const key = args.groupBy === 'day' ? dayKey(row.created) : row.channel;
                const current = groups.get(key) ?? { revenue: 0, count: 0 };
                current.revenue += row.total;
                current.count += 1;
                groups.set(key, current);
            }
            const breakdown = [...groups.entries()]
                .map(([key, value]) => ({
                    key,
                    revenue: Math.round(value.revenue * 100) / 100,
                    salesCount: value.count,
                    averageOrderValue: value.count > 0 ? Math.round((value.revenue / value.count) * 100) / 100 : 0,
                }))
                .sort((a, b) => (args.groupBy === 'day' ? a.key.localeCompare(b.key) : b.revenue - a.revenue));
            const revenue = rows.reduce((sum, row) => sum + row.total, 0);
            const data = {
                windowDays: args.days,
                groupBy: args.groupBy,
                totalRevenue: Math.round(revenue * 100) / 100,
                totalSales: rows.length,
                averageOrderValue: rows.length > 0 ? Math.round((revenue / rows.length) * 100) / 100 : 0,
                breakdown,
            };
            const summary = `Last ${args.days} days: ${data.totalSales} sales, revenue ${data.totalRevenue}, average ${data.averageOrderValue}.`;
            return { summary, data };
        },
    },
    {
        name: 'get_expenses_summary',
        title: 'Expenses summary',
        description: 'Total recorded expenses for a rolling window, grouped by expense category.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'reports', action: 'read' },
        input: expensesInput,
        execute: async (context, rawArgs) => {
            const args = expensesInput.parse(rawArgs);
            const window = rollingWindow(args.days, context.now);
            const expenses = await listRecords(context.client, 'expenses', {
                filter: `${accountFilter(context.accountEmail)} && expense_date >= "${window.fromDate}"`,
                perPage: 500,
                expand: 'category',
                fields: 'id,amount,expense_date,category,expand',
            }).catch(() => []);
            const groups = new Map<string, number>();
            let total = 0;
            for (const expense of expenses) {
                const record = expense as Record<string, unknown>;
                const amount = asNumber(record.amount);
                const category = ((record.expand as Record<string, unknown> | undefined)?.category ?? {}) as Record<string, unknown>;
                const name = asText(category.name) || asText(record.category) || 'Uncategorised';
                total += amount;
                groups.set(name, (groups.get(name) ?? 0) + amount);
            }
            const categories = [...groups.entries()]
                .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
                .sort((a, b) => b.amount - a.amount);
            const data = {
                windowDays: args.days,
                totalExpenses: Math.round(total * 100) / 100,
                entryCount: expenses.length,
                categories,
            };
            const summary = `Last ${args.days} days: ${data.entryCount} expense entries totalling ${data.totalExpenses}.`;
            return { summary, data };
        },
    },
    {
        name: 'get_record_details',
        title: 'Get product record by id',
        description: 'Fetch a single product or variant by its PocketBase id when the user references a specific catalog record.',
        kind: 'read',
        risk: 'low',
        capability: { resource: 'products', action: 'read' },
        input: z.object({
            collection: z.enum(['products', 'product_variants']),
            id: z.string().trim().min(1).max(40),
        }),
        execute: async (context, rawArgs) => {
            const args = z
                .object({ collection: z.enum(['products', 'product_variants']), id: z.string().trim().min(1).max(40) })
                .parse(rawArgs);
            const record = await findRecordById(context.client, args.collection, args.id, context.accountEmail);
            if (!record) {
                return { summary: 'No record found with that id in this store.', data: { found: false } };
            }
            const plain = { ...(record as Record<string, unknown>) };
            delete plain.collectionId;
            delete plain.collectionName;
            return { summary: `Found ${args.collection} record ${args.id}.`, data: { found: true, record: plain } };
        },
    },
];
