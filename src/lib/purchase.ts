/**
 * Purchase Order Service Layer
 * CRUD operations for POs and GRNs using PocketBase
 */

import { pb } from './pocketbase';

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
        product?: {
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
// NUMBER GENERATION
// ===========================================
async function generatePONumber(): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const seqName = `po_${yymm}`;

    try {
        let seq = await pb.collection('number_sequences').getFirstListItem(`name="${seqName}"`).catch(() => null);

        let nextValue: number;
        if (seq) {
            nextValue = (seq.current_value || 0) + 1;
            await pb.collection('number_sequences').update(seq.id, { current_value: nextValue });
        } else {
            nextValue = 1;
            await pb.collection('number_sequences').create({
                name: seqName,
                prefix: 'PO',
                current_value: nextValue,
                padding: 4,
            });
        }

        return `PO/${yymm}/${nextValue.toString().padStart(4, '0')}`;
    } catch (error) {
        console.error('Error generating PO number:', error);
        return `PO/${Date.now()}`;
    }
}

async function generateGRNNumber(): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const seqName = `grn_${yymm}`;

    try {
        let seq = await pb.collection('number_sequences').getFirstListItem(`name="${seqName}"`).catch(() => null);

        let nextValue: number;
        if (seq) {
            nextValue = (seq.current_value || 0) + 1;
            await pb.collection('number_sequences').update(seq.id, { current_value: nextValue });
        } else {
            nextValue = 1;
            await pb.collection('number_sequences').create({
                name: seqName,
                prefix: 'GRN',
                current_value: nextValue,
                padding: 4,
            });
        }

        return `GRN/${yymm}/${nextValue.toString().padStart(4, '0')}`;
    } catch (error) {
        console.error('Error generating GRN number:', error);
        return `GRN/${Date.now()}`;
    }
}

// ===========================================
// PURCHASE ORDER CRUD
// ===========================================

export async function createPurchaseOrder(
    po: Omit<PurchaseOrder, 'id' | 'po_number' | 'created_at' | 'updated_at'>
): Promise<PurchaseOrder> {
    // Generate PO number
    const poNumber = await generatePONumber();

    // Calculate totals
    const subtotal = po.items.reduce((sum, item) => sum + item.total_price, 0);
    const gstAmount = po.items.reduce((sum, item) => sum + item.gst_amount, 0);
    const total = subtotal + gstAmount + (po.shipping_cost || 0) - (po.discount_amount || 0);

    // Insert PO
    const poData = await pb.collection('purchase_orders').create({
        po_number: poNumber,
        vendor: po.vendor_id || '',
        status: po.status,
        order_date: po.order_date,
        expected_date: po.expected_date || '',
        subtotal,
        gst_amount: gstAmount,
        shipping_cost: po.shipping_cost || 0,
        discount_amount: po.discount_amount || 0,
        total,
        shipping_address: po.shipping_address || '',
        notes: po.notes || '',
    });

    // Insert PO items
    const createdItems: PurchaseOrderItem[] = [];
    for (const item of po.items) {
        const itemRecord = await pb.collection('purchase_order_items').create({
            purchase_order: poData.id,
            variant: item.variant_id || '',
            description: item.description,
            hsn_code: item.hsn_code || '7113',
            quantity_ordered: item.quantity_ordered,
            quantity_received: 0,
            unit: item.unit || 'PCS',
            unit_price: item.unit_price,
            gst_rate: item.gst_rate,
            gst_amount: item.gst_amount,
            total_price: item.total_price,
        });
        createdItems.push({
            ...item,
            id: itemRecord.id,
            po_id: poData.id,
            quantity_received: 0,
        });
    }

    return {
        id: poData.id,
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
        items: createdItems,
        created_at: poData.created,
        updated_at: poData.updated,
    };
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
    try {
        const po = await pb.collection('purchase_orders').getOne(id, {
            expand: 'vendor',
        });

        const items = await pb.collection('purchase_order_items').getFullList({
            filter: `purchase_order="${id}"`,
            expand: 'variant,variant.product',
        });

        return {
            id: po.id,
            po_number: po.po_number,
            vendor_id: po.vendor,
            status: po.status,
            order_date: po.order_date,
            expected_date: po.expected_date,
            received_date: po.received_date,
            subtotal: po.subtotal,
            gst_amount: po.gst_amount,
            shipping_cost: po.shipping_cost || 0,
            discount_amount: po.discount_amount || 0,
            total: po.total,
            shipping_address: po.shipping_address,
            notes: po.notes,
            vendor: po.expand?.vendor ? {
                id: po.expand.vendor.id,
                name: po.expand.vendor.name,
                phone: po.expand.vendor.phone,
                email: po.expand.vendor.email,
            } : undefined,
            items: items.map((item: any) => ({
                id: item.id,
                po_id: item.purchase_order,
                variant_id: item.variant,
                description: item.description,
                hsn_code: item.hsn_code,
                quantity_ordered: item.quantity_ordered,
                quantity_received: item.quantity_received || 0,
                unit: item.unit,
                unit_price: item.unit_price,
                gst_rate: item.gst_rate,
                gst_amount: item.gst_amount,
                total_price: item.total_price,
                variant: item.expand?.variant ? {
                    id: item.expand.variant.id,
                    variant_name: item.expand.variant.variant_name,
                    sku_suffix: item.expand.variant.sku_suffix,
                    product: item.expand.variant.expand?.product ? {
                        id: item.expand.variant.expand.product.id,
                        name: item.expand.variant.expand.product.name,
                        sku: item.expand.variant.expand.product.sku,
                    } : undefined,
                } : undefined,
            })),
            created_at: po.created,
            updated_at: po.updated,
        };
    } catch (error) {
        console.error('Error fetching PO:', error);
        return null;
    }
}

