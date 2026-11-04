/**
 * Vendor Service Layer
 * CRUD operations for vendor management using PocketBase
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

/** `&& account_email = "…"` for tenant-scoped reads under a superuser client. */
function tenantClause(): string {
    const tenant = accountScopeEmail();
    return tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
}

// ===========================================
// TYPES
// ===========================================
export interface Vendor {
    id: string;
    name: string;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    gstin?: string;
    pan?: string;
    payment_terms?: string;
    notes?: string;
    account_email?: string;
    created: string;
    updated: string;
}

export interface VendorProduct {
    id: string;
    vendor: string; // Relation
    variant: string; // Relation
    vendor_sku: string | null;
    vendor_price: number | null;
    lead_time_days: number;
    // Expanded
    expand?: {
        variant?: {
            id: string;
            variant_name: string;
            sku_suffix: string;
            product: string; // ID
            expand?: {
                product?: {
                    id: string;
                    name: string;
                    sku: string;
                }
            }
        };
        vendor?: {
            id: string;
            name: string;
            phone: string;
            email: string;
        };
    };
}

export interface VendorWithProducts extends Vendor {
    vendor_products: VendorProduct[];
}

// ===========================================
// VENDOR CRUD
// ===========================================

export async function getVendors(): Promise<Vendor[]> {
    try {
        const records = await pb.collection('vendors').getFullList<Vendor>({
            filter: `id != ""${tenantClause()}`,
            sort: 'name'
        });
        return records;
    } catch (error) {
        console.error('Error fetching vendors:', error);
        return [];
    }
}

export async function getVendor(id: string): Promise<VendorWithProducts | null> {
    try {
        const vendor = await pb.collection('vendors').getOne<Vendor>(id);
        const tenant = accountScopeEmail();
        if (tenant && vendor.account_email && vendor.account_email !== tenant) return null;

        // Fetch products manually as reverse expand implies list
        const products = await getVendorsForProductByVendor(id);

        return {
            ...vendor,
            vendor_products: products
        };
    } catch (error) {
        console.error('Error fetching vendor:', error);
        return null;
    }
}

export async function createVendor(vendor: Omit<Vendor, 'id' | 'created' | 'updated'>): Promise<Vendor> {
    try {
        const accountEmail = accountScopeEmail();
        const record = await pb.collection('vendors').create({
            ...vendor,
            account_email: accountEmail,
        });
        return record as unknown as Vendor;
    } catch (error) {
        console.error('Error creating vendor:', error);
        throw error;
    }
}

export async function updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor> {
    try {
        const record = await pb.collection('vendors').update(id, updates);
        return record as unknown as Vendor;
    } catch (error) {
        console.error('Error updating vendor:', error);
        throw error;
    }
}

export async function deleteVendor(id: string): Promise<void> {
    try {
        const tenant = accountScopeEmail();
        const tenantFilter = tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
        const pos = await pb.collection('purchase_orders').getList(1, 1, {
            filter: `vendor="${sanitizeFilter(id)}"${tenantFilter}`,
        });
        if (pos.totalItems > 0) {
            throw new Error('Cannot delete vendor with existing purchase orders. Archive or deactivate instead.');
        }
        // Clean up vendor product mappings
        const mappings = await pb.collection('vendor_products').getFullList({
            filter: `vendor="${sanitizeFilter(id)}"${tenantFilter}`,
        });
        for (const mapping of mappings) {
            await pb.collection('vendor_products').delete(mapping.id).catch(() => {});
        }
        await pb.collection('vendors').delete(id);
    } catch (error) {
        console.error('Error deleting vendor:', error);
        throw error;
    }
}

// ===========================================
// VENDOR PRODUCT MAPPING
// ===========================================

