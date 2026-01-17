"use strict";
import PocketBase from "pocketbase";

async function main() {
    const pb = new PocketBase("http://127.0.0.1:8090");
    await pb.admins.authWithPassword("admin@luminila.com", "password123");

    // Get user_roles collection structure
    const userRoles = await pb.collections.getOne("user_roles");
    console.log("User_roles collection fields:");
    (userRoles as any).fields.forEach((f: any) => {
        if (!f.system) console.log(`  - ${f.name} (${f.type})`);
    });

    // Get sample user_roles records
    const records = await pb.collection("user_roles").getFullList({ expand: "user,role" });
    console.log("\nUser role assignments:");
    records.forEach(r => {
        const user = (r as any).expand?.user;
        const role = (r as any).expand?.role;
        console.log(`  - User: ${user?.email || (r as any).user} -> Role: ${role?.name || (r as any).role}`);
    });
}
main();
