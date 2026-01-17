import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("Updating 'users' collection rules...");

        // Allow any authenticated user to list/view/update users
        // Use "@request.auth.id != ''" to ensure only logged-in users has access
        const rule = "@request.auth.id != ''";

        await pb.collections.update('users', {
            listRule: rule,
            viewRule: rule,
            updateRule: rule,
            // createRule is usually public for signup, likely "" or null for admin-only if self-signup disabled
            // We'll leave createRule as is (null or "")
        });

        console.log("✓ Users rules updated successfully!");

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
