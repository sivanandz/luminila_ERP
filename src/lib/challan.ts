/**
 * Delivery Challan Service Layer
 * Handles challan CRUD operations for material outward tracking using PocketBase
 */

import { getCurrentTenantEmail, pb, sanitizeFilter } from './pocketbase';
import { ClientResponseError } from 'pocketbase';
import { toast } from 'sonner';
import { getStoreSettings } from './invoice';
import { getNextSequenceNumber, createWithUniqueRetry } from './sequence-generator';
import { normalizeDateBounds } from './utils';
import { calculateGST, getStateCode, GST_RATES } from './gst';

// ============================================
// TYPES
// ============================================

export type ChallanType = 'job_work' | 'stock_transfer' | 'sale_return' | 'exhibition' | 'approval' | 'other';
export type ChallanStatus = 'draft' | 'issued' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';

export interface ChallanItem {
    id?: string;
    challan_id?: string;
    product_id?: string;
    variant_id?: string;
    sr_no: number;
    description: string;
    hsn_code: string;
    quantity: number;
    unit: string;
    unit_price: number;
    taxable_value: number;
    gst_rate: number;
    cgst_rate: number;
    cgst_amount: number;
    sgst_rate: number;
    sgst_amount: number;
    igst_rate: number;
    igst_amount: number;
    total: number;
    remarks?: string;
}

export interface DeliveryChallan {
    id?: string;
    challan_number?: string;
    challan_date: string;
    challan_type: ChallanType;
    status: ChallanStatus;
    consignor_name: string;
    consignor_gstin?: string;
    consignor_address?: string;
    consignor_state_code?: string;
    consignee_id?: string;
    consignee_name: string;
    consignee_gstin?: string;
    consignee_address?: string;
    consignee_state_code?: string;
    place_of_supply?: string;
    sales_order_id?: string;
    invoice_id?: string;
    related_challan_id?: string;
    vehicle_number?: string;
    transporter_name?: string;
    driver_name?: string;
    driver_phone?: string;
    transport_mode?: string;
    eway_bill_number?: string;
    eway_bill_date?: string;
    total_quantity: number;
    taxable_value: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_value: number;
    reason?: string;
    notes?: string;
    internal_notes?: string;
    expected_delivery_date?: string;
    delivered_at?: string;
    created_at?: string;
    updated_at?: string;
    items?: ChallanItem[];
}

/**
 * Raw delivery_challan_items record as stored in PocketBase
 * (relation columns use singular names: challan, product, variant)
 */
interface DeliveryChallanItemRecord {
    id: string;
    challan?: string;
    product?: string;
    variant?: string;
    sr_no: number;
    description: string;
    hsn_code: string;
    quantity: number;
    unit: string;
    unit_price: number;
    taxable_value: number;
    gst_rate: number;
    cgst_rate: number;
    cgst_amount: number;
    sgst_rate: number;
    sgst_amount: number;
    igst_rate: number;
    igst_amount: number;
    total: number;
    remarks?: string;
}

/**
 * Raw delivery_challans record as stored in PocketBase
 * (the collection stores the challan date in delivery_date)
 */
interface DeliveryChallanRecord {
    id: string;
    challan_number?: string;
    delivery_date: string;
    challan_type?: ChallanType;
    status?: ChallanStatus;
    consignor_name?: string;
    consignee_name?: string;
    consignee_address?: string;
    total_quantity?: number;
    total_value?: number;
    created?: string;
    vehicle_number?: string;
    driver_name?: string;
    driver_phone?: string;
    notes?: string;
}

/** Raw sales_order_items record as stored in PocketBase */
interface SalesOrderItemRecord {
    id: string;
    product?: string;
    variant?: string;
    description?: string;
    quantity: number;
    unit_price: number;
    tax_rate?: number;
    discount_amount?: number;
    total?: number;
}

// ============================================
// CHALLAN TYPE LABELS
// ============================================

export const CHALLAN_TYPE_LABELS: Record<ChallanType, string> = {
    'job_work': 'Job Work',
    'stock_transfer': 'Stock Transfer',
    'sale_return': 'Sales Return',
    'exhibition': 'Exhibition / Demo',
    'approval': 'Approval Basis',
    'other': 'Other'
};

export const CHALLAN_STATUS_LABELS: Record<ChallanStatus, string> = {
    'draft': 'Draft',
    'issued': 'Issued',
    'in_transit': 'In Transit',
    'delivered': 'Delivered',
    'returned': 'Returned',
    'cancelled': 'Cancelled'
};

