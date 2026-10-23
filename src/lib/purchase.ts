/**
 * Purchase Order Service Layer
 * CRUD operations for POs and GRNs using PocketBase
 */

import { pb } from './pocketbase';
import { getNextSequenceNumber, createWithUniqueRetry } from './sequence-generator';
import { normalizeDateBounds } from './utils';
import type { PBRecord, Product, Vendor } from '@/types/database';

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

export type POType = 'itemized' | 'blanket';
export type DiscrepancyStatus = 'balanced' | 'over_budget' | 'under_budget';
export type ApprovalStatus = 'none' | 'pending_approval' | 'approved';

export interface PurchaseOrder {
    id?: string;
    po_number?: string;
    po_type?: POType;
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
    // Value-based / Blanket PO & Landed Cost tracking
    budget_amount?: number;
    inward_goods_cost?: number;
    gst_paid_overhead?: number;
    shipping_overhead?: number;
    absorb_overhead?: boolean;
    is_unregistered_seller?: boolean;
    discrepancy_amount?: number;
    discrepancy_status?: DiscrepancyStatus;
    approval_status?: ApprovalStatus;
    approval_remarks?: string;
    approved_by?: string;
    approved_at?: string;
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
    variant?: {
        id: string;
        variant_name: string;
        sku_suffix?: string;
        stock_level?: number;
        product?: {
            id: string;
            name: string;
            sku: string;
        };
    };
    po_item?: {
        id: string;
        description: string;
        unit_price?: number;
    };
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
// POCKETBASE RECORD TYPES
// ===========================================

/** purchase_orders record as returned by PocketBase */
interface PORecord extends PBRecord {
    po_number?: string;
    vendor: string;
    status: POStatus;
    order_date: string;
    expected_date?: string;
    received_date?: string;
    subtotal: number;
    gst_amount: number;
    shipping_cost?: number;
    discount_amount?: number;
    total: number;
    shipping_address?: string;
    notes?: string;
    expand?: {
        vendor?: Vendor;
    };
}

/** purchase_order_items record as returned by PocketBase */
interface POItemRecord extends PBRecord {
    po?: string;
    purchase_order?: string;
    variant?: string;
    description: string;
    hsn_code?: string;
    quantity_ordered: number;
    quantity_received?: number;
    unit: string;
    unit_price: number;
    gst_rate: number;
    gst_amount: number;
    total_price: number;
    expand?: {
        variant?: {
            id: string;
            variant_name: string;
            sku_suffix: string;
            expand?: {
                product?: Product;
            };
        };
    };
}

/** goods_received_notes record as returned by PocketBase */
interface GRNRecord extends PBRecord {
    grn_number?: string;
    po?: string;
    purchase_order?: string;
    vendor: string;
    received_date: string;
    received_by?: string;
    notes?: string;
}

/** grn_items record as returned by PocketBase */
interface GRNItemRecord extends PBRecord {
    grn: string;
    po_item?: string;
    variant?: string;
    quantity_received: number;
    quantity_rejected?: number;
    rejection_reason?: string;
}

// ===========================================
// NUMBER GENERATION
// ===========================================

export function extractVendorCode(vendorName?: string): string {
    if (!vendorName?.trim()) return 'GEN';
    const clean = vendorName.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (clean.length >= 3) {
        return clean.substring(0, 4);
    }
    return (clean + 'GEN').substring(0, 3);
}

export function generateTimestampPONumber(vendorNameOrCode?: string, date = new Date()): string {
    const yyyy = date.getFullYear().toString();
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const dd = date.getDate().toString().padStart(2, '0');
    const hh = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    const ss = date.getSeconds().toString().padStart(2, '0');

    const dateStr = `${yyyy}${mm}${dd}`;
    const timeStr = `${hh}${min}${ss}`;
    const vendorCode = extractVendorCode(vendorNameOrCode);

    return `PO-${vendorCode}-${dateStr}-${timeStr}`;
}

export async function generatePONumber(vendorNameOrCode?: string): Promise<string> {
    return generateTimestampPONumber(vendorNameOrCode, new Date());
}

export async function generateGRNNumber(): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const seqName = `grn_${yymm}`;

    return getNextSequenceNumber({
        seqName,
        prefix: 'GRN',
        padding: 4,
        formatFn: (nextValue) => `GRN/${yymm}/${nextValue.toString().padStart(4, '0')}`,
    });
}

// ===========================================
// PURCHASE ORDER CRUD & METADATA ENCODING
// ===========================================

const META_TAG_START = '<!--LUMINILA_PO_META:';
const META_TAG_END = '-->';

