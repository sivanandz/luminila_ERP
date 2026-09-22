/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3431399436")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_grn_grn_number` ON `goods_received_notes` (`grn_number`) WHERE `grn_number` != ''"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3431399436")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
