/**
 * WhatsApp ERP/CRM Schema Update (PocketBase 0.25+ Compliant)
 * Creates the four collections required by the WhatsApp Conversational Commerce spec (§12.1):
 *   - whatsapp_chats      (conversation registry + contact binding)
 *   - whatsapp_messages   (persisted transcript, staff attribution)
 *   - payment_links       (Razorpay/PhonePe payment link ledger)
 *   - label_print_queue   (barcode tag batch queue fed by vendor ingestion)
 *
 * Run: npx tsx src/scripts/update-whatsapp-crm-schema.ts
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'password123456';

async function authenticate(pb: PocketBase) {
    try {
        await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
        return;
    } catch { /* fall through to legacy admins API */ }
    await (pb as any).admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
}

async function resolveColId(pb: PocketBase, nameOrId: string): Promise<string> {
    if (nameOrId === '_pb_users_auth_' || nameOrId === 'users') return '_pb_users_auth_';
    try {
        const col = await pb.collections.getOne(nameOrId);
        return col.id;
    } catch {
        return nameOrId;
    }
}

async function main() {
    const pb = new PocketBase(PB_URL);

    try {
        console.log(`Authenticating to PocketBase at ${PB_URL}...`);
        await authenticate(pb);
        console.log("Logged in!");

        // Pre-resolve referenced collection IDs
        const customersColId = await resolveColId(pb, 'customers');
        const vendorsColId = await resolveColId(pb, 'vendors');
        const salesOrdersColId = await resolveColId(pb, 'sales_orders');
        const invoicesColId = await resolveColId(pb, 'invoices');
        const productVariantsColId = await resolveColId(pb, 'product_variants');
        const usersColId = '_pb_users_auth_';

        // Ensure customers collection has customer_type and whatsapp_opt_out (spec §11.3 & §11.5)
        try {
            const custCol = await pb.collections.getOne('customers');
            const updatedFields = [...custCol.fields];
            let modified = false;
            if (!updatedFields.some(f => f.name === 'customer_type')) {
                updatedFields.push({
                    name: 'customer_type',
                    type: 'select',
                    maxSelect: 1,
                    values: ['retail', 'wholesale', 'vip'],
                    required: false,
                } as any);
                modified = true;
            }
            if (!updatedFields.some(f => f.name === 'whatsapp_opt_out')) {
                updatedFields.push({
                    name: 'whatsapp_opt_out',
                    type: 'bool',
                    required: false,
                } as any);
                modified = true;
            }
            if (modified) {
                console.log("Updating customers collection with customer_type & whatsapp_opt_out...");
                await pb.collections.update(custCol.id, { fields: updatedFields });
                console.log("✅ customers collection schema updated.");
            }
        } catch (err: any) {
            console.warn("Could not update customers schema:", err.message);
        }

        // Ensure bank_accounts allows 0 balance without Go ozzo-validation rejection
        try {
            const baCol = await pb.collections.getOne('bank_accounts');
            const updatedFields = baCol.fields.map((f: any) => {
                if (f.name === 'opening_balance' || f.name === 'current_balance') {
                    return { ...f, required: false };
                }
                return f;
            });
            await pb.collections.update(baCol.id, { fields: updatedFields });
            console.log("✅ bank_accounts balance schema updated.");
        } catch (err: any) {
            console.warn("Could not update bank_accounts schema:", err.message);
        }

        const openRules = {
            listRule: "",
            viewRule: "",
            createRule: "",
            updateRule: "",
            deleteRule: "",
        };

        const createOrUpdateCollection = async (data: any) => {
            try {
                let existing = null;
                try {
                    existing = await pb.collections.getOne(data.name);
                } catch { /* doesn't exist */ }

                if (existing) {
                    console.log(`Collection ${data.name} already exists. Updating rules & fields...`);
                    await pb.collections.update(existing.id, {
                        ...openRules,
                        fields: data.fields,
                        indexes: data.indexes || [],
                    });
                    console.log(`✅ ${data.name} updated.`);
                    return;
                }

                console.log(`Creating collection: ${data.name}...`);
                await pb.collections.create({
                    ...data,
                    ...openRules,
                });
                console.log(`✅ ${data.name} created.`);
            } catch (err: any) {
                console.error(`❌ Failed to create/update ${data.name}:`, JSON.stringify(err.data || err.message || err));
            }
        };

        // --- 1. WhatsApp Chats (conversation registry) ---
        await createOrUpdateCollection({
            name: 'whatsapp_chats',
            type: 'base',
            fields: [
                { name: 'chat_id', type: 'text', required: true },
                { name: 'contact_type', type: 'select', maxSelect: 1, values: ['customer', 'vendor', 'lead'], required: false },
                { name: 'contact_name', type: 'text', required: false },
                { name: 'customer', type: 'relation', collectionId: customersColId, maxSelect: 1, required: false },
                { name: 'vendor', type: 'relation', collectionId: vendorsColId, maxSelect: 1, required: false },
                { name: 'last_message_body', type: 'text', required: false },
                { name: 'last_message_time', type: 'date', required: false },
                { name: 'unread_count', type: 'number', required: false },
                { name: 'status', type: 'select', maxSelect: 1, values: ['active', 'archived', 'pending_quote'], required: false },
                { name: 'assigned_staff', type: 'relation', collectionId: usersColId, maxSelect: 1, required: false },
                { name: 'labels', type: 'json', required: false },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_wa_chats_chat_id ON whatsapp_chats (chat_id)',
            ],
        });

        // Resolve whatsapp_chats ID for relation
        const whatsappChatsColId = await resolveColId(pb, 'whatsapp_chats');

        // --- 2. WhatsApp Messages (persisted transcript) ---
        await createOrUpdateCollection({
            name: 'whatsapp_messages',
            type: 'base',
            fields: [
                { name: 'chat', type: 'relation', collectionId: whatsappChatsColId, cascadeDelete: true, maxSelect: 1, required: false },
                { name: 'message_id', type: 'text', required: true },
                { name: 'from_me', type: 'bool', required: false },
                { name: 'sender_name', type: 'text', required: false },
                { name: 'staff_user', type: 'relation', collectionId: usersColId, maxSelect: 1, required: false },
                { name: 'body', type: 'text', required: false },
                { name: 'message_type', type: 'select', maxSelect: 1, values: ['text', 'image', 'document', 'product_card', 'payment_link'], required: false },
                { name: 'media_url', type: 'text', required: false },
                { name: 'status', type: 'select', maxSelect: 1, values: ['pending', 'sent', 'delivered', 'read', 'failed'], required: false },
                { name: 'timestamp', type: 'date', required: false },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_wa_messages_message_id ON whatsapp_messages (message_id)',
            ],
        });

        // --- 3. Payment Links (Razorpay / PhonePe) ---
        await createOrUpdateCollection({
            name: 'payment_links',
            type: 'base',
            fields: [
                { name: 'provider', type: 'select', maxSelect: 1, values: ['razorpay', 'phonepe'], required: true },
                { name: 'link_id', type: 'text', required: true },
                { name: 'short_url', type: 'text', required: false },
                { name: 'amount', type: 'number', required: true },
                { name: 'currency', type: 'text', required: false },
                { name: 'customer', type: 'relation', collectionId: customersColId, maxSelect: 1, required: false },
                { name: 'order', type: 'relation', collectionId: salesOrdersColId, maxSelect: 1, required: false },
                { name: 'invoice', type: 'relation', collectionId: invoicesColId, maxSelect: 1, required: false },
                { name: 'status', type: 'select', maxSelect: 1, values: ['created', 'paid', 'partially_paid', 'expired', 'cancelled'], required: false },
                { name: 'paid_at', type: 'date', required: false },
                { name: 'payment_id', type: 'text', required: false }, // pay_xxx once settled
                { name: 'notes', type: 'json', required: false },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_payment_links_link_id ON payment_links (link_id)',
            ],
        });

        // --- 4. Label Print Queue (barcode tag batching) ---
        await createOrUpdateCollection({
            name: 'label_print_queue',
            type: 'base',
            fields: [
                { name: 'variant', type: 'relation', collectionId: productVariantsColId, maxSelect: 1, required: true },
                { name: 'quantity', type: 'number', required: false },
                { name: 'template', type: 'select', maxSelect: 1, values: ['dumbbell', 'butterfly', 'sheet'], required: false },
                { name: 'status', type: 'select', maxSelect: 1, values: ['pending', 'printed', 'cancelled'], required: false },
                { name: 'source', type: 'text', required: false },
                { name: 'created_by', type: 'relation', collectionId: usersColId, maxSelect: 1, required: false },
            ],
        });

        // --- 5. Broadcast Messages (anti-ban staggered campaigns, spec §11) ---
        await createOrUpdateCollection({
            name: 'broadcast_messages',
            type: 'base',
            fields: [
                { name: 'campaign', type: 'text', required: true },
                { name: 'customer', type: 'relation', collectionId: customersColId, maxSelect: 1, required: false },
                { name: 'recipient_phone', type: 'text', required: true }, // E.164
                { name: 'body', type: 'text', required: false }, // merge-tag rendered
                { name: 'status', type: 'select', maxSelect: 1, values: ['queued', 'sent', 'failed', 'skipped'], required: false },
                { name: 'scheduled_at', type: 'date', required: false }, // jittered dispatch time
                { name: 'sent_at', type: 'date', required: false },
                { name: 'error', type: 'text', required: false },
                { name: 'created_by', type: 'relation', collectionId: usersColId, maxSelect: 1, required: false },
            ],
            indexes: [
                'CREATE INDEX idx_broadcast_campaign_status ON broadcast_messages (campaign, status)',
            ],
        });

        // --- 6. WhatsApp Opt-Outs (STOP compliance, spec §11.5) ---
        await createOrUpdateCollection({
            name: 'whatsapp_opt_outs',
            type: 'base',
            fields: [
                { name: 'phone', type: 'text', required: true }, // E.164
                { name: 'customer', type: 'relation', collectionId: customersColId, maxSelect: 1, required: false },
                { name: 'reason', type: 'text', required: false }, // stop | manual
                { name: 'created_at', type: 'date', required: false },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_wa_opt_outs_phone ON whatsapp_opt_outs (phone)',
            ],
        });

        console.log("-----------------------------------------");
        console.log("WhatsApp ERP/CRM Schema Update Completed");
        console.log("-----------------------------------------");

    } catch (err: any) {
        console.error("FATAL ERROR during migration:", err);
        process.exitCode = 1;
    }
}

main();
