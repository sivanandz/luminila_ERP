/**
 * Returns & Credit Notes Service
 * Handles product returns and credit note generation using PocketBase
 */

import { pb } from './pocketbase';

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

export type CreditNoteStatus = 'pending' | 'approved' | 'refunded' | 'exchanged' | 'cancelled';

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
// NUMBER GENERATION
// ===========================================
async function generateCreditNoteNumber(): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const seqName = `cn_${yymm}`;

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
                prefix: 'CN',
                current_value: nextValue,
                padding: 5,
            });
        }

        return `CN/${yymm}/${nextValue.toString().padStart(5, '0')}`;
    } catch (error) {
        console.error('Error generating credit note number:', error);
        return `CN/${Date.now()}`;
    }
}

// ===========================================
// CREDIT NOTE CRUD
// ===========================================

export async function getCreditNotes(filters?: {
    status?: CreditNoteStatus;
    startDate?: string;
    endDate?: string;
}): Promise<CreditNote[]> {
    try {
        const filterParts: string[] = [];

        if (filters?.status) {
            filterParts.push(`status="${filters.status}"`);
        }
        if (filters?.startDate) {
            filterParts.push(`created>="${filters.startDate}"`);
        }
        if (filters?.endDate) {
            filterParts.push(`created<="${filters.endDate}"`);
        }

        const records = await pb.collection('credit_notes').getFullList({
            filter: filterParts.join(' && ') || '',
            sort: '-created',
        });

        return records.map((cn: any) => ({
            id: cn.id,
            credit_note_number: cn.credit_note_number,
            original_invoice_id: cn.original_invoice,
            original_sale_id: cn.original_sale,
            return_reason: cn.return_reason,
            notes: cn.notes,
            buyer_name: cn.buyer_name,
            buyer_address: cn.buyer_address,
            buyer_gstin: cn.buyer_gstin,
            buyer_state_code: cn.buyer_state_code,
            taxable_value: cn.taxable_value,
            cgst_amount: cn.cgst_amount || 0,
            sgst_amount: cn.sgst_amount || 0,
            igst_amount: cn.igst_amount || 0,
            total_tax: cn.total_tax || 0,
            grand_total: cn.grand_total,
            status: cn.status,
            refund_method: cn.refund_method,
            refund_reference: cn.refund_reference,
            refunded_at: cn.refunded_at,
            created_at: cn.created,
        }));
    } catch (error) {
        console.error('Error fetching credit notes:', error);
        return [];
    }
}

export async function getCreditNote(id: string): Promise<CreditNote | null> {
    try {
        const cn = await pb.collection('credit_notes').getOne(id);
        const items = await pb.collection('credit_note_items').getFullList({
            filter: `credit_note="${id}"`,
        });

        return {
            id: cn.id,
            credit_note_number: cn.credit_note_number,
            original_invoice_id: cn.original_invoice,
            original_sale_id: cn.original_sale,
            return_reason: cn.return_reason,
            notes: cn.notes,
            buyer_name: cn.buyer_name,
            buyer_address: cn.buyer_address,
            buyer_gstin: cn.buyer_gstin,
            buyer_state_code: cn.buyer_state_code,
            taxable_value: cn.taxable_value,
            cgst_amount: cn.cgst_amount || 0,
            sgst_amount: cn.sgst_amount || 0,
            igst_amount: cn.igst_amount || 0,
            total_tax: cn.total_tax || 0,
            grand_total: cn.grand_total,
            status: cn.status,
            refund_method: cn.refund_method,
            refund_reference: cn.refund_reference,
            refunded_at: cn.refunded_at,
            created_at: cn.created,
            items: items.map((item: any) => ({
                id: item.id,
                credit_note_id: item.credit_note,
                variant_id: item.variant,
                original_invoice_item_id: item.original_invoice_item,
                description: item.description,
                hsn_code: item.hsn_code,
                quantity: item.quantity,
                unit_price: item.unit_price,
                discount_percent: item.discount_percent,
                discount_amount: item.discount_amount,
                taxable_amount: item.taxable_amount,
                gst_rate: item.gst_rate,
                cgst_amount: item.cgst_amount || 0,
                sgst_amount: item.sgst_amount || 0,
                igst_amount: item.igst_amount || 0,
                total_amount: item.total_amount,
            })),
        };
    } catch (error) {
        console.error('Error fetching credit note:', error);
        return null;
    }
}

