import { supabase } from "@/lib/supabase";

/**
 * Parses and executes admin commands from WhatsApp messages.
 * Supported commands:
 * !paid <order_id_snippet>
 * !ship <order_id_snippet>
 * !cancel <order_id_snippet>
 * !status <order_id_snippet>
 */
export async function processAdminCommand(body: string, sender: string): Promise<string | null> {
    if (!body.startsWith("!")) return null;

    // 1. Authentication (Simple Whitelist)
    // In a real app, fetch this from Settings table. For now, we allow all or check env.
    // const adminPhone = localStorage.getItem("admin_phone"); // Can't access localStorage in non-component if strictly lib, but this runs in client.
    // if (adminPhone && !sender.includes(adminPhone)) return "⛔ Unauthorized";

    const parts = body.slice(1).trim().split(" ");
    const command = parts[0].toLowerCase();
    const orderIdSnippet = parts[1];

    if (!orderIdSnippet) return "⚠️ Please provide an Order ID (e.g., !paid a1b2)";

    const ordersTable = supabase.from("orders") as any;

    // 2. Resolve Order
    const { data: orders, error } = await ordersTable
        .select("*")
        .ilike("id", `${orderIdSnippet}%`)
        .limit(1);

    if (error || !orders || orders.length === 0) {
        return `❌ Order matching "${orderIdSnippet}" not found.`;
    }

    const order = orders[0];
    const shortId = order.id.slice(0, 8);

    // 3. Execute Command
    try {
        switch (command) {
            case "paid":
                await ordersTable
                    .update({ payment_status: "PAID" })
                    .eq("id", order.id);
                return `✅ Order #${shortId} marked as **PAID**.`;

            case "ship":
            case "shipped":
                await ordersTable
                    .update({ status: "SHIPPED" })
                    .eq("id", order.id);
                return `🚚 Order #${shortId} marked as **SHIPPED**.`;

            case "cancel":
                await ordersTable
                    .update({ status: "CANCELLED" })
                    .eq("id", order.id);
                return `🚫 Order #${shortId} has been **CANCELLED**.`;

            case "status":
                return `ℹ️ Order #${shortId}\nStatus: ${order.status}\nPayment: ${order.payment_status}\nTotal: ${formatPrice(order.total_amount)}`;

            case "help":
                return `🤖 *Admin Commands:*\n!paid <id>\n!ship <id>\n!cancel <id>\n!status <id>`;

            default:
                return null; // Not a recognized command
        }
    } catch (err: any) {
        console.error("Command Error:", err);
        return `⚠️ Error executing command: ${err.message}`;
    }
}

// Helper for price formatting if needed, or import it
const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(amount);
};
