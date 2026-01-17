"use strict";
import PocketBase from "pocketbase";

async function main() {
    const pb = new PocketBase("http://127.0.0.1:8090");
    await pb.admins.authWithPassword("admin@luminila.com", "password123");

    const col = await pb.collections.getOne("delivery_challans");
    console.log("Collection:", col.name);
    console.log("List Rule:", (col as any).listRule || "(empty)");
    console.log("View Rule:", (col as any).viewRule || "(empty)");
    console.log("Create Rule:", (col as any).createRule || "(empty)");
    console.log("Update Rule:", (col as any).updateRule || "(empty)");
    console.log("Delete Rule:", (col as any).deleteRule || "(empty)");
}
main();
