import { pb } from '../src/lib/pocketbase';
import {
    createPurchaseOrder,
    quickCreateInventoryProductForPOItem,
    createGRN,
    getPurchaseOrder,
} from '../src/lib/purchase';

async function runProcuredItemsTest() {
    console.log('===============================================================');
    console.log('TEST: FRESH UNLISTED VENDOR ITEMS IN PURCHASE ORDER WORKFLOW');
    console.log('===============================================================');

    // 1. Authenticate Demo Account
    console.log('\n[1] Authenticating as Demo Account (admin@luminila.local)...');
    await pb.collection('users').authWithPassword('admin@luminila.local', 'Luminila2026!');
    console.log('✓ Authenticated as:', (pb.authStore.model as any)?.email);

    // 2. Ensure or fetch a vendor
    console.log('\n[2] Setting up test vendor...');
    let vendor;
    try {
        vendor = await pb.collection('vendors').getFirstListItem('name = "TEST Sri Meenakshi Jewellers Wholesale"');
    } catch {
        vendor = await pb.collection('vendors').create({
            name: 'TEST Sri Meenakshi Jewellers Wholesale',
            phone: '9876543210',
            email: 'vendor.meenakshi@example.com',
            account_email: 'admin@luminila.local',
        });
    }
    console.log(`✓ Vendor ready: ${vendor.name} (${vendor.id})`);

    // 3. Create a PO with uncataloged/unlisted fresh vendor items
    console.log('\n[3] Creating Purchase Order with 2 FRESH UNLISTED items (no initial inventory SKU)...');
    const po = await createPurchaseOrder({
        vendor_id: vendor.id,
        status: 'sent',
        order_date: new Date().toISOString(),
        expected_date: new Date(Date.now() + 86400000 * 3).toISOString(),
        subtotal: 135000,
        gst_amount: 4050,
        shipping_cost: 0,
        discount_amount: 0,
        total: 139050,
        notes: 'Procurement of newly launched bridal designs not yet in catalog',
        items: [
            {
                description: 'TEST Fresh 22K Peacock Antique Necklace (Uncataloged)',
                hsn_code: '7113',
                quantity_ordered: 2,
                quantity_received: 0,
                unit: 'PCS',
                unit_price: 55000,
                gst_rate: 3,
                gst_amount: 1650,
                total_price: 56650,
                // variant_id is intentionally omitted/undefined
            },
            {
                description: 'TEST Uncut Polki Cocktail Ring Mounts (Uncataloged)',
                hsn_code: '7113',
                quantity_ordered: 5,
                quantity_received: 0,
                unit: 'PCS',
                unit_price: 16000,
                gst_rate: 3,
                gst_amount: 480,
                total_price: 16480,
                // variant_id is intentionally omitted/undefined
            }
        ]
    });
    console.log(`✓ PO created: ${po.po_number} (ID: ${po.id}) with ${po.items.length} uncataloged items`);

    const poRecord = await getPurchaseOrder(po.id!);
    if (!poRecord) throw new Error('Failed to retrieve created PO');
    const uncatalogedItems = poRecord.items.filter(i => !i.variant_id);
    console.log(`✓ Verified uncataloged items in PO: ${uncatalogedItems.length} items without SKU`);
    if (uncatalogedItems.length !== 2) {
        throw new Error(`Expected 2 uncataloged items, got ${uncatalogedItems.length}`);
    }

    // 4. Test on-the-fly registration of uncataloged item into inventory
    console.log('\n[4] Cataloging unlisted item #1 on-the-fly with jewelry specifications...');
    const itemToRegister = poRecord.items[0];
    const registered = await quickCreateInventoryProductForPOItem(itemToRegister.id, {
        name: 'TEST 22K Peacock Antique Bridal Necklace',
        category: 'Necklaces',
        cost_price: 55000,
        base_price: 76000,
        hsn_code: '7113',
        material: 'Gold',
        purity_karat: '22K (916 Hallmark)',
        gross_weight: 42.5,
        net_weight: 39.8,
        making_charges: 850,
        location: 'Showcase Tray B',
    });
    console.log(`✓ Product created in inventory: ${registered.name}`);
    console.log(`  SKU: ${registered.sku} | Variant ID: ${registered.variantId}`);
    console.log(`  Cost: ₹${registered.costPrice} | Retail: ₹${registered.basePrice}`);

    // Verify PO item is now linked to the newly generated variant
    const updatedPo = await getPurchaseOrder(po.id!);
    const linkedItem = updatedPo?.items.find(i => i.id === itemToRegister.id);
    console.log(`✓ PO Item updated with linked variant: ${linkedItem?.variant_id === registered.variantId ? 'YES' : 'NO'}`);
    if (linkedItem?.variant_id !== registered.variantId) {
        throw new Error('PO item failed to link to newly created product variant');
    }

    // 5. Test Taking Delivery (GRN) on this PO
    console.log('\n[5] Taking Delivery & Receiving Goods (GRN)...');
    const grn = await createGRN({
        po_id: po.id!,
        vendor_id: vendor.id,
        received_date: new Date().toISOString(),
        received_by: 'Store Manager',
        notes: 'Received fresh items from vendor in pristine condition',
        items: [
            {
                po_item_id: itemToRegister.id,
                variant_id: registered.variantId,
                quantity_received: 2,
                quantity_rejected: 0,
            }
        ]
    });
    console.log(`✓ GRN generated: ${grn.grn_number} (ID: ${grn.id})`);

    // Verify inventory stock incremented
    const variantRecord = await pb.collection('product_variants').getOne(registered.variantId);
    console.log(`✓ Variant stock level after GRN intake: ${variantRecord.stock_level} (Expected: 2)`);
    if (variantRecord.stock_level !== 2) {
        throw new Error(`Stock level mismatch! Expected 2, got ${variantRecord.stock_level}`);
    }

    // Verify stock movement log
    const movements = await pb.collection('stock_movements').getFullList({
        filter: `variant = "${registered.variantId}"`,
    });
    console.log(`✓ Logged stock movement count: ${movements.length}`);
    if (movements.length === 0 || movements[0].quantity !== 2) {
        throw new Error('Stock movement was not logged accurately');
    }
    console.log(`  Movement notes: "${movements[0].notes}"`);

    // 6. Cleanup
    console.log('\n[6] Cleaning up test records...');
    for (const m of movements) await pb.collection('stock_movements').delete(m.id).catch(() => {});
    const grnItems = await pb.collection('grn_items').getFullList({ filter: `grn = "${grn.id}"` });
    for (const gi of grnItems) await pb.collection('grn_items').delete(gi.id).catch(() => {});
    await pb.collection('goods_received_notes').delete(grn.id!).catch(() => {});

    for (const item of poRecord.items) {
        await pb.collection('purchase_order_items').delete(item.id!).catch(() => {});
    }
    await pb.collection('purchase_orders').delete(po.id!).catch(() => {});
    await pb.collection('product_variants').delete(registered.variantId).catch(() => {});
    await pb.collection('products').delete(registered.productId).catch(() => {});
    await pb.collection('vendors').delete(vendor.id).catch(() => {});
    console.log('✓ Cleanup completed.');

    console.log('\n===============================================================');
    console.log('✅ ALL UNLISTED / FRESH VENDOR ITEM PO WORKFLOWS VERIFIED!');
    console.log('===============================================================');
}

runProcuredItemsTest().catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
});
