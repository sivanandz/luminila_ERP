/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_493924462")

  // Concurrency guard for resolveStockDiscrepancy: PocketBase API rules act as
  // record filters, so allowing updates only while status is still "active"
  // makes the losing resolve of two concurrent ones fail with 404 before it
  // can credit the variant stock a second time.
  collection.updateRule = "@request.auth.id != \"\" && status = \"active\""

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_493924462")

  // revert to the previous rule
  collection.updateRule = "@request.auth.id != \"\""

  return app.save(collection)
})
