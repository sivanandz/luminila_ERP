/**
 * Full database snapshot for the Settings → Export screen.
 *
 * The page used to fetch six collections inline and assemble the export object.
 * Keeping it here means the export shape has one definition and the page holds
 * no direct PocketBase access (D-23).
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

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
        /** H-36: money, cash and stock must be reconstructible from a snapshot. */
        invoice_payments: unknown[];
        sales: unknown[];
        sale_items: unknown[];
        stock_movements: unknown[];
        vendors: unknown[];
        purchase_orders: unknown[];
        expenses: unknown[];
    };
}

/** Keys whose values must never leave the device in an export. */
const SECRET_KEY = /(secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|client[_-]?id)/i;

/** Row fields that name/identify a setting rather than hold its payload. */
const SETTING_ID_FIELDS = new Set(['id', 'key', 'collectionId', 'collectionName', 'created', 'updated']);

/**
 * A long unbroken base64/hex-looking string is treated as a secret even when
 * its field name says nothing (INF-8). Deliberately narrow: data URIs, prose,
 * and short values are left alone.
 */
function looksLikeSecretValue(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length < 32 || trimmed.length > 4096 || /\s/.test(trimmed)) return false;
    if (/^[0-9a-f]{32,}$/i.test(trimmed)) return true;
    if (trimmed.length >= 40 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
        const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[+/]/].filter((pattern) => pattern.test(trimmed)).length;
        return classes >= 3 || /[+/]/.test(trimmed);
    }
    return false;
}

/** Redact secrets by setting name and, additionally, by value pattern (INF-8). */
function redactSettingsRow(row: unknown): unknown {
    if (!row || typeof row !== 'object') return row;
    const record = row as Record<string, unknown>;
    const result: Record<string, unknown> = { ...record };

    // Existing rule: a secret-looking setting name redacts its value.
    if (SECRET_KEY.test(String(record.key || ''))) {
        result.value = '[REDACTED]';
    }

    for (const [field, value] of Object.entries(record)) {
        if (typeof value !== 'string' || SETTING_ID_FIELDS.has(field)) continue;
        if (SECRET_KEY.test(field) || looksLikeSecretValue(value)) {
            result[field] = '[REDACTED]';
        }
    }
    return result;
}

type ReadResult<T> =
    | { ok: true; rows: T[] }
    | { ok: false; error: string };

/**
 * Read one collection, converting a failure into a result the caller can
 * surface (INF-6). Auth/network errors must never look like an empty table.
 */
async function readCollection<T extends Record<string, unknown>>(
    collection: string,
    options: { filter?: string; sort?: string },
): Promise<ReadResult<T>> {
    try {
        return { ok: true, rows: await pb.collection(collection).getFullList<T>(options) };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `${collection}: ${detail}` };
    }
}

export async function collectDatabaseSnapshot(exportedBy: string): Promise<DatabaseSnapshot> {
    // Exports are tenant-scoped and fail closed without a tenant: a superuser
    // read with no filter would dump every store's data and secrets (AI-SYS-03).
    const tenant = accountScopeEmail();
    const scope = tenant ? `account_email = "${sanitizeFilter(tenant)}"` : 'id = ""';

    const [products, variants, customers, invoices, invoiceItems, settingsRaw, payments, sales, saleItems, movements, vendors, purchaseOrders, expenses] = await Promise.all([
        readCollection('products', { filter: scope, sort: '-created' }),
        readCollection('product_variants', { filter: scope }),
        readCollection('customers', { filter: scope }),
        readCollection('invoices', { filter: scope }),
        readCollection('invoice_items', { filter: scope }),
        readCollection('store_settings', { filter: scope }),
        readCollection('invoice_payments', { filter: scope }),
        readCollection('sales', { filter: scope }),
        readCollection('sale_items', { filter: scope }),
        readCollection('stock_movements', { filter: scope }),
        readCollection('vendors', { filter: scope }),
        readCollection('purchase_orders', { filter: scope }),
        readCollection('expenses', { filter: scope }),
    ]);

    // INF-6: a failed read used to become `.catch(() => [])`, silently exporting
    // a zero-row backup. Fail the whole export instead of producing one.
    // The explicit checks narrow each discriminated union so `.rows` is safe.
    if (
        !products.ok || !variants.ok || !customers.ok || !invoices.ok || !invoiceItems.ok ||
        !settingsRaw.ok || !payments.ok || !sales.ok || !saleItems.ok || !movements.ok ||
        !vendors.ok || !purchaseOrders.ok || !expenses.ok
    ) {
        const failures = [
            products, variants, customers, invoices, invoiceItems, settingsRaw,
            payments, sales, saleItems, movements, vendors, purchaseOrders, expenses,
        ].flatMap((result) => (result.ok ? [] : [result.error]));
        throw new Error(
            `Database snapshot incomplete — ${failures.length} collection read(s) failed: ${failures.join('; ')}`
        );
    }

    const settingsList = settingsRaw.rows.map(redactSettingsRow);

    return {
        app: "Luminila Jewelry ERP",
        version: "2.2.0",
        exported_at: new Date().toISOString(),
        exported_by: exportedBy,
        summary: {
            products_count: products.rows.length,
            variants_count: variants.rows.length,
            customers_count: customers.rows.length,
            invoices_count: invoices.rows.length,
            invoice_items_count: invoiceItems.rows.length,
        },
        data: {
            products: products.rows,
            product_variants: variants.rows,
            customers: customers.rows,
            invoices: invoices.rows,
            invoice_items: invoiceItems.rows,
            store_settings: settingsList,
            invoice_payments: payments.rows,
            sales: sales.rows,
            sale_items: saleItems.rows,
            stock_movements: movements.rows,
            vendors: vendors.rows,
            purchase_orders: purchaseOrders.rows,
            expenses: expenses.rows,
        },
    };
}
