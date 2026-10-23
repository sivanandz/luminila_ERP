/**
 * Returns & Credit Notes Service
 * Handles product returns and credit note generation using PocketBase
 */

import { pb } from './pocketbase';
import { getNextSequenceNumber, createWithUniqueRetry } from './sequence-generator';
import { normalizeDateBounds } from './utils';
import { calculateGST, GST_RATES } from './gst';
import { createInvoice, getStoreSettings, type Invoice, type InvoiceItem } from './invoice';
import { getCurrentShift, recordCashRefund } from './register';
import { validateReturnQuantities } from './returns-policy';
import { splitExclusiveLine, toPaise, toRupees } from './invoice-math';
import type { ProductVariant } from '@/types/database';

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

// Raw PocketBase record shapes (DB field names) for credit note collections.
interface CreditNoteRecord {
    id: string;
    credit_note_number?: string;
    original_invoice?: string;
    original_sale?: string;
    return_reason: ReturnReason;
    notes?: string;
    buyer_name: string;
    buyer_address?: string;
    buyer_gstin?: string;
    buyer_state_code?: string;
    taxable_value: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    total_tax?: number;
    grand_total: number;
    status: CreditNoteStatus;
    refund_method?: string;
    refund_reference?: string;
    refunded_at?: string;
    created: string;
}

interface CreditNoteItemRecord {
    id: string;
    credit_note?: string;
    variant?: string;
    original_invoice_item?: string;
    description: string;
    hsn_code?: string;
    quantity: number;
    unit_price: number;
    discount_percent?: number;
    discount_amount?: number;
    taxable_amount: number;
    gst_rate: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    total_amount: number;
}

// Raw invoice_items record fields consumed when building a return from an invoice.
interface InvoiceItemRecord {
    id: string;
    variant?: string;
    description: string;
    hsn_code?: string;
    quantity: number;
    unit_price: number;
    discount_percent?: number;
    discount_amount?: number;
    taxable_amount: number;
    gst_rate?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
}

