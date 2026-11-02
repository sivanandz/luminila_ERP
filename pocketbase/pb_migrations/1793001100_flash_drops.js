/// <reference path="../pb_data/types.d.ts" />

/**
 * Timed flash drops and 10-minute stock holds (WA-01 / WA-02).
 *
 * Before this migration a flash drop lived only in the operator's browser
 * (`localStorage['luminila_flash_drops_v1']`), so an external buyer opening the
 * WhatsApp checkout link always got "Flash Drop Not Found" and no server-side
 * stock hold existed. Drops and reservations are now tenant-scoped records:
 *
 *  - `flash_drops` keeps the campaign window, targets and the item snapshot
 *    (`items` JSON: productId, variantId, name, sku, imageUrl, originalPrice,
 *    dropPrice, allocatedStock). Prices in this snapshot are the only prices the
 *    storefront route will charge.
 *  - `flash_drop_reservations` is the hold ledger. Available units are
 *    `allocatedStock - (active or completed reservations)`, computed server-side;
 *    the partial unique index stops a phone from holding the same variant twice
 *    within one drop, so a retry is idempotent instead of consuming two units.
 *
 * Rules follow the hardened tenant style from 1793000002: the login email or
 * the owning tenant's account_email both match. The public checkout route uses
 * a superuser tenant client and scopes every query itself, so unauthenticated
 * buyers never touch PocketBase rules directly.
 *
 * Construction order matters (A-05): PocketBase 0.25's JSVM ignores a
 * `fields` array passed to the `Collection` constructor, so a rule that mentions
 * `account_email` fails validation with "unknown field account_email" on a fresh
 * `migrate up`. Each collection is therefore created empty, its fields are
 * added and saved, and only then are the rules/indexes applied.
 *
 * `created`/`updated` are declared explicitly: a programmatic collection
 * without them 400s every `sort=-created` query used by the admin lists.
 */

const TENANT_RULE =
  '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)';

migrate((app) => {
  // -------------------------------------------------------------------------
  // flash_drops
  // -------------------------------------------------------------------------
  const drops = new Collection({ type: "base", name: "flash_drops" });
  app.save(drops);

  drops.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  drops.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  drops.fields.add(new TextField({ name: "account_email", required: true, max: 255 }));
  drops.fields.add(new TextField({ name: "title", required: true, max: 200 }));
  drops.fields.add(new TextField({ name: "description", max: 2000 }));
  drops.fields.add(new DateField({ name: "starts_at", required: true }));
  drops.fields.add(new DateField({ name: "ends_at", required: true }));
  drops.fields.add(
    new SelectField({
      name: "status",
      maxSelect: 1,
      required: true,
      values: ["draft", "scheduled", "active", "ended"],
    })
  );
  // Array of { productId, variantId, name, sku, imageUrl, originalPrice,
  // dropPrice, allocatedStock }. The snapshot is authoritative for pricing.
  drops.fields.add(new JSONField({ name: "items", maxSize: 2000000 }));
  drops.fields.add(new JSONField({ name: "target_jids", maxSize: 200000 }));
  drops.fields.add(new TextField({ name: "created_by", max: 200 }));
  app.save(drops);

  unmarshal(
    {
      listRule: TENANT_RULE,
      viewRule: TENANT_RULE,
      createRule: TENANT_RULE,
      updateRule: TENANT_RULE,
      deleteRule: TENANT_RULE,
      indexes: [
        "CREATE INDEX idx_flash_drops_tenant_status ON flash_drops (account_email, status)",
        "CREATE INDEX idx_flash_drops_tenant_end ON flash_drops (account_email, ends_at)",
      ],
    },
    drops
  );
  app.save(drops);

  // -------------------------------------------------------------------------
  // flash_drop_reservations
  // -------------------------------------------------------------------------
  const reservations = new Collection({ type: "base", name: "flash_drop_reservations" });
  app.save(reservations);

  reservations.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  reservations.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  reservations.fields.add(new TextField({ name: "account_email", required: true, max: 255 }));
  reservations.fields.add(
    new RelationField({
      name: "drop",
      required: true,
      maxSelect: 1,
      collectionId: drops.id,
      cascadeDelete: true,
    })
  );
  // Product/variant ids are stored as text (same convention as
  // stock_movements): a deleted variant must not silently delete the hold
  // history, and the route re-validates the variant against the drop items.
  reservations.fields.add(new TextField({ name: "product", max: 60 }));
  reservations.fields.add(new TextField({ name: "variant", required: true, max: 60 }));
  reservations.fields.add(new TextField({ name: "phone", required: true, max: 40 }));
  reservations.fields.add(new TextField({ name: "name", max: 200 }));
  reservations.fields.add(new NumberField({ name: "quantity", min: 1, max: 1 }));
  reservations.fields.add(
    new SelectField({
      name: "status",
      maxSelect: 1,
      required: true,
      values: ["active", "completed", "expired", "cancelled"],
    })
  );
  reservations.fields.add(new DateField({ name: "expires_at", required: true }));
  reservations.fields.add(new TextField({ name: "order", max: 60 }));
  app.save(reservations);

  unmarshal(
    {
      listRule: TENANT_RULE,
      viewRule: TENANT_RULE,
      createRule: TENANT_RULE,
      updateRule: TENANT_RULE,
      deleteRule: TENANT_RULE,
      indexes: [
        "CREATE INDEX idx_flash_res_tenant_drop ON flash_drop_reservations (account_email, drop, status)",
        "CREATE INDEX idx_flash_res_tenant_variant ON flash_drop_reservations (account_email, drop, variant, status)",
        "CREATE INDEX idx_flash_res_tenant_phone ON flash_drop_reservations (account_email, phone)",
        "CREATE INDEX idx_flash_res_expiry ON flash_drop_reservations (account_email, status, expires_at)",
        // One live hold per phone/variant/drop. A retried reserve therefore
        // returns the existing row instead of consuming a second unit.
        "CREATE UNIQUE INDEX idx_flash_res_one_active ON flash_drop_reservations (account_email, drop, variant, phone) WHERE status = 'active'",
      ],
    },
    reservations
  );
  app.save(reservations);
}, (app) => {
  for (const name of ["flash_drop_reservations", "flash_drops"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (e) {
      // Already gone.
    }
  }
});
