/**
 * Invoice Service Layer
 * Handles invoice CRUD operations, generation from sales, and printing
 */

import { supabase } from './supabase';
import {
    calculateGST,
    amountToWords,
    formatINR,
    getHSNForProduct,
    GST_RATES,
    type GSTCalculation
} from './gst';

// ===========================================
// TYPES
// ===========================================
export interface InvoiceItem {
    id?: string;
    invoice_id?: string;
    variant_id?: string;
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

    // Linked sale
    sale_id?: string;

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

    // Items
    items: InvoiceItem[];

    // Metadata
    created_at?: string;
    updated_at?: string;
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
    default_print_mode: 'regular' | 'thermal58' | 'thermal80';
}

// ===========================================
// STORE SETTINGS
// ===========================================
export async function getStoreSettings(): Promise<StoreSettings> {
    const { data, error } = await supabase
        .from('store_settings')
        .select('key, value');

    if (error) {
        console.error('Error fetching store settings:', error);
        throw error;
    }

    const settings: Record<string, string> = {};
    data?.forEach(row => {
        settings[row.key] = row.value || '';
    });

    return settings as unknown as StoreSettings;
}

export async function updateStoreSettings(updates: Partial<StoreSettings>): Promise<void> {
    const entries = Object.entries(updates);

    for (const [key, value] of entries) {
        const { error } = await supabase
            .from('store_settings')
            .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

        if (error) {
            console.error(`Error updating setting ${key}:`, error);
            throw error;
        }
    }
}

// ===========================================
// INVOICE CRUD
// ===========================================

export async function createInvoice(invoice: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'>): Promise<Invoice> {
    // Generate invoice number
    const { data: numberData, error: numberError } = await supabase
        .rpc('generate_invoice_number');

    if (numberError) {
        console.error('Error generating invoice number:', numberError);
        throw numberError;
    }

    const invoiceNumber = numberData;

    // Calculate amount in words
    const amountWords = amountToWords(invoice.grand_total);

    // Insert invoice
    const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
            invoice_number: invoiceNumber,
            invoice_date: invoice.invoice_date,
            invoice_type: invoice.invoice_type,
            seller_gstin: invoice.seller_gstin,
            seller_name: invoice.seller_name,
            seller_address: invoice.seller_address,
            seller_state_code: invoice.seller_state_code,
            buyer_name: invoice.buyer_name,
            buyer_gstin: invoice.buyer_gstin,
            buyer_phone: invoice.buyer_phone,
            buyer_email: invoice.buyer_email,
            buyer_address: invoice.buyer_address,
            buyer_state_code: invoice.buyer_state_code,
            place_of_supply: invoice.place_of_supply || invoice.buyer_state_code,
            sale_id: invoice.sale_id,
            taxable_value: invoice.taxable_value,
            cgst_amount: invoice.cgst_amount,
            sgst_amount: invoice.sgst_amount,
            igst_amount: invoice.igst_amount,
            cess_amount: invoice.cess_amount,
            total_tax: invoice.total_tax,
            discount_amount: invoice.discount_amount,
            shipping_charges: invoice.shipping_charges,
            grand_total: invoice.grand_total,
            amount_in_words: amountWords,
            is_reverse_charge: invoice.is_reverse_charge,
            transport_mode: invoice.transport_mode,
            vehicle_number: invoice.vehicle_number,
            payment_terms: invoice.payment_terms,
            due_date: invoice.due_date,
            is_paid: invoice.is_paid,
            paid_amount: invoice.paid_amount,
            notes: invoice.notes,
        })
        .select()
        .single();

    if (invoiceError) {
        console.error('Error creating invoice:', invoiceError);
        throw invoiceError;
    }

    // Insert invoice items
    const itemsWithInvoiceId = invoice.items.map((item, index) => ({
        invoice_id: invoiceData.id,
        variant_id: item.variant_id,
        sr_no: index + 1,
        description: item.description,
        hsn_code: item.hsn_code,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        discount_amount: item.discount_amount,
        taxable_amount: item.taxable_amount,
        gst_rate: item.gst_rate,
        cgst_rate: item.cgst_rate,
        cgst_amount: item.cgst_amount,
        sgst_rate: item.sgst_rate,
        sgst_amount: item.sgst_amount,
        igst_rate: item.igst_rate,
        igst_amount: item.igst_amount,
        cess_rate: item.cess_rate,
        cess_amount: item.cess_amount,
        total_amount: item.total_amount,
    }));

    const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(itemsWithInvoiceId);

    if (itemsError) {
        console.error('Error creating invoice items:', itemsError);
        // Rollback invoice
        await supabase.from('invoices').delete().eq('id', invoiceData.id);
        throw itemsError;
    }

    return {
        ...invoiceData,
        items: itemsWithInvoiceId,
    };
}

