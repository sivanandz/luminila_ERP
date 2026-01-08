import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

const COLLECTIONS_TO_OPEN = [
    'products',
    'product_variants',
    'categories',
    'product_attributes',
    'product_attribute_values',
    'sales_orders',
    'sales_order_items',
    'cash_register_shifts',
    'cash_drawer_operations',
    'loyalty_settings',
    'loyalty_tiers',
    'loyalty_accounts',
    'loyalty_transactions',
    'customers',
    'vendors',
    // Add others if needed from previous phases
    'customer_interactions',
    'vendor_products',
    'purchase_orders',
    'purchase_order_items',
    'goods_received_notes',
    'grn_items',
    'sales' // If used
];

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("Logged in!");

        for (const name of COLLECTIONS_TO_OPEN) {
            try {
                const collection = await pb.collections.getFirstListItem(`name="${name}"`);

                console.log(`Updating rules for: ${name}...`);

                await pb.collections.update(collection.id, {
                    listRule: '@request.auth.id != ""',
                    viewRule: '@request.auth.id != ""',
                    createRule: '@request.auth.id != ""',
                    updateRule: '@request.auth.id != ""',
                    deleteRule: '@request.auth.id != ""',
                });

                console.log(`✅ Updated ${name}`);
            } catch (err: any) {
                if (err.status === 404) {
                    console.warn(`⚠️ Collection '${name}' not found. Skipping.`);
                } else {
                    console.error(`❌ Failed to update ${name}:`, err.originalError || err);
                }
            }
        }

        console.log("-----------------------------------------");
        console.log("API Rules Update Completed");
        console.log("-----------------------------------------");

    } catch (err: any) {
        console.error("FATAL ERROR:", err);
    }
}

main();
