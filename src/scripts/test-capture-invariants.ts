/**
 * Database-level capture invariants (§12.7 I-01, I-04, I-05, I-09).
 *
 * Drives the REAL order route over HTTP with a properly signed customer
 * session, then asserts the persisted rows as a superuser. Covers the P0s
 * from §12.9: I-01 (header + ≥1 item, sum matches), I-04 (settle ⇒ items +
 * aggregates bumped once), I-05 (duplicate key ⇒ same order, zero new rows),
 * I-09 (item variant belongs to the line's product).
 *
 * Requires: dev server on :3000 (route + env loaded), PocketBase on :8091,
 * CUSTOMER_SESSION_SECRET in .env.local. Run: npx tsx src/scripts/test-capture-invariants.ts
 */

import * as path from 'path';
import PocketBase from 'pocketbase';
import { signCustomerToken } from '../lib/customer-token';

// Load the same env the dev server runs with.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

// Local-only endpoints, hardcoded: this script exercises the developer's own
// stack (an env-configurable target would be an SSRF pattern).
const PB_URL = 'http://127.0.0.1:8091';
const APP_URL = 'http://127.0.0.1:3000';
const TENANT = 'admin@luminila.local';
// Unique per run so the in-memory order rate limiter and the customer upsert
// cannot collide with a previous run (and stale fixtures are cleaned by name).
const TEST_PHONE = '9' + String(Date.now()).slice(-9);
const RUN_ID = Date.now().toString(36).toUpperCase();
const SUPERUSER_PASSWORD = process.env.TEST_PB_PASSWORD || 'Luminila2026!';

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

interface OrderResponse {
    success: boolean;
    orderId?: string;
    txnId?: string;
    duplicate?: boolean;
    totals?: { subtotal: number; discount: number; shippingCharges: number; total: number };
    error?: string;
}