export async function getPurchaseOrders(filters?: {
    status?: POStatus;
    vendorId?: string;
    startDate?: string;
    endDate?: string;
}): Promise<PurchaseOrder[]> {
    try {
        const filterParts: string[] = [];

        if (filters?.status) {
            filterParts.push(`status="${filters.status}"`);
        }
        if (filters?.vendorId) {
            filterParts.push(`vendor="${filters.vendorId}"`);
        }
        if (filters?.startDate) {
            filterParts.push(`order_date>="${filters.startDate}"`);
        }
        if (filters?.endDate) {
            filterParts.push(`order_date<="${filters.endDate}"`);
        }

        const pos = await pb.collection('purchase_orders').getFullList({
            filter: filterParts.join(' && ') || '',
            sort: '-order_date',
            expand: 'vendor',
        });

        // Fetch items for all POs
        const poIds = pos.map(p => p.id);
        let allItems: any[] = [];
        if (poIds.length > 0) {
            const itemFilter = poIds.map(id => `purchase_order="${id}"`).join(' || ');
            allItems = await pb.collection('purchase_order_items').getFullList({
                filter: itemFilter,
            });
        }

        // Group items by PO
        const itemsByPO = new Map<string, any[]>();
        allItems.forEach(item => {
            if (!itemsByPO.has(item.purchase_order)) {
                itemsByPO.set(item.purchase_order, []);
            }
            itemsByPO.get(item.purchase_order)!.push(item);
        });

        return pos.map((po: any) => ({
            id: po.id,
            po_number: po.po_number,
            vendor_id: po.vendor,
            status: po.status,
            order_date: po.order_date,
            expected_date: po.expected_date,
            received_date: po.received_date,
            subtotal: po.subtotal,
            gst_amount: po.gst_amount,
            shipping_cost: po.shipping_cost || 0,
            discount_amount: po.discount_amount || 0,
            total: po.total,
            shipping_address: po.shipping_address,
            notes: po.notes,
            vendor: po.expand?.vendor ? {
                id: po.expand.vendor.id,
                name: po.expand.vendor.name,
                phone: po.expand.vendor.phone,
            } : undefined,
            items: (itemsByPO.get(po.id) || []).map((item: any) => ({
                id: item.id,
                po_id: item.purchase_order,
                variant_id: item.variant,
                description: item.description || '',
                unit: item.unit || 'pcs',
                unit_price: item.unit_price || 0,
                gst_rate: item.gst_rate || 0,
                gst_amount: item.gst_amount || 0,
                total_price: item.total_price || 0,
                quantity_ordered: item.quantity_ordered,
                quantity_received: item.quantity_received || 0,
            })),
            created_at: po.created,
            updated_at: po.updated,
        }));
    } catch (error) {
        console.error('Error fetching POs:', error);
        return [];
    }
}

export async function updatePOStatus(id: string, status: POStatus): Promise<void> {
    await pb.collection('purchase_orders').update(id, { status });
}

export async function cancelPurchaseOrder(id: string): Promise<void> {
    await updatePOStatus(id, 'cancelled');
}

// ===========================================
// GOODS RECEIVED NOTE (GRN)
// ===========================================

