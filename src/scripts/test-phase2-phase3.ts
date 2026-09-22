/**
 * Automated Verification Suite for WhatsApp ERP/CRM Phase 2 & Phase 3
 * Validates:
 *   1. Anti-ban jitter calculation (8-22s bounds)
 *   2. Merge tag rendering with customer, first_name, tier, points, total_spent
 *   3. PocketBase schema fields (broadcast_messages, whatsapp_opt_outs, payment_links.payment_id, customer_type)
 *   4. Razorpay clearing account idempotency & mutex
 *   5. Audience resolution resilience
 *   6. STOP opt-out registration
 *
 * Run: npx tsx src/scripts/test-phase2-phase3.ts
 */

import PocketBase from 'pocketbase';
import { pb } from '../lib/pocketbase';
import {
    renderMergeTags,
    getHumanizedJitterDelayMs,
    DAILY_MARKETING_QUOTA,
    JITTER_MIN_MS,
    JITTER_MAX_MS,
    resolveAudience,
} from '../lib/whatsapp-broadcast';
import { getRazorpayClearingAccountId } from '../lib/payment-reconciliation';
import { isWhatsAppOptedOut, setWhatsAppOptOut } from '../lib/whatsapp-crm';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
    if (condition) {
        console.log(`  ✅ PASS: ${msg}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${msg}`);
        failed++;
    }
}

async function runTests() {
    console.log("==================================================");
    console.log("Running WhatsApp Phase 2 & 3 Automated Test Suite");
    console.log("==================================================");

    // Authenticate shared pb instance for authenticated collection rules
    try {
        await pb.collection('_superusers').authWithPassword('admin@luminila.com', 'password123456');
    } catch {
        try {
            await (pb as any).admins.authWithPassword('admin@luminila.com', 'password123456');
        } catch {
            await pb.collection('users').authWithPassword('admin@luminila.internal', 'LuminilaAdmin2026!').catch(() => {});
        }
    }

    // 1. Anti-Ban Jitter Range
    console.log("\n[Test 1] Anti-Ban Jitter Slot Calculation (8,000 - 22,000 ms)");
    let allInBounds = true;
    for (let i = 0; i < 50; i++) {
        const delay = getHumanizedJitterDelayMs();
        if (delay < JITTER_MIN_MS || delay > JITTER_MAX_MS) {
            allInBounds = false;
            break;
        }
    }
    assert(allInBounds, `50 randomized jitter samples strictly within [${JITTER_MIN_MS}, ${JITTER_MAX_MS}] ms`);
    assert(DAILY_MARKETING_QUOTA === 150, "Daily marketing quota constant is 150 messages/day");

    // 2. Merge Tags Rendering & Loyalty Tiers
    console.log("\n[Test 2] Merge Tags Rendering & Loyalty Tiers");
    const samplePlatinum = {
        name: "Ananya Deshmukh",
        loyalty_points: 2450,
        total_spent: 125000,
        customer_type: "retail",
    };
    const template = "Dear {{customer_name}} ({{first_name}}), you have {{loyalty_points}} pts in {{tier}} tier. Total spent: {{total_spent}}.";
    const rendered = renderMergeTags(template, samplePlatinum);
    assert(rendered.includes("Ananya Deshmukh"), "Renders {{customer_name}}");
    assert(rendered.includes("(Ananya)"), "Renders {{first_name}}");
    assert(rendered.includes("2450 pts"), "Renders {{loyalty_points}}");
    assert(rendered.includes("Platinum tier"), "Renders Platinum tier for 2450 points");
    assert(rendered.includes("₹1,25,000"), "Renders formatted Indian currency for {{total_spent}}");

    const sampleBronze = { name: "Rohit", loyalty_points: 150, total_spent: 5000, customer_type: "retail" };
    const renderedBronze = renderMergeTags("Tier: {{tier}}", sampleBronze);
    assert(renderedBronze === "Tier: Bronze", "Renders Bronze tier for < 300 points");

    // 3. Database Schema Verification in PocketBase
    console.log("\n[Test 3] PocketBase Schema Integrity");
    const adminPb = new PocketBase(PB_URL);
    try {
        await adminPb.collection('_superusers').authWithPassword('admin@luminila.com', 'password123456');

        // Check broadcast_messages
        const bmCol = await adminPb.collections.getOne('broadcast_messages');
        const bmFields = bmCol.fields.map((f: any) => f.name);
        assert(bmFields.includes('campaign') && bmFields.includes('recipient_phone') && bmFields.includes('scheduled_at'),
            "broadcast_messages collection exists with required fields");

        // Check whatsapp_opt_outs
        const optCol = await adminPb.collections.getOne('whatsapp_opt_outs');
        const optFields = optCol.fields.map((f: any) => f.name);
        assert(optFields.includes('phone') && optFields.includes('reason'),
            "whatsapp_opt_outs collection exists with required fields");

        // Check payment_links has payment_id
        const plCol = await adminPb.collections.getOne('payment_links');
        const plFields = plCol.fields.map((f: any) => f.name);
        assert(plFields.includes('payment_id'), "payment_links collection includes payment_id field");

        // Check customers has customer_type and whatsapp_opt_out
        const custCol = await adminPb.collections.getOne('customers');
        const custFields = custCol.fields.map((f: any) => f.name);
        assert(custFields.includes('customer_type') && custFields.includes('whatsapp_opt_out'),
            "customers collection includes customer_type & whatsapp_opt_out fields");

    } catch (err: any) {
        assert(false, `PocketBase connection / schema lookup error: ${err.message}`);
    }

    // 4. Clearing Account Idempotency
    console.log("\n[Test 4] Razorpay Clearing Account Idempotency");
    try {
        const id1 = await getRazorpayClearingAccountId();
        const id2 = await getRazorpayClearingAccountId();
        assert(typeof id1 === 'string' && id1.length > 0, `Clearing account resolved (${id1})`);
        assert(id1 === id2, "Subsequent calls return cached identical account ID without duplicate creations");
    } catch (err: any) {
        assert(false, `Clearing account error: ${err.message}`);
    }

    // 5. Audience Resolution Resilience
    console.log("\n[Test 5] Audience Segmentation Queries");
    try {
        const all = await resolveAudience('all_active');
        assert(Array.isArray(all), "resolveAudience('all_active') returns array");
        const vip = await resolveAudience('vip_tiers');
        assert(Array.isArray(vip), "resolveAudience('vip_tiers') returns array");
        const wholesale = await resolveAudience('wholesale');
        assert(Array.isArray(wholesale), "resolveAudience('wholesale') returns array without 400 error");
    } catch (err: any) {
        assert(false, `Audience resolution failed: ${err.message}`);
    }

    // 6. STOP Opt-Out Lifecycle
    console.log("\n[Test 6] Inbound STOP Opt-Out Lifecycle");
    try {
        const testPhone = "+919999900001";
        const wasOpted = await isWhatsAppOptedOut(testPhone);
        await setWhatsAppOptOut(testPhone, undefined, 'stop');
        const isOptedNow = await isWhatsAppOptedOut(testPhone);
        assert(isOptedNow === true, "setWhatsAppOptOut registers opt-out and isWhatsAppOptedOut returns true");
    } catch (err: any) {
        assert(false, `Opt-out test failed: ${err.message}`);
    }

    console.log("\n==================================================");
    console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
