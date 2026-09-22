/**
 * Migration Script: Add GST Compliance Fields to 'invoices' and 'invoice_items'
 * Resolves F1 (🔴 P0) and F2 (🟠 P1) from AGENT 1 / AGENT 2 Collaboration Forum
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';

async function migrate() {
    console.log(`[Migration] Connecting to PocketBase at ${PB_URL}...`);
    const pb = new PocketBase(PB_URL);

    const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
    const adminPass = process.env.PB_ADMIN_PASSWORD || 'password123456';

    try {
        await pb.collection('_superusers').authWithPassword(adminEmail, adminPass);
    } catch {
        await (pb as any).admins.authWithPassword(adminEmail, adminPass);
    }
    console.log('[Migration] Superuser authenticated.');

    // 1. Update invoices collection
    const invoicesCol = await pb.collections.getOne('invoices');
    const existingInvoiceFields = new Set(invoicesCol.fields.map((f: any) => f.name));

    const invoiceFieldsToAdd = [
        { name: 'seller_gstin', type: 'text', required: false },
        { name: 'seller_name', type: 'text', required: false },
        { name: 'seller_address', type: 'text', required: false },
        { name: 'seller_state_code', type: 'text', required: false },
        { name: 'buyer_name', type: 'text', required: false },
        { name: 'buyer_gstin', type: 'text', required: false },
        { name: 'buyer_phone', type: 'text', required: false },
        { name: 'buyer_email', type: 'text', required: false },
        { name: 'buyer_address', type: 'text', required: false },
        { name: 'buyer_state_code', type: 'text', required: false },
        { name: 'place_of_supply', type: 'text', required: false },
        { name: 'sale', type: 'relation', collectionId: 'pbc_2697449135', cascadeDelete: false, maxSelect: 1, required: false },
        { name: 'taxable_value', type: 'number', required: false },
        { name: 'cgst_amount', type: 'number', required: false },
        { name: 'sgst_amount', type: 'number', required: false },
        { name: 'igst_amount', type: 'number', required: false },
        { name: 'cess_amount', type: 'number', required: false },
        { name: 'total_tax', type: 'number', required: false },
        { name: 'discount_amount', type: 'number', required: false },
        { name: 'shipping_charges', type: 'number', required: false },
        { name: 'grand_total', type: 'number', required: false },
        { name: 'amount_in_words', type: 'text', required: false },
        { name: 'is_reverse_charge', type: 'bool', required: false },
        { name: 'transport_mode', type: 'text', required: false },
        { name: 'vehicle_number', type: 'text', required: false },
        { name: 'payment_terms', type: 'text', required: false },
        { name: 'is_paid', type: 'bool', required: false },
    ];

    const newInvoiceFields = [...invoicesCol.fields];
    let invAddedCount = 0;
    for (const field of invoiceFieldsToAdd) {
        if (!existingInvoiceFields.has(field.name)) {
            newInvoiceFields.push(field);
            invAddedCount++;
        }
    }

    if (invAddedCount > 0) {
        console.log(`[Migration] Adding ${invAddedCount} GST fields to 'invoices'...`);
        await pb.collections.update(invoicesCol.id, {
            fields: newInvoiceFields,
        });
        console.log(`[Migration] Successfully updated 'invoices' collection.`);
    } else {
        console.log(`[Migration] 'invoices' already has all GST fields.`);
    }

    // 2. Update invoice_items collection
    const itemsCol = await pb.collections.getOne('invoice_items');
    const existingItemFields = new Set(itemsCol.fields.map((f: any) => f.name));

    const itemFieldsToAdd = [
        { name: 'sr_no', type: 'number', required: false },
        { name: 'hsn_code', type: 'text', required: false },
        { name: 'unit', type: 'text', required: false },
        { name: 'discount_percent', type: 'number', required: false },
        { name: 'discount_amount', type: 'number', required: false },
        { name: 'taxable_amount', type: 'number', required: false },
        { name: 'gst_rate', type: 'number', required: false },
        { name: 'cgst_rate', type: 'number', required: false },
        { name: 'cgst_amount', type: 'number', required: false },
        { name: 'sgst_rate', type: 'number', required: false },
        { name: 'sgst_amount', type: 'number', required: false },
        { name: 'igst_rate', type: 'number', required: false },
        { name: 'igst_amount', type: 'number', required: false },
        { name: 'cess_rate', type: 'number', required: false },
        { name: 'cess_amount', type: 'number', required: false },
        { name: 'total_amount', type: 'number', required: false },
    ];

    const newItemFields = [...itemsCol.fields];
    let itemAddedCount = 0;
    for (const field of itemFieldsToAdd) {
        if (!existingItemFields.has(field.name)) {
            newItemFields.push(field);
            itemAddedCount++;
        }
    }

    if (itemAddedCount > 0) {
        console.log(`[Migration] Adding ${itemAddedCount} GST fields to 'invoice_items'...`);
        await pb.collections.update(itemsCol.id, {
            fields: newItemFields,
        });
        console.log(`[Migration] Successfully updated 'invoice_items' collection.`);
    } else {
        console.log(`[Migration] 'invoice_items' already has all GST fields.`);
    }

    // 3. Update number_sequences collection (add name and current_value fields for sequence tracking)
    const seqCol = await pb.collections.getOne('number_sequences');
    const existingSeqFields = new Set(seqCol.fields.map((f: any) => f.name));

    const seqFieldsToAdd = [
        { name: 'name', type: 'text', required: false },
        { name: 'current_value', type: 'number', required: false },
    ];

    const newSeqFields = [...seqCol.fields];
    let seqAddedCount = 0;
    for (const field of seqFieldsToAdd) {
        if (!existingSeqFields.has(field.name)) {
            newSeqFields.push(field);
            seqAddedCount++;
        }
    }

    if (seqAddedCount > 0) {
        console.log(`[Migration] Adding ${seqAddedCount} sequence compatibility fields to 'number_sequences'...`);
        await pb.collections.update(seqCol.id, {
            fields: newSeqFields,
        });
        console.log(`[Migration] Successfully updated 'number_sequences' collection.`);
    } else {
        console.log(`[Migration] 'number_sequences' already has all fields.`);
    }

    console.log('[Migration] GST & Sequence Schema Migration Completed Successfully!');
}

migrate().catch((err) => {
    console.error('[Migration] Failed:', err);
    process.exit(1);
});
