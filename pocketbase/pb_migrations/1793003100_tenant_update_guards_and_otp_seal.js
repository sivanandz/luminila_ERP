/// <reference path="../pb_data/types.d.ts" />

/**
 * Tenant-isolation hardening from the 2026-11-04 UI/tenant audit (Rev 3):
 *
 * 1. Freeze `account_email` on update for every collection that uses it as the
 *    tenant key. Several update rules only compared the *stored* record, so a
 *    user could PATCH their own row into another tenant (empirically
 *    reproduced for `otp_codes`, and via the `users` Admin branch into a full
 *    tenant takeover). The whole rule is wrapped in parentheses before the
 *    guard is ANDed, so rules whose top level is a `||` (users) keep both
 *    branches guarded. Rules that already end with the guard are skipped.
 *
 * 2. `otp_codes` becomes superuser-only. Only server routes touch it, and a
 *    tenant-readable salt + hash let any staff account brute-force a 6-digit
 *    code offline (audit C-06).
 *
 * 3. `consent_events` requires an authenticated, tenant-matching session for
 *    list/view/create; it was publicly readable and writable for empty-owner
 *    rows (audit M-01).
 *
 * 4. The five "phantom" collections lose their shared `account_email = ""`
 *    arm, but only after every empty-owner row could be backfilled to the one
 *    tenant this database serves. If orphan rows would be hidden by the
 *    tighter rule, the old rule stays and the migration logs loudly instead of
 *    silently hiding data (audit M-01).
 *
 * Construction follows the PB 0.25-safe order: mutate + save, never pass rules
 * through the Collection constructor.
 */

const BODY_GUARD = '@request.body.account_email:isset = false';
const TENANT_MATCH =
    '(account_email = @request.auth.email || account_email = @request.auth.account_email)';
const PHANTOM_COLLECTIONS = [
    'inventory_locations',
    'inventory_transfers',
    'catalog_sync_logs',
    'shipments',
    'cash_registers',
];

function hasField(collection, name) {
    try {
        return Boolean(collection.fields.find((field) => field.name === name));
    } catch (e) {
        return false;
    }
}

/** Fallback enumeration when findAllCollections() returns nothing (PB 0.25). */
const TENANT_COLLECTION_NAMES = [
    'activity_logs', 'ai_conversations', 'ai_events', 'ai_providers',
    'analytics_daily_snapshots', 'bank_accounts', 'bank_transactions',
    'broadcast_messages', 'cash_drawer_operations', 'cash_register_shifts',
    'cash_registers', 'catalog_sync_logs', 'categories', 'cheques',
    'consent_events', 'credit_note_items', 'credit_notes',
    'customer_interactions', 'customers', 'delivery_challan_items',
    'delivery_challans', 'discount_usage', 'discounts', 'expense_categories',
    'expenses', 'flash_drop_reservations', 'flash_drops',
    'goods_received_notes', 'grn_items', 'inventory_audits',
    'inventory_locations', 'inventory_transfers', 'invoice_items',
    'invoice_payments', 'invoices', 'label_print_queue', 'loyalty_accounts',
    'loyalty_settings', 'loyalty_tiers', 'loyalty_transactions',
    'manufacturing_jobs', 'number_sequences', 'order_packing', 'otp_codes',
    'payment_links', 'product_attribute_values', 'product_attributes',
    'product_variants', 'products', 'purchase_order_items', 'purchase_orders',
    'roles', 'sale_items', 'sales', 'sales_order_items', 'sales_orders',
    'shipments', 'stock_discrepancies', 'stock_movements', 'store_settings',
    'user_roles', 'users', 'vendor_products', 'vendors', 'whatsapp_campaigns',
    'whatsapp_chats', 'whatsapp_messages', 'whatsapp_opt_outs',
];

/** The single tenant this database serves, or "" when it cannot be proven. */
function singleTenantEmail(app) {
    try {
        const users = app.findRecordsByFilter('users', "account_email != ''", '', 0, 0);
        const seen = new Set();
        for (const user of users) {
            const value = String((user && user.get('account_email')) || '').trim().toLowerCase();
            if (value) seen.add(value);
        }
        if (seen.size === 1) return [...seen][0];
    } catch (e) {
        /* users table unavailable or empty */
    }
    return '';
}

