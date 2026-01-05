/**
 * Purchase Order Service Layer
 * CRUD operations for POs and GRNs
 */

import { supabase } from './supabase';

// ===========================================
// TYPES
// ===========================================
export type POStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
    id?: string;
    po_id?: string;
    variant_id?: string;
    description: string;
    hsn_code?: string;
    quantity_ordered: number;
    quantity_received: number;
    unit: string;
    unit_price: number;
    gst_rate: number;
    gst_amount: number;
    total_price: number;
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

export interface PurchaseOrder {
    id?: string;
    po_number?: string;
    vendor_id?: string;
    status: POStatus;
    order_date: string;
    expected_date?: string;
    received_date?: string;
    subtotal: number;
    gst_amount: number;
    shipping_cost: number;
    discount_amount: number;
    total: number;
    shipping_address?: string;
    notes?: string;
    items: PurchaseOrderItem[];
    vendor?: {
        id: string;
        name: string;
        phone?: string;
        email?: string;
    };
    created_at?: string;
    updated_at?: string;
}

export interface GRNItem {
    id?: string;
    grn_id?: string;
    po_item_id?: string;
    variant_id?: string;
    quantity_received: number;
    quantity_rejected: number;
    rejection_reason?: string;
}

export interface GoodsReceivedNote {
    id?: string;
    grn_number?: string;
    po_id?: string;
    vendor_id?: string;
    received_date: string;
    received_by?: string;
    notes?: string;
    items: GRNItem[];
    created_at?: string;
}

// ===========================================
// PURCHASE ORDER CRUD
// ===========================================

export async function createPurchaseOrder(
    po: Omit<PurchaseOrder, 'id' | 'po_number' | 'created_at' | 'updated_at'>
): Promise<PurchaseOrder> {
    // Generate PO number
    const { data: poNumber, error: numError } = await supabase.rpc('generate_po_number');

    if (numError) {
        console.error('Error generating PO number:', numError);
        throw numError;
    }

    // Calculate totals
    const subtotal = po.items.reduce((sum, item) => sum + item.total_price, 0);
    const gstAmount = po.items.reduce((sum, item) => sum + item.gst_amount, 0);
    const total = subtotal + gstAmount + (po.shipping_cost || 0) - (po.discount_amount || 0);

    // Insert PO
    const { data: poData, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
            po_number: poNumber,
            vendor_id: po.vendor_id,
            status: po.status,
            order_date: po.order_date,
            expected_date: po.expected_date,
            subtotal,
            gst_amount: gstAmount,
            shipping_cost: po.shipping_cost || 0,
            discount_amount: po.discount_amount || 0,
            total,
            shipping_address: po.shipping_address,
            notes: po.notes,
        })
        .select()
        .single();

    if (poError) {
        console.error('Error creating PO:', poError);
        throw poError;
    }

    // Insert PO items
    const itemsWithPOId = po.items.map(item => ({
        po_id: poData.id,
        variant_id: item.variant_id,
        description: item.description,
        hsn_code: item.hsn_code || '7113',
        quantity_ordered: item.quantity_ordered,
        quantity_received: 0,
        unit: item.unit || 'PCS',
        unit_price: item.unit_price,
        gst_rate: item.gst_rate,
        gst_amount: item.gst_amount,
        total_price: item.total_price,
    }));

    const { error: itemsError } = await supabase
        .from('purchase_order_items')
        .insert(itemsWithPOId);

    if (itemsError) {
        console.error('Error creating PO items:', itemsError);
        // Cleanup PO
        await supabase.from('purchase_orders').delete().eq('id', poData.id);
        throw itemsError;
    }

    return {
        ...poData,
        items: itemsWithPOId,
    };
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
    const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
            *,
            vendor:vendors(id, name, phone, email, address),
            items:purchase_order_items(
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
        console.error('Error fetching PO:', error);
        return null;
    }

    return data as unknown as PurchaseOrder;
}

