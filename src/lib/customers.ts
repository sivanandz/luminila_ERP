/**
 * Customer CRM Service Layer
 * CRUD operations, search, purchase history using PocketBase
 */

import { pb, sanitizeFilter } from './pocketbase';

// ===========================================
// TYPES
// ===========================================
export type CustomerType = 'retail' | 'wholesale' | 'vip';

export interface Customer {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    billing_address?: string;
    shipping_address?: string;
    city?: string;
    state?: string;
    state_code?: string;
    pincode?: string;
    company_name?: string;
    gstin?: string;
    pan?: string;
    customer_type: CustomerType;
    tier?: string;
    date_of_birth?: string;
    anniversary?: string;
    notes?: string;
    tags?: string[]; // Stored as JSON or array depending on PB setup. Assuming JSON/Array.
    loyalty_points: number;
    store_credit: number;
    total_spent: number;
    total_orders: number;
    preferred_contact: 'phone' | 'email' | 'whatsapp';
    opt_in_marketing: boolean;
    source?: string;
    created: string;
    updated: string;
    last_purchase_date?: string;
}

export function getTierDiscountPercent(tier?: string, customerType?: string): number {
    const t = (tier || customerType || '').toLowerCase();
    if (t.includes('distributor')) return 15;
    if (t.includes('wholesal')) return 8;
    if (t.includes('vip')) return 5;
    return 0;
}

export interface CustomerInteraction {
    id: string;
    customer: string; // Relation
    interaction_type: string;
    description?: string;
    sale?: string; // Relation
    order_id?: string;
    created_by?: string;
    created: string;
}

export interface CustomerPurchase {
    id: string;
    invoice_number?: string; // Might not be on sale record directly in PB unless added
    total: number;
    items_count: number;
    payment_method?: string;
    created: string;
}

// ===========================================
// CUSTOMER CRUD
// ===========================================

export async function getCustomers(filters?: {
    search?: string;
    type?: CustomerType;
    hasPhone?: boolean;
}): Promise<Customer[]> {
    try {
        const filterParts: string[] = [];

        if (filters?.type) {
            filterParts.push(`customer_type="${filters.type}"`);
        }

        if (filters?.hasPhone) {
            filterParts.push(`phone != ""`);
        }

        // Search in PB can be done via filter too
        if (filters?.search) {
            const s = sanitizeFilter(filters.search);
            filterParts.push(`(name~"${s}" || phone~"${s}" || email~"${s}" || company_name~"${s}")`);
        }

        const records = await pb.collection('customers').getFullList<Customer>({
            filter: filterParts.join(' && '),
            sort: 'name'
        });

        return records;
    } catch (error) {
        console.error('Error fetching customers:', error);
        return [];
    }
}

export async function getCustomer(id: string): Promise<Customer | null> {
    try {
        const record = await pb.collection('customers').getOne<Customer>(id);
        return record;
    } catch (error) {
        console.error('Error fetching customer:', error);
        return null;
    }
}

export async function createCustomer(customer: Omit<Customer, 'id' | 'loyalty_points' | 'total_spent' | 'total_orders' | 'created' | 'updated'>): Promise<Customer> {
    try {
        const record = await pb.collection('customers').create(customer);
        return record as unknown as Customer;
    } catch (error) {
        console.error('Error creating customer:', error);
        throw error;
    }
}

export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer> {
    // Remove computed fields if any passed accidentally (the named bindings are
    // intentionally unused — their omission keeps them out of the update payload)
    const {
        id: _omittedId,
        loyalty_points: _omittedLoyaltyPoints,
        total_spent: _omittedTotalSpent,
        total_orders: _omittedTotalOrders,
        created: _omittedCreated,
        updated: _omittedUpdated,
        last_purchase_date: _omittedLastPurchase,
        ...updateData
    } = updates;

    try {
        const record = await pb.collection('customers').update(id, updateData);
        return record as unknown as Customer;
    } catch (error) {
        console.error('Error updating customer:', error);
        throw error;
    }
}

export async function deleteCustomer(id: string): Promise<void> {
    try {
        await pb.collection('customers').delete(id);
    } catch (error) {
        throw error;
    }
}

// ===========================================
// CUSTOMER SEARCH (for POS)
// ===========================================

