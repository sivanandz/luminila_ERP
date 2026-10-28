/**
 * Gateway signature verification (CO-05). Pure test: no network, no database.
 * Run: npx tsx src/scripts/test-gateway-signature.ts
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setRazorpayConfig } from '../lib/razorpay';
import { verifyGatewaySignature } from '../lib/razorpay-orders';

setRazorpayConfig({ keyId: 'rzp_test_unit', keySecret: 'unit-test-secret' });

const orderId = 'order_unit_123';
const paymentId = 'pay_unit_456';
const signature = crypto
    .createHmac('sha256', 'unit-test-secret')
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
    if (ok) {
        passed += 1;
        console.log(`  PASS  ${name}`);
    } else {
        failed += 1;
        console.error(`  FAIL  ${name}`);
    }
}

check('valid signature verifies', verifyGatewaySignature({ orderId, paymentId, signature }));
check(
    'tampered signature is rejected',
    !verifyGatewaySignature({ orderId, paymentId, signature: 'deadbeef' })
);
check(
    'signature for a different order is rejected',
    !verifyGatewaySignature({ orderId: 'order_other', paymentId, signature })
);
check(
    'missing signature is rejected',
    !verifyGatewaySignature({ orderId, paymentId, signature: '' })
);

console.log(`\ngateway signature: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);