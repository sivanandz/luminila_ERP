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
 * Strict tenant rules: sessions are only ever read/written by the account
 * that created them, matching the sales_orders isolation.
 */

const TENANT_RULE = '@request.auth.email != "" && account_email = @request.auth.email';

migrate((app) => {
  const orderPacking = new Collection({
    type: "base",
    name: "order_packing",
    listRule: TENANT_RULE,
    viewRule: TENANT_RULE,
    createRule: TENANT_RULE,
    updateRule: TENANT_RULE,
    deleteRule: TENANT_RULE,
    fields: [
      // System fields must be declared explicitly in programmatic migrations;
      // without created/updated any `sort=-updated` query 400s and every
      // session read fails.
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      { name: "account_email", type: "text", required: true, max: 255 },
      { name: "order_id", type: "text", required: true, max: 60 },
      { name: "order_number", type: "text", required: true, max: 60 },
      { name: "customer_name", type: "text", max: 200 },
      { name: "customer_phone", type: "text", max: 40 },
      {
        name: "status",
        type: "select",
        maxSelect: 1,
        required: true,
        values: ["in_progress", "completed", "cancelled"],
      },
      { name: "packed_items", type: "json", maxSize: 2000000 },
      { name: "packed_by", type: "text", max: 200 },
      { name: "notes", type: "text", max: 2000 },
      { name: "completed_at", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_order_packing_order ON order_packing (account_email, order_id)",
      "CREATE INDEX idx_order_packing_number ON order_packing (account_email, order_number)",
      "CREATE INDEX idx_order_packing_status ON order_packing (account_email, status)",
    ],
  });

  app.save(orderPacking);
}, (app) => {
  const collection = app.findCollectionByNameOrId("order_packing");
  app.delete(collection);
});
