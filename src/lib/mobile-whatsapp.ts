/**
 * Luminila Mobile WhatsApp Service
 * Dual-mode WhatsApp handler:
 * 1. Dispatches automated message via showroom WPPConnect sidecar (if reachable)
 * 2. Falls back to native Android intent: `whatsapp://send` / `wa.me/` for 1-tap dispatch
 */

export interface WhatsAppOrderMessageData {
    customerPhone: string;
    customerName?: string;
    storeName?: string;
    invoiceNo: string;
    date: string;
    items: Array<{ name: string; quantity: number; total: number }>;
    grandTotal: number;
    paymentMethod: string;
}

export class MobileWhatsApp {
    /**
     * Standardize Indian and international phone numbers to international format without + or dashes
     */
    static formatPhoneNumber(phone: string): string {
        const cleaned = phone.replace(/[^0-9]/g, '');
        if (cleaned.length === 10) {
            return `91${cleaned}`;
        }
        return cleaned;
    }

    /**
     * Build formatted jewelry invoice text message
     */
    static formatInvoiceMessage(data: WhatsAppOrderMessageData): string {
        const store = data.storeName || 'Luminila Fashion Jewelry';
        const lines: string[] = [
            `✨ *${store}* ✨`,
            `Thank you for your purchase, *${data.customerName || 'Valued Customer'}*!`,
            ``,
            `📄 *Invoice No:* ${data.invoiceNo}`,
            `📅 *Date:* ${data.date}`,
            `💳 *Payment:* ${data.paymentMethod.toUpperCase()}`,
            ``,
            `🛍️ *Items Purchased:*`,
        ];

        data.items.forEach((it, idx) => {
            lines.push(`${idx + 1}. ${it.name} (x${it.quantity}) - ₹${it.total.toFixed(2)}`);
        });

        lines.push(``);
        lines.push(`💰 *Grand Total: ₹${data.grandTotal.toFixed(2)}*`);
        lines.push(``);
        lines.push(`We hope your new jewelry adds extra sparkle to your day! 💎`);
        lines.push(`Visit us again soon.`);

        return lines.join('\n');
    }

    /**
     * Dispatch WhatsApp receipt
     * Tries remote WPPConnect first, falls back to native Android Intent
     */
    static async sendReceipt(
        data: WhatsAppOrderMessageData,
        wppServerUrl?: string
    ): Promise<{ method: 'sidecar' | 'intent'; success: boolean }> {
        const targetPhone = this.formatPhoneNumber(data.customerPhone);
        if (!targetPhone) {
            throw new Error('Valid phone number is required');
        }

        const messageText = this.formatInvoiceMessage(data);

        // 1. Try remote WPPConnect sidecar if URL is configured
        if (wppServerUrl) {
            try {
                const response = await fetch(`${wppServerUrl.replace(/\/+$/, '')}/api/send-message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: targetPhone,
                        message: messageText,
                    }),
                    signal: AbortSignal.timeout(3000), // 3s timeout
                });

                if (response.ok) {
                    return { method: 'sidecar', success: true };
                }
            } catch (err) {
                console.warn('WPPConnect sidecar unreachable, falling back to Android intent:', err);
            }
        }

        // 2. Fallback to native Android WhatsApp Intent / wa.me link
        this.openWhatsAppIntent(targetPhone, messageText);
        return { method: 'intent', success: true };
    }

    /**
     * Open native WhatsApp with prefilled message
     */
    static openWhatsAppIntent(phone: string, text: string) {
        if (typeof window === 'undefined') return;
        const encodedText = encodeURIComponent(text);
        
        // Deep link for Android
        const intentUrl = `whatsapp://send?phone=${phone}&text=${encodedText}`;
        const webUrl = `https://wa.me/${phone}?text=${encodedText}`;

        // Attempt intent, fallback to webUrl
        try {
            window.location.href = intentUrl;
        } catch {
            window.open(webUrl, '_blank');
        }
    }
}
