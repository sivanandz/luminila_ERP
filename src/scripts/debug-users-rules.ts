import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        const collection = await pb.collections.getOne('invoices');
        console.log("Invoices Collection Schema:");
        console.log("Fields:", JSON.stringify(collection.fields?.map((f: any) => f.name), null, 2));

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
