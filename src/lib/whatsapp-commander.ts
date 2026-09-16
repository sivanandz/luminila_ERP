import { pb } from '@/lib/pocketbase';

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

    const parts = body.slice(1).trim().split(" ");
    const command = parts[0].toLowerCase();
    const orderIdSnippet = parts[1];

    if (!orderIdSnippet) return "⚠️ Please provide an Order ID (e.g., !paid a1b2)";

    try {
        // Find matching order
        const orders = await pb.collection('sales_orders').getFullList({
            filter: `id~"${orderIdSnippet}"`,
        });

        if (!orders || orders.length === 0) {
            return `❌ Order matching "${orderIdSnippet}" not found.`;
        }

        const order = orders[0];
        const shortId = order.id.slice(0, 8);

        // Execute Command
        switch (command) {
            case "paid":
                await pb.collection('sales_orders').update(order.id, { payment_status: "PAID" });
                return `✅ Order #${shortId} marked as **PAID**.`;

            case "ship":
            case "shipped":
                await pb.collection('sales_orders').update(order.id, { status: "SHIPPED" });
                return `🚚 Order #${shortId} marked as **SHIPPED**.`;

            case "cancel":
                await pb.collection('sales_orders').update(order.id, { status: "CANCELLED" });
                return `🚫 Order #${shortId} has been **CANCELLED**.`;

            case "status":
                return `ℹ️ Order #${shortId}\nStatus: ${order.status}\nPayment: ${order.payment_status || 'PENDING'}\nTotal: ${formatPrice(order.total_amount || order.total)}`;

            case "paylink": {
                const { createPaymentLink } = await import('@/lib/razorpay');
                const totalAmount = order.total || order.subtotal || 0;
                const linkRes = await createPaymentLink({
                    orderId: order.id,
                    amount: totalAmount,
                    customerName: order.customer_name,
                    customerPhone: order.customer_phone,
                    description: `Luminila Jewels Order #${shortId}`,
                });

                if (linkRes.success && linkRes.data?.short_url) {
                    await pb.collection('sales_orders').update(order.id, {
                        razorpay_link_id: linkRes.data.id,
                    });
                    return `💳 *Payment Link for Order #${shortId}*\nAmount: ${formatPrice(totalAmount)}\n🔗 Pay Here: ${linkRes.data.short_url}`;
                }
                return `❌ Failed to create Razorpay link: ${linkRes.error || 'Unknown error'}`;
            }

            case "invoice": {
                const { sendPaidOrderInvoice } = await import('@/lib/whatsapp-notifications');
                const res = await sendPaidOrderInvoice(order.id);
                return res.success
                    ? `🧾 GST Invoice sent to customer for Order #${shortId}.`
                    : `⚠️ Failed to send invoice: ${res.error}`;
            }

            case "help":
                return `🤖 *Admin Commands:*\n!paid <id> — Mark paid\n!paylink <id> — Send Razorpay link\n!ship <id> — Mark shipped\n!invoice <id> — Send GST invoice\n!cancel <id> — Cancel order\n!status <id> — View order status`;

            default:
                return null;
        }
    } catch (err: any) {
        console.error("Command Error:", err);
        return `⚠️ Error executing command: ${err.message}`;
    }
}

const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(amount);
};
