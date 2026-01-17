"use strict";
/**
 * Update collections for E-way Bill integration - one field at a time
 */

import PocketBase from "pocketbase";

async function main() {
    const pb = new PocketBase("http://127.0.0.1:8090");
    await pb.admins.authWithPassword("admin@luminila.com", "password123");
    console.log("✓ Authenticated as admin\n");

    // Update invoices collection with E-way Bill fields
    console.log("Updating invoices collection...");

    try {
        const invoicesCol = await pb.collections.getOne("invoices");
        const invoiceFields = (invoicesCol as any).fields || [];
        const existingNames = invoiceFields.map((f: any) => f.name);

        // Check each field we need
        const fieldsNeeded = ["eway_bill_no", "eway_bill_date", "eway_bill_valid_until", "eway_bill_status"];
        const missing = fieldsNeeded.filter(f => !existingNames.includes(f));

        if (missing.length > 0) {
            console.log("Missing fields:", missing.join(", "));
            console.log("Adding fields via individual updates...");

            for (const fieldName of missing) {
                try {
                    const currentCol = await pb.collections.getOne("invoices");
                    const currentFields = [...((currentCol as any).fields || [])];

                    let newField: any;
                    switch (fieldName) {
                        case "eway_bill_no":
                            newField = {
                                name: "eway_bill_no",
                                type: "text",
                                required: false,
                                presentable: false,
                                system: false,
                            };
                            break;
                        case "eway_bill_date":
                            newField = {
                                name: "eway_bill_date",
                                type: "date",
                                required: false,
                                presentable: false,
                                system: false,
                            };
                            break;
                        case "eway_bill_valid_until":
                            newField = {
                                name: "eway_bill_valid_until",
                                type: "date",
                                required: false,
                                presentable: false,
                                system: false,
                            };
                            break;
                        case "eway_bill_status":
                            newField = {
                                name: "eway_bill_status",
                                type: "text",
                                required: false,
                                presentable: false,
                                system: false,
                            };
                            break;
                    }

                    currentFields.push(newField);
                    await pb.collections.update("invoices", { fields: currentFields });
                    console.log(`  ✓ Added ${fieldName}`);
                } catch (e: any) {
                    console.log(`  ✗ Failed to add ${fieldName}:`, e.message);
                }
            }
        } else {
            console.log("✓ All E-way Bill fields already exist in invoices");
        }

        // List current invoice fields for verification
        const finalCol = await pb.collections.getOne("invoices");
        const ewayFields = ((finalCol as any).fields || []).filter((f: any) => f.name.startsWith("eway"));
        console.log("\nE-way Bill fields in invoices:");
        ewayFields.forEach((f: any) => console.log(`  - ${f.name} (${f.type})`));

    } catch (e: any) {
        console.error("Error updating invoices:", e.message);
    }

    console.log("\n✓ Schema update complete!");
}

main().catch(console.error);
