/**
 * Returns & Credit Notes Service
 * Handles product returns and credit note generation using PocketBase
 */

import { pb } from './pocketbase';
import { getNextSequenceNumber, createWithUniqueRetry } from './sequence-generator';
import { normalizeDateBounds } from './utils';
import { calculateGST, GST_RATES } from './gst';
import type { Invoice } from './invoice';
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
    const invoice = await pb.collection('invoices').getOne<Invoice>(invoiceId);
    const invoiceItems = await pb.collection('invoice_items').getFullList<InvoiceItemRecord>({
        filter: `invoice="${invoiceId}"`,
    });

    // Filter items being returned
    const itemsToReturn = invoiceItems.filter((item) =>
        returnItems.some(ri => ri.invoice_item_id === item.id)
    );

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

        // 3b. FINANCIAL BOOKKEEPING: Record ledger entry in invoice_payments if original invoice linked
        if (creditNote.original_invoice_id) {
            try {
                if (balanceDue > 0) {
                    // Customer paid extra cash/UPI/card for upgrade
                    const pRecord = await pb.collection('invoice_payments').create({
                        invoice: creditNote.original_invoice_id,
                        amount: balanceDue,
                        payment_date: new Date().toISOString(),
                        payment_method: paymentMethod,
                        reference_number: paymentReference || `EXCH-PAY-${creditNote.credit_note_number || creditNoteId}`,
                        notes: `Exchange balance collected (${paymentMethod.toUpperCase()}). Replaced items: ${newItems.map(i => `${i.description} (x${i.quantity})`).join(', ')}`,
                    });
                    invoicePaymentId = pRecord.id;
                } else if (balanceDue < 0) {
                    // Store gave partial cash/UPI refund to customer
                    const pRecord = await pb.collection('invoice_payments').create({
                        invoice: creditNote.original_invoice_id,
                        amount: balanceDue,
                        payment_date: new Date().toISOString(),
                        payment_method: paymentMethod,
                        reference_number: paymentReference || `EXCH-REFUND-${creditNote.credit_note_number || creditNoteId}`,
                        notes: `Exchange partial refund to customer (${paymentMethod.toUpperCase()}). Replaced items: ${newItems.map(i => `${i.description} (x${i.quantity})`).join(', ')}`,
                    });
                    invoicePaymentId = pRecord.id;
                }
            } catch (err) {
                console.warn('Could not record invoice payment bookkeeping entry:', err);
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
