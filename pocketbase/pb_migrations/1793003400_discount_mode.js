/// <reference path="../pb_data/types.d.ts" />

/**
 * Bill discount mode — records whether a sale/invoice discount was entered as a
 * percentage or a flat rupee amount. Amounts continue to live in `discount` /
 * `discount_amount`; this only preserves the operator's intent for receipts,
 * audits and reports.
 *
 * The POS "lowest safe price" (cost floor) is deliberately NOT stored: it is
 * operator guidance, never part of the bill or invoice.
 */
migrate((app) => {
    for (const name of ['sales', 'invoices']) {
        let collection = null;
        try {
            collection = app.findCollectionByNameOrId(name);
        } catch (e) {
            continue;
        }
        if (!collection) continue;

        const fieldNames = collection.fields.map((field) => field.name);
        if (fieldNames.indexOf('discount_mode') !== -1) continue;

        collection.fields.add(new Field({
            name: 'discount_mode',
            type: 'select',
            maxSelect: 1,
            values: ['percent', 'fixed'],
        }));
        app.save(collection);
    }
}, (app) => {
    for (const name of ['sales', 'invoices']) {
        let collection = null;
        try {
            collection = app.findCollectionByNameOrId(name);
        } catch (e) {
            continue;
        }
        if (!collection) continue;

        const field = collection.fields.getByName('discount_mode');
        if (!field) continue;
        collection.fields.removeById(field.id);
        app.save(collection);
    }
});