export async function searchCustomers(query: string, limit: number = 10): Promise<Customer[]> {
    if (!query || query.length < 2) return [];

    try {
        const records = await pb.collection('customers').getList<Customer>(1, limit, {
            filter: `name~"${sanitizeFilter(query)}" || phone~"${sanitizeFilter(query)}" || email~"${sanitizeFilter(query)}"`,
            sort: 'name'
        });
        return records.items;
    } catch (error) {
        console.error('Error searching customers:', error);
        return [];
    }
}

// ===========================================
// PURCHASE HISTORY
// ===========================================

export async function getCustomerPurchases(customerId: string): Promise<CustomerPurchase[]> {
    // Fields of a sales record consumed for purchase history display
    interface SaleSummary {
        id: string;
        total: number;
        payment_method?: string;
        created: string;
    }

    try {
        const records = await pb.collection('sales').getList<SaleSummary>(1, 50, {
            filter: `customer="${customerId}"`,
            sort: '-created',
            expand: 'sale_items(sale)' // Logic for count might be complex if items are separate collection
        });

        // PocketBase doesn't support reverse-expand in list queries easily.
        // Return basic sale info; items_count is stored on sale or fetched separately.
        // Assuming we rely on total/items_count if we add it to sales, OR we fetch items.
        // To be safe and fast, let's just return sales info. If items count is needed, we ideally store it on sale.
        // The previous code used a join. 
        // Let's assume for now we just show what's available. 

        return records.items.map((sale) => ({
            id: sale.id,
            total: sale.total,
            items_count: 0, // Pending efficient count solution
            payment_method: sale.payment_method,
            created: sale.created,
        }));
    } catch (error) {
        console.error('Error fetching purchases:', error);
        return [];
    }
}

// ===========================================
// INTERACTIONS
// ===========================================

export async function getCustomerInteractions(customerId: string): Promise<CustomerInteraction[]> {
    try {
        const records = await pb.collection('customer_interactions').getList<CustomerInteraction>(1, 50, {
            filter: `customer="${customerId}"`,
            sort: '-created'
        });
        return records.items;
    } catch (error) {
        console.error('Error fetching interactions:', error);
        return [];
    }
}

export async function addInteraction(interaction: Omit<CustomerInteraction, 'id' | 'created'>): Promise<CustomerInteraction> {
    try {
        const record = await pb.collection('customer_interactions').create(interaction);
        return record as unknown as CustomerInteraction;
    } catch (error) {
        throw error;
    }
}

// ===========================================
// LOYALTY POINTS
// ===========================================

export async function addLoyaltyPoints(customerId: string, points: number): Promise<void> {
    // Was RPC. Now manual update.
    try {
        const customer = await getCustomer(customerId);
        if (customer) {
            await pb.collection('customers').update(customerId, {
                loyalty_points: (customer.loyalty_points || 0) + points
            });
        }
    } catch (error) {
        console.error('Error adding loyalty points:', error);
    }
}

// ===========================================
// REMINDERS (Birthdays/Anniversaries)
// ===========================================

/**
 * Parse a date-only value (YYYY-MM-DD) as a local-timezone date.
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, which shifts the
 * calendar day in timezones behind UTC. Falls back to `new Date(value)`
 * for other formats; returns null for missing/invalid values.
 */
