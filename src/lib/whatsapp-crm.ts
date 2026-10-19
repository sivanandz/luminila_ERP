/**
 * WhatsApp ERP/CRM Service Layer
 * Implements the Conversational Commerce spec (docs/WHATSAPP_ERP_CRM_SPECIFICATION.md):
 *  - §9  E.164 contact resolution: customer → vendor → auto-created lead
 *  - §12 PB persistence of chats & messages (whatsapp_chats / whatsapp_messages)
 *  - §10 Staff attribution tags on outgoing messages
 *  - §2  Two-tier intent detection + variant hint extraction
 *  - §8.2 Vendor offer parsing (purity / weight / price) for smart ingestion
 *  - §8.3 Live "Add to POS Cart" broadcast (BroadcastChannel + localStorage)
 *  - §8.2 Barcode tag print queue (label_print_queue)
 */

import { pb } from './pocketbase';
import {
    phoneFromChatId,
    findCustomerByPhone,
    createCustomerFromChat,
    type Customer,
} from './customer-lookup';
import { createGRN } from './purchase';
import { whatsappManager } from './whatsapp';
import {
    generateParentSKU,
    generateChildSKU,
    computeNextSkuSequence,
    deriveHSNCode,
} from './sku-generator';

// ===========================================
// TYPES
// ===========================================

export type ContactType = 'customer' | 'vendor' | 'lead';
export type ChatStatus = 'active' | 'archived' | 'pending_quote';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageType = 'text' | 'image' | 'document' | 'product_card' | 'payment_link';

export type IntentType =
    | 'STOCK_INQUIRY'
    | 'ORDER_STATUS'
    | 'PRICE_CHECK'
    | 'VENDOR_OFFER'
    | 'TALK_TO_STAFF'
    | 'CATALOG_REQUEST'
    | 'OPT_OUT'
    | 'UNKNOWN';

export interface StoredChat {
    id: string;
    chat_id: string;
    contact_type: ContactType;
    contact_name: string;
    customer?: string;
    vendor?: string;
    last_message_body?: string;
    last_message_time?: string;
    unread_count: number;
    status: ChatStatus;
    labels: string[];
    expand?: {
        customer?: Customer;
        vendor?: { id: string; name: string; company_name?: string; phone?: string };
    };
}

export interface StoredMessage {
    id: string;
    chat: string;
    message_id: string;
    from_me: boolean;
    sender_name: string;
    staff_user?: string;
    body: string;
    message_type: MessageType;
    media_url?: string;
    status: MessageStatus;
    timestamp?: string;
    created: string;
}

export interface ContactContext {
    type: ContactType;
    customer?: Customer | null;
    vendor?: { id: string; name: string; company_name?: string; phone?: string; gstin?: string } | null;
    labels?: string[];
}

/** Item shape pushed to the POS terminal (mirrors the POS page CartItem). */
export interface POSCartBroadcastItem {
    sku: string;
    name: string;
    variant: string;
    price: number;
    quantity: number;
    productId?: string;
    variantId?: string;
    sourceChatId?: string;
    addedByName?: string;
}

// ===========================================
// PHONE NORMALIZATION (E.164)
// ===========================================

/** Normalize any phone to E.164 (+91XXXXXXXXXX for India). */
export function normalizeE164(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    // Strip leading zeros
    digits = digits.replace(/^0+/, '');
    // Assume India when 10 digits
    if (digits.length === 10) digits = `91${digits}`;
    return `+${digits}`;
}

// ===========================================
// CONTACT RESOLUTION (spec §9)
// ===========================================

export async function findVendorByPhone(phone: string): Promise<ContactContext['vendor'] | null> {
    const digits = phoneFromChatId(phone) || phone.replace(/\D/g, '').slice(-10);
    if (!digits || digits.length < 10) return null;
    try {
        const v = await pb.collection('vendors').getFirstListItem(`phone~"${digits}"`);
        const vRow = v as unknown as { company_name?: string; gstin?: string };
        return {
            id: v.id,
            name: v.name,
            company_name: vRow.company_name || v.name,
            phone: v.phone,
            gstin: vRow.gstin,
        };
    } catch {
        return null;
    }
}

/**
 * Resolve a WhatsApp chat id to customer / vendor / new lead.
 * Unrecognized numbers get a `customers` record with lead_source 'whatsapp'.
 */
