/**
 * Sync PocketBase Collection Schemas
 * Adds missing fields to all collections based on TypeScript interfaces
 * 
 * PocketBase v0.26+ uses `fields` instead of `schema`
 */
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Define all fields that should exist for each collection
// Based on TypeScript interfaces in src/lib/*.ts
const COLLECTION_FIELDS: Record<string, Array<{ name: string, type: string, required?: boolean, options?: any }>> = {
    vendors: [
        { name: 'name', type: 'text', required: true },
        { name: 'contact_name', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'address', type: 'text' },
        { name: 'gstin', type: 'text' },
        { name: 'pan', type: 'text' },
        { name: 'payment_terms', type: 'text' },
        { name: 'notes', type: 'text' },
    ],
    customers: [
        { name: 'name', type: 'text', required: true },
        { name: 'phone', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'address', type: 'text' },
        { name: 'gstin', type: 'text' },
        { name: 'tier', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'is_active', type: 'bool' },
    ],
    products: [
        { name: 'name', type: 'text', required: true },
        { name: 'sku', type: 'text', required: true },
        { name: 'description', type: 'text' },
        { name: 'base_price', type: 'number', required: true },
        { name: 'cost_price', type: 'number' },
        { name: 'category', type: 'text' },
        { name: 'image_url', type: 'url' },
        { name: 'barcode', type: 'text' },
        { name: 'hsn_code', type: 'text' },
        { name: 'is_active', type: 'bool' },
    ],
    product_variants: [
        { name: 'product', type: 'relation', options: { collectionId: 'products', cascadeDelete: true } },
        { name: 'variant_name', type: 'text', required: true },
        { name: 'sku_suffix', type: 'text' },
        { name: 'price_adjustment', type: 'number' },
        { name: 'stock_level', type: 'number', required: true },
        { name: 'low_stock_threshold', type: 'number' },
        { name: 'size', type: 'text' },
        { name: 'color', type: 'text' },
        { name: 'material', type: 'text' },
        { name: 'barcode', type: 'text' },
    ],
    sales: [
        { name: 'customer', type: 'relation', options: { collectionId: 'customers' } },
        { name: 'total', type: 'number', required: true },
        { name: 'discount', type: 'number' },
        { name: 'tax', type: 'number' },
        { name: 'payment_method', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'notes', type: 'text' },
    ],
    sale_items: [
        { name: 'sale', type: 'relation', options: { collectionId: 'sales', cascadeDelete: true } },
        { name: 'variant', type: 'relation', options: { collectionId: 'product_variants' } },
        { name: 'quantity', type: 'number', required: true },
        { name: 'unit_price', type: 'number', required: true },
        { name: 'discount', type: 'number' },
        { name: 'total', type: 'number' },
    ],
    sales_orders: [
        { name: 'customer', type: 'relation', options: { collectionId: 'customers' } },
        { name: 'order_number', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'subtotal', type: 'number' },
        { name: 'discount', type: 'number' },
        { name: 'tax', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'notes', type: 'text' },
        { name: 'due_date', type: 'date' },
    ],
    invoices: [
        { name: 'invoice_number', type: 'text', required: true },
        { name: 'customer', type: 'relation', options: { collectionId: 'customers' } },
        { name: 'order', type: 'relation', options: { collectionId: 'sales_orders' } },
        { name: 'status', type: 'text' },
        { name: 'subtotal', type: 'number' },
        { name: 'discount', type: 'number' },
        { name: 'tax', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'paid_amount', type: 'number' },
        { name: 'due_date', type: 'date' },
        { name: 'notes', type: 'text' },
    ],
    purchase_orders: [
        { name: 'vendor', type: 'relation', options: { collectionId: 'vendors' } },
        { name: 'po_number', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'subtotal', type: 'number' },
        { name: 'tax', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'expected_date', type: 'date' },
        { name: 'notes', type: 'text' },
    ],
    bank_accounts: [
        { name: 'account_name', type: 'text', required: true },
        { name: 'account_number', type: 'text' },
        { name: 'bank_name', type: 'text' },
        { name: 'ifsc_code', type: 'text' },
        { name: 'account_type', type: 'text' },
        { name: 'opening_balance', type: 'number' },
        { name: 'current_balance', type: 'number' },
        { name: 'is_active', type: 'bool' },
    ],
    bank_transactions: [
        { name: 'account', type: 'relation', options: { collectionId: 'bank_accounts' } },
        { name: 'type', type: 'text' },
        { name: 'amount', type: 'number', required: true },
        { name: 'balance_after', type: 'number' },
        { name: 'description', type: 'text' },
        { name: 'reference_number', type: 'text' },
        { name: 'transaction_date', type: 'date' },
    ],
    expenses: [
        { name: 'category', type: 'relation', options: { collectionId: 'expense_categories' } },
        { name: 'amount', type: 'number', required: true },
        { name: 'description', type: 'text' },
        { name: 'vendor', type: 'text' },
        { name: 'receipt_url', type: 'url' },
        { name: 'expense_date', type: 'date' },
        { name: 'payment_method', type: 'text' },
    ],
    expense_categories: [
        { name: 'name', type: 'text', required: true },
        { name: 'description', type: 'text' },
        { name: 'budget', type: 'number' },
        { name: 'is_active', type: 'bool' },
    ],
    categories: [
        { name: 'name', type: 'text', required: true },
        { name: 'slug', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'parent', type: 'relation', options: { collectionId: 'categories' } },
        { name: 'sort_order', type: 'number' },
        { name: 'icon', type: 'text' },
        { name: 'color', type: 'text' },
        { name: 'is_active', type: 'bool' },
    ],
    delivery_challans: [
        { name: 'challan_number', type: 'text', required: true },
        { name: 'customer', type: 'relation', options: { collectionId: 'customers' } },
        { name: 'order', type: 'relation', options: { collectionId: 'sales_orders' } },
        { name: 'status', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'delivery_date', type: 'date' },
    ],
    store_settings: [
        { name: 'key', type: 'text', required: true },
        { name: 'value', type: 'json' },
        { name: 'category', type: 'text' },
    ],
};

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        let updated = 0;
        let errors = 0;

        for (const [collectionName, expectedFields] of Object.entries(COLLECTION_FIELDS)) {
            try {
                // Get current collection
                const collection = await pb.collections.getOne(collectionName);
                const currentFields = collection.fields || [];
                const currentFieldNames = currentFields.map((f: any) => f.name);

                // Find missing fields
                const missingFields = expectedFields.filter(f => !currentFieldNames.includes(f.name));

                if (missingFields.length === 0) {
                    console.log(`✓ ${collectionName} - all fields present`);
                    continue;
                }

                console.log(`⚙ ${collectionName} - adding ${missingFields.length} fields: ${missingFields.map(f => f.name).join(', ')}`);

                // Build new fields array
                const newFields = [...currentFields];
                for (const field of missingFields) {
                    const fieldDef: any = {
                        name: field.name,
                        type: field.type,
                        required: field.required || false,
                    };
                    if (field.options) {
                        Object.assign(fieldDef, field.options);
                    }
                    newFields.push(fieldDef);
                }

                // Update collection
                await pb.collections.update(collection.id, { fields: newFields });
                console.log(`  ✓ ${collectionName} updated`);
                updated++;

            } catch (err: any) {
                if (err.status === 404) {
                    console.log(`⊘ ${collectionName} - collection not found`);
                } else {
                    console.log(`✗ ${collectionName} - error: ${err.message}`);
                    errors++;
                }
            }
        }

        console.log(`\n========================================`);
        console.log(`Schema sync complete: ${updated} updated, ${errors} errors`);
        console.log(`========================================`);

    } catch (err: any) {
        console.error("Fatal error:", err.message);
        process.exit(1);
    }
}

main();
