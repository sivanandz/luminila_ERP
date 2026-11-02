/// <reference path="../pb_data/types.d.ts" />

/**
 * Analytics Deep-Insights foundations (plan: docs/plans/2026-11-02-analytics-deep-insights.md).
 *
 * 1. `unit_cost` on sale_items + sales_order_items — the cost snapshot at
 *    sale time. Without it COGS/margin/GMROI for any past sale silently uses
 *    *current* products.cost_price, which is wrong the moment a cost changes.
 *    Nullable: historical rows are backfilled by
 *    src/scripts/backfill-unit-costs.ts, and analytics treat a missing value
 *    as "estimate from current cost" rather than 0.
 *
 * 2. `analytics_daily_snapshots` — Layer-3 precomputed daily rollups
 *    (per day × category) so 12-month/mix-shift views don't rescan the whole
 *    ledger client-side. Rebuilt by src/scripts/rebuild-analytics-snapshots.ts.
 *
 * Idempotent: fresh schemas that already carry unit_cost no-op on part 1.
 */

const TENANT_RULE = '@request.auth.email != "" && account_email = @request.auth.email';

migrate((app) => {
  // --- 1. unit_cost snapshots on the two sale-item tables ---
  for (const name of ["sale_items", "sales_order_items"]) {
    const collection = app.findCollectionByNameOrId(name);
    const fieldNames = collection.fields.map((field) => field.name);
    if (!fieldNames.includes("unit_cost")) {
      collection.fields.add(new NumberField({ name: "unit_cost", min: 0 }));
      app.save(collection);
    }
  }

  // --- 2. daily snapshot rollups ---
  // `findCollectionByNameOrId` throws when the collection is absent; on a
  // fresh database that aborted the whole migrate run. Create the collection
  // first, add fields, then apply rules (PB 0.25 ignores constructor fields).
  let snapshots = null;
  try {
    snapshots = app.findCollectionByNameOrId("analytics_daily_snapshots");
  } catch (e) {
    snapshots = null;
  }

  if (!snapshots) {
    snapshots = new Collection({ type: "base", name: "analytics_daily_snapshots" });
    app.save(snapshots);

    const fields = [
      // System fields declared explicitly — without created/updated any
      // `sort=-updated` query 400s (see 1793000001 corrective).
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      { name: "account_email", type: "text", required: true, max: 255 },
      { name: "day", type: "text", required: true, max: 10 }, // YYYY-MM-DD
      { name: "category_id", type: "text", max: 60 }, // '' = unclassified
      { name: "category_name", type: "text", max: 200 },
      { name: "revenue", type: "number" },
      { name: "cogs", type: "number" },
      { name: "units", type: "number" },
      { name: "orders", type: "number" },
      { name: "discounts", type: "number" },
      { name: "stock_value", type: "number" }, // optional end-of-day stock value
    ];
    for (const def of fields) {
      snapshots.fields.add(new Field(def));
    }
    app.save(snapshots);

    unmarshal({
      listRule: TENANT_RULE,
      viewRule: TENANT_RULE,
      createRule: TENANT_RULE,
      updateRule: TENANT_RULE,
      deleteRule: TENANT_RULE,
      indexes: [
        "CREATE UNIQUE INDEX idx_analytics_snap_day_cat ON analytics_daily_snapshots (account_email, day, category_id)",
        "CREATE INDEX idx_analytics_snap_day ON analytics_daily_snapshots (account_email, day)",
      ],
    }, snapshots);
    app.save(snapshots);
  }

  return null;
}, (app) => {
  // Down: drop the snapshot collection; leave unit_cost in place (removing it
  // would destroy backfilled data on rollback, which is worse than keeping it).
  try {
    const snapshots = app.findCollectionByNameOrId("analytics_daily_snapshots");
    app.delete(snapshots);
  } catch (e) {
    // already absent
  }
  return null;
});
