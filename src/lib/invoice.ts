/**
 * Invoice Service Layer
 * Handles invoice CRUD operations, generation from sales, and printing using PocketBase
 */

import { pb, sanitizeFilter, getCurrentTenantEmail, getTenantStorageKey } from './pocketbase';
import {
    calculateGST,
    amountToWords,
    getHSNForProduct,
    GST_RATES,
} from './gst';
import { getNextSequenceNumber, createWithUniqueRetry } from './sequence-generator';
import { normalizeDateBounds } from './utils';
import {
    computeInclusiveLines,
    resolveLineGstRate,
    toPaise,
    toRupees,
} from './invoice-math';
import type { ProductVariant } from '../types/database';

// ===========================================
// TYPES
// ===========================================
export interface InvoiceItem {
    id?: string;
    invoice_id?: string;
    variant_id?: string;
    variant?: string;
    stock_level?: number;
    sr_no: number;
    description: string;
    hsn_code: string;
    quantity: number;
    unit: string;
    unit_price: number;
    discount_percent: number;
    discount_amount: number;
    taxable_amount: number;
    gst_rate: number;
    cgst_rate: number;
    cgst_amount: number;
    sgst_rate: number;
    sgst_amount: number;
    igst_rate: number;
    igst_amount: number;
    cess_rate: number;
    cess_amount: number;
    total_amount: number;
    // Jewelry Specifications (Vyapar / BIS Aligned)
    gross_weight?: number;
    net_weight?: number;
    stone_weight?: number;
    stone_amount?: number;
    purity_karat?: string;
    making_charges?: number;
    making_charges_type?: 'per_gram' | 'fixed' | 'percent';
    wastage_percent?: number;
    huid_code?: string;
}

export interface Invoice {
    id?: string;
    invoice_number?: string;
    invoice_date: string;
    invoice_type: 'regular' | 'credit_note' | 'debit_note';

    // Seller
    seller_gstin: string;
    seller_name: string;
    seller_address: string;
    seller_state_code: string;

    // Buyer
    buyer_name: string;
    buyer_gstin: string;
    buyer_phone: string;
    buyer_email: string;
    buyer_address: string;
    buyer_state_code: string;
    place_of_supply: string;

    // Relations & Dual-Mapping
    sale_id?: string;
    order_id?: string;
    customer_id?: string;
    order?: string;
    customer?: string;
    sale?: string;
    status?: 'paid' | 'pending' | 'overdue' | 'partially_paid' | 'cancelled';
    subtotal?: number;
    discount?: number;
    tax?: number;
    total?: number;

    // Amounts
    taxable_value: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    cess_amount: number;
    total_tax: number;
    discount_amount: number;
    shipping_charges: number;
    grand_total: number;
    amount_in_words: string;

    // Additional
    is_reverse_charge: boolean;
    transport_mode?: string;
    vehicle_number?: string;
    payment_terms?: string;
    due_date?: string;
    is_paid: boolean;
    paid_amount: number;
    notes?: string;

    // E-way Bill Tracking
    eway_bill_no?: string;
    eway_bill_date?: string;
    eway_bill_valid_until?: string;
    eway_bill_status?: string;

    // Items
    items: InvoiceItem[];

    // Metadata
    created_at?: string;
    updated_at?: string;

    // UI/Legacy Compatibility
    invoice_status?: 'paid' | 'pending' | 'overdue' | 'partially_paid' | 'cancelled';
    customer_phone?: string;
    customer_email?: string;
    round_off?: number;
    is_deleted?: boolean;
    balance_due?: number;
    payments?: {
        id: string;
        amount: number;
        date: string;
        payment_date?: string;
        method: string;
        reference?: string;
        recorded_by?: string;
    }[];
}

export async function recordPayment(paymentDetails: {
    invoice_id: string;
    amount: number;
    payment_method: string;
    reference?: string;
    payment_date: string;
    recorded_by: string;
}): Promise<void> {
    // Record payment in invoice_payments collection (spec schema: reference_number, notes)
    await pb.collection('invoice_payments').create({
        invoice: paymentDetails.invoice_id,
        amount: paymentDetails.amount,
        payment_date: paymentDetails.payment_date,
        payment_method: paymentDetails.payment_method,
        reference_number: paymentDetails.reference || '',
        notes: paymentDetails.recorded_by ? `Recorded by ${paymentDetails.recorded_by}` : '',
    });

    // Update invoice paid amount and status. Derive the new amount from the invoice_payments
    // ledger (the row above is already committed) instead of the record's paid_amount snapshot,
    // so two concurrent payments cannot overwrite each other's increment (lost read-modify-write).
    // Math.max keeps amounts recorded outside the ledger (e.g. paid at creation, markInvoicePaid,
    // payment-link reconciliation) from being dropped.
    const invoice = await pb.collection('invoices').getOne(paymentDetails.invoice_id);
    const ledgerRows = await pb.collection('invoice_payments').getFullList({
        filter: `invoice="${paymentDetails.invoice_id}"`,
        requestKey: null,
    });
    const ledgerTotal = ledgerRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const invoiceTotal = Number(invoice.total || invoice.grand_total || 0);
    const newPaidAmount = Math.max((invoice.paid_amount || 0) + paymentDetails.amount, ledgerTotal);
    const isPaid = invoiceTotal > 0 && newPaidAmount >= invoiceTotal;

    const updatePayload = {
        paid_amount: newPaidAmount,
        status: isPaid ? 'paid' : 'partially_paid',
        is_paid: isPaid,
    };

    await pb.collection('invoices').update(paymentDetails.invoice_id, updatePayload);
}

export interface StoreSettings {
    store_name: string;
    store_gstin: string;
    store_address: string;
    store_city: string;
    store_state: string;
    store_state_code: string;
    store_pincode: string;
    store_phone: string;
    store_email: string;
    store_pan: string;
    bank_name: string;
    bank_account_no: string;
    bank_ifsc: string;
    bank_branch: string;
    invoice_prefix: string;
    invoice_terms: string;
    invoice_footer: string;
    store_logo: string;
    companyLogo?: string | null;
    whatsappPhone?: string;
    default_print_mode: 'regular' | 'thermal58' | 'thermal80';
    is_gst_registered?: boolean;
}