// ===========================================
// NUMBER GENERATION
// ===========================================
export async function generateCreditNoteNumber(): Promise<string> {
    const today = new Date();
    const yymm = `${today.getFullYear().toString().slice(-2)}${(today.getMonth() + 1).toString().padStart(2, '0')}`;
    const seqName = `cn_${yymm}`;

    return getNextSequenceNumber({
        seqName,
        prefix: 'CN',
        padding: 5,
        formatFn: (nextValue) => `CN/${yymm}/${nextValue.toString().padStart(5, '0')}`,
    });
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
        const { start, end } = normalizeDateBounds(filters?.startDate, filters?.endDate);
        if (start) {
            filterParts.push(`created>="${start}"`);
        }
        if (end) {
            filterParts.push(`created<="${end}"`);
        }

        const records = await pb.collection('credit_notes').getFullList<CreditNoteRecord>({
            filter: filterParts.join(' && ') || '',
            sort: '-created',
        });

        return records.map((cn) => ({
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
        const cn = await pb.collection('credit_notes').getOne<CreditNoteRecord>(id);
        const items = await pb.collection('credit_note_items').getFullList<CreditNoteItemRecord>({
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
            items: items.map((item) => ({
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
    let allocatedCnNumber = '';
    const accountEmail = (pb.authStore.model as any)?.email || '';
    const cn = await createWithUniqueRetry(
        generateCreditNoteNumber,
        (allocatedNumber) => {
            allocatedCnNumber = allocatedNumber;
            return pb.collection('credit_notes').create({
                account_email: accountEmail,
                credit_note_number: allocatedNumber,
                original_invoice: creditNote.original_invoice_id || '',
                invoice: creditNote.original_invoice_id || '',
                original_sale: creditNote.original_sale_id || '',
                return_reason: creditNote.return_reason,
                reason: creditNote.return_reason || '',
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
                amount: creditNote.grand_total,
                status: 'pending',
            });
        }
    );

    // Create items
    for (const item of items) {
        await pb.collection('credit_note_items').create({
            account_email: accountEmail,
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
            total: item.total_amount,
        });
    }

    return {
        ...creditNote,
        id: cn.id,
        credit_note_number: cn.credit_note_number || allocatedCnNumber,
        status: 'pending',
        created_at: cn.created,
    };
}

// ===========================================
// STATUS MANAGEMENT
// ===========================================

export interface ApproveCreditNoteOptions {
    routeDefectiveToQuarantine?: boolean;
    discrepancyType?: 'damaged' | 'missing' | 'vendor_replacement';
    vendorName?: string;
    notes?: string;
    flaggedBy?: string;
}

export async function approveCreditNote(id: string, options?: ApproveCreditNoteOptions): Promise<void> {
    const cn = await pb.collection('credit_notes').getOne(id);

    // Idempotency guard: a note that is already settled must never have its
    // inventory side effects (restock / stock_discrepancies records) re-run.
    if (cn.status === 'approved' || cn.status === 'refunded' || cn.status === 'exchanged') {
        return;
    }

    if (cn.status === 'cancelled') {
        throw new Error(`Credit note ${cn.credit_note_number || id} is cancelled and cannot be approved`);
    }

    // Claim the status transition BEFORE running inventory side effects. PocketBase
    // has no conditional update, so check-then-act cannot be made fully atomic from
    // the client; claiming first shrinks the concurrent-approval race window from
    // the whole multi-request inventory branch down to the read-then-claim pair —
    // a second terminal that reads after this claim sees 'approved' and skips the
    // branch instead of double-restocking or duplicating stock_discrepancies.
    await pb.collection('credit_notes').update(id, { status: 'approved' });

    try {
        const items = await pb.collection('credit_note_items').getFullList({
            filter: `credit_note="${id}"`
        });

        const isQuarantine = options?.routeDefectiveToQuarantine ?? (cn.return_reason === 'defective' || cn.return_reason === 'quality_issue');

        for (const item of items) {
            if (item.quantity > 0) {
                if (isQuarantine) {
                    // 1. Quarantined / Defective goods: DO NOT restore to sellable inventory.
                    // Log quarantine movement and create stock_discrepancies record
                    if (item.variant) {
                        await pb.collection('stock_movements').create({
                            variant: item.variant,
                            movement_type: 'quarantine',
                            quantity: item.quantity,
                            reference_id: id,
                            source: 'customer_return_quarantine',
                            notes: `Defective customer return held in quarantine (Return #${cn.credit_note_number || id})`,
                        }).catch((err) => console.warn('Failed to log quarantine movement for return:', err));
                    }

                    // Register discrepancy in quarantine ledger
                    await pb.collection('stock_discrepancies').create({
                        product: '',
                        variant: item.variant || '',
                        sku: item.description,
                        product_name: item.description,
                        discrepancy_type: options?.discrepancyType || 'damaged',
                        quantity: item.quantity,
                        vendor_name: options?.vendorName || '',
                        reason: `Defective customer return #${cn.credit_note_number || id} (${cn.return_reason})`,
                        notes: options?.notes || `Customer: ${cn.buyer_name}. Routed to quarantine on approval.`,
                        status: 'active',
                        flagged_by: options?.flaggedBy || 'Staff',
                    }).catch((err) => console.warn('Failed to create stock discrepancy for return:', err));
                } else {
                    // 2. Resellable condition: Restore stock to variant
                    if (item.variant) {
                        try {
                            await pb.collection('product_variants').update(item.variant, {
                                'stock_level+': item.quantity
                            });

                            await pb.collection('stock_movements').create({
                                variant: item.variant,
                                movement_type: 'return',
                                quantity: item.quantity,
                                reference_id: id,
                                source: 'credit_note',
                                notes: `Restock from Return #${cn.credit_note_number || id}`
                            }).catch((err) => console.warn('Failed to log stock movement for return:', err));
                        } catch (variantErr) {
                            console.warn(`Could not restore stock for variant ${item.variant}:`, variantErr);
                        }
                    }
                }
            }
        }
    } catch (itemErr) {
        console.error('Error handling inventory for credit note:', itemErr);
    }
}

export async function processRefund(
    id: string,
    refundMethod: string,
    refundReference?: string
): Promise<void> {
    const cn = await pb.collection('credit_notes').getOne<{
        id: string;
        status?: string;
        grand_total?: number;
        credit_note_number?: string;
        buyer_name?: string;
    }>(id);

    // A refund settles an approved note exactly once.
    if (cn.status === 'refunded' || cn.status === 'exchanged') return;
    if (cn.status !== 'approved') {
        throw new Error(`Credit note ${cn.credit_note_number || id} must be approved before it can be refunded`);
    }

    const amount = Number(cn.grand_total) || 0;
    const method = String(refundMethod || 'cash').toLowerCase();
    const reference = refundReference || `REFUND-${cn.credit_note_number || id}`;

    await pb.collection('credit_notes').update(id, {
        status: 'refunded',
        refund_method: method,
        refund_reference: reference,
        refunded_at: new Date().toISOString(),
    });

    // Only cash leaves the drawer. Bank, UPI, and store credit settle elsewhere.
    if (method !== 'cash' || amount <= 0) return;

    const userId = pb.authStore.model?.id || '';
    const shift = userId ? await getCurrentShift(userId) : null;

    if (!shift) {
        // No open shift means no till to reconcile. Keep the refund visible
        // rather than pretending it reached a drawer.
        await pb.collection('activity_logs').create({
            action: 'CASH_REFUND_OUTSIDE_SHIFT',
            entity_type: 'credit_notes',
            entity_id: id,
            description: `Cash refund of ${amount} for ${cn.credit_note_number || id} processed with no open shift.`,
            metadata: JSON.stringify({ amount, method, reference, customer: cn.buyer_name || '' }),
        }).catch(() => {});
        return;
    }

    const recorded = await recordCashRefund(
        shift.id,
        amount,
        `Refund for credit note ${cn.credit_note_number || id} (${cn.buyer_name || 'customer'})`,
        userId
    );

    if (!recorded) {
        // Nothing reached the drawer, so put the note back to approved and let
        // the caller retry instead of leaving a refunded note with no cash trail.
        await pb.collection('credit_notes')
            .update(id, { status: 'approved', refund_method: '', refund_reference: '', refunded_at: '' })
            .catch(() => {});
        throw new Error('Cash drawer entry failed; refund was rolled back');
    }
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
    const invoice = await pb.collection('invoices').getOne<Invoice>(invoiceId);
    const invoiceItems = await pb.collection('invoice_items').getFullList<InvoiceItemRecord>({
        filter: `invoice="${invoiceId}"`,
    });

    // Filter items being returned
    const itemsToReturn = invoiceItems.filter((item) =>
        returnItems.some(ri => ri.invoice_item_id === item.id)
    );

    // Reject over-return: a line can only be returned up to what remains after
    // every non-cancelled credit note that already references it. The form used
    // to cap each request in isolation, so two visits could credit double.
    const requestedIds = new Set(returnItems.map((ri) => ri.invoice_item_id));
    const matchedIds = new Set(itemsToReturn.map((item) => item.id));
    const unknownIds = [...requestedIds].filter((itemId) => !matchedIds.has(itemId));
    if (unknownIds.length > 0) {
        throw new Error(`Invoice item(s) not found on this invoice: ${unknownIds.join(', ')}`);
    }

    const priorReturns = await pb
        .collection('credit_note_items')
        .getFullList<{ original_invoice_item?: string; quantity?: number }>({
            filter: `credit_note.original_invoice="${invoiceId}" && credit_note.status != "cancelled"`,
            fields: 'original_invoice_item,quantity',
        })
        .catch(() => []);

    const priorByItem = new Map<string, number>();
    for (const prior of priorReturns) {
        if (!prior.original_invoice_item) continue;
        priorByItem.set(
            prior.original_invoice_item,
            (priorByItem.get(prior.original_invoice_item) || 0) + (prior.quantity || 0)
        );
    }

    const validation = validateReturnQuantities(
        itemsToReturn.map((item) => ({
            invoiceItemId: item.id,
            description: item.description,
            ordered: item.quantity,
            alreadyReturned: priorByItem.get(item.id) || 0,
            requested: returnItems.find((ri) => ri.invoice_item_id === item.id)?.quantity || 0,
        }))
    );
    if (!validation.ok) {
        throw new Error(validation.errors.join(' '));
    }

    // Calculate totals
    let taxableValue = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    const creditNoteItems: Omit<CreditNoteItem, 'id' | 'credit_note_id'>[] = itemsToReturn.map((item) => {
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

        const allCNs = await pb.collection('credit_notes').getFullList<CreditNoteRecord>();
        const totalReturns = allCNs.length;
        const pendingCount = allCNs.filter((cn) => cn.status === 'pending').length;
        const totalValue = allCNs
            .filter((cn) => cn.status === 'approved' || cn.status === 'refunded')
            .reduce((sum: number, cn) => sum + (cn.grand_total || 0), 0);
        const thisMonthCount = allCNs.filter((cn) => new Date(cn.created) >= thisMonth).length;

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
// EXCHANGE & REPLACEMENT PROCESSING
// ===========================================

export interface ExchangeItem {
    variant_id: string;
    product_id?: string;
    sku?: string;
    quantity: number;
    unit_price: number;
    description: string;
}

export interface ProcessExchangeOptions {
    paymentMethod?: string;
    paymentReference?: string;
    notes?: string;
    processedBy?: string;
}

export interface ExchangeResult {
    creditNoteId: string;
    exchangedItems: ExchangeItem[];
    creditUsed: number;
    replacementTotal: number; // tax-inclusive (incl. GST) replacement value
    balanceDue: number; // >0: customer paid extra, <0: store refunded difference, 0: exact match
    paymentMethod?: string;
    paymentReference?: string;
    invoicePaymentId?: string;
}

export interface ExchangeResult {
    creditNoteId: string;
    exchangedItems: ExchangeItem[];
    creditUsed: number;
    replacementTotal: number; // tax-inclusive (incl. GST) replacement value
    balanceDue: number; // >0: customer paid extra, <0: store refunded difference, 0: exact match
    paymentMethod?: string;
    paymentReference?: string;
    invoicePaymentId?: string;
    exchangeInvoiceId?: string;
}

/**
 * Raise the tax document for replacement goods.
 *
 * Exchange unit prices are the pre-tax base prices, so GST is added on top.
 * This is what makes the replacement a recorded supply instead of stock that
 * leaves the store with no invoice behind it.
 */
async function createExchangeInvoice(
    creditNote: CreditNote,
    lines: ExchangeItem[],
    balanceDue: number,
    paymentMethod: string
): Promise<{ invoiceId: string; invoiceNumber: string; grandTotal: number }> {
    const store = await getStoreSettings();
    const sellerState = store.store_state_code || '27';
    const buyerState = creditNote.buyer_state_code || sellerState;
    const gstEnabled = store.is_gst_registered !== false;
    const rate = gstEnabled ? GST_RATES.JEWELRY : 0;

    const items: InvoiceItem[] = lines.map((line, index) => {
        const split = splitExclusiveLine(toPaise(line.unit_price * line.quantity), rate, sellerState, buyerState);
        return {
            variant_id: line.variant_id,
            sr_no: index + 1,
            description: line.description,
            hsn_code: '7113',
            quantity: line.quantity,
            unit: 'PCS',
            unit_price: line.unit_price,
            discount_percent: 0,
            discount_amount: 0,
            taxable_amount: toRupees(split.taxablePaise),
            gst_rate: rate,
            cgst_rate: split.cgstRate,
            cgst_amount: toRupees(split.cgstPaise),
            sgst_rate: split.sgstRate,
            sgst_amount: toRupees(split.sgstPaise),
            igst_rate: split.igstRate,
            igst_amount: toRupees(split.igstPaise),
            cess_rate: 0,
            cess_amount: 0,
            total_amount: toRupees(split.totalPaise),
        };
    });

    const taxable = items.reduce((sum, item) => sum + toPaise(item.taxable_amount), 0);
    const cgst = items.reduce((sum, item) => sum + toPaise(item.cgst_amount), 0);
    const sgst = items.reduce((sum, item) => sum + toPaise(item.sgst_amount), 0);
    const igst = items.reduce((sum, item) => sum + toPaise(item.igst_amount), 0);
    const grandTotal = items.reduce((sum, item) => sum + toPaise(item.total_amount), 0);

    const invoice = await createInvoice({
        invoice_date: new Date().toISOString(),
        invoice_type: 'regular',
        seller_gstin: gstEnabled ? (store.store_gstin || '') : '',
        seller_name: store.store_name || 'Luminila Jewelry',
        seller_address: [store.store_address, store.store_city].filter(Boolean).join(', '),
        seller_state_code: sellerState,
        buyer_name: creditNote.buyer_name || 'Walk-in Customer',
        buyer_gstin: creditNote.buyer_gstin || '',
        buyer_phone: '',
        buyer_email: '',
        buyer_address: creditNote.buyer_address || '',
        buyer_state_code: buyerState,
        place_of_supply: buyerState,
        status: balanceDue > 0 ? 'pending' : 'paid',
        subtotal: toRupees(taxable),
        tax: toRupees(cgst + sgst + igst),
        discount: 0,
        total: toRupees(grandTotal),
        taxable_value: toRupees(taxable),
        cgst_amount: toRupees(cgst),
        sgst_amount: toRupees(sgst),
        igst_amount: toRupees(igst),
        cess_amount: 0,
        total_tax: toRupees(cgst + sgst + igst),
        discount_amount: 0,
        shipping_charges: 0,
        grand_total: toRupees(grandTotal),
        amount_in_words: '',
        is_reverse_charge: false,
        payment_terms: store.invoice_terms,
        is_paid: balanceDue <= 0,
        paid_amount: balanceDue <= 0 ? toRupees(grandTotal) : 0,
        notes: `Exchange against credit note ${creditNote.credit_note_number || creditNote.id || ''} (${paymentMethod.toUpperCase()})`,
        items,
    });

    return {
        invoiceId: invoice.id as string,
        invoiceNumber: invoice.invoice_number || '',
        grandTotal: toRupees(grandTotal),
    };
}

export async function processExchange(
    creditNoteId: string,
    newItems: ExchangeItem[],
    optionsOrNotes?: string | ProcessExchangeOptions
): Promise<ExchangeResult> {
    const creditNote = await getCreditNote(creditNoteId);
    if (!creditNote) {
        throw new Error('Credit note not found');
    }

    if (creditNote.status !== 'approved') {
        throw new Error('Credit note must be approved before exchange');
    }

    if (!newItems || newItems.length === 0) {
        throw new Error('At least one replacement item must be selected');
    }

    // Normalize options
    const options: ProcessExchangeOptions = typeof optionsOrNotes === 'string'
        ? { notes: optionsOrNotes }
        : (optionsOrNotes || {});
    const paymentMethod = options.paymentMethod || 'cash';
    const paymentReference = options.paymentReference || '';

    // 1a. PRE-FLIGHT VALIDATION (read-only): resolve every variant and verify
    // stock for ALL replacement items before mutating anything, so the most
    // common failure (insufficient stock on a later item) aborts without
    // touching stock at all.
    const variantCache = new Map<string, ProductVariant>();
    for (const item of newItems) {
        if (!item.variant_id) {
            throw new Error(`Variant ID missing for replacement item "${item.description}"`);
        }
        if (!variantCache.has(item.variant_id)) {
            variantCache.set(
                item.variant_id,
                await pb.collection('product_variants').getOne<ProductVariant>(item.variant_id)
            );
        }
    }

    // Aggregate duplicate line items of the same variant before checking stock
    const requiredByVariant = new Map<string, number>();
    for (const item of newItems) {
        requiredByVariant.set(
            item.variant_id,
            (requiredByVariant.get(item.variant_id) || 0) + item.quantity
        );
    }
    for (const [variantId, requiredQty] of requiredByVariant) {
        const variant = variantCache.get(variantId);
        const label = newItems.find((i) => i.variant_id === variantId)?.description || variantId;
        if (!variant) {
            // Unreachable in practice: the pre-flight pass above caches every
            // variant referenced by newItems. Kept as a narrowing guard.
            throw new Error(`Variant record not resolved for "${label}"`);
        }
        if ((variant.stock_level ?? 0) < requiredQty) {
            throw new Error(
                `Insufficient stock for "${label}". Available: ${variant.stock_level ?? 0}, Requested: ${requiredQty}`
            );
        }
    }

    // 2. FINANCIAL SETTLEMENT (pure computation): Replacement unit prices are
    // pre-tax base prices (the same taxable base used for invoicing), while
    // creditNote.grand_total is tax-inclusive — apply the standard jewelry GST
    // rate to the replacement value before comparing, so an even exchange
    // settles to zero instead of refunding the GST amount.
    const replacementTaxable = newItems.reduce(
        (sum, item) => sum + (item.unit_price * item.quantity),
        0
    );
    const replacementGst = calculateGST(
        replacementTaxable,
        creditNote.buyer_state_code || '',
        creditNote.buyer_state_code || '',
        GST_RATES.JEWELRY
    );
    const replacementTotal = replacementGst.grandTotal; // tax-inclusive, comparable to the credit value
    const creditValue = creditNote.grand_total;
    const balanceDue = replacementTotal - creditValue; // Positive = customer pays more, Negative = store refunds customer

    // 3. TRACKED MUTATIONS: deduct stock, record payments, then mark the note
    // 'exchanged'. Every write is tracked so a mid-way failure is undone with
    // compensating writes — an abort used to leave earlier deductions committed
    // (plus orphan stock_movements) while the note stayed 'approved', letting a
    // retry pass the status guard and deduct those items a second time.
    const deducted: { variantId: string; quantity: number; movementId?: string }[] = [];
    let invoicePaymentId: string | undefined;
    let exchangeInvoiceId: string | undefined;
    let exchangeInvoiceNumber = '';
    let markedExchanged = false;

    const rollbackExchange = async () => {
        // Best-effort compensating writes in reverse order. Rollback failures
        // are logged, never thrown, so the original error still propagates.
        for (const entry of [...deducted].reverse()) {
            if (entry.movementId) {
                await pb.collection('stock_movements').delete(entry.movementId).catch((err) =>
                    console.warn(`Rollback: could not delete replacement movement ${entry.movementId}:`, err)
                );
            }
            await pb.collection('product_variants').update(entry.variantId, {
                'stock_level+': entry.quantity,
            }).catch((err) =>
                console.error(`Rollback: could not restore stock for variant ${entry.variantId} (+${entry.quantity}):`, err)
            );
        }
        if (invoicePaymentId) {
            await pb.collection('invoice_payments').delete(invoicePaymentId).catch((err) =>
                console.warn(`Rollback: could not delete exchange payment record ${invoicePaymentId}:`, err)
            );
        }
        if (exchangeInvoiceId) {
            const exchangeItems = await pb
                .collection('invoice_items')
                .getFullList<{ id: string }>({ filter: `invoice="${exchangeInvoiceId}"` })
                .catch(() => []);
            for (const item of exchangeItems) {
                await pb.collection('invoice_items').delete(item.id).catch(() => {});
            }
            await pb.collection('invoices').delete(exchangeInvoiceId).catch((err) =>
                console.warn(`Rollback: could not delete exchange invoice ${exchangeInvoiceId}:`, err)
            );
        }
        if (markedExchanged) {
            await pb.collection('credit_notes').update(creditNoteId, { status: 'approved' }).catch((err) =>
                console.error('Rollback: could not restore credit note status to approved:', err)
            );
        }
    };

    try {
        // 3a. INVENTORY UPDATE: Deduct stock for replacement items
        for (const item of newItems) {
            try {
                // Deduct from sellable inventory
                await pb.collection('product_variants').update(item.variant_id, {
                    'stock_level-': item.quantity,
                });

                // Log stock movement audit trail
                let movementId: string | undefined;
                try {
                    const movement = await pb.collection('stock_movements').create({
                        variant: item.variant_id,
                        movement_type: 'replacement_issued',
                        quantity: item.quantity,
                        reference_id: creditNoteId,
                        source: 'credit_note_exchange',
                        notes: `Replacement issued for Return #${creditNote.credit_note_number || creditNoteId} to ${creditNote.buyer_name}`,
                    });
                    movementId = movement.id;
                } catch (movementErr) {
                    console.warn('Failed to log replacement stock movement:', movementErr);
                }

                deducted.push({ variantId: item.variant_id, quantity: item.quantity, movementId });
            } catch (err) {
                console.error(`Error deducting stock for replacement variant ${item.variant_id}:`, err);
                throw new Error((err instanceof Error ? err.message : String(err)) || `Failed to deduct stock for ${item.description}`);
            }
        }

        // 3b. TAX DOCUMENT: replacement goods leave the store as a supply, so
        // they get their own invoice. The previous code wrote a negative payment
        // against the original invoice, which corrupted its paid_amount and
        // recorded no output tax for the replacement.
        if (creditNote.original_invoice_id) {
            const exchange = await createExchangeInvoice(creditNote, newItems, balanceDue, paymentMethod);
            exchangeInvoiceId = exchange.invoiceId;
            exchangeInvoiceNumber = exchange.invoiceNumber;

            if (balanceDue > 0) {
                const pRecord = await pb.collection('invoice_payments').create({
                    invoice: exchange.invoiceId,
                    amount: balanceDue,
                    payment_date: new Date().toISOString(),
                    payment_method: paymentMethod,
                    reference_number: paymentReference || `EXCH-PAY-${creditNote.credit_note_number || creditNoteId}`,
                    notes: `Exchange balance collected (${paymentMethod.toUpperCase()}). Exchange invoice ${exchange.invoiceNumber}`,
                });
                invoicePaymentId = pRecord.id;
            }
        }

        // 3c. CREDIT NOTE UPDATE: Mark exchanged with financial breakdown
        const financialSummary = balanceDue > 0
            ? `Replacement Value (incl. GST): ₹${replacementTotal} | Credit Applied: ₹${creditValue} | Extra Collected from Customer: ₹${balanceDue} via ${paymentMethod.toUpperCase()}`
            : balanceDue < 0
            ? `Replacement Value (incl. GST): ₹${replacementTotal} | Credit Applied: ₹${creditValue} | Refunded Difference to Customer: ₹${Math.abs(balanceDue)} via ${paymentMethod.toUpperCase()}`
            : `Replacement Value (incl. GST): ₹${replacementTotal} | Even Exchange against Credit Note ₹${creditValue} (Fully Settled)`;

        const updatedNotes = [
            creditNote.notes,
            `[Exchange Settlement]: ${financialSummary}`,
            `[Replacement Items Issued]: ${newItems.map(i => `${i.description} (Qty: ${i.quantity} @ ₹${i.unit_price})`).join('; ')}`,
            exchangeInvoiceNumber ? `[Exchange Invoice]: ${exchangeInvoiceNumber}` : '',
            options.notes ? `Staff Notes: ${options.notes}` : '',
        ].filter(Boolean).join('\n\n');

        await pb.collection('credit_notes').update(creditNoteId, {
            status: 'exchanged',
            refund_method: paymentMethod || 'exchange',
            refund_reference: paymentReference || `EXCHANGE-${new Date().toISOString().slice(0, 10)}`,
            notes: updatedNotes,
            refunded_at: new Date().toISOString(),
        });
        markedExchanged = true;

        // Negative balance means cash leaves the drawer. Record it against the
        // open shift so the refund reaches reconciliation instead of vanishing.
        if (balanceDue < 0 && paymentMethod.toLowerCase() === 'cash') {
            const refundAmount = Math.abs(balanceDue);
            const userId = pb.authStore.model?.id || '';
            const shift = userId ? await getCurrentShift(userId) : null;
            if (shift) {
                const recorded = await recordCashRefund(
                    shift.id,
                    refundAmount,
                    `Exchange refund for credit note ${creditNote.credit_note_number || creditNoteId}`,
                    userId
                );
                if (!recorded) console.warn('Exchange completed but the cash refund drawer entry failed');
            } else {
                await pb.collection('activity_logs').create({
                    action: 'CASH_REFUND_OUTSIDE_SHIFT',
                    entity_type: 'credit_notes',
                    entity_id: creditNoteId,
                    description: `Exchange refund of ${refundAmount} recorded with no open shift.`,
                    metadata: JSON.stringify({ amount: refundAmount, credit_note: creditNoteId }),
                }).catch(() => {});
            }
        }
    } catch (err) {
        await rollbackExchange();
        throw err;
    }

    return {
        creditNoteId,
        exchangedItems: newItems,
        creditUsed: Math.min(creditValue, replacementTotal),
        replacementTotal,
        balanceDue,
        paymentMethod,
        paymentReference,
        invoicePaymentId,
        exchangeInvoiceId,
    };
}

export async function getExchangeEligibleCreditNotes(): Promise<CreditNote[]> {
    try {
        const records = await pb.collection('credit_notes').getFullList<CreditNoteRecord>({
            filter: 'status="approved"',
            sort: '-created',
        });

        return records.map((cn) => ({
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