/**
 * Allowed challan status transitions. `updateChallanStatus` used to write any
 * status by bare id, so a caller could flip a cancelled challan straight to
 * delivered (ORD-6).
 */
const CHALLAN_TRANSITIONS: Record<ChallanStatus, ChallanStatus[]> = {
    draft: ['issued', 'cancelled'],
    // `issued -> delivered` is kept because the detail page exposes "Mark
    // Delivered" before transit; everything else must follow the chain.
    issued: ['in_transit', 'delivered', 'cancelled'],
    in_transit: ['delivered', 'returned', 'cancelled'],
    delivered: ['returned'],
    returned: [],
    cancelled: [],
};

/** Round rupee amounts to paise so accumulated tax lines do not drift. */
function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ============================================
// NUMBER GENERATION
// ============================================

export async function generateChallanNumber(): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const seqName = `dc_${yymm}`;

    return getNextSequenceNumber({
        seqName,
        prefix: 'DC',
        padding: 5,
        formatFn: (nextValue) => `DC/${yymm}/${nextValue.toString().padStart(5, '0')}`,
    });
}

// ============================================
// CREATE CHALLAN
// ============================================

export async function createChallan(
    challan: Omit<DeliveryChallan, 'id' | 'challan_number' | 'created_at' | 'updated_at'>,
    items: Omit<ChallanItem, 'id' | 'challan_id'>[]
): Promise<{ success: boolean; challanId?: string; challanNumber?: string; error?: string }> {
    try {
        let allocatedChallanNumber = '';
        const data = await createWithUniqueRetry(
            generateChallanNumber,
            async (allocatedNumber) => {
                allocatedChallanNumber = allocatedNumber;
                return pb.collection('delivery_challans').create({
                    account_email: getCurrentTenantEmail(),
                    challan_number: allocatedNumber,
                    challan_date: challan.challan_date,
                    challan_type: challan.challan_type,
                    status: challan.status || 'draft',
                    customer: challan.consignee_id || '',
                    order: challan.sales_order_id || '',
                    delivery_date: challan.challan_date || '',
                    consignor_name: challan.consignor_name,
                    consignor_gstin: challan.consignor_gstin || '',
                    consignor_address: challan.consignor_address || '',
                    consignor_state_code: challan.consignor_state_code || '',
                    consignee: challan.consignee_id || '',
                    consignee_name: challan.consignee_name,
                    consignee_gstin: challan.consignee_gstin || '',
                    consignee_address: challan.consignee_address || '',
                    consignee_state_code: challan.consignee_state_code || '',
                    place_of_supply: challan.place_of_supply || '',
                    sales_order: challan.sales_order_id || '',
                    invoice: challan.invoice_id || '',
                    vehicle_number: challan.vehicle_number || '',
                    transporter_name: challan.transporter_name || '',
                    driver_name: challan.driver_name || '',
                    driver_phone: challan.driver_phone || '',
                    transport_mode: challan.transport_mode || 'road',
                    eway_bill_number: challan.eway_bill_number || '',
                    eway_bill_date: challan.eway_bill_date || '',
                    total_quantity: challan.total_quantity,
                    taxable_value: challan.taxable_value,
                    cgst_amount: challan.cgst_amount,
                    sgst_amount: challan.sgst_amount,
                    igst_amount: challan.igst_amount,
                    total_value: challan.total_value,
                    reason: challan.reason || '',
                    notes: challan.notes || '',
                    internal_notes: challan.internal_notes || '',
                    expected_delivery_date: challan.expected_delivery_date || '',
                });
            }
        );

        // Insert items. A mid-loop failure left an orphan challan with partial
        // lines, so the header and every created line are removed on error
        // before the failure is rethrown (ORD-7).
        const createdItemIds: string[] = [];
        try {
            for (const item of items) {
                const created = await pb.collection('delivery_challan_items').create({
                    account_email: getCurrentTenantEmail(),
                    challan: data.id,
                    product: item.product_id || '',
                    variant: item.variant_id || '',
                    sr_no: item.sr_no,
                    description: item.description,
                    hsn_code: item.hsn_code,
                    quantity: item.quantity,
                    unit: item.unit,
                    unit_price: item.unit_price,
                    taxable_value: item.taxable_value,
                    gst_rate: item.gst_rate,
                    cgst_rate: item.cgst_rate,
                    cgst_amount: item.cgst_amount,
                    sgst_rate: item.sgst_rate,
                    sgst_amount: item.sgst_amount,
                    igst_rate: item.igst_rate,
                    igst_amount: item.igst_amount,
                    total: item.total,
                    remarks: item.remarks || '',
                });
                createdItemIds.push(created.id);
            }
        } catch (itemErr) {
            for (const itemId of createdItemIds) {
                await pb.collection('delivery_challan_items').delete(itemId).catch(() => {});
            }
            await pb.collection('delivery_challans').delete(data.id).catch(() => {});
            throw itemErr;
        }

        toast.success('Delivery Challan created successfully');
        return { success: true, challanId: data.id, challanNumber: allocatedChallanNumber };
    } catch (error) {
        console.error('Error creating challan:', error);
        toast.error('Failed to create challan');
        return { success: false, error: String(error) };
    }
}