// ===========================================
// STORE SETTINGS
// ===========================================
const REAL_STORE_DEFAULTS: StoreSettings = {
    store_name: '',
    store_gstin: '',
    store_address: '',
    store_city: '',
    store_state: '',
    store_state_code: '',
    store_pincode: '',
    store_phone: '',
    store_email: '',
    store_pan: '',
    bank_name: '',
    bank_account_no: '',
    bank_ifsc: '',
    bank_branch: '',
    invoice_prefix: 'INV',
    invoice_terms: '',
    invoice_footer: 'Thank you for your business!',
    store_logo: '',
    default_print_mode: 'regular',
    is_gst_registered: false,
};

/**
 * Mutable accumulator used while merging localStorage blobs, PocketBase key/value
 * rows and camelCase legacy aliases into a StoreSettings result.
 */
interface StoreSettingsAccumulator extends Omit<StoreSettings, 'is_gst_registered'> {
    [key: string]: unknown;
    // Individual PocketBase rows may store this flag as a string before normalization below.
    is_gst_registered?: boolean | string;
    storeName?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string;
    gstin?: string;
    pan?: string;
    stateCode?: string;
    bankName?: string;
    accountNumber?: string;
    ifsc?: string;
    branch?: string;
    invoiceFooter?: string;
    invoiceTerms?: string;
    isGstRegistered?: boolean | string;
}

export async function getStoreSettings(): Promise<StoreSettings> {
    try {
        const settings: StoreSettingsAccumulator = { ...REAL_STORE_DEFAULTS };
        const tenantEmail = getCurrentTenantEmail();
        const currentUserId = pb.authStore.record?.id;

        // 1. Check localStorage first (fast client-side reactive store scoped to tenant)
        if (typeof window !== 'undefined') {
            const rawStored = localStorage.getItem(getTenantStorageKey('luminila_settings'));
            if (rawStored) {
                try {
                    const parsed = JSON.parse(rawStored);
                    if (parsed.storeName) settings.store_name = parsed.storeName;
                    if (parsed.address) settings.store_address = parsed.address;
                    if (parsed.city) settings.store_city = parsed.city;
                    if (parsed.state) settings.store_state = parsed.state;
                    if (parsed.pincode) settings.store_pincode = parsed.pincode;
                    if (parsed.whatsappPhone) settings.store_phone = parsed.whatsappPhone;
                    else if (parsed.phone) settings.store_phone = parsed.phone;
                    if (parsed.email) settings.store_email = parsed.email;
                    if (parsed.gstin !== undefined) settings.store_gstin = parsed.gstin;
                    if (parsed.pan) settings.store_pan = parsed.pan;
                    if (parsed.stateCode) settings.store_state_code = parsed.stateCode;
                    if (parsed.bankName) settings.bank_name = parsed.bankName;
                    if (parsed.accountNumber) settings.bank_account_no = parsed.accountNumber;
                    if (parsed.ifsc) settings.bank_ifsc = parsed.ifsc;
                    if (parsed.branch) settings.bank_branch = parsed.branch;
                    if (parsed.invoiceFooter) settings.invoice_footer = parsed.invoiceFooter;
                    if (parsed.invoiceTerms) settings.invoice_terms = parsed.invoiceTerms;
                    if (parsed.companyLogo) {
                        settings.store_logo = parsed.companyLogo;
                        settings.companyLogo = parsed.companyLogo;
                    }
                    if (parsed.isGstRegistered !== undefined) settings.is_gst_registered = Boolean(parsed.isGstRegistered);
                } catch { }
            }
        }

        // 2. Fetch records from PocketBase scoped strictly by tenant email
        try {
            const filter = tenantEmail && tenantEmail !== 'default' ? `account_email="${tenantEmail}"` : '';
            const records = await pb.collection('store_settings').getFullList<{ key: string; value: string; account_email?: string }>({
                filter,
                requestKey: null
            });

            // Check for JSON blobs: tenant/user scoped
            const targetBlobKey = currentUserId ? `store_settings_${currentUserId}` : null;
            const blob = (targetBlobKey ? records.find(r => r.key === targetBlobKey) : null) ||
                         records.find(r => r.key === 'store_settings_default');

            if (blob && blob.value) {
                try {
                    const parsed = typeof blob.value === 'string' ? JSON.parse(blob.value) : blob.value;
                    if (parsed.storeName) settings.store_name = parsed.storeName;
                    if (parsed.address) settings.store_address = parsed.address;
                    if (parsed.city) settings.store_city = parsed.city;
                    if (parsed.state) settings.store_state = parsed.state;
                    if (parsed.pincode) settings.store_pincode = parsed.pincode;
                    if (parsed.whatsappPhone) settings.store_phone = parsed.whatsappPhone;
                    else if (parsed.phone) settings.store_phone = parsed.phone;
                    if (parsed.email) settings.store_email = parsed.email;
                    if (parsed.gstin !== undefined) settings.store_gstin = parsed.gstin;
                    if (parsed.pan) settings.store_pan = parsed.pan;
                    if (parsed.stateCode) settings.store_state_code = parsed.stateCode;
                    if (parsed.bankName) settings.bank_name = parsed.bankName;
                    if (parsed.accountNumber) settings.bank_account_no = parsed.accountNumber;
                    if (parsed.ifsc) settings.bank_ifsc = parsed.ifsc;
                    if (parsed.branch) settings.bank_branch = parsed.branch;
                    if (parsed.invoiceFooter) settings.invoice_footer = parsed.invoiceFooter;
                    if (parsed.invoiceTerms) settings.invoice_terms = parsed.invoiceTerms;
                    if (parsed.companyLogo) {
                        settings.store_logo = parsed.companyLogo;
                        settings.companyLogo = parsed.companyLogo;
                    }
                    if (parsed.isGstRegistered !== undefined) settings.is_gst_registered = Boolean(parsed.isGstRegistered);
                } catch { }
            }

            // Overlay individual keys if present
            records.forEach((row) => {
                if (row.key.startsWith('store_settings_')) return;
                let val = row.value || '';
                try {
                    if (typeof val === 'string' && (val.startsWith('"') || val.startsWith('{'))) {
                        val = JSON.parse(val);
                    }
                } catch { }
                if (val !== undefined && val !== null && val !== '') {
                    // Do not let flat store_logo overwrite uploaded companyLogo
                    if (row.key === 'store_logo' && settings.companyLogo) return;
                    settings[row.key] = val;
                }
            });
        } catch { }

        // Ensure snake_case aliases are set
        if (settings.storeName && !settings.store_name) settings.store_name = settings.storeName;
        if (settings.companyLogo) settings.store_logo = settings.companyLogo;
        if (settings.address && !settings.store_address) settings.store_address = settings.address;
        if (settings.city && !settings.store_city) settings.store_city = settings.city;
        if (settings.state && !settings.store_state) settings.store_state = settings.state;
        if (settings.pincode && !settings.store_pincode) settings.store_pincode = settings.pincode;
        if (settings.whatsappPhone && !settings.store_phone) settings.store_phone = settings.whatsappPhone;
        else if (settings.phone && !settings.store_phone) settings.store_phone = settings.phone;
        if (settings.email && !settings.store_email) settings.store_email = settings.email;
        if (settings.gstin !== undefined) settings.store_gstin = settings.gstin;
        if (settings.is_gst_registered === "true" || settings.is_gst_registered === true) settings.is_gst_registered = true;
        if (settings.is_gst_registered === "false" || settings.is_gst_registered === false) settings.is_gst_registered = false;
        if (settings.isGstRegistered !== undefined) settings.is_gst_registered = Boolean(settings.isGstRegistered);

        if (settings.is_gst_registered === undefined) {
            settings.is_gst_registered = Boolean(settings.store_gstin && settings.store_gstin.trim() !== "");
        }

        if (settings.is_gst_registered === false) {
            settings.store_gstin = "";
        }

        return settings as unknown as StoreSettings;
    } catch (error) {
        console.error('Error fetching store settings:', error);
        return { ...REAL_STORE_DEFAULTS };
    }
}

