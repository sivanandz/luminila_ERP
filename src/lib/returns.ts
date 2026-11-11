/**
 * Returns & Credit Notes Service
 * Handles product returns and credit note generation using PocketBase
 */

import { getCurrentTenantEmail, pb, sanitizeFilter, accountScopeEmail } from './pocketbase';
import { applyPurchaseReversal } from './channel-orders';
import { adjustPoints } from './loyalty';
import { getNextSequenceNumber, createWithUniqueRetry } from './sequence-generator';
import { normalizeDateBounds } from './utils';
import { calculateGST, GST_RATES } from './gst';
import { createInvoice, getStoreSettings, type Invoice, type InvoiceItem } from './invoice';
import { getCurrentShift, recordCashRefund } from './register';
import { validateReturnQuantities } from './returns-policy';
import { splitExclusiveLine, toPaise, toRupees } from './invoice-math';
import { executeInwardQcInspection, type QcDispositionGrade } from './returns-qc-engine';
import { reverseDiscountUsage } from './discounts';
import type { Product, ProductVariant } from '@/types/database';

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
    notes?: string;    buyer_name: string;
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

/**
 * Machine-readable QC deduction marker appended to `credit_notes.notes` at
 * approval. processRefund reads it back so a restocking / reverse-logistics
 * deduction produced by the QC engine is actually withheld from the refund
 * (RET-10) without a schema migration.
 */
const QC_DEDUCTION_MARKER = 'RefundDeductions:';