migrate((app) => {
    // 1. account_email is frozen on update everywhere it is the tenant key.
    //
    // Two PB 0.25 JS-bridge traps shaped this loop: direct property assignment
    // on a collection wrapper silently no-ops (rules must go through
    // `unmarshal()`), and `app.findAllCollections()` proved unreliable, so the
    // enumeration falls back to an explicit name list taken from the schema.
    // `users` is an auth collection, not base, and it is exactly where the
    // unguarded Admin branch allowed a tenant takeover (audit C-03).
    let names = [];
    try {
        const found = app.findAllCollections() || [];
        names = found
            .filter((c) => c && (c.type === 'base' || c.type === 'auth'))
            .map((c) => String(c.name));
    } catch (e) {
        names = [];
    }
    if (names.length === 0) names = TENANT_COLLECTION_NAMES;

    let guarded = 0;
    for (const name of names) {
        let collection = null;
        try {
            collection = app.findCollectionByNameOrId(name);
        } catch (e) {
            continue;
        }
        if (!collection) continue;
        // Coerce: the bridge may hand back a String object rather than a
        // primitive, and `typeof rule !== 'string'` silently skipped every
        // collection on the first run.
        const rawRule = collection.updateRule;
        const rule = rawRule == null ? '' : String(rawRule);
        // Gate on the rule text rather than the field list: the fields proxy
        // has been unreliable across PB builds, and any update rule that
        // scopes by account_email is exactly the one that needs the freeze.
        if (rule.indexOf('account_email') === -1) continue;
        if (rule.trim() === '') continue;
        if (rule.trim().endsWith(BODY_GUARD)) continue; // already fully guarded
        try {
            unmarshal({ updateRule: '(' + rule + ') && ' + BODY_GUARD }, collection);
            app.save(collection);
            guarded += 1;
        } catch (e) {
            console.log('[audit-hardening] guard failed for', name, ':', e);
        }
    }
    console.log(
        '[audit-hardening] froze account_email on update for',
        guarded,
        'of',
        names.length,
        'collections'
    );

    // 2. otp_codes is server-owned data; no client needs it.
    try {
        const otp = app.findCollectionByNameOrId('otp_codes');
        otp.listRule = null;
        otp.viewRule = null;
        otp.createRule = null;
        otp.updateRule = null;
        otp.deleteRule = null;
        app.save(otp);
    } catch (e) {
        console.log('[audit-hardening] otp_codes seal skipped:', e);
    }

    // 3. consent_events: authenticated + tenant-matched, create freezes owner.
    try {
        const consent = app.findCollectionByNameOrId('consent_events');
        consent.listRule = '@request.auth.id != "" && ' + TENANT_MATCH;
        consent.viewRule = consent.listRule;
        consent.createRule = '@request.auth.id != "" && ' + TENANT_MATCH + ' && ' + BODY_GUARD;
        consent.updateRule = null;
        consent.deleteRule = null;
        app.save(consent);
    } catch (e) {
        console.log('[audit-hardening] consent_events tighten skipped:', e);
    }

    // 4. Phantom collections: backfill empty-owner rows, then drop the shared
    //    "" arm. Only tighten when no row would be orphaned.
    for (const name of PHANTOM_COLLECTIONS) {
        let collection = null;
        try {
            collection = app.findCollectionByNameOrId(name);
        } catch (e) {
            continue;
        }
        if (!collection || !hasField(collection, 'account_email')) continue;

        const owner = singleTenantEmail(app);
        if (owner) {
            try {
                const orphans = app.findRecordsByFilter(name, "account_email = ''", '', 0, 0);
                for (const row of orphans) {
                    row.set('account_email', owner);
                    app.save(row);
                }
            } catch (e) {
                console.log('[audit-hardening] backfill failed for', name, ':', e);
            }
        }

        // PB 0.25's JS bridge cannot take a raw string to countRecords, so
        // detect orphans with a limited find instead. On any error, fail safe:
        // keep the shared rule rather than risk hiding rows.
        let orphansLeft = 1;
        try {
            orphansLeft = app.findRecordsByFilter(name, "account_email = ''", '', 1, 0).length;
        } catch (e) {
            console.log('[audit-hardening] orphan check failed for', name, ':', e);
        }
        if (orphansLeft > 0) {
            console.log(
                '[audit-hardening] kept shared rule for',
                name,
                '-',
                orphansLeft,
                'orphan rows would be hidden'
            );
            continue;
        }

        collection.listRule = '@request.auth.id != "" && ' + TENANT_MATCH;
        collection.viewRule = collection.listRule;
        // Create requires an explicit owner: an unstamped row would be
        // invisible to every tenant (the "" arm is gone), so a silent orphan
        // is worse than a refused write. Superuser writes (server jobs) bypass
        // this rule, and every client write is stamped by beforeSend.
        collection.createRule =
            '@request.auth.id != "" && (@request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)';
        collection.updateRule =
            '@request.auth.id != "" && ' + TENANT_MATCH + ' && ' + BODY_GUARD;
        collection.deleteRule = collection.listRule;
        app.save(collection);
    }
}, (app) => {
    // Rollback restores the pre-audit shapes. otp_codes returns to its
    // tenant-scoped rule; consent_events returns to the unauthenticated
    // tenant-match; phantom collections regain the shared "" arm. Update-rule
    // guards are removed by stripping the appended suffix.
    const SUFFIX = ' && ' + BODY_GUARD;
    for (const collection of app.findAllCollections()) {
        if (!collection || collection.type !== 'base') continue;
        const rule = collection.updateRule;
        if (typeof rule === 'string' && rule.startsWith('(') && rule.endsWith(SUFFIX)) {
            collection.updateRule = rule.slice(1, rule.length - SUFFIX.length - 1);
            app.save(collection);
        }
    }

    try {
        const otp = app.findCollectionByNameOrId('otp_codes');
        const tenantRule =
            '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)';
        otp.listRule = tenantRule;
        otp.viewRule = tenantRule;
        otp.createRule = tenantRule;
        otp.updateRule = tenantRule;
        otp.deleteRule = tenantRule;
        app.save(otp);
    } catch (e) { /* collection absent */ }

    try {
        const consent = app.findCollectionByNameOrId('consent_events');
        consent.listRule = TENANT_MATCH;
        consent.viewRule = TENANT_MATCH;
        consent.createRule = TENANT_MATCH;
        consent.updateRule = null;
        consent.deleteRule = null;
        app.save(consent);
    } catch (e) { /* collection absent */ }

    for (const name of PHANTOM_COLLECTIONS) {
        try {
            const collection = app.findCollectionByNameOrId(name);
            const shared =
                '@request.auth.id != "" && (account_email = "" || account_email = @request.auth.email || account_email = @request.auth.account_email)';
            collection.listRule = shared;
            collection.viewRule = shared;
            collection.createRule = shared;
            collection.updateRule = shared;
            collection.deleteRule = shared;
            app.save(collection);
        } catch (e) { /* collection absent */ }
    }
});