export async function createCreditNote(
    creditNote: Omit<CreditNote, 'id' | 'credit_note_number' | 'created_at' | 'status'>,
    items: Omit<CreditNoteItem, 'id' | 'credit_note_id'>[]
): Promise<CreditNote> {
    const cnNumber = await generateCreditNoteNumber();

    const cn = await pb.collection('credit_notes').create({
        credit_note_number: cnNumber,
        original_invoice: creditNote.original_invoice_id || '',
        original_sale: creditNote.original_sale_id || '',
        return_reason: creditNote.return_reason,
        notes: creditNote.notes || '',
        buyer_name: creditNote.buyer_name,
        buyer_address: creditNote.buyer_address || '',
        buyer_gstin: creditNote.buyer_gstin || '',
        buyer_state_code: creditNote.buyer_state_code || '',
        taxable_value: creditNote.taxable_value,
        cgst_amount: creditNote.cgst_amount,
        sgst_amount: creditNote.sgst_amount,
        igst_amount: creditNote.igst_amount,
        total_tax: creditNote.total_tax,
        grand_total: creditNote.grand_total,
        status: 'pending',
    });

    // Create items
    for (const item of items) {
        await pb.collection('credit_note_items').create({
            credit_note: cn.id,
            variant: item.variant_id || '',
            original_invoice_item: item.original_invoice_item_id || '',
            description: item.description,
            hsn_code: item.hsn_code || '',
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_percent: item.discount_percent || 0,
            discount_amount: item.discount_amount || 0,
            taxable_amount: item.taxable_amount,
            gst_rate: item.gst_rate,
            cgst_amount: item.cgst_amount,
            sgst_amount: item.sgst_amount,
            igst_amount: item.igst_amount,
            total_amount: item.total_amount,
        });
    }

    return {
        ...creditNote,
        id: cn.id,
        credit_note_number: cnNumber,
        status: 'pending',
        created_at: cn.created,
    };
}

// ===========================================
// STATUS MANAGEMENT
// ===========================================

export async function approveCreditNote(id: string): Promise<void> {
    await pb.collection('credit_notes').update(id, { status: 'approved' });
}

export async function processRefund(
    id: string,
    refundMethod: string,
    refundReference?: string
): Promise<void> {
    await pb.collection('credit_notes').update(id, {
        status: 'refunded',
        refund_method: refundMethod,
        refund_reference: refundReference || '',
        refunded_at: new Date().toISOString(),
    });
}