export async function createGRN(grn: Omit<GoodsReceivedNote, 'id' | 'grn_number' | 'created_at'>): Promise<GoodsReceivedNote> {
    // Generate GRN number
    const grnNumber = await generateGRNNumber();

    // Insert GRN
    const grnData = await pb.collection('goods_received_notes').create({
        grn_number: grnNumber,
        purchase_order: grn.po_id || '',
        vendor: grn.vendor_id || '',
        received_date: grn.received_date,
        received_by: grn.received_by || '',
        notes: grn.notes || '',
    });

    // Insert GRN items and update stock
    const createdItems: GRNItem[] = [];
    for (const item of grn.items.filter(i => i.quantity_received > 0)) {
        const itemRecord = await pb.collection('grn_items').create({
            grn: grnData.id,
            po_item: item.po_item_id || '',
            variant: item.variant_id || '',
            quantity_received: item.quantity_received,
            quantity_rejected: item.quantity_rejected || 0,
            rejection_reason: item.rejection_reason || '',
        });

        // Update stock level for the variant
        if (item.variant_id) {
            try {
                const variant = await pb.collection('product_variants').getOne(item.variant_id);
                await pb.collection('product_variants').update(item.variant_id, {
                    stock_level: (variant.stock_level || 0) + item.quantity_received,
                });

                // Log stock movement
                await pb.collection('stock_movements').create({
                    variant: item.variant_id,
                    movement_type: 'purchase',
                    quantity: item.quantity_received,
                    reference_id: grnData.id,
                    source: 'grn',
                    notes: `Goods received via GRN ${grnNumber}`,
                });
            } catch (err) {
                console.error('Error updating stock for variant:', item.variant_id, err);
            }
        }

        // Update PO item received quantity
        if (item.po_item_id) {
            try {
                const poItem = await pb.collection('purchase_order_items').getOne(item.po_item_id);
                await pb.collection('purchase_order_items').update(item.po_item_id, {
                    quantity_received: (poItem.quantity_received || 0) + item.quantity_received,
                });
            } catch (err) {
                console.error('Error updating PO item:', item.po_item_id, err);
            }
        }

        createdItems.push({
            ...item,
            id: itemRecord.id,
            grn_id: grnData.id,
        });
    }

    // Update PO status based on received quantities
    if (grn.po_id) {
        try {
            const poItems = await pb.collection('purchase_order_items').getFullList({
                filter: `purchase_order="${grn.po_id}"`,
            });

            const totalOrdered = poItems.reduce((sum: number, i: any) => sum + i.quantity_ordered, 0);
            const totalReceived = poItems.reduce((sum: number, i: any) => sum + (i.quantity_received || 0), 0);

            if (totalReceived >= totalOrdered) {
                await pb.collection('purchase_orders').update(grn.po_id, {
                    status: 'received',
                    received_date: grn.received_date,
                });
            } else if (totalReceived > 0) {
                await pb.collection('purchase_orders').update(grn.po_id, {
                    status: 'partial',
                });
            }
        } catch (err) {
            console.error('Error updating PO status:', err);
        }
    }

    return {
        id: grnData.id,
        grn_number: grnNumber,
        po_id: grn.po_id,
        vendor_id: grn.vendor_id,
        received_date: grn.received_date,
        received_by: grn.received_by,
        notes: grn.notes,
        items: createdItems,
        created_at: grnData.created,
    };
}

export async function getGRNsForPO(poId: string): Promise<GoodsReceivedNote[]> {
    try {
        const grns = await pb.collection('goods_received_notes').getFullList({
            filter: `purchase_order="${poId}"`,
            sort: '-received_date',
        });

        // Fetch items for all GRNs
        const grnIds = grns.map(g => g.id);
        let allItems: any[] = [];
        if (grnIds.length > 0) {
            const itemFilter = grnIds.map(id => `grn="${id}"`).join(' || ');
            allItems = await pb.collection('grn_items').getFullList({
                filter: itemFilter,
            });
        }

        // Group items by GRN
        const itemsByGRN = new Map<string, any[]>();
        allItems.forEach(item => {
            if (!itemsByGRN.has(item.grn)) {
                itemsByGRN.set(item.grn, []);
            }
            itemsByGRN.get(item.grn)!.push(item);
        });

        return grns.map((grn: any) => ({
            id: grn.id,
            grn_number: grn.grn_number,
            po_id: grn.purchase_order,
            vendor_id: grn.vendor,
            received_date: grn.received_date,
            received_by: grn.received_by,
            notes: grn.notes,
            items: (itemsByGRN.get(grn.id) || []).map((item: any) => ({
                id: item.id,
                grn_id: item.grn,
                po_item_id: item.po_item,
                variant_id: item.variant,
                quantity_received: item.quantity_received,
                quantity_rejected: item.quantity_rejected || 0,
                rejection_reason: item.rejection_reason,
            })),
            created_at: grn.created,
        }));
    } catch (error) {
        console.error('Error fetching GRNs:', error);
        return [];
    }
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
