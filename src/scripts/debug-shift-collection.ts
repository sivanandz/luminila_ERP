"use strict";
/**
 * Debug script to check cash_register_shifts collection status
 * Run with: npx tsx src/scripts/debug-shift-collection.ts
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

async function main() {
    console.log("Connecting to PocketBase at:", PB_URL);

    const pb = new PocketBase(PB_URL);

    // Authenticate as admin (you'll need to enter admin credentials)
    const adminEmail = process.env.PB_ADMIN_EMAIL || "admin@example.com";
    const adminPass = process.env.PB_ADMIN_PASS || "admin123";

    try {
        await pb.admins.authWithPassword(adminEmail, adminPass);
        console.log("✓ Authenticated as admin");
    } catch (err: any) {
        console.log("⚠ Admin auth failed:", err?.message);
        console.log("Proceeding without admin auth...");
    }

    // Check if collection exists
    try {
        const collections = await pb.collections.getFullList();
        const shiftCollection = collections.find(c => c.name === "cash_register_shifts");

        if (shiftCollection) {
            console.log("\n✓ cash_register_shifts collection found!");
            console.log("  ID:", shiftCollection.id);
            console.log("  Type:", shiftCollection.type);
            console.log("  Fields:");

            const schema = (shiftCollection as any).schema || (shiftCollection as any).fields || [];
            schema.forEach((field: any) => {
                console.log(`    - ${field.name}: ${field.type} (required: ${field.required})`);
                if (field.type === "relation") {
                    console.log(`      → references: ${field.collectionId}`);
                }
            });

            // Check rules
            console.log("\n  Rules:");
            console.log(`    createRule: ${shiftCollection.createRule}`);
            console.log(`    listRule: ${shiftCollection.listRule}`);
        } else {
            console.log("\n✗ cash_register_shifts collection NOT FOUND!");
            console.log("  Available collections:");
            collections.forEach(c => {
                console.log(`    - ${c.name} (${c.id})`);
            });
        }

        // Try to get users collection ID
        const usersCollection = collections.find(c => c.name === "users");
        if (usersCollection) {
            console.log("\n✓ users collection ID:", usersCollection.id);
        }

    } catch (err: any) {
        console.error("Error checking collections:", err?.message);
    }
}

main().catch(console.error);