export async function resolveContact(
    chatId: string,
    chatName?: string,
    opts: { autoCreateLead?: boolean } = { autoCreateLead: true }
): Promise<ContactContext> {
    // Check existing whatsapp_chats record first to respect manually tagged types (like vendor groups)
    try {
        const existing = await pb.collection('whatsapp_chats').getFirstListItem(
            `chat_id="${chatId}"`
        ).catch(() => null);

        if (existing && existing.contact_type) {
            let vendor = null;
            if (existing.vendor) {
                try {
                    const v = await pb.collection('vendors').getOne(existing.vendor);
                    const vRow = v as unknown as { company_name?: string; gstin?: string };
                    vendor = { id: v.id, name: v.name, company_name: vRow.company_name || v.name, phone: v.phone, gstin: vRow.gstin };
                } catch { /* ignore */ }
            }
            let customer = null;
            if (existing.customer) {
                try {
                    customer = await pb.collection('customers').getOne(existing.customer);
                } catch { /* ignore */ }
            }
            return {
                type: existing.contact_type as ContactType,
                vendor: vendor || undefined,
                customer: customer as any,
                labels: (existing.labels as string[]) || [],
            };
        }
    } catch { /* ignore */ }

    if (chatId.endsWith('@g.us') || chatId.endsWith('@newsletter')) {
        return { type: 'lead', customer: null, labels: [] };
    }

    const phone = phoneFromChatId(chatId) || '';

    const vendor = await findVendorByPhone(chatId);
    if (vendor) return { type: 'vendor', vendor };

    const customer = phone ? await findCustomerByPhone(phone) : null;
    if (customer) return { type: 'customer', customer };

    if (!opts.autoCreateLead) {
        return { type: 'lead', customer: null };
    }

    const lead = await createCustomerFromChat(chatName || 'WhatsApp Lead', chatId, phone || undefined);
    return { type: 'lead', customer: lead };
}

// ===========================================
// CHAT PERSISTENCE (spec §12.1)
// ===========================================

/** Upsert the whatsapp_chats record for a sidecar chat id. */
export async function ensureChat(opts: {
    chatId: string;
    contactName?: string;
    contactType?: ContactType;
    customer?: string | null;
    vendor?: string | null;
    lastMessageBody?: string;
    lastMessageTime?: string;
    unreadCount?: number;
    labels?: string[];
}): Promise<StoredChat | null> {
    try {
        const existing = await pb.collection('whatsapp_chats').getFirstListItem(
            `chat_id="${opts.chatId}"`
        ).catch(() => null);

        const patch: Record<string, unknown> = {
            contact_name: opts.contactName || existing?.contact_name || 'Unknown',
            last_message_body: opts.lastMessageBody ?? existing?.last_message_body ?? '',
            last_message_time: opts.lastMessageTime ?? existing?.last_message_time ?? new Date().toISOString(),
        };
        // Do not overwrite an existing 'vendor' categorization with a fallback 'lead'
        if (opts.contactType) {
            if (!existing?.contact_type || existing.contact_type === 'lead' || opts.contactType === 'vendor' || opts.contactType === 'customer') {
                patch.contact_type = opts.contactType;
            }
        }
        if (opts.customer !== undefined) patch.customer = opts.customer || '';
        if (opts.vendor !== undefined) patch.vendor = opts.vendor || '';
        if (opts.unreadCount !== undefined) patch.unread_count = opts.unreadCount;
        if (opts.labels !== undefined) patch.labels = opts.labels;

        if (existing) {
            const updated = await pb.collection('whatsapp_chats').update(existing.id, patch);
            return updated as unknown as StoredChat;
        }

        const created = await pb.collection('whatsapp_chats').create({
            chat_id: opts.chatId,
            contact_type: opts.contactType || 'lead',
            contact_name: opts.contactName || 'Unknown',
            customer: opts.customer || '',
            vendor: opts.vendor || '',
            last_message_body: opts.lastMessageBody || '',
            last_message_time: opts.lastMessageTime || new Date().toISOString(),
            unread_count: opts.unreadCount ?? 0,
            status: 'active',
            labels: opts.labels || [],
        });
        return created as unknown as StoredChat;
    } catch (err) {
        console.error('[whatsapp-crm] ensureChat failed:', err);
        return null;
    }
}

/** Retag a chat as customer / vendor / lead (spec §8.1 header pill + context toggle). */
export async function setChatContactType(
    chatRecordId: string,
    type: ContactType,
    links?: { customer?: string; vendor?: string; labels?: string[] }
): Promise<void> {
    const patch: Record<string, unknown> = { contact_type: type };
    if (links?.customer !== undefined) patch.customer = links.customer;
    if (links?.vendor !== undefined) patch.vendor = links.vendor;
    if (links?.labels !== undefined) patch.labels = links.labels;
    await pb.collection('whatsapp_chats').update(chatRecordId, patch);
}

/**
 * Tag or untag a chat (especially group chats) as a Vendor Group.
 * Vendor groups are where retailers receive catalog drops and new product pricing from suppliers.
 */
