/**
 * Roadmap capture services (A3/A4/A30/A32/A37/C2/C3/D2).
 *
 * Exercises the real service functions against the developer's PocketBase with
 * a temp fixture: shipment creation + expected delivery, COD settlement (ledger
 * row, aggregates, idempotency), campaign resolve-or-create, consent-ledger
 * state, and the WhatsApp chat/message order backlinks.
 *
 * Requires PocketBase on :8091 and `.env.local`. Run:
 *   npx tsx src/scripts/test-roadmap-capture.ts
 */

import * as path from 'path';
import PocketBase from 'pocketbase';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

import {
    listShipmentsForOrder,
    createShipmentForOrder,
    updateShipmentStatus,
    settleCodOrder,
    setExpectedDelivery,
} from '../lib/shipments';
import { resolveCampaign } from '../lib/campaigns';
import { recordConsentEvent, getConsentState } from '../lib/consent-ledger';
import { linkChatOrder } from '../lib/whatsapp-order-links';

const PB_URL = 'http://127.0.0.1:8091';
const TENANT = 'admin@luminila.local';
const SUPERUSER_PASSWORD = process.env.TEST_PB_PASSWORD || 'Luminila2026!';
const RUN = Date.now().toString(36).toUpperCase();
const PHONE = '9' + String(Date.now()).slice(-9);
type TenantDb = Parameters<typeof createShipmentForOrder>[0];

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    }
}

