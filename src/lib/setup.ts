/**
 * Setup wizard service.
 *
 * The setup page used to drive PocketBase directly: superuser bootstrap, roles,
 * the admin user, settings and the optional clean slate were all raw collection
 * calls in the component. They live here so the page only orchestrates steps,
 * which is the D-23 rule for document and setup screens.
 *
 * The hardcoded `admin@luminila.local` / `LuminilaInit2026!` bootstrap fallback
 * was removed: it shipped a working superuser password in the client bundle.
 * Provisioning now authenticates with the credentials the operator chose.
 */

import { pb, sanitizeFilter } from './pocketbase';

export interface SetupBootstrapInput {
    adminEmail: string;
    adminPassword: string;
    adminName: string;
    storeName: string;
    cleanSlate: boolean;
}

export const DEFAULT_SETUP_ROLES = [
    {
        name: "Admin",
        description: "Full access to all features and administration",
        is_system: true,
        permissions: {
            products: ["create", "read", "update", "delete", "print", "export"],
            inventory: ["create", "read", "update", "delete", "print", "export"],
            sales: ["create", "read", "update", "delete", "print", "export"],
            invoices: ["create", "read", "update", "delete", "print", "export"],
            customers: ["create", "read", "update", "delete", "print", "export"],
            vendors: ["create", "read", "update", "delete", "print", "export"],
            purchase_orders: ["create", "read", "update", "delete", "print", "export"],
            reports: ["read", "export"],
            settings: ["read", "update"],
            users: ["create", "read", "update", "delete"],
            activity: ["read"],
        },
    },
    {
        name: "Manager",
        description: "Manage store operations and view analytics",
        is_system: true,
        permissions: {
            products: ["create", "read", "update", "print", "export"],
            inventory: ["create", "read", "update", "print", "export"],
            sales: ["create", "read", "update", "print", "export"],
            invoices: ["create", "read", "update", "print", "export"],
            customers: ["create", "read", "update", "print", "export"],
            vendors: ["create", "read", "update", "print", "export"],
            purchase_orders: ["create", "read", "update", "print", "export"],
            reports: ["read", "export"],
            settings: ["read"],
            users: ["read"],
            activity: ["read"],
        },
    },
    {
        name: "Staff",
        description: "Point of sale and daily inventory updates",
        is_system: true,
        permissions: {
            products: ["read"],
            inventory: ["read", "update"],
            sales: ["create", "read", "print"],
            invoices: ["create", "read", "print"],
            customers: ["create", "read", "update"],
            vendors: ["read"],
            purchase_orders: ["read"],
            reports: [],
            settings: [],
            users: [],
            activity: ["read"],
        },
    },
    {
        name: "Viewer",
        description: "Read-only access for audits and reviews",
        is_system: true,
        permissions: {
            products: ["read"],
            inventory: ["read"],
            sales: ["read"],
            invoices: ["read"],
            customers: ["read"],
            vendors: ["read"],
            purchase_orders: ["read"],
            reports: ["read"],
            settings: [],
            users: [],
            activity: ["read"],
        },
    },
];

/** True when this instance already has at least one application user. */
export async function isSetupComplete(): Promise<boolean> {
    try {
        const users = await pb.collection("users").getList(1, 1);
        return users.totalItems > 0;
    } catch {
        return false;
    }
}

export async function checkPocketBaseHealth(): Promise<boolean> {
    try {
        await pb.health.check();
        return true;
    } catch {
        return false;
    }
}

/** Authenticate as the freshly provisioned tenant superuser. */
export async function authenticateSetupSuperuser(
    email: string,
    password: string
): Promise<{ id: string; email?: string }> {
    try {
        const authData = await pb.collection("_superusers").authWithPassword(email.trim(), password);
        return authData.record;
    } catch {
        throw new Error(
            "Unable to authenticate as the superuser of the new database. Check that PocketBase provisioned successfully, then retry."
        );
    }
}

