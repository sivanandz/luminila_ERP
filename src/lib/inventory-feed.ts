/**
 * Realtime inventory feed.
 *
 * The inventory page subscribed to five collections directly and unsubscribed
 * by hand. Subscription lifecycle is easy to leak from a component, so it lives
 * here with one call returning its own cleanup.
 */

import { pb } from './pocketbase';

export interface InventoryFeedHandlers {
    /** Product, variant, GRN or PO data changed. */
    onChange: () => void;
    /** Purchase orders or goods receipts changed (pending quantities). */
    onProcurementChange?: () => void;
    /** Stock discrepancies changed (badge count). */
    onDiscrepancyChange?: () => void;
}

export function subscribeInventoryChanges(handlers: InventoryFeedHandlers): () => void {
    const subscriptions: Array<Promise<unknown>> = [];

    subscriptions.push(pb.collection('products').subscribe('*', handlers.onChange).catch(() => {}));
    subscriptions.push(pb.collection('product_variants').subscribe('*', handlers.onChange).catch(() => {}));

    const procurement = () => {
        handlers.onChange();
        handlers.onProcurementChange?.();
    };
    subscriptions.push(pb.collection('goods_received_notes').subscribe('*', procurement).catch(() => {}));
    subscriptions.push(pb.collection('purchase_orders').subscribe('*', procurement).catch(() => {}));

    const discrepancies = () => {
        handlers.onChange();
        handlers.onDiscrepancyChange?.();
    };
    subscriptions.push(pb.collection('stock_discrepancies').subscribe('*', discrepancies).catch(() => {}));

    // Keep the array referenced so linters do not treat the pushes as unused.
    void subscriptions;

    return () => {
        pb.collection('products').unsubscribe('*').catch(() => {});
        pb.collection('product_variants').unsubscribe('*').catch(() => {});
        pb.collection('goods_received_notes').unsubscribe('*').catch(() => {});
        pb.collection('purchase_orders').unsubscribe('*').catch(() => {});
        pb.collection('stock_discrepancies').unsubscribe('*').catch(() => {});
    };
}
