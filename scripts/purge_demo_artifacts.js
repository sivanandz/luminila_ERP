const PocketBase = require('E:/Local_GIT_2/luminila_inv_mgmt/node_modules/pocketbase/dist/pocketbase.cjs.js');
const pb = new PocketBase('http://127.0.0.1:8091');

async function purgeDemoArtifacts() {
  await pb.admins.authWithPassword('admin@luminila.local', 'Luminila2026!');
  console.log('Superuser authenticated for demo artifact purge.');

  // 1. Purge legacy demo discrepancies
  const discrepancies = await pb.collection('stock_discrepancies').getFullList();
  for (const d of discrepancies) {
    if (!d.account_email || d.notes?.includes('test') || d.product_name?.includes('Test') || d.sku?.includes('NECK-22K') || d.sku?.includes('Kundan')) {
      await pb.collection('stock_discrepancies').delete(d.id).catch(() => {});
      console.log(`Purged demo discrepancy: ${d.id}`);
    }
  }

  // 2. Purge test products & variants and their referencing records
  const products = await pb.collection('products').getFullList();
  for (const p of products) {
    if (!p.account_email || p.sku?.startsWith('TEST-') || p.sku?.startsWith('DISC-TEST')) {
      const variants = await pb.collection('product_variants').getFullList({ filter: `product = "${p.id}"` });
      for (const v of variants) {
        // Delete referencing stock_movements
        const movements = await pb.collection('stock_movements').getFullList({ filter: `variant = "${v.id}"` }).catch(() => []);
        for (const m of movements) {
          await pb.collection('stock_movements').delete(m.id).catch(() => {});
        }
        // Delete referencing sale_items
        const saleItems = await pb.collection('sale_items').getFullList({ filter: `variant = "${v.id}"` }).catch(() => []);
        for (const si of saleItems) {
          await pb.collection('sale_items').delete(si.id).catch(() => {});
        }
        // Delete referencing sales_order_items
        const soItems = await pb.collection('sales_order_items').getFullList({ filter: `variant = "${v.id}"` }).catch(() => []);
        for (const soi of soItems) {
          await pb.collection('sales_order_items').delete(soi.id).catch(() => {});
        }
        await pb.collection('product_variants').delete(v.id).catch(e => console.warn(`Variant delete error:`, e.message));
        console.log(`Purged variant: ${v.id}`);
      }
      await pb.collection('products').delete(p.id).catch(e => console.warn(`Product delete error:`, e.message));
      console.log(`Purged product: ${p.id} (${p.sku})`);
    }
  }

  console.log('Demo artifact purge completed successfully.');
}

purgeDemoArtifacts().catch(err => {
  console.error('Purge error:', err);
  process.exit(1);
});
