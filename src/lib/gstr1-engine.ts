import { isValidGstin as isValidGstinChecksum } from './gstin';
import { getStateCode } from './gst';
/**
 * Official Statutory GSTR-1 Return Exports Engine
 * Reverse-engineered from Vyapar BizLogic (GSTR1ReportObject.js, GSTR1HsnReportObject.js, GSTRUnits.js)
 * and fully compliant with GSTN Offline Tool Schema v3.0.4.
 *
 * Implements:
 * - Table 4: B2B Invoices (Registered Customers)
 * - Table 5: B2CL Invoices (Inter-State Unregistered > ₹2.5L / ₹1L)
 * - Table 7: B2CS Invoices (Intra-State & Small B2C Consolidated by POS + Rate)
 * - Table 9B: CDNR & CDNUR (Credit & Debit Notes)
 * - Table 12: HSN Summary of Outward Supplies (Sequential numbering & UQC GMS/CTS)
 * - Table 13: Documents Issued (Serial ranges, cancellations, net issued)
 */

export interface Gstr1ItemDetail {
    rt: number;      // Tax rate (e.g. 3.0, 18.0)
    txval: number;   // Taxable value
    iamt: number;    // Integrated Tax
    camt: number;    // Central Tax
    samt: number;    // State / UT Tax
    csamt: number;   // Cess Amount
}

export interface Gstr1InvoiceItem {
    num: number;     // Sequential 1, 2, ...
    itm_det: Gstr1ItemDetail;
}

export interface Gstr1B2BInvoice {
    inum: string;    // Invoice Number
    idt: string;     // Invoice Date DD-MM-YYYY
    val: number;     // Total Invoice Value
    pos: string;     // 2-digit State Code (Place of Supply)
    rchrg: 'Y' | 'N';// Reverse Charge
    etin: string;    // E-Commerce GSTIN (optional)
    inv_typ: 'R' | 'DE' | 'SEWP' | 'SEWOP'; // Regular, Deemed Export, SEZ
    itms: Gstr1InvoiceItem[];
}

export interface Gstr1B2BRecipient {
    ctin: string;    // 15-character Recipient GSTIN
    cfs?: 'Y' | 'N';
    inv: Gstr1B2BInvoice[];
}

export interface Gstr1B2CLInvoice {
    inum: string;
    idt: string;
    val: number;
    etin: string;
    itms: Gstr1InvoiceItem[];
}

export interface Gstr1B2CLGroup {
    pos: string;
    inv: Gstr1B2CLInvoice[];
}

export interface Gstr1B2CSEntry {
    sply_ty: 'INTER' | 'INTRA';
    rt: number;
    typ: 'OE' | 'E'; // Other than E-commerce, or E-commerce
    pos: string;
    txval: number;
    iamt: number;
    camt: number;
    samt: number;
    csamt: number;
}

export interface Gstr1CdnrNote {
    nt_num: string;
    nt_dt: string;
    ntty: 'C' | 'D'; // Credit or Debit
    inum: string;
    idt: string;
    val: number;
    itms: Gstr1InvoiceItem[];
}

export interface Gstr1CdnrRecipient {
    ctin: string;
    cfs?: 'Y' | 'N';
    nt: Gstr1CdnrNote[];
}

export interface Gstr1CdnurEntry {
    typ: 'B2CL' | 'B2CS' | 'EXPWP' | 'EXPWOP';
    nt_num: string;
    nt_dt: string;
    ntty: 'C' | 'D';
    inum: string;
    idt: string;
    val: number;
    pos: string;
    itms: Gstr1InvoiceItem[];
}

export interface Gstr1HsnRow {
    num: number;     // 1-based sequential
    hsn_sc: string;  // HSN code (e.g. 7113 for Jewelry)
    desc: string;    // Description
    uqc: string;     // Unit Quantity Code (GMS, KGS, CTS, PCS)
    qty: number;     // Total quantity
    val: number;     // Total value (taxable + taxes)
    txval: number;   // Taxable value
    iamt: number;    // IGST
    camt: number;    // CGST
    samt: number;    // SGST
    csamt: number;   // Cess
}

