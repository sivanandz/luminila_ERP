import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("Logged in!");

        const createCollection = async (data: any) => {
            try {
                try {
                    await pb.collections.getFirstListItem(`name="${data.name}"`);
                    console.log(`Collection ${data.name} already exists. Skipping.`);
                    return;
                } catch (e) { }

                console.log(`Creating collection: ${data.name}...`);
                await pb.collections.create(data);
                console.log(`✅ ${data.name} created.`);
            } catch (err: any) {
                console.error(`❌ Failed to create ${data.name}:`, err.originalError || err);
            }
        };

        // --- 1. Sales Orders (B2B/Estimates) ---
        await createCollection({
            name: 'sales_orders',
            type: 'base',
            schema: [
                { name: 'order_type', type: 'select', options: { values: ['estimate', 'sales_order'] }, required: true },
                { name: 'customer', type: 'relation', collectionId: 'customers', required: false },
                { name: 'customer_name', type: 'text', required: true },
                { name: 'customer_phone', type: 'text', required: false },
                { name: 'customer_email', type: 'text', required: false },
                { name: 'billing_address', type: 'text', required: false },
                { name: 'shipping_address', type: 'text', required: false },
                { name: 'order_date', type: 'date', required: true },
                { name: 'valid_until', type: 'date', required: false },
                { name: 'expected_delivery_date', type: 'date', required: false },
                { name: 'status', type: 'select', options: { values: ['draft', 'sent', 'confirmed', 'shipped', 'delivered', 'cancelled', 'invoiced'] }, required: true },
                { name: 'notes', type: 'text', required: false },
                { name: 'internal_notes', type: 'text', required: false },
                { name: 'subtotal', type: 'number', required: true },
                { name: 'tax_total', type: 'number', required: false },
                { name: 'discount_total', type: 'number', required: false },
                { name: 'shipping_charges', type: 'number', required: false },
                { name: 'total', type: 'number', required: true },
                { name: 'order_number', type: 'text', required: false } // Should Auto-gen? PB id is confusing. Maybe manual trigger logic or just use ID. Use text for now.
            ]
        });

        // --- 2. Sales Order Items ---
        await createCollection({
            name: 'sales_order_items',
            type: 'base',
            schema: [
                { name: 'order', type: 'relation', collectionId: 'sales_orders', cascadeDelete: true, required: true },
                { name: 'product', type: 'relation', collectionId: 'products', required: true },
                { name: 'variant', type: 'relation', collectionId: 'product_variants', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'quantity', type: 'number', required: true },
                { name: 'unit_price', type: 'number', required: true },
                { name: 'tax_rate', type: 'number', required: false },
                { name: 'discount_amount', type: 'number', required: false },
                { name: 'total', type: 'number', required: true }
            ]
        });

        console.log("-----------------------------------------");
        console.log("B2B Sales Schema Update Completed");
        console.log("-----------------------------------------");

    } catch (err: any) {
        console.error("FATAL ERROR during migration:", err);
    }
}

main();
