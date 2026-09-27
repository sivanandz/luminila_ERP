import PocketBase from 'pocketbase';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.PB_URL || 'http://127.0.0.1:8090';
const pb = new PocketBase(PB_URL);

async function main() {
    try {
        console.log(`Connecting to PocketBase at ${PB_URL}...`);
        console.log("Authenticating as Admin...");
        const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
        const adminPass = process.env.PB_ADMIN_PASS || 'password123456';
        await pb.admins.authWithPassword(adminEmail, adminPass);
        console.log("✓ Logged in!\n");

        console.log("Updating 'users' collection schema...");
        const collection = await pb.collections.getOne('users');

        const fields = [...(collection.fields || [])];

        // Add last_login if missing
        const hasLastLogin = fields.find((f: any) => f.name === 'last_login');
        if (!hasLastLogin) {
            console.log("Adding 'last_login' field...");
            fields.push({
                name: "last_login",
                type: "date",
                required: false,
                presentable: false,
                unique: false,
                options: {
                    min: "",
                    max: ""
                }
            });
        } else {
            console.log("'last_login' field already exists.");
        }

        // Add is_active if missing
        const hasIsActive = fields.find((f: any) => f.name === 'is_active');
        if (!hasIsActive) {
            console.log("Adding 'is_active' field...");
            fields.push({
                name: "is_active",
                type: "bool",
                required: false,
                presentable: false,
                unique: false,
                options: {}
            });
        } else {
            console.log("'is_active' field already exists.");
        }

        if (!hasLastLogin || !hasIsActive) {
            await pb.collections.update('users', { fields });
            console.log("✓ Schema updated.");
        } else {
            console.log("No schema changes needed.");
        }

        // Now we need to populate is_active=true for existing users who are active
        // Default PocketBase verified is true for our seeded users
        console.log("Backfilling is_active for existing users...");
        const users = await pb.collection('users').getFullList();
        let updatedCount = 0;
        for (const user of users) {
            if (user.is_active === false || user.is_active === undefined || user.is_active === null) {
                await pb.collection('users').update(user.id, { is_active: true });
                console.log(`  ✓ Activated user: ${user.email} (${user.id})`);
                updatedCount++;
            }
        }
        console.log(`✓ Backfilled ${updatedCount} users.`);

    } catch (err: any) {
        console.error("Script Error:", err.message);
        if (err.data) console.log(JSON.stringify(err.data, null, 2));
    }
}

main();