export async function cancelCreditNote(id: string): Promise<void> {
    await pb.collection('credit_notes').update(id, { status: 'cancelled' });
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
    const invoice = await pb.collection('invoices').getOne(invoiceId);
    const invoiceItems = await pb.collection('invoice_items').getFullList({
        filter: `invoice="${invoiceId}"`,
    });

    // Filter items being returned
    const itemsToReturn = invoiceItems.filter((item: any) =>
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
        const itemCgst = ((item.cgst_amount || 0) / item.quantity) * qty;
        const itemSgst = ((item.sgst_amount || 0) / item.quantity) * qty;
        const itemIgst = ((item.igst_amount || 0) / item.quantity) * qty;
        const itemTotal = itemTaxable + itemCgst + itemSgst + itemIgst;

        taxableValue += itemTaxable;
        cgstAmount += itemCgst;
        sgstAmount += itemSgst;
        igstAmount += itemIgst;

        return {
            variant_id: item.variant,
            original_invoice_item_id: item.id,
            description: item.description,
            hsn_code: item.hsn_code,
            quantity: qty,
            unit_price: item.unit_price,
            discount_percent: item.discount_percent,
            discount_amount: ((item.discount_amount || 0) / item.quantity) * qty,
            taxable_amount: itemTaxable,
            gst_rate: item.gst_rate || 0,
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
    try {
        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);

        const allCNs = await pb.collection('credit_notes').getFullList();
        const totalReturns = allCNs.length;
        const pendingCount = allCNs.filter((cn: any) => cn.status === 'pending').length;
        const totalValue = allCNs
            .filter((cn: any) => cn.status === 'approved' || cn.status === 'refunded')
            .reduce((sum: number, cn: any) => sum + (cn.grand_total || 0), 0);
        const thisMonthCount = allCNs.filter((cn: any) => new Date(cn.created) >= thisMonth).length;

        return {
            totalReturns,
            pendingCount,
            totalValue,
            thisMonth: thisMonthCount,
        };
    } catch (error) {
        console.error('Error fetching returns stats:', error);
        return { totalReturns: 0, pendingCount: 0, totalValue: 0, thisMonth: 0 };
    }
}

// ===========================================
// EXCHANGE PROCESSING
// ===========================================

export interface ExchangeItem {
    variant_id: string;
    quantity: number;
    unit_price: number;
    description: string;
}

export interface ExchangeResult {
    creditNoteId: string;
    exchangedItems: ExchangeItem[];
    creditUsed: number;
    balanceDue: number;
    newSaleId?: string;
}

export async function processExchange(
    creditNoteId: string,
    newItems: ExchangeItem[],
    notes?: string
): Promise<ExchangeResult> {
    const creditNote = await getCreditNote(creditNoteId);
    if (!creditNote) {
        throw new Error('Credit note not found');
    }

    if (creditNote.status !== 'approved') {
        throw new Error('Credit note must be approved before exchange');
    }

    const newItemsTotal = newItems.reduce(
        (sum, item) => sum + (item.unit_price * item.quantity),
        0
    );

    const creditValue = creditNote.grand_total;
    const balanceDue = newItemsTotal - creditValue;

    await pb.collection('credit_notes').update(creditNoteId, {
        status: 'exchanged',
        refund_method: 'exchange',
        refund_reference: `Exchange: ${newItems.map(i => i.description).join(', ')}`,
        notes: notes ? `${creditNote.notes || ''}\n\nExchange Notes: ${notes}` : creditNote.notes,
        refunded_at: new Date().toISOString(),
    });

    return {
        creditNoteId,
        exchangedItems: newItems,
        creditUsed: Math.min(creditValue, newItemsTotal),
        balanceDue,
    };
}

export async function getExchangeEligibleCreditNotes(): Promise<CreditNote[]> {
    try {
        const records = await pb.collection('credit_notes').getFullList({
            filter: 'status="approved"',
            sort: '-created',
        });

        return records.map((cn: any) => ({
            id: cn.id,
            credit_note_number: cn.credit_note_number,
            original_invoice_id: cn.original_invoice,
            original_sale_id: cn.original_sale,
            return_reason: cn.return_reason,
            notes: cn.notes,
            buyer_name: cn.buyer_name,
            buyer_address: cn.buyer_address,
            buyer_gstin: cn.buyer_gstin,
            buyer_state_code: cn.buyer_state_code,
            taxable_value: cn.taxable_value,
            cgst_amount: cn.cgst_amount || 0,
            sgst_amount: cn.sgst_amount || 0,
            igst_amount: cn.igst_amount || 0,
            total_tax: cn.total_tax || 0,
            grand_total: cn.grand_total,
            status: cn.status,
            refund_method: cn.refund_method,
            refund_reference: cn.refund_reference,
            refunded_at: cn.refunded_at,
            created_at: cn.created,
        }));
    } catch (error) {
        console.error('Error fetching exchange-eligible credit notes:', error);
        return [];
    }
}