export async function getPurchaseOrders(filters?: {
    status?: POStatus;
    vendorId?: string;
    startDate?: string;
    endDate?: string;
}): Promise<PurchaseOrder[]> {
    let query = supabase
        .from('purchase_orders')
        .select(`
            *,
            vendor:vendors(id, name, phone),
            items:purchase_order_items(id, quantity_ordered, quantity_received)
        `)
        .order('order_date', { ascending: false });

    if (filters?.status) {
        query = query.eq('status', filters.status);
    }
    if (filters?.vendorId) {
        query = query.eq('vendor_id', filters.vendorId);
    }
    if (filters?.startDate) {
        query = query.gte('order_date', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('order_date', filters.endDate);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching POs:', error);
        return [];
    }

    return data as unknown as PurchaseOrder[];
}

export async function updatePOStatus(id: string, status: POStatus): Promise<void> {
    const { error } = await supabase
        .from('purchase_orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
}

export async function cancelPurchaseOrder(id: string): Promise<void> {
    await updatePOStatus(id, 'cancelled');
}

// ===========================================
// GOODS RECEIVED NOTE (GRN)
// ===========================================

export async function createGRN(grn: Omit<GoodsReceivedNote, 'id' | 'grn_number' | 'created_at'>): Promise<GoodsReceivedNote> {
    // Generate GRN number
    const { data: grnNumber, error: numError } = await supabase.rpc('generate_grn_number');

    if (numError) {
        console.error('Error generating GRN number:', numError);
        throw numError;
    }

    // Insert GRN
    const { data: grnData, error: grnError } = await supabase
        .from('goods_received_notes')
        .insert({
            grn_number: grnNumber,
            po_id: grn.po_id,
            vendor_id: grn.vendor_id,
            received_date: grn.received_date,
            received_by: grn.received_by,
            notes: grn.notes,
        })
        .select()
        .single();

    if (grnError) {
        console.error('Error creating GRN:', grnError);
        throw grnError;
    }

    // Insert GRN items (triggers will handle stock updates)
    const itemsWithGRNId = grn.items
        .filter(item => item.quantity_received > 0)
        .map(item => ({
            grn_id: grnData.id,
            po_item_id: item.po_item_id,
            variant_id: item.variant_id,
            quantity_received: item.quantity_received,
            quantity_rejected: item.quantity_rejected || 0,
            rejection_reason: item.rejection_reason,
        }));

    if (itemsWithGRNId.length > 0) {
        const { error: itemsError } = await supabase
            .from('grn_items')
            .insert(itemsWithGRNId);

        if (itemsError) {
            console.error('Error creating GRN items:', itemsError);
            // Cleanup GRN
            await supabase.from('goods_received_notes').delete().eq('id', grnData.id);
            throw itemsError;
        }
    }

    return {
        ...grnData,
        items: itemsWithGRNId,
    };
}

export async function getGRNsForPO(poId: string): Promise<GoodsReceivedNote[]> {
    const { data, error } = await supabase
        .from('goods_received_notes')
        .select(`
            *,
            items:grn_items(*)
        `)
        .eq('po_id', poId)
        .order('received_date', { ascending: false });

    if (error) {
        console.error('Error fetching GRNs:', error);
        return [];
    }

    return data as unknown as GoodsReceivedNote[];
}

// ===========================================
// CALCULATION HELPERS
// ===========================================

export function calculatePOItemTotals(
    quantity: number,
    unitPrice: number,
    gstRate: number = 3
): { taxableAmount: number; gstAmount: number; totalPrice: number } {
    const taxableAmount = quantity * unitPrice;
    const gstAmount = Math.round((taxableAmount * gstRate / 100) * 100) / 100;
    const totalPrice = Math.round((taxableAmount + gstAmount) * 100) / 100;

    return { taxableAmount, gstAmount, totalPrice };
}

export function calculatePOTotals(items: PurchaseOrderItem[], shipping: number = 0, discount: number = 0): {
    subtotal: number;
    gstAmount: number;
    total: number;
} {
    const subtotal = items.reduce((sum, item) => sum + (item.quantity_ordered * item.unit_price), 0);
    const gstAmount = items.reduce((sum, item) => sum + item.gst_amount, 0);
    const total = Math.round((subtotal + gstAmount + shipping - discount) * 100) / 100;

    return { subtotal, gstAmount, total };
}
