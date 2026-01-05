/**
 * Customer Lookup - Links WhatsApp chats to customers table
 */

import { supabase } from './supabase';

// Customer type from database
export interface Customer {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    company_name: string | null;
    gstin: string | null;
    customer_type: 'retail' | 'wholesale' | 'vip';
    loyalty_points: number;
    total_spent: number;
    total_orders: number;
    preferred_contact: 'phone' | 'email' | 'whatsapp';
    notes: string | null;
    tags: string[] | null;
    source: string;
    created_at: string;
    updated_at: string;
}

export interface CustomerOrder {
    id: string;
    channel: string;
    total: number;
    status: string;
    created_at: string;
    items_count: number;
}

/**
 * Normalize phone number for comparison
 * Handles various formats: +91 98765 43210, 9876543210, 91-9876543210
 */
export function normalizePhone(phone: string): string {
    // Remove all non-digits
    let digits = phone.replace(/\D/g, '');

    // If starts with country code 91, keep last 10 digits
    if (digits.length > 10 && digits.startsWith('91')) {
        digits = digits.slice(-10);
    }

    // Return last 10 digits
    return digits.slice(-10);
}

/**
 * Extract phone number from WhatsApp chat ID
 * Chat ID format: 919876543210@c.us or 919876543210@g.us
 */
export function phoneFromChatId(chatId: string): string | null {
    const match = chatId.match(/^(\d+)@/);
    if (match) {
        return normalizePhone(match[1]);
    }
    return null;
}

/**
 * Find customer by phone number
 */
export async function findCustomerByPhone(phone: string): Promise<Customer | null> {
    const normalized = normalizePhone(phone);

    if (!normalized || normalized.length < 10) {
        return null;
    }

    // Search with LIKE for flexibility (handles various stored formats)
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .or(`phone.ilike.%${normalized},phone.ilike.%${normalized.slice(-10)}`)
        .limit(1)
        .single();

    if (error || !data) {
        return null;
    }

    return data as Customer;
}

/**
 * Create a new customer from WhatsApp chat info
 */
export async function createCustomerFromChat(
    chatName: string,
    chatId: string,
    phone?: string
): Promise<Customer | null> {
    const phoneNumber = phone || phoneFromChatId(chatId);

    const { data, error } = await supabase
        .from('customers')
        .insert({
            name: chatName,
            phone: phoneNumber ? `+91${phoneNumber}` : null,
            source: 'whatsapp',
            preferred_contact: 'whatsapp',
            customer_type: 'retail',
        })
        .select()
        .single();

    if (error) {
        console.error('Failed to create customer:', error);
        return null;
    }

    return data as Customer;
}

/**
 * Get orders for a customer
 */
export async function getCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
    const { data, error } = await supabase
        .from('sales')
        .select(`
            id,
            channel,
            total,
            status,
            created_at,
            sale_items(count)
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error || !data) {
        return [];
    }

    return data.map(order => ({
        id: order.id,
        channel: order.channel,
        total: order.total,
        status: order.status,
        created_at: order.created_at,
        items_count: (order.sale_items as any)?.[0]?.count || 0,
    }));
}

/**
 * Log a customer interaction
 */
export async function logCustomerInteraction(
    customerId: string,
    type: 'purchase' | 'inquiry' | 'complaint' | 'follow_up' | 'whatsapp_chat',
    description: string,
    saleId?: string
): Promise<void> {
    await supabase
        .from('customer_interactions')
        .insert({
            customer_id: customerId,
            interaction_type: type,
            description,
            sale_id: saleId || null,
        });
}

/**
 * Update customer notes
 */
export async function updateCustomerNotes(customerId: string, notes: string): Promise<void> {
    await supabase
        .from('customers')
        .update({ notes })
        .eq('id', customerId);
}

/**
 * Add tag to customer
 */
export async function addCustomerTag(customerId: string, tag: string): Promise<void> {
    const { data: customer } = await supabase
        .from('customers')
        .select('tags')
        .eq('id', customerId)
        .single();

    const currentTags = customer?.tags || [];
    if (!currentTags.includes(tag)) {
        await supabase
            .from('customers')
            .update({ tags: [...currentTags, tag] })
            .eq('id', customerId);
    }
}