// The old `updateStoreSettings` writer was removed: it had no callers, wrote rows
// without `account_email`, and could not be read back by `getStoreSettings`.
// Settings are written by the tenant-scoped service in `src/lib/settings.ts`.

// ===========================================
// NUMBER GENERATION (PocketBase sequence)
// ===========================================
export async function generateInvoiceNumber(): Promise<string> {
    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();

    // Determine financial year
    let fyStart = year;
    if (month < 4) fyStart = year - 1;
    const fyEnd = fyStart + 1;
    const fyPrefix = `${fyStart.toString().slice(-2)}${fyEnd.toString().slice(-2)}`;

    const seqName = `invoice_${fyPrefix}`;

    return getNextSequenceNumber({
        seqName,
        prefix: 'INV',
        padding: 5,
        formatFn: (nextValue) => `INV/${fyPrefix.slice(0, 2)}-${fyPrefix.slice(2)}/${nextValue.toString().padStart(5, '0')}`,
    });
}

// ===========================================
// INVOICE CRUD
// ===========================================

export async function createInvoice(invoice: Omit<Invoice, 'id' | 'created_at' | 'updated_at'>): Promise<Invoice> {
    // Honor a caller-supplied number (e.g. from cloneInvoice) verbatim without consuming an
    // extra sequence value; otherwise createWithUniqueRetry below allocates exactly one number.
    const explicitNumber = invoice.invoice_number;

    // Calculate amount in words
    const amountWords = amountToWords(invoice.grand_total);

    // Resolve Customer ID if not explicitly provided but phone is present
    let customerId = invoice.customer_id || invoice.customer || null;
    if (!customerId && invoice.buyer_phone) {
        const cleanPhone = invoice.buyer_phone.replace(/\D/g, '').slice(-10);
        if (cleanPhone.length === 10) {
            try {
                const matchedCustomer = await pb.collection('customers').getFirstListItem(
                    `phone~"${cleanPhone}"`
                ).catch(() => null);
                if (matchedCustomer) {
                    customerId = matchedCustomer.id;
                }
            } catch {
                // ignore lookup error
            }
        }
    }

    const orderId = invoice.order_id || invoice.order || null;
    const saleId = invoice.sale_id || invoice.sale || null;
    const invoiceStatus = invoice.status || (invoice.is_paid ? 'paid' : (invoice.paid_amount > 0 ? 'partially_paid' : 'pending'));
    const subtotal = invoice.subtotal ?? invoice.taxable_value;
    const discount = invoice.discount ?? invoice.discount_amount;
    const tax = invoice.tax ?? invoice.total_tax;
    const total = invoice.total ?? invoice.grand_total;

    // Insert invoice payload with both GST and flat/relational fields
    const invoicePayload: Record<string, unknown> = {
        invoice_number: explicitNumber || '',
        invoice_date: invoice.invoice_date,
        account_email: (pb.authStore.model as any)?.email || '',
        invoice_type: invoice.invoice_type,
        status: invoiceStatus,
        subtotal: subtotal,
        discount: discount,
        tax: tax,
        total: total,
        paid_amount: invoice.paid_amount || 0,
        notes: invoice.notes || '',
        due_date: invoice.due_date || '',
        seller_gstin: invoice.seller_gstin || '',
        seller_name: invoice.seller_name || '',
        seller_address: invoice.seller_address || '',
        seller_state_code: invoice.seller_state_code || '',
        buyer_name: invoice.buyer_name || '',
        buyer_gstin: invoice.buyer_gstin || '',
        buyer_phone: invoice.buyer_phone || '',
        buyer_email: invoice.buyer_email || '',
        buyer_address: invoice.buyer_address || '',
        buyer_state_code: invoice.buyer_state_code || '',
        place_of_supply: invoice.place_of_supply || invoice.buyer_state_code || '',
        taxable_value: invoice.taxable_value,
        cgst_amount: invoice.cgst_amount || 0,
        sgst_amount: invoice.sgst_amount || 0,
        igst_amount: invoice.igst_amount || 0,
        cess_amount: invoice.cess_amount || 0,
        total_tax: invoice.total_tax,
        discount_amount: invoice.discount_amount || 0,
        shipping_charges: invoice.shipping_charges || 0,
        grand_total: invoice.grand_total,
        amount_in_words: amountWords,
        is_reverse_charge: !!invoice.is_reverse_charge,
        transport_mode: invoice.transport_mode || '',
        vehicle_number: invoice.vehicle_number || '',
        payment_terms: invoice.payment_terms || '',
        is_paid: !!invoice.is_paid,
        eway_bill_no: invoice.eway_bill_no || '',
        eway_bill_date: invoice.eway_bill_date || '',
        eway_bill_valid_until: invoice.eway_bill_valid_until || '',
        eway_bill_status: invoice.eway_bill_status || '',
    };

    if (customerId) invoicePayload.customer = customerId;
    if (orderId) invoicePayload.order = orderId;
    if (saleId) invoicePayload.sale = saleId;

    const invoiceData = explicitNumber
        ? await pb.collection('invoices').create({ ...invoicePayload, invoice_number: explicitNumber })
        : await createWithUniqueRetry(
            generateInvoiceNumber,
            (allocatedNumber) => pb.collection('invoices').create({ ...invoicePayload, invoice_number: allocatedNumber })
        );

    // Insert invoice items. A failure here must not leave an item-less invoice
    // header behind, so the header and any created items are removed on error.
    const itemsWithInvoiceId: InvoiceItem[] = [];
    const createdItemIds: string[] = [];
    try {
        for (let index = 0; index < invoice.items.length; index++) {
            const item = invoice.items[index];
            const itemDiscount = item.discount_amount || (item.quantity * item.unit_price * (item.discount_percent / 100));
            const itemTax = (item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0) + (item.cess_amount || 0);

            const itemPayload: Record<string, unknown> = {
                account_email: (pb.authStore.model as any)?.email || '',
                invoice: invoiceData.id,
                variant: item.variant_id || item.variant || null,
                sr_no: index + 1,
                description: item.description,
                hsn_code: item.hsn_code || '',
                quantity: item.quantity,
                unit: item.unit || 'PCS',
                unit_price: item.unit_price,
                discount: itemDiscount,
                discount_percent: item.discount_percent || 0,
                discount_amount: item.discount_amount || 0,
                taxable_amount: item.taxable_amount,
                tax: itemTax,
                gst_rate: item.gst_rate || 0,
                cgst_rate: item.cgst_rate || 0,
                cgst_amount: item.cgst_amount || 0,
                sgst_rate: item.sgst_rate || 0,
                sgst_amount: item.sgst_amount || 0,
                igst_rate: item.igst_rate || 0,
                igst_amount: item.igst_amount || 0,
                cess_rate: item.cess_rate || 0,
                cess_amount: item.cess_amount || 0,
                total: item.total_amount,
                total_amount: item.total_amount,
                gross_weight: item.gross_weight ?? null,
                net_weight: item.net_weight ?? null,
                stone_weight: item.stone_weight ?? null,
                stone_amount: item.stone_amount ?? null,
                purity_karat: item.purity_karat || '',
                making_charges: item.making_charges ?? 0,
                making_charges_type: item.making_charges_type || 'per_gram',
                wastage_percent: item.wastage_percent ?? 0,
                huid_code: item.huid_code || '',
            };

            const itemRecord = await pb.collection('invoice_items').create(itemPayload);
            createdItemIds.push(itemRecord.id);
            itemsWithInvoiceId.push({
                ...item,
                id: itemRecord.id,
                invoice_id: invoiceData.id,
                sr_no: index + 1,
            });
        }
    } catch (itemError) {
        for (const itemId of createdItemIds) {
            await pb.collection('invoice_items').delete(itemId).catch(() => {});
        }
        await pb.collection('invoices').delete(invoiceData.id).catch(() => {});
        throw itemError;
    }

    return {
        ...invoice,
        id: invoiceData.id,
        invoice_number: explicitNumber || invoiceData.invoice_number || '',
        customer_id: customerId || undefined,
        order_id: orderId || undefined,
        sale_id: saleId || undefined,
        status: invoiceStatus,
        subtotal: subtotal,
        discount: discount,
        tax: tax,
        total: total,
        items: itemsWithInvoiceId,
        created_at: invoiceData.created,
        updated_at: invoiceData.updated,
    };
}