export interface Gstr1DocDetail {
    num: number;
    from: string;
    to: string;
    totnum: number;
    canc: number;
    net_issue: number;
}

export interface Gstr1DocSection {
    doc_num: number; // 1 = Invoices, 4 = Credit Notes
    doc_typ: string; // "Invoices for outward supply", "Credit Note"
    docs: Gstr1DocDetail[];
}

export interface Gstr1OfficialPayload {
    gstin: string;
    fp: string;      // Financial Period MMYYYY
    gt?: number;     // Gross turnover preceding FY (omitted when unknown)
    cur_gt?: number; // Current turnover (omitted when unknown)
    version: string;
    hash?: string;   // GSTN checksum; omitted because it cannot be computed locally
    b2b: Gstr1B2BRecipient[];
    b2cl: Gstr1B2CLGroup[];
    b2cs: Gstr1B2CSEntry[];
    cdnr?: Gstr1CdnrRecipient[];
    cdnur?: Gstr1CdnurEntry[];
    hsn: {
        data: Gstr1HsnRow[];
    };
    doc_issue?: {
        doc_det: Gstr1DocSection[];
    };
}

export interface SourceInvoiceItem {
    description?: string;
    hsn_code?: string;
    quantity: number;
    unit?: string; // 'g', 'ct', 'pcs', etc.
    taxable_amount: number;
    gst_rate: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    total?: number;
}

export interface SourceInvoice {
    id: string;
    invoice_number: string;
    invoice_date: string; // ISO date or YYYY-MM-DD
    invoice_type?: 'regular' | 'credit_note' | 'debit_note';
    buyer_name?: string;
    buyer_gstin?: string;
    buyer_state_code?: string;
    place_of_supply?: string;
    is_reverse_charge?: boolean;
    grand_total: number;
    taxable_value?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    items?: SourceInvoiceItem[];
    original_invoice_number?: string;
    original_invoice_date?: string;
    status?: 'draft' | 'paid' | 'unpaid' | 'cancelled';
}

export interface Gstr1CompileOptions {
    supplierGstin: string;
    financialPeriod: string; // MMYYYY (e.g. "102026")
    supplierStateCode?: string; // 2-digit, default parsed from GSTIN
    b2cLargeThreshold?: number; // Default ₹250,000 (statutory default)
    grossTurnoverPrecedingFy?: number;
    currentTurnover?: number;
}

/**
 * Validates 15-digit Indian GSTIN format
 */
export function isValidGstin(gstin?: string): boolean {
    // Shape plus the official check digit; see src/lib/gstin.ts.
    return isValidGstinChecksum(gstin);
}

/**
 * Normalizes 2-digit State Code from GSTIN, state code or state name.
 * Handles "29", "29-Karnataka" and "Karnataka" alike (FIN-09).
 */
export function extractStateCode(gstinOrCode?: string): string {
    const clean = String(gstinOrCode ?? '').trim();
    if (!clean) return '';
    if (/^\d{2}/.test(clean)) {
        return clean.substring(0, 2);
    }
    return getStateCode(clean);
}

/**
 * Raised when the source data cannot be turned into a statutory GSTR-1 payload
 * without inventing values (missing dates, missing item rows). Named so callers
 * can distinguish a data problem from a transport/runtime failure.
 */
export class Gstr1CompileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'Gstr1CompileError';
    }
}

/**
 * Format date to standard GSTN format DD-MM-YYYY.
 * Returns null for a missing or invalid date: filing a fabricated date is worse
 * than refusing the return (INV-8).
 */
export function formatGstnDate(dateStr?: string): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

/**
 * Strict variant used after the compile-time date gate, so a document that
 * reaches a GSTN table always carries a real date.
 */
function requireGstnDate(dateStr: string | undefined, label: string): string {
    const formatted = formatGstnDate(dateStr);
    if (!formatted) {
        throw new Gstr1CompileError(
            `${label} has no valid date ("${dateStr ?? ''}"). Correct the date before filing GSTR-1.`
        );
    }
    return formatted;
}

/**
 * Financial rounding helper (2 decimal places)
 */
