/**
 * Seed Default Roles
 * Creates the default system roles for the application
 */
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Default system roles
const DEFAULT_ROLES = [
    {
        name: 'Admin',
        description: 'Full access to all features',
        is_system: true,
        permissions: {
            products: ['create', 'read', 'update', 'delete', 'print', 'export'],
            inventory: ['create', 'read', 'update', 'delete', 'print', 'export'],
            sales: ['create', 'read', 'update', 'delete', 'print', 'export'],
            invoices: ['create', 'read', 'update', 'delete', 'print', 'export'],
            customers: ['create', 'read', 'update', 'delete', 'print', 'export'],
            vendors: ['create', 'read', 'update', 'delete', 'print', 'export'],
            purchase_orders: ['create', 'read', 'update', 'delete', 'print', 'export'],
            reports: ['read', 'export'],
            settings: ['read', 'update'],
            users: ['create', 'read', 'update', 'delete'],
            activity: ['read'],
        }
    },
    {
        name: 'Manager',
        description: 'Manage operations, view reports',
        is_system: true,
        permissions: {
            products: ['create', 'read', 'update', 'print', 'export'],
            inventory: ['create', 'read', 'update', 'print', 'export'],
            sales: ['create', 'read', 'update', 'print', 'export'],
            invoices: ['create', 'read', 'update', 'print', 'export'],
            customers: ['create', 'read', 'update', 'print', 'export'],
            vendors: ['create', 'read', 'update', 'print', 'export'],
            purchase_orders: ['create', 'read', 'update', 'print', 'export'],
            reports: ['read', 'export'],
            settings: ['read'],
            users: ['read'],
            activity: ['read'],
        }
    },
    {
        name: 'Staff',
        description: 'Basic access for daily operations',
        is_system: true,
        permissions: {
            products: ['read'],
            inventory: ['read', 'update'],
            sales: ['create', 'read', 'print'],
            invoices: ['create', 'read', 'print'],
            customers: ['create', 'read', 'update'],
            vendors: ['read'],
            purchase_orders: ['read'],
            reports: [],
            settings: [],
            users: [],
            activity: [],
        }
    },
    {
        name: 'Cashier',
        description: 'POS and sales only',
        is_system: true,
        permissions: {
            products: ['read'],
            inventory: ['read'],
            sales: ['create', 'read', 'print'],
            invoices: ['create', 'read', 'print'],
            customers: ['create', 'read'],
            vendors: [],
            purchase_orders: [],
            reports: [],
            settings: [],
            users: [],
            activity: [],
        }
    },
    {
        name: 'Viewer',
        description: 'Read-only access (default for new users)',
        is_system: true,
        permissions: {
            products: ['read'],
            inventory: ['read'],
            sales: ['read'],
            invoices: ['read'],
            customers: ['read'],
            vendors: ['read'],
            purchase_orders: ['read'],
            reports: ['read'],
            settings: [],
            users: [],
            activity: [],
        }
    },
];

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("✓ Logged in!\n");

        console.log("Seeding default roles...\n");

        for (const role of DEFAULT_ROLES) {
            try {
                // Check if role exists
                const existing = await pb.collection('roles').getFirstListItem(`name="${role.name}"`);
                console.log(`⊘ ${role.name} - already exists`);
            } catch (err: any) {
                if (err.status === 404) {
                    // Create role
                    await pb.collection('roles').create(role);
                    console.log(`✓ ${role.name} - created`);
                } else {
                    console.log(`✗ ${role.name} - error: ${err.message}`);
                }
            }
        }

        console.log("\n✓ Default roles seeded!");
        console.log("\nRole Hierarchy:");
        console.log("  Admin     → Full access (assign manually)");
        console.log("  Manager   → Operations + Reports");
        console.log("  Staff     → Daily operations");
        console.log("  Cashier   → POS/Sales only");
        console.log("  Viewer    → Read-only (default for new signups)");

    } catch (err: any) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

main();
