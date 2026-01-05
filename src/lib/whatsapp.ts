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
    fromMe: boolean;
    type: string; // chat, image, video, document, ptt, audio, sticker, link
    caption?: string;
    mediaUrl?: string;
    mimetype?: string;
    filename?: string;
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
        return data.qrCode || null;
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
        // If session exists but not connected and no QR, it's stale - treat as disconnected
        // This allows the Connect button to appear again
        return "DISCONNECTED";
    } catch {
        return "DISCONNECTED";
    }
}

/**
 * Close/logout WhatsApp session
 */
export async function closeSession(sessionId: string): Promise<boolean> {
    try {
        // First try the logout endpoint for clean disconnect
        const logoutResponse = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/logout`, {
            method: "POST",
        });
        if (logoutResponse.ok) return true;

        // Fallback to close endpoint
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/close`, {
            method: "POST",
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Send an image message
 */
export async function sendImage(
    sessionId: string,
    chatId: string,
    base64Image: string,
    caption?: string,
    filename?: string
): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/send-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone: chatId,
                base64: base64Image,
                filename: filename || "image.jpg",
                caption: caption || ""
            })
        });
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}

/**
 * Send a file/document
 */
export async function sendFile(
    sessionId: string,
    chatId: string,
    base64File: string,
    filename: string,
    caption?: string
): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/send-file`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone: chatId,
                base64: base64File,
                filename,
                caption: caption || ""
            })
        });
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}

/**
 * Mark chat as read
 */
export async function markAsRead(sessionId: string, chatId: string): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/mark-as-read/${encodeURIComponent(chatId)}`, {
            method: "POST"
        });
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}

/**
 * Set presence/typing indicator
 */
export async function setTyping(sessionId: string, chatId: string, isTyping: boolean): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/set-presence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chatId,
                typing: isTyping
            })
        });
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}

/**
 * Reply to a specific message
 */
export async function replyToMessage(
    sessionId: string,
    chatId: string,
    message: string,
    replyToMessageId: string
): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/reply-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone: chatId,
                message,
                messageId: replyToMessageId
            })
        });
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}

/**
 * Forward a message to another chat
 */
export async function forwardMessage(
    sessionId: string,
    messageId: string,
    toChatId: string
): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/forward-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messageId,
                to: toChatId
            })
        });
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}

/**
 * Delete a message
 */
export async function deleteMessage(
    sessionId: string,
    messageId: string,
    forEveryone: boolean = false
): Promise<boolean> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/delete-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messageId,
                forEveryone
            })
        });
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}


/**
 * Get all chats/conversations
 */
export interface WPPChat {
    id: string;
    name: string;
    isGroup: boolean;
    timestamp: number;
    unreadCount: number;
    profilePic?: string | null;
    lastMessage?: {
        body: string;
        timestamp: number;
    };
}

export async function getAllChats(sessionId: string): Promise<WPPChat[]> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/chats`);
        if (!response.ok) return [];

        const data = await response.json();
        return (data.chats || []).map((chat: any) => ({
            id: chat.id?._serialized || chat.id,
            name: chat.name || chat.contact?.pushname || chat.contact?.name || "Unknown",
            isGroup: chat.isGroup || false,
            timestamp: chat.t || chat.timestamp || 0,
            unreadCount: chat.unreadCount || 0,
            profilePic: chat.profilePicThumbObj?.eurl || chat.contact?.profilePicThumbObj?.eurl || null,
            lastMessage: chat.lastMessage ? {
                body: chat.lastMessage.body || "",
                timestamp: chat.lastMessage.t || chat.lastMessage.timestamp || 0
            } : undefined
        }));
    } catch {
        return [];
    }
}

/**
 * Get profile picture for a contact
 * Returns the direct URL (eurl) or base64 data from ProfilePicThumbObj
 */
export async function getProfilePicture(sessionId: string, contactId: string): Promise<string | null> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/profile-pic/${encodeURIComponent(contactId)}`);
        if (!response.ok) return null;

        const data = await response.json();
        if (!data.success || !data.profilePic) return null;

        // ProfilePicThumbObj has eurl (external URL) or img (base64)
        const pic = data.profilePic;
        if (typeof pic === 'string') return pic;
        return pic.eurl || pic.img || pic.imgFull || null;
    } catch (e) {
        console.error('Error fetching profile pic:', e);
        return null;
    }
}

/**
 * Download media from a message
 * Returns data URI (data:mimetype;base64,...)
 */
