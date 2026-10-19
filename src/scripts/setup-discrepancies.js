const PocketBase = require('pocketbase/cjs');
const pb = new PocketBase('http://127.0.0.1:8091');
pb.autoCancellation(false);

async function setupDiscrepancies() {
    await pb.collection('_superusers').authWithPassword('admin@luminila.local', 'Luminila2026!');
    console.log('Superuser authenticated');

    const productsColl = await pb.collections.getOne('products');
    const variantsColl = await pb.collections.getOne('product_variants');

    const existing = await pb.collections.getOne('stock_discrepancies').catch(() => null);
    if (existing) {
        console.log('stock_discrepancies collection already exists! ID:', existing.id);
        return;
    }

    const coll = await pb.collections.create({
        name: 'stock_discrepancies',
        type: 'base',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        fields: [
            { name: 'product', type: 'relation', collectionId: productsColl.id, cascadeDelete: false, maxSelect: 1 },
            { name: 'variant', type: 'relation', collectionId: variantsColl.id, cascadeDelete: false, maxSelect: 1 },
            { name: 'sku', type: 'text', required: true },
            { name: 'product_name', type: 'text', required: true },
            { name: 'discrepancy_type', type: 'select', values: ['damaged', 'missing', 'vendor_replacement'], required: true, maxSelect: 1 },
            { name: 'quantity', type: 'number', required: true, min: 1 },
            { name: 'vendor_name', type: 'text' },
            { name: 'reason', type: 'text' },
            { name: 'notes', type: 'text' },
            { name: 'status', type: 'select', values: ['active', 'resolved'], required: true, maxSelect: 1 },
            { name: 'flagged_by', type: 'text' },
            { name: 'resolved_by', type: 'text' },
            { name: 'resolved_at', type: 'text' },
            { name: 'resolution_action', type: 'text' },
            { name: 'resolution_note', type: 'text' }
        ]
    });
    console.log('Successfully created stock_discrepancies collection:', coll.id);
}

setupDiscrepancies().catch(e => {
    console.error('Failed to setup discrepancies:', e.message, e.data);
    process.exit(1);
});
