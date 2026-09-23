import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8091';
const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

async function main() {
    const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
    const adminPass = process.env.PB_ADMIN_PASSWORD || 'password123456';
    try {
        await pb.collection('_superusers').authWithPassword(adminEmail, adminPass);
    } catch {
        await (pb as any).admins.authWithPassword(adminEmail, adminPass);
    }
    console.log('Connected as admin to', PB_URL);

    // 1. Inspect & Migrate discounts
    const discountsCol = await pb.collections.getOne('discounts');
    const existingDiscountFields = new Set(discountsCol.fields.map((f: any) => f.name));
    console.log('Existing discounts fields:', Array.from(existingDiscountFields).join(', '));

    const fieldsToAddDiscounts: any[] = [
        { name: 'discount_type', type: 'text', required: false },
        { name: 'description', type: 'text', required: false },
        { name: 'max_discount', type: 'number', required: false },
        { name: 'min_purchase', type: 'number', required: false },
        { name: 'min_items', type: 'number', required: false },
        { name: 'applies_to', type: 'text', required: false },
        { name: 'applies_to_ids', type: 'json', required: false },
        { name: 'usage_limit', type: 'number', required: false },
        { name: 'per_customer_limit', type: 'number', required: false },
        { name: 'start_date', type: 'date', required: false },
        { name: 'end_date', type: 'date', required: false },
    ];

    let discountsUpdated = false;
    for (const f of fieldsToAddDiscounts) {
        if (!existingDiscountFields.has(f.name)) {
            discountsCol.fields.push(f);
            discountsUpdated = true;
            console.log(`+ Added field ${f.name} to discounts`);
        }
    }

    if (discountsUpdated) {
        await pb.collections.update('discounts', discountsCol);
        console.log('Updated discounts collection schema');
    } else {
        console.log('discounts collection already up to date');
    }

    // 2. Inspect & Migrate discount_usage
    const usageCol = await pb.collections.getOne('discount_usage');
    const existingUsageFields = new Set(usageCol.fields.map((f: any) => f.name));
    console.log('Existing discount_usage fields:', Array.from(existingUsageFields).join(', '));

    // Get collections to relate to
    const salesCol = await pb.collections.getOne('sales').catch(() => null);
    const invoicesCol = await pb.collections.getOne('invoices').catch(() => null);

    const fieldsToAddUsage: any[] = [
        { name: 'discount_amount', type: 'number', required: false },
        { name: 'order_value', type: 'number', required: false },
    ];

    if (salesCol && !existingUsageFields.has('sale')) {
        fieldsToAddUsage.push({
            name: 'sale',
            type: 'relation',
            collectionId: salesCol.id,
            maxSelect: 1,
            required: false,
        });
    }

    if (invoicesCol && !existingUsageFields.has('invoice')) {
        fieldsToAddUsage.push({
            name: 'invoice',
            type: 'relation',
            collectionId: invoicesCol.id,
            maxSelect: 1,
            required: false,
        });
    }

    let usageUpdated = false;
    for (const f of fieldsToAddUsage) {
        if (!existingUsageFields.has(f.name)) {
            usageCol.fields.push(f);
            usageUpdated = true;
            console.log(`+ Added field ${f.name} to discount_usage`);
        }
    }

    // Unlock discount_usage API rules from null -> @request.auth.id != ""
    if (usageCol.listRule === null || usageCol.listRule === '') {
        usageCol.listRule = '@request.auth.id != ""';
        usageCol.viewRule = '@request.auth.id != ""';
        usageCol.createRule = '@request.auth.id != ""';
        usageCol.updateRule = '@request.auth.id != ""';
        usageCol.deleteRule = '@request.auth.id != ""';
        usageUpdated = true;
        console.log('+ Unlocked discount_usage API rules to authenticated users');
    }

    if (usageUpdated) {
        await pb.collections.update('discount_usage', usageCol);
        console.log('Updated discount_usage collection schema');
    } else {
        console.log('discount_usage collection already up to date');
    }

    // 3. Inspect invoices for eway_bill fields
    const invoicesColData = await pb.collections.getOne('invoices');
    const existingInvoiceFields = new Set(invoicesColData.fields.map((f: any) => f.name));
    console.log('Checking eway fields on invoices...');

    const ewayFieldsToAdd: any[] = [
        { name: 'eway_bill_date', type: 'date', required: false },
        { name: 'eway_bill_valid_until', type: 'date', required: false },
        { name: 'eway_bill_status', type: 'text', required: false },
    ];

    let invoicesUpdated = false;
    for (const f of ewayFieldsToAdd) {
        if (!existingInvoiceFields.has(f.name)) {
            invoicesColData.fields.push(f);
            invoicesUpdated = true;
            console.log(`+ Added field ${f.name} to invoices`);
        }
    }

    if (invoicesUpdated) {
        await pb.collections.update('invoices', invoicesColData);
        console.log('Updated invoices collection schema with eway fields');
    }

    console.log('Migration finished successfully!');
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
