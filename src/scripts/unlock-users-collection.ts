import PocketBase from 'pocketbase';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.PB_URL || 'http://127.0.0.1:8090';
const pb = new PocketBase(PB_URL);

async function main() {
    try {
        console.log(`Connecting to PocketBase at ${PB_URL}...`);
        console.log("Authenticating as Admin...");
        const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
        const adminPass = process.env.PB_ADMIN_PASS || 'password123456';
        await pb.admins.authWithPassword(adminEmail, adminPass);
        console.log("✓ Logged in!\n");

        console.log("Updating 'users' collection rules...");

        // Allow any authenticated user to list/view/update users
        // Use "@request.auth.id != ''" to ensure only logged-in users has access
        const rule = "@request.auth.id != ''";

        await pb.collections.update('users', {
            listRule: rule,
            viewRule: rule,
            updateRule: rule,
            createRule: "", // Public self-registration allowed
        });

        console.log("✓ Users rules updated successfully!");

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