function round2(val: number): number {
    return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

/**
 * Standardize UQC (Unit Quantity Code) per GSTN GSTRUnits specification
 */
export function normalizeUqc(unit?: string): string {
    if (!unit) return 'GMS';
    const u = unit.trim().toLowerCase();
    if (u === 'g' || u === 'gm' || u === 'gms' || u === 'gram' || u === 'grams') return 'GMS';
    if (u === 'kg' || u === 'kgs' || u === 'kilogram') return 'KGS';
    if (u === 'ct' || u === 'cts' || u === 'carat' || u === 'carats') return 'CTS';
    if (u === 'pcs' || u === 'pc' || u === 'pieces' || u === 'nos' || u === 'item') return 'PCS';
    return 'OTH';
}

/**
 * Core Compilation Engine: Converts internal invoices & credit notes into official GSTR-1 JSON
 */
export function compileGstr1Payload(
    invoices: SourceInvoice[],
    options: Gstr1CompileOptions
): Gstr1OfficialPayload {
    const supplierGstin = (options.supplierGstin || '').trim().toUpperCase();
    // store_state_code may arrive as "29" or "Karnataka"; normalise both before
    // comparing with the place of supply (FIN-09).
    const supplierState = extractStateCode(options.supplierStateCode) || extractStateCode(supplierGstin);
    const b2cThreshold = options.b2cLargeThreshold || 250000;

    const b2bMap = new Map<string, Gstr1B2BInvoice[]>();
    const b2clMap = new Map<string, Gstr1B2CLInvoice[]>();
    const b2csMap = new Map<string, Gstr1B2CSEntry>();
    const cdnrMap = new Map<string, Gstr1CdnrNote[]>();
    const cdnurList: Gstr1CdnurEntry[] = [];
    const hsnMap = new Map<string, { desc: string; uqc: string; qty: number; val: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }>();

    const regularInvoices = invoices.filter(inv => inv.invoice_type !== 'credit_note' && inv.invoice_type !== 'debit_note');
    const creditNotes = invoices.filter(inv => inv.invoice_type === 'credit_note' || inv.invoice_type === 'debit_note');

    // Compile-time data gates. Every document that reaches a GSTN table needs a
    // real date and real item rows; fabricating either files wrong data under
    // the taxpayer's GSTIN (INV-8, INV-9). Validate all documents up front and
    // name the ones that must be fixed.
    const invalidDates: string[] = [];
    const missingItems: string[] = [];
    for (const inv of regularInvoices) {
        if (inv.status === 'cancelled' || inv.status === 'draft') continue;
        const label = `Invoice ${inv.invoice_number || inv.id}`;
        if (!formatGstnDate(inv.invoice_date)) invalidDates.push(label);
        if (!inv.items || inv.items.length === 0) missingItems.push(label);
    }
    for (const cn of creditNotes) {
        if (cn.status === 'cancelled' || cn.status === 'draft') continue;
        const label = `${cn.invoice_type === 'debit_note' ? 'Debit' : 'Credit'} note ${cn.invoice_number || cn.id}`;
        if (!formatGstnDate(cn.invoice_date)) invalidDates.push(label);
        if (cn.original_invoice_date && !formatGstnDate(cn.original_invoice_date)) {
            invalidDates.push(`${label} (original invoice date)`);
        }
    }
    if (invalidDates.length > 0) {
        throw new Gstr1CompileError(
            `GSTR-1 compilation stopped: missing or invalid date on ${invalidDates.join(', ')}. Correct the dates and recompile.`
        );
    }
    if (missingItems.length > 0) {
        throw new Gstr1CompileError(
            `GSTR-1 compilation stopped: ${missingItems.join(', ')} has no line items, so the GST rate and HSN cannot be derived. Add the invoice lines and recompile.`
        );
    }

    // Document numbers tracker. Drafts were never issued; cancelled documents
    // stay in the range so Table 13 can report them (FIN-18).
    const sortInvoiceNumbers = (numbers: string[]) =>
        [...numbers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const issuedInvoices = regularInvoices.filter(i => i.status !== 'draft');
    const issuedNotes = creditNotes.filter(i => i.status !== 'draft');
    const invoiceNumbers = sortInvoiceNumbers(issuedInvoices.map(i => i.invoice_number).filter(Boolean));
    const creditNoteNumbers = sortInvoiceNumbers(issuedNotes.map(i => i.invoice_number).filter(Boolean));
    const cancelledInvoices = issuedInvoices.filter(i => i.status === 'cancelled').length;
    const cancelledCreditNotes = issuedNotes.filter(i => i.status === 'cancelled').length;

    // Process Regular Invoices
    for (const inv of regularInvoices) {
        // Cancelled/draft docs are omitted from the transaction tables.
        if (inv.status === 'cancelled' || inv.status === 'draft') continue;

        // Runtime values may be null despite the types; normalise before
        // trimming or classifying (FIN-09).
        const buyerGstin = String(inv.buyer_gstin ?? '').trim().toUpperCase();
        const hasValidBuyerGstin = isValidGstin(buyerGstin);
        const pos = extractStateCode(inv.place_of_supply)
            || extractStateCode(inv.buyer_state_code)
            || (hasValidBuyerGstin ? buyerGstin.substring(0, 2) : supplierState);
        const isInterState = pos !== supplierState;
        const invDate = requireGstnDate(inv.invoice_date, `Invoice ${inv.invoice_number || inv.id}`);
        const invValue = round2(inv.grand_total);

        // Group items by rate. The compile-time gate above rejects documents
        // with no lines instead of synthesising an HSN 7113 row at a guessed
        // rate (INV-9).
        const rateGroups = new Map<number, Gstr1ItemDetail>();
        const items = inv.items ?? [];

        for (const itm of items) {
            const rt = Number(itm.gst_rate) || 0;
            const txval = round2(itm.taxable_amount);
            const iamt = round2(itm.igst_amount || 0);
            const camt = round2(itm.cgst_amount || 0);
            const samt = round2(itm.sgst_amount || 0);
            const csamt = 0;

            if (!rateGroups.has(rt)) {
                rateGroups.set(rt, { rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
            }
            const grp = rateGroups.get(rt)!;
            grp.txval = round2(grp.txval + txval);
            grp.iamt = round2(grp.iamt + iamt);
            grp.camt = round2(grp.camt + camt);
            grp.samt = round2(grp.samt + samt);

            // Accumulate Table 12 HSN
            const hsnCode = itm.hsn_code || '7113';
            const uqc = normalizeUqc(itm.unit);
            const hsnKey = `${hsnCode}_${uqc}`;
            const itemTotalVal = round2(txval + iamt + camt + samt);

            if (!hsnMap.has(hsnKey)) {
                hsnMap.set(hsnKey, {
                    desc: itm.description?.split(' - ')[0] || 'Articles of jewellery & parts thereof',
                    uqc,
                    qty: 0,
                    val: 0,
                    txval: 0,
                    iamt: 0,
                    camt: 0,
                    samt: 0,
                    csamt: 0,
                });
            }
            const hEntry = hsnMap.get(hsnKey)!;
            hEntry.qty = Math.round((hEntry.qty + (Number(itm.quantity) || 0)) * 1000) / 1000;
            hEntry.val = round2(hEntry.val + itemTotalVal);
            hEntry.txval = round2(hEntry.txval + txval);
            hEntry.iamt = round2(hEntry.iamt + iamt);
            hEntry.camt = round2(hEntry.camt + camt);
            hEntry.samt = round2(hEntry.samt + samt);
        }

        const invoiceItems: Gstr1InvoiceItem[] = Array.from(rateGroups.values()).map((grp, idx) => ({
            num: idx + 1,
            itm_det: grp,
        }));

        // 1. Table 4: B2B
        if (hasValidBuyerGstin) {
            if (!b2bMap.has(buyerGstin)) b2bMap.set(buyerGstin, []);
            b2bMap.get(buyerGstin)!.push({
                inum: inv.invoice_number,
                idt: invDate,
                val: invValue,
                pos,
                rchrg: inv.is_reverse_charge ? 'Y' : 'N',
                etin: '',
                inv_typ: 'R',
                itms: invoiceItems,
            });
        }
        // 2. Table 5: B2CL (Inter-State Unregistered > Threshold)
        else if (isInterState && invValue > b2cThreshold) {
            if (!b2clMap.has(pos)) b2clMap.set(pos, []);
            b2clMap.get(pos)!.push({
                inum: inv.invoice_number,
                idt: invDate,
                val: invValue,
                etin: '',
                itms: invoiceItems,
            });
        }
        // 3. Table 7: B2CS (Intra-State or Small B2C)
        else {
            for (const item of invoiceItems) {
                const rt = item.itm_det.rt;
                const sply_ty: 'INTER' | 'INTRA' = isInterState ? 'INTER' : 'INTRA';
                const b2csKey = `${sply_ty}_${pos}_${rt}`;

                if (!b2csMap.has(b2csKey)) {
                    b2csMap.set(b2csKey, {
                        sply_ty,
                        rt,
                        typ: 'OE',
                        pos,
                        txval: 0,
                        iamt: 0,
                        camt: 0,
                        samt: 0,
                        csamt: 0,
                    });
                }
                const bEntry = b2csMap.get(b2csKey)!;
                bEntry.txval = round2(bEntry.txval + item.itm_det.txval);
                bEntry.iamt = round2(bEntry.iamt + item.itm_det.iamt);
                bEntry.camt = round2(bEntry.camt + item.itm_det.camt);
                bEntry.samt = round2(bEntry.samt + item.itm_det.samt);
            }
        }
    }

    // Process Credit & Debit Notes (Table 9B)
    for (const cn of creditNotes) {
        if (cn.status === 'cancelled' || cn.status === 'draft') continue;

        const buyerGstin = String(cn.buyer_gstin ?? '').trim().toUpperCase();
        const hasValidBuyerGstin = isValidGstin(buyerGstin);
        const pos = extractStateCode(cn.place_of_supply)
            || extractStateCode(cn.buyer_state_code)
            || (hasValidBuyerGstin ? buyerGstin.substring(0, 2) : supplierState);
        const cnDate = requireGstnDate(cn.invoice_date, `${cn.invoice_type === 'debit_note' ? 'Debit' : 'Credit'} note ${cn.invoice_number || cn.id}`);
        const origDate = requireGstnDate(
            cn.original_invoice_date || cn.invoice_date,
            `Original invoice for ${cn.invoice_number || cn.id}`
        );
        const cnValue = round2(cn.grand_total);
        const ntty: 'C' | 'D' = cn.invoice_type === 'debit_note' ? 'D' : 'C';

        // Aggregate the note's own lines by GST rate instead of assuming a
        // single 3% line (FIN-06). Notes without item rows fall back to the
        // header amounts, deriving the rate actually carried.
        const cnRateGroups = new Map<number, Gstr1ItemDetail>();
        const cnSourceItems = cn.items && cn.items.length > 0 ? cn.items : [];

        if (cnSourceItems.length > 0) {
            for (const itm of cnSourceItems) {
                const rt = Number(itm.gst_rate) || 0;
                const txval = round2(itm.taxable_amount || 0);
                const iamt = round2(itm.igst_amount || 0);
                const camt = round2(itm.cgst_amount || 0);
                const samt = round2(itm.sgst_amount || 0);

                if (!cnRateGroups.has(rt)) {
                    cnRateGroups.set(rt, { rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
                }
                const grp = cnRateGroups.get(rt)!;
                grp.txval = round2(grp.txval + txval);
                grp.iamt = round2(grp.iamt + iamt);
                grp.camt = round2(grp.camt + camt);
                grp.samt = round2(grp.samt + samt);
            }
        } else {
            const taxTotal = round2((cn.igst_amount || 0) + (cn.cgst_amount || 0) + (cn.sgst_amount || 0));
            const txval = round2(cn.taxable_value ?? Math.max(0, round2(cnValue - taxTotal)));
            const rt = txval > 0 ? round2((taxTotal / txval) * 100) : 0;
            cnRateGroups.set(rt, {
                rt,
                txval,
                iamt: round2(cn.igst_amount || 0),
                camt: round2(cn.cgst_amount || 0),
                samt: round2(cn.sgst_amount || 0),
                csamt: 0,
            });
        }

        const cnItems: Gstr1InvoiceItem[] = Array.from(cnRateGroups.values()).map((grp, idx) => ({
            num: idx + 1,
            itm_det: grp,
        }));

        // Table 12 is a net-of-returns summary: credit notes reduce the HSN
        // totals, debit notes increase them (FIN-06).
        for (const itm of cnSourceItems) {
            const hsnCode = itm.hsn_code || '7113';
            const uqc = normalizeUqc(itm.unit);
            const hsnKey = `${hsnCode}_${uqc}`;
            const txval = round2(itm.taxable_amount || 0);
            const iamt = round2(itm.igst_amount || 0);
            const camt = round2(itm.cgst_amount || 0);
            const samt = round2(itm.sgst_amount || 0);
            const itemTotalVal = round2(txval + iamt + camt + samt);
            const sign = ntty === 'C' ? -1 : 1;

            if (!hsnMap.has(hsnKey)) {
                hsnMap.set(hsnKey, {
                    desc: itm.description?.split(' - ')[0] || 'Articles of jewellery & parts thereof',
                    uqc,
                    qty: 0,
                    val: 0,
                    txval: 0,
                    iamt: 0,
                    camt: 0,
                    samt: 0,
                    csamt: 0,
                });
            }
            const hEntry = hsnMap.get(hsnKey)!;
            hEntry.qty = Math.round((hEntry.qty + sign * (Number(itm.quantity) || 0)) * 1000) / 1000;
            hEntry.val = round2(hEntry.val + sign * itemTotalVal);
            hEntry.txval = round2(hEntry.txval + sign * txval);
            hEntry.iamt = round2(hEntry.iamt + sign * iamt);
            hEntry.camt = round2(hEntry.camt + sign * camt);
            hEntry.samt = round2(hEntry.samt + sign * samt);
        }

        if (hasValidBuyerGstin) {
            if (!cdnrMap.has(buyerGstin)) cdnrMap.set(buyerGstin, []);
            cdnrMap.get(buyerGstin)!.push({
                nt_num: cn.invoice_number,
                nt_dt: cnDate,
                ntty,
                inum: cn.original_invoice_number || 'INV-ORIG',
                idt: origDate,
                val: cnValue,
                itms: cnItems,
            });
        } else {
            cdnurList.push({
                typ: cnValue > b2cThreshold && pos !== supplierState ? 'B2CL' : 'B2CS',
                nt_num: cn.invoice_number,
                nt_dt: cnDate,
                ntty,
                inum: cn.original_invoice_number || 'INV-ORIG',
                idt: origDate,
                val: cnValue,
                pos,
                itms: cnItems,
            });
        }
    }

    // Build Table 13 Documents Summary
    const docSections: Gstr1DocSection[] = [];
    if (invoiceNumbers.length > 0) {
        docSections.push({
            doc_num: 1,
            doc_typ: 'Invoices for outward supply',
            docs: [{
                num: 1,
                from: invoiceNumbers[0],
                to: invoiceNumbers[invoiceNumbers.length - 1],
                totnum: invoiceNumbers.length,
                canc: cancelledInvoices,
                net_issue: invoiceNumbers.length - cancelledInvoices,
            }],
        });
    }
    if (creditNoteNumbers.length > 0) {
        docSections.push({
            doc_num: 4,
            doc_typ: 'Credit Note',
            docs: [{
                num: 1,
                from: creditNoteNumbers[0],
                to: creditNoteNumbers[creditNoteNumbers.length - 1],
                totnum: creditNoteNumbers.length,
                canc: cancelledCreditNotes,
                net_issue: creditNoteNumbers.length - cancelledCreditNotes,
            }],
        });
    }

    // Assemble B2B recipients
    const b2b: Gstr1B2BRecipient[] = Array.from(b2bMap.entries()).map(([ctin, inv]) => ({
        ctin,
        inv,
    }));

    // Assemble B2CL groups
    const b2cl: Gstr1B2CLGroup[] = Array.from(b2clMap.entries()).map(([pos, inv]) => ({
        pos,
        inv,
    }));

    // Assemble B2CS entries
    const b2cs: Gstr1B2CSEntry[] = Array.from(b2csMap.values());

    // Assemble CDNR recipients
    const cdnr: Gstr1CdnrRecipient[] | undefined = cdnrMap.size > 0
        ? Array.from(cdnrMap.entries()).map(([ctin, nt]) => ({ ctin, nt }))
        : undefined;

    // Assemble Table 12 HSN rows (with strict 1-based sequential num)
    const hsnRows: Gstr1HsnRow[] = Array.from(hsnMap.entries()).map(([hsnKey, data], index) => {
        const hsnCode = hsnKey.split('_')[0];
        return {
            num: index + 1,
            hsn_sc: hsnCode,
            desc: data.desc,
            uqc: data.uqc,
            qty: data.qty,
            val: data.val,
            txval: data.txval,
            iamt: data.iamt,
            camt: data.camt,
            samt: data.samt,
            csamt: data.csamt,
        };
    });

    return {
        gstin: supplierGstin,
        fp: options.financialPeriod,
        // Omit turnover when the caller did not supply it. A placeholder zero
        // reads as "no turnover" on the GSTN form, which is a filed fact, not a
        // default (INV-10).
        ...(Number.isFinite(options.grossTurnoverPrecedingFy) ? { gt: options.grossTurnoverPrecedingFy } : {}),
        ...(Number.isFinite(options.currentTurnover) ? { cur_gt: options.currentTurnover } : {}),
        version: 'GST3.0.4',
        // No `hash`: the GSTN checksum cannot be computed locally, and the old
        // literal "hash" was not a checksum at all (INV-10).
        b2b,
        b2cl,
        b2cs,
        cdnr,
        cdnur: cdnurList.length > 0 ? cdnurList : undefined,
        hsn: {
            data: hsnRows,
        },
        doc_issue: docSections.length > 0 ? { doc_det: docSections } : undefined,
    };
}

/**
 * Validates GSTR-1 payload against statutory GSTN requirements
 */
export function validateGstr1Payload(payload: Gstr1OfficialPayload): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!payload.gstin || !isValidGstin(payload.gstin)) {
        errors.push(`Invalid supplier GSTIN: "${payload.gstin}". Must be 15 alphanumeric characters.`);
    }

    if (!payload.fp || !/^\d{6}$/.test(payload.fp)) {
        errors.push(`Invalid financial period "${payload.fp}". Must be MMYYYY (e.g. 102026).`);
    }

    // Check Table 4 B2B
    for (const b of payload.b2b) {
        if (!isValidGstin(b.ctin)) {
            errors.push(`Invalid buyer GSTIN in B2B table: "${b.ctin}".`);
        }
        for (const inv of b.inv) {
            if (!inv.inum) errors.push(`B2B invoice missing inum.`);
            if (!inv.idt) errors.push(`B2B invoice #${inv.inum} missing idt.`);
            if (inv.val <= 0) warnings.push(`B2B invoice #${inv.inum} value is non-positive.`);
            for (const itm of inv.itms) {
                const taxSum = round2(itm.itm_det.iamt + itm.itm_det.camt + itm.itm_det.samt + itm.itm_det.csamt);
                const calcVal = round2(itm.itm_det.txval + taxSum);
                if (Math.abs(calcVal - inv.val) > 2.0 && inv.itms.length === 1) {
                    warnings.push(`Invoice #${inv.inum} item calculation (₹${calcVal}) differs from invoice value (₹${inv.val}).`);
                }
            }
        }
    }

    // Check Table 12 HSN sequential numbering
    if (payload.hsn && payload.hsn.data) {
        for (let i = 0; i < payload.hsn.data.length; i++) {
            const row = payload.hsn.data[i];
            if (row.num !== i + 1) {
                errors.push(`HSN Table row #${i + 1} has non-sequential num: ${row.num}. Must be ${i + 1}.`);
            }
            if (!row.hsn_sc) {
                errors.push(`HSN row #${i + 1} is missing HSN code.`);
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Returns formatted JSON string for GST Offline Tool
 */
export function exportGstr1JsonString(payload: Gstr1OfficialPayload): string {
    return JSON.stringify(payload, null, 2);
}
