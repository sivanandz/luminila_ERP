/**
 * Customer CRM Service Layer
 * CRUD operations, search, purchase history
 */

import { supabase } from './supabase';

// ===========================================
// TYPES
// ===========================================
export type CustomerType = 'retail' | 'wholesale' | 'vip';

export interface Customer {
    id?: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    state_code?: string;
    pincode?: string;
    company_name?: string;
    gstin?: string;
    pan?: string;
    customer_type: CustomerType;
    date_of_birth?: string;
    anniversary?: string;
    notes?: string;
    tags?: string[];
    loyalty_points: number;
    total_spent: number;
    total_orders: number;
    preferred_contact: 'phone' | 'email' | 'whatsapp';
    opt_in_marketing: boolean;
    source?: string;
    created_at?: string;
    updated_at?: string;
    last_purchase_date?: string;
}

export interface CustomerInteraction {
    id?: string;
    customer_id: string;
    interaction_type: string;
    description?: string;
    sale_id?: string;
    order_id?: string;
    created_by?: string;
    created_at?: string;
}

export interface CustomerPurchase {
    id: string;
    invoice_number?: string;
    total: number;
    items_count: number;
    payment_method?: string;
    created_at: string;
}

// ===========================================
// CUSTOMER CRUD
// ===========================================

export async function getCustomers(filters?: {
    search?: string;
    type?: CustomerType;
    hasPhone?: boolean;
}): Promise<Customer[]> {
    let query = supabase
        .from('customers')
        .select('*')
        .order('name');

    if (filters?.type) {
        query = query.eq('customer_type', filters.type);
    }

    if (filters?.hasPhone) {
        query = query.not('phone', 'is', null);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching customers:', error);
        return [];
    }

    let customers = data || [];

    // Client-side search filter (name, phone, email)
    if (filters?.search) {
        const search = filters.search.toLowerCase();
        customers = customers.filter(c =>
            c.name?.toLowerCase().includes(search) ||
            c.phone?.includes(search) ||
            c.email?.toLowerCase().includes(search) ||
            c.company_name?.toLowerCase().includes(search)
        );
    }

    return customers;
}

export async function getCustomer(id: string): Promise<Customer | null> {
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching customer:', error);
        return null;
    }

    return data;
}

export async function createCustomer(customer: Omit<Customer, 'id' | 'loyalty_points' | 'total_spent' | 'total_orders' | 'created_at' | 'updated_at'>): Promise<Customer> {
    const { data, error } = await supabase
        .from('customers')
        .insert({
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            city: customer.city,
            state: customer.state,
            state_code: customer.state_code,
            pincode: customer.pincode,
            company_name: customer.company_name,
            gstin: customer.gstin,
            pan: customer.pan,
            customer_type: customer.customer_type || 'retail',
            date_of_birth: customer.date_of_birth,
            anniversary: customer.anniversary,
            notes: customer.notes,
            tags: customer.tags,
            preferred_contact: customer.preferred_contact || 'phone',
            opt_in_marketing: customer.opt_in_marketing ?? true,
            source: customer.source || 'pos',
        })
        .select()
        .single();

    if (error) {
        console.error('Error creating customer:', error);
        throw error;
    }

    return data;
}

export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer> {
    // Remove computed fields
    const { id: _, loyalty_points, total_spent, total_orders, created_at, updated_at, last_purchase_date, ...updateData } = updates;

    const { data, error } = await supabase
        .from('customers')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating customer:', error);
        throw error;
    }

    return data;
}

