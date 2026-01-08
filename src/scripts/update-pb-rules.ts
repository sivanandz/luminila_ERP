/**
 * Update PocketBase Collection API Rules
 * Sets listRule and viewRule to allow authenticated user access
 */
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Rule that allows any authenticated user
const AUTH_RULE = '@request.auth.id != ""';

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        // Collections that need API rules updated
        const collections = [
            'sales',
            'sale_items',
            'sales_orders',
            'sales_order_items',
            'customers',
            'products',
            'product_variants',
            'vendors',
            'categories',
            'attributes',
            'invoices',
            'invoice_items',
            'invoice_payments',
            'purchase_orders',
            'purchase_order_items',
            'bank_accounts',
            'bank_transactions',
            'expense_categories',
            'expenses',
            'stock_movements',
            'activity_logs',
            'delivery_challans',
            'delivery_challan_items',
            'goods_received_notes',
            'grn_items',
            'credit_notes',
            'credit_note_items',
            'discounts',
            'discount_usage',
            'loyalty_settings',
            'loyalty_tiers',
            'loyalty_accounts',
            'loyalty_transactions',
            'cash_register_shifts',
            'cash_drawer_operations',
            'customer_interactions',
            'store_settings',
            'number_sequences',
            'roles',
            'user_roles',
        ];

        console.log(`Updating API rules for ${collections.length} collections...\n`);

        for (const name of collections) {
            try {
                // Get existing collection
                const collection = await pb.collections.getOne(name);

                // Update with auth rules
                await pb.collections.update(collection.id, {
                    listRule: AUTH_RULE,
                    viewRule: AUTH_RULE,
                    createRule: AUTH_RULE,
                    updateRule: AUTH_RULE,
                    deleteRule: AUTH_RULE,
                });

                console.log(`✓ ${name} - rules updated`);
            } catch (err: any) {
                if (err.status === 404) {
                    console.log(`⊘ ${name} - not found (skipping)`);
                } else {
                    console.log(`✗ ${name} - error: ${err.message}`);
                }
            }
        }

        console.log("\n✓ API rules update complete!");

    } catch (err: any) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

main();
