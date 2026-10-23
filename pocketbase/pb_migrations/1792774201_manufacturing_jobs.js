/// <reference path="../pb_data/types.d.ts" />

/**
 * DRAFT — not applied. Review before running.
 *
 * Manufacturing job cards currently live as a JSON array in `store_settings`
 * under `manufacturing_jobs`. This collection replaces that store so jobs can
 * be queried per karigar and status.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "manufacturing_jobs",
    listRule: '@request.auth.email != "" && account_email = @request.auth.email',
    viewRule: '@request.auth.email != "" && account_email = @request.auth.email',
    createRule: '@request.auth.email != "" && account_email = @request.auth.email',
    updateRule: '@request.auth.email != "" && account_email = @request.auth.email',
    deleteRule: '@request.auth.email != "" && account_email = @request.auth.email',
    fields: [
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
    ],
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("manufacturing_jobs");
  app.delete(collection);
});