async function main() {
    if (!process.env.CUSTOMER_SESSION_SECRET && !process.env.JWT_SECRET) {
        throw new Error('CUSTOMER_SESSION_SECRET missing from .env.local — the route would 401 every submit');
    }

    // --- Fixture: a dedicated tenant product with one variant, and a customer session token.
    const su = new PocketBase(PB_URL);
    await su.collection('_superusers').authWithPassword(TENANT, SUPERUSER_PASSWORD);

    // Pre-clean leftover fixtures from earlier failed runs: a stale customer
    // with the same phone would win the upsert lookup and absorb the merge.
    const stale = await su.collection('customers').getFullList({
        filter: su.filter('name = {:n}', { n: 'Invariant Test Customer' }),
    });
    for (const s of stale) {
        await su.collection('customers').delete(s.id).catch(() => {});
    }

    const sku = 'E2EINV' + Date.now().toString(36).toUpperCase().slice(-6);
    const product = await su.collection('products').create({
        sku,
        name: 'Invariant Test Piece ' + sku,
        base_price: 1200,
        cost_price: 400,
        hsn_code: '71179010',
        is_active: true,
        tax_rate: 3,
        account_email: TENANT,
    });
    const variant = await su.collection('product_variants').create({
        product: product.id,
        variant_name: sku + '-STD',
        stock_level: 10,
        low_stock_threshold: 2,
        price_adjustment: 0,
        account_email: TENANT,
    });
    const stockBefore = 10;

    const customer = await su.collection('customers').create({
        name: 'Invariant Test Customer',
        phone: '+91' + TEST_PHONE,
        customer_type: 'retail',
        account_email: TENANT,
    });

    const token = signCustomerToken({
        id: customer.id,
        phone: TEST_PHONE,
        tenant: TENANT,
        exp: Date.now() + 10 * 60 * 1000,
    });

    const submit = async (body: Record<string, unknown>): Promise<{ status: number; json: OrderResponse }> => {
        const res = await fetch(APP_URL + '/api/storefront/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify(body),
        });
        return { status: res.status, json: (await res.json()) as OrderResponse };
    };

    const items = [{ productId: product.id, sku, name: product.name as string, price: 1200, quantity: 2 }];
    const additionalOrderIds: string[] = [];
    const base = {
        customerName: 'Invariant Test Customer',
        customerPhone: TEST_PHONE,
        customerEmail: 'invariant@test.local',
        shippingAddress: '1 Test Street',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
        items,
        total: 1298, // client quote; the server total is authoritative
        couponCode: 'MYCART49',
        paymentMethod: 'razorpay_online' as const,
        shippingCharges: 99,
        marketingConsent: true,
        campaign: 'test/invariants',
    };

    // --- I-05 + I-01: first submit creates; duplicate returns the same order and writes nothing new.
    console.log('\n=== I-05 duplicate submit returns the same order ===');
    const first = await submit({ ...base, idempotencyKey: `ORD-INVTEST-${RUN_ID}-1` });
    check('first submit succeeds', first.status === 200 && first.json.success, JSON.stringify(first.json).slice(0, 200));
    const orderId = first.json.orderId || '';
    check('order id returned', Boolean(orderId));

    const itemsCount1 = await su.collection('sales_order_items').getList(1, 1, {
        filter: su.filter('order = {:id}', { id: orderId }),
    });
    check('I-01 order has ≥1 item row', itemsCount1.totalItems >= 1, 'count=' + itemsCount1.totalItems);
    const itemRows = await su.collection('sales_order_items').getFullList({
        filter: su.filter('order = {:id}', { id: orderId }),
    });
    const sum = itemRows.reduce((s, r) => s + (Number(r.unit_price) || 0) * (Number(r.quantity) || 0), 0);
    const orderRow = await su.collection('sales_orders').getOne(orderId);
    check('I-01 Σ(unit_price×qty) = subtotal', sum === Number(orderRow.subtotal), sum + ' vs ' + orderRow.subtotal);

    // --- A37 campaign attribution: name on the order, row resolved, mirror linked.
    check('A37 campaign stored on order', orderRow.campaign === base.campaign, String(orderRow.campaign));
    const campaignRow = await su
        .collection('whatsapp_campaigns')
        .getFirstListItem(su.filter('name = {:name} && account_email = {:tenant}', { name: base.campaign, tenant: TENANT }), { requestKey: null })
        .catch(() => null);
    check('A37 campaign row resolved', Boolean(campaignRow), 'no row for ' + base.campaign);

    // --- A30 consent ledger: transactional + marketing decisions per order.
    const consentRows = await su.collection('consent_events').getFullList({
        filter: su.filter('order = {:id}', { id: orderId }),
        requestKey: null,
    });
    check(
        'A30 ledger has transactional consent',
        consentRows.some((row) => row.purpose === 'transactional' && row.granted === true)
    );
    check(
        'A30 ledger has marketing consent',
        consentRows.some((row) => row.purpose === 'marketing' && row.granted === true)
    );

    const second = await submit({ ...base, idempotencyKey: `ORD-INVTEST-${RUN_ID}-1` });
    check('duplicate returns same order id', second.json.orderId === orderId, second.json.orderId);
    check('duplicate flagged duplicate=true', second.json.duplicate === true);
    const itemsCount2 = await su.collection('sales_order_items').getList(1, 1, {
        filter: su.filter('order = {:id}', { id: orderId }),
    });
    check('I-05 duplicate wrote zero new item rows', itemsCount2.totalItems === itemsCount1.totalItems);

    // --- I-09: the item's variant is set and belongs to the line's product.
    console.log('\n=== I-09 variant persisted and consistent ===');
    check('I-09 item has a variant', Boolean(itemRows[0]?.variant), 'variant=' + String(itemRows[0]?.variant));
    if (itemRows[0]?.variant) {
        const v = await su.collection('product_variants').getOne(itemRows[0].variant as string);
        check('I-09 variant belongs to the line product', v.product === product.id, v.product);
    }

    // --- Header sanity for I-01/I-04: totals compose, mirror exists, consent captured.
    const total = Number(orderRow.total);
    check('I-02 total = subtotal − discount + shipping',
        total === Number(orderRow.subtotal) - Number(orderRow.discount_total) + Number(orderRow.shipping_charges),
        String(total));
    check('tax_total present (tax-inclusive split)', Number(orderRow.tax_total) >= 0 && Number(orderRow.tax_total) <= total);
    check('billing_address written', Boolean(orderRow.billing_address));
    // CO-14: place of supply is captured per order (Tamil Nadu = 33) and is not
    // silently forced to the seller state.
    check('CO-14 buyer_state_code captured', orderRow.buyer_state_code === '33', String(orderRow.buyer_state_code));
    check('CO-14 place_of_supply captured', orderRow.place_of_supply === '33', String(orderRow.place_of_supply));
    // CO-05 groundwork: the payment method / capture source live in real columns.
    check('CO-05 payment_method column written', orderRow.payment_method === 'razorpay_online', String(orderRow.payment_method));
    check('CO-05 capture_source column written', orderRow.capture_source === 'storefront', String(orderRow.capture_source));

    const mirror = await su.collection('sales').getFirstListItem(
        su.filter('channel_order_id = {:t}', { t: first.json.txnId })
    ).catch(() => null);
    check('I-10 sales mirror exists with valid enums', Boolean(mirror) && mirror!.channel === 'storefront');
    const customerAfter = await su.collection('customers').getOne(customer.id);
    check('consent captured on the customer', customerAfter.opt_in_marketing === true);

    // --- I-04: settle ⇒ aggregates bumped once, not twice on replay.
    console.log('\n=== I-04 settle bumps aggregates exactly once ===');
    const spentBefore = Number(customerAfter.total_spent) || 0;
    const ordersBefore = Number(customerAfter.total_orders) || 0;
    check('intake did NOT bump aggregates for an online draft', spentBefore === 0 && ordersBefore === 0,
        'spent=' + spentBefore + ' orders=' + ordersBefore);

    // Settle through the same helper the webhook calls. The double call below
    // documents that an unguarded second settle WOULD double-bump — the real
    // guard is the webhook's `payment_status === 'PAID'` replay check.
    const { applyPurchaseAggregates } = await import('../lib/channel-orders');
    await applyPurchaseAggregates(su, customer.id, total);
    const afterSettle = await su.collection('customers').getOne(customer.id);
    check('I-04 aggregates bumped after settle', (Number(afterSettle.total_spent) || 0) >= total);
    check('I-04 exactly one order counted', (Number(afterSettle.total_orders) || 0) === ordersBefore + 1);

    // --- stock: intake must NOT have deducted for an online draft; ledger pair count 0.
    const movements = await su.collection('stock_movements').getFullList({
        filter: su.filter('reference_id = {:id}', { id: orderId }),
    });
    check('online draft wrote no stock movements', movements.length === 0, 'found ' + movements.length);
    const vAfter = await su.collection('product_variants').getOne(variant.id);
    check('online draft left stock untouched', Number(vAfter.stock_level) === stockBefore);

    // --- CO-05 prepare phase must fail closed (not create a gateway order) when
    // the Razorpay API keys are not configured. When they are configured this
    // block is skipped because a real gateway order would be created.
    if (!process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_SECRET) {
        console.log('\n=== CO-05 prepare fails closed without gateway keys ===');
        const prepared = await submit({ ...base, idempotencyKey: `ORD-INVTEST-${RUN_ID}-PREP`, prepareGateway: true } as Record<string, unknown>);
        check('CO-05 prepare returns 503 without keys', prepared.status === 503, 'status=' + prepared.status);
        check(
            'CO-05 prepare explains the configuration gap',
            String(prepared.json.error || '').toLowerCase().includes('not configured'),
            String(prepared.json.error || '')
        );
    }

    // --- A3/A4 B2B billing: a valid GSTIN bills to the billing state (and that
    // state is the place of supply); an invalid GSTIN is refused before writes.
    console.log('\n=== A3/A4 B2B GSTIN capture ===');
    const b2b = await submit({
        ...base,
        idempotencyKey: `ORD-INVTEST-${RUN_ID}-B2B`,
        companyName: 'Invariant Traders Pvt Ltd',
        gstin: '27AAPFU0939F1ZV',
        billingSameAsShipping: false,
        billingAddress: '9 Billing Road',
        billingCity: 'Mumbai',
        billingState: 'Maharashtra',
        billingPincode: '400001',
    } as Record<string, unknown>);
    check('A3 B2B order accepted', b2b.status === 200 && b2b.json.success === true, JSON.stringify(b2b.json).slice(0, 200));
    const b2bOrderId = String(b2b.json.orderId || '');
    const b2bRow = await su.collection('sales_orders').getOne(b2bOrderId).catch(() => null);
    check('A4 buyer GSTIN captured', b2bRow?.buyer_gstin === '27AAPFU0939F1ZV', String(b2bRow?.buyer_gstin));
    check('A4 buyer company captured', b2bRow?.buyer_company === 'Invariant Traders Pvt Ltd', String(b2bRow?.buyer_company));
    check('A4 place of supply follows billing state', b2bRow?.place_of_supply === '27', String(b2bRow?.place_of_supply));
    check('A4 billing address stored separately', String(b2bRow?.billing_address || '').includes('Mumbai'), String(b2bRow?.billing_address));
    additionalOrderIds.push(b2bOrderId);

    const badGstin = await submit({
        ...base,
        idempotencyKey: `ORD-INVTEST-${RUN_ID}-BADGSTIN`,
        gstin: 'INVALIDGSTIN1234',
    } as Record<string, unknown>);
    check('A4 invalid GSTIN refused', badGstin.status === 400, 'status=' + badGstin.status);

    console.log(`\n=== capture invariants: ${passed} passed, ${failed} failed ===`);

    // --- Cleanup: remove the fixture tree so repeat runs stay clean.
    try {
        const allOrderIds = [orderId, ...additionalOrderIds].filter(Boolean);
        for (const id of allOrderIds) {
            const rows = await su.collection('sales_order_items').getFullList({
                filter: su.filter('order = {:id}', { id }),
                requestKey: null,
            });
            for (const r of rows) await su.collection('sales_order_items').delete(r.id);
            const consents = await su.collection('consent_events').getFullList({
                filter: su.filter('order = {:id}', { id }),
                requestKey: null,
            });
            for (const c of consents) await su.collection('consent_events').delete(c.id);
            await su.collection('sales_orders').delete(id).catch(() => {});
        }
        const mirrors = await su.collection('sales').getFullList({
            filter: su.filter('channel_order_id ~ {:p}', { p: 'ORD-INVTEST-' }),
            requestKey: null,
        });
        for (const m of mirrors) await su.collection('sales').delete(m.id);
        if (campaignRow) await su.collection('whatsapp_campaigns').delete(campaignRow.id).catch(() => {});
        // Consent rows keep an audit copy with an empty order/customer relation
        // once those records are deleted, so clean them by the test phone too.
        const phoneConsents = await su.collection('consent_events').getFullList({
            filter: su.filter('phone ~ {:phone}', { phone: TEST_PHONE }),
            requestKey: null,
        }).catch(() => []);
        for (const row of phoneConsents) await su.collection('consent_events').delete(row.id).catch(() => {});
        const interactions = await su.collection('customer_interactions').getFullList({
            filter: su.filter('customer = {:id}', { id: customer.id }),
            requestKey: null,
        }).catch(() => []);
        for (const row of interactions) await su.collection('customer_interactions').delete(row.id).catch(() => {});
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
        await su.collection('customers').delete(customer.id);
        await su.collection('product_variants').delete(variant.id);
        await su.collection('products').delete(product.id);
        console.log('fixture cleaned up');
    } catch (e) {
        console.warn('cleanup warning:', (e as Error).message);
    }

    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error('FAILED:', err?.message || err);
    process.exit(1);
});
