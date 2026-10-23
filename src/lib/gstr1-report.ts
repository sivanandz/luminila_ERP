/**
 * Official GSTN GSTR-1 payload builder.
 *
 * The app already had a complete GSTN v3.0.4 compiler (`gstr1-engine.ts`) and a
 * simplified report that ignored it, so credit notes and the HSN summary never
 * reached filing. This module loads the period's invoices and credit notes and
 * runs them through the real compiler.
 */

import { pb } from './pocketbase';
import { getStoreSettings } from './invoice';
import {
    compileGstr1Payload,
    exportGstr1JsonString,
    isValidGstin,
    validateGstr1Payload,
    type Gstr1OfficialPayload,
    type SourceInvoice,
} from './gstr1-engine';

interface InvoiceRow {
    id: string;
    invoice_number?: string;
    invoice_date?: string;
    invoice_type?: string;
    buyer_name?: string;
    buyer_gstin?: string;
    buyer_state_code?: string;
    place_of_supply?: string;
    is_reverse_charge?: boolean;
    grand_total?: number;
    total?: number;
    taxable_value?: number;
    subtotal?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    status?: string;
}

interface InvoiceItemRow {
    id: string;
    invoice?: string;
    description?: string;
    hsn_code?: string;
    quantity?: number;
    unit?: string;
    taxable_amount?: number;
    gst_rate?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    total_amount?: number;
    total?: number;
}

interface CreditNoteRow {
    id: string;
    credit_note_number?: string;
    created?: string;
    original_invoice?: string;
    buyer_name?: string;
    buyer_gstin?: string;
    buyer_state_code?: string;
    grand_total?: number;
    taxable_value?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    status?: string;
}

interface CreditNoteItemRow {
    id: string;
    credit_note?: string;
    description?: string;
    hsn_code?: string;
    quantity?: number;
    unit?: string;
    taxable_amount?: number;
    gst_rate?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    total_amount?: number;
    total?: number;
}

export interface Gstr1BuildResult {
    payload: Gstr1OfficialPayload;
    json: string;
    validation: { valid: boolean; errors: string[]; warnings: string[] };
    meta: {
        gstin: string;
        financialPeriod: string;
        invoices: number;
        creditNotes: number;
    };
}

