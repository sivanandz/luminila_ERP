/// <reference path="../pb_data/types.d.ts" />

/**
 * DRAFT — review before applying.
 *
 * D-36: five collections referenced by live code did not exist, and every call
 * site swallowed the 404, so campaign attribution, multi-location transfers,
 * catalog sync logging, AWB dispatch and the cash-register backup silently
 * produced nothing. This creates them with the fields the call sites write.
 *
 * Field names come from the interfaces in `multi-location.ts`, the create
 * payloads in `catalog-sync.ts` and `BarcodeScanDispatchModal.tsx`, and the
 * backup reader in `backup.ts`.
 */

const TENANT_RULE = '@request.auth.id != "" && (account_email = "" || account_email = @request.auth.email)';

migrate((app) => {
  const inventoryLocations = new Collection({
    type: "base",
    name: "inventory_locations",
    listRule: TENANT_RULE,
    viewRule: TENANT_RULE,
    createRule: TENANT_RULE,
    updateRule: TENANT_RULE,
    deleteRule: TENANT_RULE,
    fields: [
      { name: "account_email", type: "text", max: 255 },
      { name: "code", type: "text", required: true, max: 40 },
      { name: "name", type: "text", required: true, max: 120 },
      { name: "type", type: "select", maxSelect: 1, values: ["warehouse", "pos_store", "vault", "transit"], required: true },
      { name: "address", type: "text", max: 500 },
      { name: "city", type: "text", max: 120 },
      { name: "state", type: "text", max: 120 },
      { name: "pincode", type: "text", max: 10 },
      { name: "contact_phone", type: "text", max: 20 },
      { name: "gstin", type: "text", max: 20 },
      { name: "is_active", type: "bool" },
      { name: "is_default", type: "bool" },
      { name: "allow_pos_sales", type: "bool" },
      { name: "color", type: "text", max: 20 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_inventory_locations_code ON inventory_locations (account_email, code)"],
  });
  app.save(inventoryLocations);

  const inventoryTransfers = new Collection({
    type: "base",
    name: "inventory_transfers",
    listRule: TENANT_RULE,
    viewRule: TENANT_RULE,
    createRule: TENANT_RULE,
    updateRule: TENANT_RULE,
    deleteRule: TENANT_RULE,
    fields: [
      { name: "account_email", type: "text", max: 255 },
      { name: "transfer_number", type: "text", required: true, max: 60 },
      { name: "source_location_id", type: "text", required: true, max: 60 },
      { name: "source_location_name", type: "text", max: 120 },
      { name: "destination_location_id", type: "text", required: true, max: 60 },
      { name: "destination_location_name", type: "text", max: 120 },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "dispatched", "in_transit", "received", "cancelled"], required: true },
      { name: "items", type: "json", maxSize: 2000000 },
      { name: "challan_id", type: "text", max: 60 },
      { name: "challan_number", type: "text", max: 60 },
      { name: "eway_bill_number", type: "text", max: 60 },
      { name: "carrier", type: "text", max: 120 },
      { name: "tracking_awb", type: "text", max: 120 },
      { name: "notes", type: "text", max: 2000 },
      { name: "dispatched_by", type: "text", max: 200 },
      { name: "dispatched_at", type: "date" },
      { name: "received_by", type: "text", max: 200 },
      { name: "received_at", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_inventory_transfers_number ON inventory_transfers (account_email, transfer_number)",
      "CREATE INDEX idx_inventory_transfers_status ON inventory_transfers (account_email, status)",
    ],
  });
  app.save(inventoryTransfers);

  const catalogSyncLogs = new Collection({
    type: "base",
    name: "catalog_sync_logs",
    listRule: TENANT_RULE,
    viewRule: TENANT_RULE,
    createRule: TENANT_RULE,
    updateRule: TENANT_RULE,
    deleteRule: TENANT_RULE,
    fields: [
      { name: "account_email", type: "text", max: 255 },
      { name: "status", type: "select", maxSelect: 1, values: ["running", "success", "failed"], required: true },
      { name: "products_added", type: "number", min: 0 },
      { name: "products_updated", type: "number", min: 0 },
      { name: "products_deleted", type: "number", min: 0 },
      { name: "errors", type: "json", maxSize: 2000000 },
      { name: "started_at", type: "date" },
      { name: "completed_at", type: "date" },
    ],
  });
  app.save(catalogSyncLogs);

  const shipments = new Collection({
    type: "base",
    name: "shipments",
    listRule: TENANT_RULE,
    viewRule: TENANT_RULE,
    createRule: TENANT_RULE,
    updateRule: TENANT_RULE,
    deleteRule: TENANT_RULE,
    fields: [
      { name: "account_email", type: "text", max: 255 },
      { name: "order_id", type: "text", required: true, max: 60 },
      { name: "carrier", type: "text", max: 120 },
      { name: "awb_number", type: "text", max: 120 },
      { name: "shipping_status", type: "select", maxSelect: 1, values: ["manifested", "picked_up", "in_transit", "delivered", "rto", "cancelled"] },
      { name: "tracking_url", type: "text", max: 500 },
      { name: "cod_amount", type: "number", min: 0 },
      { name: "weight_grams", type: "number", min: 0 },
    ],
    indexes: [
      "CREATE INDEX idx_shipments_order ON shipments (account_email, order_id)",
      "CREATE INDEX idx_shipments_awb ON shipments (awb_number)",
    ],
  });
  app.save(shipments);

  // Only read by the backup exporter today; kept minimal so a restore has a
  // stable shape when register management is added.
  const cashRegisters = new Collection({
    type: "base",
    name: "cash_registers",
    listRule: TENANT_RULE,
    viewRule: TENANT_RULE,
    createRule: TENANT_RULE,
    updateRule: TENANT_RULE,
    deleteRule: TENANT_RULE,
    fields: [
      { name: "account_email", type: "text", max: 255 },
      { name: "name", type: "text", max: 120 },
      { name: "opened_at", type: "date" },
      { name: "closed_at", type: "date" },
      { name: "opening_float", type: "number", min: 0 },
      { name: "closing_balance", type: "number" },
      { name: "status", type: "select", maxSelect: 1, values: ["open", "closed", "reconciled"] },
      { name: "notes", type: "text", max: 2000 },
    ],
  });
  app.save(cashRegisters);
}, (app) => {
  for (const name of ["shipments", "catalog_sync_logs", "inventory_transfers", "inventory_locations", "cash_registers"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch {
      // already absent
    }
  }
});
