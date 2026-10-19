/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // add field
  collection.fields.addAt(15, new Field({
    "hidden": false,
    "id": "json447239975",
    "maxSize": 0,
    "name": "channel_prices",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1715963891")

  // remove field
  collection.fields.removeById("json447239975")

  return app.save(collection)
})
