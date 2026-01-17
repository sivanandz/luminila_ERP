"use strict";
/**
 * Fix admin-only collections to allow app admins (users with Admin role)
 * Run with: npx tsx src/scripts/fix-admin-collections.ts
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

// Collections that should be app-admin-only
const ADMIN_ONLY_COLLECTIONS = [
    'roles',           // Role management
    'user_roles',      // User role assignments  
    'number_sequences', // Sequence generators
    'store_settings',  // Store configuration
];

async function main() {
    console.log("Connecting to PocketBase at:", PB_URL);

    const pb = new PocketBase(PB_URL);

    const adminEmail = process.env.PB_ADMIN_EMAIL;
    const adminPass = process.env.PB_ADMIN_PASS;

    await pb.admins.authWithPassword(adminEmail!, adminPass!);
    console.log("✓ Authenticated as admin\n");

    // First, get the Admin role ID
    const roles = await pb.collection("roles").getFullList();
    const adminRole = roles.find(r => (r as any).name === "Admin");

    if (!adminRole) {
        console.error("❌ Could not find Admin role!");
        console.log("Available roles:", roles.map(r => (r as any).name).join(", "));
        process.exit(1);
    }

    console.log(`Found Admin role ID: ${adminRole.id}\n`);

    // API rule that checks if user has Admin role via user_roles collection
    // This uses PocketBase's @collection syntax to check the user_roles junction table
    const adminOnlyRule = `@request.auth.id != "" && @collection.user_roles.user ?= @request.auth.id && @collection.user_roles.role ?= "${adminRole.id}"`;

    console.log("Admin-only API rule:");
    console.log(`  ${adminOnlyRule}\n`);

    let fixed = 0;

    for (const collectionName of ADMIN_ONLY_COLLECTIONS) {
        try {
            console.log(`Processing ${collectionName}...`);

            await pb.collections.update(collectionName, {
                listRule: adminOnlyRule,
                viewRule: adminOnlyRule,
                createRule: adminOnlyRule,
                updateRule: adminOnlyRule,
                deleteRule: adminOnlyRule,
            });

            console.log(`  ✓ Fixed ${collectionName} - now admin-only (app admins can access)`);
            fixed++;
        } catch (err: any) {
            console.error(`  ✗ Error processing ${collectionName}:`, err?.message);
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Collections fixed: ${fixed}/${ADMIN_ONLY_COLLECTIONS.length}`);
    console.log("\nThese collections are now accessible only by users with Admin role:");
    ADMIN_ONLY_COLLECTIONS.forEach(c => console.log(`  - ${c}`));
}

main().catch(console.error);
