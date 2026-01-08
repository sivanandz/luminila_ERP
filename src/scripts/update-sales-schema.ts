import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("Logged in!");

        const collection = await pb.collections.getOne('sales');

        console.log("Updating 'sales' collection schema...");

        const currentSchema = Array.isArray(collection.schema) ? collection.schema : [];

        // We need to append new fields to the existing schema
        const newSchema = [
            ...currentSchema,
            { name: 'register_shift_id', type: 'relation', collectionId: 'cash_register_shifts', required: false },
            { name: 'cash_tendered', type: 'number', required: false },
            { name: 'change_given', type: 'number', required: false }
        ];

        await pb.collections.update('sales', {
            schema: newSchema
        });

        console.log("✅ 'sales' collection updated with POS fields.");

    } catch (err: any) {
        console.error("Error updating schema:", err);
    }
}

main();
