/**
 * Returns & Credit Notes Service
 * Handles product returns and credit note generation
 */

import { supabase } from './supabase';

// ===========================================
// TYPES
// ===========================================

export type ReturnReason =
    | 'defective'
    | 'wrong_item'
    | 'size_exchange'
    | 'customer_request'
    | 'quality_issue'
    | 'other';

export type CreditNoteStatus = 'pending' | 'approved' | 'refunded' | 'cancelled';

export interface CreditNote {
    id?: string;
    credit_note_number?: string;
    original_invoice_id?: string;
    original_sale_id?: string;
    return_reason: ReturnReason;
    notes?: string;
    buyer_name: string;
    buyer_address?: string;
    buyer_gstin?: string;
    buyer_state_code?: string;
    taxable_value: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_tax: number;
    grand_total: number;
    status: CreditNoteStatus;
    refund_method?: string;
    refund_reference?: string;
    refunded_at?: string;
    created_at?: string;
    items?: CreditNoteItem[];
}

export interface CreditNoteItem {
    id?: string;
    credit_note_id?: string;
    variant_id?: string;
    original_invoice_item_id?: string;
    description: string;
    hsn_code?: string;
    quantity: number;
    unit_price: number;
    discount_percent?: number;
    discount_amount?: number;
    taxable_amount: number;
    gst_rate: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_amount: number;
}

// ===========================================
// CREDIT NOTE CRUD
// ===========================================

export async function getCreditNotes(filters?: {
    status?: CreditNoteStatus;
    startDate?: string;
    endDate?: string;
}): Promise<CreditNote[]> {
    let query = supabase
        .from('credit_notes')
        .select('*')
        .order('created_at', { ascending: false });

    if (filters?.status) {
        query = query.eq('status', filters.status);
    }
    if (filters?.startDate) {
        query = query.gte('created_at', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('created_at', filters.endDate);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Error fetching credit notes:', error);
        return [];
    }
    return data || [];
}

export async function getCreditNote(id: string): Promise<CreditNote | null> {
    const { data, error } = await supabase
        .from('credit_notes')
        .select(`
            *,
            items:credit_note_items(*)
        `)
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching credit note:', error);
        return null;
    }
    return data;
}

export async function createCreditNote(
    creditNote: Omit<CreditNote, 'id' | 'credit_note_number' | 'created_at' | 'status'>,
    items: Omit<CreditNoteItem, 'id' | 'credit_note_id'>[]
): Promise<CreditNote> {
    // Create credit note
    const { data: cn, error: cnError } = await supabase
        .from('credit_notes')
        .insert({
            original_invoice_id: creditNote.original_invoice_id,
            original_sale_id: creditNote.original_sale_id,
            return_reason: creditNote.return_reason,
            notes: creditNote.notes,
            buyer_name: creditNote.buyer_name,
            buyer_address: creditNote.buyer_address,
            buyer_gstin: creditNote.buyer_gstin,
            buyer_state_code: creditNote.buyer_state_code,
            taxable_value: creditNote.taxable_value,
            cgst_amount: creditNote.cgst_amount,
            sgst_amount: creditNote.sgst_amount,
            igst_amount: creditNote.igst_amount,
            total_tax: creditNote.total_tax,
            grand_total: creditNote.grand_total,
            status: 'pending',
        })
        .select()
        .single();

    if (cnError) throw cnError;

    // Create items
    if (items.length > 0) {
        const itemsWithCN = items.map(item => ({
            ...item,
            credit_note_id: cn.id,
        }));

        const { error: itemsError } = await supabase
            .from('credit_note_items')
            .insert(itemsWithCN);

        if (itemsError) throw itemsError;
    }

    return cn;
}

// ===========================================
// STATUS MANAGEMENT
// ===========================================