/** GST filing period is MMYYYY. */
export function toFinancialPeriod(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${month}${date.getFullYear()}`;
}

/** Indian financial year starts on 1 April. */
export function financialYearStart(date: Date): Date {
    const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    return new Date(year, 3, 1, 0, 0, 0, 0);
}

function parseDate(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inRange(value: string | undefined, start: Date, end: Date): boolean {
    const parsed = parseDate(value);
    return Boolean(parsed && parsed >= start && parsed <= end);
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

async function loadItemsByParent(
    collection: 'invoice_items' | 'credit_note_items',
    parentField: 'invoice' | 'credit_note',
    parentIds: string[]
): Promise<Map<string, InvoiceItemRow[] | CreditNoteItemRow[]>> {
    const map = new Map<string, InvoiceItemRow[] | CreditNoteItemRow[]>();
    if (parentIds.length === 0) return map;

    for (const ids of chunk(parentIds, 40)) {
        const filter = ids.map((id) => `${parentField}="${id}"`).join(' || ');
        const rows = await pb.collection(collection).getFullList<InvoiceItemRow & CreditNoteItemRow>({
            filter,
        });
        for (const row of rows) {
            const parent = (row as InvoiceItemRow).invoice || (row as CreditNoteItemRow).credit_note || '';
            const list = (map.get(parent) || []) as Array<InvoiceItemRow & CreditNoteItemRow>;
            list.push(row);
            map.set(parent, list);
        }
    }

    return map;
}

/**
 * Build the official GSTN payload for a date range.
 * Throws with a readable message when the store GSTIN is missing or invalid,
 * because filing without it is not possible.
 */
export async function buildGstr1OfficialPayload(
    startDate: string,
    endDate: string
): Promise<Gstr1BuildResult> {
    const store = await getStoreSettings();
    const gstin = String(store.store_gstin || '').trim().toUpperCase();

    if (!isValidGstin(gstin)) {
        throw new Error('Set a valid 15-character store GSTIN before generating the GSTN file.');
    }

    const end = parseDate(`${endDate}T23:59:59`) || new Date();
    const start = parseDate(`${startDate}T00:00:00`) || new Date(end.getFullYear(), end.getMonth(), 1);

    // A showroom database is small enough to filter in memory, which avoids
    // string-comparison surprises between "2026-10-01" and ISO timestamps.
    const allRegular = await pb.collection('invoices').getFullList<InvoiceRow>({
        filter: 'invoice_type="regular"',
        sort: 'invoice_date',
    });

    const periodInvoices = allRegular.filter(
        (invoice) => invoice.status !== 'cancelled' && inRange(invoice.invoice_date, start, end)
    );

    const invoiceItems = await loadItemsByParent(
        'invoice_items',
        'invoice',
        periodInvoices.map((invoice) => invoice.id)
    );

    const allNotes = await pb.collection('credit_notes').getFullList<CreditNoteRow>({
        filter: 'status != "cancelled" && status != "pending"',
        sort: 'created',
    });

    const periodNotes = allNotes.filter((note) => inRange(note.created, start, end));

    const noteItems = await loadItemsByParent(
        'credit_note_items',
        'credit_note',
        periodNotes.map((note) => note.id)
    );

    const invoiceById = new Map(allRegular.map((invoice) => [invoice.id, invoice]));

    const sourceInvoices: SourceInvoice[] = [
        ...periodInvoices.map((invoice) => ({
            id: invoice.id,
            invoice_number: invoice.invoice_number || invoice.id,
            invoice_date: invoice.invoice_date || '',
            invoice_type: 'regular' as const,
            buyer_name: invoice.buyer_name || 'Walk-in Customer',
            buyer_gstin: invoice.buyer_gstin || '',
            buyer_state_code: invoice.buyer_state_code || '',
            place_of_supply: invoice.place_of_supply || invoice.buyer_state_code || '',
            is_reverse_charge: Boolean(invoice.is_reverse_charge),
            grand_total: invoice.grand_total ?? invoice.total ?? 0,
            taxable_value: invoice.taxable_value ?? invoice.subtotal ?? 0,
            cgst_amount: invoice.cgst_amount || 0,
            sgst_amount: invoice.sgst_amount || 0,
            igst_amount: invoice.igst_amount || 0,
            status: invoice.status === 'draft' ? ('draft' as const) : ('paid' as const),
            items: ((invoiceItems.get(invoice.id) || []) as InvoiceItemRow[]).map((item) => ({
                description: item.description,
                hsn_code: item.hsn_code,
                quantity: item.quantity || 0,
                unit: item.unit,
                taxable_amount: item.taxable_amount || 0,
                gst_rate: item.gst_rate || 0,
                cgst_amount: item.cgst_amount || 0,
                sgst_amount: item.sgst_amount || 0,
                igst_amount: item.igst_amount || 0,
                total: item.total_amount ?? item.total ?? 0,
            })),
        })),
        ...periodNotes.map((note) => {
            const original = note.original_invoice ? invoiceById.get(note.original_invoice) : undefined;
            return {
                id: note.id,
                invoice_number: note.credit_note_number || note.id,
                invoice_date: note.created || '',
                invoice_type: 'credit_note' as const,
                buyer_name: note.buyer_name || 'Walk-in Customer',
                buyer_gstin: note.buyer_gstin || '',
                buyer_state_code: note.buyer_state_code || '',
                place_of_supply: note.buyer_state_code || '',
                is_reverse_charge: false,
                grand_total: note.grand_total || 0,
                taxable_value: note.taxable_value || 0,
                cgst_amount: note.cgst_amount || 0,
                sgst_amount: note.sgst_amount || 0,
                igst_amount: note.igst_amount || 0,
                original_invoice_number: original?.invoice_number,
                original_invoice_date: original?.invoice_date,
                status: 'paid' as const,
                items: ((noteItems.get(note.id) || []) as CreditNoteItemRow[]).map((item) => ({
                    description: item.description,
                    hsn_code: item.hsn_code,
                    quantity: item.quantity || 0,
                    unit: item.unit,
                    taxable_amount: item.taxable_amount || 0,
                    gst_rate: item.gst_rate || 0,
                    cgst_amount: item.cgst_amount || 0,
                    sgst_amount: item.sgst_amount || 0,
                    igst_amount: item.igst_amount || 0,
                    total: item.total_amount ?? item.total ?? 0,
                })),
            };
        }),
    ];

    // Turnover context the GSTN schema expects.
    const fyStart = financialYearStart(end);
    const prevFyStart = new Date(fyStart.getFullYear() - 1, 3, 1);
    const prevFyEnd = new Date(fyStart.getTime() - 1);

    const sumTurnover = (from: Date, to: Date) =>
        allRegular.reduce((sum, invoice) => {
            if (invoice.status === 'cancelled') return sum;
            const date = parseDate(invoice.invoice_date);
            if (!date || date < from || date > to) return sum;
            return sum + (invoice.grand_total ?? invoice.total ?? 0);
        }, 0);

    const payload = compileGstr1Payload(sourceInvoices, {
        supplierGstin: gstin,
        financialPeriod: toFinancialPeriod(end),
        supplierStateCode: store.store_state_code || gstin.substring(0, 2),
        grossTurnoverPrecedingFy: Math.round(sumTurnover(prevFyStart, prevFyEnd) * 100) / 100,
        currentTurnover: Math.round(sumTurnover(fyStart, end) * 100) / 100,
    });

    return {
        payload,
        json: exportGstr1JsonString(payload),
        validation: validateGstr1Payload(payload),
        meta: {
            gstin,
            financialPeriod: toFinancialPeriod(end),
            invoices: periodInvoices.length,
            creditNotes: periodNotes.length,
        },
    };
}
