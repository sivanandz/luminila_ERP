/**
 * Discounts & Offers Service
 * Coupon validation, discount calculations, and management using PocketBase
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

/**
 * `&& account_email = "…"` for tenant-scoped reads (POS-22).
 *
 * Fails closed: with no resolved tenant the clause matches nothing rather than
 * dropping the scope and returning every store's coupons (SET-3).
 */
function tenantClause(): string {
    const tenant = accountScopeEmail();
    return tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : ' && id = ""';
}

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

/**
 * Raw discounts record as stored in PocketBase, including the legacy column
 * names (type, min_order_value, max_uses, valid_from, valid_until) that the
 * service layer keeps in sync with the canonical Discount fields.
 */
interface DiscountRecord {
    id: string;
    code: string;
    name?: string;
    description?: string;
    discount_type?: DiscountType;
    type?: DiscountType;
    value?: number;
    max_discount?: number;
    min_purchase?: number;
    min_order_value?: number;
    min_items?: number;
    applies_to?: AppliesTo;
    applies_to_ids?: string[];
    usage_limit?: number;
    max_uses?: number;
    per_customer_limit?: number;
    used_count?: number;
    start_date?: string;
    valid_from?: string;
    end_date?: string;
    valid_until?: string;
    is_active?: boolean;
    created?: string;
}

/**
 * Update payload accepted by the discounts collection: canonical Discount
 * fields plus the legacy aliases written alongside them.
 */
type DiscountUpdatePayload = {
    [key: string]: string | number | boolean | string[] | undefined;
    code?: string;
    name?: string;
    description?: string;
    discount_type?: DiscountType;
    type?: DiscountType;
    value?: number;
    max_discount?: number;
    min_purchase?: number;
    min_order_value?: number;
    min_items?: number;
    applies_to?: AppliesTo;
    applies_to_ids?: string[];
    usage_limit?: number;
    max_uses?: number;
    per_customer_limit?: number;
    used_count?: number;
    start_date?: string;
    valid_from?: string;
    end_date?: string;
    valid_until?: string;
    is_active?: boolean;
};

// ===========================================
// DISCOUNT CRUD
// ===========================================

function mapDiscountRecord(d: DiscountRecord): Discount {
    return {
        id: d.id,
        code: d.code,
        name: d.name || '',
        description: d.description || '',
        discount_type: d.discount_type || d.type || 'percentage',
        value: d.value || 0,
        max_discount: d.max_discount,
        min_purchase: d.min_purchase ?? d.min_order_value ?? 0,
        min_items: d.min_items || 0,
        applies_to: d.applies_to || 'all',
        applies_to_ids: d.applies_to_ids,
        usage_limit: d.usage_limit ?? d.max_uses,
        per_customer_limit: d.per_customer_limit || 1,
        used_count: d.used_count || 0,
        start_date: d.start_date || d.valid_from,
        end_date: d.end_date || d.valid_until,
        is_active: d.is_active ?? true,
        created_at: d.created,
    };
}

export async function getDiscounts(activeOnly: boolean = false): Promise<Discount[]> {
    try {
        const filter = `${activeOnly ? 'is_active=true' : 'id != ""'}${tenantClause()}`;
        const records = await pb.collection('discounts').getFullList<DiscountRecord>({
            filter,
            sort: '-created',
        });

        return records.map(mapDiscountRecord);
    } catch (error) {
        console.error('Error fetching discounts:', error);
        return [];
    }
}

export async function getDiscount(id: string): Promise<Discount | null> {
    try {
        const d = await pb.collection('discounts').getOne<DiscountRecord & { account_email?: string }>(id);
        const tenant = accountScopeEmail();
        // Fail closed: no resolved tenant means no coupon is readable.
        if (!tenant) return null;
        const owner = d.account_email;
        if (owner && owner !== tenant) return null;
        return mapDiscountRecord(d);
    } catch {
        return null;
    }
}

/**
 * Fetch a discount by id and refuse it unless the resolved tenant owns it.
 * Every mutator used to write by bare id, so a coupon id from another store
 * could be edited, disabled or deleted (SET-8).
 */
async function requireOwnedDiscount(id: string): Promise<DiscountRecord & { account_email?: string }> {
    const tenant = accountScopeEmail();
    if (!tenant) throw new Error('No tenant account resolved; discount changes are unavailable.');
    const d = await pb
        .collection('discounts')
        .getOne<DiscountRecord & { account_email?: string }>(id);
    if (d.account_email && d.account_email !== tenant) {
        throw new Error('Discount does not belong to this store.');
    }
    return d;
}

export async function getDiscountByCode(code: string): Promise<Discount | null> {
    try {
        const d = await pb.collection('discounts').getFirstListItem<DiscountRecord>(
            `code="${sanitizeFilter(code.toUpperCase())}"${tenantClause()}`
        );
        return mapDiscountRecord(d);
    } catch {
        return null;
    }
}