// ============================================
// GET CHALLAN
// ============================================

export async function getChallan(id: string): Promise<DeliveryChallan | null> {
    try {
        const data = await pb.collection('delivery_challans').getOne(id);
        const tenant = getCurrentTenantEmail();
        const owner = (data as unknown as { account_email?: string }).account_email;
        if (owner && owner !== tenant) return null;
        const items = await pb.collection('delivery_challan_items').getFullList<DeliveryChallanItemRecord>({
            filter: `challan="${sanitizeFilter(id)}" && account_email="${sanitizeFilter(tenant)}"`,
            sort: 'sr_no',
        });

        return {
            id: data.id,
            challan_number: data.challan_number,
            challan_date: data.challan_date,
            challan_type: data.challan_type,
            status: data.status,
            consignor_name: data.consignor_name,
            consignor_gstin: data.consignor_gstin,
            consignor_address: data.consignor_address,
            consignor_state_code: data.consignor_state_code,
            consignee_id: data.consignee,
            consignee_name: data.consignee_name,
            consignee_gstin: data.consignee_gstin,
            consignee_address: data.consignee_address,
            consignee_state_code: data.consignee_state_code,
            place_of_supply: data.place_of_supply,
            sales_order_id: data.sales_order,
            invoice_id: data.invoice,
            vehicle_number: data.vehicle_number,
            transporter_name: data.transporter_name,
            driver_name: data.driver_name,
            driver_phone: data.driver_phone,
            transport_mode: data.transport_mode,
            eway_bill_number: data.eway_bill_number,
            eway_bill_date: data.eway_bill_date,
            total_quantity: data.total_quantity,
            taxable_value: data.taxable_value,
            cgst_amount: data.cgst_amount,
            sgst_amount: data.sgst_amount,
            igst_amount: data.igst_amount,
            total_value: data.total_value,
            reason: data.reason,
            notes: data.notes,
            internal_notes: data.internal_notes,
            expected_delivery_date: data.expected_delivery_date,
            delivered_at: data.delivered_at,
            created_at: data.created,
            updated_at: data.updated,
            items: items.map((item) => ({
                id: item.id,
                challan_id: item.challan,
                product_id: item.product,
                variant_id: item.variant,
                sr_no: item.sr_no,
                description: item.description,
                hsn_code: item.hsn_code,
                quantity: item.quantity,
                unit: item.unit,
                unit_price: item.unit_price,
                taxable_value: item.taxable_value,
                gst_rate: item.gst_rate,
                cgst_rate: item.cgst_rate,
                cgst_amount: item.cgst_amount,
                sgst_rate: item.sgst_rate,
                sgst_amount: item.sgst_amount,
                igst_rate: item.igst_rate,
                igst_amount: item.igst_amount,
                total: item.total,
                remarks: item.remarks,
            })),
        };
    } catch (error) {
        console.error('Error fetching challan:', error);
        return null;
    }
}

// ============================================
// GET CHALLANS LIST
// ============================================

