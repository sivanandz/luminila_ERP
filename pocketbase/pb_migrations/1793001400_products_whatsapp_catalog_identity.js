/// <reference path="../pb_data/types.d.ts" />

/**
 * WhatsApp catalog identity on products (audit N-C1).
 *
 * whatsapp-catalog.ts / whatsapp-event-sync.ts persist `whatsapp_catalog_id`
 * and `whatsapp_last_synced` on every sync, but no migration ever added the
 * fields. PocketBase rejected the updates as unknown fields and every write was
 * swallowed by `.catch`, so the "synced/unsynced" filter and the stored-id
 * matching were dead: reconcile fell back to SKU alone, and a SKU change
 * duplicated the catalog item.
 *
 * Self-healing: each field is added only when missing, so a partially applied
 * earlier run (or a collection bootstrapped without these fields) is completed
 * on the next `migrate up` — the same discipline as 1792774201.
 */

migrate((app) => {
  const products = app.findCollectionByNameOrId("products");
  const existing = new Set(products.fields.map((f) => f.name));

  if (!existing.has("whatsapp_catalog_id")) {
    products.fields.add(new TextField({ name: "whatsapp_catalog_id", max: 120 }));
  }
  if (!existing.has("whatsapp_last_synced")) {
    products.fields.add(new DateField({ name: "whatsapp_last_synced" }));
  }
  app.save(products);
}, (app) => {
  const products = app.findCollectionByNameOrId("products");
  for (const name of ["whatsapp_catalog_id", "whatsapp_last_synced"]) {
    const field = products.fields.getByName(name);
    if (field) products.fields.remove(field.id);
  }
  app.save(products);
});
