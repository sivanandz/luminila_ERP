/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 1793002000: Inventory & Packing Station 2.0 schema updates
 *
 * 1. order_packing:
 *    - packaging_preset: text (e.g. "velvet_box_80g", "bridal_box_250g")
 *    - weight_grams: number (tare + piece weight in grams)
 *    - packaging_cost: number (optional packaging material cost)
 *    - shortage_items: json (quarantined/short items logged during packing)
 *
 * 2. products:
 *    - is_bundle: bool (whether this product is a virtual combo / bridal set)
 *    - bundle_items: json (array of { variant_id, product_id, sku, name, quantity })
 *
 * 3. inventory_audits (NEW COLLECTION):
 *    - Store tray/bin cycle-count audit sessions.
 *    - Strict account_email tenant scoping.
 *    - Explicit created & updated autodate fields.
 */

const TENANT_RULE =
  '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)';

migrate((app) => {
  // 1. Update order_packing
  try {
    const orderPacking = app.findCollectionByNameOrId("order_packing");
    const existing = new Set(orderPacking.fields.map((f) => f.name));
    const addPackingField = (field) => {
      if (!existing.has(field.name)) {
        orderPacking.fields.add(field);
        existing.add(field.name);
      }
    };
    addPackingField(new TextField({ name: "packaging_preset", max: 100 }));
    addPackingField(new NumberField({ name: "weight_grams", min: 0 }));
    addPackingField(new NumberField({ name: "packaging_cost", min: 0 }));
    addPackingField(new JSONField({ name: "shortage_items", maxSize: 1000000 }));
    app.save(orderPacking);
  } catch (err) {
    console.warn("order_packing collection update warning:", err);
  }

  // 2. Update products
  try {
    const products = app.findCollectionByNameOrId("products");
    const existingProdFields = new Set(products.fields.map((f) => f.name));
    const addProductField = (field) => {
      if (!existingProdFields.has(field.name)) {
        products.fields.add(field);
        existingProdFields.add(field.name);
      }
    };
    addProductField(new BoolField({ name: "is_bundle" }));
    addProductField(new JSONField({ name: "bundle_items", maxSize: 1000000 }));
    app.save(products);
  } catch (err) {
    console.warn("products collection update warning:", err);
  }

  // 3. Create inventory_audits collection
  let audits;
  try {
    audits = app.findCollectionByNameOrId("inventory_audits");
  } catch {
    audits = new Collection({ type: "base", name: "inventory_audits" });
    app.save(audits);
  }

  const existingAuditFields = new Set(audits.fields.map((f) => f.name));
  const addAuditField = (field) => {
    if (!existingAuditFields.has(field.name)) {
      audits.fields.add(field);
      existingAuditFields.add(field.name);
    }
  };

  // Critical: System autodate fields MUST be declared explicitly
  addAuditField(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  addAuditField(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  addAuditField(new TextField({ name: "account_email", required: true, max: 255 }));
  addAuditField(new TextField({ name: "location", required: true, max: 120 }));
  addAuditField(new TextField({ name: "category", max: 100 }));
  addAuditField(new SelectField({
    name: "status",
    maxSelect: 1,
    required: true,
    values: ["in_progress", "completed", "cancelled"],
  }));
  addAuditField(new JSONField({ name: "scanned_items", maxSize: 2000000 }));
  addAuditField(new JSONField({ name: "summary", maxSize: 1000000 }));
  addAuditField(new TextField({ name: "audited_by", max: 200 }));
  addAuditField(new TextField({ name: "notes", max: 2000 }));
  addAuditField(new DateField({ name: "completed_at" }));
  app.save(audits);

  // Apply tenant rules and indexes after fields exist
  audits.listRule = TENANT_RULE;
  audits.viewRule = TENANT_RULE;
  audits.createRule = TENANT_RULE;
  audits.updateRule = TENANT_RULE;
  audits.deleteRule = TENANT_RULE;
  audits.indexes = [
    "CREATE INDEX idx_inventory_audits_tenant ON inventory_audits (account_email, location)",
    "CREATE INDEX idx_inventory_audits_status ON inventory_audits (account_email, status)",
  ];
  app.save(audits);
}, (app) => {
  try {
    const audits = app.findCollectionByNameOrId("inventory_audits");
    app.delete(audits);
  } catch {}
});
