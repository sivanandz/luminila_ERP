import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("Fetching 'sales' collection...");
        const collection = await pb.collections.getOne('sales');

        // precise definition of system fields in PB v0.23+
        const createdField = {
            "name": "created",
            "type": "autodate",
            "system": true,
            "onCreate": true,
            "onUpdate": false,
            "hidden": false
        };
        const updatedField = {
            "name": "updated",
            "type": "autodate",
            "system": true,
            "onCreate": true,
            "onUpdate": true,
            "hidden": false
        };

        // Check if allow present
        const hasCreated = collection.fields?.find((f: any) => f.name === 'created');
        const hasUpdated = collection.fields?.find((f: any) => f.name === 'updated');

        if (hasCreated && hasUpdated) {
            console.log("✓ System fields already exist in schema.");
            return;
        }

        console.log("Restoring system fields...");
        const newFields = [...(collection.fields || [])];

        if (!hasCreated) newFields.push(createdField);
        if (!hasUpdated) newFields.push(updatedField);

        await pb.collections.update('sales', {
            fields: newFields
        });

        console.log("✓ System fields restored!");

    } catch (err: any) {
        console.error("Script Error:", err.message);
        if (err.data) console.log(JSON.stringify(err.data, null, 2));
    }
}

main();
