/**
 * WhatsApp Service Layer
 * Manages connection to WPPConnect-Server sidecar
 * 
 * WPPConnect runs as a local Node.js server bundled with Tauri.
 * It provides REST API for WhatsApp Web automation.
 */

// Use 127.0.0.1 for more reliable localhost connections
const WPPCONNECT_URL = "http://127.0.0.1:21465";


interface WPPSession {
    id: string;
    status: "CONNECTED" | "DISCONNECTED" | "INITIALIZING" | "QR_CODE";
    qrCode?: string;
}

export interface WPPMessage {
    id: string;
    from: string;
    to: string;
    body: string;
    timestamp: number;
    isGroupMsg: boolean;
    sender: {
        name: string;
        pushname: string;
        phone: string;
    };
}

interface WPPContact {
    id: string;
    name: string;
    pushname: string;
    phone: string;
    isMyContact: boolean;
    isGroup: boolean;
}

/**
 * Check if WPPConnect server is running
 */
export async function checkWPPConnectStatus(): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/status`);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Start a new WhatsApp session
 */
export async function startSession(sessionId: string): Promise<WPPSession | null> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) throw new Error("Failed to start session");

        const data = await response.json();
        return {
            id: sessionId,
            status: data.status,
            qrCode: data.qrcode,
        };
    } catch (err) {
        console.error("Failed to start WhatsApp session:", err);
        return null;
    }
}

/**
 * Get QR code for session authentication
 */
export async function getSessionQR(sessionId: string): Promise<string | null> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/qrcode`);
        if (!response.ok) return null;

        const data = await response.json();
        return data.qrcode || null;
    } catch {
        return null;
    }
}

/**
 * Check session status
 */
export async function getSessionStatus(sessionId: string): Promise<WPPSession["status"]> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/status`);
        if (!response.ok) return "DISCONNECTED";

        const data = await response.json();
        if (data.connected) return "CONNECTED";
        if (data.qrReady) return "QR_CODE";
        if (data.exists) return "INITIALIZING";

        return "DISCONNECTED";
    } catch {
        return "DISCONNECTED";
    }
}

/**
 * Close WhatsApp session
 */
export async function closeSession(sessionId: string): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/close`, {
            method: "POST",
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Send a text message
 */
export async function sendMessage(
    sessionId: string,
    phone: string,
    message: string
): Promise<boolean> {
    try {
        // Format phone number (remove non-digits, ensure country code)
        const formattedPhone = phone.replace(/\D/g, "");

        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/send-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone: formattedPhone,
                message,
                isGroup: false,
            }),
        });

        return response.ok;
    } catch (err) {
        console.error("Failed to send message:", err);
        return false;
    }
}

/**
 * Send order confirmation message
 */
export async function sendOrderConfirmation(
    sessionId: string,
    phone: string,
    orderDetails: {
        orderId: string;
        items: { name: string; quantity: number; price: number }[];
        total: number;
    }
): Promise<boolean> {
    const itemsList = orderDetails.items
        .map((item) => `• ${item.name} x${item.quantity} - ₹${item.price.toLocaleString("en-IN")}`)
        .join("\n");

    const message = `🛍️ *Order Confirmation*

Order ID: *${orderDetails.orderId}*

*Items:*
${itemsList}

*Total: ₹${orderDetails.total.toLocaleString("en-IN")}*

Thank you for your order! We'll update you when it ships.

_Zennila - Fashion Jewelry_`;

    return sendMessage(sessionId, phone, message);
}

/**
 * Send shipping update message
 */
export async function sendShippingUpdate(
    sessionId: string,
    phone: string,
    orderDetails: {
        orderId: string;
        trackingId?: string;
        estimatedDelivery?: string;
    }
): Promise<boolean> {
    const message = `📦 *Shipping Update*

Your order *${orderDetails.orderId}* has been shipped!

${orderDetails.trackingId ? `Tracking ID: ${orderDetails.trackingId}` : ""}
${orderDetails.estimatedDelivery ? `Expected Delivery: ${orderDetails.estimatedDelivery}` : ""}

_Zennila - Fashion Jewelry_`;

    return sendMessage(sessionId, phone, message);
}

/**
 * Get unread messages
 */
