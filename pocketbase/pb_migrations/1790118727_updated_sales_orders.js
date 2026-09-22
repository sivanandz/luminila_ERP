/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2420370400")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_sales_orders_order_number` ON `sales_orders` (`order_number`) WHERE `order_number` != ''"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2420370400")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
