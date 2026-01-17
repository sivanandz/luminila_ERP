"use strict";
/**
 * Check and fix API rules for all PocketBase collections
 * Run with: npx tsx src/scripts/fix-all-api-rules.ts
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

// The standard rule to allow authenticated users
const AUTH_RULE = '@request.auth.id != ""';

// Collections that should have API rules (excluding system collections)
const APP_COLLECTIONS = [
    'users',
    'roles',
    'user_roles',
    'products',
    'inventory',
    'inventory_transactions',
    'customers',
    'vendors',
    'sales',
    'sale_items',
    'invoices',
    'invoice_items',
    'delivery_challans',
    'challan_items',
    'purchase_orders',
    'purchase_order_items',
    'returns',
    'return_items',
    'expenses',
    'expense_categories',
    'cash_register_shifts',
    'cash_drawer_operations',
    'loyalty_accounts',
    'loyalty_transactions',
    'bank_accounts',
    'bank_transactions',
    'settings',
    'labels',
];

async function main() {
    console.log("Connecting to PocketBase at:", PB_URL);

    const pb = new PocketBase(PB_URL);

    // Try to authenticate as admin
    const adminEmail = process.env.PB_ADMIN_EMAIL;
    const adminPass = process.env.PB_ADMIN_PASS;

    if (adminEmail && adminPass) {
        try {
            await pb.admins.authWithPassword(adminEmail, adminPass);
            console.log("✓ Authenticated as admin\n");
        } catch (err: any) {
            console.error("✗ Admin auth failed:", err?.message);
            console.log("Proceeding without admin (read-only mode)...\n");
        }
    } else {
        console.log("No admin credentials provided. Set PB_ADMIN_EMAIL and PB_ADMIN_PASS env vars to update rules.\n");
    }

    try {
        // Get all collections
        const collections = await pb.collections.getFullList();
        console.log(`Found ${collections.length} collections\n`);

        const issues: string[] = [];
        const fixed: string[] = [];

        for (const collection of collections) {
            // Skip system collections (they start with _ or pb_)
            if (collection.name.startsWith('_') || collection.name.startsWith('pb_')) {
                continue;
            }

            const rules = {
                listRule: (collection as any).listRule,
                viewRule: (collection as any).viewRule,
                createRule: (collection as any).createRule,
                updateRule: (collection as any).updateRule,
                deleteRule: (collection as any).deleteRule,
            };

            // Check if any rules are empty (null or empty string)
            const emptyRules: string[] = [];
            for (const [ruleName, ruleValue] of Object.entries(rules)) {
                if (!ruleValue || ruleValue.trim() === '') {
                    emptyRules.push(ruleName);
                }
            }

            if (emptyRules.length > 0) {
                console.log(`⚠ ${collection.name}: Missing rules: ${emptyRules.join(', ')}`);
                issues.push(collection.name);

                // Try to fix if we're authenticated as admin
                if (pb.authStore.isValid && pb.authStore.isSuperuser) {
                    try {
                        const updateData: any = {};
                        for (const ruleName of emptyRules) {
                            updateData[ruleName] = AUTH_RULE;
                        }

                        await pb.collections.update(collection.id, updateData);
                        console.log(`  ✓ Fixed ${collection.name}`);
                        fixed.push(collection.name);
                    } catch (err: any) {
                        console.log(`  ✗ Failed to fix: ${err?.message}`);
                    }
                }
            } else {
                console.log(`✓ ${collection.name}: All rules configured`);
            }
        }

        console.log("\n" + "=".repeat(50));
        console.log("SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total collections checked: ${collections.length}`);
        console.log(`Collections with issues: ${issues.length}`);
        console.log(`Collections fixed: ${fixed.length}`);

        if (issues.length > 0 && fixed.length === 0) {
            console.log("\nTo fix these issues, run with admin credentials:");
            console.log("  PB_ADMIN_EMAIL=your@email.com PB_ADMIN_PASS=yourpass npx tsx src/scripts/fix-all-api-rules.ts");
        }

    } catch (err: any) {
        console.error("Error:", err?.message);
        if (err?.status === 401 || err?.status === 403) {
            console.log("\nAdmin authentication required to list/update collections.");
        }
    }
}

main().catch(console.error);
