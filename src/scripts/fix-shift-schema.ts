"use strict";
/**
 * Fix cash_register_shifts schema - remove required constraint from opening_balance
 * Run with: npx tsx src/scripts/fix-shift-schema.ts
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090";

async function main() {
    console.log("Connecting to PocketBase at:", PB_URL);

    const pb = new PocketBase(PB_URL);

    // Authenticate as admin
    const adminEmail = process.env.PB_ADMIN_EMAIL || "admin@luminila.com";
    const adminPass = process.env.PB_ADMIN_PASS || "Admin@123";

    try {
        await pb.admins.authWithPassword(adminEmail, adminPass);
        console.log("✓ Authenticated as admin");
    } catch (err: any) {
        console.error("✗ Admin auth failed:", err?.message);
        console.log("\nPlease set PB_ADMIN_EMAIL and PB_ADMIN_PASS environment variables");
        console.log("Or update the credentials in this script");
        process.exit(1);
    }

    try {
        // Get the collection
        const collection = await pb.collections.getOne("cash_register_shifts");
        console.log("✓ Found cash_register_shifts collection");

        // Find and update the opening_balance field
        const fields = (collection as any).fields || [];
        const updatedFields = fields.map((field: any) => {
            if (field.name === "opening_balance") {
                console.log("  Current opening_balance field:", JSON.stringify(field, null, 2));
                return {
                    ...field,
                    required: false, // Allow empty/0 values
                };
            }
            return field;
        });

        // Update the collection
        await pb.collections.update("cash_register_shifts", {
            fields: updatedFields
        });

        console.log("✓ Updated opening_balance field - removed required constraint");
        console.log("\nYou should now be able to open shifts with $0 balance.");

    } catch (err: any) {
        console.error("Error updating collection:", err?.message);
        if (err?.response?.data) {
            console.error("Details:", JSON.stringify(err.response.data, null, 2));
        }
    }
}

main().catch(console.error);
