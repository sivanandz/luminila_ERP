/// <reference path="../pb_data/types.d.ts" />

/**
 * Manufacturing job cards.
 *
 * PocketBase 0.25's JSVM ignores `fields` passed to `new Collection(...)` and
 * rejects rules that reference a field the collection does not have yet
 * ("unknown field account_email"). The collection is therefore created first,
 * fields are added through `collection.fields.add(...)`, and only then are the
 * rules applied (A-05).
 */
migrate((app) => {
  let collection = null;
  try {
    collection = app.findCollectionByNameOrId("manufacturing_jobs");
  } catch (e) {
    collection = null;
  }

  if (!collection) {
    collection = new Collection({ type: "base", name: "manufacturing_jobs" });
    app.save(collection);
  }

  const fields = [
    { name: "account_email", type: "text", required: true, max: 255 },
    { name: "job_number", type: "text", required: true, max: 40 },
    { name: "karigar_name", type: "text", required: true, max: 120 },
    { name: "product_name", type: "text", required: true, max: 200 },
    { name: "metal_grams", type: "number", min: 0 },
    { name: "purity_karat", type: "text", max: 10 },
    { name: "rate_per_gram", type: "number", min: 0 },
    { name: "finished_net_grams", type: "number", min: 0 },
    { name: "scrap_grams", type: "number", min: 0 },
    { name: "labour", type: "number", min: 0 },
    { name: "hallmarking", type: "number", min: 0 },
    { name: "finishing", type: "number", min: 0 },
    { name: "logistics", type: "number", min: 0 },
    { name: "certification", type: "number", min: 0 },
    { name: "tolerance_percent", type: "number", min: 0 },
    { name: "net_cost", type: "number", min: 0 },
    { name: "per_gram_cost", type: "number", min: 0 },
    { name: "loss_percent", type: "number" },
    { name: "status", type: "select", maxSelect: 1, values: ["in_progress", "completed"] },
    { name: "completed_at", type: "date" },
    { name: "notes", type: "text", max: 2000 },
  ];

  for (const def of fields) {
    if (!collection.fields.find((f) => f.name === def.name)) {
      collection.fields.add(new Field(def));
    }
  }
  app.save(collection);

  unmarshal({
    listRule: '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)',
    viewRule: '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)',
    createRule: '@request.auth.email != "" && (@request.body.account_email:isset = false || @request.body.account_email = @request.auth.email || @request.body.account_email = @request.auth.account_email)',
    updateRule: '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email) && @request.body.account_email:isset = false',
    deleteRule: '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)',
    indexes: [
      "CREATE UNIQUE INDEX idx_manufacturing_jobs_number ON manufacturing_jobs (account_email, job_number)",
    ],
  }, collection);
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("manufacturing_jobs");
  app.delete(collection);
});
