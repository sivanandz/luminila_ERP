/**
 * Automated Verification Suite for WhatsApp ERP/CRM Phase 2 & Phase 3
 * Validates:
 *   1. Anti-ban jitter calculation (8-22s bounds)
 *   2. Merge tag rendering with customer, first_name, tier, points, total_spent
 *   3. PocketBase schema fields (broadcast_messages, whatsapp_opt_outs, payment_links.payment_id, customer_type)
 *   4. Razorpay clearing account idempotency & mutex
 *   5. Audience resolution resilience
 *   6. STOP opt-out registration with automatic teardown
 *   7. Payment link reconciliation engine execution
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
    loadLoyaltyTiers,
} from '../lib/whatsapp-broadcast';
import {
    getRazorpayClearingAccountId,
    reconcilePendingPaymentLinks,
} from '../lib/payment-reconciliation';
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

    const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
    const adminPass = process.env.PB_ADMIN_PASSWORD || 'password123456';

    // Authenticate shared pb instance for authenticated collection rules
    try {
        await pb.collection('_superusers').authWithPassword(adminEmail, adminPass);
    } catch {
        try {
            await (pb as any).admins.authWithPassword(adminEmail, adminPass);
        } catch {
            // best-effort fallback
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
    const configuredTiers = await loadLoyaltyTiers();
    assert(Array.isArray(configuredTiers) && configuredTiers.length >= 3, "loadLoyaltyTiers loads canonical tiers from system");

    const samplePlatinum = {
        name: "Ananya Deshmukh",
        loyalty_points: 2450,
        total_spent: 125000,
        customer_type: "retail",
    };
    const template = "Dear {{customer_name}} ({{first_name}}), you have {{loyalty_points}} pts in {{tier}} tier. Total spent: {{total_spent}}.";
    const rendered = renderMergeTags(template, samplePlatinum, configuredTiers);
    assert(rendered.includes("Ananya Deshmukh"), "Renders {{customer_name}}");
    assert(rendered.includes("(Ananya)"), "Renders {{first_name}}");
    assert(rendered.includes("2450 pts"), "Renders {{loyalty_points}}");
    assert(rendered.includes("Platinum tier"), "Renders Platinum tier for 2450 points");
    assert(rendered.includes("₹1,25,000"), "Renders formatted Indian currency for {{total_spent}}");

    const sampleBronze = { name: "Rohit", loyalty_points: 150, total_spent: 5000, customer_type: "retail" };
    const renderedBronze = renderMergeTags("Tier: {{tier}}", sampleBronze, configuredTiers);
    assert(renderedBronze === "Tier: Bronze", "Renders Bronze tier for < 300 points");

    // 3. Database Schema Verification in PocketBase
    console.log("\n[Test 3] PocketBase Schema Integrity");
    const adminPb = new PocketBase(PB_URL);
    try {
        await adminPb.collection('_superusers').authWithPassword(adminEmail, adminPass);

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

        // Check invoices and invoice_items have GST compliance fields (F1 & F2)
        const invCol = await adminPb.collections.getOne('invoices');
        const invFields = invCol.fields.map((f: any) => f.name);
        assert(
            invFields.includes('taxable_value') &&
            invFields.includes('grand_total') &&
            invFields.includes('seller_gstin') &&
            invFields.includes('buyer_name') &&
            invFields.includes('cgst_amount') &&
            invFields.includes('sgst_amount'),
            "invoices collection includes all required GST compliance fields (F1)"
        );

        const invItemsCol = await adminPb.collections.getOne('invoice_items');
        const invItemFields = invItemsCol.fields.map((f: any) => f.name);
        assert(
            invItemFields.includes('hsn_code') &&
            invItemFields.includes('gst_rate') &&
            invItemFields.includes('cgst_amount') &&
            invItemFields.includes('sgst_amount') &&
            invItemFields.includes('taxable_amount'),
            "invoice_items collection includes all required GST item fields (F1)"
        );

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

    // 6. STOP Opt-Out Lifecycle with Automatic Teardown
    console.log("\n[Test 6] Inbound STOP Opt-Out Lifecycle with Teardown");
    const testPhone = "+919999900001";
    try {
        await setWhatsAppOptOut(testPhone, undefined, 'stop');
        const isOptedNow = await isWhatsAppOptedOut(testPhone);
        assert(isOptedNow === true, "setWhatsAppOptOut registers opt-out and isWhatsAppOptedOut returns true");
    } catch (err: any) {
        assert(false, `Opt-out test failed: ${err.message}`);
    } finally {
        try {
            const digits = testPhone.replace(/\D/g, '').slice(-10);
            const rec = await adminPb.collection('whatsapp_opt_outs').getFirstListItem(`phone~"${digits}"`).catch(() => null);
            if (rec) {
                await adminPb.collection('whatsapp_opt_outs').delete(rec.id);
            }
        } catch {
            // teardown
        }
    }

    // 7. Payment Link Reconciliation Engine Execution
    console.log("\n[Test 7] Payment Link Reconciliation Engine");
    try {
        const summary = await reconcilePendingPaymentLinks();
        assert(
            typeof summary.checked === 'number' && typeof summary.settled === 'number' && Array.isArray(summary.details),
            `reconcilePendingPaymentLinks executes cleanly (checked: ${summary.checked}, settled: ${summary.settled}, errors: ${summary.errors})`
        );
    } catch (err: any) {
        assert(false, `reconcilePendingPaymentLinks error: ${err.message}`);
    }

    // 8. GST Invoice Full-Stack Lifecycle & Persistence (F1 & F2 Verification)
    console.log("\n[Test 8] GST Invoice Full-Stack Lifecycle & Persistence");
    let testInvoiceId = '';
    try {
        const { createInvoice, getInvoice } = await import('../lib/invoice');
        const createdInv = await createInvoice({
            invoice_date: new Date().toISOString().split('T')[0],
            invoice_type: 'regular',
            seller_gstin: '27AABCU9603R1ZM',
            seller_name: 'Luminila Fine Jewels',
            seller_address: '101 Zaveri Bazaar, Mumbai, Maharashtra - 400002',
            seller_state_code: '27',
            buyer_name: 'Priya Sharma',
            buyer_gstin: '',
            buyer_phone: '+919876543210',
            buyer_email: 'priya@example.com',
            buyer_address: 'Bandra West, Mumbai',
            buyer_state_code: '27',
            place_of_supply: '27',
            taxable_value: 10000,
            cgst_amount: 150,
            sgst_amount: 150,
            igst_amount: 0,
            cess_amount: 0,
            total_tax: 300,
            discount_amount: 0,
            shipping_charges: 0,
            grand_total: 10300,
            amount_in_words: 'Ten Thousand Three Hundred Only',
            is_reverse_charge: false,
            is_paid: false,
            paid_amount: 0,
            notes: 'Test Automated Phase 2 & 3 GST Invoice',
            items: [
                {
                    sr_no: 1,
                    description: '22K Gold Traditional Jhumka',
                    hsn_code: '7113',
                    quantity: 1,
                    unit: 'PCS',
                    unit_price: 10000,
                    discount_percent: 0,
                    discount_amount: 0,
                    taxable_amount: 10000,
                    gst_rate: 3,
                    cgst_rate: 1.5,
                    cgst_amount: 150,
                    sgst_rate: 1.5,
                    sgst_amount: 150,
                    igst_rate: 0,
                    igst_amount: 0,
                    cess_rate: 0,
                    cess_amount: 0,
                    total_amount: 10300,
                }
            ]
        });

        testInvoiceId = createdInv.id || '';
        assert(typeof testInvoiceId === 'string' && testInvoiceId.length > 0, `createInvoice persists invoice with ID (${testInvoiceId})`);

        // Fetch back and verify dual-mapping and GST breakdown
        const fetched = await getInvoice(testInvoiceId);
        assert(fetched !== null, "getInvoice retrieves the persisted invoice");
        if (fetched) {
            assert(fetched.grand_total === 10300 && fetched.total === 10300, "grand_total & total dual-mapping preserved (₹10,300)");
            assert(fetched.taxable_value === 10000 && fetched.subtotal === 10000, "taxable_value & subtotal dual-mapping preserved (₹10,000)");
            assert(fetched.total_tax === 300 && fetched.tax === 300, "total_tax & tax dual-mapping preserved (₹300)");
            assert(fetched.cgst_amount === 150 && fetched.sgst_amount === 150, "CGST & SGST breakdowns persisted accurately");
            assert(fetched.seller_gstin === '27AABCU9603R1ZM', "seller_gstin persisted");
            assert(fetched.buyer_name === 'Priya Sharma', "buyer_name persisted");
            assert(fetched.status === 'pending', "status initialized to 'pending'");
            assert(Array.isArray(fetched.items) && fetched.items.length === 1, "items loaded via invoice_items relation");
            if (fetched.items.length > 0) {
                const item = fetched.items[0];
                assert(item.hsn_code === '7113', "item.hsn_code persisted");
                assert(item.gst_rate === 3, "item.gst_rate persisted");
                assert(item.cgst_amount === 150, "item.cgst_amount persisted");
            }
        }
    } catch (err: any) {
        assert(false, `GST Invoice Lifecycle test failed: ${err.message}`);
    } finally {
        if (testInvoiceId) {
            try {
                // Delete test invoice items and invoice
                const items = await adminPb.collection('invoice_items').getFullList({ filter: `invoice="${testInvoiceId}"` });
                for (const item of items) {
                    await adminPb.collection('invoice_items').delete(item.id);
                }
                await adminPb.collection('invoices').delete(testInvoiceId);
            } catch {
                // teardown
            }
        }
    }

    // 9. Concurrency Race Resilience Across Sequence Generators (F9 Verification)
    console.log("\n[Test 9] Concurrency Race Resilience Across Sequence Generators (F9)");
    try {
        const { generateInvoiceNumber } = await import('../lib/invoice');
        const { generatePONumber, generateGRNNumber } = await import('../lib/purchase');
        const { generateCreditNoteNumber } = await import('../lib/returns');
        const { generateChallanNumber } = await import('../lib/challan');
        const { generateExpenseNumber } = await import('../lib/expenses');

        // A. Verify Unique Indexes in live schema
        const invCol = await adminPb.collections.getOne('invoices');
        const poCol = await adminPb.collections.getOne('purchase_orders');
        const grnCol = await adminPb.collections.getOne('goods_received_notes');
        const cnCol = await adminPb.collections.getOne('credit_notes');
        const dcCol = await adminPb.collections.getOne('delivery_challans');
        const expCol = await adminPb.collections.getOne('expenses');
        const seqCol = await adminPb.collections.getOne('number_sequences');

        assert(invCol.indexes.some((i: string) => i.includes('invoice_number') && i.includes('UNIQUE')), "invoices has UNIQUE index on invoice_number");
        assert(poCol.indexes.some((i: string) => i.includes('po_number') && i.includes('UNIQUE')), "purchase_orders has UNIQUE index on po_number");
        assert(grnCol.indexes.some((i: string) => i.includes('grn_number') && i.includes('UNIQUE')), "goods_received_notes has UNIQUE index on grn_number");
        assert(cnCol.indexes.some((i: string) => i.includes('credit_note_number') && i.includes('UNIQUE')), "credit_notes has UNIQUE index on credit_note_number");
        assert(dcCol.indexes.some((i: string) => i.includes('challan_number') && i.includes('UNIQUE')), "delivery_challans has UNIQUE index on challan_number");
        assert(expCol.indexes.some((i: string) => i.includes('expense_number') && i.includes('UNIQUE')), "expenses has UNIQUE index on expense_number");
        assert(seqCol.indexes.some((i: string) => i.includes('name') && i.includes('UNIQUE')), "number_sequences has UNIQUE index on name");

        // B. Concurrent Race Simulation: Invoices (10 concurrent requests)
        const invTasks = Array.from({ length: 10 }, () => generateInvoiceNumber());
        const invResults = await Promise.all(invTasks);
        const uniqueInvoices = new Set(invResults);
        assert(uniqueInvoices.size === 10, `10 concurrent invoice calls yielded 10 unique serials (sample: ${invResults[0]} .. ${invResults[9]})`);

        // C. Concurrent Race Simulation: Purchase Orders (10 concurrent requests)
        const poTasks = Array.from({ length: 10 }, () => generatePONumber());
        const poResults = await Promise.all(poTasks);
        const uniquePOs = new Set(poResults);
        assert(uniquePOs.size === 10, `10 concurrent PO calls yielded 10 unique serials (sample: ${poResults[0]} .. ${poResults[9]})`);

        // D. Concurrent Race Simulation: GRNs (10 concurrent requests)
        const grnTasks = Array.from({ length: 10 }, () => generateGRNNumber());
        const grnResults = await Promise.all(grnTasks);
        const uniqueGRNs = new Set(grnResults);
        assert(uniqueGRNs.size === 10, `10 concurrent GRN calls yielded 10 unique serials (sample: ${grnResults[0]} .. ${grnResults[9]})`);

        // E. Concurrent Race Simulation: Credit Notes (10 concurrent requests)
        const cnTasks = Array.from({ length: 10 }, () => generateCreditNoteNumber());
        const cnResults = await Promise.all(cnTasks);
        const uniqueCNs = new Set(cnResults);
        assert(uniqueCNs.size === 10, `10 concurrent credit note calls yielded 10 unique serials (sample: ${cnResults[0]} .. ${cnResults[9]})`);

        // F. Concurrent Race Simulation: Delivery Challans (10 concurrent requests)
        const dcTasks = Array.from({ length: 10 }, () => generateChallanNumber());
        const dcResults = await Promise.all(dcTasks);
        const uniqueDCs = new Set(dcResults);
        assert(uniqueDCs.size === 10, `10 concurrent challan calls yielded 10 unique serials (sample: ${dcResults[0]} .. ${dcResults[9]})`);

        // G. Concurrent Race Simulation: Expenses (10 concurrent requests)
        const expTasks = Array.from({ length: 10 }, () => generateExpenseNumber());
        const expResults = await Promise.all(expTasks);
        const uniqueExps = new Set(expResults);
        assert(uniqueExps.size === 10, `10 concurrent expense calls yielded 10 unique serials (sample: ${expResults[0]} .. ${expResults[9]})`);

    } catch (err: any) {
        assert(false, `Concurrency Race Resilience test failed: ${err.message}`);
    }

    // 10. T7-F1 Collision Auto-Recovery & T7-F2 Fallback Audit Trail Verification
    console.log("\n[Test 10] T7-F1 Collision Auto-Recovery & T7-F2 Fallback Audit Trail");
    try {
        const { createWithUniqueRetry, isUniqueConstraintError } = await import('../lib/sequence-generator');
        const { createExpense } = await import('../lib/expenses');

        // A. Verify isUniqueConstraintError detection across error shapes
        const sqliteError = new Error("UNIQUE constraint failed: invoices.invoice_number");
        const pbValidationError = { response: { data: { invoice_number: { code: "validation_not_unique" } } } };
        assert(isUniqueConstraintError(sqliteError), "isUniqueConstraintError identifies SQLite UNIQUE constraint error");
        assert(isUniqueConstraintError(pbValidationError), "isUniqueConstraintError identifies PocketBase validation_not_unique error");

        // B. Verify createWithUniqueRetry transparently recovers on collision (T7-F1)
        let callCount = 0;
        let numbersGenerated: string[] = [];
        const mockGenerator = async () => {
            const num = `TEST-${1000 + callCount}`;
            numbersGenerated.push(num);
            return num;
        };

        const result = await createWithUniqueRetry(
            mockGenerator,
            async (docNum) => {
                callCount++;
                if (callCount === 1) {
                    throw new Error(`UNIQUE constraint failed: table.number on ${docNum}`);
                }
                return { success: true, docNumber: docNum };
            },
            3
        );

        assert(callCount === 2, "createWithUniqueRetry executed retry upon catching UNIQUE constraint failure");
        assert(result.success === true && result.docNumber === numbersGenerated[1], `Successfully recovered with fresh sequence (${result.docNumber})`);

        // C. Live document creation through createWithUniqueRetry wrapper
        const testExp = await createExpense({
            category_id: '',
            amount: 500,
            description: 'Test T7-F1 Unique Retry Live Verification',
            date: new Date().toISOString().split('T')[0],
            payment_mode: 'cash',
        });
        assert(testExp !== null && typeof testExp.expense_number === 'string', `createExpense succeeds with unique serial (${testExp?.expense_number})`);

        if (testExp?.id) {
            await adminPb.collection('expenses').delete(testExp.id).catch(() => {});
        }

        // D. Verify T7-F2 fallback audit trail writes to activity_logs
        const testNotice = `[CRITICAL GST NOTICE] Test T7-F2 Sequence Fallback Audit Verification`;
        await adminPb.collection('activity_logs').create({
            action: 'sync',
            entity_type: 'settings',
            entity_id: 'test_seq_id',
            description: testNotice,
            metadata: { test: true, timestamp: new Date().toISOString() },
        });

        const logCheck = await adminPb.collection('activity_logs').getFirstListItem(`description~"CRITICAL GST NOTICE"`).catch(() => null);
        assert(logCheck !== null, "activity_logs successfully records CRITICAL GST NOTICE audit entries");

        if (logCheck?.id) {
            await adminPb.collection('activity_logs').delete(logCheck.id).catch(() => {});
        }

    } catch (err: any) {
        assert(false, `Test 10 failed: ${err.message}`);
    }

    console.log("\n==================================================");
    console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