export async function deleteCustomer(id: string): Promise<void> {
    const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// ===========================================
// CUSTOMER SEARCH (for POS)
// ===========================================

export async function searchCustomers(query: string, limit: number = 10): Promise<Customer[]> {
    if (!query || query.length < 2) return [];

    const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, email, customer_type, total_spent')
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(limit);

    if (error) {
        console.error('Error searching customers:', error);
        return [];
    }

    return data || [];
}

// ===========================================
// PURCHASE HISTORY
// ===========================================

export async function getCustomerPurchases(customerId: string): Promise<CustomerPurchase[]> {
    const { data, error } = await supabase
        .from('sales')
        .select(`
            id,
            total,
            payment_method,
            created_at,
            items:sale_items(id)
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching purchases:', error);
        return [];
    }

    return (data || []).map((sale: any) => ({
        id: sale.id,
        total: sale.total,
        items_count: sale.items?.length || 0,
        payment_method: sale.payment_method,
        created_at: sale.created_at,
    }));
}

// ===========================================
// INTERACTIONS
// ===========================================

export async function getCustomerInteractions(customerId: string): Promise<CustomerInteraction[]> {
    const { data, error } = await supabase
        .from('customer_interactions')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Error fetching interactions:', error);
        return [];
    }

    return data || [];
}

export async function addInteraction(interaction: Omit<CustomerInteraction, 'id' | 'created_at'>): Promise<CustomerInteraction> {
    const { data, error } = await supabase
        .from('customer_interactions')
        .insert(interaction)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ===========================================
// LOYALTY POINTS
// ===========================================

export async function addLoyaltyPoints(customerId: string, points: number): Promise<void> {
    const { error } = await supabase.rpc('add_loyalty_points', {
        p_customer_id: customerId,
        p_points: points,
    });

    // Fallback if RPC doesn't exist
    if (error) {
        const { error: updateError } = await supabase
            .from('customers')
            .update({ loyalty_points: supabase.rpc('increment_points', { x: points }) })
            .eq('id', customerId);

        // Simple increment fallback
        if (updateError) {
            const customer = await getCustomer(customerId);
            if (customer) {
                await supabase
                    .from('customers')
                    .update({ loyalty_points: customer.loyalty_points + points })
                    .eq('id', customerId);
            }
        }
    }
}

// ===========================================
// REMINDERS (Birthdays/Anniversaries)
// ===========================================

export async function getUpcomingBirthdays(days: number = 7): Promise<Customer[]> {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .not('date_of_birth', 'is', null)
        .order('date_of_birth');

    if (error) {
        console.error('Error fetching birthdays:', error);
        return [];
    }

    // Filter in JS for upcoming birthdays (handle year-wrap)
    return (data || []).filter(customer => {
        if (!customer.date_of_birth) return false;

        const dob = new Date(customer.date_of_birth);
        const thisYearBday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());

        // If birthday already passed, check next year
        if (thisYearBday < today) {
            thisYearBday.setFullYear(thisYearBday.getFullYear() + 1);
        }

        return thisYearBday <= endDate;
    });
}

export async function getUpcomingAnniversaries(days: number = 7): Promise<Customer[]> {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .not('anniversary', 'is', null)
        .order('anniversary');

    if (error) {
        console.error('Error fetching anniversaries:', error);
        return [];
    }

    return (data || []).filter(customer => {
        if (!customer.anniversary) return false;

        const ann = new Date(customer.anniversary);
        const thisYearAnn = new Date(today.getFullYear(), ann.getMonth(), ann.getDate());

        if (thisYearAnn < today) {
            thisYearAnn.setFullYear(thisYearAnn.getFullYear() + 1);
        }

        return thisYearAnn <= endDate;
    });
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
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const { count: totalCustomers } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true });

    const { count: newThisMonth } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thisMonth.toISOString());

    const { data: topSpenders } = await supabase
        .from('customers')
        .select('*')
        .order('total_spent', { ascending: false })
        .limit(5);

    const { data: typeCounts } = await supabase
        .from('customers')
        .select('customer_type');

    const byType: Record<CustomerType, number> = {
        retail: 0,
        wholesale: 0,
        vip: 0,
    };

    typeCounts?.forEach((c: any) => {
        if (c.customer_type in byType) {
            byType[c.customer_type as CustomerType]++;
        }
    });

    return {
        totalCustomers: totalCustomers || 0,
        newThisMonth: newThisMonth || 0,
        topSpenders: topSpenders || [],
        byType,
    };
}