// ===========================================
// RAW POCKETBASE RECORD SHAPES
// ===========================================

/** Raw invoices row as stored in PocketBase (GST fields plus flat/relational dual-mapping). */
interface InvoiceRecord {
    id: string;
    invoice_date: string;
    invoice_type: 'regular' | 'credit_note' | 'debit_note';
    invoice_number?: string;
    status?: 'paid' | 'pending' | 'overdue' | 'partially_paid' | 'cancelled';
    customer?: string;
    order?: string;
    sale?: string;
    is_paid?: boolean;
    is_deleted?: boolean;
    is_reverse_charge?: boolean;
    subtotal?: number;
    discount?: number;
    tax?: number;
    total?: number;
    paid_amount?: number;
    taxable_value?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    cess_amount?: number;
    total_tax?: number;
    discount_amount?: number;
    shipping_charges?: number;
    grand_total?: number;
    amount_in_words?: string;
    seller_gstin?: string;
    seller_name?: string;
    seller_address?: string;
    seller_state_code?: string;
    buyer_name?: string;
    buyer_gstin?: string;
    buyer_phone?: string;
    buyer_email?: string;
    buyer_address?: string;
    buyer_state_code?: string;
    place_of_supply?: string;
    transport_mode?: string;
    vehicle_number?: string;
    payment_terms?: string;
    due_date?: string;
    notes?: string;
    created: string;
    updated: string;
}

