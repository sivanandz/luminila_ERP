/// <reference path="../pb_data/types.d.ts" />

/**
 * Packing & Dispatch Manager: per-order packing sessions.
 *
 * One row per order being packed. `packed_items` holds the per-line scan
 * progress ({item_id, variant_id, product_id, sku, packed_qty, quantity,
 * scanned_at} rows) so the station can resume a half-packed order and prove
 * which pieces went into which parcel. `order_id` is text (same convention as
 * the shipments collection) and `order_number` is indexed because a scanned
 * packing slip resolves by number, not record id.
 *
 * Construction order matters (audit PK-01, regression of A-05): PocketBase
 * 0.25's JSVM IGNORES a `fields` array passed to the `Collection` constructor,
 * so a rule that mentions `account_email` fails validation with "unknown field
 * account_email" on save and the collection is never created (the bootstrap
 * swallows migrate-up errors, so the failure was silent). The collection is
 * therefore created empty, its fields are added and saved, and only then are
 * rules/indexes applied.
 *
 * Self-healing: if a previous run died between collection-save and field-add,
 * the existing collection is reused and only missing fields are added — a
 * field-less husk never blocks the migration permanently.
 *
 * Strict tenant rules (audit PK-02, A-01 class): the login email OR the owning
 * tenant's account_email both match, exactly like the corrected pattern in
 * 1792774201. A staff account (users.email !== account_email) can therefore
 * read/write packing sessions.
 *
 * The unique partial index enforces one in-progress session per order
 * (audit PK-03): the old read-then-create race could open two concurrent
 * sessions for the same order, each counting scans independently.
 */

const TENANT_RULE =
  '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)';

migrate((app) => {
  let orderPacking;
  try {
    orderPacking = app.findCollectionByNameOrId("order_packing");
  } catch {
    orderPacking = new Collection({ type: "base", name: "order_packing" });
    app.save(orderPacking);
  }

  const existing = new Set(orderPacking.fields.map((f) => f.name));
  const add = (field) => {
    if (!existing.has(field.name)) {
      orderPacking.fields.add(field);
      existing.add(field.name);
    }
  };

  // System fields must be declared explicitly in programmatic migrations;
  // without created/updated any `sort=-updated` query 400s and every session
  // read fails.
  add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  add(new TextField({ name: "account_email", required: true, max: 255 }));
  add(new TextField({ name: "order_id", required: true, max: 60 }));
  add(new TextField({ name: "order_number", required: true, max: 60 }));
  add(new TextField({ name: "customer_name", max: 200 }));
  add(new TextField({ name: "customer_phone", max: 40 }));
  add(new SelectField({
    name: "status",
    maxSelect: 1,
    required: true,
    values: ["in_progress", "completed", "cancelled"],
  }));
  add(new JSONField({ name: "packed_items", maxSize: 2000000 }));
  add(new TextField({ name: "packed_by", max: 200 }));
  add(new TextField({ name: "notes", max: 2000 }));
  add(new DateField({ name: "completed_at" }));
  app.save(orderPacking);

  // Rules/indexes only after every referenced field exists (A-05).
  orderPacking.listRule = TENANT_RULE;
  orderPacking.viewRule = TENANT_RULE;
  orderPacking.createRule = TENANT_RULE;
  orderPacking.updateRule = TENANT_RULE;
  orderPacking.deleteRule = TENANT_RULE;
  orderPacking.indexes = [
    "CREATE INDEX idx_order_packing_order ON order_packing (account_email, order_id)",
    "CREATE INDEX idx_order_packing_number ON order_packing (account_email, order_number)",
    "CREATE INDEX idx_order_packing_status ON order_packing (account_email, status)",
    // At most ONE in-progress session per order (audit PK-03 race guard).
    "CREATE UNIQUE INDEX idx_order_packing_active ON order_packing (account_email, order_id) WHERE status = 'in_progress'",
  ];
  app.save(orderPacking);
}, (app) => {
  const collection = app.findCollectionByNameOrId("order_packing");
  app.delete(collection);
});
