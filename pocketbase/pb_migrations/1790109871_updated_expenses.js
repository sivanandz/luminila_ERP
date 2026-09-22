/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1691921218")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_expenses_expense_number` ON `expenses` (`expense_number`) WHERE `expense_number` != ''"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1691921218")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
