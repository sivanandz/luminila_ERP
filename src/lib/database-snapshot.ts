/**
 * Full database snapshot for the Settings → Export screen.
 *
 * The page used to fetch six collections inline and assemble the export object.
 * Keeping it here means the export shape has one definition and the page holds
 * no direct PocketBase access (D-23).
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

/** Keys whose values must never leave the device in an export. */
const SECRET_KEY = /(secret|token|password|passwd|api[_-]?key|credential|client[_-]?id)/i;

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
    // Exports are tenant-scoped and fail closed without a tenant: a superuser
    // read with no filter would dump every store's data and secrets (AI-SYS-03).
    const tenant = accountScopeEmail();
    const scope = tenant ? `account_email = "${sanitizeFilter(tenant)}"` : 'id = ""';

    const [products, variants, customers, invoices, invoiceItems, settingsRaw] = await Promise.all([
        pb.collection('products').getFullList({ filter: scope, sort: '-created' }).catch(() => []),
        pb.collection('product_variants').getFullList({ filter: scope }).catch(() => []),
        pb.collection('customers').getFullList({ filter: scope }).catch(() => []),
        pb.collection('invoices').getFullList({ filter: scope }).catch(() => []),
        pb.collection('invoice_items').getFullList({ filter: scope }).catch(() => []),
        pb.collection('store_settings').getFullList({ filter: scope }).catch(() => []),
    ]);

    const settingsList = settingsRaw.map((row) => {
        const key = String((row as { key?: string }).key || '');
        return SECRET_KEY.test(key)
            ? { ...(row as Record<string, unknown>), value: '[REDACTED]' }
            : row;
    });

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
