/// <reference path="../pb_data/types.d.ts" />

/**
 * DRAFT — review before applying.
 *
 * D-13: inward goods cost was accumulated inside the `purchase_orders.notes`
 * metadata blob. Two reconciliations close together read the same value and
 * wrote it back, so one inward cost was lost and inventory was undervalued.
 * A numeric column lets the write be an atomic increment.
 *
 * The blob keeps its other keys (budget, discrepancy, approval) because they
 * are single-writer fields; only the accumulating cost moves to a column.
 */
migrate((app) => {
  const purchaseOrders = app.findCollectionByNameOrId("purchase_orders");
  if (!purchaseOrders.fields.fieldNames().includes("inward_cost")) {
    purchaseOrders.fields.add(new NumberField({ name: "inward_cost", min: 0 }));
  }
  app.save(purchaseOrders);
}, (app) => {
  const purchaseOrders = app.findCollectionByNameOrId("purchase_orders");
  purchaseOrders.fields.removeByName("inward_cost");
  app.save(purchaseOrders);
});
