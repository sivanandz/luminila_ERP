/**
 * Vendor Service Layer
 * CRUD operations for vendor management
 */

import { supabase } from './supabase';

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
    created_at: string;
}

export interface VendorProduct {
    id: string;
    vendor_id: string;
    variant_id: string;
    vendor_sku: string | null;
    vendor_price: number | null;
    lead_time_days: number;
    variant?: {
        id: string;
        variant_name: string;
        sku_suffix: string;
        product: {
            id: string;
            name: string;
            sku: string;
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
    const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error fetching vendors:', error);
        return [];
    }

    return data || [];
}

export async function getVendor(id: string): Promise<VendorWithProducts | null> {
    const { data, error } = await supabase
        .from('vendors')
        .select(`
            *,
            vendor_products(
                *,
                variant:product_variants(
                    id,
                    variant_name,
                    sku_suffix,
                    product:products(id, name, sku)
                )
            )
        `)
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching vendor:', error);
        return null;
    }

    return data as unknown as VendorWithProducts;
}

export async function createVendor(vendor: Omit<Vendor, 'id' | 'created_at'>): Promise<Vendor> {
    const { data, error } = await supabase
        .from('vendors')
        .insert(vendor)
        .select()
        .single();

    if (error) {
        console.error('Error creating vendor:', error);
        throw error;
    }

    return data;
}

export async function updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor> {
    const { data, error } = await supabase
        .from('vendors')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating vendor:', error);
        throw error;
    }

    return data;
}

export async function deleteVendor(id: string): Promise<void> {
    const { error } = await supabase
        .from('vendors')
        .delete()
        .eq('id', id);

    if (error) {
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
    const { data, error } = await supabase
        .from('vendor_products')
        .insert({
            vendor_id: mapping.vendor_id,
            variant_id: mapping.variant_id,
            vendor_sku: mapping.vendor_sku || null,
            vendor_price: mapping.vendor_price || null,
            lead_time_days: mapping.lead_time_days || 7,
        })
        .select()
        .single();

    if (error) {
        console.error('Error adding vendor product:', error);
        throw error;
    }

    return data;
}

export async function updateVendorProduct(
    id: string,
    updates: Partial<Pick<VendorProduct, 'vendor_sku' | 'vendor_price' | 'lead_time_days'>>
): Promise<VendorProduct> {
    const { data, error } = await supabase
        .from('vendor_products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating vendor product:', error);
        throw error;
    }

    return data;
}

export async function removeVendorProduct(id: string): Promise<void> {
    const { error } = await supabase
        .from('vendor_products')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error removing vendor product:', error);
        throw error;
    }
}

export async function getVendorsForProduct(variantId: string): Promise<VendorProduct[]> {
    const { data, error } = await supabase
        .from('vendor_products')
        .select(`
            *,
            vendor:vendors(id, name, phone, email)
        `)
        .eq('variant_id', variantId);

    if (error) {
        console.error('Error fetching vendors for product:', error);
        return [];
    }

    return data || [];
}

// ===========================================
// SEARCH & STATS
// ===========================================

export async function searchVendors(query: string): Promise<Vendor[]> {
    const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .or(`name.ilike.%${query}%,contact_name.ilike.%${query}%,phone.ilike.%${query}%`)
        .order('name')
        .limit(20);

    if (error) {
        console.error('Error searching vendors:', error);
        return [];
    }

    return data || [];
}

export async function getVendorStats(id: string): Promise<{
    productCount: number;
    totalPurchases: number;
    lastPurchase: string | null;
}> {
    // Count linked products
    const { count: productCount } = await supabase
        .from('vendor_products')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', id);

    // TODO: Count purchases when purchase_orders table is implemented

    return {
        productCount: productCount || 0,
        totalPurchases: 0,
        lastPurchase: null,
    };
}
