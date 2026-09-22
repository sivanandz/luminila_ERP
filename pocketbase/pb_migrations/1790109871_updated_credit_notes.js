/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_250375204")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_credit_notes_credit_note_number` ON `credit_notes` (`credit_note_number`) WHERE `credit_note_number` != ''"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_250375204")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