export async function getChallans(filters?: {
    startDate?: string;
    endDate?: string;
    challanType?: ChallanType;
    status?: ChallanStatus;
    consigneeName?: string;
}): Promise<DeliveryChallan[]> {
    try {
        const filterParts: string[] = [`account_email="${sanitizeFilter(getCurrentTenantEmail())}"`];

        // Use delivery_date instead of challan_date (actual field name in collection)
        const { start, end } = normalizeDateBounds(filters?.startDate, filters?.endDate);
        if (start) {
            filterParts.push(`delivery_date>="${start}"`);
        }
        if (end) {
            filterParts.push(`delivery_date<="${end}"`);
        }
        if (filters?.status) {
            filterParts.push(`status="${filters.status}"`);
        }
        // These were documented as unsupported and silently ignored, so a
        // challan-type or consignee search returned the whole register (ORD-21).
        if (filters?.challanType) {
            filterParts.push(`challan_type="${filters.challanType}"`);
        }
        if (filters?.consigneeName) {
            filterParts.push(`consignee_name~"${sanitizeFilter(filters.consigneeName)}"`);
        }

        const data = await pb.collection('delivery_challans').getFullList<DeliveryChallanRecord>({
            filter: filterParts.join(' && '),
            sort: '-created', // Use created instead of challan_date which doesn't exist
        });

        return data.map((ch) => ({
            id: ch.id,
            challan_number: ch.challan_number,
            challan_date: ch.delivery_date, // Map delivery_date to challan_date
            challan_type: ch.challan_type || 'other',
            status: ch.status || 'draft',
            consignor_name: ch.consignor_name || '',
            consignee_name: ch.consignee_name || '',
            consignee_address: ch.consignee_address || '',
            total_quantity: ch.total_quantity || 0,
            total_value: ch.total_value || 0,
            created_at: ch.created,
            // Include actual fields from collection
            vehicle_number: ch.vehicle_number,
            driver_name: ch.driver_name,
            driver_phone: ch.driver_phone,
            notes: ch.notes,
        })) as DeliveryChallan[];
    } catch (error) {
        console.error('Error fetching challans:', error);
        if (error instanceof ClientResponseError && error.response?.data) {
            console.error('PocketBase error details:', JSON.stringify(error.response.data, null, 2));
        }
        if (error instanceof ClientResponseError && error.status === 400) {
            console.error('This may indicate the delivery_challans collection does not exist or has incorrect API rules');
        }
        return [];
    }
}

// ============================================
// UPDATE CHALLAN STATUS
// ============================================

export async function updateChallanStatus(
    id: string,
    status: ChallanStatus,
    additionalData?: { delivered_at?: string; notes?: string }
): Promise<boolean> {
    try {
        // Ownership first: the update below is addressed by bare id (ORD-6).
        const existing = await pb.collection('delivery_challans').getOne<{
            status?: ChallanStatus;
            account_email?: string;
        }>(id);
        const owner = String(existing.account_email || '').trim().toLowerCase();
        if (owner && owner !== getCurrentTenantEmail()) {
            toast.error('Challan does not belong to this store');
            return false;
        }

        const current = (existing.status || 'draft') as ChallanStatus;
        if (current === status) return true;
        const allowed = CHALLAN_TRANSITIONS[current];
        if (!allowed || !allowed.includes(status)) {
            toast.error(`Cannot move a challan from "${CHALLAN_STATUS_LABELS[current] || current}" to "${CHALLAN_STATUS_LABELS[status] || status}"`);
            return false;
        }

        const updateData: { status: ChallanStatus; delivered_at?: string; notes?: string } = { status };

        if (status === 'delivered' && !additionalData?.delivered_at) {
            updateData.delivered_at = new Date().toISOString();
        } else if (additionalData?.delivered_at) {
            updateData.delivered_at = additionalData.delivered_at;
        }

        if (additionalData?.notes) {
            updateData.notes = additionalData.notes;
        }

        await pb.collection('delivery_challans').update(id, updateData);
        toast.success(`Challan marked as ${CHALLAN_STATUS_LABELS[status]}`);
        return true;
    } catch (error) {
        console.error('Error updating challan status:', error);
        toast.error('Failed to update challan status');
        return false;
    }
}

// ============================================
// GENERATE CHALLAN FROM ORDER
// ============================================