async function main() {
    const su = new PocketBase(PB_URL);
    su.autoCancellation(false);
    await su.collection('_superusers').authWithPassword(TENANT, SUPERUSER_PASSWORD);
    const db = su as unknown as TenantDb;

    const customer = await su.collection('customers').create({
        name: 'Roadmap Test Customer',
        phone: '+91' + PHONE,
        customer_type: 'retail',
        account_email: TENANT,
        total_spent: 0,
        total_orders: 0,
        loyalty_points: 0,
    });

    const order = await su.collection('sales_orders').create({
        order_number: `ORD-ROADMAPTEST-${RUN}`,
        order_type: 'sales_order',
        customer: customer.id,
        customer_name: 'Roadmap Test Customer',
        customer_phone: PHONE,
        order_date: new Date().toISOString(),
        status: 'confirmed',
        subtotal: 1000,
        tax_total: 0,
        discount_total: 0,
        shipping_charges: 0,
        total: 1000,
        payment_status: 'UNPAID',
        payment_method: 'cash',
        buyer_state_code: '33',
        place_of_supply: '33',
        account_email: TENANT,
    });

    // --- Expected delivery
    const eta = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const etaResult = await setExpectedDelivery(db, order.id, eta);
    const afterEta = await su.collection('sales_orders').getOne(order.id);
    check('C3 expected delivery saved', etaResult.success && String(afterEta.expected_delivery_date || '').slice(0, 10) === eta);

    // --- Dispatch: shipment row + order status shipped
    const shipment = await createShipmentForOrder(db, TENANT, {
        orderId: order.id,
        carrier: 'Test Courier',
        awbNumber: `AWB-${RUN}`,
        trackingUrl: 'https://track.test/awb',
        codAmount: 1000,
        expectedDeliveryDate: eta,
        notifyCustomer: false,
    });
    check('C2 shipment recorded', shipment.success === true, shipment.error);
    const shipments = await listShipmentsForOrder(db, order.id);
    check('C2 shipment row persisted', shipments.length === 1 && shipments[0].awb_number === `AWB-${RUN}`, 'rows=' + shipments.length);
    const afterShip = await su.collection('sales_orders').getOne(order.id);
    check('C2 order moved to shipped', afterShip.status === 'shipped', String(afterShip.status));

    // --- COD settlement: paid + delivered + ledger row + aggregates once
    const cod = await settleCodOrder(db, TENANT, order.id, { reference: `CASH-${RUN}`, collectedBy: 'test-agent' });
    check('D2 COD settlement succeeds', cod.success === true, cod.error);
    const settled = await su.collection('sales_orders').getOne(order.id);
    check('D2 order marked PAID', String(settled.payment_status).toUpperCase() === 'PAID');
    check('D2 order delivered', settled.status === 'delivered', String(settled.status));
    check('D2 COD settled timestamp recorded', Boolean(settled.cod_settled_at));
    check('D2 COD reference recorded', settled.cod_reference === `CASH-${RUN}`, String(settled.cod_reference));
    const links = await su.collection('payment_links').getFullList({
        filter: su.filter('order = {:id} && provider = {:provider}', { id: order.id, provider: 'cod' }),
        requestKey: null,
    });
    check('D2 COD payment-link row written', links.length === 1 && links[0].status === 'paid', 'rows=' + links.length);
    const afterCodCustomer = await su.collection('customers').getOne(customer.id);
    check('D2 aggregates bumped once', Number(afterCodCustomer.total_spent) >= 1000 && Number(afterCodCustomer.total_orders) === 1,
        `spent=${afterCodCustomer.total_spent} orders=${afterCodCustomer.total_orders}`);
    const markerCheck = await su.collection('sales_orders').getOne(order.id);
    check('D2 aggregate marker written', String(markerCheck.internal_notes || '').includes('AggregatesCounted: yes'));
    const codAgain = await settleCodOrder(db, TENANT, order.id, { reference: `CASH-${RUN}` });
    check('D2 COD settlement is idempotent', codAgain.success === true);

    // --- Shipment delivered transition
    const delivered = await updateShipmentStatus(db, shipments[0].id, 'delivered');
    check('C2 shipment delivery status updates', delivered.success === true, delivered.error);

    // --- A37 campaign resolve-or-create is idempotent
    const campaignName = `TEST-CAMPAIGN-${RUN}`;
    const c1 = await resolveCampaign(db, { tenantEmail: TENANT, name: campaignName, channel: 'storefront' });
    const c2 = await resolveCampaign(db, { tenantEmail: TENANT, name: campaignName, channel: 'storefront' });
    check('A37 campaign row created', Boolean(c1?.id));
    check('A37 campaign resolve is idempotent', Boolean(c1?.id) && c1?.id === c2?.id);

    // --- A30 consent ledger derives the latest decision per purpose
    await recordConsentEvent(db, {
        customerId: customer.id,
        phone: PHONE,
        channel: 'storefront',
        purpose: 'marketing',
        granted: false,
        source: 'roadmap_test',
    });
    await recordConsentEvent(db, {
        customerId: customer.id,
        phone: PHONE,
        channel: 'storefront',
        purpose: 'marketing',
        granted: true,
        source: 'roadmap_test',
    });
    const state = await getConsentState(db, { customerId: customer.id });
    check('A30 latest marketing consent wins', state.marketing === true, String(state.marketing));
    check('A30 unknown purpose stays null', state.transactional === null, String(state.transactional));

    // --- A32 chat/message order backlinks
    const chat = await su.collection('whatsapp_chats').create({
        chat_id: `chat-${RUN}@c.us`,
        contact_name: 'Roadmap Test Customer',
        account_email: TENANT,
    });
    const message = await su.collection('whatsapp_messages').create({
        chat: chat.id,
        message_id: `msg-${RUN}`,
        from_me: false,
        body: 'I want to order',
        message_type: 'text',
        timestamp: new Date().toISOString(),
        account_email: TENANT,
    });
    await linkChatOrder(db, {
        tenantEmail: TENANT,
        chatId: `chat-${RUN}@c.us`,
        messageId: `msg-${RUN}`,
        orderId: order.id,
    });
    const linkedChat = await su.collection('whatsapp_chats').getOne(chat.id);
    const linkedMessage = await su.collection('whatsapp_messages').getOne(message.id);
    check('A32 chat last_order linked', linkedChat.last_order === order.id, String(linkedChat.last_order));
    check('A32 message order linked', linkedMessage.order === order.id, String(linkedMessage.order));

    console.log(`\n=== roadmap capture: ${passed} passed, ${failed} failed ===`);

    // --- Cleanup
    try {
        for (const link of links) await su.collection('payment_links').delete(link.id).catch(() => {});
        for (const s of shipments) await su.collection('shipments').delete(s.id).catch(() => {});
        await su.collection('whatsapp_messages').delete(message.id).catch(() => {});
        await su.collection('whatsapp_chats').delete(chat.id).catch(() => {});
        // Required relations: loyalty_transactions.account -> loyalty_accounts.customer
        // and customer_interactions.customer must be removed before the customer.
        const accounts = await su.collection('loyalty_accounts').getFullList({
            filter: su.filter('customer = {:id}', { id: customer.id }),
            requestKey: null,
        }).catch(() => []);
        for (const account of accounts) {
            const tx = await su.collection('loyalty_transactions').getFullList({
                filter: su.filter('account = {:id}', { id: account.id }),
                requestKey: null,
            }).catch(() => []);
            for (const row of tx) await su.collection('loyalty_transactions').delete(row.id).catch(() => {});
            await su.collection('loyalty_accounts').delete(account.id).catch(() => {});
        }
        const interactions = await su.collection('customer_interactions').getFullList({
            filter: su.filter('customer = {:id}', { id: customer.id }),
            requestKey: null,
        }).catch(() => []);
        for (const row of interactions) await su.collection('customer_interactions').delete(row.id).catch(() => {});
        const consents = await su.collection('consent_events').getFullList({
            filter: su.filter('phone ~ {:phone}', { phone: PHONE }),
            requestKey: null,
        }).catch(() => []);
        for (const row of consents) await su.collection('consent_events').delete(row.id).catch(() => {});
        if (c1?.id) await su.collection('whatsapp_campaigns').delete(c1.id).catch(() => {});
        await su.collection('sales_orders').delete(order.id).catch(() => {});
        await su.collection('customers').delete(customer.id).catch((err) =>
            console.warn('cleanup warning: could not delete the test customer:', (err as Error).message)
        );
        const leftover = await su.collection('customers').getFirstListItem(
            su.filter('id = {:id}', { id: customer.id }),
            { requestKey: null }
        ).catch(() => null);
        console.log(leftover ? 'fixture cleanup INCOMPLETE (customer left behind)' : 'fixture cleaned up');
    } catch (e) {
        console.warn('cleanup warning:', (e as Error).message);
    }

    if (failed > 0) process.exit(1);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});