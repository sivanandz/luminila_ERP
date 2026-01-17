import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("Fetching 'sales' collection...");
        try {
            const collection = await pb.collections.getOne('sales');
            console.log("\nRAW Collection JSON:");
            console.log(JSON.stringify(collection, null, 2));

        } catch (err: any) {
            console.log("Could not fetch collection:", err.message);
        }

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
