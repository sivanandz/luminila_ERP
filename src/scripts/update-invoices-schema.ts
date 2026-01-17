import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("Updating 'invoices' collection schema...");
        const collection = await pb.collections.getOne('invoices');

        const fields = [...(collection.fields || [])];

        const hasInvoiceType = fields.find((f: any) => f.name === 'invoice_type');
        if (!hasInvoiceType) {
            console.log("Adding 'invoice_type' field...");
            fields.push({
                name: "invoice_type",
                type: "text",
                required: false,
                presentable: false,
                unique: false,
                options: {}
            });

            await pb.collections.update('invoices', { fields });
            console.log("✓ Schema updated.");

            // Backfill existing invoices
            console.log("Backfilling existing invoices to 'regular'...");
            const invoices = await pb.collection('invoices').getFullList();

            let count = 0;
            for (const inv of invoices) {
                // Determine type if possible, or default to regular
                // If status is 'draft', maybe proforma? 
                // For now safely default to regular as it satisfies the report query.
                await pb.collection('invoices').update(inv.id, { invoice_type: 'regular' });
                count++;
            }
            console.log(`✓ Backfilled ${count} invoices.`);

        } else {
            console.log("'invoice_type' field already exists.");
        }

    } catch (err: any) {
        console.error("Script Error:", err.message);
        if (err.data) console.log(JSON.stringify(err.data, null, 2));
    }
}

main();