export function encodePOMetadata(po: Partial<PurchaseOrder>, userNotes: string = ''): string {
    const meta: Record<string, any> = {
        po_type: po.po_type || (po.budget_amount ? 'blanket' : 'itemized'),
        budget_amount: po.budget_amount,
        inward_goods_cost: po.inward_goods_cost || 0,
        gst_paid_overhead: po.gst_paid_overhead || 0,
        shipping_overhead: po.shipping_overhead || 0,
        absorb_overhead: Boolean(po.absorb_overhead),
        is_unregistered_seller: Boolean(po.is_unregistered_seller),
        discrepancy_amount: po.discrepancy_amount || 0,
        discrepancy_status: po.discrepancy_status || 'balanced',
        approval_status: po.approval_status || 'none',
        approval_remarks: po.approval_remarks || '',
        approved_by: po.approved_by || '',
        approved_at: po.approved_at || '',
    };
    return `${META_TAG_START}${JSON.stringify(meta)}${META_TAG_END}\n${userNotes.trim()}`;
}

export function decodePOMetadata(notesText?: string): { cleanNotes: string; meta: Record<string, any> } {
    if (!notesText || !notesText.includes(META_TAG_START)) {
        return { cleanNotes: notesText || '', meta: {} };
    }
    try {
        const startIdx = notesText.indexOf(META_TAG_START) + META_TAG_START.length;
        const endIdx = notesText.indexOf(META_TAG_END, startIdx);
        if (endIdx !== -1) {
            const jsonStr = notesText.substring(startIdx, endIdx);
            const meta = JSON.parse(jsonStr);
            const cleanNotes = notesText.substring(endIdx + META_TAG_END.length).trim();
            return { cleanNotes, meta };
        }
    } catch (e) {
        console.warn('Failed to parse PO metadata from notes:', e);
    }
    return { cleanNotes: notesText, meta: {} };
}