/** Raw invoice_items row as stored in PocketBase. */
interface InvoiceItemRecord {
    id: string;
    invoice: string;
    variant?: string;
    sr_no: number;
    description: string;
    quantity: number;
    unit_price: number;
    unit?: string;
    hsn_code?: string;
    discount?: number;
    discount_percent?: number;
    discount_amount?: number;
    taxable_amount?: number;
    gst_rate?: number;
    cgst_rate?: number;
    cgst_amount?: number;
    sgst_rate?: number;
    sgst_amount?: number;
    igst_rate?: number;
    igst_amount?: number;
    cess_rate?: number;
    cess_amount?: number;
    total?: number;
    total_amount?: number;
    gross_weight?: number;
    net_weight?: number;
    stone_weight?: number;
    stone_amount?: number;
    purity_karat?: string;
    making_charges?: number;
    making_charges_type?: 'per_gram' | 'fixed' | 'percent';
    wastage_percent?: number;
    huid_code?: string;
}

/** Raw invoice_payments row as stored in PocketBase. */
interface InvoicePaymentRecord {
    id: string;
    amount: number;
    payment_date?: string;
    payment_method?: string;
    reference_number?: string;
    notes?: string;
    created: string;
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    try {
        let invoice;
        try {
            invoice = await pb.collection('invoices').getOne(id);
        } catch {
            const cleanQuery = sanitizeFilter(id.trim());
            invoice = await pb.collection('invoices').getFirstListItem(`invoice_number="${cleanQuery}" || id="${cleanQuery}"`);
        }
        if (!invoice) return null;

        const recordId = invoice.id;
        const items = await pb.collection('invoice_items').getFullList<InvoiceItemRecord>({
            filter: `invoice="${recordId}"`,
            sort: 'sr_no',
        });

        // Fetch recorded payment installments
        let paymentsList: InvoicePaymentRecord[] = [];
        try {
            paymentsList = await pb.collection('invoice_payments').getFullList<InvoicePaymentRecord>({
                filter: `invoice="${recordId}"`,
                sort: '-payment_date',
            });
        } catch {
            // Collection might be empty or error
        }

        const grandTotal = invoice.grand_total ?? invoice.total ?? 0;
        const paidAmount = invoice.paid_amount || 0;
        const balanceDue = Math.max(0, grandTotal - paidAmount);

        return {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            invoice_date: invoice.invoice_date,
            invoice_type: invoice.invoice_type,
            customer_id: invoice.customer || undefined,
            order_id: invoice.order || undefined,
            sale_id: invoice.sale || undefined,
            order: invoice.order || undefined,
            customer: invoice.customer || undefined,
            sale: invoice.sale || undefined,
            status: invoice.status || (invoice.is_paid ? 'paid' : 'pending'),
            subtotal: invoice.subtotal ?? invoice.taxable_value ?? 0,
            discount: invoice.discount ?? invoice.discount_amount ?? 0,
            tax: invoice.tax ?? invoice.total_tax ?? 0,
            total: invoice.total ?? invoice.grand_total ?? 0,
            seller_gstin: invoice.seller_gstin || '',
            seller_name: invoice.seller_name || '',
            seller_address: invoice.seller_address || '',
            seller_state_code: invoice.seller_state_code || '',
            buyer_name: invoice.buyer_name || '',
            buyer_gstin: invoice.buyer_gstin || '',
            buyer_phone: invoice.buyer_phone || '',
            buyer_email: invoice.buyer_email || '',
            buyer_address: invoice.buyer_address || '',
            buyer_state_code: invoice.buyer_state_code || '',
            place_of_supply: invoice.place_of_supply || '',
            taxable_value: invoice.taxable_value ?? invoice.subtotal ?? 0,
            cgst_amount: invoice.cgst_amount || 0,
            sgst_amount: invoice.sgst_amount || 0,
            igst_amount: invoice.igst_amount || 0,
            cess_amount: invoice.cess_amount || 0,
            total_tax: invoice.total_tax ?? invoice.tax ?? 0,
            discount_amount: invoice.discount_amount ?? invoice.discount ?? 0,
            shipping_charges: invoice.shipping_charges || 0,
            grand_total: grandTotal,
            amount_in_words: invoice.amount_in_words || '',
            is_reverse_charge: invoice.is_reverse_charge || false,
            transport_mode: invoice.transport_mode || '',
            vehicle_number: invoice.vehicle_number || '',
            payment_terms: invoice.payment_terms || '',
            due_date: invoice.due_date || '',
            is_paid: invoice.is_paid ?? (invoice.status === 'paid'),
            paid_amount: paidAmount,
            balance_due: balanceDue,
            is_deleted: !!invoice.is_deleted,
            notes: invoice.notes || '',
            eway_bill_no: invoice.eway_bill_no || undefined,
            eway_bill_date: invoice.eway_bill_date || undefined,
            eway_bill_valid_until: invoice.eway_bill_valid_until || undefined,
            eway_bill_status: invoice.eway_bill_status || undefined,
            payments: paymentsList.map((p) => ({
                id: p.id,
                amount: p.amount,
                date: p.payment_date || p.created,
                payment_date: p.payment_date || p.created,
                method: p.payment_method || 'cash',
                reference: p.reference_number || '',
                recorded_by: p.notes?.replace(/^Recorded by /, '') || '',
            })),
            items: items.map((item) => ({
                id: item.id,
                invoice_id: item.invoice,
                variant_id: item.variant,
                sr_no: item.sr_no,
                description: item.description,
                hsn_code: item.hsn_code || '',
                quantity: item.quantity,
                unit: item.unit || 'PCS',
                unit_price: item.unit_price,
                discount_percent: item.discount_percent || 0,
                discount_amount: item.discount_amount ?? item.discount ?? 0,
                taxable_amount: item.taxable_amount ?? ((item.quantity * item.unit_price) - (item.discount || 0)),
                gst_rate: item.gst_rate || 0,
                cgst_rate: item.cgst_rate || 0,
                cgst_amount: item.cgst_amount || 0,
                sgst_rate: item.sgst_rate || 0,
                sgst_amount: item.sgst_amount || 0,
                igst_rate: item.igst_rate || 0,
                igst_amount: item.igst_amount || 0,
                cess_rate: item.cess_rate || 0,
                cess_amount: item.cess_amount || 0,
                total_amount: item.total_amount ?? item.total ?? 0,
                gross_weight: item.gross_weight,
                net_weight: item.net_weight,
                stone_weight: item.stone_weight,
                stone_amount: item.stone_amount,
                purity_karat: item.purity_karat,
                making_charges: item.making_charges,
                making_charges_type: item.making_charges_type,
                wastage_percent: item.wastage_percent,
                huid_code: item.huid_code,
            })),
            created_at: invoice.created,
            updated_at: invoice.updated,
        };
    } catch (error) {
        console.error('Error fetching invoice:', error);
        return null;
    }
}