export async function setChatVendorGroup(
    chatId: string,
    isVendorGroup: boolean,
    chatName?: string
): Promise<{ contactType: ContactType; labels: string[] }> {
    try {
        const existing = await pb.collection('whatsapp_chats').getFirstListItem(
            `chat_id="${chatId}"`
        ).catch(() => null);

        let labels: string[] = existing?.labels ? (Array.isArray(existing.labels) ? [...existing.labels] : []) : [];

        if (isVendorGroup) {
            if (!labels.includes('vendor_group')) labels.push('vendor_group');
            const contactType: ContactType = 'vendor';
            if (existing) {
                await pb.collection('whatsapp_chats').update(existing.id, {
                    contact_type: contactType,
                    labels,
                });
            } else {
                await pb.collection('whatsapp_chats').create({
                    chat_id: chatId,
                    contact_name: chatName || 'Vendor Group',
                    contact_type: contactType,
                    labels,
                    unread_count: 0,
                    status: 'active',
                });
            }
            return { contactType, labels };
        } else {
            labels = labels.filter((l) => l !== 'vendor_group');
            const contactType: ContactType = 'lead';
            if (existing) {
                await pb.collection('whatsapp_chats').update(existing.id, {
                    contact_type: contactType,
                    labels,
                });
            }
            return { contactType, labels };
        }
    } catch (err) {
        console.error('[whatsapp-crm] setChatVendorGroup failed:', err);
        return { contactType: isVendorGroup ? 'vendor' : 'lead', labels: [] };
    }
}

export async function markChatRead(chatRecordId: string): Promise<void> {
    try {
        await pb.collection('whatsapp_chats').update(chatRecordId, { unread_count: 0 });
    } catch (err) {
        console.warn('[whatsapp-crm] markChatRead failed:', err);
    }
}

export async function getStoredChats(filter = ''): Promise<StoredChat[]> {
    try {
        const records = await pb.collection('whatsapp_chats').getFullList({
            filter,
            sort: '-last_message_time',
            expand: 'customer,vendor',
        });
        return records as unknown as StoredChat[];
    } catch {
        return [];
    }
}

/** Upsert sidecar messages into whatsapp_messages. Skips already-persisted ids. */
export async function persistMessages(
    chatRecordId: string,
    messages: {
        id: string;
        fromMe: boolean;
        senderName?: string;
        body?: string;
        type?: string;
        mediaUrl?: string;
        timestamp?: number;
    }[]
): Promise<void> {
    for (const m of messages) {
        try {
            const existing = await pb.collection('whatsapp_messages').getFirstListItem(
                `message_id="${m.id}"`
            ).catch(() => null);
            if (existing) continue;

            const messageType: MessageType =
                m.type === 'image' ? 'image'
                : m.type === 'document' ? 'document'
                : 'text';

            await pb.collection('whatsapp_messages').create({
                chat: chatRecordId,
                message_id: m.id,
                from_me: !!m.fromMe,
                sender_name: m.senderName || '',
                body: m.body || '',
                message_type: messageType,
                media_url: m.mediaUrl || '',
                status: m.fromMe ? 'sent' : 'delivered',
                timestamp: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : new Date().toISOString(),
            });
        } catch (err) {
            console.warn('[whatsapp-crm] persistMessages skip:', (err as Error)?.message);
        }
    }
}

export async function getStoredMessages(chatRecordId: string, limit = 50): Promise<StoredMessage[]> {
    try {
        const records = await pb.collection('whatsapp_messages').getList(1, limit, {
            filter: `chat="${chatRecordId}"`,
            sort: '-timestamp',
        });
        return (records.items as unknown as StoredMessage[]).reverse();
    } catch {
        return [];
    }
}

// ===========================================
// OUTBOUND SEND WITH STAFF ATTRIBUTION (spec §10)
// ===========================================

/**
 * Send a message on behalf of a staff member. Transparently prefixes the
 * attribution tag (e.g. "[Priya - Luminila Sales]") and persists the record.
 */
export async function sendStaffMessage(opts: {
    chatId: string;
    body: string;
    staffName?: string;
    staffUserId?: string;
    chatRecordId?: string;
    messageType?: MessageType;
}): Promise<boolean> {
    const attribution = opts.staffName ? `[${opts.staffName} - Luminila Sales]\n` : '';
    const ok = await whatsappManager.sendMessage(opts.chatId, `${attribution}${opts.body}`);

    try {
        let chatRecordId = opts.chatRecordId;
        if (!chatRecordId && opts.chatId) {
            const chatRec = await ensureChat({ chatId: opts.chatId }).catch(() => null);
            chatRecordId = chatRec?.id;
        }

        const msgPayload: Record<string, unknown> = {
            message_id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            from_me: true,
            sender_name: opts.staffName || 'Staff',
            body: opts.body,
            message_type: opts.messageType || 'text',
            status: ok ? 'sent' : 'failed',
            timestamp: new Date().toISOString(),
        };
        if (chatRecordId) msgPayload.chat = chatRecordId;
        if (opts.staffUserId) msgPayload.staff_user = opts.staffUserId;

        await pb.collection('whatsapp_messages').create(msgPayload);
    } catch (err) {
        console.warn('[whatsapp-crm] failed to persist outbound message:', err);
    }

    return ok;
}

// ===========================================
// INTENT DETECTION (spec §2)
// ===========================================

