import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8091';

async function main() {
    console.log(`Connecting to ${PB_URL}...`);
    const pb = new PocketBase(PB_URL);
    const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
    const adminPass = process.env.PB_ADMIN_PASSWORD || 'password123456';
    try {
        await pb.collection('_superusers').authWithPassword(adminEmail, adminPass);
        console.log('Superuser authenticated');
    } catch {
        await (pb as any).admins.authWithPassword(adminEmail, adminPass);
        console.log('Admin authenticated');
    }

    const collections = [
        'invoices',
        'purchase_orders',
        'goods_received_notes',
        'credit_notes',
        'delivery_challans',
        'expenses',
        'number_sequences',
        'activity_logs'
    ];

    for (const c of collections) {
        try {
            const col = await pb.collections.getOne(c);
            console.log(`[${c}] indexes:`, col.indexes);
            console.log(`[${c}] fields:`, col.fields.map((f: any) => `${f.name} (${f.type})`).join(', '));
        } catch (e: any) {
            console.log(`[${c}] ERROR:`, e.message);
        }
    }
}

main().catch(console.error);