export async function createDiscount(discount: Omit<Discount, 'id' | 'used_count' | 'created_at'>): Promise<Discount> {
    const d = await pb.collection('discounts').create<DiscountRecord>({
        account_email: accountScopeEmail(),
        code: discount.code.toUpperCase(),
        name: discount.name,
        description: discount.description || '',
        type: discount.discount_type,
        discount_type: discount.discount_type,
        value: discount.value,
        max_discount: discount.max_discount,
        min_order_value: discount.min_purchase,
        min_purchase: discount.min_purchase,
        min_items: discount.min_items,
        applies_to: discount.applies_to,
        applies_to_ids: discount.applies_to_ids,
        max_uses: discount.usage_limit,
        usage_limit: discount.usage_limit,
        per_customer_limit: discount.per_customer_limit,
        used_count: 0,
        valid_from: discount.start_date || '',
        start_date: discount.start_date || '',
        valid_until: discount.end_date || '',
        end_date: discount.end_date || '',
        is_active: discount.is_active,
    });

    return mapDiscountRecord(d);
}

export async function updateDiscount(id: string, updates: Partial<Discount>): Promise<Discount> {
    await requireOwnedDiscount(id);
    const cleanUpdates: DiscountUpdatePayload = { ...updates };
    if (cleanUpdates.code) {
        cleanUpdates.code = cleanUpdates.code.toUpperCase();
    }
    if (cleanUpdates.discount_type !== undefined) {
        cleanUpdates.type = cleanUpdates.discount_type;
    } else if (cleanUpdates.type !== undefined) {
        cleanUpdates.discount_type = cleanUpdates.type;
    }
    if (cleanUpdates.min_purchase !== undefined) {
        cleanUpdates.min_order_value = cleanUpdates.min_purchase;
    } else if (cleanUpdates.min_order_value !== undefined) {
        cleanUpdates.min_purchase = cleanUpdates.min_order_value;
    }
    if (cleanUpdates.usage_limit !== undefined) {
        cleanUpdates.max_uses = cleanUpdates.usage_limit;
    } else if (cleanUpdates.max_uses !== undefined) {
        cleanUpdates.usage_limit = cleanUpdates.max_uses;
    }
    if (cleanUpdates.start_date !== undefined) {
        cleanUpdates.valid_from = cleanUpdates.start_date;
    } else if (cleanUpdates.valid_from !== undefined) {
        cleanUpdates.start_date = cleanUpdates.valid_from;
    }
    if (cleanUpdates.end_date !== undefined) {
        cleanUpdates.valid_until = cleanUpdates.end_date;
    } else if (cleanUpdates.valid_until !== undefined) {
        cleanUpdates.end_date = cleanUpdates.valid_until;
    }

    const d = await pb.collection('discounts').update<DiscountRecord>(id, cleanUpdates);
    return mapDiscountRecord(d);
}

export async function deleteDiscount(id: string): Promise<void> {
    await requireOwnedDiscount(id);
    await pb.collection('discounts').delete(id);
}

export async function toggleDiscountActive(id: string, isActive: boolean): Promise<void> {
    await requireOwnedDiscount(id);
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
                filter: `discount="${sanitizeFilter(discount.id || '')}" && customer="${sanitizeFilter(customerId || '')}"${tenantClause()}`,
            });

            if (usages.length >= discount.per_customer_limit) {
                return { valid: false, error: 'You have already used this discount', discountAmount: 0 };
            }
        } catch (error) {
            // Fail closed: an unreadable usage table must not turn the
            // per-customer cap into "unlimited" (SET-10).
            console.warn('Discount usage check failed; refusing the discount:', error);
            return {
                valid: false,
                error: 'Could not verify the discount usage limit. Please try again.',
                discountAmount: 0,
            };
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
    } else if (discount.discount_type === 'buy_x_get_y') {
        // No buy/get parameters exist on the record, so this used to return a
        // valid discount of zero. Say so instead of silently doing nothing.
        return { valid: false, error: 'Buy X Get Y discounts are not supported', discountAmount: 0 };
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
        orderId?: string;
    }
): Promise<void> {
    const discount = await pb.collection('discounts').getOne<DiscountRecord>(discountId);
    const tenant = accountScopeEmail();
    // Fail closed: an unresolved tenant must not redeem (or stamp) a coupon.
    if (!tenant) throw new Error('No tenant account resolved; discounts are unavailable.');
    const owner = (discount as DiscountRecord & { account_email?: string }).account_email;
    if (owner && owner !== tenant) {
        throw new Error('Discount does not belong to this store.');
    }

    // Reserve the slot first: a check followed by an increment lets two
    // concurrent checkouts both pass the limit.
    const reserved = await pb.collection('discounts').update<DiscountRecord>(discountId, {
        'used_count+': 1,
    });
    if (discount.usage_limit && (reserved.used_count || 0) > discount.usage_limit) {
        await pb.collection('discounts').update(discountId, { 'used_count+': -1 }).catch(() => {});
        throw new Error('This discount has reached its usage limit');
    }

    const payload: Record<string, unknown> = {
        account_email: tenant,
        discount: discountId,
        discount_amount: discountAmount,
        amount_saved: discountAmount,
        order_value: orderValue,
    };
    if (options?.customerId) payload.customer = options.customerId;
    if (options?.orderId) payload.order = options.orderId;
    if (options?.saleId) payload.sale = options.saleId;
    if (options?.invoiceId) payload.invoice = options.invoiceId;

    let usageId = '';
    try {
        const usage = await pb.collection('discount_usage').create(payload);
        usageId = usage.id;
    } catch (error) {
        await pb.collection('discounts').update(discountId, { 'used_count+': -1 }).catch(() => {});
        throw error;
    }

    // The per-customer cap has the same race; count after writing and undo the
    // extra use rather than trusting the pre-check.
    if (options?.customerId && (discount.per_customer_limit || 0) > 0) {
        const usages = await pb.collection('discount_usage').getFullList({
            filter: `discount="${sanitizeFilter(discountId)}" && customer="${sanitizeFilter(options.customerId)}"${tenantClause()}`,
        });
        if (usages.length > (discount.per_customer_limit || 0)) {
            await pb.collection('discount_usage').delete(usageId).catch(() => {});
            await pb.collection('discounts').update(discountId, { 'used_count+': -1 }).catch(() => {});
            throw new Error('You have already used this discount');
        }
    }
}