function parseDateOnly(value?: string): Date | null {
    if (!value) return null;
    const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const date = match
        ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
        : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export async function getUpcomingBirthdays(days: number = 7): Promise<Customer[]> {
    // PB filtering for dates excluding year is hard. fetch all with DOB and filter in JS.
    try {
        const records = await pb.collection('customers').getFullList<Customer>({
            filter: 'date_of_birth != "" && date_of_birth != null',
            sort: 'date_of_birth'
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0); // local midnight so events happening today are included
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days);

        return records.filter(customer => {
            const dob = parseDateOnly(customer.date_of_birth);
            if (!dob) return false;
            const thisYearBday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
            if (thisYearBday < today) {
                thisYearBday.setFullYear(thisYearBday.getFullYear() + 1);
            }
            return thisYearBday <= endDate;
        });

    } catch (error) {
        console.error('Error fetching birthdays:', error);
        return [];
    }
}

export async function getUpcomingAnniversaries(days: number = 7): Promise<Customer[]> {
    try {
        const records = await pb.collection('customers').getFullList<Customer>({
            filter: 'anniversary != "" && anniversary != null',
            sort: 'anniversary'
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0); // local midnight so events happening today are included
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days);

        return records.filter(customer => {
            const ann = parseDateOnly(customer.anniversary);
            if (!ann) return false;
            const thisYearAnn = new Date(today.getFullYear(), ann.getMonth(), ann.getDate());
            if (thisYearAnn < today) {
                thisYearAnn.setFullYear(thisYearAnn.getFullYear() + 1);
            }
            return thisYearAnn <= endDate;
        });
    } catch (error) {
        console.error('Error fetching anniversaries:', error);
        return [];
    }
}

// ===========================================
// STATS
// ===========================================

export async function getCustomerStats(): Promise<{
    totalCustomers: number;
    newThisMonth: number;
    topSpenders: Customer[];
    byType: Record<CustomerType, number>;
}> {
    try {
        const totalResult = await pb.collection('customers').getList(1, 1);

        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);
        const thisMonthStr = thisMonth.toISOString();

        const newResult = await pb.collection('customers').getList(1, 1, {
            filter: `created >= "${thisMonthStr}"`
        });

        const topSpenders = await pb.collection('customers').getList<Customer>(1, 5, {
            sort: '-total_spent'
        });

        // Type counts - hard without aggregate. Do a full list fetch if small enough, 
        // or just skip for now to save bandwidth.
        // Doing full list for type stats is risky for scale. 
        // Let's implement basic counters if needed or return 0s for now.
        const byType: Record<CustomerType, number> = {
            retail: 0,
            wholesale: 0,
            vip: 0,
        };

        // TODO: Implement aggregation with PB hooks or multiple count queries

        return {
            totalCustomers: totalResult.totalItems,
            newThisMonth: newResult.totalItems,
            topSpenders: topSpenders.items,
            byType,
        };
    } catch {
        return {
            totalCustomers: 0,
            newThisMonth: 0,
            topSpenders: [],
            byType: { retail: 0, wholesale: 0, vip: 0 }
        };
    }
}

export interface CustomerOrderHistoryRow {
    id: string;
    order_number: string;
    total: number;
    status: string;
    channel: string;
    date: string;
}

/** Combined POS sales and sales-order history for a customer profile. */
export async function getCustomerOrderHistory(
    customerId: string,
    phone?: string
): Promise<CustomerOrderHistoryRow[]> {
    const scope = `customer="${customerId}"${phone ? ` || customer_phone="${sanitizeFilter(phone)}"` : ''}`;
    const [salesRes, ordersRes] = await Promise.all([
        pb.collection('sales').getList(1, 25, { filter: scope, sort: '-created' }).catch(() => ({ items: [] })),
        pb.collection('sales_orders').getList(1, 25, { filter: scope, sort: '-created' }).catch(() => ({ items: [] })),
    ]);

    return [
        ...salesRes.items.map((sale: any) => ({
            id: sale.id,
            order_number: sale.channel_order_id || `SALE-${sale.id.slice(0, 6).toUpperCase()}`,
            total: Number(sale.total) || 0,
            status: sale.status || 'confirmed',
            channel: sale.channel || 'pos',
            date: sale.created,
        })),
        ...ordersRes.items.map((order: any) => ({
            id: order.id,
            order_number: order.order_number || `ORD-${order.id.slice(0, 6).toUpperCase()}`,
            total: Number(order.total) || 0,
            status: order.status || 'draft',
            channel: order.order_type || 'sales_order',
            date: order.order_date || order.created,
        })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** Jewelry-specific profile fields that are not part of the core Customer shape. */
export async function updateCustomerJewelryProfile(
    customerId: string,
    profile: {
        ring_size?: string;
        bangle_size?: string;
        preferred_metal?: string;
        birthday_date?: string;
        anniversary_date?: string;
    }
): Promise<void> {
    await pb.collection('customers').update(customerId, {
        ring_size: profile.ring_size || null,
        bangle_size: profile.bangle_size || null,
        preferred_metal: profile.preferred_metal || null,
        birthday_date: profile.birthday_date || null,
        anniversary_date: profile.anniversary_date || null,
    });
}