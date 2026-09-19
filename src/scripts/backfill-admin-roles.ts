import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    console.log('Connecting to PocketBase...');
    try {
        await pb.collection('_superusers').authWithPassword('admin@luminila.com', 'password123456');
    } catch {
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
    }
    console.log('✓ Superuser authenticated');

    const adminRole = await pb.collection('roles').getFirstListItem('name="Admin"');
    console.log('Found Admin role ID:', adminRole.id);

    const users = await pb.collection('users').getFullList();
    console.log(`Found ${users.length} users:`);

    for (const user of users) {
        // Check if user already has Admin role
        const existingRoles = await pb.collection('user_roles').getFullList({
            filter: `user="${user.id}" && role="${adminRole.id}"`
        });

        if (existingRoles.length === 0) {
            console.log(`Assigning Admin role to ${user.email} (${user.id})...`);
            await pb.collection('user_roles').create({
                user: user.id,
                role: adminRole.id
            });
            console.log(`  ✓ Admin role assigned to ${user.email}`);
        } else {
            console.log(`  ✓ ${user.email} already has Admin role`);
        }
    }

    console.log('\nAll users successfully updated with Admin role!');
}

main().catch(err => {
    console.error('Error backfilling admin roles:', err);
    process.exit(1);
});
