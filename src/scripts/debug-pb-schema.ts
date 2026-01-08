import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');

        const collections = ['products', 'categories', 'product_attributes'];

        for (const name of collections) {
            try {
                const cols = await pb.collections.getFullList({ filter: `name="${name}"` });
                if (cols.length > 0) {
                    const col = cols[0];
                    console.log(`\n=== FIELDS FOR: ${name} ===`);
                    // Log fields
                    console.log(JSON.stringify(col.fields, null, 2));
                }
            } catch (e) {
                console.log(`Error fetching ${name}:`, e);
            }
        }

    } catch (err) {
        console.error(err);
    }
}

main();
