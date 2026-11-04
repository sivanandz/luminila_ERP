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

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { pb, sanitizeFilter } from './pocketbase';

/**
 * In-memory auth store. The setup superuser token is a full database-admin
 * credential; keeping it on the shared client persisted it to localStorage and
 * left it behind whenever the follow-up app-user login failed (A8).
 */
class EphemeralAuthStore extends BaseAuthStore {}

let setupClient: PocketBase | null = null;

/** The superuser-authenticated client for setup writes, or the app client. */
function setupDb(): PocketBase {
    return setupClient ?? pb;
}

/** Drop the setup superuser session immediately. */
export function clearSetupSession(): void {
    if (setupClient) {
        setupClient.authStore.clear();
        setupClient = null;
    }
}

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
        // Users listRule requires an authenticated caller; the server route
        // checks with its tenant client (A-18).
        const res = await fetch('/api/setup/status', { cache: 'no-store' });
        if (!res.ok) return false;
        const data = await res.json();
        return data?.complete === true;
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

/** Authenticate as the freshly provisioned tenant superuser (non-persisted). */
export async function authenticateSetupSuperuser(
    email: string,
    password: string
): Promise<{ id: string; email?: string }> {
    clearSetupSession();
    // A dedicated client with an in-memory store: never written to localStorage.
    const client = new PocketBase(pb.baseURL, new EphemeralAuthStore());
    try {
        const authData = await client.collection("_superusers").authWithPassword(email.trim(), password);
        setupClient = client;
        return authData.record;
    } catch {
        client.authStore.clear();
        throw new Error(
            "Unable to authenticate as the superuser of the new database. Check that PocketBase provisioned successfully, then retry."
        );
    }
}

export async function seedDefaultRoles(): Promise<Record<string, string>> {
    const roleMap: Record<string, string> = {};

    for (const role of DEFAULT_SETUP_ROLES) {
        try {
            const existing = await setupDb().collection("roles").getFirstListItem(
                `name="${sanitizeFilter(role.name)}" && is_system = true`
            );
            roleMap[role.name] = existing.id;
        } catch (err: unknown) {
            if ((err as { status?: number })?.status !== 404) continue;
            try {
                const created = await setupDb().collection("roles").create(role);
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
    // The first store user owns the tenant; every users row must carry the
    // account_email scope or it is invisible under the tenant isolation rules.
    const accountEmail = input.email.trim().toLowerCase();
    try {
        const existing = await setupDb().collection("users").getFirstListItem(`email="${sanitizeFilter(input.email)}"`);
        return await setupDb().collection("users").update(existing.id, {
            name: input.name,
            password: input.password,
            passwordConfirm: input.password,
            verified: true,
            is_active: true,
            ...(existing.account_email ? {} : { account_email: accountEmail }),
        });
    } catch (err: unknown) {
        if ((err as { status?: number })?.status !== 404) throw err;
        return await setupDb().collection("users").create({
            email: input.email,
            password: input.password,
            passwordConfirm: input.password,
            name: input.name,
            emailVisibility: true,
            verified: true,
            is_active: true,
            account_email: accountEmail,
        });
    }
}

export async function linkUserToAdminRole(userId: string, roleId: string | undefined): Promise<void> {
    if (!roleId) return;
    try {
        await setupDb().collection("user_roles").getFirstListItem(
            `user="${sanitizeFilter(userId)}" && role="${sanitizeFilter(roleId)}"`
        );
    } catch (err: unknown) {
        if ((err as { status?: number })?.status !== 404) return;
        try {
            // Tenant-scope the role link so it stays visible only to this store.
            const owner = await setupDb().collection("users").getOne(userId);
            await setupDb().collection("user_roles").create({
                user: userId,
                role: roleId,
                account_email: owner.account_email || owner.email?.trim().toLowerCase() || "",
            });
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
        { key: "currency_symbol", value: "â‚¹", category: "general", account_email: accountEmail },
    ];

    for (const setting of initialSettings) {
        try {
            const existingSetting = await setupDb().collection("store_settings").getFirstListItem(
                `key="${sanitizeFilter(setting.key)}" && account_email="${sanitizeFilter(accountEmail)}"`
            );
            await setupDb().collection("store_settings").update(existingSetting.id, {
                value: setting.value,
                account_email: accountEmail,
            });
        } catch (sErr: unknown) {
            if ((sErr as { status?: number })?.status !== 404) continue;
            try {
                await setupDb().collection("store_settings").create(setting);
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
            const records = await setupDb().collection(collection).getFullList({
                filter: `account_email = "${sanitizeFilter(accountEmail)}"`,
                requestKey: null,
            }).catch(() => []);
            for (const record of records) {
                await setupDb().collection(collection).delete(record.id).catch(() => {});
                deleted += 1;
            }
        } catch (error) {
            console.warn(`Clean slate notice for ${collection}:`, error);
        }
    }

    return deleted;
}

/** Sign the new admin into the application session on the shared client. */
export async function loginSetupAdmin(email: string, password: string): Promise<void> {
    // Drop the superuser session before switching the shared client to the app
    // user; the superuser token must not survive setup (A8/A13).
    clearSetupSession();
    pb.authStore.clear();
    await pb.collection("users").authWithPassword(email, password);
}
