"use strict";
import PocketBase from "pocketbase";

async function main() {
    const pb = new PocketBase("http://127.0.0.1:8090");
    await pb.admins.authWithPassword("admin@luminila.com", "password123");

    // Get sales collection schema
    console.log("=== SALES COLLECTION ===");
    const sales = await pb.collections.getOne("sales");
    (sales as any).fields.forEach((f: any) => {
        if (!f.system) console.log(`  - ${f.name} (${f.type})`);
    });

    // Get sale_items collection schema
    console.log("\n=== SALE_ITEMS COLLECTION ===");
    const saleItems = await pb.collections.getOne("sale_items");
    (saleItems as any).fields.forEach((f: any) => {
        if (!f.system) console.log(`  - ${f.name} (${f.type})`);
    });

    // Get stock_movements collection schema
    console.log("\n=== STOCK_MOVEMENTS COLLECTION ===");
    const movements = await pb.collections.getOne("stock_movements");
    (movements as any).fields.forEach((f: any) => {
        if (!f.system) console.log(`  - ${f.name} (${f.type})`);
    });

    // Get cash_register_shifts schema
    console.log("\n=== CASH_REGISTER_SHIFTS COLLECTION ===");
    const shifts = await pb.collections.getOne("cash_register_shifts");
    (shifts as any).fields.forEach((f: any) => {
        if (!f.system) console.log(`  - ${f.name} (${f.type})`);
    });
}
main();
