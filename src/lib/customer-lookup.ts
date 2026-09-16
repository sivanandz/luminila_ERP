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
    customer_type: 'retail' | 'wholesale' | 'vip';
    loyalty_points: number;
    total_spent: number;
    total_orders: number;
    preferred_contact: 'phone' | 'email' | 'whatsapp';
    notes: string | null;
    tags: string[] | null;
    source: string;
    // 360° Jewelry CRM Attributes
    ring_size?: string | null;
    bangle_size?: string | null;
    preferred_metal?: string | null;
    anniversary_date?: string | null;
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

        return {
            id: result.id,
            name: result.name,
            phone: result.phone,
            email: result.email,
            address: result.address,
            city: result.city,
            state: result.state,
            pincode: result.pincode,
            company_name: result.company_name,
            gstin: result.gstin,
            customer_type: result.customer_type || 'retail',
            loyalty_points: result.loyalty_points || 0,
            total_spent: result.total_spent || 0,
            total_orders: result.total_orders || 0,
            preferred_contact: result.preferred_contact || 'phone',
            notes: result.notes,
            tags: result.tags,
            source: result.source || 'manual',
            created_at: result.created,
            updated_at: result.updated,
        };
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

        return {
            id: result.id,
            name: result.name,
            phone: result.phone,
            email: result.email,
            address: result.address,
            city: result.city,
            state: result.state,
            pincode: result.pincode,
            company_name: result.company_name,
            gstin: result.gstin,
            customer_type: result.customer_type || 'retail',
            loyalty_points: result.loyalty_points || 0,
            total_spent: result.total_spent || 0,
            total_orders: result.total_orders || 0,
            preferred_contact: result.preferred_contact || 'whatsapp',
            notes: result.notes,
            tags: result.tags,
            source: result.source || 'whatsapp',
            created_at: result.created,
            updated_at: result.updated,
        };
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
        const updated = await pb.collection('customers').update(customerId, data);
        return {
            id: updated.id,
            name: updated.name,
            phone: updated.phone,
            email: updated.email,
            address: updated.address,
            city: updated.city,
            state: updated.state,
            pincode: updated.pincode,
            company_name: updated.company_name,
            gstin: updated.gstin,
            customer_type: updated.customer_type || 'retail',
            loyalty_points: updated.loyalty_points || 0,
            total_spent: updated.total_spent || 0,
            total_orders: updated.total_orders || 0,
            preferred_contact: updated.preferred_contact || 'phone',
            notes: updated.notes,
            tags: updated.tags,
            source: updated.source || 'whatsapp',
            ring_size: updated.ring_size,
            bangle_size: updated.bangle_size,
            preferred_metal: updated.preferred_metal,
            anniversary_date: updated.anniversary_date,
            birthday_date: updated.birthday_date,
            lead_status: updated.lead_status,
            assigned_staff: updated.assigned_staff,
            created_at: updated.created,
            updated_at: updated.updated,
        };
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

