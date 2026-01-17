import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("Enabling all users (is_active = true)...");
        const users = await pb.collection('users').getFullList();

        let count = 0;
        for (const user of users) {
            // Force update to true
            await pb.collection('users').update(user.id, { is_active: true });
            console.log(`  ✓ Activated: ${user.email} (${user.id})`);
            count++;
        }

        console.log(`\nUpdated ${count} users.`);

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
