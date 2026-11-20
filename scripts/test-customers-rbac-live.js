/**
 * One-off live verification for migration 1793003403 (T-05):
 * a Viewer (customers:["read"]) must NOT write customers; a role with
 * customers:create/update must. Run with PocketBase up on :8090.
 */
require('dotenv').config({ path: '.env.local' });
const PocketBase = require('pocketbase').default || require('pocketbase');

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const TENANT = 'admin@luminila.local';
const RUN = Date.now().toString(36);

(async () => {
    const su = new PocketBase(PB_URL);
    await su.admins.authWithPassword(
        process.env.POCKETBASE_SUPERUSER_EMAIL,
        process.env.POCKETBASE_SUPERUSER_PASSWORD
    );

    const mkUser = async (name, perms) => {
        const email = `${name}.${RUN}@rbac-test.local`;
        const user = await su.collection('users').create({
            email,
            password: `Rb!${RUN}x7Q`,
            passwordConfirm: `Rb!${RUN}x7Q`,
            name,
            account_email: TENANT,
            is_active: true,
        }).catch((e) => { throw new Error(`users.create: ${e.status} ${JSON.stringify(e.response?.data)}`); });
        const role = await su.collection('roles').create({
            name: name === 'viewer' ? 'Viewer' : 'Staff',
            permissions: perms,
            is_system: false,
        }).catch((e) => { throw new Error(`roles.create: ${e.status} ${JSON.stringify(e.response?.data)}`); });
        await su.collection('user_roles').create({
            user: user.id,
            role: role.id,
            account_email: TENANT,
        }).catch((e) => { throw new Error(`user_roles.create: ${e.status} ${JSON.stringify(e.response?.data)}`); });
        const client = new PocketBase(PB_URL);
        await client.collection('users').authWithPassword(email, `Rb!${RUN}x7Q`)
            .catch((e) => { throw new Error(`authWithPassword: ${e.status} ${e.url || ''} ${JSON.stringify(e.response?.data)}`); });
        return { user, role, client };
    };

    const viewer = await mkUser('viewer', { customers: ['read'] });
    const editor = await mkUser('editor', { customers: ['create', 'read', 'update'] });

    let viewerBlocked = false;
    try {
        await viewer.client.collection('customers').create({
            name: 'Blocked Viewer Customer',
            phone: '98000000001',
            account_email: TENANT,
        });
    } catch (e) {
        // PocketBase 0.25 surfaces an empty-join rule result as 400 rather
        // than 403; either status means the write was refused.
        viewerBlocked = e.status === 403 || e.status === 400;
    }

    const created = await editor.client.collection('customers').create({
        name: 'Editor Customer',
        phone: '98000000002',
        account_email: TENANT,
    });
    await editor.client.collection('customers').update(created.id, { name: 'Editor Customer v2' });

    console.log('viewer write blocked (403):', viewerBlocked);
    console.log('editor create + update succeeded:', !!created.id);

    // cleanup
    await su.collection('customers').delete(created.id).catch(() => {});
    for (const u of [viewer, editor]) {
        await su.collection('user_roles').delete(
            (await su.collection('user_roles').getFirstListItem(`user="${u.user.id}"`)).id
        ).catch(() => {});
        await su.collection('roles').delete(u.role.id).catch(() => {});
        await su.collection('users').delete(u.user.id).catch(() => {});
    }

    if (!viewerBlocked) {
        console.error('FAIL: Viewer was able to write customers');
        process.exit(1);
    }
    console.log('PASS');
})().catch((e) => {
    console.error('FAILED:', e?.status, e?.url || '', e?.message, JSON.stringify(e?.response?.data || {}));
    process.exit(1);
});