export async function getInvoices(filters?: {
    startDate?: string;
    endDate?: string;
    buyerName?: string;
    invoiceType?: string;
    isPaid?: boolean;
    isDeleted?: boolean;
}): Promise<Invoice[]> {
    try {
        const filterParts: string[] = [];

        const { start, end } = normalizeDateBounds(filters?.startDate, filters?.endDate);
        if (start) {
            filterParts.push(`invoice_date >= "${start}"`);
        }
        if (end) {
            filterParts.push(`invoice_date <= "${end}"`);
        }
        if (filters?.buyerName) {
            filterParts.push(`buyer_name ~ "${sanitizeFilter(filters.buyerName)}"`);
        }
        if (filters?.invoiceType) {
            filterParts.push(`invoice_type = "${filters.invoiceType}"`);
        }
        if (filters?.isPaid !== undefined) {
            filterParts.push(`is_paid = ${filters.isPaid}`);
        }
        if (filters?.isDeleted === true) {
            filterParts.push(`is_deleted = true`);
        } else {
            filterParts.push(`is_deleted != true`);
        }

        const invoices = await pb.collection('invoices').getFullList<InvoiceRecord>({
            filter: filterParts.join(' && ') || '',
            sort: '-invoice_date',
        });

        // Fetch items for all invoices (batch)
        const invoiceIds = invoices.map(inv => inv.id);
        let allItems: InvoiceItemRecord[] = [];
        if (invoiceIds.length > 0) {
            const itemFilter = invoiceIds.map(id => `invoice="${id}"`).join(' || ');
            allItems = await pb.collection('invoice_items').getFullList<InvoiceItemRecord>({
                filter: itemFilter,
            });
        }

        // Group items by invoice
        const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
        allItems.forEach(item => {
            if (!itemsByInvoice.has(item.invoice)) {
                itemsByInvoice.set(item.invoice, []);
            }
            itemsByInvoice.get(item.invoice)!.push(item);
        });

        return invoices.map((inv) => {
            const grandTotal = inv.grand_total ?? inv.total ?? 0;
            const paidAmount = inv.paid_amount || 0;
            return {
                id: inv.id,
                invoice_number: inv.invoice_number,
                invoice_date: inv.invoice_date,
                invoice_type: inv.invoice_type,
                customer_id: inv.customer || undefined,
                order_id: inv.order || undefined,
                sale_id: inv.sale || undefined,
                order: inv.order || undefined,
                customer: inv.customer || undefined,
                sale: inv.sale || undefined,
                status: inv.status || (inv.is_paid ? 'paid' : 'pending'),
                subtotal: inv.subtotal ?? inv.taxable_value ?? 0,
                discount: inv.discount ?? inv.discount_amount ?? 0,
                tax: inv.tax ?? inv.total_tax ?? 0,
                total: inv.total ?? inv.grand_total ?? 0,
                seller_gstin: inv.seller_gstin || '',
                seller_name: inv.seller_name || '',
                seller_address: inv.seller_address || '',
                seller_state_code: inv.seller_state_code || '',
                buyer_name: inv.buyer_name || '',
                buyer_gstin: inv.buyer_gstin || '',
                buyer_phone: inv.buyer_phone || '',
                buyer_email: inv.buyer_email || '',
                buyer_address: inv.buyer_address || '',
                buyer_state_code: inv.buyer_state_code || '',
                place_of_supply: inv.place_of_supply || '',
                taxable_value: inv.taxable_value ?? inv.subtotal ?? 0,
                cgst_amount: inv.cgst_amount || 0,
                sgst_amount: inv.sgst_amount || 0,
                igst_amount: inv.igst_amount || 0,
                cess_amount: inv.cess_amount || 0,
                total_tax: inv.total_tax ?? inv.tax ?? 0,
                discount_amount: inv.discount_amount ?? inv.discount ?? 0,
                shipping_charges: inv.shipping_charges || 0,
                grand_total: grandTotal,
                amount_in_words: inv.amount_in_words || '',
                is_reverse_charge: inv.is_reverse_charge || false,
                transport_mode: inv.transport_mode || '',
                vehicle_number: inv.vehicle_number || '',
                payment_terms: inv.payment_terms || '',
                due_date: inv.due_date || '',
                is_paid: inv.is_paid ?? (inv.status === 'paid'),
                paid_amount: paidAmount,
                balance_due: Math.max(0, grandTotal - paidAmount),
                is_deleted: !!inv.is_deleted,
                notes: inv.notes || '',
                items: (itemsByInvoice.get(inv.id) || []).map((item) => ({
                    id: item.id,
                    invoice_id: item.invoice,
                    variant_id: item.variant,
                    sr_no: item.sr_no,
                    description: item.description,
                    hsn_code: item.hsn_code || '',
                    quantity: item.quantity,
                    unit: item.unit || 'PCS',
                    unit_price: item.unit_price,
                    discount_percent: item.discount_percent || 0,
                    discount_amount: item.discount_amount ?? item.discount ?? 0,
                    taxable_amount: item.taxable_amount ?? ((item.quantity * item.unit_price) - (item.discount || 0)),
                    gst_rate: item.gst_rate || 0,
                    cgst_rate: item.cgst_rate || 0,
                    cgst_amount: item.cgst_amount || 0,
                    sgst_rate: item.sgst_rate || 0,
                    sgst_amount: item.sgst_amount || 0,
                    igst_rate: item.igst_rate || 0,
                    igst_amount: item.igst_amount || 0,
                    cess_rate: item.cess_rate || 0,
                    cess_amount: item.cess_amount || 0,
                    total_amount: item.total_amount ?? item.total ?? 0,
                    gross_weight: item.gross_weight,
                    net_weight: item.net_weight,
                    stone_weight: item.stone_weight,
                    stone_amount: item.stone_amount,
                    purity_karat: item.purity_karat,
                    making_charges: item.making_charges,
                    making_charges_type: item.making_charges_type,
                    wastage_percent: item.wastage_percent,
                    huid_code: item.huid_code,
                })),
                created_at: inv.created,
                updated_at: inv.updated,
            };
        });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        return [];
    }
}

