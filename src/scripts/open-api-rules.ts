/**
 * Set Open API Rules for Development
 * Allows unauthenticated access to collections for testing
 * 
 * WARNING: Only use in development! Set proper rules in production.
 */
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

const OPEN_RULE = ''; // Empty string = allow everyone

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        // Get all collections
        const collections = await pb.collections.getFullList();
        console.log(`Found ${collections.length} collections\n`);

        let updated = 0;

        for (const col of collections) {
            // Skip system collections
            if (col.name.startsWith('_') || col.type === 'auth') {
                console.log(`⊘ ${col.name} - skipped (system/auth)`);
                continue;
            }

            try {
                await pb.collections.update(col.id, {
                    listRule: OPEN_RULE,
                    viewRule: OPEN_RULE,
                    createRule: OPEN_RULE,
                    updateRule: OPEN_RULE,
                    deleteRule: OPEN_RULE,
                });
                console.log(`✓ ${col.name} - opened`);
                updated++;
            } catch (err: any) {
                console.log(`✗ ${col.name} - error: ${err.message}`);
            }
        }

        console.log(`\n✓ Opened ${updated} collections for development`);
        console.log("\n⚠️  WARNING: API rules are now OPEN. Set proper rules for production!");

    } catch (err: any) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

main();
