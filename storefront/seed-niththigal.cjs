/** Seed the Niththigal example catalogue for admin@luminila.local (idempotent). */
const PocketBase = require('pocketbase/cjs');

(async () => {
    const pb = new PocketBase('http://127.0.0.1:8091');
    await pb.collection('_superusers').authWithPassword('admin@luminila.local', 'Luminila2026!');

    // remove leftover invariant fixtures
    const stale = await pb.collection('products').getFullList({
        filter: pb.filter('sku ~ {:s}', { s: 'E2EINV' }),
    });
    for (const p of stale) {
        const vs = await pb.collection('product_variants').getFullList({
            filter: pb.filter('product = {:p}', { p: p.id }),
        });
        for (const v of vs) await pb.collection('product_variants').delete(v.id).catch(() => {});
        await pb.collection('products').delete(p.id).catch(() => {});
    }
    const staleCraft = await pb.collection('products').getFirstListItem('sku = "E2ECRAFT00001"').catch(() => null);
    if (staleCraft) {
        const vs = await pb.collection('product_variants').getFullList({
            filter: pb.filter('product = {:p}', { p: staleCraft.id }),
        });
        for (const v of vs) await pb.collection('product_variants').delete(v.id).catch(() => {});
        await pb.collection('products').delete(staleCraft.id).catch(() => {});
    }
    console.log('fixtures removed');

    const demo = [
        {
            sku: 'KND-JHU-MALAR', name: 'Malar Temple Jhumkas', categoryName: 'Earrings',
            base_price: 899, cost_price: 380, image_data: '/niththigal/jhumka.webp',
            description: 'An ode to the jhumkas you grew up admiring. Intricate gold-tone florals, ruby-coloured accents and a delicate pearl-style fringe bring a little ceremony to your everyday.',
            craft: 'kundan', plating: 'micro_gold_1gm', occasion: 'bridal', base_metal: 'brass', hsn_code: '71179010',
            sizes: [['Standard', 8]],
        },
        {
            sku: 'TMP-NCK-LAKSHMI', name: 'Lakshmi Temple Necklace', categoryName: 'Necklaces',
            base_price: 1899, cost_price: 760, image_data: '/niththigal/necklace.webp',
            description: 'A heritage-inspired silhouette with little coin motifs, a sculptural Lakshmi pendant and soft pearl-style drops. Pair it with your favourite silk saree, or let it make a simple neckline feel extraordinary.',
            craft: 'temple', plating: 'micro_gold_1gm', occasion: 'festive', base_metal: 'brass', hsn_code: '71179010',
            sizes: [['Standard', 6]],
        },
        {
            sku: 'BGL-NILA-HERITAGE', name: 'Nila Heritage Bangles', categoryName: 'Bangles',
            base_price: 1299, cost_price: 520, image_data: '/niththigal/bangles.webp',
            description: 'A richly detailed pair of gold-tone bangles with ruby- and emerald-coloured accents. Wear them together for a little festive magic, or one at a time for your own everyday ritual.',
            craft: 'kundan', plating: 'micro_gold_1gm', occasion: 'festive', base_metal: 'brass', hsn_code: '71179010',
            sizes: [['2.4', 4], ['2.6', 4], ['2.8', 3]],
        },
    ];

    for (const d of demo) {
        const exists = await pb.collection('products').getFirstListItem(pb.filter('sku = {:sku}', { sku: d.sku })).catch(() => null);
        if (exists) { console.log('exists:', d.name); continue; }

        // resolve the category relation id by name (create the record if new)
        let categoryId = '';
        const cat = await pb.collection('categories').getFirstListItem(pb.filter('name = {:n}', { n: d.categoryName })).catch(() => null);
        if (cat) {
            categoryId = cat.id;
        } else {
            const created = await pb.collection('categories').create({
                name: d.categoryName,
                slug: d.categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                is_active: true,
            }).catch(() => null);
            if (created) categoryId = created.id;
        }

        const p = await pb.collection('products').create({
            sku: d.sku,
            name: d.name,
            category: categoryId || undefined,
            base_price: d.base_price,
            cost_price: d.cost_price,
            image_data: d.image_data, // local asset path; the catalog route serves it as-is
            description: d.description,
            craft: d.craft,
            plating: d.plating,
            occasion: d.occasion,
            base_metal: d.base_metal,
            hsn_code: d.hsn_code,
            is_active: true,
            account_email: 'admin@luminila.local',
            channel_prices: { website: d.base_price },
        });
        for (const [label, stock] of d.sizes) {
            await pb.collection('product_variants').create({
                product: p.id, variant_name: label, stock_level: stock, low_stock_threshold: 2, price_adjustment: 0,
            });
        }
        console.log('seeded:', d.name);
    }

    const final = await pb.collection('products').getFullList({
        filter: pb.filter('account_email = {:t} && is_active = true', { t: 'admin@luminila.local' }),
        fields: 'sku,name',
    });
    console.log('final count:', final.length, '|', final.map((r) => r.sku).join(', '));
})().catch((e) => { console.error('ERR:', JSON.stringify(e.response?.data || e.message).slice(0, 300)); process.exit(1); });
