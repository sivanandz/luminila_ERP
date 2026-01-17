/**
 * Sync PocketBase Schema to Match Supabase EXACTLY
 * Based on src/types/database.ts
 * 
 * This script ensures all collections have the exact fields from Supabase
 */
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Exact schema from Supabase - types/database.ts
const SUPABASE_SCHEMA: Record<string, Array<{ name: string, type: string, required?: boolean, options?: any }>> = {
    products: [
        { name: 'sku', type: 'text', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'description', type: 'text' },
        { name: 'category', type: 'text' },
        { name: 'base_price', type: 'number', required: true },
        { name: 'cost_price', type: 'number' },
        { name: 'image_url', type: 'url' },
        { name: 'barcode_data', type: 'text' },
        { name: 'barcode', type: 'text' }, // Alias used in some places
        { name: 'hsn_code', type: 'text' },
        { name: 'is_active', type: 'bool' },
    ],
    product_variants: [
        { name: 'product', type: 'relation', options: { collectionId: '_PB_PRODUCTS_ID_', cascadeDelete: true }, required: true },
        { name: 'sku_suffix', type: 'text' },
        { name: 'variant_name', type: 'text', required: true },
        { name: 'material', type: 'text' },
        { name: 'size', type: 'text' },
        { name: 'color', type: 'text' },
        { name: 'price_adjustment', type: 'number' },
        { name: 'stock_level', type: 'number', required: true },
        { name: 'low_stock_threshold', type: 'number' },
        { name: 'barcode', type: 'text' },
        { name: 'shopify_inventory_id', type: 'text' },
        { name: 'woocommerce_product_id', type: 'number' },
    ],
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
    vendor_products: [
        { name: 'vendor', type: 'relation', options: { collectionId: '_PB_VENDORS_ID_' }, required: true },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' }, required: true },
        { name: 'vendor_sku', type: 'text' },
        { name: 'vendor_price', type: 'number' },
        { name: 'lead_time_days', type: 'number' },
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
    sales: [
        { name: 'channel', type: 'text' }, // pos, shopify, woocommerce, whatsapp
        { name: 'channel_order_id', type: 'text' },
        { name: 'customer', type: 'relation', options: { collectionId: '_PB_CUSTOMERS_ID_' } },
        { name: 'customer_name', type: 'text' },
        { name: 'customer_phone', type: 'text' },
        { name: 'customer_address', type: 'text' },
        { name: 'subtotal', type: 'number' },
        { name: 'discount', type: 'number' },
        { name: 'total', type: 'number', required: true },
        { name: 'payment_method', type: 'text' },
        { name: 'status', type: 'text' }, // pending, confirmed, shipped, delivered, cancelled
        { name: 'notes', type: 'text' },
    ],
    sale_items: [
        { name: 'sale', type: 'relation', options: { collectionId: '_PB_SALES_ID_', cascadeDelete: true }, required: true },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' }, required: true },
        { name: 'quantity', type: 'number', required: true },
        { name: 'unit_price', type: 'number', required: true },
        { name: 'discount', type: 'number' },
        { name: 'total', type: 'number' },
    ],
    stock_movements: [
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' }, required: true },
        { name: 'movement_type', type: 'text', required: true }, // sale, purchase, adjustment, return, sync
        { name: 'quantity', type: 'number', required: true },
        { name: 'reference_id', type: 'text' },
        { name: 'source', type: 'text' },
        { name: 'notes', type: 'text' },
    ],
    sales_orders: [
        { name: 'order_number', type: 'text', required: true },
        { name: 'order_type', type: 'text' }, // estimate, sales_order
        { name: 'customer', type: 'relation', options: { collectionId: '_PB_CUSTOMERS_ID_' } },
        { name: 'customer_name', type: 'text' },
        { name: 'customer_phone', type: 'text' },
        { name: 'customer_email', type: 'text' },
        { name: 'billing_address', type: 'text' },
        { name: 'shipping_address', type: 'text' },
        { name: 'order_date', type: 'date' },
        { name: 'valid_until', type: 'date' },
        { name: 'expected_delivery_date', type: 'date' },
        { name: 'status', type: 'text' }, // draft, sent, confirmed, shipped, delivered, cancelled, invoiced
        { name: 'subtotal', type: 'number' },
        { name: 'tax_total', type: 'number' },
        { name: 'discount_total', type: 'number' },
        { name: 'shipping_charges', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'notes', type: 'text' },
        { name: 'internal_notes', type: 'text' },
        { name: 'created_by', type: 'text' },
    ],
    sales_order_items: [
        { name: 'order', type: 'relation', options: { collectionId: '_PB_SALES_ORDERS_ID_', cascadeDelete: true }, required: true },
        { name: 'product', type: 'relation', options: { collectionId: '_PB_PRODUCTS_ID_' } },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' } },
        { name: 'description', type: 'text' },
        { name: 'quantity', type: 'number', required: true },
        { name: 'unit_price', type: 'number', required: true },
        { name: 'tax_rate', type: 'number' },
        { name: 'discount_amount', type: 'number' },
        { name: 'total', type: 'number' },
    ],
    purchase_orders: [
        { name: 'po_number', type: 'text', required: true },
        { name: 'vendor', type: 'relation', options: { collectionId: '_PB_VENDORS_ID_' } },
        { name: 'order_date', type: 'date' },
        { name: 'expected_date', type: 'date' },
        { name: 'received_date', type: 'date' },
        { name: 'status', type: 'text' }, // draft, sent, partial, received, cancelled
        { name: 'subtotal', type: 'number' },
        { name: 'gst_amount', type: 'number' },
        { name: 'shipping_cost', type: 'number' },
        { name: 'discount_amount', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'shipping_address', type: 'text' },
        { name: 'notes', type: 'text' },
    ],
    purchase_order_items: [
        { name: 'po', type: 'relation', options: { collectionId: '_PB_PURCHASE_ORDERS_ID_', cascadeDelete: true }, required: true },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' } },
        { name: 'description', type: 'text' },
        { name: 'hsn_code', type: 'text' },
        { name: 'quantity_ordered', type: 'number', required: true },
        { name: 'quantity_received', type: 'number' },
        { name: 'unit', type: 'text' },
        { name: 'unit_price', type: 'number', required: true },
        { name: 'gst_rate', type: 'number' },
        { name: 'gst_amount', type: 'number' },
        { name: 'total_price', type: 'number' },
    ],
    goods_received_notes: [
        { name: 'grn_number', type: 'text', required: true },
        { name: 'po', type: 'relation', options: { collectionId: '_PB_PURCHASE_ORDERS_ID_' } },
        { name: 'vendor', type: 'relation', options: { collectionId: '_PB_VENDORS_ID_' } },
        { name: 'received_date', type: 'date' },
        { name: 'received_by', type: 'text' },
        { name: 'notes', type: 'text' },
    ],
    grn_items: [
        { name: 'grn', type: 'relation', options: { collectionId: '_PB_GOODS_RECEIVED_NOTES_ID_', cascadeDelete: true }, required: true },
        { name: 'po_item', type: 'relation', options: { collectionId: '_PB_PURCHASE_ORDER_ITEMS_ID_' } },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' } },
        { name: 'quantity_received', type: 'number', required: true },
        { name: 'quantity_rejected', type: 'number' },
        { name: 'rejection_reason', type: 'text' },
    ],
    bank_accounts: [
        { name: 'account_name', type: 'text', required: true },
        { name: 'account_number', type: 'text' },
        { name: 'bank_name', type: 'text' },
        { name: 'ifsc_code', type: 'text' },
        { name: 'account_type', type: 'text' },
        { name: 'currency', type: 'text' },
        { name: 'opening_balance', type: 'number' },
        { name: 'current_balance', type: 'number' },
        { name: 'is_active', type: 'bool' },
    ],
    bank_transactions: [
        { name: 'account', type: 'relation', options: { collectionId: '_PB_BANK_ACCOUNTS_ID_' }, required: true },
        { name: 'transaction_date', type: 'date' },
        { name: 'type', type: 'text', required: true }, // deposit, withdrawal, transfer
        { name: 'amount', type: 'number', required: true },
        { name: 'balance_after', type: 'number' },
        { name: 'description', type: 'text' },
        { name: 'reference_number', type: 'text' },
        { name: 'related_entity_type', type: 'text' },
        { name: 'related_entity_id', type: 'text' },
        { name: 'created_by', type: 'text' },
    ],
    // Additional collections used in the app
    categories: [
        { name: 'name', type: 'text', required: true },
        { name: 'slug', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'parent', type: 'relation', options: { collectionId: '_SELF_' } },
        { name: 'sort_order', type: 'number' },
        { name: 'icon', type: 'text' },
        { name: 'color', type: 'text' },
        { name: 'is_active', type: 'bool' },
    ],
    invoices: [
        { name: 'invoice_number', type: 'text', required: true },
        { name: 'customer', type: 'relation', options: { collectionId: '_PB_CUSTOMERS_ID_' } },
        { name: 'order', type: 'relation', options: { collectionId: '_PB_SALES_ORDERS_ID_' } },
        { name: 'invoice_date', type: 'date' },
        { name: 'due_date', type: 'date' },
        { name: 'status', type: 'text' },
        { name: 'subtotal', type: 'number' },
        { name: 'discount', type: 'number' },
        { name: 'tax', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'paid_amount', type: 'number' },
        { name: 'notes', type: 'text' },
    ],
    invoice_items: [
        { name: 'invoice', type: 'relation', options: { collectionId: '_PB_INVOICES_ID_', cascadeDelete: true }, required: true },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' } },
        { name: 'description', type: 'text' },
        { name: 'quantity', type: 'number', required: true },
        { name: 'unit_price', type: 'number', required: true },
        { name: 'discount', type: 'number' },
        { name: 'tax', type: 'number' },
        { name: 'total', type: 'number' },
    ],
    invoice_payments: [
        { name: 'invoice', type: 'relation', options: { collectionId: '_PB_INVOICES_ID_', cascadeDelete: true }, required: true },
        { name: 'amount', type: 'number', required: true },
        { name: 'payment_date', type: 'date' },
        { name: 'payment_method', type: 'text' },
        { name: 'reference_number', type: 'text' },
        { name: 'notes', type: 'text' },
    ],
    expenses: [
        { name: 'category', type: 'relation', options: { collectionId: '_PB_EXPENSE_CATEGORIES_ID_' } },
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
    discounts: [
        { name: 'code', type: 'text', required: true },
        { name: 'name', type: 'text' },
        { name: 'type', type: 'text' }, // percentage, fixed
        { name: 'value', type: 'number', required: true },
        { name: 'min_order_value', type: 'number' },
        { name: 'max_uses', type: 'number' },
        { name: 'used_count', type: 'number' },
        { name: 'valid_from', type: 'date' },
        { name: 'valid_until', type: 'date' },
        { name: 'is_active', type: 'bool' },
    ],
    delivery_challans: [
        { name: 'challan_number', type: 'text', required: true },
        { name: 'customer', type: 'relation', options: { collectionId: '_PB_CUSTOMERS_ID_' } },
        { name: 'order', type: 'relation', options: { collectionId: '_PB_SALES_ORDERS_ID_' } },
        { name: 'status', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'delivery_date', type: 'date' },
        { name: 'vehicle_number', type: 'text' },
        { name: 'driver_name', type: 'text' },
        { name: 'driver_phone', type: 'text' },
    ],
    delivery_challan_items: [
        { name: 'challan', type: 'relation', options: { collectionId: '_PB_DELIVERY_CHALLANS_ID_', cascadeDelete: true }, required: true },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' } },
        { name: 'description', type: 'text' },
        { name: 'quantity', type: 'number', required: true },
    ],
    customer_interactions: [
        { name: 'customer', type: 'relation', options: { collectionId: '_PB_CUSTOMERS_ID_' }, required: true },
        { name: 'type', type: 'text' }, // call, email, visit, note
        { name: 'summary', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'interaction_date', type: 'date' },
        { name: 'created_by', type: 'text' },
    ],
    activity_logs: [
        { name: 'entity_type', type: 'text', required: true },
        { name: 'entity_id', type: 'text', required: true },
        { name: 'action', type: 'text', required: true },
        { name: 'description', type: 'text' },
        { name: 'user_id', type: 'text' },
        { name: 'user_name', type: 'text' },
        { name: 'metadata', type: 'json' },
    ],
    store_settings: [
        { name: 'key', type: 'text', required: true },
        { name: 'value', type: 'json' },
        { name: 'category', type: 'text' },
    ],
    number_sequences: [
        { name: 'prefix', type: 'text', required: true },
        { name: 'current_number', type: 'number', required: true },
        { name: 'padding', type: 'number' },
    ],
    credit_notes: [
        { name: 'credit_note_number', type: 'text', required: true },
        { name: 'customer', type: 'relation', options: { collectionId: '_PB_CUSTOMERS_ID_' } },
        { name: 'invoice', type: 'relation', options: { collectionId: '_PB_INVOICES_ID_' } },
        { name: 'amount', type: 'number', required: true },
        { name: 'reason', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'notes', type: 'text' },
    ],
    credit_note_items: [
        { name: 'credit_note', type: 'relation', options: { collectionId: '_PB_CREDIT_NOTES_ID_', cascadeDelete: true }, required: true },
        { name: 'variant', type: 'relation', options: { collectionId: '_PB_PRODUCT_VARIANTS_ID_' } },
        { name: 'quantity', type: 'number', required: true },
        { name: 'unit_price', type: 'number', required: true },
        { name: 'total', type: 'number' },
    ],
    discount_usage: [
        { name: 'discount', type: 'relation', options: { collectionId: '_PB_DISCOUNTS_ID_' }, required: true },
        { name: 'order', type: 'relation', options: { collectionId: '_PB_SALES_ORDERS_ID_' } },
        { name: 'customer', type: 'relation', options: { collectionId: '_PB_CUSTOMERS_ID_' } },
        { name: 'amount_saved', type: 'number' },
    ],
};

// Cache for collection IDs
const collectionIdCache: Record<string, string> = {};

async function getCollectionId(name: string): Promise<string | null> {
    if (collectionIdCache[name]) return collectionIdCache[name];
    try {
        const col = await pb.collections.getOne(name);
        collectionIdCache[name] = col.id;
        return col.id;
    } catch {
        return null;
    }
}

async function main() {
    try {
        console.log("=".repeat(60));
        console.log("  PocketBase Schema Sync (Supabase-Compatible)");
        console.log("=".repeat(60));
        console.log("\nAuthenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        // Pre-cache collection IDs
        console.log("Caching collection IDs...");
        const allCollections = await pb.collections.getFullList();
        for (const col of allCollections) {
            collectionIdCache[col.name] = col.id;
        }
        console.log(`Found ${allCollections.length} existing collections\n`);

        let updated = 0;
        let created = 0;
        let errors = 0;

        for (const [collectionName, expectedFields] of Object.entries(SUPABASE_SCHEMA)) {
            try {
                const collectionId = await getCollectionId(collectionName);

                if (!collectionId) {
                    // Collection doesn't exist - create it
                    console.log(`⚙ Creating collection: ${collectionName}`);

                    const fields = await resolveFields(expectedFields);
                    await pb.collections.create({
                        name: collectionName,
                        type: 'base',
                        fields: fields,
                        listRule: '@request.auth.id != ""',
                        viewRule: '@request.auth.id != ""',
                        createRule: '@request.auth.id != ""',
                        updateRule: '@request.auth.id != ""',
                        deleteRule: '@request.auth.id != ""',
                    });

                    // Cache the new ID
                    const newCol = await pb.collections.getOne(collectionName);
                    collectionIdCache[collectionName] = newCol.id;

                    console.log(`  ✓ ${collectionName} created`);
                    created++;
                    continue;
                }

                // Collection exists - check for missing fields
                const collection = await pb.collections.getOne(collectionId);
                const currentFields = collection.fields || [];
                const currentFieldNames = currentFields.map((f: any) => f.name);

                const missingFields = expectedFields.filter(f => !currentFieldNames.includes(f.name));

                if (missingFields.length === 0) {
                    console.log(`✓ ${collectionName} - schema OK`);
                    continue;
                }

                console.log(`⚙ ${collectionName} - adding ${missingFields.length} fields`);

                const resolvedMissingFields = await resolveFields(missingFields);
                const newFields = [...currentFields, ...resolvedMissingFields];

                await pb.collections.update(collection.id, { fields: newFields });
                console.log(`  ✓ ${collectionName} updated: +${missingFields.map(f => f.name).join(', ')}`);
                updated++;

            } catch (err: any) {
                console.log(`✗ ${collectionName} - error: ${err.message}`);
                errors++;
            }
        }

        console.log("\n" + "=".repeat(60));
        console.log(`  Schema sync complete!`);
        console.log(`  Created: ${created}, Updated: ${updated}, Errors: ${errors}`);
        console.log("=".repeat(60));

    } catch (err: any) {
        console.error("\nFatal error:", err.message);
        process.exit(1);
    }
}

async function resolveFields(fields: Array<{ name: string, type: string, required?: boolean, options?: any }>): Promise<any[]> {
    const resolved = [];

    for (const field of fields) {
        const fieldDef: any = {
            name: field.name,
            type: field.type,
            required: field.required || false,
        };

        if (field.type === 'relation' && field.options) {
            // Resolve collection ID placeholder
            let targetCollectionId = field.options.collectionId;

            if (targetCollectionId === '_SELF_') {
                // Self-referential - will be set after creation
                fieldDef.type = 'text'; // Fallback for now
            } else if (targetCollectionId?.startsWith('_PB_')) {
                // Placeholder - resolve to actual ID
                const targetName = targetCollectionId.replace('_PB_', '').replace('_ID_', '').toLowerCase();
                const actualId = await getCollectionId(targetName);
                if (actualId) {
                    fieldDef.collectionId = actualId;
                    if (field.options.cascadeDelete) {
                        fieldDef.cascadeDelete = true;
                    }
                } else {
                    console.log(`    ⚠ Relation target "${targetName}" not found, skipping ${field.name}`);
                    continue;
                }
            } else {
                fieldDef.collectionId = targetCollectionId;
            }
        }

        resolved.push(fieldDef);
    }

    return resolved;
}

main();
