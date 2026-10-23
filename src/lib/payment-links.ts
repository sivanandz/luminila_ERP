import { pb } from './pocketbase';

/** Ledger a gateway payment link (payment_links collection). */
export async function createPaymentLinkLedger(payload: Record<string, unknown>): Promise<void> {
    await pb.collection('payment_links').create(payload);
}
