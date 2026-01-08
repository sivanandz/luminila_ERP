/**
 * Delivery Challan Service Layer
 * Handles challan CRUD operations for material outward tracking using PocketBase
 */

import { pb } from './pocketbase';
import { toast } from 'sonner';
import { getStoreSettings } from './invoice';

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

// ============================================
// NUMBER GENERATION
// ============================================

async function generateChallanNumber(): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const seqName = `dc_${yymm}`;

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
                prefix: 'DC',
                current_value: nextValue,
                padding: 5,
            });
        }

        return `DC/${yymm}/${nextValue.toString().padStart(5, '0')}`;
    } catch (error) {
        console.error('Error generating challan number:', error);
        return `DC/${Date.now()}`;
    }
}

// ============================================
// CREATE CHALLAN
// ============================================

export async function createChallan(
    challan: Omit<DeliveryChallan, 'id' | 'challan_number' | 'created_at' | 'updated_at'>,
    items: Omit<ChallanItem, 'id' | 'challan_id'>[]
): Promise<{ success: boolean; challanId?: string; challanNumber?: string; error?: string }> {
    try {
        const challanNumber = await generateChallanNumber();

        const data = await pb.collection('delivery_challans').create({
            challan_number: challanNumber,
            challan_date: challan.challan_date,
            challan_type: challan.challan_type,
            status: challan.status || 'draft',
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

        // Insert items
        for (const item of items) {
            await pb.collection('delivery_challan_items').create({
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
        }

        toast.success('Delivery Challan created successfully');
        return { success: true, challanId: data.id, challanNumber };
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
        const items = await pb.collection('delivery_challan_items').getFullList({
            filter: `challan="${id}"`,
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
            items: items.map((item: any) => ({
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
        const filterParts: string[] = [];

        if (filters?.startDate) {
            filterParts.push(`challan_date>="${filters.startDate}"`);
        }
        if (filters?.endDate) {
            filterParts.push(`challan_date<="${filters.endDate}"`);
        }
        if (filters?.challanType) {
            filterParts.push(`challan_type="${filters.challanType}"`);
        }
        if (filters?.status) {
            filterParts.push(`status="${filters.status}"`);
        }
        if (filters?.consigneeName) {
            filterParts.push(`consignee_name~"${filters.consigneeName}"`);
        }

        const data = await pb.collection('delivery_challans').getFullList({
            filter: filterParts.join(' && ') || '',
            sort: '-challan_date',
        });

        return data.map((ch: any) => ({
            id: ch.id,
            challan_number: ch.challan_number,
            challan_date: ch.challan_date,
            challan_type: ch.challan_type,
            status: ch.status,
            consignor_name: ch.consignor_name,
            consignee_name: ch.consignee_name,
            consignee_address: ch.consignee_address,
            total_quantity: ch.total_quantity,
            total_value: ch.total_value,
            created_at: ch.created,
        })) as DeliveryChallan[];
    } catch (error) {
        console.error('Error fetching challans:', error);
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
        const updateData: any = { status };

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
        const order = await pb.collection('sales_orders').getOne(orderId);
        const orderItems = await pb.collection('sales_order_items').getFullList({
            filter: `sales_order="${orderId}"`,
        });

        const settings = await getStoreSettings();

        const items: Omit<ChallanItem, 'id' | 'challan_id'>[] = orderItems.map((item: any, index: number) => ({
            sr_no: index + 1,
            product_id: item.product,
            variant_id: item.variant,
            description: item.description || 'Item',
            hsn_code: '7113',
            quantity: item.quantity,
            unit: 'PCS',
            unit_price: item.unit_price,
            taxable_value: item.quantity * item.unit_price,
            gst_rate: item.tax_rate || 3,
            cgst_rate: (item.tax_rate || 3) / 2,
            cgst_amount: (item.quantity * item.unit_price * ((item.tax_rate || 3) / 2)) / 100,
            sgst_rate: (item.tax_rate || 3) / 2,
            sgst_amount: (item.quantity * item.unit_price * ((item.tax_rate || 3) / 2)) / 100,
            igst_rate: 0,
            igst_amount: 0,
            total: item.total || item.quantity * item.unit_price,
        }));

        const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
        const taxableValue = items.reduce((sum, item) => sum + item.taxable_value, 0);
        const cgstAmount = items.reduce((sum, item) => sum + item.cgst_amount, 0);
        const sgstAmount = items.reduce((sum, item) => sum + item.sgst_amount, 0);

        const challan: Omit<DeliveryChallan, 'id' | 'challan_number' | 'created_at' | 'updated_at'> = {
            challan_date: new Date().toISOString().split('T')[0],
            challan_type: challanType,
            status: 'draft',
            consignor_name: settings.store_name,
            consignor_gstin: settings.store_gstin,
            consignor_address: `${settings.store_address}, ${settings.store_city}, ${settings.store_state} - ${settings.store_pincode}`,
            consignor_state_code: settings.store_state_code,
            consignee_name: order.customer_name,
            consignee_address: order.shipping_address,
            sales_order_id: orderId,
            total_quantity: totalQuantity,
            taxable_value: taxableValue,
            cgst_amount: cgstAmount,
            sgst_amount: sgstAmount,
            igst_amount: 0,
            total_value: order.total,
            reason: `Delivery against Order ${order.order_number}`,
        };

        return await createChallan(challan, items);
    } catch (error) {
        console.error('Error generating challan from order:', error);
        toast.error('Failed to generate challan from order');
        return { success: false };
    }
}
