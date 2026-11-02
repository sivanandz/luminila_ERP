/**
 * Stored WhatsApp messages used by the photo-tagging picker.
 */

import { pb } from './pocketbase';
import { withTenantFilter, recordBelongsToTenant } from './whatsapp-crm';

export interface StoredWhatsAppMessage {
    id: string;
    message_id?: string;
    message_type?: string;
    media_url?: string;
    sender_name?: string;
    timestamp?: string;
}

export async function listStoredWhatsAppMessages(): Promise<StoredWhatsAppMessage[]> {
    const records = await pb.collection('whatsapp_messages').getFullList({
        // WA-04: an unscoped list leaked every tenant's transcribed messages to
        // the image picker (including media URLs).
        filter: withTenantFilter(),
        sort: '-timestamp',
        requestKey: null,
    });
    return (records as StoredWhatsAppMessage[]).filter((record) =>
        recordBelongsToTenant(record as unknown as { account_email?: string })
    );
}
