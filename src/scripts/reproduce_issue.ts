
import { getCustomers } from '../lib/customers';
import { getDashboardStats } from '../lib/analytics';
import { pb } from '../lib/pocketbase';


async function test() {
    try {
        console.log("Testing getCustomers...");
        await getCustomers();
        console.log("getCustomers passed.");
    } catch (e: any) {
        console.error("getCustomers failed:", e);
    }

    try {
        console.log("Testing getDashboardStats...");
        await getDashboardStats();
        console.log("getDashboardStats passed.");
    } catch (e: any) {
        console.error("getDashboardStats failed:", e);
    }

    try {
        console.log("Testing Realtime Subscribe...");
        // Emulate browser behavior
        await pb.collection('products').subscribe('*', (e) => {
            console.log("Received event", e.action);
        });
        console.log("Subscribe initiated successfully.");

        // Wait 5 seconds
        await new Promise(resolve => setTimeout(resolve, 5000));

        pb.collection('products').unsubscribe('*');
        console.log("Unsubscribe successful.");
    } catch (e: any) {
        console.error("Realtime failed:", e);
    }
}

test();