export async function generateChallanFromOrder(
    orderId: string,
    challanType: ChallanType = 'other'
): Promise<{ success: boolean; challanId?: string }> {
    try {
        const order = await pb.collection('sales_orders').getOne<{
            account_email?: string;
            customer?: string;
            customer_name?: string;
            shipping_address?: string;
            order_number?: string;
            buyer_state_code?: string;
            place_of_supply?: string;
        }>(orderId);
        // The order was read by bare id and its items were not tenant-filtered
        // (ORD-11).
        const tenant = getCurrentTenantEmail();
        const owner = String(order.account_email || '').trim().toLowerCase();
        if (owner && owner !== tenant) {
            toast.error('Order does not belong to this store');
            return { success: false };
        }

        const orderItems = await pb.collection('sales_order_items').getFullList<SalesOrderItemRecord>({
            // sales_order_items has no `sales_order` column; the relation is `order`.
            filter: `order="${sanitizeFilter(orderId)}" && account_email="${sanitizeFilter(tenant)}"`,
        });

        const settings = await getStoreSettings();

        // Place of supply comes from the order, then the customer profile. Both
        // codes are required before the CGST/SGST vs IGST split can be chosen.
        const gstinState = String(settings.store_gstin || '').trim().substring(0, 2);
        const sellerStateCode =
            settings.store_state_code || (/^\d{2}$/.test(gstinState) ? gstinState : '') || '27';
        let buyerStateCode = String(order.buyer_state_code || order.place_of_supply || '').trim();
        if (!buyerStateCode && order.customer) {
            try {
                const customer = await pb.collection('customers').getOne<{
                    state?: string;
                    state_code?: string;
                    gstin?: string;
                }>(order.customer);
                const customerGstinState = String(customer.gstin || '').trim().substring(0, 2);
                buyerStateCode =
                    customer.state_code ||
                    getStateCode(customer.state || '') ||
                    (/^\d{2}$/.test(customerGstinState) ? customerGstinState : '');
            } catch {
                // Keep the order's own code, else fall back to the seller state.
            }
        }
        if (!buyerStateCode) buyerStateCode = sellerStateCode;

        const items: Omit<ChallanItem, 'id' | 'challan_id'>[] = orderItems.map((item, index) => {
            const quantity = Number(item.quantity) || 0;
            const unitPrice = Number(item.unit_price) || 0;
            const gross = round2(quantity * unitPrice);
            // GST applies to the post-discount taxable value, not the gross line
            // (ORD-11). Nullish rate keeps an explicit 0% exempt line exempt.
            const discount = Math.min(Math.max(0, Number(item.discount_amount) || 0), gross);
            const taxable = round2(gross - discount);
            const gstRate = Math.max(0, Number(item.tax_rate ?? GST_RATES.JEWELRY));
            const gst = calculateGST(taxable, sellerStateCode, buyerStateCode, gstRate);
            return {
                sr_no: index + 1,
                product_id: item.product,
                variant_id: item.variant,
                description: item.description || 'Item',
                hsn_code: '7113',
                quantity,
                unit: 'PCS',
                unit_price: unitPrice,
                taxable_value: gst.taxableAmount,
                gst_rate: gstRate,
                cgst_rate: gst.cgstRate,
                cgst_amount: gst.cgstAmount,
                sgst_rate: gst.sgstRate,
                sgst_amount: gst.sgstAmount,
                igst_rate: gst.igstRate,
                igst_amount: gst.igstAmount,
                total: gst.grandTotal,
            };
        });

        const totalQuantity = round2(items.reduce((sum, item) => sum + item.quantity, 0));
        const taxableValue = round2(items.reduce((sum, item) => sum + item.taxable_value, 0));
        const cgstAmount = round2(items.reduce((sum, item) => sum + item.cgst_amount, 0));
        const sgstAmount = round2(items.reduce((sum, item) => sum + item.sgst_amount, 0));
        const igstAmount = round2(items.reduce((sum, item) => sum + item.igst_amount, 0));

        const challan: Omit<DeliveryChallan, 'id' | 'challan_number' | 'created_at' | 'updated_at'> = {
            challan_date: new Date().toISOString().split('T')[0],
            challan_type: challanType,
            status: 'draft',
            consignor_name: settings.store_name,
            consignor_gstin: settings.store_gstin,
            consignor_address: [
                settings.store_address,
                settings.store_city,
                [settings.store_state, settings.store_pincode].filter(Boolean).join(" - ")
            ].filter(Boolean).join(", "),
            consignor_state_code: settings.store_state_code,
            consignee_name: order.customer_name || '',
            consignee_address: order.shipping_address,
            consignee_state_code: buyerStateCode,
            place_of_supply: buyerStateCode,
            sales_order_id: orderId,
            total_quantity: totalQuantity,
            taxable_value: taxableValue,
            cgst_amount: cgstAmount,
            sgst_amount: sgstAmount,
            igst_amount: igstAmount,
            total_value: round2(taxableValue + cgstAmount + sgstAmount + igstAmount),
            reason: `Delivery against Order ${order.order_number}`,
        };

        return await createChallan(challan, items);
    } catch (error) {
        console.error('Error generating challan from order:', error);
        toast.error('Failed to generate challan from order');
        return { success: false };
    }
}