export async function addVendorProduct(mapping: {
    vendor_id: string;
    variant_id: string;
    vendor_sku?: string;
    vendor_price?: number;
    lead_time_days?: number;
}): Promise<VendorProduct> {
    try {
        const record = await pb.collection('vendor_products').create({
            account_email: accountScopeEmail(),
            vendor: mapping.vendor_id,
            variant: mapping.variant_id,
            vendor_sku: mapping.vendor_sku,
            vendor_price: mapping.vendor_price,
            lead_time_days: mapping.lead_time_days || 7
        });
        return record as unknown as VendorProduct;
    } catch (error) {
        console.error('Error adding vendor product:', error);
        throw error;
    }
}

export async function updateVendorProduct(
    id: string,
    updates: Partial<Pick<VendorProduct, 'vendor_sku' | 'vendor_price' | 'lead_time_days'>>
): Promise<VendorProduct> {
    try {
        const record = await pb.collection('vendor_products').update(id, updates);
        return record as unknown as VendorProduct;
    } catch (error) {
        console.error('Error updating vendor product:', error);
        throw error;
    }
}

export async function removeVendorProduct(id: string): Promise<void> {
    try {
        await pb.collection('vendor_products').delete(id);
    } catch (error) {
        console.error('Error removing vendor product:', error);
        throw error;
    }
}

export async function getVendorsForProduct(variantId: string): Promise<VendorProduct[]> {
    try {
        const records = await pb.collection('vendor_products').getFullList<VendorProduct>({
            filter: `variant="${sanitizeFilter(variantId)}"${tenantClause()}`,
            expand: 'vendor'
        });
        return records;
    } catch (error) {
        console.error('Error fetching vendors for product:', error);
        return [];
    }
}

async function getVendorsForProductByVendor(vendorId: string): Promise<VendorProduct[]> {
    try {
        const records = await pb.collection('vendor_products').getFullList<VendorProduct>({
            filter: `vendor="${sanitizeFilter(vendorId)}"${tenantClause()}`,
            expand: 'variant.product'
        });
        return records;
    } catch {
        return [];
    }
}

// ===========================================
// SEARCH & STATS
// ===========================================

export async function searchVendors(query: string): Promise<Vendor[]> {
    try {
        const term = sanitizeFilter((query || '').trim());
        const records = await pb.collection('vendors').getList<Vendor>(1, 20, {
            filter: `(name~"${term}" || contact_name~"${term}" || phone~"${term}")${tenantClause()}`,
            sort: 'name'
        });
        return records.items;
    } catch (error) {
        console.error('Error searching vendors:', error);
        return [];
    }
}

export async function getVendorStats(id: string): Promise<{
    productCount: number;
    totalPurchases: number;
    lastPurchase: string | null;
}> {
    try {
        const productsResult = await pb.collection('vendor_products').getList(1, 1, {
            filter: `vendor="${sanitizeFilter(id)}"${tenantClause()}`
        });

        // Use purchase orders
        const purchaseStats = await pb.collection('purchase_orders').getFullList({
            filter: `vendor="${sanitizeFilter(id)}" && status != "cancelled"${tenantClause()}`,
            fields: 'total,order_date'
        });

        const totalPurchases = purchaseStats.reduce((sum, order) => sum + (order.total || 0), 0);
        const dates = purchaseStats.map(p => new Date(p.order_date).getTime());
        const lastPurchase = dates.length > 0
            ? new Date(Math.max(...dates)).toISOString()
            : null;

        return {
            productCount: productsResult.totalItems,
            totalPurchases,
            lastPurchase
        };
    } catch {
        return {
            productCount: 0,
            totalPurchases: 0,
            lastPurchase: null
        };
    }
}

/** Match a vendor by the last ten digits of a phone number. */
export async function findVendorByPhone(digits: string) {
    if (!digits) return null;
    try {
        const vendor = await pb.collection('vendors').getFirstListItem(
            `phone~"${sanitizeFilter(digits)}"${tenantClause()}`
        );
        return { id: vendor.id, name: vendor.name || '' };
    } catch {
        return null;
    }
}