export async function getUnreadMessages(sessionId: string): Promise<WPPMessage[]> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/unread-messages`);
        if (!response.ok) return [];

        const data = await response.json();
        return data.messages || [];
    } catch {
        return [];
    }
}

/**
 * Parse order from message text
 * Looks for patterns like "order: item1, item2" or product SKUs
 */
export function parseOrderFromMessage(message: string): {
    isOrder: boolean;
    items: string[];
    customerIntent: string;
} {
    const lowerMessage = message.toLowerCase();

    // Check for order keywords
    const orderKeywords = ["order", "buy", "purchase", "want", "need", "book", "interested"];
    const hasOrderIntent = orderKeywords.some((kw) => lowerMessage.includes(kw));

    // Extract potential SKUs (LUM-XXX-XXX pattern)
    const skuPattern = /LUM-[A-Z]{3}-\d{3}(-[A-Z0-9]+)?/gi;
    const skus = message.match(skuPattern) || [];

    // Extract product mentions
    const productKeywords = ["earring", "necklace", "bracelet", "ring", "anklet", "chain", "pendant"];
    const mentionedProducts = productKeywords.filter((pk) => lowerMessage.includes(pk));

    const items = [...skus, ...mentionedProducts];

    return {
        isOrder: hasOrderIntent && items.length > 0,
        items,
        customerIntent: hasOrderIntent ? "purchase" : "inquiry",
    };
}

/**
 * Generate auto-reply based on message content
 */
export function generateAutoReply(
    message: string,
    products: { name: string; price: number; sku: string }[]
): string | null {
    const lowerMessage = message.toLowerCase();

    // Price inquiry
    if (lowerMessage.includes("price") || lowerMessage.includes("cost") || lowerMessage.includes("rate")) {
        const priceList = products
            .slice(0, 5)
            .map((p) => `• ${p.name}: ₹${p.price.toLocaleString("en-IN")}`)
            .join("\n");

        return `Here are our popular items:\n\n${priceList}\n\nReply with the product name to order!`;
    }

    // Availability check
    if (lowerMessage.includes("available") || lowerMessage.includes("stock") || lowerMessage.includes("have")) {
        return "Yes, we have these items in stock! Would you like to place an order? Reply with the product name.";
    }

    // Greeting
    if (lowerMessage.match(/^(hi|hello|hey|good morning|good evening)/)) {
        return "Hello! 👋 Welcome to Zennila. How can I help you today?\n\nReply with 'catalog' to see our collection.";
    }

    // Catalog request
    if (lowerMessage.includes("catalog") || lowerMessage.includes("collection") || lowerMessage.includes("products")) {
        return "Check out our collection at zennila.com 🛍️\n\nOr reply with what you're looking for!";
    }

    return null;
}

/**
 * WhatsApp session state management
 */
export class WhatsAppManager {
    private sessionId: string;
    private pollInterval: NodeJS.Timeout | null = null;
    private messageCallback: ((messages: WPPMessage[]) => void) | null = null;

    constructor(sessionId: string = "luminila") {
        this.sessionId = sessionId;
    }

    async connect(): Promise<boolean> {
        const session = await startSession(this.sessionId);
        return !!session;
    }

    async disconnect(): Promise<void> {
        await closeSession(this.sessionId);
        this.stopPolling();
    }

    async getStatus(): Promise<WPPSession["status"]> {
        return getSessionStatus(this.sessionId);
    }

    async getQR(): Promise<string | null> {
        return getSessionQR(this.sessionId);
    }

    async sendMessage(phone: string, message: string): Promise<boolean> {
        return sendMessage(this.sessionId, phone, message);
    }

    async sendOrderConfirmation(
        phone: string,
        order: Parameters<typeof sendOrderConfirmation>[2]
    ): Promise<boolean> {
        return sendOrderConfirmation(this.sessionId, phone, order);
    }

    startPolling(callback: (messages: WPPMessage[]) => void, intervalMs = 5000): void {
        this.messageCallback = callback;
        this.pollInterval = setInterval(async () => {
            const messages = await getUnreadMessages(this.sessionId);
            if (messages.length > 0 && this.messageCallback) {
                this.messageCallback(messages);
            }
        }, intervalMs);
    }

    stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
}

// Singleton instance
export const whatsappManager = new WhatsAppManager();
