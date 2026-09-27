/**
 * Create Default Admin User
 * Creates an admin user for first-time app login
 */
import PocketBase from 'pocketbase';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.PB_URL || 'http://127.0.0.1:8090';
const pb = new PocketBase(PB_URL);

const DEFAULT_ADMIN = {
    email: 'admin@luminila.local',
    password: 'Admin@123456',
    name: 'Administrator',
};

async function main() {
    try {
        console.log(`Connecting to PocketBase at ${PB_URL}...`);
        console.log("Authenticating as PocketBase Admin...");
        const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
        const adminPass = process.env.PB_ADMIN_PASS || 'password123456';
        await pb.admins.authWithPassword(adminEmail, adminPass);
        console.log("✓ Logged in!\n");

        // Check if user already exists
        try {
            const existing = await pb.collection('users').getFirstListItem(`email="${DEFAULT_ADMIN.email}"`);
            console.log(`⊘ Admin user already exists: ${DEFAULT_ADMIN.email}`);
            console.log(`  Password: ${DEFAULT_ADMIN.password}`);
            return;
        } catch (e) {
            // User doesn't exist, create it
        }

        // Create admin user
        console.log("Creating admin user...");
        const user = await pb.collection('users').create({
            email: DEFAULT_ADMIN.email,
            password: DEFAULT_ADMIN.password,
            passwordConfirm: DEFAULT_ADMIN.password,
            name: DEFAULT_ADMIN.name,
            emailVisibility: true,
            verified: true,
            is_active: true,
        });
        console.log(`✓ User created: ${user.id}`);

        // Assign Admin role
        const adminRole = await pb.collection('roles').getFirstListItem('name="Admin"');
        await pb.collection('user_roles').create({
            user: user.id,
            role: adminRole.id,
        });
        console.log("✓ Admin role assigned");

        console.log("\n" + "=".repeat(50));
        console.log("  DEFAULT ADMIN CREDENTIALS");
        console.log("=".repeat(50));
        console.log(`  Email:    ${DEFAULT_ADMIN.email}`);
        console.log(`  Password: ${DEFAULT_ADMIN.password}`);
        console.log("=".repeat(50));
        console.log("\n⚠️  Change this password after first login!");

    } catch (err: any) {
        console.error("Error:", err.message);
        if (err.response?.data) {
            console.log(JSON.stringify(err.response.data, null, 2));
        }
        process.exit(1);
    }
}

main();
