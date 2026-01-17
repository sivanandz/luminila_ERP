import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// precise definition of system fields in PB v0.26+
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

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("Fetching all collections...");
        const collections = await pb.collections.getFullList();
        console.log(`Found ${collections.length} collections.\n`);

        let updatedCount = 0;

        for (const col of collections) {
            // Skip system collections that start with _ or are auth type (auth might need it too? actually auth usually has them)
            // But let's check ALL base/auth collections.
            if (col.name.startsWith('_')) continue;

            // Check if fields exist
            const hasCreated = col.fields?.find((f: any) => f.name === 'created');
            const hasUpdated = col.fields?.find((f: any) => f.name === 'updated');

            if (hasCreated && hasUpdated) {
                console.log(`✓ ${col.name} - OK`);
                continue;
            }

            console.log(`Restoring fields for: ${col.name}...`);
            try {
                const newFields = [...(col.fields || [])];

                if (!hasCreated) newFields.push(createdField);
                if (!hasUpdated) newFields.push(updatedField);

                await pb.collections.update(col.id, {
                    fields: newFields
                });
                console.log(`  ✓ Updated ${col.name}`);
                updatedCount++;
            } catch (err: any) {
                console.log(`  ✗ Failed to update ${col.name}: ${err.message}`);
                // Try again without 'system' flag in case older PB version
                // But we assume newer PB since 'fields' is used.
            }
        }

        console.log(`\nrestore complete! Updated ${updatedCount} collections.`);

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
