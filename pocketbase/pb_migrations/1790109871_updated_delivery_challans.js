/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3931064958")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_delivery_challans_challan_number` ON `delivery_challans` (`challan_number`) WHERE `challan_number` != ''"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3931064958")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