function parseQcDeduction(notes?: string): number {
    // The marker is appended by approval, so the LAST occurrence is ours even
    // if the free-text notes happened to contain the same words.
    const matches = String(notes || '').match(/RefundDeductions:\s*([0-9]+(?:\.[0-9]+)?)/g);
    const last = matches && matches.length > 0 ? matches[matches.length - 1] : '';
    const value = Number(last.replace(/^RefundDeductions:\s*/, '')) || 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
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
        const filterParts: string[] = [`account_email="${sanitizeFilter(getCurrentTenantEmail())}"`];

        if (filters?.status) {
            filterParts.push(`status="${sanitizeFilter(filters.status)}"`);
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
        const tenant = getCurrentTenantEmail();
        const owner = (cn as unknown as { account_email?: string }).account_email;
        if (owner && owner !== tenant) return null;
        const items = await pb.collection('credit_note_items').getFullList<CreditNoteItemRecord>({
            filter: `credit_note="${sanitizeFilter(id)}" && account_email="${sanitizeFilter(tenant)}"`,
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
    const accountEmail = getCurrentTenantEmail();
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

    // Create items. A failure part-way through must not leave a credit note
    // behind with missing lines, so undo the note and the rows already
    // written before rethrowing (RET-11).
    const createdItemIds: string[] = [];
    try {
        for (const item of items) {
            const itemRecord = await pb.collection('credit_note_items').create({
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
            createdItemIds.push(itemRecord.id);
        }
    } catch (itemErr) {
        for (const itemId of createdItemIds) {
            await pb.collection('credit_note_items').delete(itemId).catch(() => {});
        }
        await pb.collection('credit_notes').delete(cn.id).catch(() => {});
        throw itemErr;
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

/**
 * Did the document this credit note reverses ever remove stock from the
 * variant? A credit note must not mint inventory for a sale that never took it
 * (ORD-06): B2B orders historically never deducted, and manual invoices still
 * do not. The sale/order ledger is the evidence.
 */
async function wasStockDeducted(
    variantId: string,
    cn: { original_sale?: string; original_invoice?: string }
): Promise<boolean> {
    if (!variantId) return false;
    const references = [cn.original_sale, cn.original_invoice].filter(Boolean) as string[];

    // A storefront invoice carries its originating sales order; that order id
    // is what the stock movement references.
    if (cn.original_invoice) {
        // An unreadable invoice must fail the approval: reading it as "not a
        // storefront order" silently skipped a legitimate restock (RET-9).
        const invoice = await pb.collection('invoices').getOne<{ order?: string; sale?: string }>(
            cn.original_invoice
        );
        const linked = String(invoice.order || invoice.sale || '');
        if (linked) references.push(linked);
    }

    for (const reference of references) {
        const rows = await pb.collection('stock_movements').getList(1, 1, {
            filter: `variant="${sanitizeFilter(variantId)}" && reference_id="${sanitizeFilter(reference)}" && movement_type="sale"`,
        }).catch(() => null);
        if (rows && rows.items.length > 0) return true;
    }
    return false;
}

export interface ApproveCreditNoteOptions {
    routeDefectiveToQuarantine?: boolean;
    discrepancyType?: 'damaged' | 'missing' | 'vendor_replacement';
    vendorName?: string;
    notes?: string;
    flaggedBy?: string;
    /** Inward QC grade. When supplied it decides restock, repair or write-off. */
    qcGrade?: QcDispositionGrade;
    /** Artisan or workshop that receives items graded for repair. */
    karigarName?: string;
    /** Reverse-logistics fee withheld from the refund (RET-10). */
    reverseShippingFeeDeduction?: number;
    /** Restocking fee percentage withheld from the refund for non-fault returns (RET-10). */
    restockingFeePercent?: number;
}

/**
 * Refuse credit-note mutations unless the note belongs to the signed-in tenant.
 * These paths run under superuser clients often enough that PocketBase rules
 * cannot be the only gate (RET-1).
 */
async function requireOwnedCreditNote<T>(id: string): Promise<T & { account_email?: string }> {
    const tenant = getCurrentTenantEmail();
    const scopedTenant = tenant === 'default' ? '' : tenant;
    if (!scopedTenant) {
        throw new Error('No tenant account resolved; refusing credit-note mutation.');
    }
    const note = await pb.collection('credit_notes').getOne<T & { account_email?: string }>(id);
    const owner = String(note.account_email || '').trim().toLowerCase();
    if (owner && owner !== scopedTenant) {
        throw new Error('Credit note does not belong to this store.');
    }
    return note;
}

/** Throw when a variant addressed by a return belongs to another tenant. */
async function assertVariantOwned(variantId: string | undefined): Promise<void> {
    if (!variantId) return;
    const tenant = getCurrentTenantEmail();
    const scopedTenant = tenant === 'default' ? '' : tenant;
    if (!scopedTenant) {
        throw new Error('No tenant account resolved; refusing variant mutation.');
    }
    const variant = await pb.collection('product_variants').getOne<{ account_email?: string }>(variantId, {
        fields: 'account_email',
    });
    const owner = String(variant.account_email || '').trim().toLowerCase();
    if (owner && owner !== scopedTenant) {
        throw new Error('Variant does not belong to this store.');
    }
}

export async function approveCreditNote(id: string, options?: ApproveCreditNoteOptions): Promise<void> {
    const cn = await requireOwnedCreditNote<{
        status?: string;
        credit_note_number?: string;
        return_reason?: string;
        original_sale?: string;
        original_invoice?: string;
        buyer_name?: string;
        notes?: string;
    }>(id);

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
        const noteOwner = String(cn.account_email || '').trim().toLowerCase();
        const items = await pb.collection('credit_note_items').getFullList({
            filter: `credit_note="${sanitizeFilter(id)}"${noteOwner ? ` && account_email="${sanitizeFilter(noteOwner)}"` : ''}`
        });

        // Inward QC: when a grade is supplied, the QC engine owns the routing
        // decision (restock, karigar repair, write-off) and produces the summary
        // attached to the note. Without a grade the old reason-based rule stands.
        const qcGrade = options?.qcGrade;
        const qcReason: 'manufacturing_defect' | 'size_fit_issue' | 'customer_remorse' =
            cn.return_reason === 'defective' || cn.return_reason === 'quality_issue'
                ? 'manufacturing_defect'
                : cn.return_reason === 'size_exchange'
                    ? 'size_fit_issue'
                    : 'customer_remorse';

        const qcResult = qcGrade
            ? executeInwardQcInspection({
                returnNumber: cn.credit_note_number || id,
                originalInvoiceNumber: cn.original_invoice || '',
                customerName: cn.buyer_name || 'Customer',
                returnedItems: items.map((item) => ({
                    variantId: item.variant || '',
                    productName: item.description || '',
                    quantityReturned: item.quantity || 0,
                    // credit_note_items.unit_price is the pre-tax base, while the
                    // QC engine splits amounts as tax-inclusive. Hand it the
                    // inclusive value or its tax/GST figures are understated
                    // (RET-10).
                    unitPrice:
                        Math.round(
                            (Number(item.unit_price) || 0) *
                                (1 + (Number(item.gst_rate) || 0) / 100) *
                                100
                        ) / 100,
                    taxRate: item.gst_rate || 0,
                    returnReason: qcReason,
                })),
                dispositionGrade: qcGrade,
                inspectorNotes: options?.notes,
                reverseShippingFeeDeduction: options?.reverseShippingFeeDeduction,
                restockingFeePercent: options?.restockingFeePercent,
            })
            : null;

        // Persist the QC outcome (including any withholding) BEFORE inventory is
        // touched: if this write fails the note reverts to pending with nothing
        // moved, and processRefund can always read the deduction back (RET-10).
        if (qcResult) {
            await pb.collection('credit_notes').update(id, {
                notes: [
                    cn.notes,
                    `[Inward QC ${new Date().toISOString().slice(0, 10)}]: ${qcResult.inspectorSummary}`,
                    qcResult.totalDeductions > 0
                        ? `${QC_DEDUCTION_MARKER} ${qcResult.totalDeductions}`
                        : '',
                ]
                    .filter(Boolean)
                    .join('\n\n'),
            });
        }

        const isQuarantine = options?.routeDefectiveToQuarantine ?? (cn.return_reason === 'defective' || cn.return_reason === 'quality_issue');        const routeToQuarantine = qcGrade ? qcGrade !== 'restock_grade_a' : isQuarantine;
        const quarantineType = qcGrade === 'karigar_repair' ? 'vendor_replacement' : (options?.discrepancyType || 'damaged');

        for (const item of items) {
            if (item.quantity > 0) {
                // The variant being restocked must belong to this tenant too,
                // otherwise a crafted note could mint stock elsewhere (RET-1).
                await assertVariantOwned(item.variant);
                if (routeToQuarantine) {
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
                            account_email: accountScopeEmail() || getCurrentTenantEmail(),
                        }).catch((err) => console.warn('Failed to log quarantine movement for return:', err));
                    }

                    // Register discrepancy in quarantine ledger
                    await pb.collection('stock_discrepancies').create({
                        product: '',
                        variant: item.variant || '',
                        sku: item.description,
                        product_name: item.description,
                        discrepancy_type: quarantineType,
                        quantity: item.quantity,
                        vendor_name: qcGrade === 'karigar_repair'
                            ? (options?.karigarName || 'Karigar Workshop')
                            : (options?.vendorName || ''),
                        reason: qcGrade
                            ? `QC grade ${qcGrade} for return #${cn.credit_note_number || id} (${cn.return_reason})`
                            : `Defective customer return #${cn.credit_note_number || id} (${cn.return_reason})`,
                        notes: options?.notes || `Customer: ${cn.buyer_name}. Routed to quarantine on approval.`,
                        status: 'active',
                        flagged_by: options?.flaggedBy || 'Staff',
                        account_email: accountScopeEmail() || getCurrentTenantEmail(),
                    });
                } else {
                    // 2. Resellable condition: Restore stock to variant — only
                    // if the original document actually deducted it.
                    if (item.variant) {
                        const deducted = await wasStockDeducted(item.variant, cn as {
                            original_sale?: string;
                            original_invoice?: string;
                        });
                        if (!deducted) {
                            console.warn(
                                `[approveCreditNote] Variant ${item.variant} was never deducted by ` +
                                `${cn.original_sale || cn.original_invoice || 'the original document'}; ` +
                                `skipping restock to avoid minting stock.`
                            );
                        } else {
                            // A failed restock must abort the approval: the old
                            // warn-and-continue left the note approved while the
                            // items never returned to inventory (RET-7).
                            await pb.collection('product_variants').update(item.variant, {
                                'stock_level+': item.quantity
                            });

                            await pb.collection('stock_movements').create({
                                variant: item.variant,
                                movement_type: 'return',
                                quantity: item.quantity,
                                reference_id: id,
                                source: 'credit_note',
                                notes: `Restock from Return #${cn.credit_note_number || id}`,
                                account_email: accountScopeEmail() || getCurrentTenantEmail(),
                            }).catch((err) => console.warn('Failed to log stock movement for return:', err));
                        }
                    }
                }
            }
        }
    } catch (itemErr) {
        console.error('Error handling inventory for credit note:', itemErr);
        // Inventory side effects did not complete. Leaving the note 'approved'
        // let the caller report success and blocked retries through the
        // idempotency guard, so hand it back as 'pending' (RET-7).
        await pb.collection('credit_notes').update(id, { status: 'pending' }).catch((revertErr) =>
            console.error('Could not revert credit note to pending after inventory failure:', revertErr)
        );
        throw new Error(
            `Inventory update failed for credit note ${cn.credit_note_number || id}; the note was returned to pending. ${
                itemErr instanceof Error ? itemErr.message : String(itemErr)
            }`
        );
    }
}

export async function processRefund(
    id: string,
    refundMethod: string,
    refundReference?: string
): Promise<void> {
    const cn = await requireOwnedCreditNote<{
        status?: string;
        grand_total?: number;
        credit_note_number?: string;
        buyer_name?: string;
        notes?: string;
    }>(id);

    // A refund settles an approved note exactly once.
    if (cn.status === 'refunded' || cn.status === 'exchanged') return;
    if (cn.status !== 'approved') {
        throw new Error(`Credit note ${cn.credit_note_number || id} must be approved before it can be refunded`);
    }

    // Withhold any QC restocking / reverse-logistics deduction recorded at
    // approval: the customer gets the net amount, not the gross note (RET-10).
    const deduction = parseQcDeduction(cn.notes);
    const amount = Math.max(
        0,
        Math.round(((Number(cn.grand_total) || 0) - deduction) * 100) / 100
    );
    const method = String(refundMethod || 'cash').toLowerCase();
    const reference = refundReference || `REFUND-${cn.credit_note_number || id}`;

    await pb.collection('credit_notes').update(id, {
        status: 'refunded',
        refund_method: method,
        refund_reference: reference,
        refunded_at: new Date().toISOString(),
    });

    // Re-read: two terminals refunding the same note write different references.
    // Only the writer whose reference survived proceeds to move money (RET-2).
    const claimed = await pb.collection('credit_notes').getOne<{ refund_reference?: string }>(id);
    if (claimed.refund_reference !== reference) {
        throw new Error('This credit note is already being refunded by another session.');
    }

    const linkage = await pb.collection('credit_notes').getOne<{
        original_invoice?: string;
        original_sale?: string;
    }>(id).catch(() => null);

    // Customer lifetime spend, loyalty and coupon entitlement are reversed only
    // once the money movement below has succeeded. Running them first meant a
    // failed cash drawer left the reversals applied while the note went back to
    // 'approved', so a retry reversed everything twice (RET-5).
    const reverseCustomerEntitlements = async () => {
        // The money came back, so the customer's lifetime spend and loyalty earned
        // on that sale must come back too. Previously a refund left the CRM
        // reporting revenue and points for goods that were returned (ORD-19).
        try {
            let refundCustomerId = '';
            let originalAmount = amount;
            let referenceId = '';
            if (linkage?.original_sale) {
                referenceId = linkage.original_sale;
                const sale = await pb.collection('sales').getOne(linkage.original_sale).catch(() => null);
                refundCustomerId = String((sale as { customer?: string } | null)?.customer || '');
                originalAmount = Number((sale as { total?: number } | null)?.total) || amount;
            } else if (linkage?.original_invoice) {
                referenceId = linkage.original_invoice;
                const invoice = await pb.collection('invoices').getOne(linkage.original_invoice).catch(() => null);
                refundCustomerId = String((invoice as { customer?: string } | null)?.customer || '');
                originalAmount = Number(
                    (invoice as { grand_total?: number; total?: number } | null)?.grand_total
                    ?? (invoice as { total?: number } | null)?.total
                ) || amount;
            }

            // Only the refunded value leaves lifetime spend, and the order itself
            // still exists for a partial return — so do not decrement the order
            // counter unless the whole sale came back (RET-3).
            const refundAmount = Math.max(0, amount);
            const isPartialRefund = originalAmount > 0 && refundAmount < originalAmount - 0.005;

            if (refundCustomerId) {
                await applyPurchaseReversal(pb, refundCustomerId, refundAmount, {
                    decrementOrders: !isPartialRefund,
                });
                if (referenceId) {
                    const earned = await pb.collection('loyalty_transactions').getFirstListItem(
                        `type="earn" && reference_id="${sanitizeFilter(referenceId)}"`
                    ).catch(() => null);
                    const points = Number((earned as { points?: number } | null)?.points || 0);
                    // Claw back only the fraction of the sale that was refunded so a
                    // one-line return cannot wipe the points of the whole invoice (RET-4).
                    const clawback = isPartialRefund
                        ? Math.round(points * (refundAmount / originalAmount) * 100) / 100
                        : points;
                    if (clawback > 0) {
                        await adjustPoints(
                            refundCustomerId,
                            -clawback,
                            `Refund reversal for credit note ${cn.credit_note_number || id}`
                        ).catch((err) => console.warn('Loyalty reversal failed:', err));
                    }
                }
            }
        } catch (reversalErr) {
            console.warn('Refund aggregate/loyalty reversal failed:', reversalErr);
        }

        // The order came back, so the coupon use goes back to the pool too.
        await reverseDiscountUsage({
            invoiceId: linkage?.original_invoice,
            saleId: linkage?.original_sale,
        }).catch((error) => {
            console.warn('Discount usage reversal failed:', error);
        });
    };

    // Only cash leaves the drawer. Bank, UPI, and store credit settle elsewhere.
    if (method !== 'cash' || amount <= 0) {
        await reverseCustomerEntitlements();
        return;
    }

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
        await reverseCustomerEntitlements();
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

    await reverseCustomerEntitlements();
}

export async function cancelCreditNote(id: string): Promise<void> {
    const cn = await requireOwnedCreditNote<{ status?: string; credit_note_number?: string }>(id);
    // An approved note has already moved inventory (restock or quarantine) and
    // may have paid out a refund. Cancelling it without reversing those effects
    // corrupts stock, so only a pending note may be cancelled (ORD-06).
    if (cn.status && cn.status !== 'pending') {
        throw new Error(
            `Credit note ${cn.credit_note_number || id} is ${cn.status}; only a pending note can be cancelled.`
        );
    }
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
    // Fetch original invoice and verify it belongs to this store before any of
    // its lines can be credited (RET-1).
    const invoice = await pb.collection('invoices').getOne<Invoice & { account_email?: string }>(invoiceId);
    const tenant = getCurrentTenantEmail();
    const scopedTenant = tenant === 'default' ? '' : tenant;
    if (!scopedTenant) {
        throw new Error('No tenant account resolved; refusing to create a return.');
    }
    const invoiceOwner = String(invoice.account_email || '').trim().toLowerCase();
    if (invoiceOwner && invoiceOwner !== scopedTenant) {
        throw new Error('Invoice does not belong to this store.');
    }
    const invoiceItems = await pb.collection('invoice_items').getFullList<InvoiceItemRecord>({
        filter: `invoice="${sanitizeFilter(invoiceId)}" && account_email="${sanitizeFilter(scopedTenant)}"`,
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

    // A failed history read must block the return: treating it as "nothing was
    // returned before" lets the same line be credited twice on a DB hiccup (RET-6).
    const priorReturns = await pb
        .collection('credit_note_items')
        .getFullList<{ original_invoice_item?: string; quantity?: number }>({
            filter: `credit_note.original_invoice="${sanitizeFilter(invoiceId)}" && credit_note.status != "cancelled"`,
            fields: 'original_invoice_item,quantity,account_email',
        })
        .catch((err) => {
            throw new Error(
                `Could not verify previously returned quantities; return blocked. ${err instanceof Error ? err.message : String(err)}`
            );
        });

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
        // Prorate each component and round to paise: raw float division left
        // IEEE-754 tails in the credit note totals (POS-18).
        const roundToTwo = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
        const originalQty = Math.max(1, Number(item.quantity) || 1);

        const itemTaxable = roundToTwo((item.taxable_amount / originalQty) * qty);
        const itemCgst = roundToTwo(((item.cgst_amount || 0) / originalQty) * qty);
        const itemSgst = roundToTwo(((item.sgst_amount || 0) / originalQty) * qty);
        const itemIgst = roundToTwo(((item.igst_amount || 0) / originalQty) * qty);
        const itemTotal = roundToTwo(itemTaxable + itemCgst + itemSgst + itemIgst);

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
            discount_amount: roundToTwo(((item.discount_amount || 0) / originalQty) * qty),
            taxable_amount: itemTaxable,
            gst_rate: item.gst_rate || 0,
            cgst_amount: itemCgst,
            sgst_amount: itemSgst,
            igst_amount: itemIgst,
            total_amount: itemTotal,
        };
    });

    const totalTax = Math.round((cgstAmount + sgstAmount + igstAmount) * 100) / 100;
    const grandTotal = Math.round((taxableValue + totalTax) * 100) / 100;

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

        const allCNs = await pb.collection('credit_notes').getFullList<CreditNoteRecord>({
            filter: `account_email="${sanitizeFilter(getCurrentTenantEmail())}"`,
        });
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
    /** GST percentage for this line; falls back to the store default when absent (RET-14). */
    gst_rate?: number;
}

/**
 * GST rate for a replacement line: the line's own rate when supplied, else the
 * store default. Replacement goods used to be taxed at JEWELRY for every line
 * regardless of the item's configured rate (RET-14).
 */
function exchangeLineGstRate(line: ExchangeItem, fallbackRate: number): number {
    const rate = Number(line.gst_rate);
    return Number.isFinite(rate) && rate > 0 ? rate : fallbackRate;
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
    const defaultRate = gstEnabled ? GST_RATES.JEWELRY : 0;

    const items: InvoiceItem[] = lines.map((line, index) => {
        const rate = exchangeLineGstRate(line, defaultRate);
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
            // Expand the product so the replacement line can take its own
            // configured GST rate instead of the JEWELRY default (RET-14).
            variantCache.set(
                item.variant_id,
                await pb.collection('product_variants').getOne<ProductVariant>(item.variant_id, {
                    expand: 'product',
                })
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
    // pre-tax base prices, while creditNote.grand_total is tax-inclusive. Use
    // the same registration flag and per-line split as the invoice, otherwise
    // an unregistered store is charged GST and the aggregate rounding differs
    // from the document (POS-09).
    const store = await getStoreSettings();
    const gstEnabled = store.is_gst_registered !== false;
    const defaultRate = gstEnabled ? GST_RATES.JEWELRY : 0;
    const replacementState = creditNote.buyer_state_code || store.store_state_code || '';

    // Price every line at its own GST rate (line override, then the variant's
    // product rate), so the exchange invoice and the balance agree (RET-14).
    const pricedItems: ExchangeItem[] = newItems.map((line) => {
        const productRate = Number(
            (variantCache.get(line.variant_id)?.expand?.product as Product | undefined)?.gst_rate
        );
        const ownRate = Number(line.gst_rate);
        const resolved = Number.isFinite(ownRate) && ownRate > 0
            ? ownRate
            : Number.isFinite(productRate) && productRate > 0
                ? productRate
                : defaultRate;
        return { ...line, gst_rate: gstEnabled ? resolved : 0 };
    });

    let replacementTotalPaise = 0;
    for (const item of pricedItems) {
        const split = splitExclusiveLine(
            toPaise(item.unit_price * item.quantity),
            exchangeLineGstRate(item, defaultRate),
            store.store_state_code || replacementState,
            replacementState
        );
        replacementTotalPaise += split.totalPaise;
    }
    const replacementTotal = toRupees(replacementTotalPaise); // tax-inclusive
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
                .getFullList<{ id: string }>({ filter: `invoice="${sanitizeFilter(exchangeInvoiceId)}"` })
                .catch(() => []);
            for (const item of exchangeItems) {
                await pb.collection('invoice_items').delete(item.id).catch(() => {});
            }
            await pb.collection('invoices').delete(exchangeInvoiceId).catch((err) =>
                console.warn(`Rollback: could not delete exchange invoice ${exchangeInvoiceId}:`, err)
            );
        }
        if (markedExchanged) {
            await pb.collection('credit_notes').update(creditNoteId, {
                status: 'approved',
                refund_method: '',
                refund_reference: '',
                refunded_at: '',
            }).catch((err) =>
                console.error('Rollback: could not restore credit note status to approved:', err)
            );
        }
    };

    try {
        // 3a. INVENTORY UPDATE: Deduct stock for replacement items
        for (const item of pricedItems) {
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
                        quantity: -item.quantity,
                        reference_id: creditNoteId,
                        source: 'credit_note_exchange',
                        notes: `Replacement issued for Return #${creditNote.credit_note_number || creditNoteId} to ${creditNote.buyer_name}`,
                        account_email: accountScopeEmail(),
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
        // recorded no output tax for the replacement. The invoice is raised even
        // when the note has no original_invoice_id: stock was deducted, so the
        // replacement must not leave the store with zero output GST (RET-8).
        {
            const exchange = await createExchangeInvoice(creditNote, pricedItems, balanceDue, paymentMethod);
            exchangeInvoiceId = exchange.invoiceId;
            exchangeInvoiceNumber = exchange.invoiceNumber;

            if (balanceDue > 0) {
                const pRecord = await pb.collection('invoice_payments').create({
                    account_email: getCurrentTenantEmail(),
                    invoice: exchange.invoiceId,
                    amount: balanceDue,
                    payment_date: new Date().toISOString(),
                    payment_method: paymentMethod,
                    reference_number: paymentReference || `EXCH-PAY-${creditNote.credit_note_number || creditNoteId}`,
                    notes: `Exchange balance collected (${paymentMethod.toUpperCase()}). Exchange invoice ${exchange.invoiceNumber}`,
                });
                invoicePaymentId = pRecord.id;
                // The credit note covers the rest of the replacement, so the
                // exchange invoice is fully settled once the balance is paid;
                // leaving it "pending" contradicted the payment row (POS-09).
                await pb.collection('invoices').update(exchange.invoiceId, {
                    status: 'paid',
                    is_paid: true,
                    paid_amount: exchange.grandTotal,
                }).catch((err) => console.warn('Could not mark exchange invoice paid:', err));
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
            `[Replacement Items Issued]: ${pricedItems.map(i => `${i.description} (Qty: ${i.quantity} @ ₹${i.unit_price})`).join('; ')}`,
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
                if (!recorded) {
                    // The drawer never recorded the payout, so abort the
                    // exchange and let the tracked rollback restore the note
                    // to 'approved', matching processRefund (RET-12).
                    throw new Error(
                        `Exchange refund of ${refundAmount} could not be recorded in the cash drawer for credit note ${
                            creditNote.credit_note_number || creditNoteId
                        }; the exchange was rolled back.`
                    );
                }
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
        exchangedItems: pricedItems,
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
            filter: `status="approved" && account_email="${sanitizeFilter(getCurrentTenantEmail())}"`,
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