export function detectIntent(body: string): IntentType {
    const text = (body || '').toLowerCase();

    if (text.trim() === 'stop' || text.includes('opt out')) return 'OPT_OUT';
    if (/(talk|speak|call)\s*(to|with)?\s*(someone|staff|agent|human|person|manager)/.test(text)) return 'TALK_TO_STAFF';
    if (/\b(catalog|menu|collection|show me.*(products|items))\b/.test(text)) return 'CATALOG_REQUEST';
    if (/\b(where|status|track|shipped|dispatch|delivery|order)\b/.test(text) && /(\bINV-|\border\b|token|tracking)/.test(text)) return 'ORDER_STATUS';
    if (/(wholesale|consignment|karat|purity|per gram|stock available|fresh stock|new design)/.test(text) && /(g|gram|karat|k\b|piece|pcs|dozen)/.test(text)) return 'VENDOR_OFFER';
    if (/\b(price|cost|rate|how much|charges?)\b/.test(text)) return 'PRICE_CHECK';
    if (/\b(stock|available|availability|in stock|have size|size)\b/.test(text)) return 'STOCK_INQUIRY';
    return 'UNKNOWN';
}

export interface VariantHints {
    sku?: string;
    size?: string;
    color?: string;
    metal?: string;
    productKeywords: string[];
}

