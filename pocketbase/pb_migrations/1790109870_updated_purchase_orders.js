/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1342968361")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_purchase_orders_po_number` ON `purchase_orders` (`po_number`) WHERE `po_number` != ''"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1342968361")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
