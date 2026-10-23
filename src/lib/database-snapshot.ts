/**
 * Full database snapshot for the Settings → Export screen.
 *
 * The page used to fetch six collections inline and assemble the export object.
 * Keeping it here means the export shape has one definition and the page holds
 * no direct PocketBase access (D-23).
 */

import { pb } from './pocketbase';

export interface DatabaseSnapshot {
    app: string;
    version: string;
    exported_at: string;
    exported_by: string;
    summary: {
        products_count: number;
        variants_count: number;
        customers_count: number;
        invoices_count: number;
        invoice_items_count: number;
    };
    data: {
        products: unknown[];
        product_variants: unknown[];
        customers: unknown[];
        invoices: unknown[];
        invoice_items: unknown[];
        store_settings: unknown[];
    };
}

export async function collectDatabaseSnapshot(exportedBy: string): Promise<DatabaseSnapshot> {
    const [products, variants, customers, invoices, invoiceItems, settingsList] = await Promise.all([
        pb.collection('products').getFullList({ sort: '-created' }).catch(() => []),
        pb.collection('product_variants').getFullList().catch(() => []),
        pb.collection('customers').getFullList().catch(() => []),
        pb.collection('invoices').getFullList().catch(() => []),
        pb.collection('invoice_items').getFullList().catch(() => []),
        pb.collection('store_settings').getFullList().catch(() => []),
    ]);

    return {
        app: "Luminila Jewelry ERP",
        version: "2.1.0",
        exported_at: new Date().toISOString(),
        exported_by: exportedBy,
        summary: {
            products_count: products.length,
            variants_count: variants.length,
            customers_count: customers.length,
            invoices_count: invoices.length,
            invoice_items_count: invoiceItems.length,
        },
        data: {
            products,
            product_variants: variants,
            customers,
            invoices,
            invoice_items: invoiceItems,
            store_settings: settingsList,
        },
    };
}
