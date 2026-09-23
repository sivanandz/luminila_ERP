/**
 * Customer Lookup - Links WhatsApp chats to customers table using PocketBase
 */

import { pb } from './pocketbase';

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
    pan?: string | null;
    customer_type: 'retail' | 'wholesale' | 'vip';
    billing_address?: string | null;
    shipping_address?: string | null;
    state_code?: string | null;
    loyalty_points: number;
    store_credit?: number;
    total_spent: number;
    total_orders: number;
    preferred_contact: 'phone' | 'email' | 'whatsapp';
    opt_in_marketing?: boolean;
    notes: string | null;
    tags: string[] | null;
    source: string;
    // 360° Jewelry CRM Attributes & backward compatibility
    ring_size?: string | null;
    bangle_size?: string | null;
    preferred_metal?: string | null;
    anniversary?: string | null;
    anniversary_date?: string | null;
    date_of_birth?: string | null;
    birthday_date?: string | null;
    lead_status?: 'new_lead' | 'contacted' | 'quoted' | 'awaiting_payment' | 'won' | 'vip' | null;
    assigned_staff?: string | null;
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
 * Map raw PocketBase record to Customer interface with dual-field resilience
 */
export function mapCustomerRecord(result: any): Customer {
    return {
        id: result.id,
        name: result.name,
        phone: result.phone || null,
        email: result.email || null,
        address: result.address || null,
        city: result.city || null,
        state: result.state || null,
        pincode: result.pincode || null,
        company_name: result.company_name || null,
        gstin: result.gstin || null,
        pan: result.pan || null,
        customer_type: result.customer_type || 'retail',
        billing_address: result.billing_address || result.address || null,
        shipping_address: result.shipping_address || null,
        state_code: result.state_code || null,
        loyalty_points: result.loyalty_points || 0,
        store_credit: result.store_credit || 0,
        total_spent: result.total_spent || 0,
        total_orders: result.total_orders || 0,
        preferred_contact: result.preferred_contact || 'phone',
        opt_in_marketing: Boolean(result.opt_in_marketing),
        notes: result.notes || null,
        tags: result.tags || null,
        source: result.source || 'manual',
        ring_size: result.ring_size || null,
        bangle_size: result.bangle_size || null,
        preferred_metal: result.preferred_metal || null,
        anniversary: result.anniversary || result.anniversary_date || null,
        anniversary_date: result.anniversary_date || result.anniversary || null,
        date_of_birth: result.date_of_birth || result.birthday_date || null,
        birthday_date: result.birthday_date || result.date_of_birth || null,
        lead_status: result.lead_status || null,
        assigned_staff: result.assigned_staff || null,
        created_at: result.created,
        updated_at: result.updated,
    };
}

/**
 * Find customer by phone number
 */
export async function findCustomerByPhone(phone: string): Promise<Customer | null> {
    const normalized = normalizePhone(phone);

    if (!normalized || normalized.length < 10) {
        return null;
    }

    try {
        // Search with LIKE for flexibility
        const result = await pb.collection('customers').getFirstListItem(
            `phone~"${normalized}"`
        );

        return mapCustomerRecord(result);
    } catch (error) {
        return null;
    }
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

    try {
        const result = await pb.collection('customers').create({
            name: chatName,
            phone: phoneNumber ? `+91${phoneNumber}` : '',
            source: 'whatsapp',
            preferred_contact: 'whatsapp',
            customer_type: 'retail',
        });

        return mapCustomerRecord(result);
    } catch (error) {
        console.error('Failed to create customer:', error);
        return null;
    }
}

/**
 * Get orders for a customer
 */
export async function getCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
    try {
        const sales = await pb.collection('sales').getList(1, 10, {
            filter: `customer="${customerId}"`,
            sort: '-created',
        });

        return sales.items.map((order: any) => ({
            id: order.id,
            channel: order.channel,
            total: order.total,
            status: order.status,
            created_at: order.created,
            items_count: 0, // Would need separate query for items count
        }));
    } catch (error) {
        return [];
    }
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
    try {
        await pb.collection('customer_interactions').create({
            customer: customerId,
            interaction_type: type,
            description,
            sale: saleId || '',
        });
    } catch (error) {
        console.error('Failed to log interaction:', error);
    }
}

/**
 * Update customer notes
 */
export async function updateCustomerNotes(customerId: string, notes: string): Promise<void> {
    try {
        await pb.collection('customers').update(customerId, { notes });
    } catch (error) {
        console.error('Failed to update notes:', error);
    }
}

/**
 * Add tag to customer
 */
export async function addCustomerTag(customerId: string, tag: string): Promise<void> {
    try {
        const customer = await pb.collection('customers').getOne(customerId);
        const currentTags = customer.tags || [];

        if (!currentTags.includes(tag)) {
            await pb.collection('customers').update(customerId, {
                tags: [...currentTags, tag],
            });
        }
    } catch (error) {
        console.error('Failed to add tag:', error);
    }
}

/**
 * Update 360° Jewelry CRM Profile attributes
 */
export async function updateCustomerCRMProfile(
    customerId: string,
    data: {
        name?: string;
        email?: string | null;
        address?: string | null;
        city?: string | null;
        state?: string | null;
        pincode?: string | null;
        gstin?: string | null;
        customer_type?: 'retail' | 'wholesale' | 'vip';
        ring_size?: string | null;
        bangle_size?: string | null;
        preferred_metal?: string | null;
        anniversary_date?: string | null;
        birthday_date?: string | null;
        lead_status?: 'new_lead' | 'contacted' | 'quoted' | 'awaiting_payment' | 'won' | 'vip' | null;
        assigned_staff?: string | null;
        notes?: string | null;
    }
): Promise<Customer | null> {
    try {
        const payload: Record<string, any> = { ...data };
        // Dual-write anniversary and birthday to both canonical and legacy column names
        if (data.anniversary_date !== undefined) {
            payload.anniversary = data.anniversary_date;
            payload.anniversary_date = data.anniversary_date;
        }
        if (data.birthday_date !== undefined) {
            payload.date_of_birth = data.birthday_date;
            payload.birthday_date = data.birthday_date;
        }

        const updated = await pb.collection('customers').update(customerId, payload);
        return mapCustomerRecord(updated);
    } catch (err) {
        console.error('Failed to update customer CRM profile:', err);
        return null;
    }
}

/**
 * Set customer lead status
 */
export async function setCustomerLeadStatus(
    customerId: string,
    status: 'new_lead' | 'contacted' | 'quoted' | 'awaiting_payment' | 'won' | 'vip'
): Promise<void> {
    try {
        await pb.collection('customers').update(customerId, { lead_status: status });
    } catch (err) {
        console.error('Failed to update lead status:', err);
    }
}

