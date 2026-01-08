import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');

        const col = await pb.collections.getFirstListItem('name="products"');
        console.log(`\n=== FIELDS FOR: products ===`);
        console.log(JSON.stringify(col.fields, null, 2));

    } catch (err) {
        console.log("Error:", err);
    }
}

main();
