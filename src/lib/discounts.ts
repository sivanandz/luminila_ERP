/**
 * Discounts & Offers Service
 * Coupon validation, discount calculations, and management
 */

import { supabase } from './supabase';

// ===========================================
// TYPES
// ===========================================

export type DiscountType = 'percentage' | 'fixed' | 'buy_x_get_y';
export type AppliesTo = 'all' | 'category' | 'product' | 'customer_type';

export interface Discount {
    id?: string;
    code: string;
    name: string;
    description?: string;
    discount_type: DiscountType;
    value: number;
    max_discount?: number;
    min_purchase: number;
    min_items: number;
    applies_to: AppliesTo;
    applies_to_ids?: string[];
    usage_limit?: number;
    per_customer_limit: number;
    used_count: number;
    start_date?: string;
    end_date?: string;
    is_active: boolean;
    created_at?: string;
}

export interface DiscountValidation {
    valid: boolean;
    discount?: Discount;
    error?: string;
    discountAmount: number;
}

// ===========================================
// DISCOUNT CRUD
// ===========================================

export async function getDiscounts(activeOnly: boolean = false): Promise<Discount[]> {
    let query = supabase
        .from('discounts')
        .select('*')
        .order('created_at', { ascending: false });

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Error fetching discounts:', error);
        return [];
    }
    return data || [];
}

export async function getDiscount(id: string): Promise<Discount | null> {
    const { data, error } = await supabase
        .from('discounts')
        .select('*')
        .eq('id', id)
        .single();

    if (error) return null;
    return data;
}

export async function getDiscountByCode(code: string): Promise<Discount | null> {
    const { data, error } = await supabase
        .from('discounts')
        .select('*')
        .eq('code', code.toUpperCase())
        .single();

    if (error) return null;
    return data;
}

export async function createDiscount(discount: Omit<Discount, 'id' | 'used_count' | 'created_at'>): Promise<Discount> {
    const { data, error } = await supabase
        .from('discounts')
        .insert({
            ...discount,
            code: discount.code.toUpperCase(),
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateDiscount(id: string, updates: Partial<Discount>): Promise<Discount> {
    const { data, error } = await supabase
        .from('discounts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function deleteDiscount(id: string): Promise<void> {
    const { error } = await supabase
        .from('discounts')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

export async function toggleDiscountActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
        .from('discounts')
        .update({ is_active: isActive })
        .eq('id', id);

    if (error) throw error;
}

// ===========================================
// DISCOUNT VALIDATION
// ===========================================

export async function validateDiscount(
    code: string,
    orderValue: number,
    itemCount: number,
    customerId?: string,
    customerType?: string
): Promise<DiscountValidation> {
    const discount = await getDiscountByCode(code);

    if (!discount) {
        return { valid: false, error: 'Invalid discount code', discountAmount: 0 };
    }

    // Check if active
    if (!discount.is_active) {
        return { valid: false, error: 'This discount is no longer active', discountAmount: 0 };
    }

    // Check date validity
    const now = new Date();
    if (discount.start_date && new Date(discount.start_date) > now) {
        return { valid: false, error: 'This discount is not yet valid', discountAmount: 0 };
    }
    if (discount.end_date && new Date(discount.end_date) < now) {
        return { valid: false, error: 'This discount has expired', discountAmount: 0 };
    }

    // Check usage limit
    if (discount.usage_limit && discount.used_count >= discount.usage_limit) {
        return { valid: false, error: 'This discount has reached its usage limit', discountAmount: 0 };
    }

    // Check per-customer limit
    if (customerId && discount.per_customer_limit > 0) {
        const { count } = await supabase
            .from('discount_usage')
            .select('*', { count: 'exact', head: true })
            .eq('discount_id', discount.id)
            .eq('customer_id', customerId);

        if ((count || 0) >= discount.per_customer_limit) {
            return { valid: false, error: 'You have already used this discount', discountAmount: 0 };
        }
    }

    // Check minimum purchase
    if (orderValue < discount.min_purchase) {
        return {
            valid: false,
            error: `Minimum order of ₹${discount.min_purchase.toLocaleString()} required`,
            discountAmount: 0,
        };
    }

    // Check minimum items
    if (itemCount < discount.min_items) {
        return {
            valid: false,
            error: `Minimum ${discount.min_items} items required`,
            discountAmount: 0,
        };
    }

    // Check customer type applicability
    if (discount.applies_to === 'customer_type' && customerType) {
        if (!discount.applies_to_ids?.includes(customerType)) {
            return {
                valid: false,
                error: 'This discount is not applicable for your account type',
                discountAmount: 0,
            };
        }
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (discount.discount_type === 'percentage') {
        discountAmount = (orderValue * discount.value) / 100;
        if (discount.max_discount && discountAmount > discount.max_discount) {
            discountAmount = discount.max_discount;
        }
    } else if (discount.discount_type === 'fixed') {
        discountAmount = Math.min(discount.value, orderValue);
    }

    return {
        valid: true,
        discount,
        discountAmount: Math.round(discountAmount * 100) / 100,
    };
}

// ===========================================
// RECORD USAGE
// ===========================================

export async function recordDiscountUsage(
    discountId: string,
    discountAmount: number,
    orderValue: number,
    options?: {
        customerId?: string;
        saleId?: string;
        invoiceId?: string;
    }
): Promise<void> {
    const { error } = await supabase.from('discount_usage').insert({
        discount_id: discountId,
        customer_id: options?.customerId,
        sale_id: options?.saleId,
        invoice_id: options?.invoiceId,
        discount_amount: discountAmount,
        order_value: orderValue,
    });

    if (error) {
        console.error('Error recording discount usage:', error);
    }
}

// ===========================================
// STATS
// ===========================================

export async function getDiscountStats(): Promise<{
    totalDiscounts: number;
    activeCount: number;
    totalSavings: number;
    usageCount: number;
}> {
    const { count: totalDiscounts } = await supabase
        .from('discounts')
        .select('*', { count: 'exact', head: true });

    const { count: activeCount } = await supabase
        .from('discounts')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const { data: usageData } = await supabase
        .from('discount_usage')
        .select('discount_amount');

    const totalSavings = usageData?.reduce((sum: number, u: any) => sum + (u.discount_amount || 0), 0) || 0;
    const usageCount = usageData?.length || 0;

    return {
        totalDiscounts: totalDiscounts || 0,
        activeCount: activeCount || 0,
        totalSavings,
        usageCount,
    };
}
