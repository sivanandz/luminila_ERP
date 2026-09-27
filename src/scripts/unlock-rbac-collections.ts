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

        console.log("Updating RBAC collection rules...");

        // Allow any authenticated user to manage roles and user_roles
        // This is necessary because 'Admin' role users are just authenticated users in PB
        // Ideally we would check for role='Admin' but that requires complex rules.
        const rule = "@request.auth.id != ''";

        await pb.collections.update('roles', {
            listRule: rule,
            viewRule: rule,
            createRule: rule,
            updateRule: rule,
            deleteRule: rule,
        });

        await pb.collections.update('user_roles', {
            listRule: rule,
            viewRule: rule,
            createRule: rule,
            updateRule: rule,
            deleteRule: rule,
        });

        console.log("✓ RBAC rules updated successfully!");

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
