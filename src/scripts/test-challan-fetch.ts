"use strict";
import PocketBase from "pocketbase";

async function main() {
    const pb = new PocketBase("http://127.0.0.1:8090");
    await pb.admins.authWithPassword("admin@luminila.com", "password123");

    const col = await pb.collections.getOne("delivery_challans");
    console.log("Collection:", col.name);
    console.log("Type:", col.type);
    console.log("\nFields:");
    (col as any).fields.forEach((f: any) => {
        if (!f.system) {
            console.log(`  - ${f.name} (${f.type})${f.required ? ' [REQUIRED]' : ''}`);
        }
    });

    // Check if there's a sort issue
    console.log("\nTrying to fetch without sort...");
    try {
        const challans = await pb.collection("delivery_challans").getFullList({});
        console.log("Found", challans.length, "challans");
    } catch (e: any) {
        console.error("Error:", e.message);
    }

    // Check if it's an expand issue
    console.log("\nTrying with getList instead...");
    try {
        const challans = await pb.collection("delivery_challans").getList(1, 10);
        console.log("Found", challans.totalItems, "total challans");
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}
main();
