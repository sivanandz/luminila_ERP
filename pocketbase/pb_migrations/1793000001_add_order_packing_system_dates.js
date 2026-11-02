/// <reference path="../pb_data/types.d.ts" />

/**
 * Corrective: 1793000000 created `order_packing` without PocketBase's system
 * date fields, so every sorted read (`sort=-updated`) returned 400 and the
 * packing station silently saw zero sessions — completed orders never moved
 * to "packed, awaiting dispatch".
 *
 * Adds created/updated if missing. Idempotent: fresh installs already have
 * them from the corrected 1793000000, and this migration no-ops there.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("order_packing");
  const fieldNames = collection.fields.map((field) => field.name);

  if (!fieldNames.includes("created")) {
    collection.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  }
  if (!fieldNames.includes("updated")) {
    collection.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  }

  return app.save(collection);
}, (app) => {
  // Rollback restores the historical (broken) shape; leaving the dates in
  // place is harmless, so the down migration is a no-op.
  return null;
});
