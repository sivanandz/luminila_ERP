import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');

        console.log("Creating product...");
        const data = {
            name: "Debug Product",
            sku: "DBG-001",
            base_price: 100,
            stock_quantity: 10
        };

        const record = await pb.collection('products').create(data);
        console.log("✅ Success:", record);

    } catch (err: any) {
        console.error("❌ Failed:");
        if (err.response) {
            console.log(JSON.stringify(err.response, null, 2));
        } else {
            console.log(err);
        }
    }
}

main();
