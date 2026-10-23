/**
 * Stored WhatsApp messages used by the photo-tagging picker.
 */

import { pb } from './pocketbase';

export interface StoredWhatsAppMessage {
    id: string;
    message_id?: string;
    message_type?: string;
    media_url?: string;
    sender_name?: string;
    timestamp?: string;
}

export async function listStoredWhatsAppMessages(): Promise<StoredWhatsAppMessage[]> {
    return pb.collection('whatsapp_messages').getFullList({
        sort: '-timestamp',
        requestKey: null,
    }) as Promise<StoredWhatsAppMessage[]>;
}
