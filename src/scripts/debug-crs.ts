import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');

        const OPEN_RULE = '@request.auth.id != ""';

        // delete if exists
        try {
            const ex = await pb.collections.getFirstListItem('name="cash_register_shifts"');
            await pb.collections.delete(ex.id);
        } catch { }

        // Get users ID
        const users = await pb.collections.getFirstListItem('name="users"');
        const usersId = users.id; // Usually _pb_users_auth_

        const data = {
            name: 'cash_register_shifts',
            type: 'base',
            fields: [
                { name: 'user', type: 'relation', collectionId: usersId, required: true },
                { name: 'terminal_id', type: 'text', required: false },
                { name: 'opened_at', type: 'date', required: true },
                { name: 'closed_at', type: 'date', required: false },
                { name: 'opening_balance', type: 'number', required: true },
                { name: 'closing_balance', type: 'number', required: false },
                { name: 'expected_balance', type: 'number', required: false },
                { name: 'total_cash_sales', type: 'number', required: false },
                { name: 'total_card_sales', type: 'number', required: false },
                { name: 'total_upi_sales', type: 'number', required: false },
                { name: 'total_cash_refunds', type: 'number', required: false },
                { name: 'cash_added', type: 'number', required: false },
                { name: 'cash_removed', type: 'number', required: false },
                { name: 'variance', type: 'number', required: false },
                { name: 'variance_notes', type: 'text', required: false },
                { name: 'status', type: 'select', maxSelect: 1, values: ['open', 'closed', 'suspended'], required: true },
                { name: 'notes', type: 'text', required: false }
            ],
            listRule: OPEN_RULE,
            viewRule: OPEN_RULE,
            createRule: OPEN_RULE,
            updateRule: OPEN_RULE,
            deleteRule: OPEN_RULE
        };

        console.log("Creating cash_register_shifts...");
        await pb.collections.create(data);
        console.log("✅ Success");

    } catch (err: any) {
        console.error("❌ Failed:");
        if (err.response) console.log(JSON.stringify(err.response, null, 2));
        else console.log(err);
    }
}

main();
