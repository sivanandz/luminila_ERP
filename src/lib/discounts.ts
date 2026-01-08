/**
 * Discounts & Offers Service
 * Coupon validation, discount calculations, and management using PocketBase
 */

import { pb } from './pocketbase';

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
    try {
        const filter = activeOnly ? 'is_active=true' : '';
        const records = await pb.collection('discounts').getFullList({
            filter,
            sort: '-created',
        });

        return records.map((d: any) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            description: d.description,
            discount_type: d.discount_type,
            value: d.value,
            max_discount: d.max_discount,
            min_purchase: d.min_purchase || 0,
            min_items: d.min_items || 0,
            applies_to: d.applies_to || 'all',
            applies_to_ids: d.applies_to_ids,
            usage_limit: d.usage_limit,
            per_customer_limit: d.per_customer_limit || 1,
            used_count: d.used_count || 0,
            start_date: d.start_date,
            end_date: d.end_date,
            is_active: d.is_active,
            created_at: d.created,
        }));
    } catch (error) {
        console.error('Error fetching discounts:', error);
        return [];
    }
}

export async function getDiscount(id: string): Promise<Discount | null> {
    try {
        const d = await pb.collection('discounts').getOne(id);
        return {
            id: d.id,
            code: d.code,
            name: d.name,
            description: d.description,
            discount_type: d.discount_type,
            value: d.value,
            max_discount: d.max_discount,
            min_purchase: d.min_purchase || 0,
            min_items: d.min_items || 0,
            applies_to: d.applies_to || 'all',
            applies_to_ids: d.applies_to_ids,
            usage_limit: d.usage_limit,
            per_customer_limit: d.per_customer_limit || 1,
            used_count: d.used_count || 0,
            start_date: d.start_date,
            end_date: d.end_date,
            is_active: d.is_active,
            created_at: d.created,
        };
    } catch (error) {
        return null;
    }
}

export async function getDiscountByCode(code: string): Promise<Discount | null> {
    try {
        const d = await pb.collection('discounts').getFirstListItem(`code="${code.toUpperCase()}"`);
        return {
            id: d.id,
            code: d.code,
            name: d.name,
            description: d.description,
            discount_type: d.discount_type,
            value: d.value,
            max_discount: d.max_discount,
            min_purchase: d.min_purchase || 0,
            min_items: d.min_items || 0,
            applies_to: d.applies_to || 'all',
            applies_to_ids: d.applies_to_ids,
            usage_limit: d.usage_limit,
            per_customer_limit: d.per_customer_limit || 1,
            used_count: d.used_count || 0,
            start_date: d.start_date,
            end_date: d.end_date,
            is_active: d.is_active,
            created_at: d.created,
        };
    } catch (error) {
        return null;
    }
}

export async function createDiscount(discount: Omit<Discount, 'id' | 'used_count' | 'created_at'>): Promise<Discount> {
    const d = await pb.collection('discounts').create({
        code: discount.code.toUpperCase(),
        name: discount.name,
        description: discount.description || '',
        discount_type: discount.discount_type,
        value: discount.value,
        max_discount: discount.max_discount,
        min_purchase: discount.min_purchase,
        min_items: discount.min_items,
        applies_to: discount.applies_to,
        applies_to_ids: discount.applies_to_ids,
        usage_limit: discount.usage_limit,
        per_customer_limit: discount.per_customer_limit,
        used_count: 0,
        start_date: discount.start_date || '',
        end_date: discount.end_date || '',
        is_active: discount.is_active,
    });

    return {
        ...discount,
        id: d.id,
        code: discount.code.toUpperCase(),
        used_count: 0,
        created_at: d.created,
    };
}

export async function updateDiscount(id: string, updates: Partial<Discount>): Promise<Discount> {
    const { id: _, created_at, ...cleanUpdates } = updates as any;
    if (cleanUpdates.code) {
        cleanUpdates.code = cleanUpdates.code.toUpperCase();
    }

    const d = await pb.collection('discounts').update(id, cleanUpdates);
    return {
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description,
        discount_type: d.discount_type,
        value: d.value,
        max_discount: d.max_discount,
        min_purchase: d.min_purchase || 0,
        min_items: d.min_items || 0,
        applies_to: d.applies_to || 'all',
        applies_to_ids: d.applies_to_ids,
        usage_limit: d.usage_limit,
        per_customer_limit: d.per_customer_limit || 1,
        used_count: d.used_count || 0,
        start_date: d.start_date,
        end_date: d.end_date,
        is_active: d.is_active,
        created_at: d.created,
    };
}

export async function deleteDiscount(id: string): Promise<void> {
    await pb.collection('discounts').delete(id);
}

export async function toggleDiscountActive(id: string, isActive: boolean): Promise<void> {
    await pb.collection('discounts').update(id, { is_active: isActive });
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
        try {
            const usages = await pb.collection('discount_usage').getFullList({
                filter: `discount="${discount.id}" && customer="${customerId}"`,
            });

            if (usages.length >= discount.per_customer_limit) {
                return { valid: false, error: 'You have already used this discount', discountAmount: 0 };
            }
        } catch (error) {
            // Ignore error, continue validation
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
    try {
        await pb.collection('discount_usage').create({
            discount: discountId,
            customer: options?.customerId || '',
            sale: options?.saleId || '',
            invoice: options?.invoiceId || '',
            discount_amount: discountAmount,
            order_value: orderValue,
        });

        // Increment used_count
        const discount = await pb.collection('discounts').getOne(discountId);
        await pb.collection('discounts').update(discountId, {
            used_count: (discount.used_count || 0) + 1,
        });
    } catch (error) {
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
    try {
        const allDiscounts = await pb.collection('discounts').getFullList();
        const totalDiscounts = allDiscounts.length;
        const activeCount = allDiscounts.filter((d: any) => d.is_active).length;

        const usageRecords = await pb.collection('discount_usage').getFullList();
        const totalSavings = usageRecords.reduce((sum: number, u: any) => sum + (u.discount_amount || 0), 0);
        const usageCount = usageRecords.length;

        return {
            totalDiscounts,
            activeCount,
            totalSavings,
            usageCount,
        };
    } catch (error) {
        console.error('Error fetching discount stats:', error);
        return { totalDiscounts: 0, activeCount: 0, totalSavings: 0, usageCount: 0 };
    }
}
