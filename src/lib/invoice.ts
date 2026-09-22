/**
 * Invoice Service Layer
 * Handles invoice CRUD operations, generation from sales, and printing using PocketBase
 */

import { pb } from './pocketbase';
import {
    calculateGST,
    amountToWords,
    getHSNForProduct,
    GST_RATES,
} from './gst';
import { getNextSequenceNumber, createWithUniqueRetry } from './sequence-generator';

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

    // Update invoice paid amount and status
    const invoice = await pb.collection('invoices').getOne(paymentDetails.invoice_id);
    const invoiceTotal = Number(invoice.total || invoice.grand_total || 0);
    const newPaidAmount = (invoice.paid_amount || 0) + paymentDetails.amount;
    const isPaid = invoiceTotal > 0 && newPaidAmount >= invoiceTotal;

    const updatePayload: Record<string, any> = {
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
    default_print_mode: 'regular' | 'thermal58' | 'thermal80';
}

// ===========================================
// STORE SETTINGS
// ===========================================
export async function getStoreSettings(): Promise<StoreSettings> {
    try {
        const records = await pb.collection('store_settings').getFullList<{ key: string; value: string }>();

        const settings: Record<string, string> = {};
        records.forEach((row) => {
            settings[row.key] = row.value || '';
        });

        return settings as unknown as StoreSettings;
    } catch (error) {
        console.error('Error fetching store settings:', error);
        // Return defaults
        return {
            store_name: 'Luminila Jewelry',
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
            invoice_terms: 'Payment due within 30 days',
            invoice_footer: 'Thank you for your business!',
            store_logo: '',
            default_print_mode: 'regular',
        };
    }
}

export async function updateStoreSettings(updates: Partial<StoreSettings>): Promise<void> {
    const entries = Object.entries(updates);

    for (const [key, value] of entries) {
        try {
            // Try to find existing setting
            const existing = await pb.collection('store_settings').getFirstListItem(`key="${key}"`).catch(() => null);

            if (existing) {
                await pb.collection('store_settings').update(existing.id, { value });
            } else {
                await pb.collection('store_settings').create({ key, value });
            }
        } catch (error) {
            console.error(`Error updating setting ${key}:`, error);
            throw error;
        }
    }
}

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

