"use strict";
/**
 * Fix superuser-only collections by removing their API rules
 * This makes them only accessible to PocketBase admins/superusers
 * Run with: npx tsx src/scripts/fix-superuser-collections.ts
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

// Collections that SHOULD be superuser-only (empty rules = admin only)
const SUPERUSER_ONLY_COLLECTIONS = [
    'roles',           // Role management - admin only
    'user_roles',      // User role assignments - admin only
    'number_sequences', // Sequence generators - admin only
    'store_settings',  // Store configuration - admin only
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

    let fixed = 0;

    for (const collectionName of SUPERUSER_ONLY_COLLECTIONS) {
        try {
            const collection = await pb.collections.getOne(collectionName);

            // Check if any rules are set
            const hasRules =
                (collection as any).listRule ||
                (collection as any).viewRule ||
                (collection as any).createRule ||
                (collection as any).updateRule ||
                (collection as any).deleteRule;

            if (hasRules) {
                console.log(`⚠ ${collectionName}: Has auth rules, clearing to make superuser-only...`);

                await pb.collections.update(collectionName, {
                    listRule: null,
                    viewRule: null,
                    createRule: null,
                    updateRule: null,
                    deleteRule: null,
                });

                console.log(`  ✓ Fixed ${collectionName} - now superuser-only`);
                fixed++;
            } else {
                console.log(`✓ ${collectionName}: Already superuser-only`);
            }
        } catch (err: any) {
            console.error(`✗ Error processing ${collectionName}:`, err?.message);
        }
    }

    console.log("\n" + "=".repeat(50));
    console.log("SUMMARY");
    console.log("=".repeat(50));
    console.log(`Collections checked: ${SUPERUSER_ONLY_COLLECTIONS.length}`);
    console.log(`Collections fixed: ${fixed}`);
    console.log("\nThese collections are now SUPERUSER-ONLY (only PocketBase admins can access):");
    SUPERUSER_ONLY_COLLECTIONS.forEach(c => console.log(`  - ${c}`));
}

main().catch(console.error);