export async function approveCreditNote(id: string): Promise<void> {
    const { error } = await supabase
        .from('credit_notes')
        .update({
            status: 'approved',
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);

    if (error) throw error;
}

export async function processRefund(
    id: string,
    refundMethod: string,
    refundReference?: string
): Promise<void> {
    const { error } = await supabase
        .from('credit_notes')
        .update({
            status: 'refunded',
            refund_method: refundMethod,
            refund_reference: refundReference,
            refunded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);

    if (error) throw error;
}

export async function cancelCreditNote(id: string): Promise<void> {
    const { error } = await supabase
        .from('credit_notes')
        .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
        })
        .eq('id', id);

    if (error) throw error;
}

// ===========================================
// CREATE FROM INVOICE
// ===========================================

export async function createReturnFromInvoice(
    invoiceId: string,
    returnItems: { invoice_item_id: string; quantity: number }[],
    reason: ReturnReason,
    notes?: string
): Promise<CreditNote> {
    // Fetch original invoice
    const { data: invoice, error: invError } = await supabase
        .from('invoices')
        .select(`
            *,
            items:invoice_items(*)
        `)
        .eq('id', invoiceId)
        .single();

    if (invError || !invoice) throw new Error('Invoice not found');

    // Filter items being returned
    const itemsToReturn = invoice.items.filter((item: any) =>
        returnItems.some(ri => ri.invoice_item_id === item.id)
    );

    // Calculate totals
    let taxableValue = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    const creditNoteItems: Omit<CreditNoteItem, 'id' | 'credit_note_id'>[] = itemsToReturn.map((item: any) => {
        const returnItem = returnItems.find(ri => ri.invoice_item_id === item.id)!;
        const qty = returnItem.quantity;

        const itemTaxable = (item.taxable_amount / item.quantity) * qty;
        const itemCgst = (item.cgst_amount / item.quantity) * qty;
        const itemSgst = (item.sgst_amount / item.quantity) * qty;
        const itemIgst = (item.igst_amount / item.quantity) * qty;
        const itemTotal = itemTaxable + itemCgst + itemSgst + itemIgst;

        taxableValue += itemTaxable;
        cgstAmount += itemCgst;
        sgstAmount += itemSgst;
        igstAmount += itemIgst;

        return {
            variant_id: item.variant_id,
            original_invoice_item_id: item.id,
            description: item.description,
            hsn_code: item.hsn_code,
            quantity: qty,
            unit_price: item.unit_price,
            discount_percent: item.discount_percent,
            discount_amount: (item.discount_amount / item.quantity) * qty,
            taxable_amount: itemTaxable,
            gst_rate: item.gst_rate,
            cgst_amount: itemCgst,
            sgst_amount: itemSgst,
            igst_amount: itemIgst,
            total_amount: itemTotal,
        };
    });

    const totalTax = cgstAmount + sgstAmount + igstAmount;
    const grandTotal = taxableValue + totalTax;

    return createCreditNote(
        {
            original_invoice_id: invoiceId,
            return_reason: reason,
            notes,
            buyer_name: invoice.buyer_name,
            buyer_address: invoice.buyer_address,
            buyer_gstin: invoice.buyer_gstin,
            buyer_state_code: invoice.buyer_state_code,
            taxable_value: taxableValue,
            cgst_amount: cgstAmount,
            sgst_amount: sgstAmount,
            igst_amount: igstAmount,
            total_tax: totalTax,
            grand_total: grandTotal,
        },
        creditNoteItems
    );
}

// ===========================================
// STATS
// ===========================================

export async function getReturnsStats(): Promise<{
    totalReturns: number;
    pendingCount: number;
    totalValue: number;
    thisMonth: number;
}> {
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const { count: totalReturns } = await supabase
        .from('credit_notes')
        .select('*', { count: 'exact', head: true });

    const { count: pendingCount } = await supabase
        .from('credit_notes')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    const { data: valueData } = await supabase
        .from('credit_notes')
        .select('grand_total')
        .in('status', ['approved', 'refunded']);

    const totalValue = valueData?.reduce((sum, cn) => sum + (cn.grand_total || 0), 0) || 0;

    const { count: thisMonthCount } = await supabase
        .from('credit_notes')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thisMonth.toISOString());

    return {
        totalReturns: totalReturns || 0,
        pendingCount: pendingCount || 0,
        totalValue,
        thisMonth: thisMonthCount || 0,
    };
}