export async function downloadMedia(sessionId: string, messageId: string): Promise<string | null> {
    try {
        console.log('[WPP] Downloading media for message:', messageId);
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/download-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId })
        });

        if (!response.ok) {
            console.error('[WPP] Download media failed:', response.status);
            return null;
        }

        const data = await response.json();
        if (!data.success) {
            console.error('[WPP] Download media error:', data.error);
            return null;
        }

        console.log('[WPP] Media downloaded, has URL:', !!data.mediaUrl);
        return data.mediaUrl || null;
    } catch (e) {
        console.error('[WPP] Download media exception:', e);
        return null;
    }
}

/**
 * Get messages from a specific chat
 */
export async function getChatMessages(sessionId: string, chatId: string, count = 20): Promise<WPPMessage[]> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/messages/${encodeURIComponent(chatId)}?count=${count}`);
        if (!response.ok) return [];

        const data = await response.json();
        return (data.messages || []).map((msg: any) => {
            const isMediaType = ['image', 'sticker', 'video', 'ptt', 'audio', 'document'].includes(msg.type);

            return {
                id: msg.id?._serialized || msg.id,
                from: msg.from,
                to: msg.to,
                // For media messages, body often contains base64 - use caption instead
                body: isMediaType ? (msg.caption || '') : (msg.body || msg.caption || ''),
                timestamp: msg.t || msg.timestamp || 0,
                isGroupMsg: msg.isGroupMsg || false,
                fromMe: msg.fromMe || msg.id?.fromMe || false,
                type: msg.type || 'chat',
                caption: msg.caption || '',
                // DON'T use msg.body as fallback - it contains raw base64 for images
                // Let the frontend call downloadMedia instead
                mediaUrl: msg.deprecatedMms3Url || (typeof msg.mediaUrl === 'string' && msg.mediaUrl.startsWith('http') ? msg.mediaUrl : ''),
                mimetype: msg.mimetype || '',
                filename: msg.filename || '',
                sender: {
                    name: msg.sender?.name || '',
                    pushname: msg.sender?.pushname || '',
                    phone: msg.sender?.id?.user || ''
                }
            };
        });
    } catch {
        return [];
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
/**
 * Request Pairing Code for Phone Login
 */
export async function requestPairingCode(sessionId: string, phone: string): Promise<string | null> {
    try {
        const response = await fetch(`${WPPCONNECT_URL}/api/${sessionId}/pair-phone`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone })
        });
        const data = await response.json();
        return data.success ? data.code : null;
    } catch {
        return null;
    }
}

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

    async requestPairingCode(phone: string): Promise<string | null> {
        return requestPairingCode(this.sessionId, phone);
    }

    async sendMessage(phone: string, message: string): Promise<boolean> {
        return sendMessage(this.sessionId, phone, message);
    }

    async getChats(): Promise<WPPChat[]> {
        return getAllChats(this.sessionId);
    }

    async getMessages(chatId: string, count = 20): Promise<WPPMessage[]> {
        return getChatMessages(this.sessionId, chatId, count);
    }

    async downloadMedia(messageId: string): Promise<string | null> {
        return downloadMedia(this.sessionId, messageId);
    }

    async getProfilePic(contactId: string): Promise<string | null> {
        return getProfilePicture(this.sessionId, contactId);
    }

    async sendOrderConfirmation(
        phone: string,
        order: Parameters<typeof sendOrderConfirmation>[2]
    ): Promise<boolean> {
        return sendOrderConfirmation(this.sessionId, phone, order);
    }

    // New methods added from audit
    async sendImage(chatId: string, base64: string, caption?: string, filename?: string): Promise<boolean> {
        return sendImage(this.sessionId, chatId, base64, caption, filename);
    }

    async sendFile(chatId: string, base64: string, filename: string, caption?: string): Promise<boolean> {
        return sendFile(this.sessionId, chatId, base64, filename, caption);
    }

    async markAsRead(chatId: string): Promise<boolean> {
        return markAsRead(this.sessionId, chatId);
    }

    async setTyping(chatId: string, isTyping: boolean): Promise<boolean> {
        return setTyping(this.sessionId, chatId, isTyping);
    }

    async replyToMessage(chatId: string, message: string, replyToMessageId: string): Promise<boolean> {
        return replyToMessage(this.sessionId, chatId, message, replyToMessageId);
    }

    async forwardMessage(messageId: string, toChatId: string): Promise<boolean> {
        return forwardMessage(this.sessionId, messageId, toChatId);
    }

    async deleteMessage(messageId: string, forEveryone: boolean = false): Promise<boolean> {
        return deleteMessage(this.sessionId, messageId, forEveryone);
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