export async function createPurchaseOrder(
    po: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'> & { po_number?: string }
): Promise<PurchaseOrder> {
    const accountEmail = (pb.authStore.model as any)?.email || '';
    const isBlanket = po.po_type === 'blanket' || Boolean(po.budget_amount && (!po.items || po.items.length === 0));

    // Calculate totals
    let subtotal = 0;
    let gstAmount = 0;
    let shippingCost = po.shipping_cost || 0;
    const discountAmount = po.discount_amount || 0;
    let total = 0;

    if (isBlanket) {
        subtotal = po.budget_amount || po.subtotal || 0;
        gstAmount = po.gst_paid_overhead || po.gst_amount || 0;
        shippingCost = po.shipping_overhead || po.shipping_cost || 0;
        total = subtotal + gstAmount + shippingCost - discountAmount;
    } else {
        subtotal = (po.items || []).reduce((sum, item) => sum + item.total_price, 0);
        gstAmount = (po.items || []).reduce((sum, item) => sum + item.gst_amount, 0);
        total = subtotal + gstAmount + shippingCost - discountAmount;
    }

    // Resolve Vendor name for Code generation
    let vendorName = '';
    if (po.vendor_id) {
        try {
            const v = await pb.collection('vendors').getOne(po.vendor_id);
            vendorName = v.name;
        } catch {}
    }

    const encodedNotes = encodePOMetadata({
        ...po,
        po_type: isBlanket ? 'blanket' : 'itemized',
        budget_amount: isBlanket ? subtotal : undefined,
        inward_goods_cost: 0,
        gst_paid_overhead: gstAmount,
        shipping_overhead: shippingCost,
        absorb_overhead: po.absorb_overhead,
        is_unregistered_seller: po.is_unregistered_seller,
        discrepancy_amount: 0,
        discrepancy_status: 'balanced',
        approval_status: 'none',
    }, po.notes);

    const orderDate = po.order_date || new Date().toISOString();
    const poStatus = po.status || 'sent';

    let allocatedPoNumber = po.po_number || '';
    let poRecord: any;

    if (allocatedPoNumber) {
        // Explicit PO Number provided
        poRecord = await pb.collection('purchase_orders').create({
            account_email: accountEmail,
            po_number: allocatedPoNumber,
            vendor: po.vendor_id || '',
            status: poStatus,
            order_date: orderDate,
            expected_date: po.expected_date || '',
            subtotal,
            gst_amount: gstAmount,
            shipping_cost: shippingCost,
            discount_amount: discountAmount,
            total,
            shipping_address: po.shipping_address || '',
            notes: encodedNotes,
        });
    } else {
        poRecord = await createWithUniqueRetry(
            () => generatePONumber(vendorName),
            (allocatedNumber) => {
                allocatedPoNumber = allocatedNumber;
                return pb.collection('purchase_orders').create({
                    account_email: accountEmail,
                    po_number: allocatedNumber,
                    vendor: po.vendor_id || '',
                    status: poStatus,
                    order_date: orderDate,
                    expected_date: po.expected_date || '',
                    subtotal,
                    gst_amount: gstAmount,
                    shipping_cost: shippingCost,
                    discount_amount: discountAmount,
                    total,
                    shipping_address: po.shipping_address || '',
                    notes: encodedNotes,
                });
            }
        );
    }

    // Insert PO items if any
    const createdItems: PurchaseOrderItem[] = [];
    if (po.items && po.items.length > 0) {
        for (const item of po.items) {
            const itemRecord = await pb.collection('purchase_order_items').create({
                account_email: accountEmail,
                po: poRecord.id,
                purchase_order: poRecord.id,
                ...(item.variant_id ? { variant: item.variant_id } : {}),
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
                po_id: poRecord.id,
                quantity_received: 0,
            });
        }
    }

    return {
        id: poRecord.id,
        po_number: poRecord.po_number || allocatedPoNumber,
        po_type: isBlanket ? 'blanket' : 'itemized',
        vendor_id: po.vendor_id,
        status: po.status,
        order_date: po.order_date,
        expected_date: po.expected_date,
        subtotal,
        gst_amount: gstAmount,
        shipping_cost: shippingCost,
        discount_amount: discountAmount,
        total,
        shipping_address: po.shipping_address,
        notes: po.notes,
        items: createdItems,
        budget_amount: isBlanket ? subtotal : undefined,
        inward_goods_cost: 0,
        gst_paid_overhead: gstAmount,
        shipping_overhead: shippingCost,
        absorb_overhead: po.absorb_overhead,
        is_unregistered_seller: po.is_unregistered_seller,
        discrepancy_amount: 0,
        discrepancy_status: 'balanced',
        approval_status: 'none',
        created_at: poRecord.created,
        updated_at: poRecord.updated,
    };
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
    try {
        const po = await pb.collection('purchase_orders').getOne(id, {
            expand: 'vendor',
        });

        const items = await pb.collection('purchase_order_items').getFullList<POItemRecord>({
            filter: `po="${id}" || purchase_order="${id}"`,
            expand: 'variant,variant.product',
        });

        const { cleanNotes, meta } = decodePOMetadata(po.notes);

        return {
            id: po.id,
            po_number: po.po_number,
            po_type: meta.po_type || (meta.budget_amount ? 'blanket' : 'itemized'),
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
            notes: cleanNotes,
            budget_amount: meta.budget_amount,
            inward_goods_cost: meta.inward_goods_cost,
            gst_paid_overhead: meta.gst_paid_overhead,
            shipping_overhead: meta.shipping_overhead,
            absorb_overhead: meta.absorb_overhead,
            is_unregistered_seller: meta.is_unregistered_seller,
            discrepancy_amount: meta.discrepancy_amount,
            discrepancy_status: meta.discrepancy_status,
            approval_status: meta.approval_status,
            approval_remarks: meta.approval_remarks,
            approved_by: meta.approved_by,
            approved_at: meta.approved_at,
            vendor: po.expand?.vendor ? {
                id: po.expand.vendor.id,
                name: po.expand.vendor.name,
                phone: po.expand.vendor.phone,
                email: po.expand.vendor.email,
            } : undefined,
            items: items.map((item) => ({
                id: item.id,
                po_id: item.po || item.purchase_order,
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
        const { start, end } = normalizeDateBounds(filters?.startDate, filters?.endDate);
        if (start) {
            filterParts.push(`order_date>="${start}"`);
        }
        if (end) {
            filterParts.push(`order_date<="${end}"`);
        }

        const pos = await pb.collection('purchase_orders').getFullList<PORecord>({
            filter: filterParts.join(' && ') || '',
            sort: '-order_date',
            expand: 'vendor',
        });

        // Fetch items for all POs
        const poIds = pos.map(p => p.id);
        let allItems: POItemRecord[] = [];
        if (poIds.length > 0) {
            const itemFilter = poIds.map(id => `(po="${id}" || purchase_order="${id}")`).join(' || ');
            allItems = await pb.collection('purchase_order_items').getFullList<POItemRecord>({
                filter: itemFilter,
            });
        }

        // Group items by PO
        const itemsByPO = new Map<string | undefined, POItemRecord[]>();
        allItems.forEach(item => {
            const poKey = item.po || item.purchase_order;
            if (!itemsByPO.has(poKey)) {
                itemsByPO.set(poKey, []);
            }
            itemsByPO.get(poKey)!.push(item);
        });

        return pos.map((po) => {
            const { cleanNotes, meta } = decodePOMetadata(po.notes);
            return {
                id: po.id,
                po_number: po.po_number,
                po_type: meta.po_type || (meta.budget_amount ? 'blanket' : 'itemized'),
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
                notes: cleanNotes,
                budget_amount: meta.budget_amount,
                inward_goods_cost: meta.inward_goods_cost,
                gst_paid_overhead: meta.gst_paid_overhead,
                shipping_overhead: meta.shipping_overhead,
                absorb_overhead: meta.absorb_overhead,
                is_unregistered_seller: meta.is_unregistered_seller,
                discrepancy_amount: meta.discrepancy_amount,
                discrepancy_status: meta.discrepancy_status,
                approval_status: meta.approval_status,
                approval_remarks: meta.approval_remarks,
                approved_by: meta.approved_by,
                approved_at: meta.approved_at,
                vendor: po.expand?.vendor ? {
                    id: po.expand.vendor.id,
                    name: po.expand.vendor.name,
                    phone: po.expand.vendor.phone,
                    email: po.expand.vendor.email,
                } : undefined,
                items: (itemsByPO.get(po.id) || []).map((item) => ({
                    id: item.id,
                    po_id: item.po || item.purchase_order,
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
            };
        });
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
    let allocatedGrnNumber = '';
    // Insert GRN with unique retry
    const grnData = await createWithUniqueRetry(
        generateGRNNumber,
        (allocatedNumber) => {
            allocatedGrnNumber = allocatedNumber;
            return pb.collection('goods_received_notes').create({
                account_email: (pb.authStore.model as any)?.email || '',
                grn_number: allocatedNumber,
                po: grn.po_id || '',
                purchase_order: grn.po_id || '',
                vendor: grn.vendor_id || '',
                received_date: grn.received_date,
                received_by: grn.received_by || '',
                notes: grn.notes || '',
            });
        }
    );

    // Fetch PO record for human-readable audit traceability in stock movements
    let poNumber = '';
    let vendorName = '';
    if (grn.po_id) {
        try {
            const poRecord = await pb.collection('purchase_orders').getOne(grn.po_id, { expand: 'vendor' });
            poNumber = poRecord.po_number || '';
            vendorName = (poRecord.expand?.vendor as any)?.name || '';
        } catch (e) {
            console.warn('Could not load PO record for GRN logging:', e);
        }
    }
    const accountEmail = (pb.authStore.model as any)?.email || '';

    // Insert GRN items and update stock
    const createdItems: GRNItem[] = [];
    const validItems = grn.items.filter(i => i.quantity_received > 0);

    // Validate and guard against over-receipt on linked PO items
    for (const item of validItems) {
        if (item.po_item_id) {
            try {
                const poItem = await pb.collection('purchase_order_items').getOne(item.po_item_id);
                const ordered = poItem.quantity_ordered ?? poItem.quantity ?? 0;
                const alreadyReceived = poItem.quantity_received || 0;
                const remaining = Math.max(0, ordered - alreadyReceived);
                if (ordered > 0 && item.quantity_received > remaining) {
                    console.warn(`[GRN Guard] PO item ${item.po_item_id} ordered: ${ordered}, previously received: ${alreadyReceived}. Requested receipt ${item.quantity_received} exceeds remaining ${remaining}. Capping to remaining.`);
                    item.quantity_received = remaining;
                }
            } catch (err) {
                console.warn('Could not verify PO item bounds:', item.po_item_id, err);
            }
        }
    }

    for (const item of validItems.filter(i => i.quantity_received > 0)) {
        const itemRecord = await pb.collection('grn_items').create({
            account_email: accountEmail,
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
                await pb.collection('product_variants').update(item.variant_id, {
                    'stock_level+': item.quantity_received,
                });

                // Log stock movement with account_email & PO metadata for full bidirectional traceability
                await pb.collection('stock_movements').create({
                    variant: item.variant_id,
                    movement_type: 'purchase',
                    quantity: item.quantity_received,
                    reference_id: grnData.id,
                    source: 'grn',
                    notes: `PO #${poNumber || 'PO'} | GRN #${allocatedGrnNumber} | Received ${item.quantity_received} units from ${vendorName || 'Vendor'}`,
                    account_email: accountEmail,
                });
            } catch (err) {
                console.error('Error updating stock for variant:', item.variant_id, err);
            }
        }

        // Update PO item received quantity and sync variant if matched during delivery
        if (item.po_item_id) {
            try {
                const poItem = await pb.collection('purchase_order_items').getOne(item.po_item_id);
                const updates: Record<string, any> = {
                    quantity_received: (poItem.quantity_received || 0) + item.quantity_received,
                };
                if (item.variant_id && !poItem.variant) {
                    updates.variant = item.variant_id;
                }
                await pb.collection('purchase_order_items').update(item.po_item_id, updates);
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
            const poItems = await pb.collection('purchase_order_items').getFullList<POItemRecord>({
                filter: `po="${grn.po_id}" || purchase_order="${grn.po_id}"`,
            });

            const totalOrdered = poItems.reduce((sum: number, i) => sum + i.quantity_ordered, 0);
            const totalReceived = poItems.reduce((sum: number, i) => sum + (i.quantity_received || 0), 0);

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
        grn_number: grnData.grn_number || allocatedGrnNumber,
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
        const grns = await pb.collection('goods_received_notes').getFullList<GRNRecord>({
            filter: `po="${poId}" || purchase_order="${poId}"`,
            sort: '-received_date',
        });

        // Fetch items for all GRNs
        const grnIds = grns.map(g => g.id);
        let allItems: any[] = [];
        if (grnIds.length > 0) {
            const itemFilter = grnIds.map(id => `grn="${id}"`).join(' || ');
            allItems = await pb.collection('grn_items').getFullList({
                filter: itemFilter,
                expand: 'variant,variant.product,po_item',
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

        return grns.map((grn) => ({
            id: grn.id,
            grn_number: grn.grn_number,
            po_id: grn.po || grn.purchase_order,
            vendor_id: grn.vendor,
            received_date: grn.received_date,
            received_by: grn.received_by,
            notes: grn.notes,
            items: (itemsByGRN.get(grn.id) || []).map((item) => ({
                id: item.id,
                grn_id: item.grn,
                po_item_id: item.po_item,
                variant_id: item.variant,
                quantity_received: item.quantity_received,
                quantity_rejected: item.quantity_rejected || 0,
                rejection_reason: item.rejection_reason,
                variant: item.expand?.variant ? {
                    id: item.expand.variant.id,
                    variant_name: item.expand.variant.variant_name,
                    sku_suffix: item.expand.variant.sku_suffix,
                    stock_level: item.expand.variant.stock_level,
                    product: item.expand.variant.expand?.product ? {
                        id: item.expand.variant.expand.product.id,
                        name: item.expand.variant.expand.product.name,
                        sku: item.expand.variant.expand.product.sku,
                    } : undefined,
                } : undefined,
                po_item: item.expand?.po_item ? {
                    id: item.expand.po_item.id,
                    description: item.expand.po_item.description,
                    unit_price: item.expand.po_item.unit_price,
                } : undefined,
            })),
            created_at: grn.created,
        }));
    } catch (error) {
        console.error('Error fetching GRNs:', error);
        return [];
    }
}

/** Link an unlinked PO Item directly to an existing product variant */
export async function linkPOItemToVariant(poItemId: string, variantId: string): Promise<void> {
    await pb.collection('purchase_order_items').update(poItemId, {
        variant: variantId,
    });
}

export interface QuickProductDetails {
    name: string;
    sku?: string;
    category?: string;
    cost_price: number;
    base_price?: number;
    hsn_code?: string;
    location?: string;
    material?: string;
    purity_karat?: string;
    gross_weight?: number;
    net_weight?: number;
    making_charges?: number;
    description?: string;
}

/** Quick-create a new Product and Variant in Inventory from an unlinked PO Item or on-the-fly in PO creation */
export async function quickCreateInventoryProductForPOItem(
    poItemId?: string | null,
    details: QuickProductDetails = {} as QuickProductDetails
): Promise<{
    productId: string;
    variantId: string;
    sku: string;
    name: string;
    basePrice: number;
    costPrice: number;
    productRecord: any;
    variantRecord: any;
}> {
    const accountEmail = (pb.authStore.model as any)?.email || '';
    const generatedSku = details.sku?.trim() || `SKU-${Date.now().toString(36).toUpperCase()}`;
    const basePrice = details.base_price && details.base_price > 0
        ? details.base_price
        : Math.round(details.cost_price * 1.35);

    // Resolve or auto-create category in PocketBase
    let categoryId = '';
    if (details.category?.trim() && details.category !== '__custom__') {
        const catName = details.category.trim();
        try {
            const existingCat = await pb.collection('categories').getFirstListItem(`name = "${catName}"`);
            categoryId = existingCat.id;
        } catch {
            try {
                const newCat = await pb.collection('categories').create({
                    name: catName,
                    slug: catName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                    is_active: true,
                    account_email: accountEmail,
                });
                categoryId = newCat.id;
            } catch (err) {
                console.warn('Could not auto-create category in PocketBase:', err);
            }
        }
    }

    const productPayload: Record<string, any> = {
        name: details.name.trim(),
        sku: generatedSku,
        cost_price: details.cost_price,
        base_price: basePrice,
        hsn_code: details.hsn_code || '7113',
        location: details.location || 'Showcase Tray A',
        is_active: true,
        account_email: accountEmail,
    };
    if (categoryId) productPayload.category = categoryId;
    if (details.material) productPayload.material = details.material;
    if (details.purity_karat) productPayload.purity_karat = details.purity_karat;
    if (details.gross_weight) productPayload.gross_weight = details.gross_weight;
    if (details.net_weight) productPayload.net_weight = details.net_weight;
    if (details.making_charges) productPayload.making_charges = details.making_charges;
    if (details.description) productPayload.description = details.description;

    const productRecord = await pb.collection('products').create(productPayload);

    const variantPayload: Record<string, any> = {
        product: productRecord.id,
        variant_name: 'Standard',
        sku_suffix: 'STD',
        stock_level: 0,
        account_email: accountEmail,
    };
    if (details.material) variantPayload.material = details.material;
    if (details.purity_karat) variantPayload.purity_karat = details.purity_karat;
    if (details.gross_weight) variantPayload.gross_weight = details.gross_weight;
    if (details.net_weight) variantPayload.net_weight = details.net_weight;
    if (details.making_charges) variantPayload.making_charges = details.making_charges;

    const variantRecord = await pb.collection('product_variants').create(variantPayload);

    if (poItemId) {
        await pb.collection('purchase_order_items').update(poItemId, {
            variant: variantRecord.id,
        });
    }

    return {
        productId: productRecord.id,
        variantId: variantRecord.id,
        sku: `${generatedSku}-STD`,
        name: productRecord.name,
        basePrice,
        costPrice: details.cost_price,
        productRecord,
        variantRecord,
    };
}

export interface ProductPurchaseHistory {
    incomingPOs: {
        poId: string;
        poNumber: string;
        vendorName: string;
        orderDate: string;
        expectedDate?: string;
        status: POStatus;
        quantityOrdered: number;
        quantityReceived: number;
        quantityPending: number;
        unitPrice: number;
    }[];
    deliveries: {
        grnId: string;
        grnNumber: string;
        poId: string;
        poNumber: string;
        vendorName: string;
        receivedDate: string;
        receivedBy?: string;
        quantityReceived: number;
        quantityRejected: number;
        unitPrice?: number;
        variantName?: string;
        sku?: string;
        notes?: string;
    }[];
    totalLifetimeReceived: number;
    totalPendingArrival: number;
}

/** Retrieve all PO deliveries and incoming pending orders for a product */
export async function getProductPurchaseHistory(productId: string): Promise<ProductPurchaseHistory> {
    try {
        // 1. Get all variants for this product
        const variants = await pb.collection('product_variants').getFullList({
            filter: `product="${productId}"`,
            expand: 'product',
        });
        const variantIds = variants.map(v => v.id);

        if (variantIds.length === 0) {
            return {
                incomingPOs: [],
                deliveries: [],
                totalLifetimeReceived: 0,
                totalPendingArrival: 0,
            };
        }

        const variantFilter = variantIds.map(id => `variant="${id}"`).join(' || ');

        // 2. Fetch all GRN items for these variants
        const grnItems = await pb.collection('grn_items').getFullList({
            filter: variantFilter,
            expand: 'grn,grn.vendor,po_item,variant,variant.product',
            sort: '-created',
        });

        // 3. For any GRN without po_number expanded directly, collect PO IDs to resolve
        const poIdsToFetch = new Set<string>();
        grnItems.forEach(item => {
            const grnRec = (item.expand as any)?.grn;
            const poId = grnRec?.po || grnRec?.purchase_order;
            if (poId) poIdsToFetch.add(poId);
        });

        const poMap = new Map<string, { po_number: string; vendor_name: string }>();
        if (poIdsToFetch.size > 0) {
            const poFilter = Array.from(poIdsToFetch).map(id => `id="${id}"`).join(' || ');
            const poRecords = await pb.collection('purchase_orders').getFullList({
                filter: poFilter,
                expand: 'vendor',
            });
            poRecords.forEach(p => {
                poMap.set(p.id, {
                    po_number: p.po_number || '',
                    vendor_name: (p.expand?.vendor as any)?.name || 'Unknown Vendor',
                });
            });
        }

        const deliveries = grnItems.map(item => {
            const exp = item.expand as any;
            const grn = exp?.grn;
            const poId = grn?.po || grn?.purchase_order || '';
            const poInfo = poMap.get(poId);
            const parentProduct = exp?.variant?.expand?.product;
            const skuSuffix = exp?.variant?.sku_suffix;
            const fullSku = parentProduct ? (skuSuffix ? `${parentProduct.sku}-${skuSuffix}` : parentProduct.sku) : '';

            return {
                grnId: grn?.id || '',
                grnNumber: grn?.grn_number || 'GRN',
                poId,
                poNumber: poInfo?.po_number || 'PO',
                vendorName: poInfo?.vendor_name || exp?.grn?.expand?.vendor?.name || 'Vendor',
                receivedDate: grn?.received_date || item.created,
                receivedBy: grn?.received_by,
                quantityReceived: item.quantity_received || 0,
                quantityRejected: item.quantity_rejected || 0,
                unitPrice: exp?.po_item?.unit_price,
                variantName: exp?.variant?.variant_name,
                sku: fullSku,
                notes: grn?.notes,
            };
        });

        // 4. Fetch incoming PO items for these variants
        const poItems = await pb.collection('purchase_order_items').getFullList({
            filter: variantFilter,
            expand: 'po,purchase_order,variant',
            sort: '-created',
        });

        const incomingPOs: ProductPurchaseHistory['incomingPOs'] = [];
        for (const item of poItems) {
            const poId = item.po || item.purchase_order;
            if (!poId) continue;
            let poRecord = (item.expand as any)?.po || (item.expand as any)?.purchase_order;
            if (!poRecord) {
                try {
                    poRecord = await pb.collection('purchase_orders').getOne(poId, { expand: 'vendor' });
                } catch {
                    continue;
                }
            }
            const status = (poRecord.status || 'draft') as POStatus;
            const ordered = item.quantity_ordered ?? item.quantity ?? 0;
            const received = item.quantity_received || 0;
            const pending = Math.max(0, ordered - received);

            if (pending > 0 && status !== 'cancelled' && status !== 'received') {
                incomingPOs.push({
                    poId,
                    poNumber: poRecord.po_number || 'PO',
                    vendorName: (poRecord.expand?.vendor as any)?.name || 'Vendor',
                    orderDate: poRecord.order_date || poRecord.created,
                    expectedDate: poRecord.expected_date,
                    status,
                    quantityOrdered: ordered,
                    quantityReceived: received,
                    quantityPending: pending,
                    unitPrice: item.unit_price || 0,
                });
            }
        }

        const totalLifetimeReceived = deliveries.reduce((sum, d) => sum + d.quantityReceived, 0);
        const totalPendingArrival = incomingPOs.reduce((sum, p) => sum + p.quantityPending, 0);

        return {
            incomingPOs,
            deliveries,
            totalLifetimeReceived,
            totalPendingArrival,
        };
    } catch (err) {
        console.error('Error fetching product purchase history:', err);
        return {
            incomingPOs: [],
            deliveries: [],
            totalLifetimeReceived: 0,
            totalPendingArrival: 0,
        };
    }
}

/** Retrieve all open POs that can accept goods delivery */
export async function getOpenPurchaseOrders(): Promise<PurchaseOrder[]> {
    try {
        const records = await pb.collection('purchase_orders').getFullList({
            filter: `status="draft" || status="sent" || status="partial"`,
            sort: '-order_date',
            expand: 'vendor',
        });
        return records.map((po) => {
            const { cleanNotes, meta } = decodePOMetadata(po.notes);
            return {
                id: po.id,
                po_number: po.po_number,
                po_type: meta.po_type || (meta.budget_amount ? 'blanket' : 'itemized'),
                vendor_id: po.vendor,
                status: po.status,
                order_date: po.order_date,
                expected_date: po.expected_date,
                subtotal: po.subtotal,
                gst_amount: po.gst_amount,
                shipping_cost: po.shipping_cost || 0,
                discount_amount: po.discount_amount || 0,
                total: po.total,
                notes: cleanNotes,
                items: [],
                budget_amount: meta.budget_amount,
                inward_goods_cost: meta.inward_goods_cost,
                gst_paid_overhead: meta.gst_paid_overhead,
                shipping_overhead: meta.shipping_overhead,
                absorb_overhead: meta.absorb_overhead,
                is_unregistered_seller: meta.is_unregistered_seller,
                discrepancy_amount: meta.discrepancy_amount,
                discrepancy_status: meta.discrepancy_status,
                approval_status: meta.approval_status,
                approval_remarks: meta.approval_remarks,
                approved_by: meta.approved_by,
                approved_at: meta.approved_at,
                vendor: (po.expand as any)?.vendor ? {
                    id: (po.expand as any).vendor.id,
                    name: (po.expand as any).vendor.name,
                    phone: (po.expand as any).vendor.phone,
                    email: (po.expand as any).vendor.email,
                } : undefined,
                created_at: po.created,
                updated_at: po.updated,
            };
        });
    } catch (err) {
        console.error('Error fetching open POs:', err);
        return [];
    }
}

/**
 * Proportionately distributes GST and Shipping overheads onto unit cost.
 * Formula: unit_landed_cost = cost_price + ((cost_price * stock) / totalGoodsValue) * totalOverhead / stock
 *         = cost_price * (1 + totalOverhead / totalGoodsValue)
 */
export function calculateLandedUnitCosts<T extends { cost_price?: number; stock?: number }>(
    items: T[],
    totalOverhead: number
): (T & { landed_cost_price: number })[] {
    const totalGoodsValue = items.reduce((sum, item) => {
        const cost = item.cost_price || 0;
        const qty = item.stock || 1;
        return sum + (cost * qty);
    }, 0);

    if (totalGoodsValue <= 0 || totalOverhead <= 0) {
        return items.map(item => ({
            ...item,
            landed_cost_price: item.cost_price || 0,
        }));
    }

    return items.map(item => {
        const baseCost = item.cost_price || 0;
        if (baseCost <= 0) {
            return { ...item, landed_cost_price: 0 };
        }
        const overheadMultiplier = 1 + (totalOverhead / totalGoodsValue);
        const landedCost = Math.round((baseCost * overheadMultiplier) * 100) / 100;
        return {
            ...item,
            landed_cost_price: landedCost,
        };
    });
}

/**
 * Reconciles incoming goods batch cost against PO budget and calculates discrepancies.
 */
export async function reconcilePOWithInwardBatch(
    poRefOrId: string,
    batchTotalCost: number
): Promise<{
    po: PurchaseOrder;
    discrepancyAmount: number;
    discrepancyStatus: DiscrepancyStatus;
    approvalStatus: ApprovalStatus;
}> {
    let poRecord: any = null;
    try {
        poRecord = await pb.collection('purchase_orders').getOne(poRefOrId, { expand: 'vendor' });
    } catch {
        poRecord = await pb.collection('purchase_orders').getFirstListItem(`po_number="${poRefOrId.trim()}"`, { expand: 'vendor' }).catch(() => null);
    }

    if (!poRecord) {
        throw new Error(`Purchase order "${poRefOrId}" not found for reconciliation.`);
    }

    const { cleanNotes, meta } = decodePOMetadata(poRecord.notes);
    const existingInward = Number(meta.inward_goods_cost || 0);
    const newInwardCost = Math.round((existingInward + batchTotalCost) * 100) / 100;

    const budgetedAmount = Number(meta.budget_amount ?? poRecord.subtotal ?? 0);
    const discrepancy = Math.round((newInwardCost - budgetedAmount) * 100) / 100;

    let discrepancyStatus: DiscrepancyStatus = 'balanced';
    let approvalStatus: ApprovalStatus = meta.approval_status || 'none';

    // Tolerance threshold of ₹10
    if (discrepancy > 10) {
        discrepancyStatus = 'over_budget';
        if (approvalStatus !== 'approved') {
            approvalStatus = 'pending_approval';
        }
    } else if (discrepancy < -10) {
        discrepancyStatus = 'under_budget';
        if (approvalStatus !== 'approved') {
            approvalStatus = 'pending_approval';
        }
    } else {
        discrepancyStatus = 'balanced';
    }

    let nextPOStatus: POStatus = poRecord.status;
    if (poRecord.status !== 'cancelled') {
        if (newInwardCost >= budgetedAmount && discrepancyStatus === 'balanced') {
            nextPOStatus = 'received';
        } else {
            nextPOStatus = 'partial';
        }
    }

    const updatedMeta = {
        ...meta,
        inward_goods_cost: newInwardCost,
        discrepancy_amount: discrepancy,
        discrepancy_status: discrepancyStatus,
        approval_status: approvalStatus,
    };

    const updatedNotes = encodePOMetadata(updatedMeta, cleanNotes);

    await pb.collection('purchase_orders').update(poRecord.id, {
        notes: updatedNotes,
        status: nextPOStatus,
    });

    const updatedPO = await getPurchaseOrder(poRecord.id);
    if (!updatedPO) throw new Error('Failed to retrieve updated PO after reconciliation');

    return {
        po: updatedPO,
        discrepancyAmount: discrepancy,
        discrepancyStatus,
        approvalStatus,
    };
}

/**
 * Enforces strict manager approval with mandatory remarks for any PO with cost discrepancies.
 */
export async function approvePODiscrepancy(
    poId: string,
    remarks: string,
    managerName?: string
): Promise<PurchaseOrder> {
    if (!remarks || !remarks.trim()) {
        throw new Error('Approval remarks are strictly required to resolve a PO discrepancy.');
    }

    const poRecord = await pb.collection('purchase_orders').getOne(poId);
    const { cleanNotes, meta } = decodePOMetadata(poRecord.notes);

    const currentUser = pb.authStore.model as any;
    const approvedBy = managerName || currentUser?.name || currentUser?.email || 'Store Manager';
    const approvedAt = new Date().toISOString();

    const updatedMeta = {
        ...meta,
        approval_status: 'approved' as ApprovalStatus,
        approval_remarks: remarks.trim(),
        approved_by: approvedBy,
        approved_at: approvedAt,
    };

    const updatedNotes = encodePOMetadata(updatedMeta, cleanNotes);

    await pb.collection('purchase_orders').update(poId, {
        notes: updatedNotes,
    });

    const updated = await getPurchaseOrder(poId);
    if (!updated) throw new Error('Failed to reload approved purchase order.');
    return updated;
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
