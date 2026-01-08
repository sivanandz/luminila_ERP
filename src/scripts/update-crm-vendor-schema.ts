import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("Logged in!");

        // Helper to create collection if not exists
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

        // --- 1. Customer Interactions ---
        await createCollection({
            name: 'customer_interactions',
            type: 'base',
            schema: [
                { name: 'customer', type: 'relation', collectionId: 'customers', required: true },
                { name: 'interaction_type', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'sale', type: 'relation', collectionId: 'sales', required: false },
                { name: 'order_id', type: 'text', required: false }, // Use text for generic ID or future relation
                { name: 'created_by', type: 'text', required: false }
            ]
        });

        // --- 2. Vendor Products ---
        await createCollection({
            name: 'vendor_products',
            type: 'base',
            schema: [
                { name: 'vendor', type: 'relation', collectionId: 'vendors', required: true },
                { name: 'variant', type: 'relation', collectionId: 'product_variants', required: true },
                { name: 'vendor_sku', type: 'text', required: false },
                { name: 'vendor_price', type: 'number', required: false },
                { name: 'lead_time_days', type: 'number', required: false }
            ]
        });

        // --- 3. Purchase Orders ---
        await createCollection({
            name: 'purchase_orders',
            type: 'base',
            schema: [
                { name: 'po_number', type: 'text', required: false },
                { name: 'vendor', type: 'relation', collectionId: 'vendors', required: true },
                { name: 'status', type: 'select', options: { values: ['draft', 'sent', 'partial', 'received', 'cancelled'] }, required: true },
                { name: 'order_date', type: 'date', required: true },
                { name: 'expected_date', type: 'date', required: false },
                { name: 'subtotal', type: 'number', required: false },
                { name: 'gst_amount', type: 'number', required: false },
                { name: 'shipping_cost', type: 'number', required: false },
                { name: 'discount_amount', type: 'number', required: false },
                { name: 'total', type: 'number', required: false },
                { name: 'shipping_address', type: 'text', required: false },
                { name: 'notes', type: 'text', required: false }
            ]
        });

        // --- 4. Purchase Order Items ---
        await createCollection({
            name: 'purchase_order_items',
            type: 'base',
            schema: [
                { name: 'po', type: 'relation', collectionId: 'purchase_orders', cascadeDelete: true, required: true },
                { name: 'variant', type: 'relation', collectionId: 'product_variants', required: false },
                { name: 'description', type: 'text', required: false },
                { name: 'hsn_code', type: 'text', required: false },
                { name: 'quantity_ordered', type: 'number', required: true },
                { name: 'quantity_received', type: 'number', required: false },
                { name: 'unit', type: 'text', required: false },
                { name: 'unit_price', type: 'number', required: true },
                { name: 'gst_rate', type: 'number', required: false },
                { name: 'gst_amount', type: 'number', required: false },
                { name: 'total_price', type: 'number', required: true }
            ]
        });

        // --- 5. Goods Received Notes (GRN) ---
        await createCollection({
            name: 'goods_received_notes',
            type: 'base',
            schema: [
                { name: 'grn_number', type: 'text', required: false },
                { name: 'po', type: 'relation', collectionId: 'purchase_orders', required: false },
                { name: 'vendor', type: 'relation', collectionId: 'vendors', required: false },
                { name: 'received_date', type: 'date', required: true },
                { name: 'received_by', type: 'text', required: false },
                { name: 'notes', type: 'text', required: false }
            ]
        });

        // --- 6. GRN Items ---
        await createCollection({
            name: 'grn_items',
            type: 'base',
            schema: [
                { name: 'grn', type: 'relation', collectionId: 'goods_received_notes', cascadeDelete: true, required: true },
                { name: 'po_item', type: 'relation', collectionId: 'purchase_order_items', required: false },
                { name: 'variant', type: 'relation', collectionId: 'product_variants', required: false },
                { name: 'quantity_received', type: 'number', required: true },
                { name: 'quantity_rejected', type: 'number', required: false },
                { name: 'rejection_reason', type: 'text', required: false }
            ]
        });

        console.log("-----------------------------------------");
        console.log("CRM & Vendor Schema Update Completed");
        console.log("-----------------------------------------");

    } catch (err: any) {
        console.error("FATAL ERROR during migration:", err);
    }
}

main();
