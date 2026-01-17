import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        const collection = await pb.collections.getOne('expenses');
        console.log("Expenses Collection Schema:");
        console.log("Fields:", JSON.stringify(collection.fields, null, 2));

    } catch (err: any) {
        console.error("Script Error:", err.message);
        if (err.data) console.log(JSON.stringify(err.data, null, 2));
    }
}

main();