export async function cloneInvoice(id: string): Promise<Invoice> {
    const original = await getInvoice(id);
    if (!original) throw new Error('Invoice not found');

    const nextNumber = await generateInvoiceNumber();
    const clonedData: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'> = {
        ...original,
        invoice_date: new Date().toISOString(),
        status: 'pending',
        is_paid: false,
        paid_amount: 0,
        notes: original.notes ? `${original.notes} (Cloned from #${original.invoice_number})` : `Cloned from #${original.invoice_number}`,
        items: original.items.map((item, idx) => ({
            ...item,
            id: undefined,
            invoice_id: undefined,
            sr_no: idx + 1,
        })),
    };
    return createInvoice({ ...clonedData, invoice_number: nextNumber });
}

export async function trashInvoice(id: string): Promise<void> {
    await pb.collection('invoices').update(id, { is_deleted: true });
}

export async function restoreInvoice(id: string): Promise<void> {
    await pb.collection('invoices').update(id, { is_deleted: false });
}

export async function deleteInvoicePermanently(id: string): Promise<void> {
    const items = await pb.collection('invoice_items').getFullList({ filter: `invoice="${id}"` });
    for (const item of items) {
        await pb.collection('invoice_items').delete(item.id).catch(() => {});
    }
    const payments = await pb.collection('invoice_payments').getFullList({ filter: `invoice="${id}"` });
    for (const p of payments) {
        await pb.collection('invoice_payments').delete(p.id).catch(() => {});
    }
    await pb.collection('invoices').delete(id);
}

export async function markInvoicePaid(id: string, paidAmount?: number): Promise<void> {
    const invoice = await getInvoice(id);
    if (!invoice) throw new Error('Invoice not found');

    const total = invoice.grand_total || invoice.total || 0;
    // Nullish, not truthy: a zero-value invoice or a 100% discount is still a
    // real total. Clamp so a caller cannot record more paid than billed.
    const settled = Math.min(Math.max(0, paidAmount ?? total), total);
    await pb.collection('invoices').update(id, {
        status: 'paid',
        is_paid: true,
        paid_amount: settled,
    });
}

// ===========================================
// INVOICE FROM SALE
// ===========================================

/** Raw sale_items row as stored in PocketBase, with the variant→product expand chain. */
interface SaleItemRecord {
    id: string;
    variant?: string;
    quantity: number;
    unit_price: number;
    /** Rate captured at sale time. Missing on historical rows. */
    gst_rate?: number;
    gross_weight?: number;
    net_weight?: number;
    stone_weight?: number;
    stone_amount?: number;
    purity_karat?: string;
    making_charges?: number;
    making_charges_type?: 'per_gram' | 'fixed' | 'percent';
    wastage_percent?: number;
    huid_code?: string;
    expand?: {
        variant?: ProductVariant;
    };
}