export async function getInvoice(id: string): Promise<Invoice | null> {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            items:invoice_items(*)
        `)
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching invoice:', error);
        return null;
    }

    return invoice;
}

export async function getInvoices(filters?: {
    startDate?: string;
    endDate?: string;
    buyerName?: string;
    invoiceType?: string;
    isPaid?: boolean;
}): Promise<Invoice[]> {
    let query = supabase
        .from('invoices')
        .select(`
            *,
            items:invoice_items(*)
        `)
        .order('invoice_date', { ascending: false });

    if (filters?.startDate) {
        query = query.gte('invoice_date', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('invoice_date', filters.endDate);
    }
    if (filters?.buyerName) {
        query = query.ilike('buyer_name', `%${filters.buyerName}%`);
    }
    if (filters?.invoiceType) {
        query = query.eq('invoice_type', filters.invoiceType);
    }
    if (filters?.isPaid !== undefined) {
        query = query.eq('is_paid', filters.isPaid);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching invoices:', error);
        return [];
    }

    return data || [];
}

export async function markInvoicePaid(id: string, paidAmount?: number): Promise<void> {
    const invoice = await getInvoice(id);
    if (!invoice) throw new Error('Invoice not found');

    const { error } = await supabase
        .from('invoices')
        .update({
            is_paid: true,
            paid_amount: paidAmount ?? invoice.grand_total,
        })
        .eq('id', id);

    if (error) throw error;
}

// ===========================================
// INVOICE FROM SALE
// ===========================================

export async function createInvoiceFromSale(saleId: string): Promise<Invoice> {
    // Fetch sale with items
    const { data: sale, error: saleError } = await supabase
        .from('sales')
        .select(`
            *,
            items:sale_items(
                *,
                variant:product_variants(
                    *,
                    product:products(*)
                )
            )
        `)
        .eq('id', saleId)
        .single();

    if (saleError || !sale) {
        throw new Error('Sale not found');
    }

    // Get store settings
    const storeSettings = await getStoreSettings();

    // Build invoice items with GST
    const invoiceItems: InvoiceItem[] = sale.items.map((item: any, index: number) => {
        const variant = item.variant;
        const product = variant?.product;

        const quantity = item.quantity;
        const unitPrice = item.unit_price;
        const lineTotal = quantity * unitPrice;

        // Calculate GST for this item
        const gst = calculateGST(
            lineTotal,
            storeSettings.store_state_code,
            '', // Buyer state - using intra-state for walk-in (no GSTIN)
            GST_RATES.JEWELRY
        );

        return {
            variant_id: item.variant_id,
            sr_no: index + 1,
            description: product?.name + (variant?.variant_name ? ` - ${variant.variant_name}` : ''),
            hsn_code: getHSNForProduct(product?.category, variant?.material),
            quantity,
            unit: 'PCS',
            unit_price: unitPrice,
            discount_percent: 0,
            discount_amount: 0,
            taxable_amount: gst.taxableAmount,
            gst_rate: GST_RATES.JEWELRY,
            cgst_rate: gst.cgstRate,
            cgst_amount: gst.cgstAmount,
            sgst_rate: gst.sgstRate,
            sgst_amount: gst.sgstAmount,
            igst_rate: gst.igstRate,
            igst_amount: gst.igstAmount,
            cess_rate: 0,
            cess_amount: 0,
            total_amount: gst.grandTotal,
        };
    });

    // Calculate totals
    const taxableValue = invoiceItems.reduce((sum, item) => sum + item.taxable_amount, 0);
    const cgstAmount = invoiceItems.reduce((sum, item) => sum + item.cgst_amount, 0);
    const sgstAmount = invoiceItems.reduce((sum, item) => sum + item.sgst_amount, 0);
    const igstAmount = invoiceItems.reduce((sum, item) => sum + item.igst_amount, 0);
    const cessAmount = invoiceItems.reduce((sum, item) => sum + item.cess_amount, 0);
    const totalTax = cgstAmount + sgstAmount + igstAmount + cessAmount;
    const grandTotal = taxableValue + totalTax;

    // Create invoice
    const invoice: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'> = {
        invoice_date: new Date().toISOString(),
        invoice_type: 'regular',

        seller_gstin: storeSettings.store_gstin,
        seller_name: storeSettings.store_name,
        seller_address: `${storeSettings.store_address}, ${storeSettings.store_city}, ${storeSettings.store_state} - ${storeSettings.store_pincode}`,
        seller_state_code: storeSettings.store_state_code,

        buyer_name: sale.customer_name || 'Walk-in Customer',
        buyer_gstin: '',
        buyer_phone: sale.customer_phone || '',
        buyer_email: '',
        buyer_address: sale.customer_address || '',
        buyer_state_code: storeSettings.store_state_code, // Same state for walk-in
        place_of_supply: storeSettings.store_state_code,

        sale_id: saleId,

        taxable_value: taxableValue,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        cess_amount: cessAmount,
        total_tax: totalTax,
        discount_amount: sale.discount || 0,
        shipping_charges: 0,
        grand_total: grandTotal - (sale.discount || 0),
        amount_in_words: amountToWords(grandTotal - (sale.discount || 0)),

        is_reverse_charge: false,
        payment_terms: storeSettings.invoice_terms,
        is_paid: true, // POS sales are usually paid immediately
        paid_amount: sale.total,
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
    buyerStateCode: string
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

        const gst = calculateGST(taxableAmount, sellerStateCode, buyerStateCode, item.gst_rate);

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
