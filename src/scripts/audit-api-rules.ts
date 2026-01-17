"use strict";
/**
 * Audit PocketBase collection API rules
 * Run with: npx tsx src/scripts/audit-api-rules.ts
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

// Collections that SHOULD be superuser-only (sensitive/admin operations)
const SUPERUSER_ONLY_COLLECTIONS = [
    'roles',           // Role management - admin only
    'user_roles',      // User role assignments - admin only
    'number_sequences', // Sequence generators - admin only
    'store_settings',  // Store configuration - admin only
];

// Collections that should allow authenticated users
const AUTH_USER_COLLECTIONS = [
    'users',
    'products',
    'customers',
    'vendors',
    'categories',
    'sales',
    'sale_items',
    'invoices',
    'invoice_items',
    'invoice_payments',
    'purchase_orders',
    'purchase_order_items',
    'delivery_challans',
    'delivery_challan_items',
    'expenses',
    'expense_categories',
    'cash_register_shifts',
    'cash_drawer_operations',
    'loyalty_accounts',
    'loyalty_transactions',
    'loyalty_settings',
    'loyalty_tiers',
    'bank_accounts',
    'bank_transactions',
    'activity_logs',
    'stock_movements',
    'product_variants',
    'product_attributes',
    'product_attribute_values',
    'credit_notes',
    'credit_note_items',
    'discounts',
    'discount_usage',
    'customer_interactions',
    'vendor_products',
    'goods_received_notes',
    'grn_items',
    'sales_orders',
    'sales_order_items',
];

async function main() {
    console.log("Connecting to PocketBase at:", PB_URL);

    const pb = new PocketBase(PB_URL);

    const adminEmail = process.env.PB_ADMIN_EMAIL;
    const adminPass = process.env.PB_ADMIN_PASS;

    if (adminEmail && adminPass) {
        try {
            await pb.admins.authWithPassword(adminEmail, adminPass);
            console.log("✓ Authenticated as admin\n");
        } catch (err: any) {
            console.error("✗ Admin auth failed:", err?.message);
            process.exit(1);
        }
    } else {
        console.log("No admin credentials. Set PB_ADMIN_EMAIL and PB_ADMIN_PASS\n");
        process.exit(1);
    }

    try {
        const collections = await pb.collections.getFullList();

        console.log("=".repeat(80));
        console.log("API RULES AUDIT REPORT");
        console.log("=".repeat(80));

        // Group collections
        const superuserCollections: any[] = [];
        const authUserCollections: any[] = [];
        const systemCollections: any[] = [];
        const unknownCollections: any[] = [];

        for (const collection of collections) {
            // Skip system collections
            if (collection.name.startsWith('_') || collection.name.startsWith('pb_')) {
                systemCollections.push(collection);
                continue;
            }

            if (SUPERUSER_ONLY_COLLECTIONS.includes(collection.name)) {
                superuserCollections.push(collection);
            } else if (AUTH_USER_COLLECTIONS.includes(collection.name)) {
                authUserCollections.push(collection);
            } else {
                unknownCollections.push(collection);
            }
        }

        // Report superuser-only collections
        console.log("\n📛 SUPERUSER-ONLY COLLECTIONS (should have empty rules or @request.auth.isSuperuser):");
        console.log("-".repeat(80));
        for (const col of superuserCollections) {
            const rules = {
                list: (col as any).listRule,
                view: (col as any).viewRule,
                create: (col as any).createRule,
                update: (col as any).updateRule,
                delete: (col as any).deleteRule,
            };

            const hasAuthRule = Object.values(rules).some(r => r && r.includes('@request.auth.id'));
            const status = hasAuthRule ? "⚠️  HAS AUTH RULE (should be superuser-only)" : "✅ Correctly restricted";

            console.log(`\n${col.name}: ${status}`);
            console.log(`  List: ${rules.list || '(empty/superuser only)'}`);
            console.log(`  View: ${rules.view || '(empty/superuser only)'}`);
            console.log(`  Create: ${rules.create || '(empty/superuser only)'}`);
            console.log(`  Update: ${rules.update || '(empty/superuser only)'}`);
            console.log(`  Delete: ${rules.delete || '(empty/superuser only)'}`);
        }

        // Report authenticated user collections
        console.log("\n\n👤 AUTHENTICATED USER COLLECTIONS (should have @request.auth.id != \"\"):");
        console.log("-".repeat(80));
        for (const col of authUserCollections) {
            const rules = {
                list: (col as any).listRule,
                view: (col as any).viewRule,
                create: (col as any).createRule,
                update: (col as any).updateRule,
                delete: (col as any).deleteRule,
            };

            const allHaveAuth = Object.values(rules).every(r => r && r.includes('@request.auth.id'));
            const status = allHaveAuth ? "✅ Correctly configured" : "⚠️  MISSING AUTH RULES";

            console.log(`${col.name}: ${status}`);
        }

        // Report unknown collections
        if (unknownCollections.length > 0) {
            console.log("\n\n❓ UNCATEGORIZED COLLECTIONS (review needed):");
            console.log("-".repeat(80));
            for (const col of unknownCollections) {
                const rules = {
                    list: (col as any).listRule,
                    view: (col as any).viewRule,
                    create: (col as any).createRule,
                    update: (col as any).updateRule,
                    delete: (col as any).deleteRule,
                };
                console.log(`\n${col.name}:`);
                console.log(`  List: ${rules.list || '(empty)'}`);
                console.log(`  View: ${rules.view || '(empty)'}`);
                console.log(`  Create: ${rules.create || '(empty)'}`);
                console.log(`  Update: ${rules.update || '(empty)'}`);
                console.log(`  Delete: ${rules.delete || '(empty)'}`);
            }
        }

        // Summary
        console.log("\n\n" + "=".repeat(80));
        console.log("SUMMARY");
        console.log("=".repeat(80));
        console.log(`System collections (skipped): ${systemCollections.length}`);
        console.log(`Superuser-only collections: ${superuserCollections.length}`);
        console.log(`Authenticated user collections: ${authUserCollections.length}`);
        console.log(`Uncategorized collections: ${unknownCollections.length}`);

    } catch (err: any) {
        console.error("Error:", err?.message);
    }
}

main().catch(console.error);