/** Smart-detect variant identifiers inside a customer message (spec §8.3). */
export function extractVariantHints(body: string): VariantHints {
    const text = body || '';

    const skuMatch =
        text.match(/\bLUM-[A-Z0-9-]+/i) ||
        text.match(/\b[A-Z]{2,5}-[A-Z0-9]{2,}(-[A-Z0-9]+)*/i);
    const sku = skuMatch ? skuMatch[0].toUpperCase() : undefined;

    const sizeMatch = text.match(/\bsize\s*[:#\-]?\s*(\d{1,2}(?:\.\d)?)\b/i);
    const size = sizeMatch ? sizeMatch[1] : undefined;

    const colorTable: [RegExp, string][] = [
        [/rose\s*gold/i, 'Rose Gold'],
        [/yellow\s*gold|\bgold\b/i, 'Yellow Gold'],
        [/\b(silver|925)\b/i, 'Silver'],
    ];
    let color: string | undefined;
    let metal: string | undefined;
    for (const [re, name] of colorTable) {
        if (re.test(text)) {
            color = name;
            metal = name;
            break;
        }
    }

    const productKeywords = ['ring', 'necklace', 'earring', 'bracelet', 'bangle', 'chain', 'pendant', 'anklet', 'choker', 'jhumka']
        .filter((kw) => text.toLowerCase().includes(kw));

    return { sku, size, color, metal, productKeywords };
}

// ===========================================
// VENDOR OFFER PARSING (spec §8.2)
// ===========================================

export interface VendorOfferExtraction {
    purity?: string;        // e.g. "18K" | "925 Silver"
    weightGrams?: number;   // e.g. 14.2
    price?: number;         // vendor cost price in ₹
    quantity?: number;
    category?: string;      // e.g. "Necklaces"
    genreCode?: string;     // e.g. "TMP"
    categoryCode?: string;  // e.g. "NEC"
    subcategoryCode?: string;// e.g. "CHK"
    platingCode?: string;   // e.g. "MG"
    colorCode?: string;     // e.g. "RB"
    baseMetalCode?: string; // e.g. "BR"
    stoneCode?: string;     // e.g. "KP"
    sizeCode?: string;      // e.g. "STD"
    descriptionHint?: string;
}

export function parseVendorOffer(body: string): VendorOfferExtraction {
    const text = body || '';

    const purityMatch = text.match(/\b(\d{2})\s*k(?:arat)?\b/i) || text.match(/\b(925)\b/);
    const purity = purityMatch ? (purityMatch[1] === '925' ? '925 Silver' : `${purityMatch[1]}K`) : undefined;

    const weightMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:g|grams?|gm)\b/i);
    const weightGrams = weightMatch ? parseFloat(weightMatch[1]) : undefined;

    const priceMatch =
        text.match(/(?:₹|rs\.?|inr|price|rate|cost)[:\s]*([\d,]+(?:\.\d{1,2})?)/i) ||
        text.match(/\b([\d,]{2,7})\s*(?:₹|rs|\/-|\+&|\+\s*ship(?:ping)?)/i) ||
        text.match(/@\s*([\d,]+(?:\.\d{1,2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : undefined;

    const qtyMatch = text.match(/(\d{1,3})\s*(?:pcs?|pieces?|nos|qty)/i);
    const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : undefined;

    // 1. Detect Genre
    let genreCode = 'TMP'; // Default Temple
    if (/kundan|jadau/i.test(text)) genreCode = 'KUN';
    else if (/polki/i.test(text)) genreCode = 'POL';
    else if (/antique|oxidized|vintage|blackened/i.test(text)) genreCode = 'ANT';
    else if (/covering|1\s*gm|micro|1\s*gram/i.test(text)) genreCode = 'COV';
    else if (/western|tennis|solitaire/i.test(text)) genreCode = 'WST';
    else if (/indo|fusion/i.test(text)) genreCode = 'IND';

    // 2. Detect Category & Subcategory
    let categoryCode = 'NEC';
    let subcategoryCode = 'CHK';
    let category = 'Necklaces';

    if (/choker/i.test(text)) {
        categoryCode = 'NEC';
        subcategoryCode = 'CHK';
        category = 'Necklaces';
    } else if (/necklace|neck piece|collar|pendant/i.test(text)) {
        categoryCode = 'NEC';
        subcategoryCode = /collar/i.test(text) ? 'COL' : (/pendant/i.test(text) ? 'PEN' : 'CHA');
        category = 'Necklaces';
    } else if (/haram|long chain|kasumalai|guttapusalu/i.test(text)) {
        categoryCode = 'HAR';
        subcategoryCode = /kasu/i.test(text) ? 'KAS' : (/gutta/i.test(text) ? 'GUT' : 'HAR');
        category = 'Harams (Long Chains)';
    } else if (/jhumka|jhumki|jimki/i.test(text)) {
        categoryCode = 'EAR';
        subcategoryCode = 'JHU';
        category = 'Earrings';
    } else if (/studs?|tops\b/i.test(text)) {
        categoryCode = 'EAR';
        subcategoryCode = 'STU';
        category = 'Earrings';
    } else if (/bali|hoops?/i.test(text)) {
        categoryCode = 'EAR';
        subcategoryCode = 'BAL';
        category = 'Earrings';
    } else if (/chandbali/i.test(text)) {
        categoryCode = 'EAR';
        subcategoryCode = 'CHB';
        category = 'Earrings';
    } else if (/danglers?|drop earrings?/i.test(text)) {
        categoryCode = 'EAR';
        subcategoryCode = 'DRP';
        category = 'Earrings';
    } else if (/earrings?/i.test(text)) {
        categoryCode = 'EAR';
        subcategoryCode = 'JHU';
        category = 'Earrings';
    } else if (/kada|kadas/i.test(text)) {
        categoryCode = 'BAN';
        subcategoryCode = 'KAD';
        category = 'Bangles & Kadas';
    } else if (/bangle|bangles/i.test(text)) {
        categoryCode = 'BAN';
        subcategoryCode = 'SGL';
        category = 'Bangles & Kadas';
    } else if (/bracelet/i.test(text)) {
        categoryCode = 'BAN';
        subcategoryCode = 'BRA';
        category = 'Bangles & Kadas';
    } else if (/ring|finger ring/i.test(text)) {
        categoryCode = 'RIN';
        subcategoryCode = 'ADJ';
        category = 'Finger Rings';
    } else if (/anklet|payal|golusu/i.test(text)) {
        categoryCode = 'PAY';
        subcategoryCode = 'PAY';
        category = 'Anklets / Payal';
    } else if (/tikka|maang|matha patti/i.test(text)) {
        categoryCode = 'MGT';
        subcategoryCode = 'TIK';
        category = 'Maang Tikka';
    } else if (/oddiyanam|waist|vaddanam|kamar/i.test(text)) {
        categoryCode = 'HIP';
        subcategoryCode = 'VAD';
        category = 'Waist Belt / Oddiyanam';
    } else if (/bridal set|set|combo/i.test(text)) {
        categoryCode = 'SET';
        subcategoryCode = 'SET';
        category = 'Coordinated Sets';
    }

    // 3. Detect Plating Finish
    let platingCode = 'MG'; // Default Micro Gold
    if (/matte finish|matte polish|matte/i.test(text)) platingCode = 'MF';
    else if (/antique polish|antique/i.test(text)) platingCode = 'AN';
    else if (/oxidized|black polish/i.test(text)) platingCode = 'OX';
    else if (/rhodium|silver polish/i.test(text)) platingCode = 'RH';
    else if (/rose gold/i.test(text)) platingCode = 'RG';
    else if (/two tone|dual tone/i.test(text)) platingCode = 'TT';

    // 4. Detect Primary Color
    let colorCode = 'RB'; // Default Ruby Red
    if (/ruby|kemp|kempu|red/i.test(text)) colorCode = 'RB';
    else if (/emerald|green|pacha/i.test(text)) colorCode = 'EM';
    else if (/white|cz|ad|clear/i.test(text)) colorCode = 'WH';
    else if (/baby pink|pink/i.test(text)) colorCode = 'PK';
    else if (/mint|mint green/i.test(text)) colorCode = 'MN';
    else if (/black|black onyx/i.test(text)) colorCode = 'BK';
    else if (/blue|royal blue/i.test(text)) colorCode = 'BL';
    else if (/multi|navratna/i.test(text)) colorCode = 'ML';

    // 5. Detect Base Metal
    let baseMetalCode = 'BR'; // Default Brass
    if (/copper|tamba/i.test(text)) baseMetalCode = 'CP';
    else if (/german silver/i.test(text)) baseMetalCode = 'GS';
    else if (/impon|panchaloha/i.test(text)) baseMetalCode = 'IP';

    // 6. Detect Stone
    let stoneCode = 'KP'; // Default Kempu
    if (/cz|ad|american diamond/i.test(text)) stoneCode = 'CZ';
    else if (/kundan|jadau/i.test(text)) stoneCode = 'KD';
    else if (/pearl|moti/i.test(text)) stoneCode = 'PR';
    else if (/plain|no stone/i.test(text)) stoneCode = 'PL';

    // 7. Detect Size
    let sizeCode = 'STD';
    const bangleSize = text.match(/\b(2[.\-](?:2|4|6|8|10|12))\b/);
    if (bangleSize) {
        sizeCode = bangleSize[1].replace(/[.\-]/, '0');
    }

    return {
        purity,
        weightGrams,
        price,
        quantity,
        category,
        genreCode,
        categoryCode,
        subcategoryCode,
        platingCode,
        colorCode,
        baseMetalCode,
        stoneCode,
        sizeCode,
        descriptionHint: text.slice(0, 200),
    };
}

/** Generate an Architectural Master SKU for vendor product intake */
export async function generateVendorSku(categoryCode?: string, subcategoryCode?: string, genreCode?: string): Promise<string> {
    const genre = genreCode || 'GEN';
    const cat = categoryCode || 'GEN';
    const subcat = subcategoryCode || 'GEN';
    const prefix = `${genre}${cat}${subcat}`;
    const nextSeq = await computeNextSkuSequence(prefix);
    const parent = generateParentSKU(genre, cat, subcat, nextSeq);
    return generateChildSKU(parent, 'MG', 'RB', 'STD');
}

/**
 * Create a product + default variant from a vendor message and log the stock.
 * Safely resolves category relation and avoids stock double-counting with GRN.
 * Returns the created product and variant ids.
 */
export async function ingestVendorProduct(input: {
    name: string;
    sku: string;
    category?: string;
    costPrice: number;
    retailPrice: number;
    quantity: number;
    imageUrl?: string;
    weightGrams?: number;
    purity?: string;
    vendorId?: string;
    description?: string;
    hsnCode?: string;
    platingCode?: string;
    colorCode?: string;
    sizeCode?: string;
    baseMetalCode?: string;
    stoneCode?: string;
}): Promise<{ productId: string; variantId: string }> {
    // 1. Resolve or auto-create category relation (skip if Uncategorized/General/empty)
    let categoryId = '';
    const isUncategorized = !input.category ||
        input.category.toLowerCase() === 'uncategorized' ||
        input.category.toLowerCase() === 'general' ||
        input.category.toLowerCase() === 'none';

    if (!isUncategorized && input.category) {
        try {
            const existingCat = await pb.collection('categories').getFirstListItem(`name~"${input.category}"`).catch(() => null);
            if (existingCat) {
                categoryId = existingCat.id;
            } else {
                const createdCat = await pb.collection('categories').create({
                    name: input.category,
                    slug: input.category.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                    is_active: true,
                }).catch(() => null);
                if (createdCat) categoryId = createdCat.id;
            }
        } catch {
            categoryId = '';
        }
    }

    const isDataUri = input.imageUrl && input.imageUrl.startsWith('data:');
    const isCleanHttp = input.imageUrl && input.imageUrl.startsWith('http') && !input.imageUrl.includes('whatsapp.net');

    const productPayload: Record<string, unknown> = {
        sku: input.sku,
        name: input.name,
        base_price: input.retailPrice,
        cost_price: input.costPrice,
        image_url: isCleanHttp ? input.imageUrl : '',
        image_data: input.imageUrl || '',
        description: input.description || '',
        is_active: true,
        hsn_code: input.hsnCode || '71179010',
        account_email: pb.authStore.model?.email || '',
    };
    if (categoryId) productPayload.category = categoryId;

    const product = await pb.collection('products').create(productPayload);

    // If vendorId is present, createGRN will manage initial stock and stock_movements.
    // To prevent double-counting, initialize variant stock_level to 0 when GRN is used.
    const hasVendorGRN = !!(input.vendorId && input.quantity > 0);
    const initialStock = hasVendorGRN ? 0 : Math.max(0, input.quantity);

    const variant = await pb.collection('product_variants').create({
        product: product.id,
        variant_name: input.purity || (input.sku.includes('-') ? input.sku.split('-').slice(1).join('-') : 'Default'),
        sku_suffix: input.sku.includes('-') ? input.sku.split('-').slice(1).join('-') : undefined,
        stock_level: initialStock,
        low_stock_threshold: 2,
        price_adjustment: 0,
        gross_weight: input.weightGrams,
        net_weight: input.weightGrams,
        color: input.colorCode,
        size: input.sizeCode,
        plating_type: input.platingCode,
        base_metal: input.baseMetalCode,
        stone_type: input.stoneCode,
    });

    if (!hasVendorGRN && input.quantity > 0) {
        await pb.collection('stock_movements').create({
            variant: variant.id,
            movement_type: 'purchase',
            quantity: input.quantity,
            reference_id: product.id,
            source: 'vendor_whatsapp',
            notes: `Vendor WhatsApp ingestion${input.weightGrams ? ` (${input.weightGrams}g)` : ''}`,
        }).catch((err) => console.warn('[whatsapp-crm] stock movement log failed:', err));
    }

    // Formal draft GRN for the procurement ledger (createGRN sets stock_level and logs stock movement)
    if (hasVendorGRN) {
        try {
            await createGRN({
                po_id: '',
                vendor_id: input.vendorId!,
                received_date: new Date().toISOString(),
                received_by: 'WhatsApp Ingestion',
                notes: `Auto-GRN from vendor chat (SKU ${input.sku})`,
                items: [{
                    variant_id: variant.id,
                    quantity_received: input.quantity,
                    quantity_rejected: 0,
                    rejection_reason: '',
                }],
            });
        } catch (err) {
            console.warn('[whatsapp-crm] draft GRN creation failed:', err);
            // Fallback: if GRN failed, ensure variant has stock recorded
            await pb.collection('product_variants').update(variant.id, {
                stock_level: Math.max(0, input.quantity),
            }).catch(() => {});
        }
    }

    return { productId: product.id, variantId: variant.id };
}

/** Fast-path stock increment against an existing variant (spec §8.2 "Add to Existing Inventory"). */
export async function addToExistingInventory(input: {
    variantId: string;
    quantity: number;
    vendorId?: string;
    notes?: string;
}): Promise<void> {
    if (input.vendorId && input.quantity > 0) {
        // createGRN automatically updates product_variants.stock_level AND logs a stock_movements entry
        try {
            await createGRN({
                po_id: '',
                vendor_id: input.vendorId,
                received_date: new Date().toISOString(),
                received_by: 'WhatsApp Ingestion',
                notes: input.notes || 'Auto-GRN from vendor chat',
                items: [{
                    variant_id: input.variantId,
                    quantity_received: input.quantity,
                    quantity_rejected: 0,
                    rejection_reason: '',
                }],
            });
            return;
        } catch (err) {
            console.warn('[whatsapp-crm] draft GRN creation failed, falling back to manual increment:', err);
        }
    }

    // Fallback or non-vendor restock: manual atomic increment and movement record
    await pb.collection('product_variants').update(input.variantId, {
        'stock_level+': Math.max(0, input.quantity),
    });

    await pb.collection('stock_movements').create({
        variant: input.variantId,
        movement_type: 'purchase',
        quantity: input.quantity,
        reference_id: input.vendorId || '',
        source: 'vendor_whatsapp',
        notes: input.notes || 'Added from vendor WhatsApp chat',
    });
}

// ===========================================
// BARCODE TAG PRINT QUEUE (spec §8.2)
// ===========================================

export async function queueLabelPrint(input: {
    variantId: string;
    quantity?: number;
    template?: 'dumbbell' | 'butterfly' | 'sheet';
    createdBy?: string;
    source?: string;
}): Promise<void> {
    try {
        await pb.collection('label_print_queue').create({
            variant: input.variantId,
            quantity: input.quantity ?? 1,
            template: input.template || 'dumbbell',
            status: 'pending',
            source: input.source || 'manual',
            created_by: input.createdBy || '',
        });
    } catch (err) {
        console.error('[whatsapp-crm] queueLabelPrint failed:', err);
        throw err;
    }
}

export async function getPendingLabelQueue() {
    try {
        return await pb.collection('label_print_queue').getFullList({
            filter: 'status="pending"',
            sort: '-created',
            expand: 'variant,variant.product',
        });
    } catch {
        return [];
    }
}

// ===========================================
// IN-CHAT RICH PRODUCT CARD (spec §6.1.2)
// ===========================================

/**
 * Send an interactive product spec card into a chat: photo (when available),
 * title, SKU, metal purity, live showroom stock and price.
 */
export async function sendProductCard(opts: {
    chatId: string;
    variantId: string;
    chatRecordId?: string;
    staffName?: string;
    staffUserId?: string;
}): Promise<boolean> {
    try {
        const variant = await pb.collection('product_variants').getOne(opts.variantId, {
            expand: 'product',
        });
        const v = variant as unknown as {
            variant_name?: string;
            sku_suffix?: string;
            stock_level?: number;
            price_adjustment?: number;
            expand?: { product?: { name?: string; sku?: string; base_price?: number; image_url?: string } };
        };
        const product = v.expand?.product || {};
        const sku = `${product.sku || ''}${v.sku_suffix ? '-' + v.sku_suffix : ''}` || opts.variantId;
        const price = (product.base_price || 0) + (v.price_adjustment || 0);
        const stock = v.stock_level ?? 0;

        const caption = [
            '✨ *LUMINILA JEWELRY* ✨',
            '',
            `💍 *${product.name || 'Jewelry Piece'}*${v.variant_name ? ` (${v.variant_name})` : ''}`,
            `🔖 SKU: ${sku}`,
            price ? `💰 Price: *₹${price.toLocaleString('en-IN')}*` : '',
            stock > 0
                ? `✅ ${stock} piece${stock === 1 ? '' : 's'} available in store`
                : '⏳ Currently out of stock — message us to pre-book',
            '',
            '_Reply "BOOK" to reserve or ask for our payment link._',
        ].filter(Boolean).join('\n');

        let sent = false;
        if (product.image_url) {
            sent = await whatsappManager.sendImage(opts.chatId, product.image_url, caption, `${sku}.jpg`);
        }
        if (!sent) {
            sent = await whatsappManager.sendMessage(opts.chatId, caption);
        }

        // Persist as product_card transcript entry
        try {
            let chatRecordId = opts.chatRecordId;
            if (!chatRecordId) {
                const rec = await ensureChat({ chatId: opts.chatId }).catch(() => null);
                chatRecordId = rec?.id;
            }
            const payload: Record<string, unknown> = {
                message_id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                from_me: true,
                sender_name: opts.staffName || 'Staff',
                body: caption,
                message_type: 'product_card',
                status: sent ? 'sent' : 'failed',
                timestamp: new Date().toISOString(),
            };
            if (chatRecordId) payload.chat = chatRecordId;
            if (opts.staffUserId) payload.staff_user = opts.staffUserId;
            await pb.collection('whatsapp_messages').create(payload);
        } catch { /* transcript persistence is best-effort */ }

        return sent;
    } catch (err) {
        console.error('[whatsapp-crm] sendProductCard failed:', err);
        return false;
    }
}

// ===========================================
// OPT-OUT / STOP COMPLIANCE (spec §11.5)
// ===========================================

/** Register an opt-out (STOP) for a phone number. Idempotent across both whatsapp_opt_outs and customers table. */
export async function setWhatsAppOptOut(phoneOrChatId: string, customerId?: string, reason: 'stop' | 'manual' = 'stop'): Promise<void> {
    const digits = phoneOrChatId.replace(/\D/g, '').slice(-10);
    if (!digits || digits.length < 10) return;
    try {
        let custId = customerId;
        if (!custId) {
            const matched = await pb.collection('customers').getFirstListItem(`phone~"${digits}"`).catch(() => null);
            if (matched) custId = matched.id;
        }

        // Update customer profile opt-out flag if customer found
        if (custId) {
            await pb.collection('customers').update(custId, { whatsapp_opt_out: true }).catch(() => {});
        }

        const existing = await pb.collection('whatsapp_opt_outs').getFirstListItem(
            `phone~"${digits}"`
        ).catch(() => null);
        if (existing) return;
        await pb.collection('whatsapp_opt_outs').create({
            phone: normalizeE164(phoneOrChatId),
            customer: custId || '',
            reason,
            created_at: new Date().toISOString(),
        });
    } catch (err) {
        console.warn('[whatsapp-crm] setWhatsAppOptOut failed:', err);
    }
}

export async function isWhatsAppOptedOut(phone: string): Promise<boolean> {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (!digits || digits.length < 10) return false;
    try {
        const existing = await pb.collection('whatsapp_opt_outs').getFirstListItem(
            `phone~"${digits}"`
        ).catch(() => null);
        if (existing) return true;

        const customer = await pb.collection('customers').getFirstListItem(
            `phone~"${digits}" && whatsapp_opt_out=true`
        ).catch(() => null);
        return !!customer;
    } catch {
        return false;
    }
}

// ===========================================
// LIVE POS CART BRIDGE (spec §8.3)
// ===========================================

const POS_CART_CHANNEL = 'pos_cart';
const POS_CART_STORAGE_KEY = 'pos:cart-updated';

/** Push an item into the active POS terminal cart (same-tab channel, cross-tab storage event). */
export function broadcastAddToPOS(item: POSCartBroadcastItem): void {
    if (typeof window === 'undefined') return;

    const payload = {
        type: 'pos:add-item',
        item,
        ts: Date.now(),
    };

    try {
        const channel = new BroadcastChannel(POS_CART_CHANNEL);
        channel.postMessage(payload);
        channel.close();
    } catch { /* BroadcastChannel unavailable */ }

    // localStorage event reaches other tabs/windows on the same origin
    try {
        localStorage.setItem(POS_CART_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* storage full / disabled */ }
}

/**
 * Subscribe on the POS terminal to remote cart additions arriving from the
 * WhatsApp surfaces. Returns an unsubscribe function.
 */
export function subscribeRemoteCartItems(
    handler: (item: POSCartBroadcastItem) => void
): () => void {
    if (typeof window === 'undefined') return () => {};

    let channel: BroadcastChannel | null = null;
    try {
        channel = new BroadcastChannel(POS_CART_CHANNEL);
        channel.onmessage = (event) => {
            const data = event?.data;
            if (data?.type === 'pos:add-item' && data.item) handler(data.item as POSCartBroadcastItem);
        };
    } catch { /* ignore */ }

    const onStorage = (event: StorageEvent) => {
        if (event.key !== POS_CART_STORAGE_KEY || !event.newValue) return;
        try {
            const data = JSON.parse(event.newValue);
            if (data?.type === 'pos:add-item' && data.item) handler(data.item as POSCartBroadcastItem);
        } catch { /* ignore malformed */ }
    };
    window.addEventListener('storage', onStorage);

    return () => {
        try { channel?.close(); } catch { /* ignore */ }
        window.removeEventListener('storage', onStorage);
    };
}
