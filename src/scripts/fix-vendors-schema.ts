/**
 * Add missing fields to vendors collection
 */
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        // Get vendors collection
        const collection = await pb.collections.getOne('vendors');
        console.log("Current vendors fields:", collection.schema.map((f: any) => f.name));

        // Add missing fields
        const newFields = [
            { name: 'pan', type: 'text', required: false },
            { name: 'payment_terms', type: 'text', required: false },
            { name: 'notes', type: 'text', required: false },
        ];

        // Filter out fields that already exist
        const existingNames = collection.schema.map((f: any) => f.name);
        const fieldsToAdd = newFields.filter(f => !existingNames.includes(f.name));

        if (fieldsToAdd.length === 0) {
            console.log("All fields already exist!");
            return;
        }

        console.log("Adding fields:", fieldsToAdd.map(f => f.name));

        await pb.collections.update(collection.id, {
            schema: [...collection.schema, ...fieldsToAdd]
        });

        console.log("✓ Vendors collection updated!");

    } catch (err: any) {
        console.error("Error:", err.message);
        if (err.response) console.log(JSON.stringify(err.response, null, 2));
        process.exit(1);
    }
}

main();