export async function seedDefaultRoles(): Promise<Record<string, string>> {
    const roleMap: Record<string, string> = {};

    for (const role of DEFAULT_SETUP_ROLES) {
        try {
            const existing = await pb.collection("roles").getFirstListItem(`name="${role.name}"`);
            roleMap[role.name] = existing.id;
        } catch (err: unknown) {
            if ((err as { status?: number })?.status !== 404) continue;
            try {
                const created = await pb.collection("roles").create(role);
                roleMap[role.name] = created.id;
            } catch (createErr) {
                console.warn(`Could not create role ${role.name}:`, createErr);
            }
        }
    }

    return roleMap;
}

export async function ensureSetupAdminUser(input: {
    email: string;
    password: string;
    name: string;
}): Promise<{ id: string }> {
    try {
        const existing = await pb.collection("users").getFirstListItem(`email="${input.email}"`);
        return await pb.collection("users").update(existing.id, {
            name: input.name,
            password: input.password,
            passwordConfirm: input.password,
            verified: true,
            is_active: true,
        });
    } catch (err: unknown) {
        if ((err as { status?: number })?.status !== 404) throw err;
        return await pb.collection("users").create({
            email: input.email,
            password: input.password,
            passwordConfirm: input.password,
            name: input.name,
            emailVisibility: true,
            verified: true,
            is_active: true,
        });
    }
}

export async function linkUserToAdminRole(userId: string, roleId: string | undefined): Promise<void> {
    if (!roleId) return;
    try {
        await pb.collection("user_roles").getFirstListItem(`user="${userId}" && role="${roleId}"`);
    } catch (err: unknown) {
        if ((err as { status?: number })?.status !== 404) return;
        try {
            await pb.collection("user_roles").create({ user: userId, role: roleId });
        } catch (urErr) {
            console.warn("user_roles creation notice:", urErr);
        }
    }
}

export async function seedStoreSettings(
    storeName: string,
    accountEmail: string
): Promise<void> {
    const initialSettings = [
        { key: "store_name", value: storeName, category: "general", account_email: accountEmail },
        { key: "currency", value: "INR", category: "general", account_email: accountEmail },
        { key: "currency_symbol", value: "₹", category: "general", account_email: accountEmail },
    ];

    for (const setting of initialSettings) {
        try {
            const existingSetting = await pb.collection("store_settings").getFirstListItem(
                `key="${setting.key}" && account_email="${accountEmail}"`
            );
            await pb.collection("store_settings").update(existingSetting.id, {
                value: setting.value,
                account_email: accountEmail,
            });
        } catch (sErr: unknown) {
            if ((sErr as { status?: number })?.status !== 404) continue;
            try {
                await pb.collection("store_settings").create(setting);
            } catch { /* ignore */ }
        }
    }
}

const PURGE_COLLECTIONS = [
    "invoice_payments",
    "invoice_items",
    "invoices",
    "credit_note_items",
    "credit_notes",
    "delivery_challan_items",
    "delivery_challans",
    "stock_movements",
    "stock_discrepancies",
    "sale_items",
    "sales",
    "sales_order_items",
    "sales_orders",
    "grn_items",
    "goods_received_notes",
    "purchase_order_items",
    "purchase_orders",
    "vendor_products",
    "vendors",
    "expenses",
    "bank_transactions",
    "payment_links",
    "whatsapp_messages",
    "whatsapp_chats",
    "product_variants",
    "products",
    "customers",
];

/** Purge prior demo data for this tenant only. */
export async function purgeTenantDemoData(accountEmail: string): Promise<number> {
    let deleted = 0;

    for (const collection of PURGE_COLLECTIONS) {
        try {
            const records = await pb.collection(collection).getFullList({
                filter: `account_email = "${sanitizeFilter(accountEmail)}"`,
                requestKey: null,
            }).catch(() => []);
            for (const record of records) {
                await pb.collection(collection).delete(record.id).catch(() => {});
                deleted += 1;
            }
        } catch (error) {
            console.warn(`Clean slate notice for ${collection}:`, error);
        }
    }

    return deleted;
}

/** Sign the new admin into the application session. */
export async function loginSetupAdmin(email: string, password: string): Promise<void> {
    pb.authStore.clear();
    await pb.collection("users").authWithPassword(email, password);
}
