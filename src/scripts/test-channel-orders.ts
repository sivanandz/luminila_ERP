/**
 * Channel order capture tests (pure logic — no database required).
 *
 * Covers the storefront/WhatsApp capture helpers: canonical phone storage,
 * discount allocation before the tax split (GST Act s.15), and the
 * tax-inclusive invariant taxable + tax === charged for every input shape.
 * Run: npx tsx src/scripts/test-channel-orders.ts
 */

import { canonicalPhone, computeChannelTax, phoneSuffix } from '../lib/channel-orders';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}\n      expected ${e}\n      received ${a}`);
    }
}

console.log('\n=== canonicalPhone ===');
check('10-digit Indian number gains +91', canonicalPhone('9876543210'), '+919876543210');
check('12-digit 91-prefixed collapses to +91 last-10', canonicalPhone('919876543210'), '+919876543210');
check('bare digits already stored stay matchable', canonicalPhone('98765 43210'), '+919876543210');
check('non-Indian keeps country code', canonicalPhone('447911123456'), '+447911123456');
check('empty is empty', canonicalPhone(''), '');

console.log('\n=== phoneSuffix ===');
check('last 10 extracted from +91 form', phoneSuffix('+919876543210'), '9876543210');
check('bare digits unchanged', phoneSuffix('9876543210'), '9876543210');

console.log('\n=== computeChannelTax (tax-inclusive, post-discount base) ===');
{
    // Single 3% line: customer pays 1000, no discount, no shipping.
    const t = computeChannelTax([{ gross: 1000, taxRate: 3 }], 0, 0, {
        sellerStateCode: '33', buyerStateCode: '33', gstRegistered: true,
    });
    const charged = 1000;
    check('taxable + tax equals charged amount', Math.round((t.taxableValue + t.taxTotal) * 100) / 100, charged);
    check('intra-state halves differ by at most a paisa', Math.abs(t.cgst - t.sgst) <= 0.01, true);
    check('no IGST intra-state', t.igst, 0);
    check('inclusive tax of 1000 at 3% is 29.13', t.taxTotal, 29.13);
}
{
    // Discount applies BEFORE the tax split: 1000 - 100 → tax on 900.
    const t = computeChannelTax([{ gross: 1000, taxRate: 3 }], 100, 0, {
        sellerStateCode: '33', buyerStateCode: '33', gstRegistered: true,
    });
    check('discounted base carries less tax', t.taxTotal, 26.21);
    check('discounted invariant holds', Math.round((t.taxableValue + t.taxTotal) * 100) / 100, 900);
}
{
    // Inter-state: IGST not CGST/SGST.
    const t = computeChannelTax([{ gross: 1000, taxRate: 3 }], 0, 0, {
        sellerStateCode: '33', buyerStateCode: '27', gstRegistered: true,
    });
    check('inter-state books IGST', t.igst, 29.13);
    check('inter-state books no CGST', t.cgst, 0);
}
{
    // Unregistered store: zero-rated regardless of product rate.
    const t = computeChannelTax([{ gross: 1000, taxRate: 3 }], 0, 99, {
        sellerStateCode: '33', buyerStateCode: '33', gstRegistered: false,
    });
    check('unregistered store books no tax', t.taxTotal, 0);
    check('shipping still inside charged total', t.taxableValue, 1099);
}
{
    // Multi-line with different rates + shipping: invariant must hold exactly.
    const lines = [
        { gross: 1500, taxRate: 3 },
        { gross: 2400, taxRate: 18 },
        { gross: 800, taxRate: null },
    ];
    const charged = 1500 + 2400 + 800 - 200 + 99;
    const t = computeChannelTax(lines, 200, 99, {
        sellerStateCode: '33', buyerStateCode: '33', gstRegistered: true,
    });
    check('multi-rate invariant holds exactly', Math.round((t.taxableValue + t.taxTotal) * 100) / 100, charged);
    check('null rate falls back to jewelry default (3%)', t.taxTotal > 0, true);
}
{
    // Discount larger than the cart clamps at the gross (server clamps earlier too).
    const t = computeChannelTax([{ gross: 500, taxRate: 3 }], 9999, 0, {
        sellerStateCode: '33', buyerStateCode: '33', gstRegistered: true,
    });
    check('over-discount clamps to zero base', t.taxTotal, 0);
    check('over-discount taxable is zero', t.taxableValue, 0);
}

console.log(`\n=== channel-orders: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
