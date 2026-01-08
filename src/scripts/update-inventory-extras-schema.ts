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

        // --- 1. Categories ---
        await createCollection({
            name: 'categories',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'slug', type: 'text', required: false },
                { name: 'description', type: 'text', required: false },
                { name: 'parent', type: 'relation', collectionId: 'categories', required: false },
                { name: 'sort_order', type: 'number', required: false },
                { name: 'icon', type: 'text', required: false },
                { name: 'color', type: 'text', required: false },
                { name: 'is_active', type: 'bool', required: false }
            ]
        });

        // --- 2. Product Attributes ---
        await createCollection({
            name: 'product_attributes',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'slug', type: 'text', required: false },
                { name: 'attribute_type', type: 'select', options: { values: ['text', 'select', 'number', 'boolean', 'date'] }, required: true },
                { name: 'options', type: 'json', required: false },
                { name: 'default_value', type: 'text', required: false },
                { name: 'is_required', type: 'bool', required: false },
                { name: 'is_filterable', type: 'bool', required: false },
                { name: 'is_visible_on_product', type: 'bool', required: false },
                { name: 'sort_order', type: 'number', required: false }
            ]
        });

        // --- 3. Product Attribute Values ---
        await createCollection({
            name: 'product_attribute_values',
            type: 'base',
            schema: [
                { name: 'product', type: 'relation', collectionId: 'products', cascadeDelete: true, required: true },
                { name: 'attribute', type: 'relation', collectionId: 'product_attributes', required: true },
                { name: 'value', type: 'text', required: true }
            ]
        });

        console.log("-----------------------------------------");
        console.log("Inventory Extras Schema Update Completed");
        console.log("-----------------------------------------");

    } catch (err: any) {
        console.error("FATAL ERROR during migration:", err);
    }
}

main();