export async function createInvoice(invoice: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'>): Promise<Invoice> {
    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Calculate amount in words
    const amountWords = amountToWords(invoice.grand_total);

    // Resolve Customer ID if not explicitly provided but phone is present
    let customerId = invoice.customer_id || (invoice as any).customer || null;
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

    const orderId = invoice.order_id || (invoice as any).order || null;
    const saleId = invoice.sale_id || (invoice as any).sale || null;
    const invoiceStatus = invoice.status || (invoice.is_paid ? 'paid' : (invoice.paid_amount > 0 ? 'partially_paid' : 'pending'));
    const subtotal = invoice.subtotal ?? invoice.taxable_value;
    const discount = invoice.discount ?? invoice.discount_amount;
    const tax = invoice.tax ?? invoice.total_tax;
    const total = invoice.total ?? invoice.grand_total;

    // Insert invoice payload with both GST and flat/relational fields
    const invoicePayload: Record<string, any> = {
        invoice_number: invoiceNumber,
        invoice_date: invoice.invoice_date,
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
    };

    if (customerId) invoicePayload.customer = customerId;
    if (orderId) invoicePayload.order = orderId;
    if (saleId) invoicePayload.sale = saleId;

    const explicitNumber = (invoice as any).invoice_number;
    const invoiceData = explicitNumber
        ? await pb.collection('invoices').create({ ...invoicePayload, invoice_number: explicitNumber })
        : await createWithUniqueRetry(
            generateInvoiceNumber,
            (allocatedNumber) => pb.collection('invoices').create({ ...invoicePayload, invoice_number: allocatedNumber })
        );

    // Insert invoice items
    const itemsWithInvoiceId: InvoiceItem[] = [];
    for (let index = 0; index < invoice.items.length; index++) {
        const item = invoice.items[index];
        const itemDiscount = item.discount_amount || (item.quantity * item.unit_price * (item.discount_percent / 100));
        const itemTax = (item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0) + (item.cess_amount || 0);

        const itemPayload: Record<string, any> = {
            invoice: invoiceData.id,
            variant: item.variant_id || (item as any).variant || null,
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
        };

        const itemRecord = await pb.collection('invoice_items').create(itemPayload);
        itemsWithInvoiceId.push({
            ...item,
            id: itemRecord.id,
            invoice_id: invoiceData.id,
            sr_no: index + 1,
        });
    }

    return {
        ...invoice,
        id: invoiceData.id,
        invoice_number: invoiceNumber,
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

export async function getInvoice(id: string): Promise<Invoice | null> {
    try {
        const invoice = await pb.collection('invoices').getOne(id);
        const items = await pb.collection('invoice_items').getFullList({
            filter: `invoice="${id}"`,
            sort: 'sr_no',
        });

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
            grand_total: invoice.grand_total ?? invoice.total ?? 0,
            amount_in_words: invoice.amount_in_words || '',
            is_reverse_charge: invoice.is_reverse_charge || false,
            transport_mode: invoice.transport_mode || '',
            vehicle_number: invoice.vehicle_number || '',
            payment_terms: invoice.payment_terms || '',
            due_date: invoice.due_date || '',
            is_paid: invoice.is_paid ?? (invoice.status === 'paid'),
            paid_amount: invoice.paid_amount || 0,
            notes: invoice.notes || '',
            items: items.map((item: any) => ({
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
}): Promise<Invoice[]> {
    try {
        const filterParts: string[] = [];

        if (filters?.startDate) {
            filterParts.push(`invoice_date >= "${filters.startDate}"`);
        }
        if (filters?.endDate) {
            filterParts.push(`invoice_date <= "${filters.endDate}"`);
        }
        if (filters?.buyerName) {
            filterParts.push(`buyer_name ~ "${filters.buyerName}"`);
        }
        if (filters?.invoiceType) {
            filterParts.push(`invoice_type = "${filters.invoiceType}"`);
        }
        if (filters?.isPaid !== undefined) {
            filterParts.push(`is_paid = ${filters.isPaid}`);
        }

        const invoices = await pb.collection('invoices').getFullList({
            filter: filterParts.join(' && ') || '',
            sort: '-invoice_date',
        });

        // Fetch items for all invoices (batch)
        const invoiceIds = invoices.map(inv => inv.id);
        let allItems: any[] = [];
        if (invoiceIds.length > 0) {
            const itemFilter = invoiceIds.map(id => `invoice="${id}"`).join(' || ');
            allItems = await pb.collection('invoice_items').getFullList({
                filter: itemFilter,
            });
        }

        // Group items by invoice
        const itemsByInvoice = new Map<string, any[]>();
        allItems.forEach(item => {
            if (!itemsByInvoice.has(item.invoice)) {
                itemsByInvoice.set(item.invoice, []);
            }
            itemsByInvoice.get(item.invoice)!.push(item);
        });

        return invoices.map((inv: any) => ({
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
            grand_total: inv.grand_total ?? inv.total ?? 0,
            amount_in_words: inv.amount_in_words || '',
            is_reverse_charge: inv.is_reverse_charge || false,
            transport_mode: inv.transport_mode || '',
            vehicle_number: inv.vehicle_number || '',
            payment_terms: inv.payment_terms || '',
            due_date: inv.due_date || '',
            is_paid: inv.is_paid ?? (inv.status === 'paid'),
            paid_amount: inv.paid_amount || 0,
            notes: inv.notes || '',
            items: (itemsByInvoice.get(inv.id) || []).map((item: any) => ({
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
            })),
            created_at: inv.created,
            updated_at: inv.updated,
        }));
    } catch (error) {
        console.error('Error fetching invoices:', error);
        return [];
    }
}

export async function markInvoicePaid(id: string, paidAmount?: number): Promise<void> {
    const invoice = await getInvoice(id);
    if (!invoice) throw new Error('Invoice not found');

    const total = invoice.grand_total || invoice.total || 0;
    await pb.collection('invoices').update(id, {
        status: 'paid',
        is_paid: true,
        paid_amount: paidAmount ?? total,
    });
}

// ===========================================
// INVOICE FROM SALE
// ===========================================

export async function createInvoiceFromSale(saleId: string): Promise<Invoice> {
    // Fetch sale with items
    const sale = await pb.collection('sales').getOne(saleId);
    const saleItems = await pb.collection('sale_items').getFullList({
        filter: `sale="${saleId}"`,
        expand: 'variant,variant.product',
    });

    // Get store settings
    const storeSettings = await getStoreSettings();

    // Build invoice items with GST
    const invoiceItems: InvoiceItem[] = saleItems.map((item: any, index: number) => {
        const variant = item.expand?.variant;
        const product = variant?.expand?.product;

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
            variant_id: item.variant,
            sr_no: index + 1,
            description: (product?.name || 'Product') + (variant?.variant_name ? ` - ${variant.variant_name}` : ''),
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
        buyer_state_code: storeSettings.store_state_code,
        place_of_supply: storeSettings.store_state_code,

        customer_id: sale.customer || undefined,
        sale_id: saleId,

        status: 'paid',
        subtotal: taxableValue,
        discount: sale.discount || 0,
        tax: totalTax,
        total: grandTotal - (sale.discount || 0),

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
        is_paid: true,
        paid_amount: sale.total || (grandTotal - (sale.discount || 0)),
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
