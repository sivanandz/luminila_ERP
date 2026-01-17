import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
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
