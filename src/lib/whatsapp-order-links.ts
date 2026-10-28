/**
 * Chat ↔ order linkage (A32).
 *
 * An order built from a WhatsApp conversation used to reference the chat only
 * inside free text. These two relations make the conversation and the order
 * discoverable from each other: the chat keeps its latest order and the message
 * that triggered catalog ingestion points at the order it created.
 */

import { pb } from './pocketbase';

export interface ChatOrderLink {
    tenantEmail: string;
    chatId?: string;
    messageId?: string;
    orderId: string;
}

/** Best-effort backlink from the conversation/message to the created order. */
export async function linkChatOrder(db: typeof pb, link: ChatOrderLink): Promise<void> {
    if (!link.orderId) return;
    const tenant = link.tenantEmail || '';

    if (link.chatId) {
        try {
            const chat = await db
                .collection('whatsapp_chats')
                .getFirstListItem(
                    pb.filter('chat_id = {:chat} && account_email = {:account}', {
                        chat: link.chatId,
                        account: tenant,
                    }),
                    { requestKey: null }
                )
                .catch(() => null);
            if (chat) {
                await db.collection('whatsapp_chats').update(chat.id, { last_order: link.orderId });
            }
        } catch (err) {
            console.warn('[whatsapp-order-links] Could not link chat:', err);
        }
    }

    if (link.messageId) {
        try {
            const message = await db
                .collection('whatsapp_messages')
                .getFirstListItem(
                    pb.filter('message_id = {:message} && account_email = {:account}', {
                        message: link.messageId,
                        account: tenant,
                    }),
                    { requestKey: null }
                )
                .catch(() => null);
            if (message) {
                await db.collection('whatsapp_messages').update(message.id, { order: link.orderId });
            }
        } catch (err) {
            console.warn('[whatsapp-order-links] Could not link message:', err);
        }
    }
}