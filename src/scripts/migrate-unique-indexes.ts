/**
 * Migration Script: Apply Unique Indexes & Schema Constraints for Concurrency Safety
 * Resolves F9 (🟠 P2) from AGENT 1 / AGENT 2 Collaboration Forum
 *
 * Enforces unique document number constraints on:
 * - invoices (invoice_number)
 * - purchase_orders (po_number)
 * - goods_received_notes (grn_number)
 * - credit_notes (credit_note_number)
 * - delivery_challans (challan_number)
 * - expenses (expense_number) + adds missing fields (expense_number, payment_mode, payee, reference_number)
 * - number_sequences (name)
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8091';

async function migrate() {
    console.log(`[Migration] Connecting to PocketBase at ${PB_URL}...`);
    const pb = new PocketBase(PB_URL);

    const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@luminila.com';
    const adminPass = process.env.PB_ADMIN_PASSWORD || 'password123456';

    try {
        await pb.collection('_superusers').authWithPassword(adminEmail, adminPass);
    } catch {
        await (pb as any).admins.authWithPassword(adminEmail, adminPass);
    }
    console.log('[Migration] Superuser authenticated.');

    // 1. Ensure expenses collection has expense_number, payment_mode, payee, reference_number
    const expensesCol = await pb.collections.getOne('expenses');
    const existingExpenseFields = new Set(expensesCol.fields.map((f: any) => f.name));
    const expenseFieldsToAdd = [
        { name: 'expense_number', type: 'text', required: false },
        { name: 'payment_mode', type: 'text', required: false },
        { name: 'payee', type: 'text', required: false },
        { name: 'reference_number', type: 'text', required: false },
    ];

    const newExpenseFields = [...expensesCol.fields];
    let expAdded = 0;
    for (const f of expenseFieldsToAdd) {
        if (!existingExpenseFields.has(f.name)) {
            newExpenseFields.push(f);
            expAdded++;
        }
    }
    if (expAdded > 0) {
        console.log(`[Migration] Adding ${expAdded} fields to 'expenses'...`);
        await pb.collections.update(expensesCol.id, { fields: newExpenseFields });
        console.log(`[Migration] 'expenses' fields updated.`);
    }

    // 2. Collection Unique Index Configurations
    const indexConfigs: { collection: string; indexSql: string }[] = [
        {
            collection: 'invoices',
            indexSql: "CREATE UNIQUE INDEX `idx_invoices_invoice_number` ON `invoices` (`invoice_number`) WHERE `invoice_number` != ''"
        },
        {
            collection: 'purchase_orders',
            indexSql: "CREATE UNIQUE INDEX `idx_purchase_orders_po_number` ON `purchase_orders` (`po_number`) WHERE `po_number` != ''"
        },
        {
            collection: 'goods_received_notes',
            indexSql: "CREATE UNIQUE INDEX `idx_grn_grn_number` ON `goods_received_notes` (`grn_number`) WHERE `grn_number` != ''"
        },
        {
            collection: 'credit_notes',
            indexSql: "CREATE UNIQUE INDEX `idx_credit_notes_credit_note_number` ON `credit_notes` (`credit_note_number`) WHERE `credit_note_number` != ''"
        },
        {
            collection: 'delivery_challans',
            indexSql: "CREATE UNIQUE INDEX `idx_delivery_challans_challan_number` ON `delivery_challans` (`challan_number`) WHERE `challan_number` != ''"
        },
        {
            collection: 'expenses',
            indexSql: "CREATE UNIQUE INDEX `idx_expenses_expense_number` ON `expenses` (`expense_number`) WHERE `expense_number` != ''"
        },
        {
            collection: 'number_sequences',
            indexSql: "CREATE UNIQUE INDEX `idx_number_sequences_name` ON `number_sequences` (`name`) WHERE `name` != ''"
        },
    ];

    for (const config of indexConfigs) {
        try {
            const col = await pb.collections.getOne(config.collection);
            const currentIdxs = col.indexes || [];
            // Check if already present
            const alreadyExists = currentIdxs.some((idx: string) =>
                idx.includes(config.collection) && idx.toLowerCase().includes('unique')
            );
            if (!alreadyExists) {
                console.log(`[Migration] Adding unique index to '${config.collection}'...`);
                await pb.collections.update(col.id, {
                    indexes: [...currentIdxs, config.indexSql],
                });
                console.log(`[Migration] ✅ Unique index applied to '${config.collection}'.`);
            } else {
                console.log(`[Migration] Unique index already exists on '${config.collection}'.`);
            }
        } catch (err: any) {
            console.error(`[Migration] ❌ Error applying index to '${config.collection}':`, err.message);
            throw err;
        }
    }

    console.log('[Migration] All unique indexes and schema constraints successfully applied.');
}

migrate().catch((err) => {
    console.error('[Migration] Failed:', err);
    process.exit(1);
});
