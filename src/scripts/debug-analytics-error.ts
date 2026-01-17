import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("\nCreating dummy sale...");
        try {
            const sale = await pb.collection('sales').create({
                channel: 'pos',
                subtotal: 100,
                total: 100,
                status: 'completed',
                payment_method: 'cash',
            });
            console.log("✓ Created sale:", sale.id);
            console.log("Sale created at:", sale.created);

            console.log("\nRunning query: pb.collection('sales').getFullList({ filter: 'created >= \"2000-01-01\"' })");
            try {
                const result = await pb.collection('sales').getFullList({
                    filter: `created >= "2000-01-01"`,
                });
                console.log(`✓ Success! Found ${result.length} items.`);
            } catch (err: any) {
                console.log("✗ FAILED (Filter):", err.message);
            }

            // Cleanup
            await pb.collection('sales').delete(sale.id);

        } catch (err: any) {
            console.log("✗ FAILED (Create):", err.message);
            if (err.response) {
                console.log("Response:", JSON.stringify(err.response, null, 2));
            }
        }

    } catch (err: any) {
        console.error("Script Error:", err.message);
    }
}

main();