/**
 * Return a discount use to the pool when the order it was applied to comes
 * back. Without this, a returned sale permanently burns the coupon.
 *
 * Each row is handled on its own: one failure must not silently burn the rest
 * (or leave the count decremented for a row that still exists). Every failure
 * is reported to the caller once the loop is done (SET-11).
 */
export async function reverseDiscountUsage(options: {
    saleId?: string;
    orderId?: string;
    invoiceId?: string;
}): Promise<number> {
    const filters: string[] = [];
    if (options.saleId) filters.push(`sale="${sanitizeFilter(options.saleId)}"`);
    if (options.orderId) filters.push(`order="${sanitizeFilter(options.orderId)}"`);
    if (options.invoiceId) filters.push(`invoice="${sanitizeFilter(options.invoiceId)}"`);
    if (filters.length === 0) return 0;

    const usages = await pb.collection('discount_usage').getFullList<{
        id: string;
        discount: string;
        account_email?: string;
        order?: string;
        customer?: string;
        sale?: string;
        invoice?: string;
        discount_amount?: number;
        amount_saved?: number;
        order_value?: number;
    }>({
        filter: `(${filters.join(' || ')})${tenantClause()}`,
    });

    const tenant = accountScopeEmail();
    const failures: string[] = [];
    let reversed = 0;

    for (const usage of usages) {
        const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
        try {
            await pb.collection('discount_usage').delete(usage.id);
        } catch (error) {
            failures.push(`usage ${usage.id} could not be removed: ${message(error)}`);
            continue;
        }
        try {
            await pb.collection('discounts').update(usage.discount, { 'used_count+': -1 });
            reversed += 1;
        } catch (error) {
            failures.push(
                `usage ${usage.id} removed but discount ${usage.discount} used_count was not decremented: ${message(error)}`
            );
            // Put the usage row back so the trail still explains the burned
            // use and a later retry can finish the reversal.
            try {
                const restored: Record<string, unknown> = {
                    discount: usage.discount,
                    account_email: usage.account_email || tenant,
                };
                if (usage.order) restored.order = usage.order;
                if (usage.customer) restored.customer = usage.customer;
                if (usage.sale) restored.sale = usage.sale;
                if (usage.invoice) restored.invoice = usage.invoice;
                if (typeof usage.discount_amount === 'number') restored.discount_amount = usage.discount_amount;
                if (typeof usage.amount_saved === 'number') restored.amount_saved = usage.amount_saved;
                if (typeof usage.order_value === 'number') restored.order_value = usage.order_value;
                await pb.collection('discount_usage').create(restored);
            } catch (restoreError) {
                failures.push(
                    `usage ${usage.id} could not be re-created after the failed decrement: ${message(restoreError)}`
                );
            }
        }
    }

    if (failures.length > 0) {
        console.error('[discounts] discount usage reversal incomplete:', failures);
        throw new Error(`Discount usage reversal incomplete: ${failures.join('; ')}`);
    }

    return reversed;
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
        const allDiscounts = await pb.collection('discounts').getFullList<DiscountRecord>({
            filter: `id != ""${tenantClause()}`,
        });
        const totalDiscounts = allDiscounts.length;
        const activeCount = allDiscounts.filter((d) => d.is_active).length;

        const usageRecords = await pb.collection('discount_usage').getFullList({
            filter: `id != ""${tenantClause()}`,
        });
        const totalSavings = usageRecords.reduce((sum: number, u) => sum + (u.discount_amount || u.amount_saved || 0), 0);
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
