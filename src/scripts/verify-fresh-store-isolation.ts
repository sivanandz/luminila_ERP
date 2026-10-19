import PocketBase from 'pocketbase';
import assert from 'assert';
import {
    getDashboardStats,
    getSalesTrend,
    getTopProducts,
    getChannelBreakdown,
    getRecentActivity,
} from '../lib/analytics';
import { loadConfiguredChannels } from '../lib/channel-pricing';
import { pb } from '../lib/pocketbase';

async function verifyIsolation() {
    console.log('=== MULTI-TENANT FRESH STORE ISOLATION VERIFICATION ===\n');

    // 1. Setup Admin to create fresh test tenant user
    const pbAdmin = new PocketBase('http://127.0.0.1:8091');
    await pbAdmin.admins.authWithPassword('admin@luminila.local', 'Luminila2026!');

    const freshEmail = `fresh_store_${Date.now()}@luminilatest.local`;
    const password = 'TestTenantPass123!';

    const createdUser = await pbAdmin.collection('users').create({
        email: freshEmail,
        password: password,
        passwordConfirm: password,
        name: 'Fresh Store Owner',
        emailVisibility: true,
        verified: true,
        is_active: true,
    });
    console.log(`[PASS] Created test tenant user: ${freshEmail} (${createdUser.id})`);

    // 2. Authenticate the global application PocketBase instance as this fresh tenant
    pb.authStore.clear();
    await pb.collection('users').authWithPassword(freshEmail, password);
    console.log(`[PASS] Authenticated client pb as: ${pb.authStore.model?.email}`);

    // 3. Test Dashboard Stats
    const stats = await getDashboardStats();
    console.log('\n--- Dashboard Stats for Fresh Store ---');
    console.log(`Total Products:  ${stats.totalProducts}`);
    console.log(`Low Stock Count: ${stats.lowStockCount}`);
    console.log(`Total Orders:    ${stats.totalOrders}`);
    console.log(`Total Revenue:   ${stats.totalRevenue}`);
    console.log(`Pending Orders:  ${stats.pendingOrders}`);

    assert.strictEqual(stats.totalProducts, 0, 'Fresh store MUST see 0 total products (no cross-tenant leakage)');
    assert.strictEqual(stats.lowStockCount, 0, 'Fresh store MUST see 0 low stock items (the 1 low stock item leak is FIXED)');
    assert.strictEqual(stats.totalOrders, 0, 'Fresh store MUST see 0 orders');
    assert.strictEqual(stats.totalRevenue, 0, 'Fresh store MUST see 0 revenue');
    assert.strictEqual(stats.pendingOrders, 0, 'Fresh store MUST see 0 pending orders');
    console.log('>>> [VERIFIED] Dashboard Stats are completely isolated (0 leak)!');

    // 4. Test Channel Breakdown
    const channels = await getChannelBreakdown();
    console.log(`\nChannel Breakdown count: ${channels.length}`);
    assert.strictEqual(channels.length, 0, 'Fresh store MUST see 0 channel breakdown orders/revenue');
    console.log('>>> [VERIFIED] Channel Breakdown is completely isolated (0 leak)!');

    // 5. Test Top Products
    const topProducts = await getTopProducts();
    console.log(`Top Products count: ${topProducts.length}`);
    assert.strictEqual(topProducts.length, 0, 'Fresh store MUST see 0 top products');
    console.log('>>> [VERIFIED] Top Products is completely isolated (0 leak)!');

    // 6. Test Recent Activity
    const activities = await getRecentActivity();
    console.log(`Recent Activities count: ${activities.length}`);
    assert.strictEqual(activities.length, 0, 'Fresh store MUST see 0 recent activities');
    console.log('>>> [VERIFIED] Recent Activity is completely isolated (0 leak)!');

    // 7. Test Configured Channels
    const configuredChannels = await loadConfiguredChannels();
    console.log(`Configured channels count: ${configuredChannels.length}`);
    const customChannels = configuredChannels.filter(c => c.isCustom);
    assert.strictEqual(customChannels.length, 0, 'Fresh store MUST have 0 custom channels from other stores');
    console.log('>>> [VERIFIED] Configured Channels has 0 leaked custom channels!');

    // 8. Test Direct PocketBase API Access for Other Tenant Data
    const directVariants = await pb.collection('product_variants').getList(1, 10);
    assert.strictEqual(directVariants.totalItems, 0, 'Fresh tenant cannot list any product variants from other tenants');

    const directProducts = await pb.collection('products').getList(1, 10);
    assert.strictEqual(directProducts.totalItems, 0, 'Fresh tenant cannot list any products from other tenants');

    const directCategories = await pb.collection('categories').getList(1, 10);
    assert.strictEqual(directCategories.totalItems, 0, 'Fresh tenant cannot list categories from other tenants');

    const directSequences = await pb.collection('number_sequences').getList(1, 10);
    assert.strictEqual(directSequences.totalItems, 0, 'Fresh tenant cannot list number sequences from other tenants');

    console.log('>>> [VERIFIED] Direct PocketBase collection queries are strictly isolated!');

    // 9. Unauthenticated Access Test (PocketBase filters result set to 0 items when rule condition evaluates to false)
    pb.authStore.clear();
    const unauthVariants = await pb.collection('product_variants').getList(1, 10);
    assert.strictEqual(unauthVariants.totalItems, 0, 'Unauthenticated users MUST see 0 product variants');

    const unauthProducts = await pb.collection('products').getList(1, 10);
    assert.strictEqual(unauthProducts.totalItems, 0, 'Unauthenticated users MUST see 0 products');

    let unauthGetOneBlocked = false;
    try {
        await pb.collection('products').getOne('4m37536304ca5q1');
    } catch {
        unauthGetOneBlocked = true;
    }
    assert.ok(unauthGetOneBlocked, 'Unauthenticated direct getOne must be blocked with 404/403');
    console.log('>>> [VERIFIED] Unauthenticated requests return 0 items and direct getOne is blocked!');

    // Cleanup test user
    await pbAdmin.collection('users').delete(createdUser.id);
    console.log(`\n[PASS] Cleaned up test tenant user: ${freshEmail}`);

    console.log('\n======================================================');
    console.log('ALL MULTI-TENANT ISOLATION TESTS PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
}

verifyIsolation().catch(err => {
    console.error('FATAL VERIFICATION ERROR:', err);
    process.exit(1);
});