export async function createInvoiceFromSale(saleId: string): Promise<Invoice> {
    const sale = await pb.collection('sales').getOne(saleId);
    const saleItems = await pb.collection('sale_items').getFullList<SaleItemRecord>({
        filter: `sale="${saleId}"`,
        expand: 'variant,variant.product',
    });

    const storeSettings = await getStoreSettings();
    const isGstRegistered = storeSettings.is_gst_registered !== false;
    const sellerStateCode = storeSettings.store_state_code || '27';
    const buyerStateCode = sellerStateCode;

    // POS prices are the amounts the customer was quoted, so they already carry
    // GST. Gross lines are built in paise and the bill discount is allocated
    // across them, then tax is back-computed from the discounted amount.
    const lines = saleItems.map((item) => {
        const variant = item.expand?.variant;
        const product = variant?.expand?.product;
        return {
            item,
            variant,
            product,
            grossPaise: toPaise((item.quantity || 0) * (item.unit_price || 0)),
            gstRate: resolveLineGstRate(
                item.gst_rate,
                product?.gst_rate,
                isGstRegistered,
                GST_RATES.JEWELRY
            ),
        };
    });

    const grossTotalPaise = lines.reduce((sum, line) => sum + line.grossPaise, 0);
    // Absorb paise-level rounding into the discount so the invoice total is
    // exactly the amount collected at the counter.
    const collectedPaise = sale.total === null || sale.total === undefined
        ? grossTotalPaise - toPaise(sale.discount || 0)
        : toPaise(sale.total);
    const effectiveDiscountPaise = Math.max(0, grossTotalPaise - collectedPaise);

    const taxed = computeInclusiveLines(
        lines.map((line) => ({ grossPaise: line.grossPaise, gstRate: line.gstRate })),
        effectiveDiscountPaise,
        sellerStateCode,
        buyerStateCode
    );

    const invoiceItems: InvoiceItem[] = lines.map((line, index) => {
        const { item, variant, product } = line;
        const result = taxed.lines[index];

        return {
            variant_id: item.variant,
            sr_no: index + 1,
            description: (product?.name || 'Product') + (variant?.variant_name ? ` - ${variant.variant_name}` : ''),
            hsn_code: getHSNForProduct(product?.category, variant?.material),
            quantity: item.quantity,
            unit: 'PCS',
            unit_price: item.unit_price,
            discount_percent: result.grossPaise > 0
                ? Math.round((result.discountPaise / result.grossPaise) * 10000) / 100
                : 0,
            discount_amount: toRupees(result.discountPaise),
            taxable_amount: toRupees(result.taxablePaise),
            gst_rate: line.gstRate,
            cgst_rate: result.cgstRate,
            cgst_amount: toRupees(result.cgstPaise),
            sgst_rate: result.sgstRate,
            sgst_amount: toRupees(result.sgstPaise),
            igst_rate: result.igstRate,
            igst_amount: toRupees(result.igstPaise),
            cess_rate: result.cessRate,
            cess_amount: toRupees(result.cessPaise),
            total_amount: toRupees(result.totalPaise),
            gross_weight: item.gross_weight ?? variant?.gross_weight ?? product?.gross_weight,
            net_weight: item.net_weight ?? variant?.net_weight ?? product?.net_weight,
            stone_weight: item.stone_weight ?? variant?.stone_weight ?? product?.stone_weight,
            stone_amount: item.stone_amount ?? variant?.stone_amount ?? product?.stone_amount,
            purity_karat: item.purity_karat || variant?.purity_karat || product?.purity_karat,
            making_charges: item.making_charges ?? variant?.making_charges ?? product?.making_charges,
            making_charges_type: item.making_charges_type || variant?.making_charges_type || product?.making_charges_type,
            wastage_percent: item.wastage_percent ?? variant?.wastage_percent ?? product?.wastage_percent,
            huid_code: item.huid_code || variant?.huid_code || product?.huid_code,
        };
    });

    const taxableValue = toRupees(taxed.taxablePaise);
    const totalTax = toRupees(taxed.taxPaise);
    const grandTotal = toRupees(taxed.totalPaise);
    const cgstAmount = toRupees(taxed.lines.reduce((sum, line) => sum + line.cgstPaise, 0));
    const sgstAmount = toRupees(taxed.lines.reduce((sum, line) => sum + line.sgstPaise, 0));
    const igstAmount = toRupees(taxed.lines.reduce((sum, line) => sum + line.igstPaise, 0));
    const cessAmount = toRupees(taxed.lines.reduce((sum, line) => sum + line.cessPaise, 0));

    const sellerStatePin = [storeSettings.store_state, storeSettings.store_pincode].filter(Boolean).join(' - ');
    const formattedSellerAddress = [storeSettings.store_address, storeSettings.store_city, sellerStatePin].filter(Boolean).join(', ');

    const invoice: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'> = {
        invoice_date: new Date().toISOString(),
        invoice_type: 'regular',

        seller_gstin: isGstRegistered ? storeSettings.store_gstin : '',
        seller_name: storeSettings.store_name,
        seller_address: formattedSellerAddress,
        seller_state_code: sellerStateCode,

        buyer_name: sale.customer_name || 'Walk-in Customer',
        buyer_gstin: '',
        buyer_phone: sale.customer_phone || '',
        buyer_email: '',
        buyer_address: sale.customer_address || '',
        buyer_state_code: buyerStateCode,
        place_of_supply: buyerStateCode,

        customer_id: sale.customer || undefined,
        sale_id: saleId,

        status: 'paid',
        subtotal: taxableValue,
        discount: toRupees(effectiveDiscountPaise),
        tax: totalTax,
        total: grandTotal,

        taxable_value: taxableValue,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        cess_amount: cessAmount,
        total_tax: totalTax,
        discount_amount: toRupees(effectiveDiscountPaise),
        shipping_charges: 0,
        grand_total: grandTotal,
        amount_in_words: amountToWords(grandTotal),

        is_reverse_charge: false,
        payment_terms: storeSettings.invoice_terms,
        is_paid: true,
        paid_amount: grandTotal,
        notes: sale.notes,

        items: invoiceItems,
    };

    return createInvoice(invoice);
}
// ===========================================
// INVOICE CALCULATIONS HELPER
// ===========================================

export function calculateInvoiceTotals(
    items: Omit<InvoiceItem, 'id' | 'invoice_id'>[],
    sellerStateCode: string,
    buyerStateCode: string,
    isGstRegistered: boolean = true
): {
    items: InvoiceItem[];
    taxableValue: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalTax: number;
    grandTotal: number;
} {
    const calculatedItems = items.map((item, index) => {
        const lineSubtotal = item.quantity * item.unit_price;
        const discountAmount = lineSubtotal * (item.discount_percent / 100);
        const taxableAmount = lineSubtotal - discountAmount;
        const effectiveRate = isGstRegistered ? (item.gst_rate ?? GST_RATES.JEWELRY) : 0;

        const gst = calculateGST(taxableAmount, sellerStateCode, buyerStateCode, effectiveRate);

        return {
            ...item,
            sr_no: index + 1,
            discount_amount: discountAmount,
            taxable_amount: gst.taxableAmount,
            cgst_rate: gst.cgstRate,
            cgst_amount: gst.cgstAmount,
            sgst_rate: gst.sgstRate,
            sgst_amount: gst.sgstAmount,
            igst_rate: gst.igstRate,
            igst_amount: gst.igstAmount,
            total_amount: gst.grandTotal,
        };
    });

    const taxableValue = calculatedItems.reduce((sum, i) => sum + i.taxable_amount, 0);
    const cgstAmount = calculatedItems.reduce((sum, i) => sum + i.cgst_amount, 0);
    const sgstAmount = calculatedItems.reduce((sum, i) => sum + i.sgst_amount, 0);
    const igstAmount = calculatedItems.reduce((sum, i) => sum + i.igst_amount, 0);
    const totalTax = cgstAmount + sgstAmount + igstAmount;
    const grandTotal = taxableValue + totalTax;

    return {
        items: calculatedItems,
        taxableValue,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalTax,
        grandTotal,
    };
}
